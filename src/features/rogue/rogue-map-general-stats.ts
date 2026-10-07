/**
 * 山河图武将战力/属性统计辅助：从配置与场景数据汇总展示用数值。
 */

import type { RogueMapConfigData, RogueMapRuntime } from './rogue-map-types.ts';

type UnknownRecord = Record<string, unknown>;

const ATTR_META = Object.freeze({
  1: { key: 'draw', seed: 5 },
  2: { key: 'exshatimes', diffKey: 'skill', seed: 7 },
  3: { key: 'getarmor', seed: 3 },
  4: { key: 'hp', seed: 1 },
  5: { key: 'cardnum', seed: 4 },
  6: { key: 'armor', seed: 2 }
} as const);

const EXTRA_ATTR_FIELDS = ['att_ZD', 'att_KN', 'att_EM', 'att_LY'] as const;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function scaleAdd(raw: number): number {
  if (raw >= 1) return Math.floor(raw);
  if (raw >= 0) return Math.round(raw);
  return Math.floor(raw);
}

/** 高难分段额外属性字段前缀。 */
function hardExtraField(difficulty: number, prefix: string): string | null {
  if (difficulty >= 0x65 && difficulty <= 0x6d) return `${prefix}1`;
  if (difficulty >= 0x6f && difficulty <= 0x77) return `${prefix}2`;
  if (difficulty >= 0x79 && difficulty <= 0x81) return `${prefix}3`;
  return null;
}

function readExtraAttrs(
  general: UnknownRecord,
  bigDif: number,
  difficulty: number
): Record<string, number> {
  const result: Record<string, number> = {};
  for (let index = 0; index < bigDif && index < EXTRA_ATTR_FIELDS.length; index += 1) {
    for (const part of String(general[EXTRA_ATTR_FIELDS[index]] ?? '').split(';')) {
      const [key, value] = part.split(',');
      if (!key || value == null) continue;
      result[key] = (result[key] || 0) + num(value);
    }
  }
  if (difficulty > 100) {
    for (const prefix of ['att_JJ']) {
      const field = hardExtraField(difficulty, prefix);
      if (!field) continue;
      for (const part of String(general[field] ?? '').split(';')) {
        const [needDiff, key, value] = part.split(',');
        if (!key || value == null || num(needDiff) > difficulty) continue;
        result[key] = (result[key] || 0) + num(value);
      }
    }
  }
  return result;
}

function applySeedItems(value: number, attrType: number, seedItem: readonly unknown[]): number {
  const seed = ATTR_META[attrType as keyof typeof ATTR_META]?.seed;
  if (seed == null) return value;
  let next = value;
  for (const entry of seedItem) {
    const item = asRecord(entry);
    if (!item || Number(item.itemType) !== 1) continue;
    if (Number(item.attrType) !== seed) continue;
    if (Number(item.goal) !== 1 && Number(item.goal) !== 3) continue;
    const amount = num(item.value ?? item.num ?? item.val);
    next += item.sub ? -amount : amount;
  }
  return next;
}

function readAttr(
  general: UnknownRecord,
  attrType: keyof typeof ATTR_META,
  grow: GrowContext,
  numGrowRow: UnknownRecord | null
): { value: number; add: number; extra: Record<string, number> } {
  const meta = ATTR_META[attrType];
  const key = meta.key;
  const diffKey = 'diffKey' in meta ? meta.diffKey : key;
  let add = num(grow.growRow?.[key])
    + num(grow.diffRow?.[diffKey] ?? grow.diffRow?.[key])
    + num(grow.diffGrowRow?.[key]);
  const scale = numGrowRow?.[key] != null ? num(numGrowRow[key]) / 100 : 1;
  add = scaleAdd(add * scale);
  const extra = readExtraAttrs(general, grow.bigDif, grow.difficulty);
  let value = num(general[key]) + add + num(extra[key]);
  value = attrType === 4 ? Math.max(1, value) : Math.max(0, value);
  value = applySeedItems(value, attrType, grow.seedItem);
  return { value, add, extra };
}

interface GrowContext {
  difficulty: number;
  chapter: number;
  bigDif: number;
  growRow: UnknownRecord | null;
  diffRow: UnknownRecord | null;
  diffGrowRow: UnknownRecord | null;
  bossLocation: number;
  seedItem: readonly unknown[];
}

function buildGrowContext(
  config: RogueMapConfigData,
  runtime: RogueMapRuntime
): GrowContext {
  const difficulty = num(runtime.difficulty);
  const seasonId = String(runtime.seasonId || config.RcurSeason || 1);
  const diffs = config.Rdiff[seasonId] ?? {};
  const diffRow = asRecord(diffs[String(difficulty)]) ?? asRecord(diffs[difficulty]) ?? null;
  const bigDif = Math.max(1, num(diffRow?.bdif, 1));
  const chapter = num(runtime.passChapter) + 1;
  const accday = num(runtime.accday);
  const growRow = asRecord(config.Rgrow[`${accday}_${difficulty}`]) ?? null;
  const diffGrowRow = asRecord(config.RdiffGrow[`${bigDif}_${chapter}`]) ?? null;
  const bosses = config.RchapBoss[seasonId] ?? {};
  const bossLocation = num(bosses[String(runtime.chapterId)] ?? bosses[runtime.chapterId]);
  return {
    difficulty,
    chapter,
    bigDif,
    growRow,
    diffRow,
    diffGrowRow,
    bossLocation,
    seedItem: asArray(runtime.seedItem)
  };
}

function readNumGrowRow(
  config: RogueMapConfigData,
  fight: UnknownRecord,
  cityId: string | number | undefined,
  grow: GrowContext
): UnknownRecord | null {
  const generals = asArray(fight.generals ?? fight.baseGenerals);
  const visible = generals.filter((entry) => {
    const general = asRecord(entry);
    if (!general || Number(general.hide) === 1) return false;
    return num(general.startChapter) <= grow.chapter;
  });
  const mode = cityId != null && grow.bossLocation === Number(cityId)
    ? 1
    : Number(fight.isSingle ?? fight.issingle) === 1
      ? 2
      : 3;
  return asRecord(config.RnumGrow[`${mode}_${visible.length}`]) ?? null;
}

/** 武将属性行：血、牌、摸、杀、甲。 */
export function formatGeneralStatsLine(
  general: UnknownRecord,
  config: RogueMapConfigData,
  runtime: RogueMapRuntime,
  fight: UnknownRecord,
  cityId?: string | number
): string {
  const grow = buildGrowContext(config, runtime);
  const numGrow = readNumGrowRow(config, fight, cityId, grow);
  const hp = readAttr(general, 4, grow, numGrow);
  const maxHp = Math.max(1, num(general.maxhp) + hp.add + num(hp.extra.maxhp));
  const cards = readAttr(general, 5, grow, numGrow).value;
  const draw = readAttr(general, 1, grow, numGrow).value;
  const sha = 1 + readAttr(general, 2, grow, numGrow).value;
  const armor = readAttr(general, 6, grow, numGrow).value;
  const getArmor = readAttr(general, 3, grow, numGrow).value;
  const parts = [
    `${hp.value}${maxHp !== hp.value ? `/${maxHp}` : ''}血`,
    `${cards}牌`,
    `摸${draw}`,
    `杀${sha}`
  ];
  if (armor) parts.push(`甲${armor}${getArmor ? `+${getArmor}` : ''}`);
  return parts.join(' ');
}

export function formatGeneralName(general: UnknownRecord): string {
  const name = String(general.generalname ?? '');
  return general.start ? `[先手]${name}` : name;
}
