import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByMerchant(merchantId: number) {
    const branches = await this.prisma.branch.findMany({
      where: { merchantId },
      include: { _count: { select: { staff: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return branches.map((b) => ({
      ...b,
      merchant_id: b.merchantId,
      zip_code: b.zipCode,
      operating_hours: b.operatingHours,
      is_active: b.isActive,
      created_at: b.createdAt,
      updated_at: b.updatedAt,
      staff_count: b._count.staff,
    }));
  }

  async create(merchantId: number, input: any) {
    const data: any = {
      merchantId,
      name: input.name,
    };

    if (input.address !== undefined) data.address = input.address;
    if (input.city !== undefined) data.city = input.city;
    if (input.state !== undefined) data.state = input.state;
    if (input.zip_code ?? input.zipCode) data.zipCode = input.zip_code ?? input.zipCode;
    if (input.latitude !== undefined) data.latitude = input.latitude;
    if (input.longitude !== undefined) data.longitude = input.longitude;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.operating_hours ?? input.operatingHours)
      data.operatingHours = input.operating_hours ?? input.operatingHours;

    const branch = await this.prisma.branch.create({ data });
    return { ...branch, merchant_id: branch.merchantId, is_active: branch.isActive };
  }

  async update(id: number, input: any) {
    const existing = await this.prisma.branch.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Branch not found');

    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.address !== undefined) data.address = input.address;
    if (input.city !== undefined) data.city = input.city;
    if (input.state !== undefined) data.state = input.state;
    if (input.zip_code !== undefined || input.zipCode !== undefined)
      data.zipCode = input.zip_code ?? input.zipCode;
    if (input.latitude !== undefined) data.latitude = input.latitude;
    if (input.longitude !== undefined) data.longitude = input.longitude;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.operating_hours !== undefined || input.operatingHours !== undefined)
      data.operatingHours = input.operating_hours ?? input.operatingHours;
    if (input.is_active !== undefined || input.isActive !== undefined)
      data.isActive = input.is_active ?? input.isActive;

    const branch = await this.prisma.branch.update({ where: { id }, data });
    return { ...branch, merchant_id: branch.merchantId, is_active: branch.isActive };
  }

  async remove(id: number) {
    const existing = await this.prisma.branch.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Branch not found');

    await this.prisma.branch.delete({ where: { id } });
    return { message: 'Branch deleted' };
  }
}
