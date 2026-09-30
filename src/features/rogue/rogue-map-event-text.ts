import type {
  RogueCitySpot,
  RogueMapConfigData,
  RogueMapPanelLayout,
  RogueMapRuntime,
  RoguePanelLine
} from './rogue-map-types.ts';
import { EMPTY_ROGUE_MAP_RUNTIME } from './rogue-map-types.ts';
import {
  formatGeneralName,
  formatGeneralStatsLine
} from './rogue-map-general-stats.ts';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

export function resolveEventTitle(config: RogueMapConfigData, event: string | number): string {
  const adventure = config.Radventure[String(event)];
  if (adventure) return String(adventure);
  const fight = config.Rfight[String(event)];
  return String(fight?.name || fight?.text || '未知事件');
}

/**
 * 奇遇选项 id：
 * 1) 优先 Adventure.effect1/2/3 → RadventureChoices
 * 2) 表空时用 event+"1" / event+"01" 查 Rchoose（问号奇遇常用此编号）
 *    真战斗（Rfight 带武将名）禁止误拼，避免 10→101 撞号。
 */
export function adventureChoiceIds(
  config: RogueMapConfigData,
  event: string | number
): Array<string | number> {
  const key = String(event);
  const fromTable = config.RadventureChoices[key];
  if (Array.isArray(fromTable) && fromTable.length) return fromTable;

  const ids: Array<string | number> = [];
  for (let index = 1; index <= 3; index += 1) {
    const plain = `${key}${index}`;
    const padded = `${key}${String(index).padStart(2, '0')}`;
    const choiceId = config.Rchoose[padded] ? padded : plain;
    if (config.Rchoose[String(choiceId)]) ids.push(choiceId);
  }
  if (!ids.length) return [];

  // 有奇遇章名 → 一定可拼；无章名时仅当不是「带武将的真战斗」才拼。
  if (config.Radventure[key] || !isRealFightEvent(config, key)) return ids;
  return [];
}

/** Rfight 有可显示武将名才算真战斗；空壳/仅 generalgroup 撞号不算。 */
export function isRealFightEvent(config: RogueMapConfigData, event: string | number): boolean {
  const fight = config.Rfight[String(event)];
  if (!fight) return false;
  const generals = Array.isArray(fight.generals) ? fight.generals : [];
  return generals.some((entry) => {
    const general = asRecord(entry);
    return Boolean(general && formatGeneralName(general));
  });
}

/** 营地类奇遇不画面板：选项 camp=true（含 event+1 / +01 编号）。 */
export function shouldSkipCityEvent(config: RogueMapConfigData, event: string | number): boolean {
  for (const choiceId of adventureChoiceIds(config, event)) {
    if (config.Rchoose[String(choiceId)]?.camp) return true;
  }
  // adventureChoiceIds 在真战斗时会故意返回 []，营地检测仍要走拼接。
  const key = String(event);
  for (let index = 1; index <= 3; index += 1) {
    const plain = `${key}${index}`;
    const padded = `${key}${String(index).padStart(2, '0')}`;
    if (config.Rchoose[padded]?.camp || config.Rchoose[plain]?.camp) return true;
  }
  return false;
}

/** @deprecated 保留给旧测试；新面板用 `buildEventLines`。 */
export function buildEventBodyLines(
  config: RogueMapConfigData,
  event: string | number,
  runtime: RogueMapRuntime = EMPTY_ROGUE_MAP_RUNTIME,
  cityId?: string | number
): string[] {
  return buildEventLines(config, event, runtime, cityId).map((line) => line.text);
}

/**
 * 无真战斗时走奇遇选项正文；有 Radventure / 可拼选项也优先奇遇，
 * 避免 generalgroup 空壳抢走问号关正文。
 */
export function isAdventureEvent(config: RogueMapConfigData, event: string | number): boolean {
  const key = String(event);
  if (config.Radventure[key]) return true;
  if (adventureChoiceIds(config, event).length > 0) return true;
  return false;
}

/**
 * 对照 app.bak `Kv`/`KE`：武将名 + 属性行，再接奖励/奇遇得失。
 * 奇遇（含地图问号关）优先于 Rfight，避免 generalgroup 空壳抢走正文。
 */
export function buildEventLines(
  config: RogueMapConfigData,
  event: string | number,
  runtime: RogueMapRuntime = EMPTY_ROGUE_MAP_RUNTIME,
  cityId?: string | number
): RoguePanelLine[] {
  if (isAdventureEvent(config, event)) {
    const lines: RoguePanelLine[] = [];
    for (const choiceId of adventureChoiceIds(config, event)) {
      const choice = config.Rchoose[String(choiceId)];
      if (!choice || choice.camp) continue;
      if (Array.isArray(choice.generals) && choice.generals.length) {
        for (const entry of choice.generals) {
          const general = asRecord(entry);
          if (!general) continue;
          const name = formatGeneralName(general);
          if (name) lines.push({ kind: 'general', text: name });
          const stats = formatGeneralStatsLine(
            general,
            config,
            runtime,
            choice as UnknownRecord,
            cityId
          );
          if (stats) lines.push({ kind: 'stats', text: stats });
        }
      }
      const chunk: string[] = [];
      if (!choice.generals?.length && choice.lost) chunk.push(String(choice.lost));
      if (choice.get) chunk.push(String(choice.get));
      if (chunk.length) lines.push({ kind: 'reward', text: chunk.join('\n') });
    }
    return lines;
  }

  const fight = config.Rfight[String(event)];
  if (!fight) return [];
  const lines: RoguePanelLine[] = [];
  const generals = Array.isArray(fight.generals) ? fight.generals : [];
  for (const entry of generals) {
    const general = asRecord(entry);
    if (!general) continue;
    const name = formatGeneralName(general);
    if (name) lines.push({ kind: 'general', text: name });
    const stats = formatGeneralStatsLine(general, config, runtime, fight as UnknownRecord, cityId);
    if (stats) lines.push({ kind: 'stats', text: stats });
  }
  if (fight.get) {
    for (const text of String(fight.get).split('\n').filter(Boolean)) {
      lines.push({ kind: 'reward', text });
    }
  }
  return lines;
}

export function buildPanelDrafts(
  config: RogueMapConfigData,
  cities: readonly RogueCitySpot[],
  runtime: RogueMapRuntime = EMPTY_ROGUE_MAP_RUNTIME
): Array<Pick<RogueMapPanelLayout, 'id' | 'title' | 'lines'>> {
  const drafts: Array<Pick<RogueMapPanelLayout, 'id' | 'title' | 'lines'>> = [];
  for (const city of cities) {
    if (!config.Rcity[String(city.id)]) continue;
    if (shouldSkipCityEvent(config, city.event)) continue;
    drafts.push({
      id: city.id,
      title: resolveEventTitle(config, city.event),
      lines: buildEventLines(config, city.event, runtime, city.id)
    });
  }
  return drafts;
}
