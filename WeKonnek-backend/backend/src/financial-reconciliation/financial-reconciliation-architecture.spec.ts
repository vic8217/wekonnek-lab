/**
 * Stage13B-1 architecture locks: read-only, no HTTP, no writer injection.
 */
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import * as ts from 'typescript';
import {
  FINANCIAL_RAIL_IDS,
  RAIL_EXCEPTION_FINANCIAL,
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
} from './financial-reconciliation.types';

const DIR = __dirname;
const PRODUCT_FILES = readdirSync(DIR)
  .filter((name) => name.endsWith('.ts'))
  .filter((name) => !name.endsWith('.spec.ts'))
  .filter((name) => !name.includes('.test-seed.'));

const FORBIDDEN_WRITE_METHODS = new Set([
  'create',
  'update',
  'delete',
  'upsert',
  'createMany',
  'updateMany',
  'deleteMany',
  '$executeRaw',
  '$executeRawUnsafe',
  '$queryRawUnsafe',
]);

const FORBIDDEN_WRITER_SYMBOLS = [
  'RiderAdvanceSettlementService',
  'ReturnFinancialSettlementService',
  'ExceptionFinancialSettlementService',
  'ExceptionFinancialService',
  'RiderAdvanceService',
  'ReturnFinancialDeterminationService',
  'ReturnFinancialResolutionService',
  'RiderAdvanceCollectibilityService',
];

const FORBIDDEN_WRITER_PATHS = [
  'rider-advance-settlement.service',
  'return-financial-settlement.service',
  'exception-financial-settlement.service',
  'exception-financial.service',
  'rider-advance.service',
  'return-financial-determination.service',
];

const FINANCIAL_DELEGATES = [
  'riderAdvance',
  'riderAdvanceSettlement',
  'returnFinancialDetermination',
  'returnFinancialObligation',
  'returnFinancialSettlement',
  'economicLoss',
  'economicLossCoverage',
  'liabilityDetermination',
  'exceptionFinancialObligation',
  'exceptionFinancialSettlement',
  'operationsRecovery',
  'riderAdvanceCollectionRestriction',
];

function productSources(): Array<{ name: string; src: string }> {
  return PRODUCT_FILES.map((name) => ({
    name,
    src: readFileSync(resolve(DIR, name), 'utf8'),
  }));
}

function callName(node: ts.CallExpression): string | null {
  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text;
  }
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  return null;
}

function propertyRoot(expr: ts.Expression): string[] {
  const parts: string[] = [];
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur)) {
    parts.unshift(cur.name.text);
    cur = cur.expression;
  }
  if (ts.isIdentifier(cur)) parts.unshift(cur.text);
  return parts;
}

describe('Stage13B-1 financial-reconciliation architecture', () => {
  it('uses exact canonical rail identifiers', () => {
    expect([...FINANCIAL_RAIL_IDS].sort()).toEqual(
      [
        RAIL_EXCEPTION_FINANCIAL,
        RAIL_RETURN_FINANCIAL,
        RAIL_RIDER_ADVANCE_REIMBURSEMENT,
      ].sort(),
    );
    expect(RAIL_RIDER_ADVANCE_REIMBURSEMENT).toBe(
      'RIDER_ADVANCE_REIMBURSEMENT',
    );
    expect(RAIL_RETURN_FINANCIAL).toBe('RETURN_FINANCIAL');
    expect(RAIL_EXCEPTION_FINANCIAL).toBe('EXCEPTION_FINANCIAL');
  });

  it('Stage5B adapter loads ALL rider advances via findMany, never findFirst', () => {
    const src = readFileSync(
      resolve(DIR, 'rider-advance-reimbursement.adapter.ts'),
      'utf8',
    );
    expect(src).toContain('db.riderAdvance.findMany');
    expect(src).not.toMatch(/riderAdvance\.findFirst/);
  });

  it('creates no HTTP controller or route', () => {
    for (const { name, src } of productSources()) {
      expect(name).not.toMatch(/controller/i);
      expect(src).not.toMatch(/@Controller\s*\(/);
      expect(src).not.toMatch(/@(Get|Post|Patch|Put|Delete)\s*\(/);
    }
    const moduleSrc = readFileSync(
      resolve(DIR, 'financial-reconciliation.module.ts'),
      'utf8',
    );
    expect(moduleSrc).toMatch(/controllers:\s*\[\s*\]/);
  });

  it('does not inject or import financial writer services', () => {
    for (const { name, src } of productSources()) {
      for (const symbol of FORBIDDEN_WRITER_SYMBOLS) {
        expect(`${name}:${src}`).not.toContain(symbol);
      }
      for (const path of FORBIDDEN_WRITER_PATHS) {
        expect(`${name}:${src}`).not.toContain(path);
      }
    }
  });

  it('does not perform financial Prisma writes (AST)', () => {
    const writes: string[] = [];
    for (const { name, src } of productSources()) {
      const sf = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const method = callName(node);
          if (method && FORBIDDEN_WRITE_METHODS.has(method)) {
            if (ts.isPropertyAccessExpression(node.expression)) {
              const chain = propertyRoot(node.expression.expression);
              const delegate = chain[chain.length - 1];
              if (
                FINANCIAL_DELEGATES.includes(delegate ?? '') ||
                method.startsWith('$execute') ||
                method.startsWith('$queryRawUnsafe')
              ) {
                writes.push(`${name}:${method} on ${chain.join('.')}`);
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      expect(src).not.toMatch(
        /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\s*\(/,
      );
      expect(src).not.toMatch(/\$executeRaw(Unsafe)?/);
      expect(src).not.toMatch(/INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i);
    }
    expect(writes).toEqual([]);
  });

  it('never manufactures net order balance or platform parties', () => {
    for (const { src } of productSources()) {
      expect(src).not.toMatch(/orderNetBalance/);
      expect(src).not.toMatch(/type:\s*['"]PLATFORM['"]/);
      expect(src).not.toMatch(/['"]PLATFORM['"]\s+as debtor/);
    }
  });

  it('Stage13B-2 does not persist findings or emit coherent-transfer findings', () => {
    for (const { src } of productSources()) {
      expect(src).not.toMatch(/\bdetectedAt\b/);
      expect(src).not.toMatch(/RA_RETURN_TRANSFER_COHERENT/);
      expect(src).not.toMatch(/ReconciliationFinding\s+table/);
    }
  });

  it('forOrder uses RepeatableRead and does not take writer locks', () => {
    const src = readFileSync(
      resolve(DIR, 'financial-reconciliation.service.ts'),
      'utf8',
    );
    expect(src).toMatch(/TransactionIsolationLevel\.RepeatableRead/);
    expect(src).not.toMatch(/Serializable/);
    expect(src).not.toMatch(/FOR UPDATE/i);
  });
});
