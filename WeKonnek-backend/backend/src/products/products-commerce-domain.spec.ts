import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductsService } from './products.service';

describe('product commerce-domain rules', () => {
  const media = {
    assertMerchantOwnedUrls: jest.fn(),
    thumbnailMap: jest.fn().mockResolvedValue(new Map()),
  };
  const prisma = {
    merchant: { findUnique: jest.fn() },
    product: { create: jest.fn(), update: jest.fn() },
    category: { findFirst: jest.fn() },
  };
  const service = new ProductsService(prisma as never, media as never);

  const dto = (commerceDomain?: unknown) =>
    plainToInstance(CreateProductDto, {
      name: 'Item',
      unit: 'Piece',
      sellingPrice: 1,
      hasVariants: false,
      trackInventory: false,
      availabilityStatus: 'Available',
      commerceDomain,
    });

  beforeEach(() => jest.clearAllMocks());

  it.each(['MIXED', 'invalid'])(
    'rejects %s as a product commerce domain',
    async (value) => {
      expect(await validate(dto(value))).not.toHaveLength(0);
    },
  );

  it.each(['FOOD', 'NON_FOOD'])(
    'accepts %s for a mixed merchant',
    async (commerceDomain) => {
      prisma.merchant.findUnique.mockResolvedValue({
        taxClassification: 'VAT',
        commerceDomain: 'MIXED',
        category: null,
      });
      prisma.product.create.mockResolvedValue({ id: 7 });
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 7 } as never);
      await expect(
        service.create(dto(commerceDomain), 1),
      ).resolves.toMatchObject({ id: 7 });
    },
  );

  it('requires a type when a mixed merchant creates a product', async () => {
    prisma.merchant.findUnique.mockResolvedValue({
      taxClassification: 'VAT',
      commerceDomain: 'MIXED',
      category: null,
    });
    await expect(service.create(dto(), 1)).rejects.toThrow(
      'Commerce type is required',
    );
  });

  it('allows an unrelated edit of an existing unclassified product', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 7,
      merchantId: 1,
      categoryId: null,
      subCategoryId: null,
      merchant: { commerceDomain: 'MIXED', category: null },
      imageUrl: null,
    } as never);
    prisma.product.update.mockResolvedValue({ id: 7 });
    await expect(
      service.update(7, { name: 'Renamed' }, 1),
    ).resolves.toMatchObject({ id: 7 });
  });

  it('rejects a cross-tenant update before changing the product', async () => {
    jest
      .spyOn(service, 'findOne')
      .mockRejectedValue(new NotFoundException('Product with ID 9 not found'));
    await expect(
      service.update(9, { commerceDomain: 'FOOD' }, 1),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });
});
