import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustodyEventType,
  FulfillmentStatus,
  MerchantPaymentStatus,
  OperationalCaseStatus,
  OperationalCaseType,
  OperationalDisposition,
  Prisma,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialObligationType,
  ReturnFinancialPartyType,
  RiderAdvanceSettlementStatus,
  RiderAdvanceStatus,
  UserRole,
  DeliveryAttemptOutcome,
  RedeliveryAuthorizationStatus,
  OperationsRecoveryStatus,
  OperationsRecoveryDisposition,
  OperationsRecoveryTrigger,
  OperationsRecoveryEventType,
  ExceptionClaimStatus,
  ExceptionFinancialObligationStatus,
  LiabilityDeterminationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_DELIVERY_ATTEMPTS } from '../redelivery/redelivery.policy';
import { EXCEPTION_CLAIM_ACTIVE_STATUSES } from '../exception-financial/exception-financial.policy';

export type DerivedOperationalState =
  | 'ACTIVE'
  | 'FINANCIALLY_PENDING'
  | 'EXCEPTION'
  | 'COMPLETE'
  | 'CANCELLED';

const MONEY = (v: unknown) =>
  new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value).toDecimalPlaces(2);

@Injectable()
export class OrderOperationalStateService {
  constructor(private readonly prisma: PrismaService) {}

  async getForOrder(wkOrderId: number, actorUserId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
    });
    if (!order) throw new NotFoundException('Order not found');

    const fulfillment = await this.prisma.orderFulfillment.findUnique({
      where: { wkOrderId },
    });
    const role = await this.resolveViewerRole(order, fulfillment, actorUserId);
    if (role === 'DENIED') {
      throw new ForbiddenException({
        code: 'OPERATIONAL_STATE_FORBIDDEN',
        message: 'Not authorized to view operational state for this order',
      });
    }

    const custody = fulfillment
      ? await this.prisma.custodyEvent.findMany({
          where: { fulfillmentId: fulfillment.id },
          select: { eventType: true },
        })
      : [];
    const hasCustomerReceived = custody.some(
      (c) => c.eventType === CustodyEventType.CUSTOMER_RECEIVED,
    );
    const hasReturnReceived = custody.some(
      (c) => c.eventType === CustodyEventType.RETURN_RECEIVED,
    );

    const ra = await this.prisma.riderAdvance.findFirst({
      where: {
        wkOrderId,
        status: { not: RiderAdvanceStatus.CANCELLED },
      },
      orderBy: { createdAt: 'desc' },
    });

    let settledAmount = MONEY(0);
    let remainingAmount: Prisma.Decimal | null = null;
    let reimbursedTotalMismatch = false;
    if (ra?.reimbursementPrincipal != null) {
      const principal = MONEY(ra.reimbursementPrincipal);
      const rows = await this.prisma.riderAdvanceSettlement.findMany({
        where: {
          riderAdvanceId: ra.id,
          status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
        },
        select: { acknowledgedAmount: true },
      });
      for (const row of rows) {
        if (row.acknowledgedAmount) {
          settledAmount = settledAmount.add(MONEY(row.acknowledgedAmount));
        }
      }
      settledAmount = settledAmount.toDecimalPlaces(2);
      remainingAmount = principal.sub(settledAmount).toDecimalPlaces(2);
      if (
        ra.status === RiderAdvanceStatus.REIMBURSED &&
        !settledAmount.eq(principal)
      ) {
        reimbursedTotalMismatch = true;
      }
    }

    const physicalStatus = fulfillment?.status ?? null;
    const merchantPaymentStatus = order.merchantPaymentStatus;
    const paymentResolved =
      merchantPaymentStatus === MerchantPaymentStatus.NOT_REQUIRED ||
      merchantPaymentStatus === MerchantPaymentStatus.VERIFIED ||
      merchantPaymentStatus === MerchantPaymentStatus.CANCELLED;

    const flags: string[] = [];
    if (
      physicalStatus === FulfillmentStatus.delivered &&
      !hasCustomerReceived
    ) {
      flags.push('CUSTOMER_CUSTODY_UNCONFIRMED');
      flags.push('DELIVERED_WITHOUT_CUSTOMER_RECEIVED');
    }
    if (physicalStatus === FulfillmentStatus.returned && !hasReturnReceived) {
      flags.push('RETURN_CUSTODY_UNCONFIRMED');
      flags.push('RETURNED_WITHOUT_RETURN_RECEIVED');
    }
    if (physicalStatus === FulfillmentStatus.returned && hasReturnReceived) {
      flags.push('RETURN_COMPLETED');
      const det = await this.prisma.returnFinancialDetermination.findFirst({
        where: { wkOrderId },
        orderBy: { createdAt: 'desc' },
      });
      if (!det) {
        flags.push('RETURN_FINANCIAL_DETERMINATION_REQUIRED');
      } else if (
        det.status === ReturnFinancialDeterminationStatus.DISPUTED
      ) {
        flags.push('RETURN_FINANCIAL_DISPUTED');
      } else if (
        det.status !== ReturnFinancialDeterminationStatus.FINALIZED &&
        det.status !== ReturnFinancialDeterminationStatus.CANCELLED
      ) {
        flags.push('RETURN_FINANCIAL_DETERMINATION_PENDING');
      } else if (
        det.status === ReturnFinancialDeterminationStatus.FINALIZED
      ) {
        const obls = await this.prisma.returnFinancialObligation.findMany({
          where: { determinationId: det.id },
        });
        for (const obl of obls) {
          if (obl.status === 'OPEN' || obl.status === 'PARTIALLY_SETTLED') {
            if (
              obl.type ===
              ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT
            ) {
              flags.push('RETURN_REPAYMENT_PENDING');
            }
            if (
              obl.type ===
              ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND
            ) {
              flags.push('RETURN_REFUND_PENDING');
            }
          }
        }
      }
      if (
        !det ||
        det.status !== ReturnFinancialDeterminationStatus.FINALIZED
      ) {
        const merchantTerms =
          await this.prisma.returnFinancialTermsAcceptance.count({
            where: {
              wkOrderId,
              partyType: ReturnFinancialPartyType.MERCHANT,
            },
          });
        const customerTerms =
          await this.prisma.returnFinancialTermsAcceptance.count({
            where: {
              wkOrderId,
              partyType: ReturnFinancialPartyType.CUSTOMER,
            },
          });
        if (merchantTerms === 0 || customerTerms === 0) {
          flags.push('RETURN_FINANCIAL_MANUAL_DETERMINATION_REQUIRED');
        }
      }
    }
    if (
      ra &&
      (ra.status === RiderAdvanceStatus.REIMBURSEMENT_DUE ||
        (ra.status === RiderAdvanceStatus.DISPUTED &&
          ra.reimbursementPrincipal != null &&
          MONEY(ra.reimbursementPrincipal).gt(0) &&
          remainingAmount != null &&
          remainingAmount.gt(0)))
    ) {
      flags.push('RIDER_ADVANCE_REIMBURSEMENT_DUE');
    }
    if (ra?.status === RiderAdvanceStatus.REIMBURSEMENT_DUE && !ra.reimbursementPrincipal) {
      flags.push('RA_DUE_WITHOUT_PRINCIPAL');
    }
    if (reimbursedTotalMismatch) {
      flags.push('RA_REIMBURSED_TOTAL_MISMATCH');
    }

    if (fulfillment) {
      const pickupTerminalStatuses: ReadonlySet<FulfillmentStatus> = new Set([
        FulfillmentStatus.picked_up,
        FulfillmentStatus.in_transit,
        FulfillmentStatus.delivered,
        FulfillmentStatus.delivery_failed,
        FulfillmentStatus.returning,
        FulfillmentStatus.returned,
        FulfillmentStatus.cancelled,
      ]);
      if (pickupTerminalStatuses.has(fulfillment.status)) {
        const activePickup = await this.prisma.pickupHandoffToken.count({
          where: { fulfillmentId: fulfillment.id, status: 'ACTIVE' },
        });
        if (activePickup > 0) flags.push('ACTIVE_PICKUP_TOKEN_AFTER_PICKUP_TERMINAL');
      }
      const deliveryTerminalStatuses: ReadonlySet<FulfillmentStatus> = new Set([
        FulfillmentStatus.delivered,
        FulfillmentStatus.returned,
        FulfillmentStatus.cancelled,
      ]);
      if (deliveryTerminalStatuses.has(fulfillment.status)) {
        const activeDelivery = await this.prisma.customerDeliveryHandoffToken.count({
          where: { fulfillmentId: fulfillment.id, status: 'ACTIVE' },
        });
        if (activeDelivery > 0) {
          flags.push('ACTIVE_DELIVERY_TOKEN_AFTER_FULFILLMENT_TERMINAL');
        }
        const activeReturn = await this.prisma.merchantReturnHandoffToken.count({
          where: { fulfillmentId: fulfillment.id, status: 'ACTIVE' },
        });
        if (activeReturn > 0) {
          flags.push('ACTIVE_RETURN_TOKEN_AFTER_FULFILLMENT_TERMINAL');
        }
      }
    }

    if (physicalStatus === FulfillmentStatus.returning) {
      flags.push('RETURN_IN_PROGRESS');
      if (!hasReturnReceived) {
        flags.push('RETURN_MERCHANT_CONFIRMATION_PENDING');
      }
    }
    if (fulfillment?.pendingCustodyIncomingRiderId) {
      flags.push('CUSTODY_TRANSFER_PENDING');
    }
    if (
      fulfillment?.physicalCustodianRiderId != null &&
      fulfillment.activeRiderId != null &&
      fulfillment.physicalCustodianRiderId !== fulfillment.activeRiderId
    ) {
      flags.push('ASSIGNMENT_CUSTODY_MISMATCH');
    }

    if (fulfillment) {
      const opCase = await this.prisma.operationalCase.findFirst({
        where: {
          fulfillmentId: fulfillment.id,
          caseType: OperationalCaseType.DELIVERY_FAILURE,
          status: {
            in: [
              OperationalCaseStatus.OPEN,
              OperationalCaseStatus.DISPOSITION_SELECTED,
            ],
          },
        },
        orderBy: { openedAt: 'desc' },
      });
      if (opCase) {
        flags.push('DELIVERY_FAILURE_CASE_OPEN');
        if (
          opCase.status === OperationalCaseStatus.OPEN &&
          opCase.currentDisposition == null
        ) {
          // Stage 11 may own recovery while Stage 8 remains OPEN historically.
          // Avoid duplicate DELIVERY_DISPOSITION_REQUIRED when Stage 11 is active
          // or CLOSED with NO_FURTHER_FULFILLMENT (do not hide other Stage 8 facts).
          const stage11Owns = await this.prisma.operationsRecovery.findFirst({
            where: {
              fulfillmentId: fulfillment.id,
              OR: [
                {
                  status: {
                    in: [
                      OperationsRecoveryStatus.OPEN,
                      OperationsRecoveryStatus.INVESTIGATING,
                      OperationsRecoveryStatus.DISPOSITION_SELECTED,
                    ],
                  },
                },
                {
                  status: OperationsRecoveryStatus.CLOSED,
                  currentDisposition:
                    OperationsRecoveryDisposition.NO_FURTHER_FULFILLMENT,
                },
              ],
            },
          });
          if (!stage11Owns) {
            flags.push('DELIVERY_DISPOSITION_REQUIRED');
          }
        }
        if (
          opCase.currentDisposition ===
            OperationalDisposition.RESCHEDULE_REQUESTED &&
          opCase.status !== OperationalCaseStatus.RESOLVED
        ) {
          flags.push('RESCHEDULE_PENDING');
        }
        if (
          opCase.currentDisposition ===
          OperationalDisposition.OPERATIONS_RECOVERY_REQUIRED
        ) {
          flags.push('OPERATIONS_RECOVERY_REQUIRED');
        }
      }

      if (physicalStatus === FulfillmentStatus.delivery_failed) {
        const failedAttempt = await this.prisma.deliveryAttempt.count({
          where: {
            fulfillmentId: fulfillment.id,
            outcome: DeliveryAttemptOutcome.FAILED,
          },
        });
        if (failedAttempt === 0) {
          flags.push('DELIVERY_FAILED_WITHOUT_ATTEMPT');
        }
        if (failedAttempt >= MAX_DELIVERY_ATTEMPTS) {
          flags.push('REDELIVERY_ATTEMPT_LIMIT_REACHED');
          if (!flags.includes('OPERATIONS_RECOVERY_REQUIRED')) {
            flags.push('OPERATIONS_RECOVERY_REQUIRED');
          }
        }
      }

      // Stage 10 redelivery flags
      const openRedelivery = await this.prisma.redeliveryAuthorization.findFirst({
        where: {
          fulfillmentId: fulfillment.id,
          status: {
            in: [
              RedeliveryAuthorizationStatus.REQUESTED,
              RedeliveryAuthorizationStatus.CONFIRMED,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (openRedelivery) {
        if (openRedelivery.status === RedeliveryAuthorizationStatus.REQUESTED) {
          flags.push('REDELIVERY_REQUEST_PENDING');
        }
        if (openRedelivery.status === RedeliveryAuthorizationStatus.CONFIRMED) {
          flags.push('REDELIVERY_SCHEDULED');
        }
        if (openRedelivery.windowEnd.getTime() < Date.now()) {
          flags.push('REDELIVERY_WINDOW_EXPIRED');
        }
      }
      const activatedRedelivery =
        await this.prisma.redeliveryAuthorization.findFirst({
          where: {
            fulfillmentId: fulfillment.id,
            status: RedeliveryAuthorizationStatus.ACTIVATED,
          },
          orderBy: { activatedAt: 'desc' },
        });
      if (
        activatedRedelivery &&
        physicalStatus === FulfillmentStatus.in_transit
      ) {
        flags.push('REDELIVERY_IN_PROGRESS');
      }
      if (fulfillment.pendingCustodyIncomingRiderId) {
        if (!flags.includes('REDELIVERY_CUSTODY_TRANSFER_REQUIRED')) {
          // Surface Stage 10-specific alias when delivery_failed and redelivery relevant
          if (
            physicalStatus === FulfillmentStatus.delivery_failed ||
            openRedelivery
          ) {
            flags.push('REDELIVERY_CUSTODY_TRANSFER_REQUIRED');
          }
        }
      }
      if (physicalStatus === FulfillmentStatus.returning) {
        flags.push('RETURN_PATH_SELECTED');
      }
      const finalizedDet =
        await this.prisma.returnFinancialDetermination.findFirst({
          where: {
            wkOrderId,
            status: ReturnFinancialDeterminationStatus.FINALIZED,
          },
        });
      if (finalizedDet) {
        flags.push('RETURN_FINANCIAL_RESOLUTION_ACTIVE');
      }

      // Stage 11 operations recovery flags
      const activeRecovery = await this.prisma.operationsRecovery.findFirst({
        where: {
          fulfillmentId: fulfillment.id,
          status: {
            in: [
              OperationsRecoveryStatus.OPEN,
              OperationsRecoveryStatus.INVESTIGATING,
              OperationsRecoveryStatus.DISPOSITION_SELECTED,
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      const latestRecovery = await this.prisma.operationsRecovery.findFirst({
        where: { fulfillmentId: fulfillment.id },
        orderBy: { createdAt: 'desc' },
      });
      if (activeRecovery) {
        flags.push('OPERATIONS_RECOVERY_OPEN');
        if (
          activeRecovery.currentDisposition ===
            OperationsRecoveryDisposition.CUSTODY_INVESTIGATION ||
          activeRecovery.openingTriggerCode ===
            OperationsRecoveryTrigger.CUSTODY_UNCONFIRMED
        ) {
          flags.push('CUSTODY_INVESTIGATION_REQUIRED');
        }
        if (
          activeRecovery.openingTriggerCode ===
            OperationsRecoveryTrigger.MERCHANT_RETURN_REFUSED ||
          activeRecovery.currentDisposition ===
            OperationsRecoveryDisposition.RETURN_REQUIRED
        ) {
          flags.push('MERCHANT_RETURN_REFUSED');
        }
        if (
          activeRecovery.openingTriggerCode ===
          OperationsRecoveryTrigger.GOODS_REPORTED_LOST
        ) {
          flags.push('GOODS_LOSS_REPORTED');
        }
        if (
          activeRecovery.openingTriggerCode ===
          OperationsRecoveryTrigger.GOODS_REPORTED_DAMAGED
        ) {
          flags.push('GOODS_DAMAGE_REPORTED');
        }
        if (
          activeRecovery.currentDisposition ===
          OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED
        ) {
          flags.push('FINANCIAL_REVIEW_REQUIRED');
        }
      }
      if (
        latestRecovery?.status === OperationsRecoveryStatus.CLOSED &&
        latestRecovery.currentDisposition ===
          OperationsRecoveryDisposition.NO_FURTHER_FULFILLMENT
      ) {
        flags.push('NO_FURTHER_FULFILLMENT');
      }
      if (
        latestRecovery?.status === OperationsRecoveryStatus.CLOSED &&
        latestRecovery.currentDisposition ===
          OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED &&
        !flags.includes('FINANCIAL_REVIEW_REQUIRED')
      ) {
        flags.push('FINANCIAL_REVIEW_REQUIRED');
      }
      if (
        physicalStatus === FulfillmentStatus.returned &&
        !hasReturnReceived
      ) {
        flags.push('HOLLOW_RETURNED_WITHOUT_MERCHANT_CUSTODY');
      }
      if (
        !fulfillment.pendingCustodyIncomingRiderId &&
        (await this.prisma.operationsRecoveryEvent.count({
          where: {
            eventType: OperationsRecoveryEventType.PENDING_CUSTODY_CLEARED,
            operationsRecovery: { fulfillmentId: fulfillment.id },
          },
        })) > 0
      ) {
        flags.push('PENDING_CUSTODY_TRANSFER_CLEARED');
      }

      // Stage 12 exception financial liability flags — derived read-only from
      // Stage 12 tables. Stage 11 semantics above are untouched.
      const activeClaim = await this.prisma.exceptionClaim.findFirst({
        where: {
          fulfillmentId: fulfillment.id,
          status: { in: EXCEPTION_CLAIM_ACTIVE_STATUSES },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (activeClaim) {
        flags.push('CLAIM_OPEN');
        if (
          activeClaim.status === ExceptionClaimStatus.DETERMINATION_PROPOSED
        ) {
          flags.push('LIABILITY_DETERMINATION_PROPOSED');
        }
      }
      const finalizedLiability =
        await this.prisma.liabilityDetermination.findFirst({
          where: {
            status: LiabilityDeterminationStatus.FINALIZED,
            exceptionClaim: { fulfillmentId: fulfillment.id },
          },
          orderBy: { finalizedAt: 'desc' },
        });
      if (finalizedLiability) {
        flags.push('LIABILITY_DETERMINED');
      }
      const pendingExceptionObligations =
        await this.prisma.exceptionFinancialObligation.count({
          where: {
            wkOrderId,
            status: {
              in: [
                ExceptionFinancialObligationStatus.OPEN,
                ExceptionFinancialObligationStatus.PARTIALLY_SETTLED,
              ],
            },
          },
        });
      if (pendingExceptionObligations > 0) {
        flags.push('EXCEPTION_OBLIGATION_PENDING');
      }
      const uncoveredLoss = await this.prisma.economicLoss.findFirst({
        where: { fulfillmentId: fulfillment.id },
        include: { coverages: { select: { amount: true } } },
        orderBy: { createdAt: 'desc' },
      });
      if (uncoveredLoss) {
        const covered = uncoveredLoss.coverages.reduce(
          (acc, c) => acc.add(MONEY(c.amount)),
          MONEY(0),
        );
        if (MONEY(uncoveredLoss.compensableAmount).gt(covered)) {
          flags.push('ECONOMIC_LOSS_UNCOVERED');
        }
      }
    }

    const integrityBlocking = flags.some((f) =>
      [
        'CUSTOMER_CUSTODY_UNCONFIRMED',
        'RETURN_CUSTODY_UNCONFIRMED',
        'RA_REIMBURSED_TOTAL_MISMATCH',
        'RA_DUE_WITHOUT_PRINCIPAL',
        'ASSIGNMENT_CUSTODY_MISMATCH',
        'DELIVERY_FAILED_WITHOUT_ATTEMPT',
        'HOLLOW_RETURNED_WITHOUT_MERCHANT_CUSTODY',
        'OPERATIONS_RECOVERY_OPEN',
        'CUSTODY_INVESTIGATION_REQUIRED',
      ].includes(f),
    );

    let operationalState: DerivedOperationalState = 'ACTIVE';
    if (physicalStatus === FulfillmentStatus.cancelled) {
      operationalState = 'CANCELLED';
    } else if (
      physicalStatus === FulfillmentStatus.delivery_failed ||
      physicalStatus === FulfillmentStatus.returning ||
      physicalStatus === FulfillmentStatus.returned ||
      integrityBlocking
    ) {
      operationalState = 'EXCEPTION';
    } else if (
      physicalStatus === FulfillmentStatus.delivered &&
      hasCustomerReceived &&
      paymentResolved &&
      (!ra ||
        ra.status === RiderAdvanceStatus.REIMBURSED ||
        ra.status === RiderAdvanceStatus.CANCELLED) &&
      !reimbursedTotalMismatch
    ) {
      operationalState = 'COMPLETE';
    } else if (
      (physicalStatus === FulfillmentStatus.delivered &&
        (!paymentResolved ||
          flags.includes('RIDER_ADVANCE_REIMBURSEMENT_DUE'))) ||
      (physicalStatus === FulfillmentStatus.delivered && !hasCustomerReceived)
    ) {
      if (!hasCustomerReceived || integrityBlocking) {
        operationalState = 'EXCEPTION';
      } else {
        operationalState = 'FINANCIALLY_PENDING';
      }
    } else {
      operationalState = 'ACTIVE';
    }

    // Ordinary cash delivered but payment unresolved
    if (
      physicalStatus === FulfillmentStatus.delivered &&
      hasCustomerReceived &&
      !paymentResolved &&
      !flags.includes('RIDER_ADVANCE_REIMBURSEMENT_DUE') &&
      !integrityBlocking
    ) {
      operationalState = 'FINANCIALLY_PENDING';
    }

    return this.projectForRole(role, {
      orderId: order.id,
      operationalState,
      physicalStatus,
      merchantPaymentStatus,
      riderAdvanceStatus: ra?.status ?? null,
      reimbursement: ra
        ? {
            principal: ra.reimbursementPrincipal?.toFixed(2) ?? null,
            settledAmount: settledAmount.toFixed(2),
            remainingAmount: remainingAmount?.toFixed(2) ?? null,
            creditorRiderId: ra.riderId,
            status: ra.status,
          }
        : null,
      custody: {
        customerReceived: hasCustomerReceived,
        returnReceived: hasReturnReceived,
      },
      flags,
      activeRiderId: fulfillment?.activeRiderId ?? null,
    });
  }

  private projectForRole(
    role: 'CUSTOMER' | 'MERCHANT' | 'CREDITOR' | 'ACTIVE_RIDER' | 'ADMIN',
    full: Record<string, unknown> & {
      reimbursement: null | {
        principal: string | null;
        settledAmount: string;
        remainingAmount: string | null;
        creditorRiderId: string;
        status: RiderAdvanceStatus;
      };
      flags: string[];
    },
  ) {
    if (role === 'ADMIN' || role === 'CUSTOMER') {
      return full;
    }
    if (role === 'CREDITOR') {
      // Creditor sees physical/ops + own reimbursement; not merchant payment proof.
      const { merchantPaymentStatus: _mp, ...rest } = full as Record<
        string,
        unknown
      > & { merchantPaymentStatus?: unknown };
      return rest;
    }
    if (role === 'MERCHANT') {
      const { reimbursement, ...rest } = full;
      return {
        ...rest,
        reimbursement: reimbursement
          ? {
              status: reimbursement.status,
              // No settlement proof/refs for merchant
              principalPresent: reimbursement.principal != null,
            }
          : null,
      };
    }
    // ACTIVE_RIDER (delivery/return): minimal
    return {
      orderId: full.orderId,
      operationalState: full.operationalState,
      physicalStatus: full.physicalStatus,
      flags: full.flags.filter((f) =>
        [
          'RETURN_IN_PROGRESS',
          'RETURN_COMPLETED',
          'CUSTODY_TRANSFER_PENDING',
          'ASSIGNMENT_CUSTODY_MISMATCH',
          'DELIVERY_FAILURE_CASE_OPEN',
          'DELIVERY_DISPOSITION_REQUIRED',
          'RESCHEDULE_PENDING',
          'RETURN_MERCHANT_CONFIRMATION_PENDING',
          'OPERATIONS_RECOVERY_REQUIRED',
          'DELIVERY_FAILED_WITHOUT_ATTEMPT',
          'OPERATIONS_RECOVERY_OPEN',
          'CUSTODY_INVESTIGATION_REQUIRED',
          'NO_FURTHER_FULFILLMENT',
          'HOLLOW_RETURNED_WITHOUT_MERCHANT_CUSTODY',
          'PENDING_CUSTODY_TRANSFER_CLEARED',
        ].includes(f),
      ),
      custody: full.custody,
      activeRiderId: full.activeRiderId,
    };
  }

  private async resolveViewerRole(
    order: { id: number; userId: string; merchantId: number },
    fulfillment: { activeRiderId: string | null } | null,
    actorUserId: string,
  ): Promise<
    'CUSTOMER' | 'MERCHANT' | 'CREDITOR' | 'ACTIVE_RIDER' | 'ADMIN' | 'DENIED'
  > {
    if (actorUserId === order.userId) return 'CUSTOMER';
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });
    if (user?.role === UserRole.admin || user?.role === UserRole.staff) {
      return 'ADMIN';
    }
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id: order.merchantId,
        OR: [
          { userId: actorUserId },
          {
            merchantStaff: {
              some: { userId: actorUserId, isActive: true },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (merchant) return 'MERCHANT';

    const ra = await this.prisma.riderAdvance.findFirst({
      where: {
        wkOrderId: order.id,
        riderId: actorUserId,
        status: { not: RiderAdvanceStatus.CANCELLED },
      },
      select: { id: true },
    });
    if (ra) return 'CREDITOR';

    if (fulfillment?.activeRiderId === actorUserId) return 'ACTIVE_RIDER';
    return 'DENIED';
  }
}
