import {
  ForbiddenException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { PaymentPurpose, PaymentBeneficiaryType } from '@prisma/client';

export type PaymentMechanism =
  | 'CASH'
  | 'MERCHANT_QR'
  | 'BANK_TRANSFER'
  | 'WEKONNEK_PAYCOOLS'
  | 'LEGACY_GATEWAY';

export interface PaymentRoutingDecision {
  beneficiary: PaymentBeneficiaryType;
  purpose: PaymentPurpose;
  allowedMechanisms: PaymentMechanism[];
  wekonnekPayCoolsAllowed: boolean;
  /** Human-readable reason for guards/logs */
  reason: string;
}

export type PaymentSubject =
  | { kind: 'wk_order'; orderId: number; merchantId: number }
  | { kind: 'platform_subscription'; merchantId?: number }
  | { kind: 'platform_listing_fee'; listingType: 'bazaar' | 'property' }
  | { kind: 'platform_wallet_reload'; merchantId: number }
  | { kind: 'platform_other'; label?: string };

/**
 * Authoritative Stage 1A payment ownership / routing decisions.
 * Controllers and providers must not invent beneficiary/purpose.
 * Client-supplied beneficiary/purpose is ignored.
 */
@Injectable()
export class PaymentRoutingService {
  decide(subject: PaymentSubject): PaymentRoutingDecision {
    switch (subject.kind) {
      case 'wk_order':
        return {
          beneficiary: PaymentBeneficiaryType.MERCHANT,
          purpose: PaymentPurpose.MERCHANT_ORDER,
          allowedMechanisms: ['CASH', 'MERCHANT_QR', 'BANK_TRANSFER'],
          wekonnekPayCoolsAllowed: false,
          reason:
            'Third-party merchant commerce proceeds must not use WeKonnek PayCools',
        };
      case 'platform_subscription':
        return {
          beneficiary: PaymentBeneficiaryType.PLATFORM,
          purpose: PaymentPurpose.PLATFORM_SUBSCRIPTION,
          allowedMechanisms: ['WEKONNEK_PAYCOOLS', 'LEGACY_GATEWAY'],
          wekonnekPayCoolsAllowed: true,
          reason: 'Merchant subscription is a WeKonnek platform charge',
        };
      case 'platform_listing_fee':
        return {
          beneficiary: PaymentBeneficiaryType.PLATFORM,
          purpose:
            subject.listingType === 'property'
              ? PaymentPurpose.PLATFORM_PROPERTY_FEE
              : PaymentPurpose.PLATFORM_LISTING_FEE,
          allowedMechanisms: ['WEKONNEK_PAYCOOLS', 'LEGACY_GATEWAY'],
          wekonnekPayCoolsAllowed: true,
          reason: 'Listing/posting fee is a WeKonnek platform charge',
        };
      case 'platform_wallet_reload':
        return {
          beneficiary: PaymentBeneficiaryType.PLATFORM,
          purpose: PaymentPurpose.PLATFORM_WALLET_RELOAD,
          allowedMechanisms: ['WEKONNEK_PAYCOOLS'],
          wekonnekPayCoolsAllowed: true,
          reason: 'Merchant wallet reload is collected by WeKonnek',
        };
      case 'platform_other':
        return {
          beneficiary: PaymentBeneficiaryType.PLATFORM,
          purpose: PaymentPurpose.PLATFORM_OTHER,
          allowedMechanisms: ['WEKONNEK_PAYCOOLS', 'LEGACY_GATEWAY'],
          wekonnekPayCoolsAllowed: true,
          reason: subject.label ?? 'Explicit platform-owned charge',
        };
      default: {
        const _exhaustive: never = subject;
        throw new BadRequestException(
          `Unknown payment subject: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  }

  /**
   * Fail-closed guard: WeKonnek PayCools may only start when beneficiary is PLATFORM.
   */
  assertWekonnekPayCoolsAllowed(subject: PaymentSubject): PaymentRoutingDecision {
    const decision = this.decide(subject);
    if (!decision.wekonnekPayCoolsAllowed) {
      throw new ForbiddenException({
        code: 'WEKONNEK_PAYCOOLS_FORBIDDEN_FOR_MERCHANT_ORDER',
        message:
          'WeKonnek PayCools cannot be used for third-party merchant order payments',
        beneficiary: decision.beneficiary,
        purpose: decision.purpose,
      });
    }
    if (decision.beneficiary !== PaymentBeneficiaryType.PLATFORM) {
      throw new ForbiddenException({
        code: 'WEKONNEK_PAYCOOLS_REQUIRES_PLATFORM_BENEFICIARY',
        message: 'WeKonnek PayCools requires PLATFORM beneficiary',
        beneficiary: decision.beneficiary,
        purpose: decision.purpose,
      });
    }
    return decision;
  }

  /**
   * The legacy GCash/Maya/Card/PayMongo/Xendit adapters use WeKonnek-owned
   * credentials too.  They are therefore subject to the same ownership rule
   * as PayCools; merchant commerce must use merchant-direct methods instead.
   */
  assertWekonnekGatewayAllowed(subject: PaymentSubject): PaymentRoutingDecision {
    const decision = this.decide(subject);
    if (
      decision.beneficiary !== PaymentBeneficiaryType.PLATFORM ||
      !decision.allowedMechanisms.includes('LEGACY_GATEWAY')
    ) {
      throw new ForbiddenException({
        code: 'WEKONNEK_GATEWAY_FORBIDDEN_FOR_MERCHANT_ORDER',
        message:
          'WeKonnek-owned payment gateways cannot be used for third-party merchant order payments',
        beneficiary: decision.beneficiary,
        purpose: decision.purpose,
      });
    }
    return decision;
  }

  /**
   * Reject client attempts to spoof ownership.
   */
  rejectClientOwnershipSpoof(input: {
    claimedBeneficiary?: string | null;
    claimedPurpose?: string | null;
    subject: PaymentSubject;
  }): PaymentRoutingDecision {
    const decision = this.decide(input.subject);
    if (
      input.claimedBeneficiary &&
      String(input.claimedBeneficiary).toUpperCase() !== decision.beneficiary
    ) {
      throw new ForbiddenException({
        code: 'PAYMENT_BENEFICIARY_SPOOF_REJECTED',
        message: 'Client cannot override payment beneficiary',
        derived: decision.beneficiary,
      });
    }
    if (
      input.claimedPurpose &&
      String(input.claimedPurpose).toUpperCase() !== decision.purpose
    ) {
      throw new ForbiddenException({
        code: 'PAYMENT_PURPOSE_SPOOF_REJECTED',
        message: 'Client cannot override payment purpose',
        derived: decision.purpose,
      });
    }
    return decision;
  }
}
