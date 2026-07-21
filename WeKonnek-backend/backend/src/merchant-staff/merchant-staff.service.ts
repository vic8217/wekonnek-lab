import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function serializeStaff(s: any) {
  if (!s) return s;
  return {
    ...s,
    merchant_id: s.merchantId,
    user_id: s.userId,
    branch_id: s.branchId,
    is_active: s.isActive,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

@Injectable()
export class MerchantStaffService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByMerchant(merchantId: number) {
    const staff = await this.prisma.merchantStaff.findMany({
      where: { merchantId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return staff.map(serializeStaff);
  }

  async addStaff(merchantId: number, input: any) {
    const userId = input.userId ?? input.user_id;
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    const phone = typeof input.phone === 'string' ? input.phone.trim() : '';

    let resolvedUserId = userId;

    if (!resolvedUserId && (email || phone)) {
      let user: { id: string } | null = null;

      if (email) {
        user = await this.prisma.user.findFirst({ where: { email } });
      }

      if (!user && phone) {
        const candidates = this.buildPhoneCandidates(phone);
        user = await this.prisma.user.findFirst({
          where: { phone: { in: candidates } },
        });
      }

      if (!user) {
        throw new NotFoundException(
          email && phone
            ? 'No user found with that email or phone number'
            : email
              ? 'No user found with that email address'
              : 'No user found with that phone number',
        );
      }
      resolvedUserId = user.id;
    }

    if (!resolvedUserId) {
      throw new BadRequestException(
        "Provide the staff member's email, phone number, or userId",
      );
    }

    const existing = await this.prisma.merchantStaff.findUnique({
      where: { merchantId_userId: { merchantId, userId: resolvedUserId } },
    });
    if (existing) throw new ConflictException('This user is already a staff member');

    const data: any = {
      merchantId,
      userId: resolvedUserId,
      role: input.role || 'staff',
    };

    const branchId = input.branchId ?? input.branch_id;
    if (branchId) data.branchId = Number(branchId);

    const record = await this.prisma.merchantStaff.create({
      data,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true } },
        branch: { select: { id: true, name: true } },
      },
    });
    return serializeStaff(record);
  }

  async update(id: number, input: any) {
    const existing = await this.prisma.merchantStaff.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Staff record not found');

    const data: any = {};
    if (input.role !== undefined) data.role = input.role;
    if (input.branchId !== undefined || input.branch_id !== undefined)
      data.branchId = input.branchId ?? input.branch_id;
    if (input.is_active !== undefined || input.isActive !== undefined)
      data.isActive = input.is_active ?? input.isActive;

    const record = await this.prisma.merchantStaff.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatar: true } },
        branch: { select: { id: true, name: true } },
      },
    });
    return serializeStaff(record);
  }

  async remove(id: number) {
    const existing = await this.prisma.merchantStaff.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Staff record not found');

    await this.prisma.merchantStaff.delete({ where: { id } });
    return { message: 'Staff member removed' };
  }

  /**
   * Build the set of plausible stored formats for a PH phone number so a
   * merchant can type it however they like (e.g. 0917…, 917…, +63917…, 63917…)
   * and still match the account, which is stored in `+63…` form after OTP signup.
   */
  private buildPhoneCandidates(raw: string): string[] {
    const trimmed = raw.trim();
    const digits = trimmed.replace(/\D/g, '');
    const set = new Set<string>();

    if (trimmed) set.add(trimmed);
    if (digits) {
      set.add(digits);
      set.add(`+${digits}`);

      // 11-digit local form: 0917xxxxxxx
      if (digits.length === 11 && digits.startsWith('0')) {
        set.add(`+63${digits.slice(1)}`);
        set.add(`63${digits.slice(1)}`);
      }
      // 10-digit form without leading 0: 917xxxxxxx
      if (digits.length === 10 && digits.startsWith('9')) {
        set.add(`+63${digits}`);
        set.add(`63${digits}`);
        set.add(`0${digits}`);
      }
      // Country-code form: 63917xxxxxxx
      if (digits.startsWith('63')) {
        set.add(`+${digits}`);
        set.add(`0${digits.slice(2)}`);
      }
    }

    return Array.from(set);
  }
}
