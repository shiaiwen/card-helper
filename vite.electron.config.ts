/** Electron 壳的 Vite 构建配置。 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const xiaochaoVersion = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')
).version as string;

export default defineConfig({
  plugins: [vue(), injectBuiltCssIntoElectronBundle()],
  // 注入目标是普通游戏网页，没有 Node.js 的 process 全局对象。
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __XIAOCHAO_VERSION__: JSON.stringify(String(xiaochaoVersion || '0.0.0'))
  },
  build: {
    outDir: 'dist/electron',
    emptyOutDir: true,
    target: 'chrome100',
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/entries/electron.ts'),
      name: 'Xiaochao',
      formats: ['iife'],
      fileName: () => 'xiaochao.js'
    }
  }
});

/**
 * 微端只读取并注入 xiaochao.js，不会加载 Vite 单独产出的 CSS 文件。
 * 将构建出的样式写回同一个 IIFE，保证 Vue 组件和 Teleport 内容都能
 * 在游戏页面中获得完整样式，同时保持发布物仍是单文件脚本。
 */
function injectBuiltCssIntoElectronBundle() {
  return {
    name: 'inject-built-css-into-electron-bundle',
    enforce: 'post' as const,
    generateBundle(_: unknown, bundle: Record<string, any>) {
      const cssAssets = Object.entries(bundle).filter(
        ([fileName, output]) => fileName.endsWith('.css') && output.type === 'asset'
      );
      const javaScriptChunk = Object.values(bundle).find(
        (output: any) => output.type === 'chunk' && output.isEntry
      );
      if (!javaScriptChunk || !cssAssets.length) return;
      const css = cssAssets.map(([, asset]) => String(asset.source)).join('\n');
      javaScriptChunk.code = `(()=>{const id='xiaochao-vue-styles';let style=document.getElementById(id);if(!style){style=document.createElement('style');style.id=id;(document.head||document.documentElement).appendChild(style)}style.textContent=${JSON.stringify(css)}})();\n${javaScriptChunk.code}`;
      cssAssets.forEach(([fileName]) => delete bundle[fileName]);
    }
  };
}
