import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSeatOverlayLayout } from '../src/features/seat-display/seat-overlay-layout.ts';

test('八人局按照右二、顶三、左二排列且不包含本家', () => {
  const layout = calculateSeatOverlayLayout(8, { width: 1600, height: 900 });
  assert.equal(layout.length, 7);
  assert.deepEqual(layout.map((position) => position.side), [
    'right', 'right', 'top', 'top', 'top', 'left', 'left'
  ]);
});

test('缩放和像素比换算为 CSS 像素，并过滤无效牌局', () => {
  assert.deepEqual(calculateSeatOverlayLayout(1, { width: 1600, height: 900 }), []);
  const normal = calculateSeatOverlayLayout(2, { width: 1600, height: 900 });
  const highDpi = calculateSeatOverlayLayout(2, {
    width: 1600,
    height: 900,
    scale: 2,
    devicePixelRatio: 2
  });
  assert.deepEqual(highDpi, normal);
});
