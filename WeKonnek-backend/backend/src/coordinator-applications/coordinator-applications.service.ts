import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
        fullName: String(input.fullName), mobileNumber: String(input.mobileNumber), email: String(input.email).trim().toLowerCase(),
        region: String(input.region), provinceDistrict: String(input.provinceDistrict), cityMunicipality: String(input.cityMunicipality),
        barangay: input.barangay ? String(input.barangay) : null,
        preferredCoverageArea: input.preferredCoverageArea ? String(input.preferredCoverageArea) : null,
        latitude: Number(input.latitude), longitude: Number(input.longitude),
        background: input.background ? String(input.background) : null, occupation: input.occupation ? String(input.occupation) : null,
        motivation: input.motivation ? String(input.motivation) : null, monthlyCapacity: input.monthlyCapacity ? String(input.monthlyCapacity) : null,
        referred: input.referred ? String(input.referred) : null,
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
    return this.prisma.coordinatorApplication.update({
      where: { id },
      data: { status, managementZoneId: status === 'approved' ? managementZoneId : null },
      include: { managementZone: { include: { coverages: true } } },
    });
  }
}
