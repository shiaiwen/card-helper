import type { LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import {
  classifyCardName,
  type PeixiuHandCard,
  type PeixiuRewardInfo
} from './peixiu-map-model.ts';

type UnknownRecord = Record<string, unknown>;

export interface PeixiuResourceSnapshot {
  suitCounts: number[];
  handCards: PeixiuHandCard[];
  selectedCardKey: string;
  hasZhugeEquipped: boolean;
  remainingSha: number;
  jiuLimit: number;
  peachLimit: number;
  shandianLimit: number;
  hp: number | null;
  maxHp: number | null;
  isDying: boolean;
}

export interface PeixiuCardLookup {
  getCard?(cardId: number): UnknownRecord | null;
}

export interface PeixiuRewardLookup {
  getReward?(rewardId: number): PeixiuRewardInfo | null;
}

const emptySnapshot = (): PeixiuResourceSnapshot => ({
  suitCounts: [0, 0, 0, 0, 0],
  handCards: [],
  selectedCardKey: '',
  hasZhugeEquipped: false,
  remainingSha: 1,
  jiuLimit: 0,
  peachLimit: 0,
  shandianLimit: 1,
  hp: null,
  maxHp: null,
  isDying: false
});

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function cardIdOf(card: UnknownRecord | null): number {
  return Number(card?.CardId ?? card?.cardId ?? card?.ID ?? card?.id ?? 0) || 0;
}

function cardSuitOf(card: UnknownRecord | null): number {
  return Number(
    card?.flower ?? card?.CardSuit ?? card?.cardSuit ?? card?.suit ?? card?.Color ?? card?.color ?? 0
  ) || 0;
}

function cardNameOf(card: UnknownRecord | null, lookup?: PeixiuCardLookup): string {
  const id = cardIdOf(card);
  const catalog = id ? lookup?.getCard?.(id) : null;
  return String(
    card?.CardName || card?.cardName || card?.name || catalog?.name || ''
  );
}

function cardDisplayName(card: UnknownRecord | null, fallback: string, lookup?: PeixiuCardLookup): string {
  const id = cardIdOf(card);
  const catalog = id ? lookup?.getCard?.(id) : null;
  const name = String(catalog?.name || fallback || '牌');
  return name + String(catalog?.cn ?? '');
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

export function remainingShaFromDom(documentObject?: Document | null): number {
  const text = documentObject?.getElementById?.('sha')?.textContent || '';
  if (/∞/.test(text)) return Infinity;
  const matched = text.match(/(?:剩余\s*[：:]?\s*)?(\d+)/);
  return matched ? Math.max(0, Number(matched[1]) || 0) : 1;
}

export function collectPeixiuResources(options: {
  globalObject?: LayaRuntimeWindow;
  cardLookup?: PeixiuCardLookup;
  remainingSha?: number;
  shandianLimit?: number;
} = {}): PeixiuResourceSnapshot {
  try {
    const globalObject = options.globalObject ?? (typeof window !== 'undefined' ? window as LayaRuntimeWindow : {});
    const scene = locateGameScene(globalObject);
    const selfSeatUi = asRecord(scene?.SelfSeatUi) ?? asRecord(asRecord(scene)?.selfSeatUi);
    const seat = asRecord(selfSeatUi?.seat) ?? {};
    const container = asRecord(selfSeatUi?.cardContainer) ?? {};
    const cardUis = Array.isArray(container.cardUis) && container.cardUis.length
      ? container.cardUis
      : (container.handCardUis as unknown[]) || [];
    const equipUis = (container.equipUis as unknown[]) || [];
    const selectedUis = new Set([
      ...((container.selectCardUis as unknown[]) || []),
      ...((container.selectedCardUis as unknown[]) || [])
    ]);
    const selectedIds = new Set(
      Array.from(
        (asRecord(container.selectContext)?.SelectedCardIds
          ?? asRecord(container.SelectContext)?.SelectedCardIds
          ?? []) as unknown[],
        Number
      )
    );
    const activatedList = container.activatedCardUis ?? container.ActivatedCardUis;
    const activatedSet = new Set(Array.isArray(activatedList) ? activatedList : []);
    const suitCounts = [0, 0, 0, 0, 0];
    const handCards = cardUis.map((item, index) => {
      const ui = asRecord(item);
      const card = asRecord(ui?.Card) ?? asRecord(ui?.theCard) ?? ui;
      const id = cardIdOf(card);
      const suit = cardSuitOf(card);
      const name = cardNameOf(card, options.cardLookup);
      const activated = ui?.Activated ?? ui?.activated ?? card?.Activated ?? card?.activated
        ?? (Array.isArray(activatedList) ? activatedSet.has(item) : undefined);
      if (suit >= 1 && suit <= 4) suitCounts[suit] += 1;
      return {
        key: id ? String(id) : `hand-${index}`,
        id,
        suit,
        name,
        displayName: cardDisplayName(card, name, options.cardLookup),
        kind: classifyCardName(name),
        playable: activated === undefined ? true : !!activated,
        selected: !!(ui?.selected || card?.selected || selectedUis.has(item) || selectedIds.has(id))
      } satisfies PeixiuHandCard;
    });
    const hasZhuge = (equipUis as unknown[]).some((item) => {
      const ui = asRecord(item);
      return classifyCardName(cardNameOf(asRecord(ui?.Card) ?? asRecord(ui?.theCard) ?? ui, options.cardLookup)) === 'zhuge';
    });
    const hp = firstNumber(seat.currentHp, seat.CurrentHp, seat.Hp, seat.HP);
    const maxHp = firstNumber(seat.maxHp, seat.MaxHp, seat.maxHP, seat.MaxHP);
    const isDying = !!(seat.isDying || seat.IsDying || seat.dying || (hp != null && hp <= 0));
    const lost = hp != null && maxHp != null ? Math.max(0, maxHp - hp) : 0;
    const jiuCards = handCards.filter((card) => card.kind === 'jiu' && card.playable);
    const peachCards = handCards.filter((card) => card.kind === 'tao' && card.playable);
    const jiuLimit = isDying ? jiuCards.length : Math.min(1, jiuCards.length);
    const peachLimit = hp != null && maxHp != null
      ? Math.min(peachCards.length, isDying ? Math.max(1, 1 - hp) : lost)
      : 0;
    const selected = handCards.find((card) => card.selected) || null;
    return {
      suitCounts,
      handCards,
      selectedCardKey: selected?.key || '',
      hasZhugeEquipped: hasZhuge,
      remainingSha: hasZhuge ? Infinity : (options.remainingSha ?? remainingShaFromDom(globalObject.document)),
      jiuLimit,
      peachLimit,
      shandianLimit: options.shandianLimit ?? 1,
      hp,
      maxHp,
      isDying
    };
  } catch {
    return emptySnapshot();
  }
}

export function readSelfSeatId(globalObject?: LayaRuntimeWindow, gameContext?: unknown): string {
  const runtime = globalObject ?? (typeof window !== 'undefined' ? window as LayaRuntimeWindow : {});
  const scene = asRecord(locateGameScene(runtime));
  const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  const seat = asRecord(self?.seat) ?? asRecord(self?.Seat);
  const context = asRecord(gameContext)
    ?? asRecord(runtime.GameContext)
    ?? asRecord(asRecord(runtime.Laya?.Browser?.window)?.GameContext);
  const id = seat?.SeatID ?? seat?.seatID ?? seat?.SeatId ?? seat?.seatId
    ?? seat?.index ?? seat?.Index
    ?? self?.SeatID ?? self?.seatID ?? self?.SeatId ?? self?.seatId
    ?? self?.index ?? self?.Index
    ?? context?.mySeatID ?? context?.MySeatID ?? context?.selfSeatID ?? context?.SelfSeatID
    ?? context?.myID ?? context?.MyID;
  return id == null ? '' : String(id);
}

export function readCurrentSeatId(globalObject?: LayaRuntimeWindow, gameContext?: unknown): string {
  const runtime = globalObject ?? (typeof window !== 'undefined' ? window as LayaRuntimeWindow : {} as LayaRuntimeWindow);
  const context = asRecord(gameContext)
    ?? asRecord(runtime.GameContext)
    ?? asRecord(asRecord(runtime.Laya?.Browser?.window)?.GameContext);
  const id = context?.currentID ?? context?.CurrentID ?? context?.currentId ?? context?.CurrentId;
  return id == null ? '' : String(id);
}

export function isLocalPlayerTurn(
  globalObject?: LayaRuntimeWindow,
  ownerSeatId?: string,
  gameContext?: unknown
): boolean {
  const current = readCurrentSeatId(globalObject, gameContext);
  const self = readSelfSeatId(globalObject, gameContext);
  if (!current || !self || current !== self) return false;
  return !ownerSeatId || ownerSeatId === current;
}

export function collectOwnedSkills(
  map: { rewards?: Array<{ rewardId?: number; type?: unknown }> } | null | undefined,
  collectedCells: number[],
  lookup: PeixiuRewardLookup,
  rewardAt: (cell: number) => number
): PeixiuRewardInfo[] {
  const ids = new Set<number>();
  for (const reward of map?.rewards || []) {
    const type = Number(reward.type);
    if (type === 26 && Number(reward.rewardId)) ids.add(Number(reward.rewardId));
  }
  for (const cell of collectedCells) {
    const rewardId = rewardAt(cell);
    if (rewardId) ids.add(rewardId);
  }
  return [...ids]
    .map((rewardId) => lookup.getReward?.(rewardId) ?? { rewardId, name: `地图技#${rewardId}`, description: '' })
    .filter((item) => item.name);
}

export function resolveRewardIdAt(
  map: { rewards?: Array<{ cell?: number; rewardId?: number }> } | null | undefined,
  cell: number
): number {
  const found = (map?.rewards || []).find((item) => Number(item.cell) === Number(cell));
  return Number(found?.rewardId) || 0;
}
