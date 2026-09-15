import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthActor, resolveActorTypeFromRoles } from './fulfillment-authorization';

/** Resolves request identity from persisted relationships; never from request body. */
@Injectable()
export class AuthActorService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: { id?: string; role?: string } | undefined): Promise<AuthActor & { actorMerchantIds: number[]; merchantOwnerUserId?: string | null }> {
    if (!user?.id) throw new UnauthorizedException();
    const [persisted, owned, staff] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id }, select: { role: true } }),
      this.prisma.merchant.findMany({ where: { userId: user.id }, select: { id: true } }),
      this.prisma.merchantStaff.findMany({ where: { userId: user.id, isActive: true }, select: { merchantId: true, role: true } }),
    ]);
    if (!persisted) throw new UnauthorizedException();
    const staffRole = staff[0]?.role ?? null;
    return {
      id: user.id,
      type: resolveActorTypeFromRoles({ userRole: persisted.role, merchantStaffRole: staffRole }),
      merchantStaffRole: staffRole as AuthActor['merchantStaffRole'],
      actorMerchantIds: [...new Set([...owned.map((x) => x.id), ...staff.map((x) => x.merchantId)])],
      merchantOwnerUserId: owned.length ? user.id : null,
    };
  }
}
