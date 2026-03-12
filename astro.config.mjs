import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkBreaks from 'remark-breaks';
import rehypeParagraphBreaks from './src/plugins/rehype-paragraph-breaks.mjs';

export default defineConfig({
  site: 'https://ginokent.github.io',
  // base: '/repo-name', // GitHub Pagesでリポジトリ名がサブパスになる場合
  integrations: [sitemap()],
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
