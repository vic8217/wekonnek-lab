import assert from 'node:assert/strict';
import test from 'node:test';
import {
  failurePresentation,
  interpretConfirmResponse,
  interpretValidateResponse,
  pickupHandoffBody,
  pickupHandoffUrl,
  publicChecklist,
  quantityLabel,
  retainPickupPayload,
  visibleAddress,
} from './pickup-release';

const previewBody = {
  ok: true,
  preview: {
    tokenId: 'secret-token',
    wkOrderId: 1042,
    orderCode: 'WK-1042',
    rider: { id: 'rider-1', displayName: 'Juan Rider' },
    merchant: { id: 7, name: 'ABC Store' },
    pickup: { name: 'ABC Store - North Branch', address: null },
    items: [
      { productName: 'Product A', quantity: 2, price: '50.00' },
      { productName: 'Product B', quantity: 3, price: '20.00' },
    ],
    itemCount: 5,
  },
};

test('HTTP 201 with ok false is not a valid pickup', () => {
  const result = interpretValidateResponse({
    transportFailed: false,
    status: 201,
    body: { ok: false, code: 'TOKEN_EXPIRED', message: 'Pickup handoff not authorized' },
  });
  assert.equal(result.outcome, 'denied');
  if (result.outcome === 'denied') {
    assert.equal(result.failure.title, 'PICKUP QR EXPIRED');
  }
});

test('successful validation keeps the release checklist and drops prices and ids', () => {
  const result = interpretValidateResponse({
    transportFailed: false,
    status: 201,
    body: previewBody,
  });
  assert.equal(result.outcome, 'accepted');
  if (result.outcome !== 'accepted') return;
  assert.equal(result.checklist.orderCode, 'WK-1042');
  assert.equal(result.checklist.riderName, 'Juan Rider');
  assert.equal(result.checklist.pickupName, 'ABC Store - North Branch');
  assert.equal(result.checklist.pickupAddress, null);
  assert.deepEqual(result.checklist.items, [
    { productName: 'Product A', quantity: 2 },
    { productName: 'Product B', quantity: 3 },
  ]);
  assert.equal(result.checklist.itemCount, 5);
  const rendered = JSON.stringify(result.checklist);
  assert.equal(rendered.includes('50.00'), false);
  assert.equal(rendered.includes('secret-token'), false);
  assert.equal(rendered.includes('rider-1'), false);
  assert.equal(rendered.includes('wkOrderId'), false);
});

test('a null branch address is omitted and not replaced', () => {
  assert.equal(visibleAddress(null), null);
  assert.equal(visibleAddress('null'), null);
  const checklist = publicChecklist({
    pickup: { name: 'ABC Store - North Branch', address: null },
    merchant: { name: 'ABC Store' },
  });
  assert.equal(checklist.pickupAddress, null);
  assert.equal(checklist.merchantName, 'ABC Store');
  assert.equal(visibleAddress(checklist.pickupAddress), null);
});

test('item count is labeled as items', () => {
  assert.equal(quantityLabel(5), '5 items');
  assert.equal(quantityLabel(1), '1 item');
  assert.equal(quantityLabel(5).toLowerCase().includes('package'), false);
});

test('error codes map to safe merchant states', () => {
  assert.equal(failurePresentation('MALFORMED_PAYLOAD').title, 'INVALID PICKUP QR');
  assert.equal(failurePresentation('TOKEN_REVOKED').title, 'PICKUP QR NO LONGER VALID');
  assert.equal(failurePresentation('MERCHANT_UNAUTHORIZED').title, 'PICKUP NOT AUTHORIZED');
  assert.equal(failurePresentation('ASSIGNMENT_CHANGED').title, 'RIDER ASSIGNMENT CHANGED');
  assert.equal(failurePresentation('ORDER_TERMINAL').title, 'PICKUP NOT AVAILABLE');
  assert.equal(failurePresentation('TOKEN_CONSUMED').body, 'Do not create another release.');
  assert.equal(failurePresentation('RIDER_ADVANCE_VENDOR_ACK_REQUIRED').title, 'RELEASE BLOCKED');
  assert.equal(failurePresentation('RIDER_ADVANCE_VENDOR_ACK_REQUIRED').body.includes('amount'), false);
});

test('confirm success and same-merchant replay are releases, not new handoffs', () => {
  const first = interpretConfirmResponse({
    transportFailed: false,
    status: 201,
    body: { ok: true, idempotent: false },
  });
  const replay = interpretConfirmResponse({
    transportFailed: false,
    status: 201,
    body: { ok: true, idempotent: true },
  });
  assert.deepEqual(first, { outcome: 'released', idempotent: false });
  assert.deepEqual(replay, { outcome: 'released', idempotent: true });
});

test('a different user replay is consumed and does not release again', () => {
  const result = interpretConfirmResponse({
    transportFailed: false,
    status: 201,
    body: { ok: false, code: 'TOKEN_CONSUMED' },
  });
  assert.equal(result.outcome, 'denied');
  if (result.outcome === 'denied') {
    assert.equal(result.failure.group, 'consumed');
  }
});

test('rider advance block does not count as a release', () => {
  const result = interpretConfirmResponse({
    transportFailed: false,
    status: 201,
    body: { ok: false, code: 'RIDER_ADVANCE_VENDOR_ACK_REQUIRED' },
  });
  assert.equal(result.outcome, 'denied');
  if (result.outcome === 'denied') assert.equal(result.failure.group, 'advance');
});

test('a lost confirm response stays unknown so the same payload can be retried', () => {
  const lost = interpretConfirmResponse({
    transportFailed: true,
    status: null,
    body: null,
  });
  assert.equal(lost.outcome, 'unknown');
  assert.equal(retainPickupPayload('checking'), true);
  assert.equal(retainPickupPayload('released'), false);
});

test('the client posts only the opaque payload to the handoff endpoints', () => {
  assert.equal(
    pickupHandoffUrl('http://localhost:3000/', 'validate'),
    'http://localhost:3000/api/pickup-handoffs/validate',
  );
  assert.equal(
    pickupHandoffUrl('http://localhost:3000', 'confirm'),
    'http://localhost:3000/api/pickup-handoffs/confirm',
  );
  assert.deepEqual(pickupHandoffBody('WKPH1.token.secret'), { qrPayload: 'WKPH1.token.secret' });
  assert.equal(pickupHandoffUrl('http://localhost:3000', 'confirm').includes('/orders/'), false);
});

test('UCE-3A A: validate URL is distinct from confirm and body has only qrPayload', () => {
  const validate = pickupHandoffUrl('http://localhost:3000', 'validate');
  const confirm = pickupHandoffUrl('http://localhost:3000', 'confirm');
  assert.equal(validate.endsWith('/api/pickup-handoffs/validate'), true);
  assert.equal(confirm.endsWith('/api/pickup-handoffs/confirm'), true);
  assert.notEqual(validate, confirm);
  assert.deepEqual(pickupHandoffBody('WKPH1.abc.def'), { qrPayload: 'WKPH1.abc.def' });
});

test('UCE-3A C: validate denial is not an accepted release checklist', () => {
  for (const code of [
    'TOKEN_EXPIRED',
    'TOKEN_INVALID',
    'MERCHANT_UNAUTHORIZED',
    'ASSIGNMENT_CHANGED',
    'TOKEN_CONSUMED',
  ]) {
    const result = interpretValidateResponse({
      transportFailed: false,
      status: 201,
      body: { ok: false, code },
    });
    assert.equal(result.outcome, 'denied');
  }
});

test('UCE-3A D: confirm denial is not a successful release', () => {
  const denied = interpretConfirmResponse({
    transportFailed: false,
    status: 201,
    body: { ok: false, code: 'TOKEN_EXPIRED' },
  });
  assert.equal(denied.outcome, 'denied');
  const unauthorized = interpretConfirmResponse({
    transportFailed: false,
    status: 403,
    body: { ok: false, code: 'MERCHANT_UNAUTHORIZED' },
  });
  assert.equal(unauthorized.outcome, 'session');
});

test('UCE-3A F: frozen Stage 3 validate preview without pickup/items still presents', () => {
  const result = interpretValidateResponse({
    transportFailed: false,
    status: 201,
    body: {
      ok: true,
      preview: {
        tokenId: 'compat-token',
        wkOrderId: 88,
        orderCode: 'WK-88',
        merchant: { id: 1, name: 'North Shop' },
        rider: { id: 'rider-uuid', displayName: 'Alex Rider' },
        fulfillmentStatus: 'rider_assigned',
        purpose: 'MERCHANT_PICKUP_HANDOFF',
      },
    },
  });
  assert.equal(result.outcome, 'accepted');
  if (result.outcome !== 'accepted') return;
  assert.equal(result.checklist.orderCode, 'WK-88');
  assert.equal(result.checklist.riderName, 'Alex Rider');
  assert.equal(result.checklist.merchantName, 'North Shop');
  assert.equal(result.checklist.pickupName, null);
  assert.equal(result.checklist.pickupAddress, null);
  assert.deepEqual(result.checklist.items, []);
  assert.equal(result.checklist.itemCount, 0);
  const rendered = JSON.stringify(result.checklist);
  assert.equal(rendered.includes('compat-token'), false);
  assert.equal(rendered.includes('rider-uuid'), false);
});

