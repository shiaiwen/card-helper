/**
 * 皮肤与背景已由新工程接管，但 legacy 仍会在启动时读取这些独立旧键并运行自己的换肤/背景逻辑，
 * 导致新开关关闭后旧逻辑依旧生效。必须在新配置读取（旧键迁移）之后、legacy 加载之前写成关闭。
 * legacy 删除后连同本文件一起删除。
 */
const LEGACY_SKIN_SWITCH_KEYS = [
  'LOCAL_SKIN_SWITCH',
  'OTHER_LOCAL_SKIN_SWITCH',
  'OFFICIAL_BACKGROUND_SWITCH',
  'SKIN_PAPER_SWITCH',
  'ALL_PAPER_SWITCH'
];

interface KeyValueStorage {
  setItem(key: string, value: string): void;
}

export function disableLegacySkinSwitches(globalObject: Window = window): void {
  const storages: unknown[] = [
    (globalObject as unknown as { xiaochaoStorage?: unknown }).xiaochaoStorage,
    safeLocalStorage(globalObject)
  ];
  for (const storage of storages) {
    if (typeof (storage as KeyValueStorage | undefined)?.setItem !== 'function') continue;
    for (const key of LEGACY_SKIN_SWITCH_KEYS) {
      try {
        (storage as KeyValueStorage).setItem(key, 'false');
      } catch {
        // 单个存储写入失败不影响其他存储。
      }
    }
  }
}

function safeLocalStorage(globalObject: Window): Storage | null {
  try {
    return globalObject.localStorage;
  } catch {
    return null;
  }
}
