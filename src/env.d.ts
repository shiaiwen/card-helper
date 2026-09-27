/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

interface Window {
  electron?: { openExternal?: (url: string) => Promise<unknown> };
  __XIAOCHAO_ENGINEERING__?: Record<string, unknown>;
  __XIAOCHAO_GAME_SCENE__?: unknown;
  Laya?: {
    ClassUtils?: { getInstance?: (className: string) => unknown };
  };
  VIiR0YfvE4s?: Array<(...rawArguments: unknown[]) => void>;
}
