// i18n ユーティリティ
// サポートする言語と UI テキストの翻訳を管理

export const locales = ['ja', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ja';

// UI テキストの翻訳
export const translations = {
  ja: {
    published: '公開',
    updated: '更新',
    postsCount: (count: number) => `${count} 件の記事`,
    noPostsYet: '記事がまだありません',
    taggedWith: (tag: string) => `${tag} の記事`,
    tableOfContents: '目次',
    about: 'About',
    feed: 'RSS',
    home: 'ホーム',
  },
  en: {
    published: 'Published',
    updated: 'Updated',
    postsCount: (count: number) => `${count} post${count === 1 ? '' : 's'}`,
    noPostsYet: 'No posts yet',
    taggedWith: (tag: string) => `Posts tagged with "${tag}"`,
    tableOfContents: 'Table of Contents',
    about: 'About',
    feed: 'RSS',
    home: 'Home',
  },
} as const;

export type TranslationKey = keyof (typeof translations)['ja'];

export function t(locale: Locale, key: TranslationKey): string | ((...args: unknown[]) => string) {
  return translations[locale][key];
}

// 日付フォーマット
export function formatDate(date: Date, locale: Locale): string {
  if (locale === 'ja') {
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// 短い日付フォーマット（一覧用）
export function formatDateShort(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// slug から言語を抽出
// 日本語: posts/xxx.md -> slug = "xxx"
// 英語: posts/en/xxx.md -> slug = "en/xxx"
export function getLocaleFromSlug(slug: string): { locale: Locale; slugWithoutLocale: string } {
  if (slug.startsWith('en/')) {
    return {
      locale: 'en',
      slugWithoutLocale: slug.slice(3), // "en/" を除去
    };
  }
  return { locale: 'ja', slugWithoutLocale: slug };
}

// 言語付きパスを生成
// 日本語（デフォルト）は prefix なし、英語は /en prefix 付き
export function localePath(path: string, locale: Locale): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (locale === defaultLocale) {
    return cleanPath;
  }
  return `/${locale}${cleanPath}`;
}

// 他の言語の同じページへのパスを生成
// 日本語は prefix なし、英語は /en prefix 付き
export function getAlternateLocaleUrl(currentPath: string, targetLocale: Locale): string {
  // /ja/posts/xxx -> /posts/xxx or /en/posts/xxx
  // /en/posts/xxx -> /posts/xxx or /en/posts/xxx
  // /posts/xxx -> /posts/xxx or /en/posts/xxx
  const pathWithoutLocale = currentPath.replace(/^\/(ja|en)/, '') || '/';
  if (targetLocale === defaultLocale) {
    return pathWithoutLocale;
  }
  return `/${targetLocale}${pathWithoutLocale}`;
}
