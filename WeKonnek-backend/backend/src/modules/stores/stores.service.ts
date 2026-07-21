import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Store, StoreType, Prisma } from '@prisma/client';

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(type?: StoreType) {
    const where: Prisma.StoreWhereInput = { isActive: true };
    if (type) where.type = type;
    return this.prisma.store.findMany({
      where,
      include: { products: true },
    });
  }

  async findById(id: string) {
    const store = await this.prisma.store.findUnique({
      where: { id },
      include: { products: true },
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  async findNearby(lat: number, lng: number, radiusKm = 10): Promise<Store[]> {
    return this.prisma.$queryRaw<Store[]>`
      SELECT * FROM stores
      WHERE is_active = true AND is_open = true
        AND (
          6371 * acos(
            cos(radians(${lat})) * cos(radians(latitude))
            * cos(radians(longitude) - radians(${lng}))
            + sin(radians(${lat})) * sin(radians(latitude))
          )
        ) < ${radiusKm}
    `;
  }

  async create(data: Prisma.StoreCreateInput): Promise<Store> {
    return this.prisma.store.create({ data });
  }

  async update(id: string, data: Prisma.StoreUpdateInput) {
    await this.prisma.store.update({ where: { id }, data });
    return this.findById(id);
  }

  async toggleOpen(id: string) {
    const store = await this.findById(id);
    return this.prisma.store.update({
      where: { id },
      data: { isOpen: !store.isOpen },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.store.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
