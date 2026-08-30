/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { MerchantsService } from './merchants.service';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

async function validateUpdate(body: unknown) {
  return pipe.transform(body, {
    type: 'body',
    metatype: UpdateMerchantDto,
  });
}

function inactiveMerchant() {
  return {
    id: 9,
    name: 'Inactive Store',
    phone: '09170000000',
    tin: null,
    registeredBusinessName: null,
    taxClassification: '',
    isActive: false,
    status: 'suspended',
    category: null,
    subCategory: null,
    branches: [],
  };
}

describe('merchant reactivation payload', () => {
  it('accepts is_active=true and rejects unsupported suspension fields', async () => {
    await expect(validateUpdate({ is_active: true })).resolves.toMatchObject({
      is_active: true,
    });
    await expect(
      validateUpdate({
        status: 'active',
        suspension_reason: null,
        suspended_until: null,
        suspension_duration: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reactivates an inactive merchant from is_active=true', async () => {
    const current = inactiveMerchant();
    const updated = { ...current, isActive: true };
    const prisma = {
      merchant: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockResolvedValue(updated),
      },
      branch: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const service = new MerchantsService(prisma as never, {} as never);
    const result = await service.update(9, { is_active: true });
    expect(prisma.merchant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9 },
        data: expect.objectContaining({ isActive: true }),
      }),
    );
    expect(result.is_active).toBe(true);
    expect(result.isActive).toBe(true);
  });
});
