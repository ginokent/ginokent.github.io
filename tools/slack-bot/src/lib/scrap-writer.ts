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

/** ファイル名用の UTC タイムスタンプを生成する（例: 2026-03-13T05-23-35Z） */
function formatFilePrefix(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}-${min}-${s}Z`;
}

function buildFrontmatter(publishedAt: string, tags: string[], slackPath?: string): string {
  const tagsStr = JSON.stringify(tags);
  let fm = `---\npublishedAt: ${publishedAt}\ntags: ${tagsStr}`;
  if (slackPath) {
    fm += `\nslackPath: ${slackPath}`;
  }
  fm += "\n---";
  return fm;
}

/**
 * 新規 scrap ファイルを作成する。
 * 同名ファイルが存在する場合は連番を付与する。
 * @returns 作成されたファイルの絶対パス
 */
export async function writeNewScrap(ts: string, body: string, slackPath?: string): Promise<string> {
  const date = tsToJSTDate(ts);
  const publishedAt = formatISO8601JST(date);
  const filePrefix = formatFilePrefix(date);
  const frontmatter = buildFrontmatter(publishedAt, config.defaultTags, slackPath);
  const content = `${frontmatter}\n\n${body}\n`;

  const scrapsDir = join(config.projectRoot, "src", "content", "scraps");
  let filename = `${filePrefix}-scrap.md`;
  let filePath = join(scrapsDir, filename);

  // 同名ファイルが存在する場合は連番を付与
  let counter = 1;
  while (await Bun.file(filePath).exists()) {
    counter++;
    filename = `${filePrefix}-scrap-${counter}.md`;
    filePath = join(scrapsDir, filename);
  }

  await Bun.write(filePath, content);
  return filePath;
}

/**
 * 既存 scrap ファイルの本文を上書きする（frontmatter は保持）。
 * findScrapBySlackPath で実ファイルから検索済みのパスを受け取るため、ファイル不在チェックは不要。
 */
export async function overwriteScrap(filePath: string, body: string): Promise<void> {
  const existing = await Bun.file(filePath).text();

  const frontmatterMatch = existing.match(/^---\n[\s\S]*?\n---/);
  if (!frontmatterMatch) {
    console.error(`⚠️ frontmatter が見つかりません: ${filePath}`);
    return;
  }

  const content = `${frontmatterMatch[0]}\n\n${body}\n`;
  await Bun.write(filePath, content);
}
