const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MessageChannel } = require('node:worker_threads');

function workerWith(windows) {
  const listeners = {};
  const opened = [];
  const context = {
    URL,
    Request,
    Response,
    MessageChannel,
    setTimeout,
    clearTimeout,
    console,
    caches: {},
    self: {
      location: { origin: 'https://app.wekonnek.test' },
      addEventListener: (name, handler) => { listeners[name] = handler; },
      skipWaiting() {},
      registration: {},
      clients: {
        matchAll: async () => windows,
        openWindow: async (url) => { opened.push(url); },
      },
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  vm.runInNewContext(source, context);
  return { click: listeners.notificationclick, opened };
}

async function click(handler, url) {
  let work;
  let closed = false;
  handler({ notification: { data: url === undefined ? {} : { url }, close: () => { closed = true; } }, waitUntil: value => { work = value; } });
  await work;
  return closed;
}

test('an existing WEKONNEK window navigates before it is focused', async () => {
  const calls = [];
  const navigated = { focus: async () => { calls.push('focus'); } };
  const window = { url: 'https://app.wekonnek.test/merchant/dashboard', postMessage: (_message, ports) => ports[0].postMessage({ authenticated: true, portal: 'merchant' }), navigate: async url => { calls.push(`navigate:${url}`); return navigated; }, focus: async () => calls.push('old-focus') };
  const worker = workerWith([window]);
  assert.equal(await click(worker.click, '/merchant/orders?orderId=12'), true);
  assert.deepEqual(calls, ['navigate:https://app.wekonnek.test/merchant/orders?orderId=12', 'focus']);
});

test('no existing WEKONNEK window opens login with the resumable destination', async () => {
  const worker = workerWith([]);
  await click(worker.click, '/customer/orders/12');
  assert.deepEqual(worker.opened, ['/auth/login?redirect=%2Fcustomer%2Forders%2F12']);
});

test('unsafe and missing destinations fall back to root', async () => {
  for (const url of ['https://evil.example', '//evil.example', '/safe\\evil', 'javascript:alert(1)', undefined]) {
    const worker = workerWith([]);
    await click(worker.click, url);
    assert.deepEqual(worker.opened, ['/auth/login?redirect=%2F']);
  }
});

test('the matching shop window wins over another authenticated merchant window', async () => {
  const calls = [];
  const shop = { url: 'https://app.wekonnek.test/shop/dashboard', postMessage: (_message, ports) => ports[0].postMessage({ authenticated: true, portal: 'shop', shopId: 22 }), navigate: async url => { calls.push(`shop:${url}`); return shop; }, focus: async () => calls.push('shop:focus') };
  const merchant = { url: 'https://app.wekonnek.test/merchant/dashboard', postMessage: (_message, ports) => ports[0].postMessage({ authenticated: true, portal: 'merchant' }), navigate: async url => { calls.push(`merchant:${url}`); return merchant; }, focus: async () => calls.push('merchant:focus') };
  const worker = workerWith([merchant, shop]);
  await click(worker.click, '/merchant/orders?shopId=22&orderId=41');
  assert.deepEqual(calls, ['shop:https://app.wekonnek.test/shop/orders?shopId=22&orderId=41', 'shop:focus']);
});

test('a different active shop resumes the target after shop authentication', async () => {
  const calls = [];
  const shop = { url: 'https://app.wekonnek.test/shop/dashboard', postMessage: (_message, ports) => ports[0].postMessage({ authenticated: true, portal: 'shop', shopId: 11 }), navigate: async url => { calls.push(url); return shop; }, focus: async () => calls.push('focus') };
  const worker = workerWith([shop]);
  await click(worker.click, '/merchant/orders?shopId=22&orderId=41');
  assert.deepEqual(calls, ['https://app.wekonnek.test/shop?redirect=%2Fshop%2Forders%3FshopId%3D22%26orderId%3D41', 'focus']);
});
