import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkBreaks from 'remark-breaks';
import rehypeParagraphBreaks from './src/plugins/rehype-paragraph-breaks.mjs';
import { readdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// onnxruntime-web は内部で `new URL('./ort-wasm-*.wasm', import.meta.url)`
// を使って wasm を参照するため、Vite/Rollup が dist/_astro/ にハッシュ付き
// wasm (25MB+) を出力してしまう。実行時は ort.env.wasm.wasmPaths を CDN
// に向けているので、この wasm は使われない。デプロイ容量を圧縮するため
// ビルド完了後に削除する。
const removeUnusedOrtWasm = {
  name: 'remove-unused-ort-wasm',
  hooks: {
    'astro:build:done': async ({ dir, logger }) => {
      const astroDir = join(fileURLToPath(dir), '_astro');
      let removed = 0;
      try {
        const files = await readdir(astroDir);
        for (const f of files) {
          if (/^ort-wasm-.*\.wasm$/.test(f)) {
            await unlink(join(astroDir, f));
            removed++;
          }
        }
      } catch {
        // _astro が無い build なら何もしない
      }
      if (removed > 0) logger.info(`removed ${removed} unused ort-wasm file(s)`);
    },
  },
};

export default defineConfig({
  site: 'https://ginokent.github.io',
  // base: '/repo-name', // GitHub Pagesでリポジトリ名がサブパスになる場合
  integrations: [sitemap(), removeUnusedOrtWasm],
  vite: {
    // onnxruntime-web は内部で .wasm を相対パスで読み込む。Vite の prebundle
    // を経由すると wasm 解決が壊れるので exclude する。実行時に
    // ort.env.wasm.wasmPaths を CDN へ向けて WASM をロードする。
    optimizeDeps: {
      exclude: ['onnxruntime-web'],
    },
    worker: {
      format: 'es',
    },
  },
  i18n: {
    defaultLocale: 'ja',
    locales: ['ja', 'en'],
    routing: {
      prefixDefaultLocale: false,
      redirectToDefaultLocale: false,
    },
  },
  markdown: {
    remarkPlugins: [remarkBreaks],
    rehypePlugins: [rehypeParagraphBreaks],
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: false,
      transformers: [
        {
          name: 'transformer-title',
          pre(node) {
            // meta 文字列からファイル名を取得（例: ```go main.go）
            const meta = this.options.meta?.__raw;
            if (meta) {
              node.properties['data-title'] = meta;
            }
          },
        },
      ],
    },
  },
});
