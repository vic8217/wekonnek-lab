import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  assertActiveRiderIdentity,
  isCurrentRiderResponsibility,
} from './rider-assignments.policy';
import { projectRiderAssignment } from './rider-assignments.projection';

describe('UCE-2 active rider identity', () => {
  const active = { id: 'rider-a', role: 'rider', isActive: true };

  it('allows an active rider and an active driver', () => {
    expect(() => assertActiveRiderIdentity(active)).not.toThrow();
    expect(() =>
      assertActiveRiderIdentity({ ...active, role: 'driver' }),
    ).not.toThrow();
  });

  it('rejects a missing user', () => {
    expect(() => assertActiveRiderIdentity(null)).toThrow(UnauthorizedException);
  });

  it.each(['customer', 'merchant', 'admin', 'staff', 'coordinator'])(
    'rejects %s',
    (role) => {
      expect(() => assertActiveRiderIdentity({ ...active, role })).toThrow(
        ForbiddenException,
      );
    },
  );

  it('rejects an inactive rider without consulting approval status', () => {
    try {
      assertActiveRiderIdentity({ ...active, isActive: false });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'RIDER_NOT_ACTIVE',
      });
    }
  });

  it('treats active assignment and physical custody as separate facts', () => {
    const base = {
      wkOrderId: 10,
      activeRiderId: 'rider-a' as string | null,
      physicalCustodianRiderId: null as string | null,
    };
    expect(isCurrentRiderResponsibility(base, 'rider-a')).toBe(true);
    expect(
      isCurrentRiderResponsibility(
        { ...base, activeRiderId: null, physicalCustodianRiderId: 'rider-a' },
        'rider-a',
      ),
    ).toBe(true);
    expect(isCurrentRiderResponsibility(base, 'rider-b')).toBe(false);
    expect(
      isCurrentRiderResponsibility({ ...base, wkOrderId: null }, 'rider-a'),
    ).toBe(false);
  });
});

describe('UCE-2 assignment projection', () => {
  it('keeps recipientName null and exposes a read-only advance badge', () => {
    const summary = projectRiderAssignment(
      {
        status: 'picked_up',
        activeRiderId: 'rider-a',
        physicalCustodianRiderId: 'rider-a',
        riderAdvances: [{ status: 'RIDER_ACCEPTED' }],
        wkOrder: {
          id: 7,
          orderCode: 'WK-7',
          orderType: 'delivery',
          deliveryAddress: '18 Mabini',
          notes: '  leave at door ',
          merchant: { name: 'North', address: '2 Road' },
          shop: null,
          orderItems: [{ productName: 'Item', quantity: 2 }],
        },
      },
      'rider-a',
    );
    expect(summary?.delivery.dropoff.recipientName).toBeNull();
    expect(summary?.riderAdvance).toEqual({
      exists: true,
      status: 'RIDER_ACCEPTED',
    });
    expect(summary?.delivery.itemCount).toBe(2);
    expect(summary).not.toHaveProperty('authorizedRecipient');
  });
});
