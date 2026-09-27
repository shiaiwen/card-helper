/** 严教 / 资援的点数计算（对照原版小抄 Ps / Pd），纯函数，不接触游戏对象。 */

const MAX_RANK = 13;
const ZIYUAN_TARGET = 13;
const ZIYUAN_MAX_RESULTS = 15;
const YANJIAO_MIN_RESULTS = 5;

export interface YanjiaoSplit {
  /** 两组点数，左组张数不多于右组。 */
  left: number[];
  right: number[];
  /** 未分组的点数，张数越少越优先。 */
  rest: number[];
}

export function formatRank(rank: number): string {
  return ({ 11: 'J', 12: 'Q', 13: 'K' } as Record<number, string>)[rank] ?? String(rank);
}

export function formatRanks(ranks: readonly number[]): string {
  return ranks.map(formatRank).join('+');
}

/** 资援：手牌中点数之和恰为 13 的所有不重复组合，张数多的优先。 */
export function solveZiyuan(ranks: readonly number[]): number[][] {
  const sorted = validRanks(ranks).sort((left, right) => left - right);
  const results: number[][] = [];
  const walk = (picked: number[], start: number, sum: number) => {
    if (sum === ZIYUAN_TARGET) {
      results.push([...picked]);
      return;
    }
    if (sum > ZIYUAN_TARGET) return;
    for (let index = start; index < sorted.length; index += 1) {
      if (index > start && sorted[index] === sorted[index - 1]) continue;
      picked.push(sorted[index]);
      walk(picked, index + 1, sum + sorted[index]);
      picked.pop();
    }
  };
  walk([], 0, 0);
  return results
    .sort((left, right) => right.length - left.length)
    .slice(0, ZIYUAN_MAX_RESULTS);
}

/**
 * 严教：把亮出的牌分成点数和相等的两组，剩余牌不能有同点数重复。
 * 结果按剩余张数升序；凑够 5 组后在当前剩余张数档位结束。
 */
export function solveYanjiao(ranks: readonly number[]): YanjiaoSplit[] {
  const total = countRanks(validRanks(ranks));
  const halfSum = Math.floor(validRanks(ranks).reduce((sum, rank) => sum + rank, 0) / 2);
  // 按点数和登记所有可取的子集（计数向量，下标 0 为张数）。
  const subsetsBySum = new Map<number, number[][]>([[0, [emptyCounts()]]]);
  for (let rank = 1; rank <= MAX_RANK; rank += 1) {
    const available = total[rank];
    if (!available) continue;
    for (const sum of [...subsetsBySum.keys()].sort((left, right) => right - left)) {
      const bases = subsetsBySum.get(sum)!;
      for (let take = 1; take <= available; take += 1) {
        const nextSum = sum + rank * take;
        if (nextSum > halfSum) break;
        const bucket = subsetsBySum.get(nextSum) ?? [];
        subsetsBySum.set(nextSum, bucket);
        for (const base of bases) {
          const next = [...base];
          next[0] += take;
          next[rank] += take;
          bucket.push(next);
        }
      }
    }
  }
  subsetsBySum.delete(0);

  const splitsByRestCount = new Map<number, [number[], number[], number[]][]>();
  for (const sum of [...subsetsBySum.keys()].sort((left, right) => right - left)) {
    const subsets = subsetsBySum.get(sum)!;
    for (let first = 0; first < subsets.length; first += 1) {
      for (let second = first; second < subsets.length; second += 1) {
        const rest = remainingCounts(total, subsets[first], subsets[second]);
        if (!rest) continue;
        const [left, right] = subsets[first][0] <= subsets[second][0]
          ? [subsets[first], subsets[second]]
          : [subsets[second], subsets[first]];
        const bucket = splitsByRestCount.get(rest[0]) ?? [];
        bucket.push([left, right, rest]);
        splitsByRestCount.set(rest[0], bucket);
      }
    }
  }

  const results: YanjiaoSplit[] = [];
  for (const restCount of [...splitsByRestCount.keys()].sort((left, right) => left - right)) {
    splitsByRestCount.get(restCount)!
      .sort((left, right) => left[0][0] - right[0][0])
      .forEach(([left, right, rest]) => results.push({
        left: expandCounts(left),
        right: expandCounts(right),
        rest: expandCounts(rest)
      }));
    if (results.length >= YANJIAO_MIN_RESULTS) break;
  }
  return results;
}

function validRanks(ranks: readonly number[]): number[] {
  return ranks.filter((rank) => Number.isInteger(rank) && rank >= 1 && rank <= MAX_RANK);
}

function emptyCounts(): number[] {
  return Array(MAX_RANK + 1).fill(0);
}

function countRanks(ranks: readonly number[]): number[] {
  const counts = emptyCounts();
  for (const rank of ranks) {
    counts[0] += 1;
    counts[rank] += 1;
  }
  return counts;
}

/** 剩余计数；出现负数或剩余牌有同点数两张以上时不成立。 */
function remainingCounts(total: readonly number[], left: readonly number[], right: readonly number[]): number[] | null {
  const rest = [...total];
  for (let index = 0; index < rest.length; index += 1) {
    rest[index] -= left[index] + right[index];
    if (rest[index] < 0) return null;
    if (index > 0 && rest[index] >= 2) return null;
  }
  return rest;
}

function expandCounts(counts: readonly number[]): number[] {
  return counts.flatMap((count, rank) => (rank > 0 ? Array(count).fill(rank) : []));
}
