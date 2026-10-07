/**
 * 原生明牌预览：在游戏 UI 上展示已鉴定牌面（受显示设置控制）。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { GameCardCatalog } from '../cards/game-card-catalog.ts';
import {
  createOfficialCardView,
  detachOfficialDrawLayer,
  OFFICIAL_CARD_BASE_HEIGHT,
  OFFICIAL_CARD_BASE_WIDTH,
  releaseOfficialCardView,
  type OfficialCardView
} from '../cards/official-card-renderer.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import type { SeatStateStore } from '../seat-display/seat-state-store.ts';
import type { MingpaiEngine } from './mingpai-engine.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';

type UnknownRecord = Record<string, unknown>;
interface Rect { x: number; y: number; width: number; height: number }

// 明牌卡牌预览的布局常量。
const TILE_WIDTH = 41;
const TILE_HEIGHT = 50;
const TILE_GAP = 4;
const ROW_GAP = 4;
const MAX_VISIBLE_TILES = 5;
const POSSIBLE_ALPHA = 0.72;
const POSSIBLE_MARK_COLOR = '#D90000';
const POPUP_SECTION_GAP = 10;
const STRIP_SCALE = 2 / 3;
const VIEWPORT_MARGIN = 12;
const STRIP_OFFSET_X = 2;
const STRIP_OFFSET_Y = 10;
const POPUP_OFFSET = 14;
const POPUP_CARD_SCALE = 0.85;
const POPUP_PADDING = 8;
const POPUP_TITLE_HEIGHT = 26;
const HIDE_DELAY_MS = 120;
const POLL_INTERVAL_MS = 250;
const GAME_FONT = 'fzltchjw';
const NATIVE_GUARD_KEY = '__xcVueMingpaiNativeGuard';

interface SeatStrip {
  seatId: number;
  strip: UnknownRecord;
  hit: UnknownRecord;
  signature: string;
  cardIds: number[];
  possibleIds: number[];
  tagsByCardId: Map<number, string[]>;
  anchor: Rect | null;
  nativeSprite: UnknownRecord | null;
}

/** 在其他武将牌下方用 Laya 画明牌小牌条，悬停弹出官方牌面列表。 */
export function installNativeMingpaiPreviewController(
  configStore: XiaochaoConfigStore,
  seatStateStore: SeatStateStore,
  gameCardCatalog: GameCardCatalog,
  mingpaiEngine?: MingpaiEngine,
  gameEvents?: GameEventBus
): () => void {
  let stopped = false;
  let scene: UnknownRecord | null = null;
  let parent: UnknownRecord | null = null;
  let root: UnknownRecord | null = null;
  const strips = new Map<number, SeatStrip>();
  const recommendedBySeat = new Map<number, Set<number>>();
  const selectedBySeat = new Map<number, Set<number>>();
  const markTimers = new Map<number, number>();
  const tagMethodPatches: { prototype: object; descriptor: PropertyDescriptor }[] = [];
  let syncing = false;
  let lastEquipmentTagRefreshAt = 0;
  let popup: UnknownRecord | null = null;
  let popupCards: OfficialCardView[] = [];
  let popupSeatId: number | null = null;
  let popupSignature = '';
  let pinnedSeatId: number | null = null;
  let hideTimer = 0;

  const clearHideTimer = () => {
    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = 0;
  };
  const scheduleHide = () => {
    if (pinnedSeatId !== null) return;
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      destroyPopup();
    }, HIDE_DELAY_MS);
  };

  function destroyPopup(): void {
    popupCards.forEach((view) => releaseOfficialCardView(view));
    popupCards = [];
    popupSeatId = null;
    popupSignature = '';
    if (popup) {
      detachOfficialDrawLayer(popup);
      try {
        call(popup, 'removeSelf');
        if (typeof popup.addDrawChild !== 'function') call(popup, 'destroy', false);
      } catch {
        // 场景切换时节点可能已销毁。
      }
    }
    popup = null;
  }

  function destroyStrip(entry: SeatStrip): void {
    restoreNativeSprite(entry);
    destroyNode(entry.strip);
    strips.delete(entry.seatId);
    if (popupSeatId === entry.seatId) destroyPopup();
    if (pinnedSeatId === entry.seatId) pinnedSeatId = null;
  }

  function destroyAll(): void {
    clearHideTimer();
    destroyPopup();
    [...strips.values()].forEach(destroyStrip);
    if (root) destroyNode(root);
    scene = parent = root = null;
    pinnedSeatId = null;
  }

  function ensureRoot(): UnknownRecord | null {
    const nextScene = asRecord(locateGameScene(window));
    const roundInfo = asRecord(nextScene?.gameRoundInfo);
    const nextParent = asRecord(roundInfo?._parent) ?? roundInfo ?? nextScene;
    if (!nextScene || !nextParent || nextScene.destroyed || nextParent.destroyed) {
      destroyAll();
      return null;
    }
    if (scene !== nextScene || parent !== nextParent || !root || root.destroyed || !(root.parent || root._parent)) {
      destroyAll();
      const created = createSprite('xcVueMingpaiPreviewRoot');
      if (!created) return null;
      created.mouseEnabled = true;
      created.mouseThrough = true;
      created.zOrder = 200000;
      call(created, 'pos', 0, 0);
      call(nextParent, 'addChild', created);
      call(nextParent, 'sortChildren');
      scene = nextScene;
      parent = nextParent;
      root = created;
    }
    const viewport = readViewport(root);
    call(root, 'size', Math.max(1, Number(parent?.width) || viewport.x + viewport.width), Math.max(1, Number(parent?.height) || viewport.y + viewport.height));
    return root;
  }

  function createStrip(seatId: number, host: UnknownRecord): SeatStrip | null {
    const strip = createSprite(`xcVueMingpaiPreviewStrip-${seatId}`);
    const hit = createSprite(`xcVueMingpaiPreviewHit-${seatId}`);
    if (!strip || !hit) return null;
    strip.mouseEnabled = true;
    strip.mouseThrough = true;
    strip.zOrder = 100 + seatId;
    hit.mouseEnabled = true;
    hit.mouseThrough = false;
    hit.hitTestPrior = true;
    hit.zOrder = 1000;
    call(strip, 'addChild', hit);
    call(host, 'addChild', strip);
    const entry: SeatStrip = {
      seatId, strip, hit, signature: '', cardIds: [], possibleIds: [], tagsByCardId: new Map(),
      anchor: null, nativeSprite: null
    };
    const Event = readLayaEvent();
    call(hit, 'on', Event?.ROLL_OVER ?? 'mouseover', entry, () => {
      if (pinnedSeatId !== null && pinnedSeatId !== seatId) return;
      clearHideTimer();
      showPopup(entry);
    });
    call(hit, 'on', Event?.ROLL_OUT ?? 'mouseout', entry, scheduleHide);
    call(hit, 'on', Event?.CLICK ?? 'click', entry, (event: UnknownRecord) => {
      call(event, 'stopPropagation');
      clearHideTimer();
      pinnedSeatId = pinnedSeatId === seatId ? null : seatId;
      if (pinnedSeatId === null) destroyPopup();
      else showPopup(entry);
    });
    strips.set(seatId, entry);
    return entry;
  }

  function renderStrip(
    entry: SeatStrip,
    cardIds: number[],
    possibleIds: number[],
    tagsByCardId: Map<number, string[]>,
    anchor: Rect
  ): void {
    const rows = [
      { cardIds, possible: false },
      { cardIds: possibleIds, possible: true }
    ].filter((row) => row.cardIds.length);
    const signature = `${cardIds.join(',')}|${possibleIds.join(',')}|${JSON.stringify([...tagsByCardId])}`;
    if (entry.signature !== signature) {
      readChildren(entry.strip)
        .filter((child) => child !== entry.hit)
        .forEach(destroyNode);
      rows.forEach((row, rowIndex) => {
        const y = rowIndex * (TILE_HEIGHT + ROW_GAP);
        const truncated = row.cardIds.length > MAX_VISIBLE_TILES;
        const visible = truncated ? row.cardIds.slice(0, MAX_VISIBLE_TILES - 1) : row.cardIds;
        visible.forEach((cardId, index) => {
          const tile = createTile(cardId, row.possible, tagsByCardId.get(cardId) ?? []);
          if (!tile) return;
          call(tile, 'pos', (TILE_WIDTH + TILE_GAP) * index, y);
          tile.zOrder = index + 2;
          call(entry.strip, 'addChild', tile);
        });
        if (truncated) {
          const ellipsis = createEllipsisTile();
          if (ellipsis) {
            call(ellipsis, 'pos', (TILE_WIDTH + TILE_GAP) * visible.length, y);
            ellipsis.zOrder = visible.length + 2;
            call(entry.strip, 'addChild', ellipsis);
          }
        }
      });
      call(entry.strip, 'sortChildren');
      entry.signature = signature;
    }
    entry.cardIds = cardIds;
    entry.possibleIds = possibleIds;
    entry.tagsByCardId = tagsByCardId;
    entry.anchor = anchor;
    const tileCount = Math.max(0, ...rows.map((row) => Math.min(row.cardIds.length, MAX_VISIBLE_TILES)));
    const width = tileCount * TILE_WIDTH + Math.max(0, tileCount - 1) * TILE_GAP;
    const height = rows.length * TILE_HEIGHT + Math.max(0, rows.length - 1) * ROW_GAP;
    const viewport = readViewport(root);
    const scaledWidth = width * STRIP_SCALE;
    const scaledHeight = height * STRIP_SCALE;
    const x = clamp(anchor.x - STRIP_OFFSET_X, viewport.x + VIEWPORT_MARGIN, viewport.x + viewport.width - scaledWidth - VIEWPORT_MARGIN);
    const y = clamp(anchor.y + anchor.height + STRIP_OFFSET_Y, viewport.y + VIEWPORT_MARGIN, viewport.y + viewport.height - scaledHeight - VIEWPORT_MARGIN);
    call(entry.strip, 'size', width, height);
    call(entry.strip, 'scale', STRIP_SCALE, STRIP_SCALE);
    entry.strip.scaleX = STRIP_SCALE;
    entry.strip.scaleY = STRIP_SCALE;
    call(entry.strip, 'pos', x, y);
    call(entry.hit, 'size', width, height);
    call(entry.hit, 'pos', 0, 0);
    entry.strip.visible = rows.length > 0;
  }

  function createTile(cardId: number, possible = false, tags: readonly string[] = []): UnknownRecord | null {
    const card = gameCardCatalog.resolve(cardId);
    const tile = createSprite(`xcVueMingpaiPreviewTag-${cardId}`);
    if (!tile) return null;
    tile.mouseEnabled = false;
    tile.mouseThrough = true;
    call(tile, 'size', TILE_WIDTH, TILE_HEIGHT);
    drawRoundedRect(tile, TILE_WIDTH, TILE_HEIGHT, 'rgba(255, 239, 207, 0.7)', '#392F22', 1, 4);

    const headHeight = Math.max(20, Math.round(TILE_HEIGHT * 0.53));
    const color = card.isRed ? '#E23E3E' : '#020000';
    const rank = card.rank || '?';
    const suit = card.suitGlyph || '';
    const head = createSprite('xcVueMingpaiPreviewRankSuit');
    const suitText = createText(suit, 20, color, 'left');
    const rankText = createText(rank, 20, color, 'left');
    if (head && suitText && rankText) {
      head.mouseEnabled = false;
      head.mouseThrough = true;
      const rankWidth = Math.max(1, Math.ceil(Number(rankText.textWidth) || 20 * Math.max(0.55, rank.length * 0.55)));
      const suitWidth = suit ? Math.max(1, Math.ceil(Number(suitText.textWidth) || 20)) : 0;
      const total = rankWidth + suitWidth;
      const fit = Math.min(1, TILE_WIDTH / total);
      call(head, 'size', total, headHeight + 4);
      head.scaleX = fit;
      call(head, 'pos', (TILE_WIDTH - total * fit) / 2, 0);
      call(suitText, 'size', suitWidth, headHeight + 4);
      call(suitText, 'pos', 0, 0);
      call(rankText, 'size', rankWidth, headHeight + 4);
      call(rankText, 'pos', suitWidth, 0);
      call(head, 'addChild', suitText);
      call(head, 'addChild', rankText);
      call(tile, 'addChild', head);
    }
    const shortName = createText((card.name || '?').slice(0, 2) || '?', 18, '#020000', 'center');
    if (shortName) {
      call(shortName, 'size', TILE_WIDTH, Math.max(1, TILE_HEIGHT - headHeight + 3));
      call(shortName, 'pos', 0, headHeight - 1);
      call(tile, 'addChild', shortName);
    }
    if (possible) {
      const markWidth = Math.max(9, Math.round(TILE_WIDTH * 0.27));
      const markHeight = Math.max(14, Math.round(TILE_HEIGHT * 0.34));
      const mark = createText('?', Math.max(13, Math.round(TILE_HEIGHT * 0.28)), POSSIBLE_MARK_COLOR, 'center', true);
      if (mark) {
        mark.name = 'xcVueMingpaiPossibleMark';
        call(mark, 'size', markWidth, markHeight);
        call(mark, 'pos', TILE_WIDTH - markWidth, TILE_HEIGHT - markHeight);
        call(tile, 'addChild', mark);
      }
      tile.alpha = POSSIBLE_ALPHA;
    }
    if (tags.length) {
      const label = createText(tags.join('·'), 10, '#FFF1A8', 'center', true);
      if (label) {
        label.name = `xcVueMingpaiPersistentTag-${cardId}`;
        label.stroke = 2;
        label.strokeColor = '#332411';
        call(label, 'size', TILE_WIDTH, 14);
        call(label, 'pos', 0, 0);
        call(tile, 'addChild', label);
      }
    }
    return tile;
  }

  function createEllipsisTile(): UnknownRecord | null {
    const tile = createSprite('xcVueMingpaiPreviewEllipsis');
    if (!tile) return null;
    tile.mouseEnabled = false;
    tile.mouseThrough = true;
    call(tile, 'size', TILE_WIDTH, TILE_HEIGHT);
    drawRoundedRect(tile, TILE_WIDTH, TILE_HEIGHT, 'rgba(255, 239, 207, 0.7)', '#392F22', 1, 4);
    const text = createText('…', 22, '#020000', 'center');
    if (text) {
      call(text, 'size', TILE_WIDTH, TILE_HEIGHT);
      call(text, 'pos', 0, -1);
      call(tile, 'addChild', text);
    }
    return tile;
  }

  function showPopup(entry: SeatStrip): void {
    if (!root || !entry.anchor || (!entry.cardIds.length && !entry.possibleIds.length)) {
      destroyPopup();
      return;
    }
    const viewport = readViewport(root);
    const direction = chooseDirection(entry.anchor, viewport);
    const maxWidth = direction === 'right'
      ? viewport.x + viewport.width - VIEWPORT_MARGIN - entry.anchor.x - entry.anchor.width - POPUP_OFFSET
      : entry.anchor.x - viewport.x - VIEWPORT_MARGIN - POPUP_OFFSET;
    const cardWidth = Math.round(OFFICIAL_CARD_BASE_WIDTH * POPUP_CARD_SCALE);
    const cardHeight = Math.round(OFFICIAL_CARD_BASE_HEIGHT * POPUP_CARD_SCALE);
    const available = Math.max(cardWidth + POPUP_PADDING * 2, maxWidth || 1600);
    const cardGap = 8;
    const sections = [
      { label: `确定牌（${entry.cardIds.length}）`, color: '#FFF3D0', cardIds: entry.cardIds, possible: false },
      { label: `可能牌（${entry.possibleIds.length}）`, color: '#C9C1B1', cardIds: entry.possibleIds, possible: true }
    ].filter((section) => section.cardIds.length).map((section) => {
      const count = section.cardIds.length;
      const columns = Math.max(1, Math.min(count, Math.floor(
        (available - POPUP_PADDING * 2 + cardGap) / (cardWidth + cardGap)
      ) || 1));
      const rows = Math.ceil(count / columns);
      const width = POPUP_PADDING * 2 + columns * cardWidth + Math.max(0, columns - 1) * cardGap;
      const height = POPUP_TITLE_HEIGHT + rows * cardHeight + Math.max(0, rows - 1) * cardGap;
      return { ...section, columns, rows, width, height };
    });
    const width = Math.min(available, Math.max(...sections.map((section) => section.width)));
    const height = POPUP_PADDING * 2 + sections.reduce((sum, section) => sum + section.height, 0)
      + Math.max(0, sections.length - 1) * POPUP_SECTION_GAP;
    const teamMarkable = seatStateStore.getSnapshot().controlledSeatIds.includes(entry.seatId)
      && entry.seatId !== seatStateStore.getSnapshot().selfSeatId;
    const receivedMarks = recommendedBySeat.get(entry.seatId) ?? new Set<number>();
    const selectedMarks = selectedBySeat.get(entry.seatId) ?? new Set<number>();
    const signature = `${entry.seatId}:${entry.cardIds.join(',')}|${entry.possibleIds.join(',')}:${[...receivedMarks].join(',')}:${[...selectedMarks].join(',')}:${teamMarkable}:${Math.round(width)}:${direction}`;

    if (!popup || popupSignature !== signature) {
      destroyPopup();
      const created = createSprite('xcVueMingpaiCardList');
      if (!created) return;
      created.mouseEnabled = true;
      created.mouseThrough = false;
      created.zOrder = 10000;
      call(created, 'size', width, height);
      drawRoundedRect(created, width, height, 'rgba(29, 23, 18, 0.96)', '#C9A15D', 1, 6);
      const Event = readLayaEvent();
      call(created, 'on', Event?.ROLL_OVER ?? 'mouseover', created, clearHideTimer);
      call(created, 'on', Event?.ROLL_OUT ?? 'mouseout', created, scheduleHide);
      call(root, 'addChild', created);
      let sectionTop = POPUP_PADDING;
      sections.forEach((section, sectionIndex) => {
        const top = sectionTop;
        const title = createText(section.label, 14, section.color, 'left');
        if (title) {
          call(title, 'size', Math.max(1, width - POPUP_PADDING * 2), POPUP_TITLE_HEIGHT);
          call(title, 'pos', POPUP_PADDING, top);
          call(created, 'addChild', title);
        }
        section.cardIds.forEach((cardId, index) => {
          const column = index % section.columns;
          const row = Math.floor(index / section.columns);
          const x = POPUP_PADDING + column * (cardWidth + cardGap);
          const y = top + POPUP_TITLE_HEIGHT + row * (cardHeight + cardGap);
          const view = popupCards.length < 6
            ? createOfficialCardView(created, cardId, cardWidth, cardHeight)
            : null;
          if (view) {
            call(view.ui, 'pos', x, y);
            popupCards.push(view);
          } else {
            const tile = createTile(cardId, section.possible, entry.tagsByCardId.get(cardId) ?? []);
            if (tile) {
              const scaleX = cardWidth / TILE_WIDTH;
              const scaleY = cardHeight / TILE_HEIGHT;
              call(tile, 'scale', scaleX, scaleY);
              tile.scaleX = scaleX;
              tile.scaleY = scaleY;
              call(tile, 'pos', x, y);
              call(created, 'addChild', tile);
            }
          }
          if (section.label.startsWith('确定牌') && teamMarkable) {
            const marked = receivedMarks.has(cardId) || selectedMarks.has(cardId);
            if (marked) {
              const marker = createText(receivedMarks.has(cardId) ? '队友标记' : '已选择', 13, '#8FE6FF', 'center', true);
              if (marker) {
                marker.name = `xcVueMingpaiTeamMarker-${cardId}`;
                marker.stroke = 2;
                marker.strokeColor = '#142B39';
                marker.zOrder = 1500 + index;
                call(marker, 'size', cardWidth, 18);
                call(marker, 'pos', x, y + cardHeight - 20);
                call(created, 'addChild', marker);
              }
            }
            const hit = createSprite(`xcVueMingpaiTeamMarkHit-${entry.seatId}-${cardId}`);
            if (hit) {
              hit.mouseEnabled = true;
              hit.mouseThrough = false;
              hit.hitTestPrior = true;
              hit.zOrder = 1800 + index;
              call(hit, 'size', cardWidth, cardHeight);
              call(hit, 'pos', x, y);
              call(hit.graphics, 'drawRect', 0, 0, cardWidth, cardHeight, 'rgba(0,0,0,0.01)', null, 0);
              call(hit, 'on', Event?.CLICK ?? 'click', hit, (pointer: UnknownRecord) => {
                call(pointer, 'stopPropagation');
                toggleTeammateMark(entry, cardId);
              });
              call(created, 'addChild', hit);
            }
          }
          if (section.possible) {
            if (view) view.ui.alpha = POSSIBLE_ALPHA;
            const mark = createText('?', 22, POSSIBLE_MARK_COLOR, 'center', true);
            if (mark) {
              mark.name = `xcVueMingpaiPopupPossibleMark-${cardId}`;
              mark.zOrder = 900 + index;
              call(mark, 'size', 18, 24);
              call(mark, 'pos', x + cardWidth - 22, y + cardHeight - 30);
              call(created, 'addChild', mark);
            }
          }
        });
        sectionTop += section.height + (sectionIndex < sections.length - 1 ? POPUP_SECTION_GAP : 0);
      });
      popup = created;
      popupSignature = signature;
    }
    popupSeatId = entry.seatId;
    const rawX = direction === 'right'
      ? entry.anchor.x + entry.anchor.width + POPUP_OFFSET
      : entry.anchor.x - width - POPUP_OFFSET;
    const x = clamp(rawX, viewport.x + VIEWPORT_MARGIN, viewport.x + viewport.width - width - VIEWPORT_MARGIN);
    const y = clamp(
      entry.anchor.y + (entry.anchor.height - height) / 2,
      viewport.y + VIEWPORT_MARGIN,
      viewport.y + viewport.height - height - VIEWPORT_MARGIN
    );
    call(popup, 'pos', x, y);
  }

  function syncNow(): void {
    if (stopped) return;
    if (!configStore.get('display.seatUiEnabled')) {
      destroyAll();
      return;
    }
    const snapshot = seatStateStore.getSnapshot();
    if (!snapshot.inGame) {
      destroyAll();
      return;
    }
    const host = ensureRoot();
    if (!host || !scene) return;
    const seatUis = readSeatUis(scene);
    const engineSnapshot = mingpaiEngine?.getSnapshot();
    const now = Date.now();
    const refreshEquipmentTags = now - lastEquipmentTagRefreshAt >= 1000;
    if (refreshEquipmentTags) lastEquipmentTagRefreshAt = now;
    const activeSeatIds = new Set<number>();
    for (const seat of snapshot.seats) {
      const seatUi = seatUis.get(seat.seatId);
      if (seatUi && refreshEquipmentTags) {
        refreshNativeCardTags(readEquipmentCardUis(seatUi), ['炁'], false);
      }
      if (seatUi) {
        const handUis = readHandCardUis(seatUi);
        const equipUis = readEquipmentCardUis(seatUi);
        handUis.forEach((cardUi) => installXinyouTagHook(cardUi));
        equipUis.forEach((cardUi) => installXinyouTagHook(cardUi));
        refreshNativeCardTags(equipUis, ['心幽'], true);
        refreshNativeCardTags(handUis, ['心幽'], true);
      }
      if (seat.seatId === snapshot.selfSeatId) continue;
      const anchor = seatUi ? readAnchorRect(seatUi, host) : null;
      // 引擎位置表是明牌区的权威来源；座位快照负责补上场景直接公开的牌。
      // 两路合并可避免状态事件与场景轮询短暂不同步时整条已知手牌消失。
      const engineHandIds = mingpaiEngine?.getHandCardIds(seat.seatId) ?? [];
      const equipmentIds = new Set(
        (seat.equipmentCards ?? []).map((card) => card.cardId).filter((cardId) => cardId > 0)
      );
      const cardIds = [...new Set([
        ...seat.knownCards.map((card) => card.cardId),
        ...engineHandIds
      ])].filter((cardId) => cardId > 0 && !equipmentIds.has(cardId));
      const engineTagsByCardId = new Map((engineSnapshot?.records ?? [])
        .filter((record) => record.persistentTags.length)
        .map((record) => [record.cardId, record.persistentTags] as const));
      const tagsByCardId = new Map(cardIds.flatMap((cardId) => {
        const sceneTags = seat.knownCards.find((card) => card.cardId === cardId)?.tags ?? [];
        const engineTags = engineTagsByCardId.get(cardId) ?? [];
        const tags = visibleMingpaiTags([...sceneTags, ...engineTags]);
        return tags.length ? [[cardId, tags] as const] : [];
      }));
      const possibleIds = (seat.possibleCards ?? [])
        .map((card) => card.cardId)
        .filter((cardId) => cardId > 0 && !equipmentIds.has(cardId));
      const existing = strips.get(seat.seatId);
      if (!seatUi || !anchor || (!cardIds.length && !possibleIds.length)) {
        if (existing) destroyStrip(existing);
        continue;
      }
      const entry = existing ?? createStrip(seat.seatId, host);
      if (!entry) continue;
      hideNativeSprite(entry, seatUi);
      renderStrip(entry, cardIds, possibleIds, tagsByCardId, anchor);
      activeSeatIds.add(seat.seatId);
      if (popupSeatId === seat.seatId) showPopup(entry);
    }
    [...strips.values()]
      .filter((entry) => !activeSeatIds.has(entry.seatId))
      .forEach(destroyStrip);
  }

  function sync(): void {
    if (stopped || syncing) return;
    syncing = true;
    try {
      syncNow();
    } finally {
      syncing = false;
    }
  }

  function toggleTeammateMark(entry: SeatStrip, cardId: number): void {
    const snapshot = seatStateStore.getSnapshot();
    if (!snapshot.controlledSeatIds.includes(entry.seatId) || entry.seatId === snapshot.selfSeatId) return;
    const selected = selectedBySeat.get(entry.seatId) ?? new Set<number>();
    if (selected.has(cardId)) selected.delete(cardId);
    else {
      // 默认识别上限 RecCardLimit=1；游戏原生有配置时读取配置上限。
      const limit = readTeammateMarkLimit(scene);
      while (selected.size >= limit) selected.delete(selected.values().next().value as number);
      selected.add(cardId);
    }
    if (selected.size) selectedBySeat.set(entry.seatId, selected);
    else selectedBySeat.delete(entry.seatId);
    showPopup(entry);
    const previous = markTimers.get(entry.seatId);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      markTimers.delete(entry.seatId);
      const latest = selectedBySeat.get(entry.seatId) ?? new Set<number>();
      const stillKnown = new Set(seatStateStore.getSnapshot().seats
        .find((seat) => seat.seatId === entry.seatId)?.knownCards.map((card) => card.cardId) ?? []);
      const ids = [...latest].filter((id) => stillKnown.has(id));
      if (!ids.length) return;
      const currentScene = asRecord(locateGameScene(window));
      const manager = asRecord(currentScene?.Manager ?? currentScene?.manager);
      const send = manager?.SendMsgQuickChatCardTagReq;
      if (typeof send !== 'function' || !canShowTeammateMarks()) return;
      try {
        recommendedBySeat.set(entry.seatId, new Set(ids));
        send.call(manager, entry.seatId, ids);
        selectedBySeat.delete(entry.seatId);
        showPopup(entry);
      } catch (error) {
        console.warn('[明牌] 队友手牌标记发送失败', error);
      }
    }, 100);
    markTimers.set(entry.seatId, timer);
  }

  function installXinyouTagHook(rawUi: unknown): void {
    const cardUi = asRecord(rawUi);
    if (!cardUi) return;
    let prototype = Object.getPrototypeOf(cardUi) as UnknownRecord | null;
    while (prototype && !Object.prototype.hasOwnProperty.call(prototype, 'UpdateTag')) {
      prototype = Object.getPrototypeOf(prototype) as UnknownRecord | null;
    }
    if (!prototype || tagMethodPatches.some((patch) => patch.prototype === prototype)) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'UpdateTag');
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const original = descriptor.value as (this: unknown, ...args: unknown[]) => unknown;
    const patched = function (this: UnknownRecord, ...args: unknown[]) {
      stampXinyouTag(this);
      return original.apply(this, args);
    };
    try {
      Object.defineProperty(prototype, 'UpdateTag', { ...descriptor, value: patched });
      tagMethodPatches.push({ prototype, descriptor });
    } catch {
      // 原型不可写时仍靠轮询把标签写回。
    }
  }

  function stampXinyouTag(cardUi: UnknownRecord): void {
    if (!configStore.get('display.cardLabelsEnabled')) return;
    const card = asRecord(cardUi.Card) ?? asRecord(cardUi.card);
    if (!card) return;
    const cardId = Number(card.cardId ?? card.cardID ?? card.CardId ?? card.CardID ?? card.id ?? card.ID ?? card.key);
    if (!Number.isInteger(cardId) || cardId <= 0) return;
    if (!mingpaiEngine?.getPersistentTags(cardId).includes('心幽')) return;
    const tagKey = Object.prototype.hasOwnProperty.call(card, 'tagArr1') ? 'tagArr1' : 'TagArr1';
    const tags = Array.isArray(card[tagKey]) ? (card[tagKey] as unknown[]).map(String) : [];
    if (tags.includes('心幽')) return;
    card[tagKey] = [...tags, '心幽'];
  }

  /** 把持续标签刷回原生卡牌 UI。keepOnCard 时写在牌上，直到调用方去掉标签。 */
  function refreshNativeCardTags(cardUis: unknown[], labels: readonly string[], keepOnCard: boolean): void {
    const enabled = configStore.get('display.cardLabelsEnabled');
    for (const rawUi of cardUis) {
      const cardUi = asRecord(rawUi);
      const card = asRecord(cardUi?.Card) ?? asRecord(cardUi?.card) ?? cardUi;
      if (!cardUi || !card) continue;
      const cardId = Number(card.cardId ?? card.cardID ?? card.CardId ?? card.CardID ?? card.id ?? card.ID ?? card.key);
      if (!Number.isInteger(cardId) || cardId <= 0) continue;
      const persistent = mingpaiEngine?.getPersistentTags(cardId) ?? [];
      const extra = enabled ? labels.filter((label) => persistent.includes(label)) : [];
      const tagKey = Object.prototype.hasOwnProperty.call(card, 'tagArr1') ? 'tagArr1' : 'TagArr1';
      const originalTags = card[tagKey];
      const tags = Array.isArray(originalTags) ? originalTags.map(String) : [];
      const nextTags = [...new Set([...tags.filter((tag) => !labels.includes(tag)), ...extra])];
      if (!extra.length && !tags.some((tag) => labels.includes(tag))) continue;
      if (JSON.stringify(tags) === JSON.stringify(nextTags)) continue;
      try {
        call(cardUi, 'AddCardTag');
        card[tagKey] = nextTags;
        call(cardUi, 'UpdateTag');
      } catch {
        // 部分游戏版本的卡牌对象不可写，明牌预览仍会展示持续标签。
      } finally {
        if (keepOnCard) continue;
        if (originalTags === undefined) delete card[tagKey];
        else card[tagKey] = originalTags;
      }
    }
  }

  function readEquipmentCardUis(seatUi: UnknownRecord): unknown[] {
    const container = asRecord(seatUi.cardContainer);
    return [
      ...readArray(container, ['equipCardUis', 'equipCardUIs']),
      ...readArray(seatUi, ['equipCardUis', 'equipCardUIs'])
    ];
  }

  function readHandCardUis(seatUi: UnknownRecord): unknown[] {
    const container = asRecord(seatUi.cardContainer);
    return readArray(container, ['cardUis', 'cardUIs', 'handCardUis', 'handCardUIs']);
  }

  function onGameEvent(event: import('../../runtime/game-event-bus.ts').GameEvent): void {
    if (event.type !== 'friend-hand-tags-updated') return;
    recommendedBySeat.set(event.seatId, new Set(event.cardIds));
    const entry = strips.get(event.seatId);
    if (entry && popupSeatId === event.seatId) showPopup(entry);
  }

  const stopSeatState = seatStateStore.subscribe(sync);
  const stopMingpai = mingpaiEngine?.subscribe(sync);
  const stopGameEvents = gameEvents?.subscribe(onGameEvent);
  const stopConfig = configStore.subscribe('display.seatUiEnabled', sync);
  const timer = window.setInterval(sync, POLL_INTERVAL_MS);
  sync();

  return () => {
    stopped = true;
    window.clearInterval(timer);
    stopSeatState();
    stopMingpai?.();
    stopGameEvents?.();
    markTimers.forEach((timerId) => window.clearTimeout(timerId));
    markTimers.clear();
    stopConfig();
    for (const patch of tagMethodPatches) {
      const current = Object.getOwnPropertyDescriptor(patch.prototype, 'UpdateTag');
      if (!current) continue;
      try { Object.defineProperty(patch.prototype, 'UpdateTag', patch.descriptor); } catch { /* 游戏退出时对象可能已冻结。 */ }
    }
    tagMethodPatches.length = 0;
    destroyAll();
  };
}

/** 官方明牌组件与小牌条重叠，显示期间强制隐藏，卸载时恢复。 */
function hideNativeSprite(entry: SeatStrip, seatUi: UnknownRecord): void {
  const manager = asRecord(seatUi.otherTopManager) ?? asRecord(seatUi.topManager);
  const sprite = asRecord(manager?.handCardSpr);
  if (entry.nativeSprite && entry.nativeSprite !== sprite) restoreNativeSprite(entry);
  if (!sprite || sprite.destroyed) return;
  if (sprite === seatUi) return;
  const width = Number(sprite.width || sprite._width || 0);
  const height = Number(sprite.height || sprite._height || 0);
  if (width > 480 || height > 240) return;
  const name = String(sprite.name || '');
  if (/Scene|Layer|Stage|Table|Desk|gamescene/i.test(name)) return;
  entry.nativeSprite = sprite;
  if (sprite[NATIVE_GUARD_KEY]) return;
  const ownDescriptor = Object.getOwnPropertyDescriptor(sprite, 'visible');
  const inherited = findDescriptor(Object.getPrototypeOf(sprite), 'visible');
  const descriptor = ownDescriptor ?? inherited;
  let storedValue = ownDescriptor && 'value' in ownDescriptor ? Boolean(ownDescriptor.value) : Boolean(sprite.visible);
  const write = (value: boolean) => {
    if (typeof descriptor?.set === 'function') descriptor.set.call(sprite, value);
    else storedValue = value;
  };
  const guard = { ownDescriptor, requestedVisible: Boolean(sprite.visible), write, read: () => storedValue };
  try {
    Object.defineProperty(sprite, NATIVE_GUARD_KEY, { configurable: true, value: guard });
    Object.defineProperty(sprite, 'visible', {
      configurable: true,
      enumerable: ownDescriptor?.enumerable ?? false,
      get: () => false,
      set(value: unknown) {
        guard.requestedVisible = Boolean(value);
        write(false);
        if ('_visible' in sprite) sprite._visible = false;
      }
    });
    write(false);
    if ('_visible' in sprite) sprite._visible = false;
  } catch {
    // 官方组件不可改写时保持原样。
  }
}

function restoreNativeSprite(entry: SeatStrip): void {
  const sprite = entry.nativeSprite;
  entry.nativeSprite = null;
  const guard = asRecord(sprite?.[NATIVE_GUARD_KEY]) as {
    ownDescriptor?: PropertyDescriptor; requestedVisible: boolean; write(value: boolean): void;
  } | null;
  if (!sprite || !guard) return;
  try {
    if (guard.ownDescriptor) Object.defineProperty(sprite, 'visible', guard.ownDescriptor);
    else delete sprite.visible;
    delete sprite[NATIVE_GUARD_KEY];
    guard.write(guard.requestedVisible);
    if ('_visible' in sprite) sprite._visible = guard.requestedVisible;
    call(sprite, 'OnUpdateCard');
  } catch {
    // 场景切换时组件可能已销毁。
  }
}

function readSeatUis(scene: UnknownRecord): Map<number, UnknownRecord> {
  const result = new Map<number, UnknownRecord>();
  const seatUis = asRecord(scene.seatContainer)?.seatUIs;
  for (const value of Array.isArray(seatUis) ? seatUis : []) {
    const seatUi = asRecord(value);
    const seat = asRecord(seatUi?.seat);
    const seatId = Number(seat?.index ?? seat?.Index ?? seatUi?.seatID);
    if (seatUi && Number.isInteger(seatId)) result.set(seatId, seatUi);
  }
  return result;
}

/** 以武将牌（缺失时座位头像 / 座位）为锚点，换算到小牌条根节点坐标。 */
function readAnchorRect(seatUi: UnknownRecord, root: UnknownRecord): Rect | null {
  const avatar = asRecord(seatUi.seatAvatar);
  for (const node of [asRecord(avatar?.generalCard), avatar, seatUi]) {
    if (!node) continue;
    const local = readNodeRect(node);
    if (!local) continue;
    const topLeft = toRootPoint(node, root, local.x, local.y);
    const bottomRight = toRootPoint(node, root, local.x + local.width, local.y + local.height);
    if (!topLeft || !bottomRight) continue;
    return {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y)
    };
  }
  return null;
}

function readNodeRect(node: UnknownRecord): Rect | null {
  if (node.destroyed) return null;
  const accept = (value: unknown): Rect | null => {
    const record = asRecord(value);
    const width = Math.max(0, Number(record?.width) || 0);
    const height = Math.max(0, Number(record?.height) || 0);
    if (width < 40 || height < 50) return null;
    return { x: Number(record?.x) || 0, y: Number(record?.y) || 0, width, height };
  };
  const fromShowRect = accept(node.showRect);
  if (fromShowRect) return fromShowRect;
  try {
    const fromBounds = accept(call(node, 'getSelfBounds'));
    if (fromBounds) return fromBounds;
  } catch { /* 不同版本方法可能缺失。 */ }
  const width = Math.max(0, Number(node.width) || Number(node.ScaledWidth) || 0);
  const height = Math.max(0, Number(node.height) || Number(node.ScaledHeight) || 0);
  return width >= 40 && height >= 50 ? { x: 0, y: 0, width, height } : null;
}

function readViewport(root: UnknownRecord | null): Rect {
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const stage = asRecord(laya?.stage);
  const stageWidth = Math.max(1, Number(stage?.width) || Number(root?.width) || 1600);
  const stageHeight = Math.max(1, Number(stage?.height) || Number(root?.height) || 900);
  if (stage && root) {
    const topLeft = toRootPoint(stage, root, 0, 0);
    const bottomRight = toRootPoint(stage, root, stageWidth, stageHeight);
    if (topLeft && bottomRight) {
      return {
        x: Math.min(topLeft.x, bottomRight.x),
        y: Math.min(topLeft.y, bottomRight.y),
        width: Math.max(1, Math.abs(bottomRight.x - topLeft.x)),
        height: Math.max(1, Math.abs(bottomRight.y - topLeft.y))
      };
    }
  }
  return { x: 0, y: 0, width: stageWidth, height: stageHeight };
}

function toRootPoint(node: UnknownRecord, root: UnknownRecord, x: number, y: number): { x: number; y: number } | null {
  try {
    const Point = asRecord((globalThis as UnknownRecord).Laya)?.Point as (new (x: number, y: number) => object) | undefined;
    const makePoint = (px: number, py: number) => (typeof Point === 'function' ? new Point(px, py) : { x: px, y: py });
    const global = typeof node.localToGlobal === 'function'
      ? asRecord((node.localToGlobal as Function).call(node, makePoint(x, y)))
      : { x, y };
    if (!global) return null;
    const local = typeof root.globalToLocal === 'function'
      ? asRecord((root.globalToLocal as Function).call(root, makePoint(Number(global.x), Number(global.y))))
      : global;
    const px = Number(local?.x);
    const py = Number(local?.y);
    return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
  } catch {
    return null;
  }
}

function chooseDirection(anchor: Rect, viewport: Rect): 'left' | 'right' {
  const rightSpace = viewport.x + viewport.width - VIEWPORT_MARGIN - anchor.x - anchor.width;
  const leftSpace = anchor.x - viewport.x - VIEWPORT_MARGIN;
  return rightSpace >= leftSpace ? 'right' : 'left';
}

function createSprite(name: string): UnknownRecord | null {
  const Sprite = asRecord((globalThis as UnknownRecord).Laya)?.Sprite;
  if (typeof Sprite !== 'function') return null;
  const sprite = asRecord(new (Sprite as unknown as new () => object)());
  if (sprite) sprite.name = name;
  return sprite;
}

function createText(
  text: string,
  fontSize: number,
  color: string,
  align: 'left' | 'center',
  bold = false
): UnknownRecord | null {
  const Text = asRecord((globalThis as UnknownRecord).Laya)?.Text;
  if (typeof Text !== 'function') return null;
  const node = asRecord(new (Text as unknown as new () => object)());
  if (!node) return null;
  node.text = text;
  node.font = GAME_FONT;
  node.fontSize = fontSize;
  node.color = color;
  node.stroke = 0;
  node.align = align;
  node.valign = 'middle';
  node.bold = bold;
  node.mouseEnabled = false;
  return node;
}

function drawRoundedRect(
  target: UnknownRecord,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  lineWidth: number,
  radius: number
): void {
  const graphics = asRecord(target.graphics);
  if (!graphics) return;
  const r = Math.min(radius, width / 2, height / 2);
  call(graphics, 'clear');
  try {
    call(graphics, 'drawPath', 0, 0, [
      ['moveTo', r, 0],
      ['arcTo', width, 0, width, height, r],
      ['arcTo', width, height, 0, height, r],
      ['arcTo', 0, height, 0, 0, r],
      ['arcTo', 0, 0, r, 0, r],
      ['closePath']
    ], { fillStyle: fill }, { strokeStyle: stroke, lineWidth });
  } catch {
    call(graphics, 'drawRect', 0, 0, width, height, fill, stroke, lineWidth);
  }
}

function destroyNode(node: UnknownRecord): void {
  try {
    call(node, 'removeSelf');
    if (typeof node.addDrawChild === 'function') return;
    call(node, 'destroy', false);
  } catch {
    // 场景切换时节点可能已销毁。
  }
}

function readChildren(node: UnknownRecord): UnknownRecord[] {
  const children = node._children;
  return Array.isArray(children) ? children.map(asRecord).filter(Boolean) as UnknownRecord[] : [];
}

function findDescriptor(target: object | null, key: string): PropertyDescriptor | null {
  for (let current = target; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return descriptor;
  }
  return null;
}

function readLayaEvent(): UnknownRecord | null {
  return asRecord(asRecord((globalThis as UnknownRecord).Laya)?.Event);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), value));
}

function readTeammateMarkLimit(scene: UnknownRecord | null): number {
  const seatUis = asRecord(scene?.seatContainer)?.seatUIs;
  for (const rawSeat of Array.isArray(seatUis) ? seatUis : []) {
    const seat = asRecord(rawSeat);
    const host = asRecord(seat?.nativeHost) ?? asRecord(seat?.propTip) ?? asRecord(seat?.proptip);
    const params = asRecord(asRecord(host?.proptip)?.paramVo)
      ?? asRecord(asRecord(host?.proptip)?.paramVO)
      ?? asRecord(host?.paramVo);
    const limit = Number(params?.RecCardLimit);
    if (Number.isFinite(limit) && limit > 0) return Math.max(1, Math.min(20, Math.floor(limit)));
  }
  return 1;
}

function canShowTeammateMarks(): boolean {
  const globals = globalThis as UnknownRecord;
  const runtime = asRecord(globals.zy) ?? asRecord(globals.laya);
  const getClass = runtime?.class;
  if (typeof getClass !== 'function') return true;
  try {
    const setting = asRecord((getClass as Function).call(runtime, 'SettingManager'));
    const skillSets = asRecord(setting?.SkillSets);
    return skillSets?.IsShowCardTag !== false;
  } catch {
    return true;
  }
}

function visibleMingpaiTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => String(tag).trim()).filter((tag) => (
    tag && !tag.startsWith('来源:') && !tag.startsWith('来源于')
  )))];
}

function call(target: UnknownRecord | null | undefined, methodName: string, ...args: unknown[]): unknown {
  const method = target?.[methodName];
  return typeof method === 'function' ? method.apply(target, args) : undefined;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function readArray(record: UnknownRecord | null, keys: readonly string[]): unknown[] {
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}
