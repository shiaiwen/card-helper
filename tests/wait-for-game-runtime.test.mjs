import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMissingGameRuntimeDependencies,
  installRuntimeBridge,
  waitForGameRuntime
} from '../src/runtime/wait-for-game-runtime.mjs';

test('only blocks startup for dependencies required by the panel shell', () => {
  const missing = getMissingGameRuntimeDependencies({
    globalObject: {},
    documentObject: { getElementById: () => null }
  });
  assert.deepEqual(missing, ['SystemContext', 'bgDiv']);
});

test('resource decoders are optional during panel startup', () => {
  assert.deepEqual(getMissingGameRuntimeDependencies({
    globalObject: { SystemContext: {} },
    documentObject: { getElementById: (id) => id === 'bgDiv' ? {} : null }
  }), []);
});

test('PUERTS resource mode does not wait for browser globals', () => {
  assert.deepEqual(getMissingGameRuntimeDependencies({
    globalObject: { PUERTS_JS_RESOURCES: {} },
    documentObject: null
  }), []);
});

test('waits, initializes once, and records ready state', async () => {
  let tick;
  let cleanup;
  let ready = false;
  let initializeCalls = 0;
  const status = {};
  const promise = waitForGameRuntime({
    status,
    probe: () => ready ? [] : ['SystemContext'],
    initialize: () => { initializeCalls += 1; return true; },
    registerCleanup: (callback) => { cleanup = callback; },
    timers: { setInterval: (callback) => { tick = callback; return 1; }, clearInterval: () => {} }
  });

  assert.equal(status.state, 'waiting');
  ready = true;
  tick();
  tick();
  assert.equal(await promise, true);
  assert.equal(status.state, 'ready');
  assert.equal(initializeCalls, 1);
  cleanup();
});

test('cleanup cancels a pending wait', async () => {
  let cleanup;
  const status = {};
  const promise = waitForGameRuntime({
    status,
    probe: () => ['engine'],
    initialize: () => true,
    registerCleanup: (callback) => { cleanup = callback; },
    timers: { setInterval: () => 1, clearInterval: () => {} }
  });
  cleanup();
  assert.equal(await promise, false);
  assert.equal(status.state, 'cancelled');
});

test('installs the runtime bridge without replacing existing fields', () => {
  const target = { __XIAOCHAO_ENGINEERING__: { existing: true } };
  const bridge = installRuntimeBridge(target);
  assert.equal(bridge.existing, true);
  assert.equal(bridge.waitForGameRuntime, waitForGameRuntime);
});
