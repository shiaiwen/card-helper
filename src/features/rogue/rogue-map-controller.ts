import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { ROGUE_MAP_KEY } from './rogue-settings.ts';
import {
  createRogueMapConfigSourceFromCardConfig,
  type RogueMapConfigSource
} from './rogue-map-config-source.ts';
import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import { buildPanelDrafts } from './rogue-map-event-text.ts';
import {
  cityImageReady,
  fingerprintCities,
  needsRaidGate,
  readCityHasEvent,
  readMapViewport,
  readRaidItem,
  readRaidObstacle,
  resolveCityGeometry
} from './rogue-map-geometry.ts';
import { estimatePanelHeight, layoutMapPanels } from './rogue-map-layout.ts';
import {
  ROGUE_MAP_STYLE,
  EMPTY_ROGUE_MAP_RUNTIME,
  type RogueCitySpot,
  type RogueMapPanelLayout,
  type RogueMapRuntime,
  type RogueRect
} from './rogue-map-types.ts';
import {
  clearCityOverlays,
  createCityOverlayNodes,
  hasMountedCityOverlay,
  mountCityOverlays
} from './rogue-map-view.ts';

type UnknownRecord = Record<string, unknown>;

export interface RogueMapController {
  /** 协议分发前：从山河同步包抽出 cities / difficulty。 */
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export interface RogueMapOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  configSource?: RogueMapConfigSource;
  /** 与卡牌配置同源；未显式传入 configSource 时使用。 */
  cardConfigSource?: Pick<CardConfigSource, 'getRogueMapData'>;
  /** 测试用：替换轮询定时器。 */
  intervalMs?: number;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

/**
 * 对照 app.bak `f6(kN)`：业务在 ProtoObj.allData；外层只有 ClassName。
 * 兼容直接传入 allData / manager 缓存的测试与回填路径。
 */
function readAllData(payload: UnknownRecord): UnknownRecord | null {
  const body = asRecord(payload.ProtoObj)
    ?? asRecord(payload.protoObj)
    ?? payload;
  return asRecord(body.allData)
    ?? asRecord(body.AllData)
    ?? asRecord(body.data)
    ?? asRecord(body.Data)
    ?? body;
}

function extractCities(payload: UnknownRecord): RogueCitySpot[] | null {
  const allData = readAllData(payload);
  if (!allData) return null;
  const chapterData = asRecord(allData.chapterData) ?? asRecord(allData.ChapterData);
  const locations = chapterData?.locations ?? chapterData?.Locations;
  if (!Array.isArray(locations)) return null;
  return locations.map((entry) => {
    const record = asRecord(entry) ?? {};
    return {
      id: record.location ?? record.Location ?? record.id ?? record.ID,
      event: record.event ?? record.Event
    };
  }).filter((spot) => spot.id != null && spot.event != null) as RogueCitySpot[];
}

function extractRuntime(payload: UnknownRecord, previous: RogueMapRuntime): RogueMapRuntime {
  const allData = readAllData(payload) ?? {};
  const seasonData = asRecord(allData.seasonData) ?? asRecord(allData.SeasonData) ?? {};
  const chapterData = asRecord(allData.chapterData) ?? asRecord(allData.ChapterData) ?? {};
  const gameData = asRecord(allData.gameData) ?? asRecord(allData.GameData) ?? {};
  const seedData = asRecord(gameData.seedData) ?? asRecord(gameData.SeedData) ?? {};
  const difficulty = Number(seasonData.difficulty ?? seasonData.Difficulty);
  const seasonId = Number(seasonData.seasonId ?? seasonData.SeasonId ?? seasonData.seasonID);
  const accday = Number(chapterData.accday ?? chapterData.Accday);
  const chapterId = Number(chapterData.chapterId ?? chapterData.ChapterId);
  const passChapter = Array.isArray(gameData.passChapter)
    ? gameData.passChapter.length
    : Number(gameData.passChapter ?? previous.passChapter);
  const seedItem = Array.isArray(seedData.seedItem)
    ? seedData.seedItem
    : Array.isArray(gameData.seedItem)
      ? gameData.seedItem
      : previous.seedItem;
  return {
    difficulty: Number.isFinite(difficulty) ? difficulty : previous.difficulty,
    seasonId: Number.isFinite(seasonId) && seasonId > 0 ? seasonId : previous.seasonId,
    accday: Number.isFinite(accday) ? accday : previous.accday,
    passChapter: Number.isFinite(passChapter) ? passChapter : previous.passChapter,
    chapterId: Number.isFinite(chapterId) ? chapterId : previous.chapterId,
    seedItem
  };
}

/**
 * 山河地图透视：在 `RogueSmallMapScene.cityView` 上绘制城池事件面板。
 * 数据来自卡牌包山河配置 + `decodeRogueLikeDataSync`，不依赖旧脚本 DOM/开关。
 */
export function installRogueMapController(
  configStore: XiaochaoConfigStore,
  options: RogueMapOptions = {}
): RogueMapController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const configSource = options.configSource
    ?? (options.cardConfigSource
      ? createRogueMapConfigSourceFromCardConfig(options.cardConfigSource)
      : null);
  if (!configSource) {
    throw new Error('[xiaochao] 山河地图需要 cardConfigSource 或 configSource');
  }
  const intervalMs = options.intervalMs ?? ROGUE_MAP_STYLE.pollMs;

  let disposed = false;
  let cities: RogueCitySpot[] = [];
  /** 已收到过 locations 同步后，禁止再用 manager 旧缓存把空列表填回来。 */
  let citiesSynced = false;
  let runtime: RogueMapRuntime = { ...EMPTY_ROGUE_MAP_RUNTIME, seedItem: [] };
  let lastFingerprint = '';
  let drawToken = 0;
  /** 离开地图后 findCityView 为空，靠这个清掉已挂的面板。 */
  let lastCityView: UnknownRecord | null = null;

  function enabled(): boolean {
    return configStore.get(ROGUE_MAP_KEY) === true;
  }

  function isNodeVisible(node: UnknownRecord | null): boolean {
    if (!node || node.destroyed) return false;
    if (typeof node._visible === 'boolean') return node._visible;
    return node.visible !== false;
  }

  /** 对照 app.bak `KR`：只认地图场景，不回落到当前战斗场景。 */
  function findMapScene(): UnknownRecord | null {
    for (const sceneName of ['RogueSmallMapScene', 'RogueLikeBigMapScene']) {
      const scenes = locator.findInLayer('SceneLayer', sceneName);
      const scene = asRecord(scenes[0]);
      if (scene && !scene.destroyed) return scene;
    }
    return null;
  }

  function findCityView(): UnknownRecord | null {
    const scene = findMapScene();
    if (!scene || !isNodeVisible(scene)) return null;
    const cityView = asRecord(scene?.cityView);
    if (cityView && !cityView.destroyed && typeof cityView.GetCityItemById === 'function') {
      return cityView;
    }
    return null;
  }

  /** 漏接同步包时，从 PveManager / 地图场景缓存回填或对齐 cities。 */
  function pullCitiesFromRuntime(mode: 'fill-empty' | 'reconcile'): void {
    if (mode === 'fill-empty') {
      if (cities.length) return;
      // 已收到过空 locations 时，禁止用 manager 旧缓存把面板填回来；
      // 重新进入地图时走 reconcile / allow 分支。
      if (citiesSynced) return;
    }
    const manager = asRecord(locator.manager('RogueLikePveManager'));
    const candidates = [
      manager,
      asRecord(manager?.allData),
      asRecord(manager?.AllData),
      asRecord(manager?.data),
      asRecord(manager?.gameData),
      asRecord(findMapScene())
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const next = extractCities(candidate);
      if (next == null) continue;
      if (mode === 'fill-empty' && !next.length) continue;
      cities = next;
      citiesSynced = true;
      runtime = extractRuntime(candidate, runtime);
      return;
    }
  }

  function recoverCitiesFromRuntime(allowWhenSyncedEmpty = false): void {
    if (allowWhenSyncedEmpty) {
      // 回图：允许用 manager 最新 locations 覆盖（含非空）。
      const wasSynced = citiesSynced;
      citiesSynced = false;
      pullCitiesFromRuntime('fill-empty');
      if (!cities.length) citiesSynced = wasSynced;
      return;
    }
    pullCitiesFromRuntime('fill-empty');
  }

  function clear(target?: UnknownRecord | null): void {
    drawToken += 1;
    lastFingerprint = '';
    const view = target ?? lastCityView ?? findCityView();
    clearCityOverlays(view);
    if (!findCityView()) lastCityView = null;
  }

  let mapWasLive = false;

  function redraw(force = false): void {
    if (disposed) return;
    if (!enabled()) {
      clear();
      mapWasLive = false;
      publishDebug({ reason: 'disabled' });
      return;
    }

    const cityView = findCityView();
    const mapLive = Boolean(cityView);
    // 刚回到地图：同步包可能没带 locations，允许从 manager 回填。
    const justEnteredMap = mapLive && !mapWasLive;
    if (justEnteredMap) recoverCitiesFromRuntime(true);
    else if (mapLive && cities.length) pullCitiesFromRuntime('reconcile');
    else recoverCitiesFromRuntime(false);
    mapWasLive = mapLive;

    const config = configSource.get();
    if (!config || !Object.keys(config.Rcity).length) {
      clear();
      publishDebug({ reason: 'no-config' });
      return;
    }

    // 对照 M0：无 cityView / 无 cities 时清面板（离开地图必须消失）。
    if (!cityView || !cities.length) {
      clear();
      publishDebug({ reason: !cityView ? 'no-cityView' : 'no-cities', cities });
      return;
    }
    lastCityView = cityView;

    // 难度未同步前不按 raid 门控清空；对照 app.bak Ke 只在已知 difficulty≤100 时等待 raid。
    if (runtime.difficulty > 0 && needsRaidGate(runtime.difficulty) && !readRaidItem(cityView)) {
      clear(cityView);
      publishDebug({ reason: 'raid-gate', cities, difficulty: runtime.difficulty });
      return;
    }

    const fingerprint = fingerprintCities(cityView, cities);
    // 已领取 / 已打完：HasEvent 显式 false（含 0）不再画；unknown 仍画以免贴图未就绪误伤。
    const activeCities = cities.filter((city) => readCityHasEvent(cityView, city.id) !== 'false');
    if (!activeCities.length) {
      clear(cityView);
      lastFingerprint = fingerprint;
      publishDebug({ reason: 'no-active-cities', cities, fingerprint });
      return;
    }

    const pending = activeCities.some((city) => (
      config.Rcity[String(city.id)] && !cityImageReady(cityView, city.id)
    ));
    if (pending) {
      // 指纹变了（例如领取后 HasEvent 翻转）必须先清旧面板，否则会卡在「等贴图」分支里一直显示已领取内容。
      if (force || fingerprint !== lastFingerprint) {
        clearCityOverlays(cityView);
        lastFingerprint = '';
      }
      publishDebug({ reason: 'pending-images', cities, activeCities });
      return;
    }

    if (!force && fingerprint === lastFingerprint && hasMountedCityOverlay(cityView)) {
      publishDebug({ reason: 'fingerprint-hit', cities, fingerprint });
      return;
    }

    const token = ++drawToken;
    const obstacles: RogueRect[] = [];
    const raid = readRaidObstacle(cityView);
    if (raid) obstacles.push(raid);

    const drafts = buildPanelDrafts(config, activeCities, runtime);
    if (!drafts.length) {
      clear(cityView);
      lastFingerprint = fingerprint;
      publishDebug({ reason: 'no-drafts', cities, activeCities, fingerprint });
      return;
    }

    const laidOutSeed = drafts.map((draft) => {
      const meta = config.Rcity[String(draft.id)] ?? { x: 0, y: 0 };
      const geometry = resolveCityGeometry(cityView, draft.id, meta);
      const visual = geometry.visualArea || geometry;
      if (readCityHasEvent(cityView, draft.id) === 'true') {
        obstacles.push({
          id: draft.id,
          x: visual.x,
          y: visual.y,
          w: visual.w,
          h: visual.h,
          centerX: geometry.centerX,
          centerY: geometry.centerY
        });
      }
      const height = estimatePanelHeight(draft.title, draft.lines);
      // 盖在城池中心上，贴近说明；mouseEnabled=false 不挡点击。
      return {
        ...draft,
        x0: geometry.centerX - ROGUE_MAP_STYLE.panelWidth / 2,
        y0: geometry.centerY - height / 2,
        x: geometry.centerX - ROGUE_MAP_STYLE.panelWidth / 2,
        y: geometry.centerY - height / 2,
        w: ROGUE_MAP_STYLE.panelWidth,
        h: height,
        centerX: geometry.centerX,
        centerY: geometry.centerY
      } satisfies RogueMapPanelLayout;
    });

    const panels = layoutMapPanels(laidOutSeed, obstacles, ROGUE_MAP_STYLE.layoutGap, readMapViewport(cityView, findMapScene()));
    if (token !== drawToken) return;

    const nodes = panels.flatMap((panel) => createCityOverlayNodes(panel));
    mountCityOverlays(cityView, nodes);
    lastFingerprint = fingerprint;
    publishDebug({
      reason: 'mounted',
      cities,
      drafts: drafts.map((d) => ({
        id: d.id,
        title: d.title,
        lineCount: d.lines.length,
        kinds: d.lines.map((l) => l.kind)
      })),
      panels: panels.map((p) => ({ id: p.id, title: p.title, x: p.x, y: p.y, w: p.w, h: p.h })),
      fingerprint
    });
  }

  function publishDebug(detail: Record<string, unknown>): void {
    try {
      (globalObject as UnknownRecord).__XIAOCHAO_ROGUE_MAP_DEBUG__ = {
        at: Date.now(),
        enabled: enabled(),
        cityCount: cities.length,
        synced: citiesSynced,
        difficulty: runtime.difficulty,
        ...detail
      };
    } catch {
      // ignore
    }
  }

  const pollTimer = globalObject.setInterval(() => {
    if (!disposed) redraw();
  }, intervalMs);

  const unsubscribe = configStore.subscribe(ROGUE_MAP_KEY, ({ value }) => {
    if (!value) clear();
    else redraw(true);
  });

  if (enabled()) redraw(true);

  return {
    filterMessage(payload, className) {
      if (className !== 'decodeRogueLikeDataSync') return;
      const nextCities = extractCities(payload);
      if (nextCities) {
        cities = nextCities;
        citiesSynced = true;
      }
      runtime = extractRuntime(payload, runtime);
      if (enabled()) redraw(true);
    },
    dispose() {
      disposed = true;
      unsubscribe();
      globalObject.clearInterval(pollTimer);
      clear();
      configSource.dispose();
    }
  };
}
