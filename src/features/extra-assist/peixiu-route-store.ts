/**
 * 裴秀路线状态仓：保存当前规划结果供 Vue 面板与游戏内地图视图订阅。
 */

import { PEIXIU_SUIT_META, PEIXIU_SUITS, type PeixiuRewardInfo } from './peixiu-map-model.ts';
import {
  remainingSuitCounts,
  type PeixiuPlannedRoute,
  type PeixiuRouteSolution
} from './peixiu-route-planner.ts';

export interface PeixiuRouteStepView {
  suit: number;
  suitName: string;
  suitMark: string;
  cardName: string;
  from: number;
  to: number;
  cells: readonly number[];
  available: boolean;
  hasWarp: boolean;
}

export interface PeixiuRouteVariantView {
  id: number;
  label: string;
  complete: boolean;
  availableStepCount: number;
  totalStepCount: number;
  rewardCount: number;
  steps: readonly PeixiuRouteStepView[];
  remainingSuits: readonly { suit: number; name: string; mark: string; count: number }[];
}

export interface PeixiuRouteSnapshot {
  active: boolean;
  mapName: string;
  variants: readonly PeixiuRouteVariantView[];
  skills: readonly PeixiuRewardInfo[];
}

export interface PeixiuRouteStore {
  getSnapshot(): Readonly<PeixiuRouteSnapshot>;
  publish(planned: PeixiuPlannedRoute, skills: readonly PeixiuRewardInfo[]): void;
  clear(): void;
  subscribe(listener: (snapshot: Readonly<PeixiuRouteSnapshot>) => void): () => void;
}

const EMPTY_SNAPSHOT: Readonly<PeixiuRouteSnapshot> = Object.freeze({
  active: false,
  mapName: '',
  variants: Object.freeze([]),
  skills: Object.freeze([])
});

const VARIANT_LABELS = ['最佳', '备选一', '备选二'];

export function createPeixiuRouteStore(): PeixiuRouteStore {
  let snapshot = EMPTY_SNAPSHOT;
  let signature = '';
  const listeners = new Set<(value: Readonly<PeixiuRouteSnapshot>) => void>();

  function publish(planned: PeixiuPlannedRoute, skills: readonly PeixiuRewardInfo[]): void {
    const variants = planned.solutions.map((solution, index) => buildVariant(solution, index));
    const nextSignature = JSON.stringify([
      planned.map.id,
      variants.map((variant) => [
        variant.complete,
        variant.rewardCount,
        variant.steps.map((step) => [step.suit, step.cardName, step.available, step.to])
      ]),
      skills.map((skill) => skill.rewardId)
    ]);
    if (signature === nextSignature && snapshot.active) return;
    signature = nextSignature;
    snapshot = Object.freeze({
      active: true,
      mapName: planned.map.name || '裴秀地图',
      variants: Object.freeze(variants),
      skills: Object.freeze(skills.map((skill) => Object.freeze({ ...skill })))
    });
    listeners.forEach((listener) => listener(snapshot));
  }

  function clear(): void {
    if (!snapshot.active) return;
    signature = '';
    snapshot = EMPTY_SNAPSHOT;
    listeners.forEach((listener) => listener(snapshot));
  }

  return {
    getSnapshot: () => snapshot,
    publish,
    clear,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

function buildVariant(solution: PeixiuRouteSolution, index: number): PeixiuRouteVariantView {
  const counts = remainingSuitCounts([solution]);
  const steps = solution.path.filter((step) => step.dir).map((step) => {
    const meta = PEIXIU_SUIT_META[step.dir] ?? { name: '未知', mark: '?', dx: 0, dy: 0 };
    return Object.freeze({
      suit: step.dir,
      suitName: meta.name,
      suitMark: meta.mark,
      cardName: step.card?.displayName || step.card?.name || '无可用牌',
      from: step.from,
      to: step.to,
      cells: Object.freeze([
        ...step.line,
        ...step.specialMoves.flatMap((move) => move.path)
      ]),
      available: step.available !== false && Boolean(step.card),
      hasWarp: step.specialMoves.length > 0
    });
  });
  const availableStepCount = solution.availableStepCount ?? steps.filter((step) => step.available).length;
  return Object.freeze({
    id: index,
    label: VARIANT_LABELS[index] ?? `备选${index}`,
    complete: availableStepCount === steps.length,
    availableStepCount,
    totalStepCount: steps.length,
    rewardCount: solution.valueCount ?? solution.count,
    steps: Object.freeze(steps),
    remainingSuits: Object.freeze(PEIXIU_SUITS.map((suit) => Object.freeze({
      suit,
      name: PEIXIU_SUIT_META[suit].name,
      mark: PEIXIU_SUIT_META[suit].mark,
      count: counts[suit]
    })))
  });
}
