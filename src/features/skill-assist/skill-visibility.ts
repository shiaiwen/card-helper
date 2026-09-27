import type { GameSceneSeatSource } from '../seat-display/seat-game-adapter.ts';
import type { SkillAssistDefinition } from './skill-definitions.ts';

type UnknownRecord = Record<string, unknown>;

/**
 * 对照原版 VV：任意座位 HasSkill(id) 即视为桌上有该技能。
 * 不依赖 legacy，只读 Laya 座位对象上的 HasSkill。
 */
export function anySeatHasSkill(
  scene: GameSceneSeatSource | null,
  skillIds: readonly number[]
): boolean {
  if (!scene || !skillIds.length) return false;
  const seatUIs = scene.seatContainer?.seatUIs;
  if (!Array.isArray(seatUIs) || !seatUIs.length) return false;
  return seatUIs.some((rawSeatUI) => {
    const seatUI = asRecord(rawSeatUI);
    const seat = asRecord(seatUI?.seat) ?? seatUI;
    if (!seat) return false;
    const hasSkill = seat.HasSkill;
    if (typeof hasSkill !== 'function') return false;
    return skillIds.some((skillId) => {
      try {
        return Boolean(hasSkill.call(seat, skillId));
      } catch {
        return false;
      }
    });
  });
}

/** 是否有座位持有指定技能（用于出牌时判断当前行动者）。 */
export function seatHasSkill(
  scene: GameSceneSeatSource | null,
  seatId: number,
  skillIds: readonly number[]
): boolean {
  if (!scene || !skillIds.length) return false;
  const seatUIs = scene.seatContainer?.seatUIs;
  if (!Array.isArray(seatUIs)) return false;
  for (const rawSeatUI of seatUIs) {
    const seatUI = asRecord(rawSeatUI);
    const seat = asRecord(seatUI?.seat) ?? seatUI;
    if (!seat) continue;
    const id = readSeatId(seat) ?? readSeatId(seatUI);
    if (id !== seatId) continue;
    const hasSkill = seat.HasSkill;
    if (typeof hasSkill !== 'function') return false;
    return skillIds.some((skillId) => {
      try {
        return Boolean(hasSkill.call(seat, skillId));
      } catch {
        return false;
      }
    });
  }
  return false;
}

/**
 * 解析模块最终 skillIds：静态 ID + spellDict 按名字查找（有则合并）。
 * spellDict 不可用时退回静态列表，保证权变等已知 ID 仍可用。
 */
export function resolveSkillIds(
  definition: SkillAssistDefinition,
  scene: GameSceneSeatSource | null
): number[] {
  const fromNames = resolveSpellIdsByName(definition.spellNames ?? [], scene);
  return [...new Set([...definition.skillIds, ...fromNames].filter((id) => Number.isInteger(id) && id > 0))];
}

export function isSkillAssistVisible(
  definition: SkillAssistDefinition,
  scene: GameSceneSeatSource | null,
  inGame: boolean
): boolean {
  if (!inGame || !scene) return false;
  const seatUIs = scene.seatContainer?.seatUIs;
  if (!Array.isArray(seatUIs) || !seatUIs.length) return false;
  const skillIds = resolveSkillIds(definition, scene);
  if (anySeatHasSkill(scene, skillIds)) return true;
  return anySeatHasGeneralName(scene, definition.generalNames ?? []);
}

let fallbackSpellLookup: ((name: string) => number[]) | null = null;

/** 游戏场景没有技能字典时，用自行解析的 cha_spell.sgs 按名字查 ID。 */
export function registerSpellNameLookup(lookup: ((name: string) => number[]) | null): void {
  fallbackSpellLookup = lookup;
}

function resolveSpellIdsByName(
  spellNames: readonly string[],
  scene: GameSceneSeatSource | null
): number[] {
  if (!spellNames.length || !scene) return [];
  const nameSet = new Set(spellNames);
  const dict = findSpellDict(scene);
  if (!dict) return fallbackSpellLookup ? spellNames.flatMap((name) => fallbackSpellLookup!(name)) : [];
  const ids: number[] = [];
  for (const [rawKey, rawValue] of Object.entries(dict)) {
    const record = asRecord(rawValue);
    const name = typeof record?.name === 'string'
      ? record.name
      : typeof record?.Name === 'string'
        ? record.Name
        : typeof rawValue === 'string'
          ? rawValue
          : '';
    if (!nameSet.has(name)) continue;
    const id = Number(record?.id ?? record?.ID ?? record?.spellId ?? rawKey);
    if (Number.isInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

function findSpellDict(scene: GameSceneSeatSource | null): UnknownRecord | null {
  const sceneRecord = asRecord(scene);
  for (const key of ['spellDict', 'SpellDict', 'initMap']) {
    const candidate = asRecord(sceneRecord?.[key]);
    const nested = asRecord(candidate?.spellDict) ?? candidate;
    if (nested && Object.keys(nested).length) return nested;
  }
  const globalDict = asRecord((globalThis as { jI?: unknown }).jI);
  const fromGlobal = asRecord(globalDict?.spellDict);
  return fromGlobal && Object.keys(fromGlobal).length ? fromGlobal : null;
}

function anySeatHasGeneralName(
  scene: GameSceneSeatSource | null,
  generalNames: readonly string[]
): boolean {
  if (!generalNames.length || !scene) return false;
  const nameSet = new Set(generalNames);
  const seatUIs = scene.seatContainer?.seatUIs;
  if (!Array.isArray(seatUIs)) return false;
  const generalDict = asRecord(asRecord((globalThis as { jI?: unknown }).jI)?.generalDict);
  return seatUIs.some((rawSeatUI) => {
    const seatUI = asRecord(rawSeatUI);
    const seat = asRecord(seatUI?.seat) ?? seatUI;
    const generalIds = readNumberArray(seat, ['generalIds', 'GeneralIds', 'WuJiangs', 'generals']);
    return generalIds.some((generalId) => {
      const entry = generalDict?.[String(generalId)] ?? generalDict?.[generalId as unknown as string];
      return typeof entry === 'string' && nameSet.has(entry);
    });
  });
}

function readSeatId(source: UnknownRecord | null | undefined): number | null {
  if (!source) return null;
  for (const key of ['seatID', 'seatId', 'SeatID', 'SeatId', 'index', 'Index', 'id', 'ID']) {
    const value = Number(source[key]);
    if (Number.isInteger(value) && value >= 0 && value < 0xff) return value;
  }
  return null;
}

function readNumberArray(source: UnknownRecord | null | undefined, keys: readonly string[]): number[] {
  if (!source) return [];
  for (const key of keys) {
    const value = source[key];
    if (!Array.isArray(value)) continue;
    return value.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  }
  return [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}
