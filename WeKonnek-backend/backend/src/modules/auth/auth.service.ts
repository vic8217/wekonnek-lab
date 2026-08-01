import { Injectable, UnauthorizedException, BadRequestException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { SmsService } from './sms.service';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  private readonly redis: Redis;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly smsService: SmsService,
    private readonly prisma: PrismaService,
  ) {
    // Connect to Redis for OTP storage (scalable, persistent across restarts)
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      keyPrefix: 'otp:',
    });
  }

  private get isDev(): boolean {
    return (process.env.NODE_ENV || 'development') !== 'production';
  }

  async sendOtp(
    phone: string,
    role?: UserRole,
  ): Promise<{ message: string; isNewUser: boolean; devOtp?: string }> {
    const code = this.isDev
      ? '123456'
      : Math.floor(100000 + Math.random() * 900000).toString();

    await this.redis.set(phone, code, 'EX', 300);

    if (!this.isDev) {
      await this.smsService.sendSms(
        phone,
        `Your WeKonnek verification code is: ${code}. Valid for 5 minutes.`,
      );
    }

    const user = await this.usersService.findByPhone(phone);
    return {
      message: this.isDev
        ? 'OTP sent (dev mode — use 123456)'
        : 'OTP sent successfully',
      isNewUser: !user,
      ...(this.isDev ? { devOtp: code } : {}),
    };
  }

  async verifyOtp(
    phone: string,
    code: string,
    role: UserRole = UserRole.customer,
  ) {
    const stored = await this.redis.get(phone);

    if (!stored) {
      throw new BadRequestException('OTP not found or expired. Please request a new one.');
    }

    if (stored !== code) {
      throw new UnauthorizedException('Invalid OTP');
    }

    await this.redis.del(phone);

    // Find or create user
    let user = await this.usersService.findByPhone(phone);
    const isNewUser = !user;

    if (!user) {
      user = await this.usersService.create({
        phone,
        role,
        isVerified: true,
      });
    } else {
      if (!user.isActive) {
        throw new UnauthorizedException(
          'Your account has been suspended. Please contact support.',
        );
      }
      await this.usersService.update(user.id, { isVerified: true });
    }

    const tokens = this.generateTokens(user.id, user.role);
    return {
      user: this.decorateUser(user),
      isNewUser,
      ...tokens,
    };
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
      user =
        (await this.usersService.findByEmail(id.toLowerCase())) ??
        (await this.usersService.findByPhone(id));
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

  private generateTokens(userId: string, role: UserRole) {
    const payload = { sub: userId, role };
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
      return this.generateTokens(user.id, user.role);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
