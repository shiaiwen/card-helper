import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    vue(),
    monkey({
      entry: 'src/entries/userscript.ts',
      userscript: {
        name: '三国杀小抄',
        namespace: 'https://95chong.cn/',
        version: '1.5.20',
        description: '三国杀OL辅助插件',
        author: 'many people',
        match: [
          '*://game.4399iw2.com/yxsgs/*',
          '*://my.4399.com/yxsgs/*',
          '*://*.sanguosha.com/*',
          '*://web.kuaiwan.com/kwsgsn/*'
        ],
        grant: 'none',
        'run-at': 'document-start'
      },
      build: { fileName: 'xiaochao.user.js' }
    })
  ],
  build: {
    outDir: 'dist/userscript',
    emptyOutDir: true,
    target: 'chrome100',
    sourcemap: true
  }
});
