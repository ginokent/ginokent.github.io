import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  // 日本語記事のみ取得（en/ で始まらない、draft でない）
  const posts = (await getCollection('posts', ({ slug, data }) => !slug.startsWith('en/') && !data.draft))
    .sort((a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf());

  const site = context.site!.origin;

  const lines = [
    '# ginokent.github.io',
    '',
    '> ginokent の技術ブログ。ソフトウェアエンジニアリング、DevOps、開発ツールに関する記事を日本語と英語で公開しています。',
    '',
    '## サイト概要',
    '',
    '- 著者: ginokent',
    '- 職種: SRE / Software Developer',
    '- 言語: 日本語（デフォルト）、英語',
    '- 主なトピック: Go, Bash, Git, gRPC, AWS, GCP, Terraform, Kubernetes, CLI ツール, 開発環境構築',
    '',
    '## 主要ページ',
    '',
    `- [トップページ](${site}/) - 記事一覧（日本語）`,
    `- [About](${site}/about/) - プロフィール`,
    `- [English Top](${site}/en/) - 記事一覧（英語）`,
    `- [RSS Feed](${site}/feed.xml) - RSS フィード`,
    '',
    '## 記事一覧',
    '',
    ...posts.map((post) => {
      const tags = post.data.tags.length > 0 ? ` - ${post.data.tags.join(', ')}` : '';
      return `- [${post.data.title}](${site}/posts/${post.slug}/)${tags}`;
    }),
    '',
    '## 技術スタック',
    '',
    'このサイトは [Astro](https://astro.build/) で構築され、GitHub Pages でホスティングされています。',
    '',
    '## 連絡先',
    '',
    '- GitHub: https://github.com/ginokent',
    '- X (Twitter): https://x.com/ginokentdev',
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
