/**
 * 许劭（识论）辅助：匹配可选技能条目并在相关 UI 上展示提示。
 */

import type { LayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher, type MethodPatcher } from '../../runtime/method-patch.ts';

type UnknownRecord = Record<string, unknown>;

export interface XuShaoSkillEntry {
  id: number;
  name: string;
  spell: number;
  triggerID: number;
}

export interface XuShaoAssistOptions {
  isEnabled: () => boolean;
  getEntries: () => readonly XuShaoSkillEntry[];
  resolveSpellName: (spellId: number, fallbackName: string) => string;
  locator: LayaObjectLocator;
  patcher?: MethodPatcher;
  globalObject?: {
    Laya?: {
      Sprite?: new () => UnknownRecord;
      Text?: new () => UnknownRecord;
    };
  };
  /** 评鉴格子边长，固定为 6。 */
  gridSize?: number;
}

const TRIGGER_STYLES: Readonly<Record<number, { border: string; backing: string; label: string }>> = {
  1: { border: '#5BE49B', backing: '#14532F', label: '#D9FFE9' },
  2: { border: '#FF6B57', backing: '#54201A', label: '#FFE3DC' },
  3: { border: '#4D5BFF', backing: '#1B2158', label: '#DFE3FF' }
};

/**
 * 许劭评鉴：在 PingJianWindow 上画出可连成技能名的格子框。
 */
export function installXuShaoAssist(options: XuShaoAssistOptions): () => void {
  const patcher = options.patcher ?? createMethodPatcher();
  const globalObject = options.globalObject ?? (typeof window !== 'undefined' ? window : {});
  const gridSize = options.gridSize ?? 6;
  let disposed = false;

  const tryPatch = (): boolean => {
    const prototype = options.locator.classPrototype('PingJianWindow');
    if (!prototype || typeof prototype.updateItemUI !== 'function') return false;
    patcher.wrap(prototype, 'updateItemUI', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      const result = original.apply(this, args);
      scheduleRedraw(this);
      return result;
    });
    patcher.wrap(prototype, 'destroy', (original) => function (this: UnknownRecord, ...args: unknown[]) {
      destroyOverlay(this);
      return original.apply(this, args);
    });
    redrawOpenWindow();
    return true;
  };

  let attempts = 0;
  const timer = setInterval(() => {
    if (disposed) return;
    attempts += 1;
    if (tryPatch() || attempts >= 60) clearInterval(timer);
  }, 1000);
  tryPatch();

  function scheduleRedraw(win: UnknownRecord): void {
    setTimeout(() => {
      if (!disposed) redrawWindow(win);
    }, 0);
  }

  function redrawOpenWindow(): void {
    const win = options.locator.window('PingJianWindow');
    if (win) redrawWindow(win);
  }

  function redrawWindow(win: UnknownRecord): void {
    if (!isPingJianWindow(win, gridSize) || !options.isEnabled()) {
      clearOverlay(win);
      return;
    }
    const matches = findMatches(win, options.getEntries(), gridSize);
    const signature = buildSignature(win, matches);
    if (win.__xcShiLunOverlaySignature === signature) return;
    win.__xcShiLunOverlaySignature = signature;
    const layer = ensureOverlayLayer(win, globalObject);
    if (!layer) return;
    layer.visible = true;
    const graphics = asRecord(layer.graphics);
    graphics?.clear?.();
    const items = Array.isArray(win.items) ? win.items as UnknownRecord[] : [];
    const cellWidth = Number(items.find(Boolean)?.width) || 40;
    const cellHeight = Number(items.find(Boolean)?.height) || 40;
    const labels = (win.__xcShiLunOverlayLabels as UnknownRecord[] | undefined) ?? [];
    win.__xcShiLunOverlayLabels = labels;
    let labelIndex = 0;
    for (const match of matches) {
      const style = TRIGGER_STYLES[match.entry.triggerID] || TRIGGER_STYLES[1];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const cell of match.cells) {
        const item = items[cell];
        if (!item) continue;
        minX = Math.min(minX, Number(item.x) || 0);
        minY = Math.min(minY, Number(item.y) || 0);
        maxX = Math.max(maxX, (Number(item.x) || 0) + cellWidth);
        maxY = Math.max(maxY, (Number(item.y) || 0) + cellHeight);
      }
      if (!(maxX > minX && maxY > minY)) continue;
      const x = minX - 3;
      const y = minY - 3;
      const width = maxX - minX + 6;
      const height = maxY - minY + 6;
      graphics?.drawRect?.(x, y, width, height, null, style.border, 2);
      const title = options.resolveSpellName(match.entry.spell, match.entry.name);
      if (!title) continue;
      const label = ensureLabel(win, labels, labelIndex++, globalObject, layer);
      if (!label) continue;
      const labelWidth = Math.max(28, title.length * 14);
      graphics?.drawRect?.(x + 3, y + 3, labelWidth + 10, 18, style.backing, null, 0);
      label.text = title;
      label.color = style.label;
      label.size?.(labelWidth + 10, 18);
      label.pos?.(x + 5, y + 3);
      label.visible = true;
    }
    for (let index = labelIndex; index < labels.length; index += 1) {
      const label = labels[index];
      if (label) label.visible = false;
    }
  }

  return () => {
    disposed = true;
    clearInterval(timer);
    const win = options.locator.window('PingJianWindow');
    if (win) destroyOverlay(win);
    if (!options.patcher) patcher.restoreAll();
  };
}

export function findXuShaoMatches(
  words: readonly string[],
  skillIds: readonly number[],
  matchedIds: readonly number[],
  entries: readonly XuShaoSkillEntry[],
  gridSize = 6
): Array<{ cells: number[]; entry: XuShaoSkillEntry; horizontal: boolean }> {
  const matched = new Set(matchedIds);
  const results: Array<{ cells: number[]; entry: XuShaoSkillEntry; horizontal: boolean }> = [];
  const seen = new Set<string>();
  const push = (cells: number[], entry: XuShaoSkillEntry, horizontal: boolean) => {
    if (cells.every((cell) => matched.has(cell))) return;
    const key = `${cells.join('-')}:${entry.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ cells, entry, horizontal });
  };
  const matchesEntry = (cells: number[], entry: XuShaoSkillEntry) => (
    cells.every((cell, index) => words[cell] === entry.name[index] && skillIds[cell] === entry.spell)
  );

  for (let row = 0; row < gridSize; row += 1) {
    for (const entry of entries) {
      const length = entry.name.length;
      for (let col = 0; col + length <= gridSize; col += 1) {
        const cells = Array.from({ length }, (_, offset) => row * gridSize + col + offset);
        if (matchesEntry(cells, entry)) push(cells, entry, true);
      }
    }
  }
  for (let col = 0; col < gridSize; col += 1) {
    for (const entry of entries) {
      const length = entry.name.length;
      for (let row = 0; row + length <= gridSize; row += 1) {
        const cells = Array.from({ length }, (_, offset) => (row + offset) * gridSize + col);
        if (matchesEntry(cells, entry)) push(cells, entry, false);
      }
    }
  }
  return results;
}

function findMatches(
  win: UnknownRecord,
  entries: readonly XuShaoSkillEntry[],
  gridSize: number
) {
  const words = Array.isArray(win.WordsStr) ? win.WordsStr as string[] : [];
  const skillIds = Array.isArray(win.gridSkillIdArr) ? win.gridSkillIdArr as number[] : [];
  const matchedIds = Array.isArray(win.matchedIds) ? win.matchedIds as number[] : [];
  return findXuShaoMatches(words, skillIds, matchedIds, entries, gridSize);
}

function isPingJianWindow(win: UnknownRecord | null, gridSize: number): win is UnknownRecord {
  if (!win || win.destroyed) return false;
  const seat = asRecord(win.seat);
  if (!seat?.IsSelf) return false;
  return Array.isArray(win.WordsStr)
    && win.WordsStr.length === gridSize * gridSize
    && Array.isArray(win.items)
    && win.items.length === win.WordsStr.length;
}

function buildSignature(
  win: UnknownRecord,
  matches: Array<{ cells: number[]; entry: XuShaoSkillEntry }>
): string {
  const words = Array.isArray(win.WordsStr) ? (win.WordsStr as string[]).join('') : '';
  const skills = Array.isArray(win.gridSkillIdArr) ? (win.gridSkillIdArr as number[]).join(',') : '';
  const matched = Array.isArray(win.matchedIds) ? (win.matchedIds as number[]).join(',') : '';
  const hide = Array.isArray(win.hideIds) ? (win.hideIds as number[]).join(',') : '';
  const matchKey = matches.map((item) => `${item.cells.join('-')}:${item.entry.id}`).join('|');
  const seatIndex = asRecord(win.seat)?.Index ?? '';
  return [words, skills, matched, hide, matchKey, seatIndex].join('#');
}

function ensureOverlayLayer(
  win: UnknownRecord,
  globalObject: XuShaoAssistOptions['globalObject']
): UnknownRecord | null {
  const parent = asRecord(win.contentSprite) ?? win;
  let layer = asRecord(win.__xcShiLunOverlayLayer);
  if (layer && !layer.destroyed && layer.parent === parent) return layer;
  if (layer && !layer.destroyed) {
    try { layer.removeSelf?.(); } catch { /* ignore */ }
  }
  const Sprite = globalObject?.Laya?.Sprite;
  if (!Sprite) return null;
  layer = new Sprite();
  layer.name = 'xcShiLunOverlayLayer';
  layer.mouseEnabled = false;
  layer.mouseThrough = true;
  layer.zOrder = 999;
  if (typeof parent.addDrawChild === 'function') {
    try { parent.addDrawChild(layer); }
    catch { parent.addChild?.(layer); }
  } else {
    parent.addChild?.(layer);
  }
  parent.sortChildren?.();
  win.__xcShiLunOverlayLayer = layer;
  win.__xcShiLunOverlayLabels = [];
  return layer;
}

function ensureLabel(
  win: UnknownRecord,
  labels: UnknownRecord[],
  index: number,
  globalObject: XuShaoAssistOptions['globalObject'],
  layer: UnknownRecord
): UnknownRecord | null {
  let label = labels[index];
  if (!label || label.destroyed) {
    const Text = globalObject?.Laya?.Text;
    if (!Text) return null;
    label = new Text();
    label.name = `xcShiLunOverlayLabel_${index}`;
    label.mouseEnabled = false;
    label.mouseThrough = true;
    label.bold = true;
    label.fontSize = 14;
    label.stroke = 2;
    label.strokeColor = '#0A0A0A';
    label.align = 'left';
    label.valign = 'middle';
    label.wordWrap = false;
    labels[index] = label;
  }
  if (label.parent !== layer) layer.addChild?.(label);
  return label;
}

function clearOverlay(win: UnknownRecord): void {
  const layer = asRecord(win.__xcShiLunOverlayLayer);
  if (layer && !layer.destroyed) {
    asRecord(layer.graphics)?.clear?.();
    layer.visible = false;
  }
  const labels = win.__xcShiLunOverlayLabels as UnknownRecord[] | undefined;
  labels?.forEach((label) => { if (label) label.visible = false; });
  win.__xcShiLunOverlaySignature = '';
}

function destroyOverlay(win: UnknownRecord): void {
  const layer = asRecord(win.__xcShiLunOverlayLayer);
  if (layer && !layer.destroyed) {
    try { layer.destroy?.(true); } catch { /* ignore */ }
  }
  win.__xcShiLunOverlayLayer = null;
  win.__xcShiLunOverlayLabels = [];
  win.__xcShiLunOverlaySignature = '';
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}
