import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import {
  isRogueMapConfigReady,
  type RogueMapConfigData
} from './rogue-map-config-data.ts';

export interface RogueMapConfigSource {
  get(): RogueMapConfigData | null;
  ready(): boolean;
  dispose(): void;
}

/**
 * 山河配置挂在卡牌配置同源加载上（同一份 Config_w.sgs / 同一套解码库），
 * 避免再独立轮询解码库导致「卡牌已就绪、山河一直超时」。
 */
export function createRogueMapConfigSourceFromCardConfig(
  cardConfigSource: Pick<CardConfigSource, 'getRogueMapData'>
): RogueMapConfigSource {
  return {
    get: () => cardConfigSource.getRogueMapData(),
    ready: () => isRogueMapConfigReady(cardConfigSource.getRogueMapData()),
    dispose() {
      // 生命周期由 CardConfigSource 管理。
    }
  };
}
