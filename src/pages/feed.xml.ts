import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { getLocaleFromSlug, localePath } from '../lib/i18n';

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts', ({ data }) => !data.draft))
    .sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf());

  return rss({
    title: 'ginokent Blog',
    description: 'ginokent Blog RSS Feed',
    site: context.site!,
    items: posts.map((post) => {
      const { locale, slugWithoutLocale } = getLocaleFromSlug(post.slug);
      return {
        title: post.data.title,
        pubDate: post.data.publishedAt,
        description: post.data.description || '',
        link: localePath(`/posts/${slugWithoutLocale}/`, locale),
        categories: post.data.tags,
      };
    }),
  });
}
