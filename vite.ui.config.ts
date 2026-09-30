import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/** 只挂 Vue 面板的浏览器沙盒，不打进 Electron / 油猴产物。 */
export default defineConfig({
  plugins: [vue()],
  root: resolve(import.meta.dirname, 'tools/ui-sandbox'),
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
    __XC_WITH_LEGACY__: 'false'
  },
  server: {
    port: 5179,
    open: true,
    strictPort: true
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src')
    }
  }
});
