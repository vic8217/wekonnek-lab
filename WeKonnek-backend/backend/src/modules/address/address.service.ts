import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Address, Prisma } from '@prisma/client';

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUser(userId: string): Promise<Address[]> {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(data: Prisma.AddressUncheckedCreateInput): Promise<Address> {
    if (data.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId: data.userId },
        data: { isDefault: false },
      });
    }
    return this.prisma.address.create({ data });
  }

  async update(id: string, data: Prisma.AddressUpdateInput): Promise<Address> {
    if (data.isDefault) {
      const existing = await this.prisma.address.findUnique({ where: { id } });
      if (existing) {
        await this.prisma.address.updateMany({
          where: { userId: existing.userId },
          data: { isDefault: false },
        });
      }
    }
    const address = await this.prisma.address.update({ where: { id }, data });
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.address.delete({ where: { id } });
  }
}
