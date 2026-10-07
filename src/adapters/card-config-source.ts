/**
 * 官方 Config_w.sgs 配置源：下载解密后提供卡牌字典、技能名、自动任务/山河/进阶辅助表。
 */

import {
  AUTO_TASK_CONFIG_FILES,
  buildAutoTaskConfigData,
  configDayStamp,
  type AutoTaskConfigData,
  type AutoTaskConfigFileName
} from '../features/auto-task/auto-task-config-data.ts';
import {
  buildRogueMapConfigData,
  type RogueMapConfigData
} from '../features/rogue/rogue-map-config-data.ts';
import type { ExtraAssistConfigData } from '../features/extra-assist/extra-assist-config-data.ts';
import { buildExtraAssistConfigData } from '../features/extra-assist/extra-assist-config-data.ts';

type UnknownRecord = Record<string, unknown>;
export type CardConfigDictionary = Record<number, UnknownRecord>;

declare global {
  interface Window {
    /** 开发监控读取的卡牌字典；只读，业务代码应通过 CardConfigSource 访问。 */
    __XIAOCHAO_OFFICIAL_CARD_DICTIONARY__?: CardConfigDictionary;
  }
}

export interface CardConfigSource {
  getCard(cardId: number): UnknownRecord | null;
  /** 按技能名查技能 ID（来自 cha_spell.sgs），配置未就绪时返回空数组。 */
  findSpellIdsByName(name: string): number[];
  /** 自动任务用的任务 id、武将灯系列与物品名；配置未就绪时返回 null。 */
  getAutoTaskData(): AutoTaskConfigData | null;
  /** 山河地图透视表（hd_roguelike.sgs）；配置未就绪时返回 null。 */
  getRogueMapData(): RogueMapConfigData | null;
  /** 进阶辅助用的南华/许劭表（cha_spellextend.sgs）；配置未就绪时返回 null。 */
  getExtraAssistData(): ExtraAssistConfigData | null;
  /** 进阶辅助原始表，供控制器按需解析；配置未就绪时返回 null。 */
  getSpellExtendRaw(): unknown;
  size(): number;
  dispose(): void;
}

interface ZipFile { async(type: 'arraybuffer'): Promise<ArrayBuffer> }
interface ZipArchive { file(name: string): ZipFile | null }
interface GameConfigCodecs {
  loadZip(data: ArrayBuffer): Promise<ZipArchive>;
  decrypt(data: ArrayBuffer): unknown;
  gunzip(data: unknown): Uint8Array;
}

const CONFIG_PATH = '/220/h5_2/res/config/Config_w.sgs';
const CONFIG_ORIGIN = 'https://web.sanguosha.com';
const TEST_CONFIG_URL = 'https://test.sanguosha.com/h5/res/config//Config_w.sgs';
const ROGUE_MAP_CONFIG_FILE = 'hd_roguelike.sgs';
const POLL_INTERVAL_MS = 1000;
const DOWNLOAD_TIMEOUT_MS = 20000;
const DOWNLOAD_ATTEMPTS = 3;

/**
 * 自行下载游戏的 Config_w.sgs，并用游戏页面自带的 JSZip / CtrUtil / Zlib 解出
 * sys_playcard、cha_spell、自动任务表与山河地图表。
 */
export function installCardConfigSource(globalObject: Window = window): CardConfigSource {
  let dictionary: CardConfigDictionary | null = null;
  let spellIdsByName = new Map<string, number[]>();
  let autoTaskData: AutoTaskConfigData | null = null;
  let rogueMapData: RogueMapConfigData | null = null;
  let extraAssistData: ExtraAssistConfigData | null = null;
  let spellExtendRaw: unknown = null;
  let disposed = false;
  let loading = false;
  let failures = 0;
  let polls = 0;
  const timer = globalObject.setInterval(tryLoad, POLL_INTERVAL_MS);
  tryLoad();

  function tryLoad(): void {
    if (disposed || loading || dictionary) return;
    const codecs = readGameConfigCodecs(globalObject);
    if (!codecs) {
      // 解码库随游戏脚本加载；登录页停留期间不计入超时。
      if (!(globalObject as unknown as UnknownRecord).Laya) return;
      polls += 1;
      if (polls === 30) console.error('[xiaochao] 卡牌配置等待游戏解码库超时', describeMissingCodecs(globalObject));
      return;
    }
    loading = true;
    loadCardDictionary(globalObject, codecs)
      .then((result) => {
        if (disposed) return;
        dictionary = result.cards;
        spellIdsByName = result.spellIdsByName;
        autoTaskData = result.autoTaskData;
        rogueMapData = result.rogueMapData;
        extraAssistData = result.extraAssistData;
        spellExtendRaw = result.spellExtendRaw;
        globalObject.__XIAOCHAO_OFFICIAL_CARD_DICTIONARY__ = result.cards;
        globalObject.clearInterval(timer);
      })
      .catch((error) => {
        failures += 1;
        console.error(`[xiaochao] 卡牌配置加载失败: ${String((error as Error)?.message ?? error)}`);
        if (failures >= DOWNLOAD_ATTEMPTS) globalObject.clearInterval(timer);
      })
      .finally(() => {
        loading = false;
      });
  }

  return {
    getCard(cardId) {
      return dictionary?.[cardId] ?? null;
    },
    findSpellIdsByName(name) {
      return [...(spellIdsByName.get(name) ?? [])];
    },
    getAutoTaskData() {
      return autoTaskData;
    },
    getRogueMapData() {
      return rogueMapData;
    },
    getExtraAssistData() {
      return extraAssistData;
    },
    getSpellExtendRaw() {
      return spellExtendRaw;
    },
    size() {
      return dictionary ? Object.keys(dictionary).length : 0;
    },
    dispose() {
      disposed = true;
      globalObject.clearInterval(timer);
    }
  };
}

async function loadCardDictionary(
  globalObject: Window,
  codecs: GameConfigCodecs
): Promise<{
  cards: CardConfigDictionary;
  spellIdsByName: Map<string, number[]>;
  autoTaskData: AutoTaskConfigData | null;
  rogueMapData: RogueMapConfigData | null;
  extraAssistData: ExtraAssistConfigData | null;
  spellExtendRaw: unknown;
}> {
  const archive = await codecs.loadZip(await downloadArchive(resolveConfigUrl(globalObject)));
  const [playCards, spells, autoTaskData, rogueRaw, spellExtendRaw] = await Promise.all([
    readConfigFile(archive, codecs, 'sys_playcard.sgs'),
    readConfigFile(archive, codecs, 'cha_spell.sgs'),
    loadAutoTaskData(archive, codecs),
    readConfigFile(archive, codecs, ROGUE_MAP_CONFIG_FILE).catch((error) => {
      console.warn(`[xiaochao] 山河配置读取失败: ${ROGUE_MAP_CONFIG_FILE}`, error);
      return null;
    }),
    readConfigFile(archive, codecs, 'cha_spellextend.sgs').catch((error) => {
      console.warn('[xiaochao] 进阶辅助配置读取失败: cha_spellextend.sgs', error);
      return null;
    })
  ]);
  const cards = buildCardDictionary(playCards, spells);
  let rogueMapData: RogueMapConfigData | null = null;
  if (rogueRaw) {
    try {
      rogueMapData = buildRogueMapConfigData(rogueRaw, buildRogueNameTables(playCards, spells));
      if (!Object.keys(rogueMapData.Rcity).length) {
        console.warn('[xiaochao] 山河配置解析后 Rcity 为空');
        rogueMapData = null;
      }
    } catch (error) {
      console.warn('[xiaochao] 山河配置解析失败', error);
    }
  }
  let extraAssistData: ExtraAssistConfigData | null = null;
  if (spellExtendRaw) {
    try {
      extraAssistData = buildExtraAssistConfigData(spellExtendRaw);
    } catch (error) {
      console.warn('[xiaochao] 进阶辅助配置解析失败', error);
    }
  }
  return {
    cards,
    spellIdsByName: buildSpellIdsByName(spells),
    autoTaskData,
    rogueMapData,
    extraAssistData,
    spellExtendRaw
  };
}

/** 自动任务配置缺失或损坏不影响卡牌字典。 */
async function loadAutoTaskData(archive: ZipArchive, codecs: GameConfigCodecs): Promise<AutoTaskConfigData | null> {
  const files: Partial<Record<AutoTaskConfigFileName, unknown>> = {};
  await Promise.all(AUTO_TASK_CONFIG_FILES.map(async (fileName) => {
    try {
      files[fileName] = await readConfigFile(archive, codecs, fileName);
    } catch (error) {
      console.warn(`[xiaochao] 自动任务配置读取失败: ${fileName}`, error);
    }
  }));
  try {
    return buildAutoTaskConfigData(files, configDayStamp(new Date()));
  } catch (error) {
    console.warn('[xiaochao] 自动任务配置解析失败', error);
    return null;
  }
}

/** 山河 Rplot 需要技能名 / 牌名；与卡牌字典同源解析。 */
function buildRogueNameTables(playCards: unknown, spells: unknown): {
  spells: Map<number, { name: string; desc: string }>;
  cards: Map<number, {
    name: string;
    desc?: string;
    subType?: number;
    type?: number;
    color?: unknown;
    number?: unknown;
  }>;
} {
  const spellMap = new Map<number, { name: string; desc: string }>();
  for (const entry of asArray(asRecord(asRecord(spells)?.GameSpells)?.spell)) {
    const record = asRecord(entry);
    const spellId = Number(record?.a);
    if (!Number.isFinite(spellId)) continue;
    spellMap.set(spellId, {
      name: typeof record?.c === 'string' ? record.c : '',
      desc: typeof record?.o === 'string' ? stripSpellMarkup(record.o) : ''
    });
  }

  const playCardRoot = asRecord(playCards);
  const abbreviation = new Map<string, string>();
  for (const entry of asArray(playCardRoot?.abbreviation)) {
    const record = asRecord(entry);
    if (typeof record?.Short === 'string' && typeof record.Long === 'string') {
      abbreviation.set(record.Short, record.Long);
    }
  }
  const cardMap = new Map<number, {
    name: string;
    desc?: string;
    subType?: number;
    type?: number;
    color?: unknown;
    number?: unknown;
  }>();
  for (const entry of asArray(asRecord(playCardRoot?.GamePlayCards)?.card)) {
    const record = asRecord(entry);
    if (!record) continue;
    const card: UnknownRecord = {};
    for (const [key, value] of Object.entries(record)) card[abbreviation.get(key) ?? key] = value;
    const cardId = Number(card.id);
    if (!Number.isInteger(cardId) || cardId <= 0) continue;
    const spell = spellMap.get(Number(card.spellId));
    cardMap.set(cardId, {
      name: typeof card.name === 'string' ? card.name : (spell?.name ?? ''),
      desc: spell?.desc,
      subType: Number(card.subType),
      type: Number(card.type),
      color: card.color,
      number: card.number ?? card.num
    });
  }
  return { spells: spellMap, cards: cardMap };
}

export function buildSpellIdsByName(spells: unknown): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const entry of asArray(asRecord(asRecord(spells)?.GameSpells)?.spell)) {
    const record = asRecord(entry);
    const spellId = Number(record?.a);
    if (!Number.isInteger(spellId) || spellId <= 0 || typeof record?.c !== 'string') continue;
    const ids = result.get(record.c) ?? [];
    ids.push(spellId);
    result.set(record.c, ids);
  }
  return result;
}

/** 字段缩写表 abbreviation 把压缩键（a/b/c…）还原成 id/name/spellId 等完整字段。 */
export function buildCardDictionary(playCards: unknown, spells: unknown): CardConfigDictionary {
  const playCardRoot = asRecord(playCards);
  const abbreviation = new Map<string, string>();
  for (const entry of asArray(playCardRoot?.abbreviation)) {
    const record = asRecord(entry);
    if (typeof record?.Short === 'string' && typeof record.Long === 'string') {
      abbreviation.set(record.Short, record.Long);
    }
  }
  const spellNames = new Map<number, { name: string; desc: string }>();
  for (const entry of asArray(asRecord(asRecord(spells)?.GameSpells)?.spell)) {
    const record = asRecord(entry);
    const spellId = Number(record?.a);
    if (!Number.isFinite(spellId)) continue;
    spellNames.set(spellId, {
      name: typeof record?.c === 'string' ? record.c : '',
      desc: typeof record?.o === 'string' ? stripSpellMarkup(record.o) : ''
    });
  }
  const dictionary: CardConfigDictionary = {};
  for (const entry of asArray(asRecord(playCardRoot?.GamePlayCards)?.card)) {
    const record = asRecord(entry);
    if (!record) continue;
    const card: UnknownRecord = {};
    for (const [key, value] of Object.entries(record)) card[abbreviation.get(key) ?? key] = value;
    const cardId = Number(card.id);
    if (!Number.isInteger(cardId) || cardId <= 0) continue;
    const spell = spellNames.get(Number(card.spellId));
    dictionary[cardId] = { ...card, name: card.name ?? spell?.name, desc: spell?.desc };
  }
  return dictionary;
}

function stripSpellMarkup(text: string): string {
  return text.replace(/<[^<>]*>/g, '').replace(/#.*/g, '').replace(/[;\n]+$/g, '');
}

async function readConfigFile(
  archive: ZipArchive,
  codecs: GameConfigCodecs,
  fileName: string
): Promise<unknown> {
  const file = archive.file(fileName);
  if (!file) throw new Error(`Config_w.sgs 缺少 ${fileName}`);
  const encrypted = await file.async('arraybuffer');
  return JSON.parse(new TextDecoder().decode(codecs.gunzip(codecs.decrypt(encrypted))));
}

/** 优先复用游戏自己已经请求过的地址，命中浏览器缓存且版本号一致。 */
function resolveConfigUrl(globalObject: Window): string {
  if (globalObject.location.host === 'test.sanguosha.com') return TEST_CONFIG_URL;
  try {
    const entries = globalObject.performance.getEntriesByType('resource');
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index] as PerformanceResourceTiming;
      if (entry.responseEnd > 0 && isConfigArchiveUrl(entry.name, globalObject)) return entry.name;
    }
  } catch {
    // Performance API 不可用时回退到按 resourceVersion 拼接的地址。
  }
  const version = (globalObject as unknown as UnknownRecord).resourceVersion;
  return `${CONFIG_ORIGIN}${CONFIG_PATH}?v=${version ?? ''}`;
}

function isConfigArchiveUrl(url: string, globalObject: Window): boolean {
  try {
    const parsed = new URL(url, globalObject.location.href);
    return parsed.origin === CONFIG_ORIGIN && parsed.pathname.replace(/\/+/g, '/') === CONFIG_PATH;
  } catch {
    return false;
  }
}

async function downloadArchive(url: string): Promise<ArrayBuffer> {
  let lastError: unknown;
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.arrayBuffer();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

declare const JSZip: unknown;
declare const CtrUtil: unknown;
declare const Zlib: unknown;

/** 游戏用顶层 let/const 声明这些库，只存在于全局词法作用域，不挂在 window 上。 */
function readGameGlobals(globalObject: Window): Record<'JSZip' | 'CtrUtil' | 'Zlib', unknown> {
  const globals = globalObject as unknown as UnknownRecord;
  return {
    JSZip: globals.JSZip ?? (typeof JSZip === 'undefined' ? undefined : JSZip),
    CtrUtil: globals.CtrUtil ?? (typeof CtrUtil === 'undefined' ? undefined : CtrUtil),
    Zlib: globals.Zlib ?? (typeof Zlib === 'undefined' ? undefined : Zlib)
  };
}

function describeMissingCodecs(globalObject: Window): string {
  const globals = readGameGlobals(globalObject) as Record<string, any>;
  return JSON.stringify({
    JSZip: typeof globals.JSZip?.loadAsync,
    CtrUtil: typeof globals.CtrUtil?.Ctr?.Ofb_Dec,
    Zlib: typeof globals.Zlib?.Gunzip
  });
}

function readGameConfigCodecs(globalObject: Window): GameConfigCodecs | null {
  const globals = readGameGlobals(globalObject);
  const jsZip = asObjectLike(globals.JSZip);
  const ctr = asObjectLike(asObjectLike(globals.CtrUtil)?.Ctr);
  const zlib = asObjectLike(globals.Zlib);
  const loadAsync = jsZip?.loadAsync;
  const decrypt = ctr?.Ofb_Dec;
  const Gunzip = zlib?.Gunzip as (new (data: unknown) => { decompress(): Uint8Array }) | undefined;
  if (typeof loadAsync !== 'function' || typeof decrypt !== 'function' || typeof Gunzip !== 'function') return null;
  return {
    loadZip: (data) => (loadAsync as (data: ArrayBuffer) => Promise<ZipArchive>).call(jsZip, data),
    decrypt: (data) => (decrypt as (data: ArrayBuffer) => unknown).call(ctr, data),
    gunzip: (data) => new Gunzip(data).decompress()
  };
}

/** 游戏库常以函数（类 / 命名空间）形式暴露静态成员。 */
function asObjectLike(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}
