export type SeatOverlaySide = 'left' | 'top' | 'right';

export interface SeatOverlayPosition {
  left: number;
  top: number;
  width: number;
  side: SeatOverlaySide;
}

export interface GameViewportMetrics {
  width: number;
  height: number;
  scale?: number;
  devicePixelRatio?: number;
}

/**
 * 复刻参考实现“右侧 → 顶部 → 左侧”的座位分布，只返回 CSS 像素。
 * 第一个座位是本家，不创建覆盖框，因此结果数量始终为 seatCount - 1。
 */
export function calculateSeatOverlayLayout(
  seatCount: number,
  metrics: GameViewportMetrics
): SeatOverlayPosition[] {
  const count = Math.max(0, Math.min(8, Math.floor(seatCount))) - 1;
  if (count <= 0 || metrics.width <= 0 || metrics.height <= 0) return [];

  const pixelRatio = positive(metrics.devicePixelRatio, 1);
  const scale = positive(metrics.scale, 1) / pixelRatio;
  const gameWidth = metrics.width * scale;
  const gameHeight = metrics.height * scale;
  const seatWidth = 146 * scale;
  const seatHeight = 172 * scale;
  const selfSeatHeight = 178 * scale;
  const rightReservedWidth = 221 * scale;
  const sideTopPadding = 20 * scale;

  let topCount = count < 3 ? count
    : count === 3 ? 1
      : count === 4 || count === 6 ? 2
        : 3;
  const rightCount = (count - topCount) >> 1;
  const leftCount = count - rightCount - topCount;
  const positions: SeatOverlayPosition[] = [];

  appendVerticalPositions(positions, 'right', rightCount, {
    left: gameWidth - seatWidth - 15 * scale - rightReservedWidth,
    gameHeight,
    seatWidth,
    seatHeight,
    selfSeatHeight,
    sideTopPadding
  });

  if (topCount > 0) {
    const availableWidth = gameWidth - rightReservedWidth;
    const gap = Math.max(6 * scale, (availableWidth - seatWidth * topCount) * .07);
    const rowWidth = seatWidth * topCount + gap * (topCount - 1);
    let left = (availableWidth - rowWidth) / 2;
    for (let index = 0; index < topCount; index += 1) {
      // 覆盖条放在武将牌下缘，不遮挡武将头像、体力和技能信息。
      positions.push({ left, top: (30 + 132) * scale, width: seatWidth, side: 'top' });
      left += seatWidth + gap;
    }
  }

  appendVerticalPositions(positions, 'left', leftCount, {
    left: 10 * scale,
    gameHeight,
    seatWidth,
    seatHeight,
    selfSeatHeight,
    sideTopPadding
  });
  return positions;
}

function appendVerticalPositions(
  target: SeatOverlayPosition[],
  side: 'left' | 'right',
  count: number,
  metrics: {
    left: number;
    gameHeight: number;
    seatWidth: number;
    seatHeight: number;
    selfSeatHeight: number;
    sideTopPadding: number;
  }
): void {
  if (count <= 0) return;
  const freeHeight = metrics.gameHeight - metrics.selfSeatHeight - metrics.seatHeight * count;
  const gap = Math.max(4, freeHeight * .25);
  const columnHeight = metrics.seatHeight * count + gap * (count - 1);
  let top = Math.max(metrics.sideTopPadding, (metrics.gameHeight - metrics.selfSeatHeight - columnHeight) / 2 + metrics.sideTopPadding);
  for (let index = 0; index < count; index += 1) {
    target.push({
      left: metrics.left,
      top: top + metrics.seatHeight * .72,
      width: metrics.seatWidth,
      side
    });
    top += metrics.seatHeight + gap;
  }
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
