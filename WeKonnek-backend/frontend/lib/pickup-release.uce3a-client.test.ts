import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const frontendRoot = join(process.cwd());

function read(rel: string) {
  return readFileSync(join(frontendRoot, rel), 'utf8');
}

test('UCE-3A A/B: production screen calls frozen validate then confirm separately', () => {
  const src = read('components/merchant/RiderPickupRelease.tsx');
  const validateCall = src.match(/pickupHandoffUrl\(API, 'validate'\)/g) ?? [];
  const confirmCall = src.match(/pickupHandoffUrl\(API, 'confirm'\)/g) ?? [];
  assert.equal(validateCall.length, 1);
  assert.equal(confirmCall.length, 1);
  const validateAt = src.indexOf("pickupHandoffUrl(API, 'validate')");
  const confirmAt = src.indexOf("pickupHandoffUrl(API, 'confirm')");
  assert.equal(validateAt < confirmAt, true);
  assert.match(src, /const validatePayload = useCallback/);
  assert.match(src, /const submitConfirm = async/);
  assert.equal(src.includes('validatePayload') && src.includes('submitConfirm'), true);
  const confirmFn = src.slice(src.indexOf('const submitConfirm'));
  assert.equal(confirmFn.includes("pickupHandoffUrl(API, 'validate')"), false);
});

test('UCE-3A E: confirm buttons are disabled while confirming', () => {
  const src = read('components/merchant/RiderPickupRelease.tsx');
  assert.match(src, /const busy = view\.phase === 'confirming'/);
  assert.match(src, /disabled=\{busy\}/);
  assert.match(src, /if \(inFlightRef\.current\) return;/);
});

test('UCE-3A G: no preview route or sample preview component', () => {
  const screen = read('components/merchant/RiderPickupRelease.tsx');
  const page = read('app/merchant/orders/rider-pickup/page.tsx');
  const layout = read('app/merchant/layout.tsx');
  const orders = read('app/merchant/orders/page.tsx');
  for (const src of [screen, page, layout, orders]) {
    assert.equal(src.includes('rider-pickup/preview'), false);
    assert.equal(src.includes('PickupReleasePreview'), false);
  }
  assert.equal(screen.includes('SAMPLE_CHECKLIST'), false);
});

test('UCE-3A H: no rider PWA dependency', () => {
  const screen = read('components/merchant/RiderPickupRelease.tsx');
  const lib = read('lib/pickup-release.ts');
  const page = read('app/merchant/orders/rider-pickup/page.tsx');
  for (const src of [screen, lib, page]) {
    assert.equal(/WeKonnek-rider-pwa|wekonnek-rider-pwa|localhost:3002/.test(src), false);
  }
});

test('UCE-3A merchant page stays inside the authenticated merchant tree', () => {
  const layout = read('app/merchant/layout.tsx');
  assert.match(layout, /useRequireAuth\(\["merchant"\], "\/merchant"\)/);
  assert.equal(layout.includes('rider-pickup/preview'), false);
  const page = read('app/merchant/orders/rider-pickup/page.tsx');
  assert.match(page, /RiderPickupRelease/);
});
