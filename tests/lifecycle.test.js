import assert from 'node:assert/strict';
import test from 'node:test';
import { createLifecycle } from '../src/runtime/lifecycle.js';

test('disposes registered callbacks in reverse order once', () => {
  const calls = [];
  const lifecycle = createLifecycle();
  lifecycle.register(() => calls.push('first'));
  lifecycle.register(() => calls.push('second'));
  lifecycle.dispose();
  lifecycle.dispose();
  assert.deepEqual(calls, ['second', 'first']);
  assert.equal(lifecycle.disposed, true);
  assert.equal(lifecycle.size, 0);
});

test('runs callbacks immediately when registered after disposal', () => {
  let calls = 0;
  const lifecycle = createLifecycle();
  lifecycle.dispose();
  lifecycle.register(() => { calls += 1; });
  assert.equal(calls, 1);
});

test('listen registers matching event removal', () => {
  const operations = [];
  const target = {
    addEventListener: (...args) => operations.push(['add', ...args]),
    removeEventListener: (...args) => operations.push(['remove', ...args])
  };
  const listener = () => {};
  const options = { passive: true };
  const lifecycle = createLifecycle();
  lifecycle.listen(target, 'resize', listener, options);
  lifecycle.dispose();
  assert.deepEqual(operations, [
    ['add', 'resize', listener, options],
    ['remove', 'resize', listener, options]
  ]);
});

test('one cleanup failure does not prevent remaining cleanup', () => {
  const calls = [];
  const errors = [];
  const lifecycle = createLifecycle({ logger: { error: (...args) => errors.push(args) } });
  lifecycle.register(() => calls.push('first'));
  lifecycle.register(() => { throw new Error('broken'); });
  lifecycle.dispose();
  assert.deepEqual(calls, ['first']);
  assert.equal(errors.length, 1);
});
