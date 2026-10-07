/**
 * 山河图总控：组合地图透视、商店预览、剧情隐藏，并暴露 filterMessage / 设置联动。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import {
  installRogueMapController,
  type RogueMapController
} from './rogue-map-controller.ts';
import {
  installRogueShopController,
  type RogueShopController,
  type RogueShopPreviewItem,
  type RogueShopPreviewListener
} from './rogue-shop-controller.ts';
import {
  installRogueStoryController,
  type RogueStoryController
} from './rogue-story-controller.ts';

type UnknownRecord = Record<string, unknown>;

export interface RogueController {
  openShop(): boolean;
  getShopPreview(): readonly RogueShopPreviewItem[];
  subscribeShopPreview(listener: RogueShopPreviewListener): () => void;
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export interface RogueControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  documentObject?: Document;
  cardConfigSource?: Pick<CardConfigSource, 'getRogueMapData'>;
}

/** 山河图三项：地图透视、隐藏对白、打开集市（含集市透视）。 */
export function installRogueController(
  configStore: XiaochaoConfigStore,
  options: RogueControllerOptions = {}
): RogueController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const map: RogueMapController = installRogueMapController(configStore, {
    globalObject,
    locator,
    cardConfigSource: options.cardConfigSource
  });
  const story: RogueStoryController = installRogueStoryController(configStore, {
    globalObject,
    locator
  });
  const shop: RogueShopController = installRogueShopController({
    globalObject,
    locator,
    cardConfigSource: options.cardConfigSource
  });

  return {
    openShop: () => shop.openShop(),
    getShopPreview: () => shop.getPreview(),
    subscribeShopPreview: (listener) => shop.subscribePreview(listener),
    filterMessage: (payload, className) => {
      map.filterMessage(payload, className);
      shop.filterMessage(payload, className);
    },
    dispose() {
      map.dispose();
      story.dispose();
      shop.dispose();
    }
  };
}
