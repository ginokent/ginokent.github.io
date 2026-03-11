import { join } from "node:path";
import { config } from "../config.js";

function tsToJSTDate(ts: string): Date {
  const unixSeconds = Number.parseFloat(ts);
  return new Date(unixSeconds * 1000);
}

function formatISO8601JST(date: Date): string {
  // JST = UTC+09:00
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  const h = String(jst.getUTCHours()).padStart(2, "0");
  const min = String(jst.getUTCMinutes()).padStart(2, "0");
  const s = String(jst.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}:${s}+09:00`;
}

function formatDatePrefix(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildFrontmatter(publishedAt: string, tags: string[]): string {
  const tagsStr = JSON.stringify(tags);
  return `---\npublishedAt: ${publishedAt}\ntags: ${tagsStr}\n---`;
}

/**
 * 新規 scrap ファイルを作成する。
 * 同名ファイルが存在する場合は連番を付与する。
 * @returns 作成されたファイルの絶対パス
 */
export async function writeNewScrap(slug: string, ts: string, body: string): Promise<string> {
  const date = tsToJSTDate(ts);
  const publishedAt = formatISO8601JST(date);
  const datePrefix = formatDatePrefix(date);
  const frontmatter = buildFrontmatter(publishedAt, config.defaultTags);
  const content = `${frontmatter}\n\n${body}\n`;

  const scrapsDir = join(config.projectRoot, "src", "content", "scraps");
  let filename = `${datePrefix}-${slug}.md`;
  let filePath = join(scrapsDir, filename);

  // 同名ファイルが存在する場合は連番を付与
  let counter = 1;
  while (await Bun.file(filePath).exists()) {
    counter++;
    filename = `${datePrefix}-${slug}-${counter}.md`;
    filePath = join(scrapsDir, filename);
  }

  await Bun.write(filePath, content);
  return filePath;
}

/**
 * 既存 scrap ファイルを上書きする。
 * frontmatter は保持しつつ本文のみ更新する。
 */
export async function overwriteScrap(filePath: string, body: string): Promise<void> {
  const existing = await Bun.file(filePath).text();

  // frontmatter を抽出して保持
  const frontmatterMatch = existing.match(/^---\n[\s\S]*?\n---/);
  if (!frontmatterMatch) {
    console.error(`⚠️ frontmatter が見つかりません: ${filePath}`);
    return;
  }

  const content = `${frontmatterMatch[0]}\n\n${body}\n`;
  await Bun.write(filePath, content);
}
