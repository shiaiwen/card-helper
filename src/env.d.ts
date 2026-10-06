/// <reference types="vite/client" />

declare const __XIAOCHAO_VERSION__: string;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

interface Window {
  electron?: { openExternal?: (url: string) => Promise<unknown> };
  xiaochaoStorage?: {
    saveCredentials?: (scope: 'official' | '4399', credentials: unknown[]) => unknown;
  };
  __XIAOCHAO_ENGINEERING__?: Record<string, unknown>;
  __XIAOCHAO_GAME_SCENE__?: unknown;
  Laya?: {
    ClassUtils?: { getInstance?: (className: string) => unknown };
  };
}
