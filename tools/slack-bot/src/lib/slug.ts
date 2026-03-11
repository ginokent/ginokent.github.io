/**
 * メッセージテキストから slug を生成する。
 * 1 行目の ASCII 英数字・ハイフンを抽出し、3 文字未満なら ts をフォールバックに使う。
 */
export function generateSlug(text: string, ts: string): string {
  const firstLine = text.split("\n")[0] ?? "";
  const slug = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);

  if (slug.length >= 3) return slug;

  // フォールバック: ts の "." を "-" に置換
  return ts.replace(".", "-");
}
