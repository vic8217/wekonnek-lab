import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ClaimEvidenceKind,
  ClaimEvidenceProvenance,
  EconomicLossCoverageSourceKind,
  EconomicLossKind,
  ExceptionClaimStatus,
  ExceptionClaimType,
  ExceptionLiablePartyType,
  FulfillmentStatus,
  GoodsNonConformanceReasonCode,
  Prisma,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialObligationType,
} from '@prisma/client';
import {
  buildEconomicLossKey,
  buildStage9EconomicScope,
  computeCompensable,
  effectiveStage12CoverageAmount,
  EXCEPTION_CLAIM_ACTIVE_STATUSES,
  EXCEPTION_CLAIM_TERMINAL_STATUSES,
  EXCEPTION_FINANCIAL_CODES,
  EXCEPTION_LIABLE_PARTY_TYPES,
  evaluateNonConformanceLiabilityBasis,
  evaluateNonConformanceReasonForOpen,
  evaluateRecoveryEligibility,
  evaluateStage9FinalizeGate,
  evaluateStage9Stage12OverlapGuard,
  hasBlockingStage9Determination,
  isServerReservedEvidenceKind,
  isStage9ReturnMoneyEligible,
  isTrustedOrderTermsSnapshot,
  lossKindForClaimType,
  maxImportableCoverage,
  presentClaimEvidenceProvenance,
  CLAIM_EVIDENCE_PROVENANCE_API,
  SERVER_RESERVED_CLAIM_EVIDENCE_KINDS,
  remainingCompensable,
  stage9ObligationCoversLossKind,
  stage9OrderMoneyOverlapsSubject,
  stage12SubjectContainedInStage9GoodsScope,
  validateAllocations,
} from './exception-financial.policy';
import { createHash } from 'crypto';

describe('Stage 12 exception-financial architecture', () => {
  it('never allows PLATFORM as a liable party', () => {
    expect(EXCEPTION_LIABLE_PARTY_TYPES).toEqual([
      ExceptionLiablePartyType.CUSTOMER,
      ExceptionLiablePartyType.MERCHANT,
      ExceptionLiablePartyType.RIDER,
    ]);
    expect(Object.keys(ExceptionLiablePartyType)).not.toContain('PLATFORM');
  });

  it('partitions claim statuses into active and terminal with no overlap', () => {
    const overlap = EXCEPTION_CLAIM_ACTIVE_STATUSES.filter((s) =>
      EXCEPTION_CLAIM_TERMINAL_STATUSES.includes(s),
    );
    expect(overlap).toEqual([]);
    expect(
      [
        ...EXCEPTION_CLAIM_ACTIVE_STATUSES,
        ...EXCEPTION_CLAIM_TERMINAL_STATUSES,
      ].sort(),
    ).toEqual(Object.values(ExceptionClaimStatus).sort());
  });

  it('derives economicLossKey as el:{order}:{kind}:{sha256(subject)[0..16]}', () => {
    const subjectRef = 'order-item:42';
    const key = buildEconomicLossKey({
      wkOrderId: 7,
      lossKind: EconomicLossKind.GOODS_LOST,
      subjectRef,
    });
    const expectedHash = createHash('sha256')
      .update(subjectRef)
      .digest('hex')
      .slice(0, 16);
    expect(key).toBe(`el:7:GOODS_LOST:${expectedHash}`);
    expect(expectedHash).toHaveLength(16);
  });

  it('maps every claim type to a loss kind', () => {
    for (const t of Object.values(ExceptionClaimType)) {
      expect(Object.values(EconomicLossKind)).toContain(
        lossKindForClaimType(t),
      );
    }
  });

  it('maps GOODS_NON_CONFORMANCE to GOODS_NON_CONFORMING', () => {
    expect(lossKindForClaimType(ExceptionClaimType.GOODS_NON_CONFORMANCE)).toBe(
      EconomicLossKind.GOODS_NON_CONFORMING,
    );
  });

  it('WRONG_ITEM reason alone never authorizes merchant liability', () => {
    const open = evaluateNonConformanceReasonForOpen({
      claimType: ExceptionClaimType.GOODS_NON_CONFORMANCE,
      nonConformanceReasonCode: GoodsNonConformanceReasonCode.WRONG_ITEM,
    });
    expect(open.ok).toBe(true);
    const basis = evaluateNonConformanceLiabilityBasis({
      claimType: ExceptionClaimType.GOODS_NON_CONFORMANCE,
      allocations: [
        {
          partyType: ExceptionLiablePartyType.MERCHANT,
          partyMerchantId: 1,
          amount: '100.00',
        },
      ],
      facts: [],
    });
    expect(basis.ok).toBe(false);
    if (!basis.ok) {
      expect(basis.code).toBe(
        EXCEPTION_FINANCIAL_CODES.NON_CONFORMANCE_LIABILITY_BASIS_REQUIRED,
      );
    }
  });

  it('never auto-includes fees in compensableAmount', () => {
    const c = computeCompensable({
      orderTotalAmount: '1050.00',
      deliveryFee: '50.00',
      transactionFeeAmount: '10.00',
      claimedAmount: null,
    });
    expect(c.feeComponentAmount.toFixed(2)).toBe('60.00');
    expect(c.goodsValue.toFixed(2)).toBe('990.00');
    expect(c.compensableAmount.toFixed(2)).toBe('990.00');
    // Even an inflated claim cannot reach into fee revenue.
    const inflated = computeCompensable({
      orderTotalAmount: '1050.00',
      deliveryFee: '50.00',
      transactionFeeAmount: '10.00',
      claimedAmount: '5000.00',
    });
    expect(inflated.compensableAmount.toFixed(2)).toBe('990.00');
  });

  it('clamps remaining and importable coverage at zero', () => {
    expect(
      remainingCompensable({
        compensableAmount: '100.00',
        coveredAmount: '140.00',
      }).toFixed(2),
    ).toBe('0.00');
    expect(
      maxImportableCoverage({
        compensableAmount: '100.00',
        alreadyCoveredAmount: '80.00',
        candidateAmount: '50.00',
      }).toFixed(2),
    ).toBe('20.00');
  });

  it('only imports Stage 9 obligations that cover the same economic class', () => {
    expect(
      stage9ObligationCoversLossKind(
        ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
        EconomicLossKind.RIDER_ADVANCE_UNRECOVERED,
      ),
    ).toBe(true);
    expect(
      stage9ObligationCoversLossKind(
        ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
        EconomicLossKind.CUSTOMER_PAYMENT_UNRECOVERED,
      ),
    ).toBe(true);
    // Trust Trade + item-level goods losses are contained in Stage 9 whole-order money.
    expect(
      stage9ObligationCoversLossKind(
        ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
        EconomicLossKind.GOODS_NON_CONFORMING,
      ),
    ).toBe(true);
    expect(
      stage9ObligationCoversLossKind(
        ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
        EconomicLossKind.GOODS_LOST,
      ),
    ).toBe(true);
    // OTHER is outside Stage 9 return economics.
    expect(
      stage9ObligationCoversLossKind(
        ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
        EconomicLossKind.OTHER,
      ),
    ).toBe(false);
  });

  it('Stage 9 WHOLE_ORDER scope contains item-level subjects; exact-only helper does not', () => {
    expect(
      stage9OrderMoneyOverlapsSubject({
        wkOrderId: 42,
        subjectRef: 'order-goods:42',
      }),
    ).toBe(true);
    expect(
      stage9OrderMoneyOverlapsSubject({
        wkOrderId: 42,
        subjectRef: 'order-item:A',
      }),
    ).toBe(false);
    expect(
      stage12SubjectContainedInStage9GoodsScope({
        wkOrderId: 42,
        subjectRef: 'order-item:A',
        goodsScope: 'WHOLE_ORDER',
      }),
    ).toBe(true);
    expect(
      stage12SubjectContainedInStage9GoodsScope({
        wkOrderId: 42,
        subjectRef: 'order-item:A:unit:1',
        goodsScope: 'WHOLE_ORDER',
      }),
    ).toBe(true);
    expect(
      stage12SubjectContainedInStage9GoodsScope({
        wkOrderId: 42,
        subjectRef: 'fee:delivery:42',
        goodsScope: 'WHOLE_ORDER',
      }),
    ).toBe(false);
  });

  it('effective Stage 12 coverage nets write-offs and ignores non-authority sources', () => {
    expect(
      effectiveStage12CoverageAmount([
        {
          sourceKind: EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
          amount: '800.00',
        },
        {
          sourceKind: EconomicLossCoverageSourceKind.ADMIN_WRITE_OFF,
          amount: '800.00',
        },
      ]).toFixed(2),
    ).toBe('0.00');
    expect(
      effectiveStage12CoverageAmount([
        {
          sourceKind: EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
          amount: '800.00',
        },
        {
          sourceKind: EconomicLossCoverageSourceKind.ADMIN_WRITE_OFF,
          amount: '200.00',
        },
      ]).toFixed(2),
    ).toBe('600.00');
    expect(
      effectiveStage12CoverageAmount([
        {
          sourceKind: EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
          amount: '500.00',
        },
      ]).toFixed(2),
    ).toBe('0.00');
  });

  it('Stage 9↔Stage 12 overlap guard blocks contained item-level Stage12 authority', () => {
    const scope = buildStage9EconomicScope({
      wkOrderId: 7,
      path: 'RIDER_ADVANCE',
      grossPrincipal: '800.00',
      merchantToRiderAmount: '800.00',
      merchantToCustomerAmount: '0.00',
      riderAdvanceId: 'ra-1',
    });
    expect(scope.goodsScope).toBe('WHOLE_ORDER');
    expect(scope.includedLossKinds).toContain(EconomicLossKind.GOODS_LOST);

    const blocked = evaluateStage9Stage12OverlapGuard({
      scope,
      losses: [
        {
          id: 'loss-item',
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef: 'order-item:A',
          coverages: [
            {
              sourceKind: EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
              amount: '500.00',
            },
          ],
        },
      ],
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe(
        EXCEPTION_FINANCIAL_CODES.STAGE12_FINANCIAL_AUTHORITY_EXISTS,
      );
    }

    const unrelated = evaluateStage9Stage12OverlapGuard({
      scope,
      losses: [
        {
          id: 'loss-other',
          lossKind: EconomicLossKind.OTHER,
          subjectRef: 'external-event:xyz',
          coverages: [
            {
              sourceKind: EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
              amount: '500.00',
            },
          ],
        },
      ],
    });
    expect(unrelated.ok).toBe(true);
  });

  it('requires strict Stage 11 FINANCIAL_REVIEW_REQUIRED lineage', () => {
    expect(
      evaluateRecoveryEligibility({
        status: 'CLOSED',
        currentDisposition: 'FINANCIAL_REVIEW_REQUIRED',
      }).ok,
    ).toBe(true);
    expect(
      evaluateRecoveryEligibility({
        status: 'DISPOSITION_SELECTED',
        currentDisposition: 'FINANCIAL_REVIEW_REQUIRED',
      }).ok,
    ).toBe(true);
    // No generic open without Stage 11 lineage.
    const genericOpen = evaluateRecoveryEligibility({
      status: 'OPEN',
      currentDisposition: null,
    });
    expect(genericOpen.ok).toBe(false);
    const wrongDisposition = evaluateRecoveryEligibility({
      status: 'CLOSED',
      currentDisposition: 'NO_FURTHER_FULFILLMENT',
    });
    expect(wrongDisposition.ok).toBe(false);
    if (!wrongDisposition.ok) {
      expect(wrongDisposition.code).toBe(
        EXCEPTION_FINANCIAL_CODES.RECOVERY_NOT_ELIGIBLE,
      );
    }
  });

  it('blocks finalize while any Stage 9 determination is undecided', () => {
    for (const status of [
      ReturnFinancialDeterminationStatus.PENDING,
      ReturnFinancialDeterminationStatus.PROPOSED,
      ReturnFinancialDeterminationStatus.ACKNOWLEDGED,
      ReturnFinancialDeterminationStatus.DISPUTED,
    ]) {
      const ctx = {
        stage9Statuses: [status],
        fulfillmentStatus: FulfillmentStatus.delivery_failed,
        hasReturnReceivedCustody: false,
      };
      expect(hasBlockingStage9Determination(ctx)).toBe(true);
      const gate = evaluateStage9FinalizeGate(ctx);
      expect(gate.ok).toBe(false);
      if (!gate.ok) {
        expect(gate.code).toBe(
          EXCEPTION_FINANCIAL_CODES.STAGE9_DETERMINATION_IN_PROGRESS,
        );
      }
    }
  });

  it('blocks finalize while the order is Stage 9 return-money-eligible', () => {
    const ctx = {
      stage9Statuses: [],
      fulfillmentStatus: FulfillmentStatus.returned,
      hasReturnReceivedCustody: true,
    };
    expect(isStage9ReturnMoneyEligible(ctx)).toBe(true);
    const gate = evaluateStage9FinalizeGate(ctx);
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.code).toBe(
        EXCEPTION_FINANCIAL_CODES.STAGE9_RETURN_MONEY_PENDING,
      );
    }
  });

  it('allows finalize once Stage 9 is FINALIZED, or when never eligible', () => {
    expect(
      evaluateStage9FinalizeGate({
        stage9Statuses: [ReturnFinancialDeterminationStatus.FINALIZED],
        fulfillmentStatus: FulfillmentStatus.returned,
        hasReturnReceivedCustody: true,
      }).ok,
    ).toBe(true);
    // Hollow returned (no RETURN_RECEIVED) is not Stage 9 money-eligible.
    expect(
      evaluateStage9FinalizeGate({
        stage9Statuses: [],
        fulfillmentStatus: FulfillmentStatus.returned,
        hasReturnReceivedCustody: false,
      }).ok,
    ).toBe(true);
    expect(
      evaluateStage9FinalizeGate({
        stage9Statuses: [ReturnFinancialDeterminationStatus.CANCELLED],
        fulfillmentStatus: FulfillmentStatus.delivery_failed,
        hasReturnReceivedCustody: false,
      }).ok,
    ).toBe(true);
  });

  it('rejects allocations that do not sum to the total or exceed remaining', () => {
    const base = {
      partyType: ExceptionLiablePartyType.RIDER,
      partyUserId: 'rider-1',
      partyMerchantId: null,
    };
    const mismatch = validateAllocations({
      allocations: [{ ...base, amount: '40.00' }],
      totalLiabilityAmount: '50.00',
      remainingAmount: '100.00',
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.code).toBe(
        EXCEPTION_FINANCIAL_CODES.ALLOCATION_SUM_MISMATCH,
      );
    }

    const overRemaining = validateAllocations({
      allocations: [{ ...base, amount: '150.00' }],
      totalLiabilityAmount: '150.00',
      remainingAmount: '100.00',
    });
    expect(overRemaining.ok).toBe(false);
    if (!overRemaining.ok) {
      expect(overRemaining.code).toBe(
        EXCEPTION_FINANCIAL_CODES.REMAINING_EXCEEDED,
      );
    }

    expect(
      validateAllocations({
        allocations: [
          { ...base, amount: '60.00' },
          {
            partyType: ExceptionLiablePartyType.MERCHANT,
            partyMerchantId: 9,
            partyUserId: null,
            amount: '40.00',
          },
        ],
        totalLiabilityAmount: '100.00',
        remainingAmount: '100.00',
      }).ok,
    ).toBe(true);
  });

  it('rejects party bindings that do not resolve to a merchant or user', () => {
    const noBinding = validateAllocations({
      allocations: [
        {
          partyType: ExceptionLiablePartyType.MERCHANT,
          partyMerchantId: null,
          partyUserId: 'user-1',
          amount: '10.00',
        },
      ],
      totalLiabilityAmount: '10.00',
      remainingAmount: '100.00',
    });
    expect(noBinding.ok).toBe(false);
    if (!noBinding.ok) {
      expect(noBinding.code).toBe(
        EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID,
      );
    }
    expect(
      validateAllocations({
        allocations: [],
        totalLiabilityAmount: '0.00',
        remainingAmount: '100.00',
      }).ok,
    ).toBe(false);
  });

  it('keeps Prisma Decimal money at two places', () => {
    expect(new Prisma.Decimal('10.005').toDecimalPlaces(2).toFixed(2)).toBe(
      '10.01',
    );
  });

  it('ADR 0013 documents lock order, Stage 9 gate and platform exclusion', () => {
    const adr = readFileSync(
      resolve(
        __dirname,
        '../../docs/adr/0013-exception-financial-liability.md',
      ),
      'utf8',
    );
    expect(adr).toMatch(
      /orders[\s\S]*order_fulfillments[\s\S]*operations_recoveries[\s\S]*economic_losses[\s\S]*exception_claims[\s\S]*verified_facts[\s\S]*liability_determinations[\s\S]*exception_financial_obligations/,
    );
    expect(adr).toContain('STAGE9_DETERMINATION_IN_PROGRESS');
    expect(adr).toContain('STAGE9_RETURN_MONEY_PENDING');
    expect(adr).toContain('STAGE12_FINANCIAL_AUTHORITY_EXISTS');
    expect(adr).toContain('STAGE9_STAGE12_REVERSE_RACE_DOUBLE_RECOVERY');
    expect(adr).toContain('STAGE12_ITEM_LEVEL_STAGE9_ORDER_LEVEL_DOUBLE_RECOVERY');
    expect(adr).toContain('Stage9EconomicScope');
    expect(adr).toContain('WHOLE_ORDER');
    expect(adr).toContain('FINANCIAL_REVIEW_REQUIRED');
    expect(adr).toContain('Platform is never liable');
    expect(adr).toContain('never auto-include');
    expect(adr).toContain('Stage 9 integration guard');
  });

  it('Stage 9 finalize documents the Stage 12 reverse-race guard', () => {
    const src = readFileSync(
      resolve(
        __dirname,
        '../return-financial/return-financial-determination.service.ts',
      ),
      'utf8',
    );
    expect(src).toContain('assertNoOverlappingStage12Authority');
    expect(src).toContain('evaluateStage9Stage12OverlapGuard');
    expect(src).toContain('economic_losses');
  });

  it('service documents the Stage 12 invariants it enforces', () => {
    const src = readFileSync(
      resolve(__dirname, './exception-financial.service.ts'),
      'utf8',
    );
    expect(src).toContain('withSerializableRetry');
    expect(src).toContain('Serializable');
    expect(src).toContain('evaluateStage9FinalizeGate');
    expect(src).toContain('importStage9Coverage');
    expect(src).toContain('UserRole.admin');
    // Lock order appears in the documented order.
    expect(src).toMatch(
      /"orders"[\s\S]*"order_fulfillments"[\s\S]*"operations_recoveries"[\s\S]*"economic_losses"[\s\S]*"exception_claims"[\s\S]*"verified_facts"[\s\S]*"liability_determinations"[\s\S]*"exception_financial_obligations"/,
    );
  });

  it('does not import or mutate Stage 9 determination/settlement services', () => {
    const src = readFileSync(
      resolve(__dirname, './exception-financial.service.ts'),
      'utf8',
    );
    expect(src).not.toContain('ReturnFinancialDeterminationService');
    expect(src).not.toContain('ReturnFinancialSettlementService');
    expect(src).not.toContain('ReturnFinancialResolutionService');
    // Stage 9 tables are read-only from Stage 12.
    expect(src).not.toMatch(
      /returnFinancialDetermination\.(create|update|delete)/,
    );
    expect(src).not.toMatch(
      /returnFinancialObligation\.(create|update|delete)/,
    );
  });

  it('migration declares the Stage 12 integrity triggers', () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../prisma/migrations/20260917200000_stage12_exception_financial_liability/migration.sql',
      ),
      'utf8',
    );
    for (const trigger of [
      'stage12_coverage_ceiling_trg',
      'stage12_verified_fact_immutable_upd_trg',
      'stage12_determination_finalized_immutable_trg',
      'stage12_determination_allocation_sum_trg',
      'stage12_allocation_guard_ins_trg',
      'stage12_obligation_reject_platform_trg',
      'stage12_obligation_no_delete_trg',
      'stage12_exception_claim_terminal_immutable_trg',
      'stage12_claim_events_append_only_del_trg',
      'stage12_coverage_append_only_upd_trg',
    ]) {
      expect(sql).toContain(trigger);
    }
    expect(sql).toContain('exception_claims_one_active_per_economic_loss');
    expect(sql).toContain('PLATFORM is never a liable party');
  });

  it('rollback drops every Stage 12 object it created', () => {
    const dir = resolve(
      __dirname,
      '../../prisma/migrations/20260917200000_stage12_exception_financial_liability',
    );
    const sql = readFileSync(resolve(dir, 'migration.sql'), 'utf8');
    const rollback = readFileSync(resolve(dir, 'rollback.sql'), 'utf8');

    const tables = [
      ...sql.matchAll(/CREATE TABLE IF NOT EXISTS "([^"]+)"/g),
    ].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(rollback).toContain(`DROP TABLE IF EXISTS "${table}"`);
    }

    const types = [...sql.matchAll(/CREATE TYPE "([^"]+)"/g)].map((m) => m[1]);
    for (const type of types) {
      expect(rollback).toContain(`DROP TYPE IF EXISTS "${type}"`);
    }

    // Stage 9 / 11 objects must never be dropped by a Stage 12 rollback.
    expect(rollback).not.toContain('return_financial');
    expect(rollback).not.toContain('operations_recoveries');
  });

  it('Stage 11 operations-recovery service is untouched by Stage 12', () => {
    const stage11 = readFileSync(
      resolve(
        __dirname,
        '../operations-recovery/operations-recovery.service.ts',
      ),
      'utf8',
    );
    expect(stage11).not.toContain('ExceptionFinancial');
    expect(stage11).not.toContain('exceptionClaim');
    expect(stage11).not.toContain('economicLoss');
  });

  it('order-operational-state adds Stage 12 flags via read-only queries only', () => {
    const src = readFileSync(
      resolve(
        __dirname,
        '../order-operational-state/order-operational-state.service.ts',
      ),
      'utf8',
    );
    expect(src).toContain("flags.push('CLAIM_OPEN')");
    expect(src).toContain("flags.push('LIABILITY_DETERMINED')");
    expect(src).toContain("flags.push('EXCEPTION_OBLIGATION_PENDING')");
    for (const model of [
      'exceptionClaim',
      'liabilityDetermination',
      'exceptionFinancialObligation',
      'economicLoss',
    ]) {
      expect(src).not.toMatch(
        new RegExp(`${model}\\.(create|update|delete|upsert)`),
      );
    }
  });
});

describe('Stage15A trusted evidence provenance architecture', () => {
  const serviceSrc = readFileSync(
    resolve(__dirname, './exception-financial.service.ts'),
    'utf8',
  );
  const controllerSrc = readFileSync(
    resolve(__dirname, './exception-financial.controller.ts'),
    'utf8',
  );
  const policySrc = readFileSync(
    resolve(__dirname, './exception-financial.policy.ts'),
    'utf8',
  );
  const migrationSql = readFileSync(
    resolve(
      __dirname,
      '../../prisma/migrations/20260921120000_stage15a_trusted_evidence_provenance/migration.sql',
    ),
    'utf8',
  );

  it('reserves only ORDER_TERMS_SNAPSHOT on the generic writer', () => {
    expect(SERVER_RESERVED_CLAIM_EVIDENCE_KINDS).toEqual([
      ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
    ]);
    expect(isServerReservedEvidenceKind(ClaimEvidenceKind.PHOTO_REFERENCE)).toBe(
      false,
    );
    expect(isServerReservedEvidenceKind(ClaimEvidenceKind.SYSTEM_RECORD)).toBe(
      false,
    );
    expect(
      isServerReservedEvidenceKind(ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT),
    ).toBe(true);
  });

  it('does not treat kind alone as trusted', () => {
    expect(
      isTrustedOrderTermsSnapshot(
        ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
        null,
      ),
    ).toBe(false);
    expect(
      isTrustedOrderTermsSnapshot(
        ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
        undefined,
      ),
    ).toBe(false);
    expect(
      isTrustedOrderTermsSnapshot(
        ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
        ClaimEvidenceProvenance.SERVER_ATTESTED_ORDER_TERMS,
      ),
    ).toBe(true);
    expect(
      presentClaimEvidenceProvenance(null),
    ).toBe(CLAIM_EVIDENCE_PROVENANCE_API.LEGACY_UNVERIFIED);
    expect(
      presentClaimEvidenceProvenance(
        ClaimEvidenceProvenance.SERVER_ATTESTED_ORDER_TERMS,
      ),
    ).toBe(CLAIM_EVIDENCE_PROVENANCE_API.SERVER_ATTESTED_ORDER_TERMS);
  });

  it('generic HTTP DTO cannot carry provenance into addEvidence', () => {
    const start = controllerSrc.indexOf(
      "Post('exception-claims/:id/evidence')",
    );
    const end = controllerSrc.indexOf(
      "Post('exception-claims/:id/evidence/:evidenceId/verify')",
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const addBlock = controllerSrc.slice(start, end);
    expect(addBlock).toContain('this.exceptions.addEvidence({');
    expect(addBlock).not.toContain('provenance:');
    expect(addBlock).not.toContain('sourceType:');
    expect(addBlock).not.toContain('serverAttested:');
  });

  it('specialized order-terms path is the only HTTP mutation for snapshots', () => {
    expect(controllerSrc).toContain(
      "Post('exception-claims/:id/order-terms-evidence')",
    );
    expect(controllerSrc).toContain('UserRole.admin');
    expect(serviceSrc).toContain(
      'ClaimEvidenceProvenance.SERVER_ATTESTED_ORDER_TERMS',
    );
    expect(serviceSrc).toContain('persistClaimEvidence');
    expect(serviceSrc).not.toContain('return this.addEvidence(');
  });

  it('does not expand order-terms snapshot content', () => {
    expect(policySrc).toContain("kind: 'ORDER_TERMS_SNAPSHOT'");
    expect(policySrc).not.toContain('customerId: input.customerId');
    expect(policySrc).not.toContain('agreementHash');
  });

  it('migration is additive with nullable provenance and no historical rewrite', () => {
    expect(migrationSql).toContain('ClaimEvidenceProvenance');
    expect(migrationSql).toContain('SERVER_ATTESTED_ORDER_TERMS');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "provenance"');
    expect(migrationSql).not.toMatch(/UPDATE\s+"exception_claim_evidence"/i);
    expect(migrationSql).not.toMatch(/DELETE\s+FROM\s+"exception_claim_evidence"/i);
    expect(migrationSql).not.toMatch(/DEFAULT\s+'SERVER_ATTESTED_ORDER_TERMS'/);
  });
});
