import assert from 'node:assert/strict';
import test from 'node:test';
import {
  merchantDeactivationPayload,
  merchantIsActive,
  merchantReactivationPayload,
} from './merchant-activation';

test('inactive merchant reactivation sends only is_active=true', () => {
  const inactive = { id: 9, is_active: false, status: 'suspended' };
  assert.equal(merchantIsActive(inactive), false);
  const payload = merchantReactivationPayload();
  assert.deepEqual(payload, { is_active: true });
  assert.equal('status' in payload, false);
  assert.equal('suspension_reason' in payload, false);
  assert.equal('suspended_until' in payload, false);
  assert.equal('suspension_duration' in payload, false);
});

test('suspension and deactivation do not send unsupported fields', () => {
  const payload = merchantDeactivationPayload();
  assert.deepEqual(payload, { is_active: false });
  assert.equal('status' in payload, false);
  assert.equal('suspension_reason' in payload, false);
  assert.equal('suspended_until' in payload, false);
  assert.equal('suspension_duration' in payload, false);
});
