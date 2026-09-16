/**
 * Stage 9 architecture / policy acceptance (no DB required).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Stage 9 Return Financial architecture', () => {
  const root = resolve(__dirname, '../..');

  it('defines Stage 9 module surface', () => {
    const mod = readFileSync(resolve(__dirname, 'return-financial.module.ts'), 'utf8');
    expect(mod).toMatch(/ReturnFinancialModule/);
    expect(mod).toMatch(/RiderAdvanceCollectibilityService/);
    expect(mod).toMatch(/ReturnFinancialDeterminationService/);
    expect(mod).toMatch(/ReturnFinancialSettlementService/);
    expect(mod).toMatch(/ReturnFinancialResolutionService/);
    expect(mod).toMatch(/ReturnFinancialTermsService/);
  });

  it('documents non-reversal, formula, collectibility, terms, processor boundary in ADR', () => {
    const adr = readFileSync(
      resolve(root, 'docs/adr/0010-return-financial-determination.md'),
      'utf8',
    );
    expect(adr).toMatch(/Historical money NEVER reversed|non-reversal/i);
    expect(adr).toMatch(/P\s*−\s*R|P-R|merchantToRiderRepayment/i);
    expect(adr).toMatch(/customerCollectibleRemaining|collectibility/i);
    expect(adr).toMatch(/RETURN_FINANCIAL_MANUAL_DETERMINATION_REQUIRED|terms/i);
    expect(adr).toMatch(/processor|WeKonnek records only|does not hold/i);
  });

  it('Stage 5B collectibility choke-point is wired', () => {
    const svc = readFileSync(
      resolve(__dirname, '../rider-advance-settlement/rider-advance-settlement.service.ts'),
      'utf8',
    );
    const choke = readFileSync(
      resolve(__dirname, 'rider-advance-collectibility.service.ts'),
      'utf8',
    );
    expect(svc).toMatch(/RiderAdvanceCollectibilityService/);
    expect(svc).toMatch(/assertCollectibleForAmount/);
    expect(choke).toMatch(/CUSTOMER_REIMBURSEMENT_COLLECTION_RESTRICTED/);
  });

  it('app module registers ReturnFinancialModule', () => {
    const app = readFileSync(resolve(__dirname, '../app.module.ts'), 'utf8');
    expect(app).toMatch(/ReturnFinancialModule/);
  });

  it('migration + rollback exist for Stage 9', () => {
    const mig = resolve(
      root,
      'prisma/migrations/20260917010000_stage9_return_financial_determination/migration.sql',
    );
    const rb = resolve(
      root,
      'prisma/migrations/20260917010000_stage9_return_financial_determination/rollback.sql',
    );
    expect(readFileSync(mig, 'utf8')).toMatch(/return_financial_determinations/);
    expect(readFileSync(rb, 'utf8')).toMatch(/DROP TABLE IF EXISTS "return_financial_determinations"/);
  });
});
