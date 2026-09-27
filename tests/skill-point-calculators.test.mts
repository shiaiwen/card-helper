import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatRanks,
  solveYanjiao,
  solveZiyuan
} from '../src/features/skill-assist/point-calculators.ts';

describe('资援', () => {
  it('列出点数和为 13 的不重复组合，张数多的优先', () => {
    const combos = solveZiyuan([1, 2, 10, 3, 12, 1]).map(formatRanks);
    assert.deepEqual(combos, ['1+2+10', '1+Q', '3+10']);
  });

  it('无组合时返回空数组', () => {
    assert.deepEqual(solveZiyuan([2, 2, 3]), []);
  });
});

describe('严教', () => {
  it('分成点数和相等的两组，剩余张数少的优先', () => {
    const splits = solveYanjiao([3, 5, 8, 13]);
    assert.deepEqual(splits.slice(0, 2), [
      { left: [13], right: [5, 8], rest: [3] },
      { left: [8], right: [3, 5], rest: [13] }
    ]);
  });

  it('剩余牌里有同点数两张时不成立', () => {
    const splits = solveYanjiao([6, 6, 1, 5, 7]);
    assert.ok(splits.every((split) => new Set(split.rest).size === split.rest.length));
    assert.ok(!splits.some((split) => split.rest.filter((rank) => rank === 6).length > 1));
  });

  it('无法分成等和两组时返回空数组', () => {
    assert.deepEqual(solveYanjiao([1, 2, 4, 8]), []);
  });

  it('J/Q/K 显示为字母，1 保持数字', () => {
    assert.equal(formatRanks([1, 11, 12, 13]), '1+J+Q+K');
  });
});
