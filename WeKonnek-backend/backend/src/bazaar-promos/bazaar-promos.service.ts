import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma';

@Injectable()
export class BazaarPromosService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(activeOnly = false) {
    return this.prisma.bazaarPromoCard.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });
  }

  create(data: any) {
    return this.prisma.bazaarPromoCard.create({ data: this.clean(data) });
  }

  async update(id: number, data: any) {
    await this.require(id);
    return this.prisma.bazaarPromoCard.update({ where: { id }, data: this.clean(data, true) });
  }

  async remove(id: number) {
    await this.require(id);
    return this.prisma.bazaarPromoCard.delete({ where: { id } });
  }

  private async require(id: number) {
    if (!await this.prisma.bazaarPromoCard.findUnique({ where: { id } })) throw new NotFoundException('Bazaar promo card not found');
  }

  private clean(data: any, partial = false) {
    const result: any = {};
    for (const field of ['title', 'subtitle', 'ctaHeading', 'ctaText']) {
      if (data[field] !== undefined) result[field] = String(data[field]).trim();
    }
    if (data.isActive !== undefined) result.isActive = Boolean(data.isActive);
    if (data.displayOrder !== undefined) result.displayOrder = Number(data.displayOrder) || 0;
    if (!partial) {
      result.title ||= 'Sell on WEKONNEK Bazaar';
      result.subtitle ||= 'Turn your products into extra income.';
    }
    return result;
  }
}
