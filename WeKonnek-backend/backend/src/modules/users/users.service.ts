import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { User, UserRole, Prisma } from '@prisma/client';

/** Remove the password hash before returning a user to any client. */
function sanitize<T extends { password?: string | null }>(user: T): Omit<T, 'password'> {
  const { password: _password, ...rest } = user;
  return rest;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(role?: UserRole): Promise<any[]> {
    const where: Prisma.UserWhereInput = {};
    if (role) where.role = role;

    // Riders/drivers carry their zone assignments; flatten the join table into
    // a simple `zoneIds` array so clients don't have to know about it.
    const isRider = role === UserRole.rider || role === UserRole.driver;
    if (isRider) {
      const users = await this.prisma.user.findMany({
        where,
        include: { zones: { select: { zoneId: true } } },
      });
      return users.map((u) => {
        const { zones, ...rest } = u as any;
        return { ...rest, zoneIds: zones.map((z: { zoneId: string }) => z.zoneId) };
      });
    }

    return this.prisma.user.findMany({ where });
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { email } });
  }

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  /**
   * Admin rider-management action: move a rider through its lifecycle
   * (pending → approved / rejected, or approved ↔ suspended). Keeps the
   * `isActive`/`isVerified` flags in sync so login-gating stays correct.
   */
  async setRiderStatus(
    id: string,
    status: string,
    zoneIds?: string[],
  ): Promise<Omit<User, 'password'>> {
    const normalized = (status || '').toLowerCase();
    const allowed = ['pending', 'approved', 'suspended', 'rejected'];
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(
        "Invalid status. Use one of: pending, approved, suspended, rejected.",
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Rider not found');

    const data: Prisma.UserUpdateInput = { status: normalized };
    if (normalized === 'approved') {
      data.isActive = true;
      data.isVerified = true;
    } else if (normalized === 'suspended' || normalized === 'rejected') {
      data.isActive = false;
    } else if (normalized === 'pending') {
      data.isActive = true;
    }

    const updated = await this.prisma.user.update({ where: { id }, data });

    // Admins can confirm the rider's operating zones as part of approval.
    if (Array.isArray(zoneIds)) {
      await this.setRiderZones(id, zoneIds);
    }

    return sanitize(updated);
  }

  /**
   * Self-service profile update. Accepts both snake_case (from the web/PWA
   * clients) and camelCase, and only allows a safe set of fields — never role,
   * password, wallet, verification, etc.
   */
  async updateProfile(id: string, data: Record<string, any>): Promise<Omit<User, 'password'>> {
    const allowed: Prisma.UserUpdateInput = {};
    const firstName = data.firstName ?? data.first_name;
    const lastName = data.lastName ?? data.last_name;
    const phone = data.phone;
    const avatar = data.avatar;

    if (firstName !== undefined) allowed.firstName = firstName;
    if (lastName !== undefined) allowed.lastName = lastName;
    if (avatar !== undefined) allowed.avatar = avatar;
    if (phone !== undefined && phone !== '') {
      const existing = await this.prisma.user.findUnique({ where: { phone } });
      if (existing && existing.id !== id) {
        throw new BadRequestException('That phone number is already in use.');
      }
      allowed.phone = phone;
    }

    const user = await this.prisma.user.update({ where: { id }, data: allowed });
    return sanitize(user);
  }

  /** Change the current user's password after verifying the existing one. */
  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters.');
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (user.password) {
      const matches = await bcrypt.compare(currentPassword || '', user.password);
      if (!matches) throw new UnauthorizedException('Current password is incorrect.');
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id }, data: { password: hashed } });
    return { success: true };
  }

  async updateLocation(id: string, lat: number, lng: number): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { currentLat: lat, currentLng: lng },
    });
  }

  async setOnline(id: string, isOnline: boolean): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { isOnline } });
  }

  async getOnlineRiders(): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { role: UserRole.rider, isOnline: true },
    });
  }

  async getOnlineDrivers(): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { role: UserRole.driver, isOnline: true },
    });
  }

  /** Replace a rider's entire set of zones with the given list (admin). */
  async setRiderZones(userId: string, zoneIds: string[]): Promise<{ zoneIds: string[] }> {
    await this.findById(userId);
    const unique = [...new Set((zoneIds || []).filter(Boolean))];

    await this.prisma.$transaction([
      this.prisma.riderZone.deleteMany({ where: { riderId: userId } }),
      ...(unique.length
        ? [
            this.prisma.riderZone.createMany({
              data: unique.map((zoneId) => ({ riderId: userId, zoneId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);

    return { zoneIds: unique };
  }

  /** Add a single zone to a rider (idempotent). */
  async addRiderZone(userId: string, zoneId: string): Promise<{ zoneIds: string[] }> {
    await this.findById(userId);
    if (!zoneId) throw new BadRequestException('zoneId is required');
    await this.prisma.riderZone.upsert({
      where: { riderId_zoneId: { riderId: userId, zoneId } },
      create: { riderId: userId, zoneId },
      update: {},
    });
    return this.getRiderZoneIds(userId);
  }

  /** Remove a single zone from a rider. */
  async removeRiderZone(userId: string, zoneId: string): Promise<{ zoneIds: string[] }> {
    await this.prisma.riderZone.deleteMany({ where: { riderId: userId, zoneId } });
    return this.getRiderZoneIds(userId);
  }

  private async getRiderZoneIds(userId: string): Promise<{ zoneIds: string[] }> {
    const rows = await this.prisma.riderZone.findMany({
      where: { riderId: userId },
      select: { zoneId: true },
    });
    return { zoneIds: rows.map((r) => r.zoneId) };
  }

  async findAvailableRidersByZone(zoneId: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: {
        role: UserRole.rider,
        isOnline: true,
        zones: { some: { zoneId } },
      },
    });
  }

  // ─── Two-Factor Authentication ─────────────────────────

  async get2faStatus(userId: string) {
    const user = await this.findById(userId);
    return { enabled: user.twoFactorEnabled };
  }

  async setup2fa(userId: string) {
    const user = await this.findById(userId);
    const label = user.email || user.phone;
    const secret = speakeasy.generateSecret({
      name: `WeKonnek:${label}`,
      issuer: 'WeKonnek',
    });

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url!);

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret.base32, twoFactorEnabled: false },
    });

    return { secret: secret.base32, otpauthUrl: secret.otpauth_url, qrDataUrl };
  }

  async verify2fa(userId: string, token: string) {
    const user = await this.findById(userId);
    if (!user.twoFactorSecret) {
      throw new BadRequestException('2FA has not been set up. Call setup first.');
    }
    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!isValid) {
      throw new BadRequestException('Invalid verification code. Please try again.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });
    return { enabled: true };
  }

  async disable2fa(userId: string, token: string) {
    const user = await this.findById(userId);
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('2FA is not currently enabled.');
    }
    const isValid = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!isValid) {
      throw new BadRequestException('Invalid verification code.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: null, twoFactorEnabled: false },
    });
    return { enabled: false };
  }
}
