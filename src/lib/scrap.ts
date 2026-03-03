/**
 * scrap の body テキストから SEO 用タイトルを生成する。
 * Markdown 記法を除去し、先頭60文字を切り出す。
 */
export function getScrapSeoTitle(body: string): string {
  const plain = body
    .replace(/^---[\s\S]*?---\n?/, '')  // frontmatter 除去（念のため）
    .replace(/!\[.*?\]\(.*?\)/g, '')     // 画像
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1') // リンク
    .replace(/[#*_>`~\-]/g, '')          // Markdown 記号
    .replace(/\n+/g, ' ')               // 改行をスペースに
    .trim();

  if (plain.length <= 60) return plain;
  return plain.slice(0, 60) + '…';
}
