import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { UserRole } from '@prisma/client';

@Injectable()
export class CoordinatorApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: Record<string, unknown>) {
    const required = ['fullName', 'mobileNumber', 'email', 'region', 'provinceDistrict', 'cityMunicipality', 'latitude', 'longitude'];
    for (const field of required) {
      if (input[field] === undefined || input[field] === '') throw new BadRequestException(`${field} is required`);
    }
    return this.prisma.coordinatorApplication.create({
      data: {
        fullName: String(input.fullName), mobileNumber: String(input.mobileNumber),
        viberAccount: input.viberAccount ? String(input.viberAccount) : null,
        whatsappNumber: input.whatsappNumber ? String(input.whatsappNumber) : null,
        email: String(input.email).trim().toLowerCase(),
        region: String(input.region), provinceDistrict: String(input.provinceDistrict), cityMunicipality: String(input.cityMunicipality),
        councilDistrict: input.councilDistrict ? String(input.councilDistrict) : null,
        barangay: input.barangay ? String(input.barangay) : null,
        preferredCoverageArea: input.preferredCoverageArea ? String(input.preferredCoverageArea) : null,
        latitude: Number(input.latitude), longitude: Number(input.longitude),
        background: input.background ? String(input.background) : null, occupation: input.occupation ? String(input.occupation) : null,
        motivation: input.motivation ? String(input.motivation) : null, monthlyCapacity: input.monthlyCapacity ? String(input.monthlyCapacity) : null,
        referred: input.referred ? String(input.referred) : null,
        governmentIdFrontUrl: input.governmentIdFrontUrl ? String(input.governmentIdFrontUrl) : null,
        governmentIdBackUrl: input.governmentIdBackUrl ? String(input.governmentIdBackUrl) : null,
        resumeUrl: input.resumeUrl ? String(input.resumeUrl) : null,
        supportingDocumentUrl: input.supportingDocumentUrl ? String(input.supportingDocumentUrl) : null,
      },
    });
  }

  async findAll() {
    return this.prisma.coordinatorApplication.findMany({
      include: { managementZone: { include: { coverages: true } } },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async stats() {
    const [applicants, pending, approved, activeAreas] = await Promise.all([
      this.prisma.coordinatorApplication.count(),
      this.prisma.coordinatorApplication.count({ where: { status: 'pending' } }),
      this.prisma.coordinatorApplication.count({ where: { status: 'approved' } }),
      this.prisma.coordinatorApplication.findMany({ where: { status: 'approved', managementZoneId: { not: null } }, distinct: ['managementZoneId'], select: { managementZoneId: true } }),
    ]);
    return { applicants, pending, coordinators: approved, activeCoverageAreas: activeAreas.length };
  }

  async updateStatus(id: number, status: string, managementZoneId?: string | null) {
    if (!['pending', 'approved', 'rejected'].includes(status)) throw new BadRequestException('Invalid coordinator application status');
    if (status === 'approved' && !managementZoneId) throw new BadRequestException('Assign a coordinator zone before approval');
    if (managementZoneId) {
      const zone = await this.prisma.managementZone.findUnique({ where: { id: managementZoneId } });
      if (!zone || !zone.isActive) throw new BadRequestException('Select an active coordinator zone');
    }
    if (status !== 'approved') {
      return this.prisma.coordinatorApplication.update({
        where: { id },
        data: { status, managementZoneId: null },
        include: { managementZone: { include: { coverages: true } } },
      });
    }
    const existing = await this.prisma.coordinatorApplication.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Coordinator application not found');
    if (existing.status === 'approved' && existing.userId) throw new BadRequestException('Coordinator is already approved');

    const coordinatorCode = existing.coordinatorCode || `WKC-${String(id).padStart(6, '0')}`;
    const temporaryPassword = `Wk!${randomBytes(9).toString('base64url')}`;
    const password = await bcrypt.hash(temporaryPassword, 10);
    const resetKey = `WKR-${randomBytes(18).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const resetTokenHash = createHash('sha256').update(resetKey).digest('hex');
    const names = existing.fullName.trim().split(/\s+/);
    const firstName = names.shift() || 'Coordinator';
    const lastName = names.join(' ') || null;
    const application = await this.prisma.$transaction(async tx => {
      const matchingUser = await tx.user.findFirst({
        where: { OR: [{ email: existing.email }, { phone: existing.mobileNumber }] },
      });
      const user = matchingUser
        ? await tx.user.update({
            where: { id: matchingUser.id },
            data: { firstName, lastName, email: existing.email, phone: existing.mobileNumber, password, role: UserRole.coordinator, isActive: true, isVerified: true, status: 'active' },
          })
        : await tx.user.create({
            data: { firstName, lastName, email: existing.email, phone: existing.mobileNumber, password, role: UserRole.coordinator, isActive: true, isVerified: true, status: 'active' },
          });
      return tx.coordinatorApplication.update({
        where: { id },
        data: { status: 'approved', managementZoneId, coordinatorCode, userId: user.id, resetTokenHash, resetTokenExpiresAt: expiresAt, temporaryCredentialExpiresAt: expiresAt },
        include: { managementZone: { include: { coverages: true } } },
      });
    });
    return { ...application, credentials: { applicationId: id, coordinatorCode, email: existing.email, temporaryPassword, resetKey, expiresAt, viberAccount: existing.viberAccount, whatsappNumber: existing.whatsappNumber } };
  }

  async suspend(id: number) {
    const application = await this.prisma.coordinatorApplication.findUnique({ where: { id } });
    if (!application?.userId) throw new BadRequestException('Approved coordinator account not found');
    return this.prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: application.userId! }, data: { isActive: false, status: 'suspended' } });
      return tx.coordinatorApplication.update({
        where: { id }, data: { status: 'suspended', resetTokenHash: null, resetTokenExpiresAt: null },
        include: { managementZone: { include: { coverages: true } } },
      });
    });
  }

  async generateResetKey(id: number) {
    const application = await this.prisma.coordinatorApplication.findUnique({ where: { id } });
    if (!application?.userId || !application.coordinatorCode) throw new BadRequestException('Approved coordinator account not found');
    const resetKey = `WKR-${randomBytes(18).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.prisma.coordinatorApplication.update({
      where: { id },
      data: { resetTokenHash: createHash('sha256').update(resetKey).digest('hex'), resetTokenExpiresAt: expiresAt },
    });
    return { resetKey, coordinatorCode: application.coordinatorCode, expiresAt };
  }

  async resetPassword(resetKey: string, newPassword: string) {
    if (!resetKey || newPassword.length < 8) throw new BadRequestException('A valid reset key and password of at least 8 characters are required');
    const resetTokenHash = createHash('sha256').update(resetKey).digest('hex');
    const application = await this.prisma.coordinatorApplication.findFirst({
      where: { resetTokenHash, resetTokenExpiresAt: { gt: new Date() }, userId: { not: null }, status: 'approved' },
    });
    if (!application?.userId) throw new BadRequestException('Reset key is invalid or expired');
    const password = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: application.userId }, data: { password } }),
      this.prisma.coordinatorApplication.update({ where: { id: application.id }, data: { resetTokenHash: null, resetTokenExpiresAt: null, temporaryCredentialExpiresAt: null } }),
    ]);
    return { message: 'Password changed successfully' };
  }

  async updateNotes(id: number, adminNotes: string) {
    return this.prisma.coordinatorApplication.update({
      where: { id },
      data: { adminNotes: adminNotes.trim() || null },
      include: { managementZone: { include: { coverages: true } } },
    });
  }
}
