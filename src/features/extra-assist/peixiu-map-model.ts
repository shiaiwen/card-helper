export const PEIXIU_SUITS = [1, 2, 3, 4] as const;

export const PEIXIU_SUIT_META: Readonly<Record<number, {
  name: string;
  mark: string;
  dx: number;
  dy: number;
}>> = {
  1: { name: '红桃', mark: '♥', dx: -1, dy: 0 },
  2: { name: '方块', mark: '♦', dx: 0, dy: -1 },
  3: { name: '黑桃', mark: '♠', dx: 1, dy: 0 },
  4: { name: '梅花', mark: '♣', dx: 0, dy: 1 }
};

export type PeixiuCardKind = 'sha' | 'jiu' | 'tao' | 'zhuge' | 'shandian' | 'unusable' | 'other';

export interface PeixiuHandCard {
  key: string;
  id: number;
  suit: number;
  name: string;
  displayName: string;
  kind: PeixiuCardKind;
  playable: boolean;
  selected: boolean;
}

export interface PeixiuSpecialCell {
  cell: number;
  effect: number;
  param1: number;
  param2: number;
}

export interface PeixiuRewardCell {
  cell: number;
  rawCell: number;
  rewardId: number;
  type: string;
  isCard: boolean;
  isHealing: boolean;
}

export interface PeixiuMapConfig {
  id: number;
  name: string;
  cells: Set<number>;
  start: number;
  specials: Map<number, PeixiuSpecialCell>;
  rewards: PeixiuRewardCell[];
  rewardCells: number[];
  color: number;
}

export interface PeixiuRewardInfo {
  rewardId: number;
  name: string;
  description: string;
}

export function pickField(source: unknown, ...keys: string[]): unknown {
  if (!source || typeof source !== 'object') return undefined;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

export function parseNumberList(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(Number).filter(Number.isFinite);
  }
  return String(value || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite);
}

/** 对照 app.bak Td：把 11–55 的行列编号压成 1–25。 */
export function normalizeCell(value: unknown): number {
  const cell = Number(value) || 0;
  if (cell <= 25) return cell;
  const row = Math.floor(cell / 10);
  const col = cell % 10;
  return row >= 1 && row <= 5 && col >= 1 && col <= 5
    ? (row - 1) * 5 + col
    : cell;
}

export function cellCoord(cell: number): { row: number; col: number } {
  const normalized = normalizeCell(cell);
  return { row: Math.floor((normalized - 1) / 5), col: (normalized - 1) % 5 };
}

export function cellAt(row: number, col: number): number {
  if (row < 0 || row >= 5 || col < 0 || col >= 5) return 0;
  return row * 5 + col + 1;
}

export function isBoardCell(cell: number): boolean {
  return cell >= 1 && cell <= 25;
}

export function parseSpecialCells(raw: unknown): Array<{
  cell: number;
  effect: number;
  param1: number;
  param2: number;
}> {
  const entries = Array.isArray(raw)
    ? raw
    : String(raw || '').split('|').filter(Boolean);
  return entries.map((entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      return {
        cell: Number(pickField(record, 'cell', 'cellID', 'CellID') ?? 0),
        effect: Number(pickField(record, 'effect', 'Effect') ?? 0),
        param1: Number(pickField(record, 'param1', 'Param1') ?? 0),
        param2: Number(pickField(record, 'param2', 'Param2') ?? 0)
      };
    }
    const [cell, effect, param1 = 0, param2 = 0] = parseNumberList(entry);
    return { cell, effect, param1, param2 };
  });
}

export function parseRewardCells(raw: unknown): PeixiuRewardCell[] {
  const entries = Array.isArray(raw)
    ? raw
    : String(raw || '').split('|').filter(Boolean);
  return entries.map((entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const rawCell = Number(pickField(record, 'cell', 'cellID', 'CellID') ?? 0);
      return {
        cell: normalizeCell(rawCell),
        rawCell,
        rewardId: Number(pickField(record, 'rewardId', 'RewardID') ?? 0),
        type: String(pickField(record, 'type', 'rewardType', 'kind', 'Type') ?? ''),
        isCard: record.isCard === true || record.IsCard === true,
        isHealing: record.isHealing === true || record.IsHealing === true
      };
    }
    const [rawCell, rewardId] = parseNumberList(entry);
    return {
      cell: normalizeCell(rawCell),
      rawCell: Number(rawCell),
      rewardId: Number(rewardId) || 0,
      type: '',
      isCard: false,
      isHealing: false
    };
  });
}

export function parsePeixiuMapConfig(raw: unknown): PeixiuMapConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const cells = new Set(
    parseNumberList(pickField(record, 'Cells', 'cells', 'cell')).map(normalizeCell).filter(isBoardCell)
  );
  const specials = new Map<number, PeixiuSpecialCell>();
  for (const entry of parseSpecialCells(pickField(record, 'spcell', 'SpecialCells', 'specialCells'))) {
    const cell = normalizeCell(entry.cell);
    if (!isBoardCell(cell)) continue;
    specials.set(cell, {
      cell,
      effect: Number(entry.effect) || 0,
      param1: Number(entry.param1) || 0,
      param2: Number(entry.param2) || 0
    });
  }
  // 正式服 PeiXiuMapConfig 使用 RewardCells；app.bak 的 sK 同时兼容这四种写法。
  const rewards = parseRewardCells(pickField(record, 'reward', 'RewardCells', 'Rewards', 'rewardCells'));
  const rewardCells = [...new Set(
    rewards.filter((item) => isBoardCell(item.cell) && cells.has(item.cell)).map((item) => item.cell)
  )].sort((left, right) => left - right);
  return {
    id: Number(pickField(record, 'cellID', 'CellID', 'id', 'ID') ?? 0) || 0,
    name: String(record.name || ''),
    cells,
    start: normalizeCell(pickField(record, 'precell', 'PreCell', 'start') || 0),
    specials,
    rewards,
    rewardCells,
    color: Number(pickField(record, 'color', 'Color') ?? 0) || 0
  };
}

export function classifyCardName(name: string): PeixiuCardKind {
  const text = String(name || '').replace(/\s+/g, '');
  if (/^(?:杀|火杀|雷杀|冰杀|刺杀|神杀)$/.test(text)) return 'sha';
  if (/^(?:酒|雄黄酒)$/.test(text)) return 'jiu';
  if (text === '桃') return 'tao';
  if (/诸葛连弩|连弩/.test(text)) return 'zhuge';
  if (text === '闪电') return 'shandian';
  if (/^(?:闪|无懈可击)$/.test(text)) return 'unusable';
  return 'other';
}

export function fingerprintMapConfig(raw: unknown): string {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const cells = parseNumberList(pickField(record, 'Cells', 'cells', 'cell')).join(',');
  const specials = parseSpecialCells(pickField(record, 'spcell', 'SpecialCells', 'specialCells'))
    .map((item) => [normalizeCell(item.cell), item.effect, item.param1, item.param2].join(','))
    .join('|');
  const rewards = parseRewardCells(pickField(record, 'reward', 'RewardCells', 'Rewards', 'rewardCells'))
    .map((item) => [
      item.cell,
      item.rewardId,
      item.type,
      item.isCard ? 1 : 0,
      item.isHealing ? 1 : 0
    ].join(','))
    .join('|');
  return [
    Number(pickField(record, 'cellID', 'CellID', 'id') ?? 0) || 0,
    Number(pickField(record, 'PreCell', 'precell', 'start') ?? 0) || 0,
    cells,
    specials,
    rewards
  ].join(';');
}
