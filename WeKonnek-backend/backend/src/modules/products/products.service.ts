import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreProduct, Prisma } from '@prisma/client';

@Injectable()
export class StoreProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByStore(storeId: string): Promise<StoreProduct[]> {
    return this.prisma.storeProduct.findMany({
      where: { storeId, isActive: true },
    });
  }

  async findById(id: string) {
    const product = await this.prisma.storeProduct.findUnique({
      where: { id },
      include: { store: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async create(data: Prisma.StoreProductCreateInput): Promise<StoreProduct> {
    return this.prisma.storeProduct.create({ data });
  }

  async update(id: string, data: Prisma.StoreProductUpdateInput) {
    await this.prisma.storeProduct.update({ where: { id }, data });
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.storeProduct.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async toggleAvailability(id: string) {
    const product = await this.findById(id);
    return this.prisma.storeProduct.update({
      where: { id },
      data: { isAvailable: !product.isAvailable },
    });
  }

  async search(query: string): Promise<StoreProduct[]> {
    return this.prisma.storeProduct.findMany({
      where: {
        isActive: true,
        name: { contains: query, mode: 'insensitive' },
      },
      include: { store: true },
    });
  }
}
