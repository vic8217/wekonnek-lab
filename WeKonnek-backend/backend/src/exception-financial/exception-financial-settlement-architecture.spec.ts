/**
 * Stage 13A Exception Obligation Settlement — lightweight architecture locks.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ExceptionFinancialSettlementMethod } from '@prisma/client';
import {
  TRANSFER_METHODS,
  EXCEPTION_FINANCIAL_SETTLEMENT_CODES,
} from './exception-financial-settlement.policy';

describe('Stage 13A exception-financial-settlement architecture', () => {
  const serviceSrc = readFileSync(
    resolve(__dirname, 'exception-financial-settlement.service.ts'),
    'utf8',
  );
  const migrationSrc = readFileSync(
    resolve(
      __dirname,
      '../../prisma/migrations/20260918120000_stage13_exception_obligation_settlement/migration.sql',
    ),
    'utf8',
  );

  it('documents obligation-first then settlement lock order', () => {
    expect(serviceSrc).toMatch(
      /Stage13A:\s*obligation first,\s*then settlement/i,
    );
    expect(serviceSrc).toContain('lockObligation');
    expect(serviceSrc).toContain('lockSettlement');
    // acknowledge path locks obligation before settlement
    const ackIdx = serviceSrc.indexOf('async acknowledge(');
    expect(ackIdx).toBeGreaterThan(-1);
    const ackBlock = serviceSrc.slice(ackIdx, ackIdx + 8000);
    const oblLock = ackBlock.indexOf('lockObligation');
    const setLock = ackBlock.indexOf('lockSettlement');
    expect(oblLock).toBeGreaterThan(-1);
    expect(setLock).toBeGreaterThan(-1);
    expect(oblLock).toBeLessThan(setLock);
  });

  it('never writes RiderAdvanceSettlement tables', () => {
    expect(serviceSrc).not.toMatch(/riderAdvanceSettlement/i);
    expect(serviceSrc).not.toMatch(/rider_advance_settlements/i);
  });

  it('methods enum is only CASH + three transfers', () => {
    expect(Object.values(ExceptionFinancialSettlementMethod).sort()).toEqual(
      ['BANK_TRANSFER', 'CASH', 'DIRECT_TRANSFER', 'MERCHANT_QR'].sort(),
    );
    expect([...TRANSFER_METHODS].sort()).toEqual(
      ['BANK_TRANSFER', 'DIRECT_TRANSFER', 'MERCHANT_QR'].sort(),
    );
    expect(TRANSFER_METHODS.has('CASH')).toBe(false);
  });

  it('hardens ExceptionFinancialObligation economic identity as a Stage13 prerequisite', () => {
    expect(migrationSrc).toMatch(/Stage13 prerequisite integrity hardening/i);
    expect(migrationSrc).toContain(
      'stage13a_exception_obligation_economic_identity_guard',
    );
    expect(migrationSrc).toContain('stage13a_efo_economic_identity_trg');
    expect(migrationSrc).toContain('stage13a_exception_obligation_immutable');
    expect(migrationSrc).not.toMatch(
      /CREATE OR REPLACE FUNCTION stage12_obligation_no_delete/,
    );
  });

  it('hardens obligation status executability authority as a Stage13 prerequisite', () => {
    expect(migrationSrc).toMatch(
      /Stage13 prerequisite executability-authority hardening/i,
    );
    expect(migrationSrc).toContain(
      'stage13a_exception_obligation_status_authority_guard',
    );
    expect(migrationSrc).toContain('stage13a_efo_status_authority_trg');
    expect(migrationSrc).toContain(
      'CANCELLED/WRITTEN_OFF is not an authorized transition',
    );
    expect(serviceSrc).toMatch(/Never writes CANCELLED or WRITTEN_OFF/);
    expect(serviceSrc).toContain('OBLIGATION_NOT_EXECUTABLE');
    expect(serviceSrc).toContain(
      'ExceptionFinancialObligationStatus.CANCELLED',
    );
    expect(serviceSrc).toContain(
      'ExceptionFinancialObligationStatus.WRITTEN_OFF',
    );
    expect(serviceSrc).not.toMatch(
      /status:\s*ExceptionFinancialObligationStatus\.CANCELLED/,
    );
    expect(serviceSrc).not.toMatch(
      /status:\s*ExceptionFinancialObligationStatus\.WRITTEN_OFF/,
    );
  });

  it('exposes required settlement error codes', () => {
    for (const code of [
      'NOT_OBLIGATION_DEBTOR',
      'NOT_OBLIGATION_CREDITOR',
      'CASH_DEBTOR_SELF_ACK_FORBIDDEN',
      'ADMIN_CANNOT_FABRICATE_ACK',
      'OBLIGATION_NOT_EXECUTABLE',
      'RECONCILIATION_REQUIRED',
      'SETTLEMENT_AMOUNT_EXCEEDS_REMAINING',
      'FORBIDDEN_VIEW',
    ]) {
      expect(
        EXCEPTION_FINANCIAL_SETTLEMENT_CODES[
          code as keyof typeof EXCEPTION_FINANCIAL_SETTLEMENT_CODES
        ],
      ).toBe(code);
    }
  });
});
