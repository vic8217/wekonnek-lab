import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_RETURN_HANDOFF_TTL_SECONDS,
  RETURN_OTP_MAX_ATTEMPTS,
} from '../return-handoff/return-token';

/**
 * Architecture / contract checks for Stage 6 operational state.
 * Business matrix evaluation is covered by OrderOperationalStateService
 * PostgreSQL + HTTP suites — do not duplicate derive() here.
 */
describe('Stage 6 operational-state architecture', () => {
  it('documents TTL/OTP constants used by return handoff', () => {
    expect(DEFAULT_RETURN_HANDOFF_TTL_SECONDS).toBe(300);
    expect(RETURN_OTP_MAX_ATTEMPTS).toBe(5);
  });

  it('keeps secure-return authority off public custody HTTP surface', () => {
    const controller = readFileSync(
      join(__dirname, '../agreements/agreements.controller.ts'),
      'utf8',
    );
    expect(controller).not.toMatch(/secureReturnHandoffAuthorized/);
    const custodyHandler = controller.match(
      /@Post\('custody-events'\)[\s\S]*?^\s{2}\}/m,
    )?.[0];
    expect(custodyHandler).toBeTruthy();
    expect(custodyHandler).toMatch(/Explicit construction only/);
    expect(custodyHandler).toMatch(/this\.custody\.record\(/);
    expect(custodyHandler).not.toMatch(/\.\.\.body/);
    expect(custodyHandler).not.toMatch(/trustedSecureMerchantReturn/);
  });

  it('exposes trusted secure-return receipt only as internal service method', () => {
    const custody = readFileSync(
      join(__dirname, '../agreements/custody-event.service.ts'),
      'utf8',
    );
    expect(custody).toMatch(/recordSecureMerchantReturnReceiptInTx/);
    expect(custody).toMatch(/trustedSecureMerchantReturn/);
    expect(custody).not.toMatch(/secureReturnHandoffAuthorized/);
    const publicRecord = custody.match(
      /async record\(input: \{[\s\S]*?\}\)/,
    )?.[0];
    expect(publicRecord).toBeTruthy();
    expect(publicRecord).not.toMatch(/trustedSecureMerchantReturn/);
  });

  it('operational-state service is read-only projection (no status write API)', () => {
    const service = readFileSync(
      join(__dirname, './order-operational-state.service.ts'),
      'utf8',
    );
    const controller = readFileSync(
      join(__dirname, './order-operational-state.controller.ts'),
      'utf8',
    );
    expect(service).toMatch(/async getForOrder/);
    expect(controller).toMatch(/@Get\('orders\/:orderId\/operational-state'\)/);
    expect(controller).not.toMatch(/@Post\(/);
    expect(service).not.toMatch(/operationalStatus/);
  });
});
