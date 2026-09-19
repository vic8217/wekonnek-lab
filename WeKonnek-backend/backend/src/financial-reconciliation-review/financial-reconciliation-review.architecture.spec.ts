import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

const DIR = __dirname;
const SCHEMA = resolve(__dirname, '../../prisma/schema.prisma');

const FORBIDDEN_MONEY = [
  'principal',
  'amountDue',
  'settledAmount',
  'remainingAmount',
  'collectible',
  'coverageAmount',
  'lossAmount',
  'originalPrincipal',
];

const FORBIDDEN_WRITERS = [
  'RiderAdvanceSettlementService',
  'ReturnFinancialSettlementService',
  'ExceptionFinancialSettlementService',
  'ExceptionFinancialService',
  'ReturnFinancialDeterminationService',
];

describe('Stage14A review architecture firewall', () => {
  it('review schema has no authoritative money columns', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    const start = schema.indexOf('model FinancialReconciliationReview');
    expect(start).toBeGreaterThan(0);
    const slice = schema.slice(start);
    for (const key of FORBIDDEN_MONEY) {
      expect(slice.includes(key)).toBe(false);
    }
  });

  it('review migration SQL has no money columns', () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../prisma/migrations/20260919120000_stage14a_financial_reconciliation_review/migration.sql',
      ),
      'utf8',
    );
    for (const key of [
      'principal',
      'amount_due',
      'settled_amount',
      'remaining_amount',
      'collectible',
      'coverage_amount',
      'loss_amount',
    ]) {
      expect(sql.toLowerCase().includes(key)).toBe(false);
    }
  });

  it('review product files do not import frozen financial writers', () => {
    const files = readdirSync(DIR).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'),
    );
    for (const file of files) {
      const src = readFileSync(resolve(DIR, file), 'utf8');
      for (const writer of FORBIDDEN_WRITERS) {
        expect(src.includes(writer)).toBe(false);
      }
      expect(src.includes('FOR UPDATE')).toBe(false);
    }
  });
});
