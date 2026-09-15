import { ForbiddenException } from '@nestjs/common';
import {
  PaymentAllocationComponent,
  PaymentBeneficiaryType,
  PaymentPurpose,
} from '@prisma/client';
import { PaymentRoutingService } from './payment-routing.service';
import { PaymentAllocationService } from './payment-allocation.service';

describe('Stage 1A payment routing', () => {
  const routing = new PaymentRoutingService();

  it('routes merchant orders to MERCHANT and blocks WeKonnek PayCools', () => {
    const d = routing.decide({
      kind: 'wk_order',
      orderId: 1,
      merchantId: 9,
    });
    expect(d.beneficiary).toBe(PaymentBeneficiaryType.MERCHANT);
    expect(d.purpose).toBe(PaymentPurpose.MERCHANT_ORDER);
    expect(d.wekonnekPayCoolsAllowed).toBe(false);
    expect(d.allowedMechanisms).toEqual([
      'CASH',
      'MERCHANT_QR',
      'BANK_TRANSFER',
    ]);
    expect(() =>
      routing.assertWekonnekPayCoolsAllowed({
        kind: 'wk_order',
        orderId: 1,
        merchantId: 9,
      }),
    ).toThrow(ForbiddenException);
    expect(() =>
      routing.assertWekonnekGatewayAllowed({
        kind: 'wk_order',
        orderId: 1,
        merchantId: 9,
      }),
    ).toThrow(ForbiddenException);
  });

  it('allows WeKonnek PayCools for platform wallet reload and listing fees', () => {
    expect(
      routing.assertWekonnekPayCoolsAllowed({
        kind: 'platform_wallet_reload',
        merchantId: 3,
      }),
    ).toMatchObject({
      beneficiary: PaymentBeneficiaryType.PLATFORM,
      purpose: PaymentPurpose.PLATFORM_WALLET_RELOAD,
      wekonnekPayCoolsAllowed: true,
    });
    expect(
      routing.decide({
        kind: 'platform_listing_fee',
        listingType: 'bazaar',
      }).purpose,
    ).toBe(PaymentPurpose.PLATFORM_LISTING_FEE);
    expect(
      routing.decide({
        kind: 'platform_subscription',
      }).wekonnekPayCoolsAllowed,
    ).toBe(true);
    expect(
      routing.assertWekonnekGatewayAllowed({
        kind: 'platform_subscription',
      }).beneficiary,
    ).toBe(PaymentBeneficiaryType.PLATFORM);
  });

  it('rejects client beneficiary/purpose spoofing', () => {
    expect(() =>
      routing.rejectClientOwnershipSpoof({
        claimedBeneficiary: 'PLATFORM',
        subject: { kind: 'wk_order', orderId: 1, merchantId: 9 },
      }),
    ).toThrow(ForbiddenException);
    expect(() =>
      routing.rejectClientOwnershipSpoof({
        claimedPurpose: 'PLATFORM_SUBSCRIPTION',
        subject: { kind: 'wk_order', orderId: 1, merchantId: 9 },
      }),
    ).toThrow(ForbiddenException);
    expect(
      routing.rejectClientOwnershipSpoof({
        claimedBeneficiary: 'MERCHANT',
        claimedPurpose: 'MERCHANT_ORDER',
        subject: { kind: 'wk_order', orderId: 1, merchantId: 9 },
      }).beneficiary,
    ).toBe(PaymentBeneficiaryType.MERCHANT);
  });
});

describe('Stage 1A payment allocation', () => {
  const allocations = new PaymentAllocationService();

  it('keeps merchandise merchant-owned and transaction fee platform-owned', () => {
    const lines = allocations.buildLines({
      id: 1,
      merchantId: 42,
      totalAmount: 910,
      deliveryFee: 50,
      transactionFeeAmount: 10,
    });
    const byComponent = Object.fromEntries(
      lines.map((l) => [l.component, l]),
    );
    expect(byComponent[PaymentAllocationComponent.MERCHANDISE]).toMatchObject({
      beneficiaryType: PaymentBeneficiaryType.MERCHANT,
      beneficiaryId: '42',
      amount: expect.objectContaining({}),
    });
    expect(
      byComponent[PaymentAllocationComponent.MERCHANDISE].amount.toString(),
    ).toBe('850');
    expect(byComponent[PaymentAllocationComponent.PLATFORM_FEE]).toMatchObject({
      beneficiaryType: PaymentBeneficiaryType.PLATFORM,
      beneficiaryId: 'WEKONNEK',
    });
    expect(
      byComponent[PaymentAllocationComponent.PLATFORM_FEE].amount.toString(),
    ).toBe('10');
    expect(byComponent[PaymentAllocationComponent.DELIVERY_FEE]).toMatchObject({
      beneficiaryType: PaymentBeneficiaryType.MERCHANT,
      settlementNote: 'legacy_bundled_unsettled',
    });
    expect(
      byComponent[PaymentAllocationComponent.DELIVERY_FEE].amount.toString(),
    ).toBe('50');
  });

  it('does not invent a split payment processor', () => {
    const lines = allocations.buildLines({
      id: 2,
      merchantId: 1,
      totalAmount: 100,
      deliveryFee: 0,
      transactionFeeAmount: 0,
    });
    expect(lines.every((l) => l.currency === 'PHP')).toBe(true);
  });
});
