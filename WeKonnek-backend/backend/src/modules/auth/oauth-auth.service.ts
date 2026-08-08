import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'crypto';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';

type Provider = 'google' | 'facebook' | 'apple';

@Injectable()
export class OAuthAuthService {
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService, private readonly auth: AuthService) {}

  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private b64(value: Buffer) { return value.toString('base64url'); }
  private assertProvider(value: string): Provider {
    if (!['google', 'facebook', 'apple'].includes(value)) throw new BadRequestException('Unsupported sign-in provider.');
    return value as Provider;
  }

  async start(providerInput: string, linkUserId?: string) {
    const provider = this.assertProvider(providerInput);
    const clientId = this.config.get<string>(`${provider.toUpperCase()}_CLIENT_ID`);
    const redirectUri = this.config.get<string>(`${provider.toUpperCase()}_REDIRECT_URI`);
    if (!clientId || !redirectUri) throw new BadRequestException(`${provider[0].toUpperCase() + provider.slice(1)} sign-in is currently unavailable.`);
    const state = this.b64(randomBytes(32)); const verifier = this.b64(randomBytes(48)); const nonce = this.b64(randomBytes(24));
    await this.prisma.authOAuthState.create({ data: { id: randomUUID(), provider, stateHash: this.hash(state), verifier, nonce, redirectUri, linkUserId, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    const challenge = this.b64(createHash('sha256').update(verifier).digest());
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', state });
    if (provider === 'google') { params.set('scope', 'openid email profile'); params.set('nonce', nonce); params.set('code_challenge', challenge); params.set('code_challenge_method', 'S256'); }
    if (provider === 'facebook') params.set('scope', 'email,public_profile');
    if (provider === 'apple') { params.set('scope', 'name email'); params.set('response_mode', 'query'); params.set('nonce', nonce); params.set('code_challenge', challenge); params.set('code_challenge_method', 'S256'); }
    const base = provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : provider === 'facebook' ? 'https://www.facebook.com/v20.0/dialog/oauth' : 'https://appleid.apple.com/auth/authorize';
    return { authorizationUrl: `${base}?${params}` };
  }

  async callback(providerInput: string, code: string, state: string) {
    const provider = this.assertProvider(providerInput);
    const record = await this.prisma.authOAuthState.findUnique({ where: { stateHash: this.hash(state || '') } });
    if (!record || record.provider !== provider || record.consumedAt || record.expiresAt <= new Date()) throw new UnauthorizedException('The sign-in request expired. Please try again.');
    const profile = await this.exchange(provider, code, record.redirectUri, record.verifier, record.nonce);
    let identity = await this.prisma.authIdentity.findUnique({ where: { provider_providerUserId: { provider, providerUserId: profile.id } }, include: { user: true } });
    let user = identity?.user;
    if (record.linkUserId) {
      if (identity && identity.userId !== record.linkUserId) throw new BadRequestException('This sign-in method is already connected to another account.');
      const already = await this.prisma.authIdentity.findUnique({ where: { userId_provider: { userId: record.linkUserId, provider } } });
      if (already && already.providerUserId !== profile.id) throw new BadRequestException(`A different ${provider} account is already connected.`);
      user = await this.prisma.user.findUniqueOrThrow({ where: { id: record.linkUserId } });
      if (!identity) identity = await this.prisma.authIdentity.create({ data: { id: randomUUID(), userId: user.id, provider, providerUserId: profile.id, email: profile.email, profile: profile.raw as any }, include: { user: true } });
    } else if (!user) {
      // Email is informational only. It never causes an automatic account merge.
      const emailTaken = profile.email ? await this.prisma.user.findUnique({ where: { email: profile.email } }) : null;
      user = await this.prisma.user.create({ data: { id: randomUUID(), phone: `oauth:${randomUUID()}`, email: emailTaken ? null : profile.email, firstName: profile.firstName, lastName: profile.lastName, role: UserRole.customer, isVerified: false } });
      identity = await this.prisma.authIdentity.create({ data: { id: randomUUID(), userId: user.id, provider, providerUserId: profile.id, email: profile.email, profile: profile.raw as any }, include: { user: true } });
    }
    const exchangeCode = this.b64(randomBytes(32));
    await this.prisma.authOAuthState.update({ where: { id: record.id }, data: { consumedAt: new Date(), completedUserId: user!.id, exchangeCodeHash: this.hash(exchangeCode) } });
    await this.prisma.authAuditLog.create({ data: { id: randomUUID(), userId: user!.id, event: record.linkUserId ? 'oauth_identity_linked' : 'oauth_authenticated', success: true, metadata: { provider } } });
    return { exchangeCode, link: Boolean(record.linkUserId) };
  }

  async exchangeCode(code: string) {
    const state = await this.prisma.authOAuthState.findUnique({ where: { exchangeCodeHash: this.hash(code || '') } });
    if (!state?.completedUserId || !state.consumedAt || state.expiresAt <= new Date()) throw new UnauthorizedException('The sign-in result expired. Please try again.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: state.completedUserId } });
    await this.prisma.authOAuthState.update({ where: { id: state.id }, data: { exchangeCodeHash: null } });
    return this.auth.createSession(user);
  }

  private async exchange(provider: Provider, code: string, redirectUri: string, verifier: string, expectedNonce: string) {
    const clientId = this.config.get<string>(`${provider.toUpperCase()}_CLIENT_ID`)!;
    const secret = this.config.get<string>(`${provider.toUpperCase()}_CLIENT_SECRET`);
    const tokenUrl = provider === 'google' ? 'https://oauth2.googleapis.com/token' : provider === 'facebook' ? 'https://graph.facebook.com/v20.0/oauth/access_token' : 'https://appleid.apple.com/auth/token';
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId });
    if (secret) body.set('client_secret', secret); if (provider !== 'facebook') body.set('code_verifier', verifier);
    const tokenResponse = await fetch(tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!tokenResponse.ok) throw new UnauthorizedException('We could not complete social sign-in. Please try again.');
    const tokens: any = await tokenResponse.json();
    if (provider === 'facebook') {
      const response = await fetch(`https://graph.facebook.com/me?fields=id,first_name,last_name,email&access_token=${encodeURIComponent(tokens.access_token)}`);
      if (!response.ok) throw new UnauthorizedException('We could not retrieve your profile.'); const raw: any = await response.json();
      return { id: raw.id, email: raw.email?.toLowerCase(), firstName: raw.first_name, lastName: raw.last_name, raw };
    }
    const raw = provider === 'google' ? await this.verifyGoogleToken(tokens.id_token, clientId) : await this.verifyAppleToken(tokens.id_token, clientId);
    if (raw.nonce && raw.nonce !== expectedNonce) throw new UnauthorizedException('The sign-in request could not be verified.');
    return { id: raw.sub, email: raw.email?.toLowerCase(), firstName: raw.given_name, lastName: raw.family_name, raw };
  }

  private decodeIdToken(token: string): any {
    const parts = String(token || '').split('.'); if (parts.length !== 3) throw new UnauthorizedException('The provider response was invalid.');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  }

  private async verifyGoogleToken(token: string, audience: string) {
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
    if (!response.ok) throw new UnauthorizedException('The provider response could not be verified.');
    const payload: any = await response.json();
    if (payload.aud !== audience || Number(payload.exp) * 1000 <= Date.now()) throw new UnauthorizedException('The provider response could not be verified.');
    return payload;
  }

  private async verifyAppleToken(token: string, audience: string) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new UnauthorizedException('The provider response was invalid.');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const response = await fetch('https://appleid.apple.com/auth/keys');
    if (!response.ok) throw new UnauthorizedException('The provider response could not be verified.');
    const jwks: any = await response.json(); const jwk = jwks.keys?.find((key: any) => key.kid === header.kid);
    if (!jwk) throw new UnauthorizedException('The provider response could not be verified.');
    const valid = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    const payload = this.decodeIdToken(token);
    if (!valid || payload.iss !== 'https://appleid.apple.com' || payload.aud !== audience || Number(payload.exp) * 1000 <= Date.now()) throw new UnauthorizedException('The provider response could not be verified.');
    return payload;
  }
}
