/**
 * 山河地图布局：城市节点排列与连线几何。
 */

import {
  ROGUE_MAP_STYLE,
  type RogueMapPanelLayout,
  type RogueRect
} from './rogue-map-types.ts';
import type { RogueMapViewport } from './rogue-map-geometry.ts';

function overlaps(a: RogueRect, b: RogueRect, gap: number): boolean {
  return !(
    a.x + a.w + gap <= b.x
    || b.x + b.w + gap <= a.x
    || a.y + a.h + gap <= b.y
    || b.y + b.h + gap <= a.y
  );
}

function scorePlacement(
  panels: RogueRect[],
  obstacles: readonly RogueRect[],
  gap: number,
  viewport: RogueMapViewport | null,
  seedX: number,
  seedY: number
): number {
  let score = 0;
  for (let i = 0; i < panels.length; i += 1) {
    const panel = panels[i];
    // 优先贴着锚点，允许盖住城池；只轻微惩罚飞出可视区。
    score += Math.hypot(panel.x - seedX, panel.y - seedY) * 0.2;
    if (viewport) {
      if (panel.y < viewport.top) score += 60;
      if (panel.y + panel.h > viewport.bottom) score += 40;
      if (panel.x < viewport.left || panel.x + panel.w > viewport.right) score += 30;
    }
    for (let j = i + 1; j < panels.length; j += 1) {
      if (overlaps(panel, panels[j], gap)) score += 35;
    }
    // 城池/raid 可被盖住，只作很轻的偏好，不当硬障碍。
    for (const obstacle of obstacles) {
      if (overlaps(panel, obstacle, 0)) score += 2;
    }
  }
  return score;
}

function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
  viewport: RogueMapViewport | null
): { x: number; y: number } {
  if (!viewport) return { x, y };
  const viewW = viewport.right - viewport.left;
  const viewH = viewport.bottom - viewport.top;
  // 可视区比单块面板还窄/矮时不强夹：否则多城面板会被捏到同一点，
  // 看起来像「只有燕县有透视、朝歌问号关没有」。
  if (!(viewW >= w) || !(viewH >= h)) return { x, y };
  const maxX = Math.max(viewport.left, viewport.right - w);
  const maxY = Math.max(viewport.top, viewport.bottom - h);
  return {
    x: Math.min(Math.max(x, viewport.left), maxX),
    y: Math.min(Math.max(y, viewport.top), maxY)
  };
}


/**
 * 面板默认盖在城池中心上（可点穿）；只在面板互相重叠时小幅挪开，
 * 顶栏溢出时才轻轻夹回可视区。
 */
export function layoutMapPanels(
  drafts: Array<Omit<RogueMapPanelLayout, 'x' | 'y'> & { x0: number; y0: number; w: number; h: number }>,
  obstacles: readonly RogueRect[] = [],
  gap = ROGUE_MAP_STYLE.layoutGap,
  viewport: RogueMapViewport | null = null
): RogueMapPanelLayout[] {
  if (!drafts.length) return [];
  const directions = [
    [0, 0],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ] as const;

  const result: RogueMapPanelLayout[] = drafts.map((draft) => {
    const clamped = clampToViewport(draft.x0, draft.y0, draft.w, draft.h, viewport);
    return {
      ...draft,
      x0: clamped.x,
      y0: clamped.y,
      x: clamped.x,
      y: clamped.y
    };
  });

  for (let index = 0; index < result.length; index += 1) {
    const current = result[index];
    let best = { x: current.x, y: current.y, score: Number.POSITIVE_INFINITY };
    for (const [dx, dy] of directions) {
      for (let step = 0; step <= 3; step += 1) {
        if (dx === 0 && dy === 0 && step > 0) continue;
        const raw = {
          x: current.x0 + dx * step * (current.w / 4 + gap),
          y: current.y0 + dy * step * (current.h / 5 + gap),
          w: current.w,
          h: current.h,
          centerX: 0,
          centerY: 0
        };
        const clamped = clampToViewport(raw.x, raw.y, raw.w, raw.h, viewport);
        const candidate = { ...raw, x: clamped.x, y: clamped.y };
        const others = result
          .filter((_, otherIndex) => otherIndex !== index)
          .map((panel) => ({
            x: panel.x,
            y: panel.y,
            w: panel.w,
            h: panel.h,
            centerX: 0,
            centerY: 0
          }));
        const score = scorePlacement(
          [candidate, ...others],
          obstacles,
          gap,
          viewport,
          current.x0,
          current.y0
        );
        if (score < best.score) best = { x: candidate.x, y: candidate.y, score };
        if (score < 1) break;
      }
      if (best.score < 1) break;
    }
    current.x = best.x;
    current.y = best.y;
  }
  return result;
}

/** 按草稿内容估算地图面板高度。 */
export function estimatePanelHeight(title: string, lines: Array<{ text: string; kind?: string }>): number {
  const titleLines = Math.max(1, Math.ceil(title.length / 10));
  let body = 0;
  let hasReward = false;
  let hasGeneralBlock = false;
  for (const line of lines) {
    const rows = Math.max(1, line.text.split('\n').length);
    if (line.kind === 'stats') body += rows * (ROGUE_MAP_STYLE.detailSize + 6);
    else if (line.kind === 'general') {
      hasGeneralBlock = true;
      body += rows * (ROGUE_MAP_STYLE.generalSize + 8);
    } else {
      hasReward = true;
      body += rows * (ROGUE_MAP_STYLE.bodySize + 6);
    }
  }
  return ROGUE_MAP_STYLE.topSpacer * 2
    + titleLines * (ROGUE_MAP_STYLE.titleSize + 8)
    + body
    + (hasGeneralBlock && hasReward ? 8 : 0)
    + (lines.length ? 4 : 0);
}
