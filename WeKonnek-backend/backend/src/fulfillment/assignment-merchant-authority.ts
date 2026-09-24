import { ForbiddenException } from '@nestjs/common';
import { OrderDomainActorType, Prisma } from '@prisma/client';
import { AuthActor, FulfillmentAuthContext } from './fulfillment-authorization';

const TRUSTED: ReadonlySet<OrderDomainActorType> = new Set([
  'SYSTEM_ADMIN',
  'INTERNAL_SERVICE',
  'SYSTEM',
]);

const MERCHANT_ACTORS: ReadonlySet<OrderDomainActorType> = new Set([
  'MERCHANT_OWNER',
  'MERCHANT_ADMIN',
  'MERCHANT_STAFF',
]);

export const MERCHANT_ASSIGN_DENIED =
  'Merchant actors may only operate their merchant/shop orders';

/**
 * UCE-1B-A: membership ids derived from persisted Merchant / MerchantStaff only.
 * Caller merchantOwnerUserId / actorMerchantIds are not inputs.
 */
export function persistedAssignmentMerchantIds(input: {
  actorType: OrderDomainActorType;
  actorId?: string | null;
  fulfillmentMerchantId: number | null;
  persistedMerchantUserId: string | null;
  hasActiveStaff: boolean;
}): number[] {
  const merchantId = input.fulfillmentMerchantId;
  if (merchantId == null || !input.actorId) return [];
  const ownerOk =
    input.actorType === 'MERCHANT_OWNER' &&
    input.persistedMerchantUserId === input.actorId;
  const adminOk = input.actorType === 'MERCHANT_ADMIN' && input.hasActiveStaff;
  const staffMember =
    input.actorType === 'MERCHANT_STAFF' && input.hasActiveStaff;
  return ownerOk || adminOk || staffMember ? [merchantId] : [];
}

/**
 * Assignment-only merchant context. Never uses caller-supplied owner id or
 * merchant id lists as proof. Trusted actors skip membership lookup.
 */
export async function resolveAssignmentMerchantAuthContext(
  tx: Prisma.TransactionClient,
  actor: AuthActor,
  fulfillment: { merchantId: number | null },
): Promise<
  Pick<
    FulfillmentAuthContext,
    'merchantId' | 'actorMerchantIds' | 'merchantOwnerUserId'
  >
> {
  const merchantId = fulfillment.merchantId ?? null;
  if (TRUSTED.has(actor.type) || !MERCHANT_ACTORS.has(actor.type)) {
    return {
      merchantId,
      actorMerchantIds: [],
      merchantOwnerUserId: null,
    };
  }

  if (merchantId == null) {
    return {
      merchantId: null,
      actorMerchantIds: [],
      merchantOwnerUserId: null,
    };
  }

  const merchant = await tx.merchant.findUnique({
    where: { id: merchantId },
    select: { userId: true },
  });
  if (!merchant) {
    throw new ForbiddenException(MERCHANT_ASSIGN_DENIED);
  }

  const staff = actor.id
    ? await tx.merchantStaff.findFirst({
        where: {
          userId: actor.id,
          merchantId,
          isActive: true,
        },
        select: { id: true },
      })
    : null;

  return {
    merchantId,
    actorMerchantIds: persistedAssignmentMerchantIds({
      actorType: actor.type,
      actorId: actor.id,
      fulfillmentMerchantId: merchantId,
      persistedMerchantUserId: merchant.userId,
      hasActiveStaff: staff != null,
    }),
    merchantOwnerUserId: null,
  };
}
