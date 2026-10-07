/**
 * 座位 UI 显示开关：按 display.seatUiEnabled 控制座位相关覆盖层。
 */

import type { XiaochaoConfigStore } from '../../config/config-store';

const SEAT_DISPLAY_STYLE_ID = 'xiaochao-seat-display-visibility-style';
const SEAT_DISPLAY_DATA_ATTRIBUTE = 'xcSeatDisplayEnabled';

/**
 * Vue 已接管座位明牌层。旧 #seatUI 永久隐藏；开关关闭时强制隐藏新覆盖层。
 * 开启时不写 display:!important，避免盖掉 Vue v-show（无内容 / 未入局时应隐藏）。
 */
export function installSeatDisplayVisibility(
  configStore: XiaochaoConfigStore,
  documentObject: Document = document
): () => void {
  const rootElement = documentObject.documentElement;
  const styleElement = documentObject.createElement('style');
  styleElement.id = SEAT_DISPLAY_STYLE_ID;
  styleElement.textContent = `
html #seatUI { display: none !important; }
html[data-xc-seat-display-enabled="false"] #xiaochao-vue-seat-overlay { display: none !important; }
`;
  documentObject.head.appendChild(styleElement);

  const applyVisibility = (enabled: boolean) => {
    rootElement.dataset[SEAT_DISPLAY_DATA_ATTRIBUTE] = String(enabled);
  };
  applyVisibility(configStore.get('display.seatUiEnabled'));
  const unsubscribe = configStore.subscribe('display.seatUiEnabled', ({ value }) => {
    applyVisibility(value);
  });

  return () => {
    unsubscribe();
    delete rootElement.dataset[SEAT_DISPLAY_DATA_ATTRIBUTE];
    styleElement.remove();
  };
}
