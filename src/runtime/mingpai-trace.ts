/**
 * 明牌调试追踪缓冲：写入 window.__XIAOCHAO_MINGPAI_TRACE__，
 * 供开发监控（dev-main 诊断模式）增量拉取，不影响正式业务路径。
 */

export interface MingpaiTraceEntry {
  seq: number;
  time: number;
  kind: string;
  detail: Record<string, unknown>;
}

declare global {
  interface Window {
    /** 明牌实机核对用的环形缓冲；开发监控按 seq 增量拉取，不影响业务。 */
    __XIAOCHAO_MINGPAI_TRACE__?: MingpaiTraceEntry[];
  }
}

const MAX_ENTRIES = 400;
let sequence = 0;

/** 开发时打印明牌追踪日志。 */
export function traceMingpai(kind: string, detail: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const buffer = window.__XIAOCHAO_MINGPAI_TRACE__ ??= [];
  sequence += 1;
  buffer.push({ seq: sequence, time: Date.now(), kind, detail });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}
