import { Controller, Post, Get, Body, Req, UseGuards, Param, Query, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OAuthAuthService } from './oauth-auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly oauth: OAuthAuthService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@Req() req: any) {
    return this.authService.decorateUser(req.user);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  logout(@Res({ passthrough: true }) response: any) {
    // Stateless JWT: client clears its token. Endpoint exists for symmetry.
    response.clearCookie('wk_refresh_token', { path: '/api/auth' });
    return { success: true };
  }

  @Post('send-otp')
  sendOtp(@Body() body: { phone: string }, @Req() req: any) {
    return this.authService.sendOtp(body.phone, this.requestContext(req));
  }

  @Post('verify-otp')
  async verifyOtp(@Body() body: { challengeId: string; code: string }, @Req() req: any, @Res({ passthrough: true }) response: any) {
    const result = await this.authService.verifyOtp(body.challengeId, body.code, this.requestContext(req));
    this.setRefreshCookie(response, result.refreshToken);
    return result;
  }

  @Post('otp/:challengeId/send')
  resendOtp(@Param('challengeId') challengeId: string, @Body() body: { channel: 'sms' | 'whatsapp' }, @Req() req: any) {
    return this.authService.resendOtp(challengeId, body.channel, this.requestContext(req));
  }

  @Post('mobile/start')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  startMobileLink(@Body() body: { phone: string }, @Req() req: any) {
    return this.authService.sendOtp(body.phone, { ...this.requestContext(req), targetUserId: req.user.id });
  }

  @Post('complete-profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  completeProfile(@Body() body: { firstName: string; lastName: string; email?: string; password: string }, @Req() req: any) {
    return this.authService.completeCustomerProfile(req.user.id, body);
  }

  @Get('oauth/:provider/start')
  oauthStart(@Param('provider') provider: string) {
    return this.oauth.start(provider);
  }

  @Get('oauth/:provider/link/start')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  oauthLinkStart(@Param('provider') provider: string, @Req() req: any) {
    return this.oauth.start(provider, req.user.id);
  }

  @Get('oauth/:provider/callback')
  async oauthCallback(@Param('provider') provider: string, @Query('code') code: string, @Query('state') state: string, @Res() response: any) {
    const result = await this.oauth.callback(provider, code, state);
    const frontend = (process.env.FRONTEND_URL || 'http://localhost:3001').split(',')[0];
    const destination = result.link ? '/customer/profile?identity_linked=1' : `/auth/login?oauth_code=${encodeURIComponent(result.exchangeCode)}`;
    return response.redirect(`${frontend}${destination}`);
  }

  @Post('oauth/exchange')
  async oauthExchange(@Body() body: { code: string }, @Res({ passthrough: true }) response: any) {
    const result = await this.oauth.exchangeCode(body.code);
    this.setRefreshCookie(response, result.refreshToken);
    return result;
  }

  @Post('register')
  register(
    @Body()
    body: {
      phone: string;
      firstName: string;
      lastName: string;
      email?: string;
      role?: UserRole;
      password?: string;
      vehicleType?: string;
      plateNumber?: string;
      licenseNumber?: string;
      preferredZoneId?: string;
    },
  ) {
    return this.authService.register(body);
  }

  @Post('login')
  async login(
    @Body()
    body: { email?: string; phone?: string; identifier?: string; password: string; merchantCode?: string; merchant_code?: string }, @Res({ passthrough: true }) response: any,
  ) {
    const identifier = body.email ?? body.phone ?? body.identifier ?? '';
    const result = await this.authService.loginWithPassword(identifier, body.password, body.merchantCode ?? body.merchant_code);
    this.setRefreshCookie(response, result.refreshToken);
    return result;
  }

  @Post('shop-login')
  shopLogin(@Body() body: { shopId?: string; shop_id?: string; passkey: string }) {
    return this.authService.loginShop(body.shopId ?? body.shop_id ?? '', body.passkey);
  }

  @Post('refresh')
  async refresh(@Body() body: { refreshToken?: string }, @Req() req: any, @Res({ passthrough: true }) response: any) {
    const cookieToken = this.readCookie(req.headers?.cookie, 'wk_refresh_token');
    const result = await this.authService.refreshToken(body.refreshToken || cookieToken || '');
    this.setRefreshCookie(response, result.refreshToken);
    return result;
  }

  private requestContext(req: any) {
    const forwarded = req.headers?.['x-forwarded-for'];
    return {
      ip: typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.ip,
      device: req.headers?.['x-device-id'] || req.headers?.['user-agent'],
    };
  }

  private setRefreshCookie(response: any, refreshToken: string) {
    response.cookie('wk_refresh_token', refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth', maxAge: 30 * 24 * 60 * 60 * 1000 });
  }

  private readCookie(header: string | undefined, name: string) {
    if (!header) return undefined;
    const item = header.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
    return item ? decodeURIComponent(item.slice(name.length + 1)) : undefined;
  }
}
