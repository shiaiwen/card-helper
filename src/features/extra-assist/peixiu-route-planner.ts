import {
  PEIXIU_SUIT_META,
  PEIXIU_SUITS,
  cellAt,
  cellCoord,
  classifyCardName,
  isBoardCell,
  normalizeCell,
  parsePeixiuMapConfig,
  type PeixiuCardKind,
  type PeixiuHandCard,
  type PeixiuMapConfig,
  type PeixiuRewardCell,
  type PeixiuSpecialCell
} from './peixiu-map-model.ts';

export interface PeixiuPlannerInput {
  startCell?: number;
  collectedCells?: number[];
  triggeredCells?: number[];
  includeStartAsCollected?: boolean;
  valuableOnly?: boolean;
  forcedFirstDirection?: number;
  maxSolutions?: number;
  handCards?: readonly PeixiuHandCard[];
  suitCounts?: readonly number[];
  remainingSha?: number;
  jiuLimit?: number;
  peachLimit?: number;
  shandianLimit?: number;
  hasZhugeEquipped?: boolean;
  hp?: number | null;
  maxHp?: number | null;
  forcedFirstCardKey?: string;
  selectedCardKey?: string;
}

export interface PeixiuSpecialMove {
  triggerCell: number;
  from: number;
  to: number;
  dir: number;
  steps: number;
  path: number[];
}

export interface PeixiuRouteStep {
  dir: number;
  from: number;
  to: number;
  line: number[];
  specialMoves: PeixiuSpecialMove[];
  triggeredMask: number;
  gainedMask?: number;
  card?: PeixiuHandCard;
  available?: boolean;
}

export interface PeixiuRouteSolution {
  pos: number;
  mask: number;
  count: number;
  valueCount?: number;
  triggeredMask: number;
  path: PeixiuRouteStep[];
  availableStepCount?: number;
}

export interface PeixiuPlannedRoute {
  map: PeixiuMapConfig;
  solution: PeixiuRouteSolution;
  solutions: PeixiuRouteSolution[];
  complete: boolean;
  valuableMask: number;
  shortest: SearchResult;
  shortestDepth: number;
}

export interface PeixiuSegment {
  from: number;
  to: number;
  special: boolean;
  step: PeixiuRouteStep;
}

interface SearchNode {
  pos: number;
  mask: number;
  count: number;
  depth: number;
  parent: SearchNode | null;
  step: PeixiuRouteStep | null;
  triggeredMask: number;
  stateKey: string;
}

interface SearchContext {
  map: PeixiuMapConfig;
  rewardIndex: Map<number, number>;
  goalMask: number;
  startMask: number;
  valuableMask: number;
  triggeredMask: number;
}

interface SearchResult {
  map: PeixiuMapConfig;
  solution: PeixiuRouteSolution;
  solutions: PeixiuRouteSolution[];
  complete: boolean;
  targetMask: number;
  startMask: number;
  valuableMask: number;
}

interface CardGroup {
  key: string;
  suit: number;
  kind: PeixiuCardKind;
  cards: PeixiuHandCard[];
  total: number;
}

interface PlayBudget {
  remainingSha: number;
  jiuLeft: number;
  peachLeft: number;
  hasZhuge: boolean;
  shandianLeft: number;
}

function bitCount(mask: number): number {
  let count = 0;
  let value = mask;
  while (value) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

function walkDirection(from: number, suit: number, cells: Set<number>): number[] {
  const meta = PEIXIU_SUIT_META[suit];
  const path: number[] = [];
  if (!meta) return path;
  const start = cellCoord(from);
  for (let step = 1; step <= 4; step += 1) {
    const next = cellAt(start.row + meta.dy * step, start.col + meta.dx * step);
    if (!next || !cells.has(next)) break;
    path.push(next);
  }
  return path;
}

function forcedWarp(from: number, special: PeixiuSpecialCell, map: PeixiuMapConfig): {
  dir: number;
  steps: number;
  path: number[];
  end: number;
} | null {
  const meta = PEIXIU_SUIT_META[special.param1];
  const steps = Number(special.param2) || 0;
  if (!meta || steps <= 0) return null;
  const start = cellCoord(from);
  const path: number[] = [];
  let end = from;
  for (let step = 1; step <= steps; step += 1) {
    const next = cellAt(start.row + meta.dy * step, start.col + meta.dx * step);
    if (!next || !map.cells.has(next)) break;
    path.push(next);
    end = next;
  }
  return { dir: special.param1, steps, path, end };
}

function applyMove(
  from: number,
  suit: number,
  map: PeixiuMapConfig,
  rewardIndex: Map<number, number>,
  collectedMask = 0,
  triggeredMask = 0
): { pos: number; mask: number; step: PeixiuRouteStep } | null {
  const line = walkDirection(from, suit, map.cells);
  if (!line.length) return null;
  let pos = line[line.length - 1];
  let mask = Number(collectedMask) || 0;
  let triggered = Number(triggeredMask) || 0;
  const specialMoves: PeixiuSpecialMove[] = [];
  const pending: number[] = [];

  const collect = (cells: number[]) => {
    for (const cell of cells) {
      const special = map.specials.get(cell);
      if (Number(special?.effect) === 3) {
        const bit = 1 << (cell - 1);
        if (!(triggered & bit)) {
          triggered |= bit;
          pending.push(cell);
        }
      }
      const index = rewardIndex.get(cell);
      if (index === undefined) continue;
      const rewardBit = 1 << index;
      if (mask & rewardBit) continue;
      mask |= rewardBit;
    }
  };

  collect(line);
  while (pending.length) {
    const triggerCell = pending.shift()!;
    const special = map.specials.get(triggerCell);
    if (!special) continue;
    const warp = forcedWarp(pos, special, map);
    if (!warp || warp.end === pos) continue;
    const fromCell = pos;
    pos = warp.end;
    collect(warp.path);
    specialMoves.push({
      triggerCell,
      from: fromCell,
      to: warp.end,
      dir: warp.dir,
      steps: warp.steps,
      path: warp.path
    });
  }

  return {
    pos,
    mask: mask & ~collectedMask,
    step: {
      dir: suit,
      from,
      to: pos,
      line,
      specialMoves,
      triggeredMask: triggered
    }
  };
}

function neighbors(
  pos: number,
  context: SearchContext,
  collectedMask: number,
  triggeredMask: number
): Array<{ pos: number; mask: number; step: PeixiuRouteStep }> {
  return PEIXIU_SUITS
    .map((suit) => applyMove(pos, suit, context.map, context.rewardIndex, collectedMask, triggeredMask))
    .filter((item): item is { pos: number; mask: number; step: PeixiuRouteStep } => !!item);
}

function rebuildPath(node: SearchNode): PeixiuRouteSolution {
  const path: PeixiuRouteStep[] = [];
  for (let cursor: SearchNode | null = node; cursor?.parent; cursor = cursor.parent) {
    if (cursor.step) path.push(cursor.step);
  }
  path.reverse();
  return {
    pos: node.pos,
    mask: node.mask,
    count: node.count,
    valueCount: node.count,
    triggeredMask: node.triggeredMask || 0,
    path
  };
}

function directionSignature(solution: PeixiuRouteSolution | null | undefined): string {
  return (solution?.path || []).map((step) => step?.dir || 0).join(',');
}

function hasState(node: SearchNode | null, stateKey: string): boolean {
  for (let cursor = node; cursor; cursor = cursor.parent) {
    if (cursor.stateKey === stateKey) return true;
  }
  return false;
}

function rewardIndexOf(map: PeixiuMapConfig): Map<number, number> {
  const index = new Map<number, number>();
  map.rewardCells.forEach((cell, order) => index.set(cell, order));
  return index;
}

function collectedMaskOf(cells: number[], index: Map<number, number>): number {
  let mask = 0;
  for (const cell of cells) {
    const order = index.get(cell);
    if (order !== undefined) mask |= 1 << order;
  }
  return mask;
}

function triggeredMaskOf(map: PeixiuMapConfig, cells: number[]): number {
  let mask = 0;
  for (const cell of cells) {
    const normalized = normalizeCell(cell);
    if (isBoardCell(normalized) && Number(map.specials.get(normalized)?.effect) === 3) {
      mask |= 1 << (normalized - 1);
    }
  }
  return mask;
}

function isHealingReward(reward: PeixiuRewardCell | null, special: PeixiuSpecialCell | undefined): boolean {
  if (Number(special?.effect) === 2) return true;
  if (!reward) return false;
  if (reward.isHealing) return true;
  return /heal|recover|health|hp|回复|体力/i.test(String(reward.type ?? ''));
}

function isCardReward(reward: PeixiuRewardCell | null, special: PeixiuSpecialCell | undefined): boolean {
  if (Number(special?.effect) === 1) return true;
  if (!reward) return false;
  if (reward.isCard) return true;
  return /card|牌|hand|draw/i.test(String(reward.type ?? ''));
}

function rewardAt(map: PeixiuMapConfig, cell: number): PeixiuRewardCell | null {
  return map.rewards.find((item) => normalizeCell(item.cell) === normalizeCell(cell)) ?? null;
}

function valuableMaskOf(map: PeixiuMapConfig, index: Map<number, number>, input: PeixiuPlannerInput): number {
  const hp = Number(input.hp);
  const maxHp = Number(input.maxHp);
  const full = Number.isFinite(hp) && Number.isFinite(maxHp) && maxHp > 0 && hp >= maxHp;
  let mask = 0;
  for (const cell of map.rewardCells) {
    const order = index.get(cell);
    if (order === undefined) continue;
    const special = map.specials.get(cell);
    const skipHeal = full && isHealingReward(rewardAt(map, cell), special);
    if (Number(special?.effect) !== 3 && !skipHeal) mask |= 1 << order;
  }
  return mask;
}

function prepareContext(raw: unknown, input: PeixiuPlannerInput): SearchContext {
  const map = parsePeixiuMapConfig(raw);
  if (!map) {
    return {
      map: {
        id: 0,
        name: '',
        cells: new Set(),
        start: 0,
        specials: new Map(),
        rewards: [],
        rewardCells: [],
        color: 0
      },
      rewardIndex: new Map(),
      goalMask: 0,
      startMask: 0,
      valuableMask: 0,
      triggeredMask: 0
    };
  }
  const start = normalizeCell(input.startCell ?? map.start);
  if (isBoardCell(start)) map.start = start;
  const index = rewardIndexOf(map);
  const collected = Array.isArray(input.collectedCells)
    ? input.collectedCells.map(normalizeCell)
    : [];
  const startMask = input.includeStartAsCollected === false
    ? collectedMaskOf(collected, index)
    : collectedMaskOf([map.start, ...collected], index);
  const triggeredSource = Array.isArray(input.triggeredCells) ? input.triggeredCells : collected;
  return {
    map,
    rewardIndex: index,
    goalMask: map.rewardCells.length ? (1 << map.rewardCells.length) - 1 : 0,
    startMask,
    valuableMask: valuableMaskOf(map, index, input),
    triggeredMask: triggeredMaskOf(map, [start, ...triggeredSource])
  };
}

function searchMap(raw: unknown, input: PeixiuPlannerInput = {}): SearchResult {
  const context = prepareContext(raw, input);
  const targetMask = input.valuableOnly ? context.valuableMask : context.goalMask;
  const forced = PEIXIU_SUITS.includes(Number(input.forcedFirstDirection) as 1 | 2 | 3 | 4)
    ? Number(input.forcedFirstDirection)
    : 0;
  const forcedMove = forced
    ? applyMove(context.map.start, forced, context.map, context.rewardIndex, context.startMask, context.triggeredMask)
    : null;
  const forcedUnavailable = !!forced && !forcedMove;
  const dummyFirst: PeixiuRouteStep | null = forcedUnavailable
    ? {
      dir: forced,
      from: context.map.start,
      to: context.map.start,
      line: [],
      specialMoves: [],
      triggeredMask: context.triggeredMask,
      gainedMask: 0
    }
    : null;
  const root: SearchNode = {
    pos: context.map.start,
    mask: context.startMask,
    count: bitCount(context.startMask),
    depth: 0,
    parent: null,
    step: null,
    triggeredMask: context.triggeredMask,
    stateKey: `${context.map.start}:${context.startMask}:${context.triggeredMask}`
  };
  const queue: SearchNode[] = [root];
  const seen = new Map<string, number>([[root.stateKey, 1]]);
  const found: SearchNode[] = [];
  const maxSolutions = Math.max(2, Number(input.maxSolutions) || 2);

  for (let index = 0; index < queue.length && index < 100000; index += 1) {
    const node = queue[index];
    if ((node.mask & targetMask) === targetMask) {
      found.push(node);
      if (found.length >= maxSolutions) break;
      continue;
    }
    for (const next of neighbors(node.pos, context, node.mask, node.triggeredMask)) {
      if (node.depth === 0 && forced && !forcedUnavailable && next.step.dir !== forced) continue;
      const mask = node.mask | next.mask;
      const triggered = next.step.triggeredMask || node.triggeredMask;
      const stateKey = `${next.pos}:${mask}:${triggered}`;
      if (hasState(node, stateKey) || (seen.get(stateKey) || 0) >= maxSolutions) continue;
      seen.set(stateKey, (seen.get(stateKey) || 0) + 1);
      queue.push({
        pos: next.pos,
        mask,
        count: bitCount(mask),
        depth: node.depth + 1,
        parent: node,
        step: { ...next.step, gainedMask: mask & ~node.mask },
        triggeredMask: triggered,
        stateKey
      });
    }
  }

  const candidates = found.length
    ? found
    : [...queue].sort((left, right) => (
      bitCount(right.mask & targetMask) - bitCount(left.mask & targetMask)
      || left.depth - right.depth
    ));
  const solutions: PeixiuRouteSolution[] = [];
  const signatures = new Set<string>();
  for (const node of candidates) {
    const rebuilt = rebuildPath(node);
    if (dummyFirst) rebuilt.path.unshift(dummyFirst);
    const signature = directionSignature(rebuilt);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    solutions.push(rebuilt);
    if (solutions.length >= maxSolutions) break;
  }
  const best = solutions[0] || rebuildPath(root);
  return {
    map: context.map,
    solution: best,
    solutions: solutions.length ? solutions : [best],
    complete: (best.mask & targetMask) === targetMask,
    targetMask,
    startMask: context.startMask,
    valuableMask: context.valuableMask
  };
}

function normalizeHand(input: PeixiuPlannerInput): PeixiuHandCard[] {
  let cards = Array.isArray(input.handCards)
    ? input.handCards.map((card, index) => ({
      key: String(card?.key ?? card?.id ?? `card-${index}`),
      id: Number(card?.id) || 0,
      suit: Number(card?.suit ?? 0) || 0,
      name: String(card?.name || card?.displayName || '牌'),
      displayName: String(card?.displayName || card?.name || '牌'),
      kind: card?.kind || classifyCardName(card?.name || card?.displayName || ''),
      playable: card?.playable !== false,
      selected: !!card?.selected
    }))
    : [];
  if (!cards.length && Array.isArray(input.suitCounts)) {
    const counts = input.suitCounts;
    cards = PEIXIU_SUITS.flatMap((suit) => (
      Array.from({ length: Math.max(0, Number(counts[suit]) || 0) }, (_, index) => ({
        key: `suit-${suit}-${index}`,
        id: 0,
        suit,
        name: `${PEIXIU_SUIT_META[suit].name}牌`,
        displayName: `${PEIXIU_SUIT_META[suit].mark}牌${index + 1}`,
        kind: 'other' as const,
        playable: true,
        selected: false
      }))
    ));
  }
  const forcedKey = String(input.forcedFirstCardKey || input.selectedCardKey || '');
  cards = cards.filter((card) => (
    card.playable && card.kind !== 'unusable' && PEIXIU_SUITS.includes(card.suit as 1 | 2 | 3 | 4)
  ));
  const groups = new Map<string, PeixiuHandCard[]>();
  for (const card of cards) {
    const key = `${card.suit}:${card.kind}`;
    const list = groups.get(key) ?? [];
    list.push(card);
    groups.set(key, list);
  }
  const kindOrder: Record<string, number> = {
    other: 0,
    zhuge: 1,
    tao: 2,
    jiu: 3,
    sha: 4,
    shandian: 5
  };
  return [...groups.values()].flatMap((group) => {
    group.sort((left, right) => (
      Number(right.key === forcedKey) - Number(left.key === forcedKey)
      || left.id - right.id
      || left.key.localeCompare(right.key)
    ));
    return group;
  }).sort((left, right) => (
    left.suit - right.suit || (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9)
  ));
}

function groupHand(input: PeixiuPlannerInput): CardGroup[] {
  const cards = normalizeHand(input);
  const groups = new Map<string, PeixiuHandCard[]>();
  const forcedKey = String(input.forcedFirstCardKey || input.selectedCardKey || '');
  for (const card of cards) {
    const key = `${card.suit}:${card.kind}`;
    const list = groups.get(key) ?? [];
    list.push(card);
    groups.set(key, list);
  }
  const kindOrder: Record<string, number> = {
    other: 0,
    zhuge: 1,
    tao: 2,
    jiu: 3,
    sha: 4,
    shandian: 5
  };
  return [...groups.entries()].map(([key, list]) => {
    list.sort((left, right) => (
      Number(right.key === forcedKey) - Number(left.key === forcedKey)
      || left.id - right.id
      || left.key.localeCompare(right.key)
    ));
    return { key, suit: list[0].suit, kind: list[0].kind, cards: list, total: list.length };
  }).sort((left, right) => (
    left.suit - right.suit || (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9)
  ));
}

function consumeCard(budget: PlayBudget, card: PeixiuHandCard): PlayBudget | null {
  let remainingSha = budget.remainingSha;
  let jiuLeft = budget.jiuLeft;
  let peachLeft = budget.peachLeft;
  let hasZhuge = budget.hasZhuge;
  let shandianLeft = budget.shandianLeft;
  if (card.kind === 'sha') {
    if (!hasZhuge && !(remainingSha > 0)) return null;
    if (!hasZhuge && remainingSha !== Infinity) remainingSha -= 1;
  } else if (card.kind === 'jiu') {
    if (!(jiuLeft > 0)) return null;
    jiuLeft -= 1;
  } else if (card.kind === 'tao') {
    if (!(peachLeft > 0)) return null;
    peachLeft -= 1;
  } else if (card.kind === 'shandian') {
    if (!(shandianLeft > 0)) return null;
    shandianLeft -= 1;
  } else if (card.kind === 'zhuge') {
    hasZhuge = true;
  }
  return { remainingSha, jiuLeft, peachLeft, hasZhuge, shandianLeft };
}

function assignCards(solution: PeixiuRouteSolution, input: PeixiuPlannerInput = {}): PeixiuRouteSolution {
  const groups = groupHand(input);
  const remaining = groups.map((group) => group.total);
  const remainingSha = input.remainingSha === Infinity
    ? Infinity
    : Number.isFinite(Number(input.remainingSha))
      ? Math.max(0, Number(input.remainingSha))
      : 99;
  const budget: PlayBudget = {
    remainingSha,
    jiuLeft: Number.isFinite(Number(input.jiuLimit ?? 1)) ? Math.max(0, Number(input.jiuLimit ?? 1)) : 1,
    peachLeft: Number.isFinite(Number(input.peachLimit)) ? Math.max(0, Number(input.peachLimit)) : 0,
    hasZhuge: !!input.hasZhugeEquipped,
    shandianLeft: Number.isFinite(Number(input.shandianLimit)) ? Math.max(0, Number(input.shandianLimit)) : 1
  };
  const forcedKey = String(input.forcedFirstCardKey || input.selectedCardKey || '');
  const steps = solution?.path || [];
  const cache = new Map<string, { path: PeixiuRouteStep[]; availableStepCount: number }>();

  const restUnavailable = (from: number) => (
    steps.slice(from).map((step) => ({ ...step, available: false }))
  );

  const search = (
    index: number,
    leftover: number[],
    current: PlayBudget
  ): { path: PeixiuRouteStep[]; availableStepCount: number } => {
    if (index >= steps.length) return { path: [], availableStepCount: 0 };
    const step = steps[index];
    if (!step?.dir) return { path: restUnavailable(index), availableStepCount: 0 };
    const cacheKey = [
      index,
      leftover.join(','),
      current.remainingSha === Infinity ? 'I' : current.remainingSha,
      current.jiuLeft,
      current.peachLeft,
      current.hasZhuge ? 1 : 0,
      current.shandianLeft
    ].join(':');
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    let best: { path: PeixiuRouteStep[]; availableStepCount: number } | null = null;
    groups.forEach((group, groupIndex) => {
      if (group.suit !== step.dir || leftover[groupIndex] <= 0) return;
      const card = group.cards[group.total - leftover[groupIndex]];
      if (index === 0 && forcedKey && card?.key !== forcedKey) return;
      const nextBudget = consumeCard(current, card);
      if (!nextBudget) return;
      const nextLeft = leftover.slice();
      nextLeft[groupIndex] -= 1;
      const rest = search(index + 1, nextLeft, nextBudget);
      const candidate = {
        path: [{ ...step, card, available: true }, ...rest.path],
        availableStepCount: 1 + rest.availableStepCount
      };
      if (!best || candidate.availableStepCount > best.availableStepCount) best = candidate;
    });
    const result = best || { path: restUnavailable(index), availableStepCount: 0 };
    cache.set(cacheKey, result);
    return result;
  };

  return { ...solution, ...search(0, remaining, budget) };
}

function firstCardStep(solution: PeixiuRouteSolution, map: PeixiuMapConfig): number {
  const path = Array.isArray(solution?.path) ? solution.path : [];
  for (let index = 0; index < path.length; index += 1) {
    const step = path[index];
    if (!step?.gainedMask) continue;
    const gained = (map.rewardCells || []).filter((_, order) => step.gainedMask! & (1 << order));
    if (gained.some((cell) => isCardReward(rewardAt(map, cell), map.specials.get(cell)))) {
      return index + 1;
    }
  }
  return Infinity;
}

function compareAssigned(
  left: { solution: PeixiuRouteSolution; valueCount: number },
  right: { solution: PeixiuRouteSolution; valueCount: number },
  map: PeixiuMapConfig
): number {
  const leftLen = left.solution?.path?.length ?? Infinity;
  const rightLen = right.solution?.path?.length ?? Infinity;
  if (leftLen !== rightLen) return leftLen - rightLen;
  const leftAvail = Number(left.solution?.availableStepCount) || 0;
  const rightAvail = Number(right.solution?.availableStepCount) || 0;
  if (leftAvail !== rightAvail) return rightAvail - leftAvail;
  const leftCard = firstCardStep(left.solution, map);
  const rightCard = firstCardStep(right.solution, map);
  if (leftCard !== rightCard) return leftCard - rightCard;
  if (left.valueCount !== right.valueCount) return right.valueCount - left.valueCount;
  return 0;
}

export function forcedFirstDirection(input: PeixiuPlannerInput = {}): number {
  const key = String(input.forcedFirstCardKey || input.selectedCardKey || '');
  if (!key) return 0;
  const group = groupHand(input).find((item) => item.cards.some((card) => card.key === key));
  return PEIXIU_SUITS.includes(group?.suit as 1 | 2 | 3 | 4) ? Number(group?.suit) : 0;
}

export function planPeixiuRoute(raw: unknown, input: PeixiuPlannerInput = {}): PeixiuPlannedRoute | null {
  const map = parsePeixiuMapConfig(raw);
  if (!map) return null;
  const forced = forcedFirstDirection(input);
  const searchInput = { ...input, maxSolutions: 32 };
  let shortest = searchMap(raw, { ...searchInput, forcedFirstDirection: forced });
  if (forced && !shortest.complete) {
    const fallback = searchMap(raw, searchInput);
    if (fallback.complete) shortest = fallback;
  }
  const ranked = (shortest.solutions || [])
    .map((solution) => ({
      solution: assignCards(solution, input),
      valueCount: bitCount(solution.mask & shortest.valuableMask & ~shortest.startMask)
    }))
    .filter((item) => item.solution);
  const withDir = ranked.filter((item) => (item.solution.path || []).some((step) => step?.dir));
  const sorted = (withDir.length ? withDir : ranked).sort((left, right) => compareAssigned(left, right, shortest.map));
  const unique: PeixiuRouteSolution[] = [];
  const seen = new Set<string>();
  for (const item of sorted) {
    const signature = directionSignature(item.solution);
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(item.solution);
    if (unique.length >= 16) break;
  }
  const fallback = assignCards(shortest.solution || {
    pos: shortest.map.start,
    mask: 0,
    count: 0,
    triggeredMask: 0,
    path: []
  }, input);
  if (!unique.length) unique.push(fallback);
  const solutions = unique.slice(0, 3);
  return {
    map: shortest.map,
    solution: solutions[0],
    solutions,
    complete: (solutions[0].availableStepCount || 0) === (solutions[0].path || []).length,
    valuableMask: shortest.valuableMask,
    shortest,
    shortestDepth: (shortest.solution?.path || []).length
  };
}

export function flattenRouteSegments(solution: PeixiuRouteSolution | null | undefined): PeixiuSegment[] {
  const segments: PeixiuSegment[] = [];
  for (const step of solution?.path || []) {
    if (!step?.dir) continue;
    const points = [step.from, ...step.line];
    for (let index = 1; index < points.length; index += 1) {
      segments.push({ from: points[index - 1], to: points[index], special: false, step });
    }
    for (const move of step.specialMoves || []) {
      const extra = [move.from, ...move.path];
      for (let index = 1; index < extra.length; index += 1) {
        segments.push({ from: extra[index - 1], to: extra[index], special: true, step });
      }
    }
  }
  return segments;
}

export function remainingSuitCounts(solutions: readonly PeixiuRouteSolution[], variant = 0): number[] {
  const counts = [0, 0, 0, 0, 0];
  const solution = solutions[Number(variant) || 0] || solutions[0];
  if (!solution) return counts;
  for (const step of solution.path || []) {
    const suit = Number(step?.dir) || 0;
    if (!PEIXIU_SUITS.includes(suit as 1 | 2 | 3 | 4) || !Array.isArray(step.line) || !step.line.length) continue;
    counts[suit] += 1;
  }
  return counts;
}

export function sequencePlainText(solution: PeixiuRouteSolution | null | undefined): string {
  const names = (solution?.path || []).filter((step) => step?.card).map((step) => (
    step.card?.displayName || step.card?.name || '牌'
  ));
  return names.length ? `建议牌序：${names.join('→')}` : '';
}

export function sequenceRichParts(solution: PeixiuRouteSolution | null | undefined): Array<{
  text: string;
  color: string;
  accent?: string;
  accentColor?: string;
}> {
  const steps = (solution?.path || []).filter((step) => step?.card);
  if (!steps.length) return [];
  const parts: Array<{ text: string; color: string; accent?: string; accentColor?: string }> = [
    { text: '建议牌序：', color: '#3B2512' }
  ];
  steps.forEach((step, index) => {
    if (index > 0) parts.push({ text: '→', color: '#0A0A0A' });
    const raw = String(step.card?.displayName || step.card?.name || '牌').replace(/\uFE0F/g, '');
    const matched = raw.match(/^(.+?)([♥♦♠♣][0-9AJQK]+)$/);
    const name = matched ? matched[1] : raw;
    const point = matched ? matched[2] : '';
    const red = /[♥♦]/.test(point);
    const item: { text: string; color: string; accent?: string; accentColor?: string } = {
      text: name + point,
      color: '#0A0A0A'
    };
    if (point && red) {
      item.accent = point;
      item.accentColor = '#E8402F';
    }
    parts.push(item);
  });
  return parts;
}
