import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coverageSourceLabel,
  determinationRoleLabel,
  displayServerAmount,
  displayServerField,
  expectedOrderMatches,
} from './authoritative-domain-presentation.ts';

const dir = dirname(fileURLToPath(import.meta.url));

const DOMAIN_PAGES = [
  '../app/admin/exception-claims/[id]/page.tsx',
  '../app/admin/wk-orders/[wkOrderId]/return-financial/page.tsx',
  '../app/admin/wk-orders/[wkOrderId]/rider-advance-reimbursement/page.tsx',
  '../app/admin/exception-financial-obligations/[id]/page.tsx',
  '../app/admin/financial-reconciliation/reviews/[id]/page.tsx',
  './authoritative-domain-api.ts',
  './financial-reconciliation-workflow.ts',
];

const FINANCIAL_MUTATION = [
  'cash-receipts',
  '/acknowledge',
  '/reject',
  '/finalize',
  '/propose',
  '/adjustments',
  'write off',
  'Write off',
  'Mark paid',
  'Admin settle',
  'Force paid',
  'method: \'POST\'',
  'method: "POST"',
  'method: \'PUT\'',
  'method: \'PATCH\'',
  'method: \'DELETE\'',
];

test('display helpers preserve server strings and do not arithmetic', () => {
  assert.equal(displayServerField('100.00'), '100.00');
  assert.equal(displayServerAmount('100.00', 'PHP'), '100.00 PHP');
  assert.equal(displayServerAmount(null, 'PHP'), '—');
  assert.equal(coverageSourceLabel('STAGE9_OBLIGATION'), 'Stage9 obligation');
  assert.equal(
    determinationRoleLabel({ adjustmentOfDeterminationId: 'parent' }),
    'Successor adjustment',
  );
  assert.equal(determinationRoleLabel({}), 'Original determination');
  assert.equal(expectedOrderMatches('10', 10), true);
  assert.equal(expectedOrderMatches('10', 11), false);
  assert.equal(expectedOrderMatches(null, 11), true);
});

test('domain clients and pages expose no financial mutation surface', () => {
  for (const relative of DOMAIN_PAGES) {
    const src = readFileSync(join(dir, relative), 'utf8');
    for (const token of FINANCIAL_MUTATION) {
      if (relative.endsWith('reviews/[id]/page.tsx') && token.startsWith('method:')) {
        continue;
      }
      assert.equal(src.includes(token), false, `${relative} contains ${token}`);
    }
    assert.equal(src.includes('parseFloat'), false, relative);
    assert.equal(src.includes('parseInt'), false, relative);
  }
});

test('review detail uses generation guards and workflow card', () => {
  const src = readFileSync(
    join(dir, '../app/admin/financial-reconciliation/reviews/[id]/page.tsx'),
    'utf8',
  );
  assert.equal(src.includes('isCurrentGeneration'), true);
  assert.equal(src.includes('nextGeneration'), true);
  assert.equal(src.includes('Authoritative workflow'), true);
  assert.equal(src.includes('resolveAuthoritativeWorkflow'), true);
  assert.equal(src.includes('No money action'), true);
  assert.equal(src.includes('Opening a domain page does not settle'), true);
});

test('read pages omit Stage14B-2 mutation controls', () => {
  const claim = readFileSync(
    join(dir, '../app/admin/exception-claims/[id]/page.tsx'),
    'utf8',
  );
  for (const token of [
    'Add evidence',
    'Verify evidence',
    'Create fact',
    'Create determination',
    'Propose',
    'Finalize',
    'Create successor adjustment',
  ]) {
    assert.equal(claim.includes(token), false, token);
  }
  assert.equal(claim.includes('Coverage is not settlement'), true);
  assert.equal(claim.includes('determinationRoleLabel'), true);
  assert.equal(claim.includes('isFinancialReconciliationAdmin'), true);
  assert.equal(claim.includes('role="alert"'), true);

  const stage9 = readFileSync(
    join(dir, '../app/admin/wk-orders/[wkOrderId]/return-financial/page.tsx'),
    'utf8',
  );
  assert.equal(stage9.includes('does not propose, finalize'), true);
  assert.equal(stage9.includes('isCurrentGeneration'), true);

  const stage5 = readFileSync(
    join(dir, '../app/admin/wk-orders/[wkOrderId]/rider-advance-reimbursement/page.tsx'),
    'utf8',
  );
  assert.equal(stage5.includes('cannot claim, acknowledge'), true);

  const stage13 = readFileSync(
    join(dir, '../app/admin/exception-financial-obligations/[id]/page.tsx'),
    'utf8',
  );
  assert.equal(stage13.includes('cannot claim, acknowledge'), true);
  assert.equal(stage13.includes('expectedOrderMatches'), true);
  assert.equal(stage13.includes('Write off'), false);
});

test('domain API module is GET-only', () => {
  const src = readFileSync(join(dir, './authoritative-domain-api.ts'), 'utf8');
  assert.equal(src.includes('adminDomainGet'), true);
  assert.equal(src.includes('method:'), false);
  assert.equal(src.includes('cash-receipts'), false);
});
