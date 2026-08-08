import { Injectable, UnauthorizedException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { OtpChannel, OtpDeliveryError, OtpDeliveryService } from './otp-delivery.service';
import { UserRole } from '@prisma/client';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly otpDelivery: OtpDeliveryService,
    private readonly prisma: PrismaService,
  ) {}

  static normalizePhilippineMobile(value: string): string {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('0063')) digits = digits.slice(2);
    if (digits.startsWith('09')) digits = `63${digits.slice(1)}`;
    else if (digits.startsWith('9')) digits = `63${digits}`;
    if (!/^639\d{9}$/.test(digits)) throw new BadRequestException('Enter a valid Philippine mobile number.');
    return `+${digits}`;
  }

  private hash(value: string) {
    return createHash('sha256').update(`${process.env.OTP_HASH_SECRET || process.env.JWT_SECRET || 'development-only'}:${value}`).digest('hex');
  }

  private contextHashes(context: { ip?: string; device?: string } = {}) {
    return { ipHash: context.ip ? this.hash(context.ip) : undefined, deviceHash: context.device ? this.hash(context.device) : undefined };
  }

  async sendOtp(phoneInput: string, context: { ip?: string; device?: string; targetUserId?: string } = {}) {
    const phone = AuthService.normalizePhilippineMobile(phoneInput);
    const existing = await this.usersService.findByPhone(phone);
    if (existing?.password && !context.targetUserId) {
      throw new BadRequestException('This mobile number is already registered. Sign in with your mobile number and password.');
    }
    return this.createOtpChallenge(phone, 'viber', context);
  }

  private async createOtpChallenge(phone: string, channel: OtpChannel, context: { ip?: string; device?: string; targetUserId?: string } = {}, resendCount = 0) {
    const now = new Date();
    const since = new Date(now.getTime() - 10 * 60_000);
    const hashes = this.contextHashes(context);
    const [phoneCount, ipCount, deviceCount, latest] = await Promise.all([
      this.prisma.otpChallenge.count({ where: { phone, createdAt: { gte: since } } }),
      hashes.ipHash ? this.prisma.otpChallenge.count({ where: { ipHash: hashes.ipHash, createdAt: { gte: since } } }) : 0,
      hashes.deviceHash ? this.prisma.otpChallenge.count({ where: { deviceHash: hashes.deviceHash, createdAt: { gte: since } } }) : 0,
      this.prisma.otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } }),
    ]);
    if (phoneCount >= 5 || ipCount >= 20 || deviceCount >= 10) throw new HttpException('Too many verification requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    if (latest?.cooldownUntil && latest.cooldownUntil > now) throw new HttpException('Please wait before requesting another code.', HttpStatus.TOO_MANY_REQUESTS);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.otpChallenge.updateMany({ where: { phone, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } });
    const challenge = await this.prisma.otpChallenge.create({ data: {
      id: randomUUID(), phone, codeHash: this.hash(code), channel, purpose: context.targetUserId ? 'link_mobile' : 'customer_auth',
      targetUserId: context.targetUserId, resendCount, ...hashes,
      expiresAt: new Date(now.getTime() + 5 * 60_000), cooldownUntil: new Date(now.getTime() + 60_000),
    } });

    let delivered = true;
    try { await this.otpDelivery.send(channel, phone, code); } catch (error) { if (!(error instanceof OtpDeliveryError)) throw error; delivered = false; await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { cooldownUntil: now } }); }
    await this.audit('otp_requested', delivered, undefined, hashes, { channel });
    const user = await this.usersService.findByPhone(phone);
    return {
      challengeId: challenge.id, maskedPhone: `+63 ••• ••• ${phone.slice(-4)}`, isNewUser: !user, channel,
      deliveryStatus: delivered ? 'sent' : 'unavailable',
      message: delivered ? `Verification code sent via ${channel === 'sms' ? 'SMS' : channel === 'viber' ? 'Viber' : 'WhatsApp'}.` : `${channel === 'viber' ? 'Viber' : channel} is currently unavailable. Choose another delivery option.`,
      fallbackChannels: channel === 'viber' ? ['sms', 'whatsapp'] : channel === 'sms' ? ['whatsapp'] : [],
    };
  }

  async resendOtp(challengeId: string, channel: OtpChannel, context: { ip?: string; device?: string } = {}) {
    if (!['sms', 'whatsapp'].includes(channel)) throw new BadRequestException('Choose SMS or WhatsApp.');
    const previous = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!previous) throw new BadRequestException('Verification request not found.');
    if (previous.resendCount >= 3) throw new HttpException('Resend limit reached. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    return this.createOtpChallenge(previous.phone, channel, { ...context, targetUserId: previous.targetUserId || undefined }, previous.resendCount + 1);
  }

  async verifyOtp(challengeId: string, code: string, context: { ip?: string; device?: string } = {}) {
    if (!/^\d{6}$/.test(code || '')) throw new BadRequestException('Enter the six-digit verification code.');
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.invalidatedAt || challenge.consumedAt) throw new BadRequestException('This verification code is no longer valid. Request a new code.');
    if (challenge.expiresAt <= new Date()) throw new BadRequestException('This verification code has expired. Request a new code.');
    if (challenge.attempts >= challenge.maxAttempts) throw new HttpException('Too many incorrect attempts. Request a new code.', HttpStatus.TOO_MANY_REQUESTS);
    const actual = Buffer.from(this.hash(code));
    const expected = Buffer.from(challenge.codeHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      const attempts = challenge.attempts + 1;
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts, ...(attempts >= challenge.maxAttempts ? { invalidatedAt: new Date() } : {}) } });
      await this.audit('otp_verified', false, challenge.targetUserId || undefined, this.contextHashes(context), { reason: 'invalid_code' });
      throw new UnauthorizedException(attempts >= challenge.maxAttempts ? 'Too many incorrect attempts. Request a new code.' : 'That verification code is incorrect.');
    }
    await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

    const phone = challenge.phone;
    let user = challenge.targetUserId ? await this.usersService.findById(challenge.targetUserId) : await this.usersService.findByPhone(phone);
    const isNewUser = !user;
    if (!user) {
      user = await this.usersService.create({
        phone,
        role: UserRole.customer,
        isVerified: true,
      });
    } else {
      if (!user.isActive) {
        throw new UnauthorizedException(
          'Your account has been suspended. Please contact support.',
        );
      }
      const phoneOwner = await this.usersService.findByPhone(phone);
      if (phoneOwner && phoneOwner.id !== user.id) throw new BadRequestException('This mobile number is already connected to another account. Sign in to that account to link another method.');
      user = await this.usersService.update(user.id, { phone, isVerified: true });
    }
    await this.audit('otp_verified', true, user.id, this.contextHashes(context), { channel: challenge.channel });
    const tokens = this.generateTokens(user.id, user.role);
    return {
      user: this.decorateUser(user),
      isNewUser,
      needsProfile: !user.firstName || !user.lastName || !user.password,
      ...tokens,
    };
  }

  async completeCustomerProfile(userId: string, data: { firstName: string; lastName: string; email?: string; password: string }) {
    const firstName = data.firstName?.trim(); const lastName = data.lastName?.trim(); const email = data.email?.trim().toLowerCase() || undefined;
    if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) throw new BadRequestException('First name and last name are required.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Enter a valid email address.');
    if (!data.password || data.password.length < 8) throw new BadRequestException('Create a password with at least 8 characters.');
    const existing = email ? await this.usersService.findByEmail(email) : null;
    if (existing && existing.id !== userId) throw new BadRequestException('That email address is already in use.');
    const user = await this.usersService.update(userId, { firstName, lastName, email, password: await bcrypt.hash(data.password, 12) });
    await this.audit('profile_completed', true, userId);
    return { user: this.decorateUser(user) };
  }

  private async audit(event: string, success: boolean, userId?: string, hashes: { ipHash?: string; deviceHash?: string } = {}, metadata?: Record<string, unknown>) {
    try { await this.prisma.authAuditLog.create({ data: { id: randomUUID(), event, success, userId, ...hashes, metadata: metadata as any } }); } catch { /* Authentication must not fail because audit storage is temporarily unavailable. */ }
  }

  async register(data: {
    phone?: string;
    firstName: string;
    lastName: string;
    email?: string;
    role?: UserRole;
    password?: string;
    vehicleType?: string;
    plateNumber?: string;
    licenseNumber?: string;
    preferredZoneId?: string;
  }) {
    const email = data.email?.trim().toLowerCase();

    // Find an existing account by whichever identifier was supplied.
    let existing = email ? await this.usersService.findByEmail(email) : null;
    if (!existing && data.phone) {
      existing = await this.usersService.findByPhone(data.phone);
    }

    if (existing) {
      // Account exists but never finished onboarding → complete it.
      if (!existing.firstName) {
        const updated = await this.usersService.update(existing.id, {
          firstName: data.firstName,
          lastName: data.lastName,
          email: email ?? existing.email,
          role: data.role || existing.role,
          vehicleType: data.vehicleType,
          plateNumber: data.plateNumber,
          licenseNumber: data.licenseNumber,
          ...(data.preferredZoneId
            ? { preferredZone: { connect: { id: data.preferredZoneId } } }
            : {}),
          password: data.password
            ? await bcrypt.hash(data.password, 10)
            : undefined,
        });
        const tokens = this.generateTokens(updated.id, updated.role);
        return { user: this.decorateUser(updated), ...tokens };
      }
      throw new BadRequestException(
        email && existing.email === email
          ? 'Email already registered'
          : 'Account already registered',
      );
    }

    // `phone` is a required unique column. Email-only signups (no phone field
    // on the form) get a synthetic placeholder so the constraint is satisfied.
    const phone = data.phone?.trim() || `email:${email ?? randomUUID()}`;

    // Riders must be reviewed/approved by an admin before they can operate.
    const isRider =
      data.role === UserRole.rider || data.role === UserRole.driver;

    const user = await this.usersService.create({
      phone,
      email,
      firstName: data.firstName,
      lastName: data.lastName,
      vehicleType: data.vehicleType,
      plateNumber: data.plateNumber,
      licenseNumber: data.licenseNumber,
      ...(isRider && data.preferredZoneId
        ? { preferredZone: { connect: { id: data.preferredZoneId } } }
        : {}),
      password: data.password
        ? await bcrypt.hash(data.password, 10)
        : undefined,
      role: data.role || UserRole.customer,
      status: isRider ? 'pending' : 'active',
    });

    const tokens = this.generateTokens(user.id, user.role);
    return { user: this.decorateUser(user), ...tokens };
  }

  /** Accepts an email or phone identifier + password. */
  async loginWithPassword(identifier: string, password: string, merchantCode?: string) {
    const id = identifier?.trim();
    if (!id || !password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    let user;
    if (/^WKC-\d+$/i.test(id)) {
      const coordinator = await this.prisma.coordinatorApplication.findUnique({
        where: { coordinatorCode: id.toUpperCase() },
        select: { userId: true },
      });
      user = coordinator?.userId ? await this.prisma.user.findUnique({ where: { id: coordinator.userId } }) : null;
      if (user?.role !== UserRole.coordinator) user = null;
    } else {
      const looksLikePhone = /^\+?[\d\s()-]{10,}$/.test(id);
      let normalizedPhone = id;
      if (looksLikePhone) {
        try { normalizedPhone = AuthService.normalizePhilippineMobile(id); } catch { throw new UnauthorizedException('Invalid credentials'); }
      }
      user = looksLikePhone
        ? await this.usersService.findByPhone(normalizedPhone)
        : (await this.usersService.findByEmail(id.toLowerCase())) ?? (await this.usersService.findByPhone(id));
    }

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Your account has been suspended. Please contact support.',
      );
    }

    if (user.role === UserRole.coordinator) {
      const coordinator = await this.prisma.coordinatorApplication.findUnique({ where: { userId: user.id } });
      if (coordinator?.temporaryCredentialExpiresAt && coordinator.temporaryCredentialExpiresAt <= new Date()) {
        throw new UnauthorizedException('Temporary coordinator credentials expired. Ask an administrator for a new reset key.');
      }
    }

    if (user.role === UserRole.merchant) {
      const code = merchantCode?.trim().toUpperCase();
      if (!code) {
        throw new UnauthorizedException('Merchant code is required');
      }
      const merchant = await this.prisma.merchant.findFirst({
        // `isActive` controls marketplace visibility and is set to false when a
        // daily-plan wallet cannot cover the subscription fee. Owners must
        // still be able to enter the portal to fund and manage their account.
        where: { userId: user.id, merchantCode: code },
      });
      if (!merchant) {
        throw new UnauthorizedException('Invalid merchant code');
      }
      if (merchant.status === 'suspended' || merchant.status === 'deactivated') {
        throw new UnauthorizedException(
          'This merchant account has been suspended or deactivated. Please contact support.',
        );
      }
    }

    const tokens = this.generateTokens(user.id, user.role);
    return { user: this.decorateUser(user), ...tokens };
  }

  async loginShop(shopId: string, passkey: string) {
    const normalizedShopId = shopId?.trim().toUpperCase();
    if (!normalizedShopId || !passkey) throw new UnauthorizedException('Invalid shop credentials');

    const branch = await this.prisma.branch.findUnique({
      where: { shopId: normalizedShopId },
      include: { merchant: true },
    });
    const merchantUser = branch?.merchant.userId
      ? await this.prisma.user.findUnique({ where: { id: branch.merchant.userId } })
      : null;
    if (
      !branch ||
      !branch.passkey ||
      branch.passkey !== passkey.trim() ||
      !branch.passkeyExpiresAt ||
      branch.passkeyExpiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Invalid or expired shop credentials');
    }
    if (['suspended', 'deactivated'].includes(branch.merchant.status.toLowerCase())) {
      throw new UnauthorizedException('This shop is currently unavailable');
    }
    if (!branch.isActive) {
      throw new UnauthorizedException(
        branch.merchant.subscriptionStatus.toLowerCase() === 'inactive'
          ? 'Shop access is inactive. Reload the merchant wallet to cover the subscription fee.'
          : 'This shop is inactive. Ask your merchant administrator to reactivate it.',
      );
    }
    if (!merchantUser || !merchantUser.isActive) {
      throw new UnauthorizedException('The merchant account is inactive. Please contact support.');
    }

    const tokens = this.generateTokens(merchantUser.id, UserRole.merchant, {
      portal: 'shop',
      merchantId: branch.merchantId,
      branchId: branch.id,
      shopId: branch.shopId,
    });
    return {
      user: this.decorateUser(merchantUser),
      shop: {
        id: branch.id,
        shop_id: branch.shopId,
        name: branch.name,
        branch_name: branch.name,
        merchant_id: branch.merchantId,
        merchant_name: branch.merchant.name,
        is_default: branch.isDefault,
      },
      ...tokens,
    };
  }

  private generateTokens(userId: string, role: UserRole, context: Record<string, unknown> = {}) {
    const payload = { sub: userId, role, ...context };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '30d' });
    // Provide both camelCase and snake_case so every client shape works.
    return {
      accessToken,
      refreshToken,
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  createSession(user: any) {
    return { user: this.decorateUser(user), needsMobileVerification: !user.isVerified || String(user.phone).startsWith('oauth:'), needsProfile: !user.firstName || !user.lastName || !user.password, ...this.generateTokens(user.id, user.role) };
  }

  /** Expose the role as `userType` so the frontend role-gating works as-is. */
  decorateUser<T extends { role?: UserRole } | null>(user: T): T {
    if (!user) return user;
    // Never leak the password hash to clients.
    const { password, ...safe } = user as any;
    return { ...safe, userType: (user as any).role } as T;
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await this.usersService.findById(payload.sub);
      if (!user.isActive) throw new UnauthorizedException('Account is inactive');
      return this.createSession(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
