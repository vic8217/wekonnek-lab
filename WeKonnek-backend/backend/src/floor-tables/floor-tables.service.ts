import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { TableShape } from '@prisma/client';

@Injectable()
export class FloorTablesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByMerchant(merchantId: number) {
    return this.prisma.floorTable.findMany({
      where: { merchantId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Build printable QR codes for a merchant's dine-in tables. Each QR encodes a
   * deep link to the merchant storefront pre-tagged with the table, e.g.
   * `${baseUrl}/merchants/<slug>?table=<label>`. When a customer scans it, the
   * storefront carries the table through checkout so the order lands in the
   * merchant portal already assigned to that table.
   */
  async generateQrCodes(merchantId: number, baseUrl?: string) {
    const origin = (baseUrl || '').replace(/\/+$/, '');
    if (!origin) {
      throw new BadRequestException('baseUrl is required to generate QR codes');
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true, slug: true },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }

    const tables = await this.prisma.floorTable.findMany({
      where: { merchantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    const uniqueTables = tables.filter((table, index, rows) => rows.findIndex(candidate =>
      candidate.label.trim().toLowerCase().replace(/\s+/g, ' ') === table.label.trim().toLowerCase().replace(/\s+/g, ' '),
    ) === index);

    const qrTables = await Promise.all(
      uniqueTables.map(async (table) => {
        const url = `${origin}/merchants/${merchant.slug}?table=${encodeURIComponent(table.label)}`;
        const dataUrl = await QRCode.toDataURL(url, {
          width: 512,
          margin: 2,
          errorCorrectionLevel: 'M',
        });
        return {
          id: table.id,
          label: table.label,
          capacity: table.capacity,
          url,
          dataUrl,
        };
      }),
    );

    return {
      merchant: { id: merchant.id, name: merchant.name, slug: merchant.slug },
      tables: qrTables,
    };
  }

  async create(merchantId: number, input: any) {
    const count = await this.prisma.floorTable.count({ where: { merchantId } });
    return this.prisma.floorTable.create({
      data: {
        merchantId,
        label: input.label || `Table ${count + 1}`,
        shape: (input.shape as TableShape) || 'square',
        capacity: input.capacity ?? 4,
        posX: input.posX ?? 0,
        posY: input.posY ?? 0,
        width: input.width ?? 100,
        height: input.height ?? 100,
        rotation: input.rotation ?? 0,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? count,
      },
    });
  }

  async update(id: number, input: any) {
    const existing = await this.prisma.floorTable.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Floor table not found');

    const data: any = {};
    if (input.label !== undefined) data.label = input.label;
    if (input.shape !== undefined) data.shape = input.shape as TableShape;
    if (input.capacity !== undefined) data.capacity = input.capacity;
    if (input.posX !== undefined) data.posX = input.posX;
    if (input.posY !== undefined) data.posY = input.posY;
    if (input.width !== undefined) data.width = input.width;
    if (input.height !== undefined) data.height = input.height;
    if (input.rotation !== undefined) data.rotation = input.rotation;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

    return this.prisma.floorTable.update({ where: { id }, data });
  }

  async remove(id: number) {
    const existing = await this.prisma.floorTable.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Floor table not found');
    await this.prisma.floorTable.delete({ where: { id } });
    return { message: 'Floor table deleted' };
  }

  async bulkUpdate(merchantId: number, tables: any[]) {
    return this.prisma.$transaction(
      tables.map((t) => {
        if (t.id) {
          return this.prisma.floorTable.update({
            where: { id: t.id },
            data: {
              label: t.label,
              shape: t.shape as TableShape,
              capacity: t.capacity,
              posX: t.posX,
              posY: t.posY,
              width: t.width,
              height: t.height,
              rotation: t.rotation,
              isActive: t.isActive,
              sortOrder: t.sortOrder,
            },
          });
        }
        return this.prisma.floorTable.create({
          data: {
            merchantId,
            label: t.label,
            shape: (t.shape as TableShape) || 'square',
            capacity: t.capacity ?? 4,
            posX: t.posX ?? 0,
            posY: t.posY ?? 0,
            width: t.width ?? 100,
            height: t.height ?? 100,
            rotation: t.rotation ?? 0,
            isActive: t.isActive ?? true,
            sortOrder: t.sortOrder ?? 0,
          },
        });
      }),
    );
  }
}
