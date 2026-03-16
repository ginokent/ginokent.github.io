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
  let fm = `---\npublishedAt: ${publishedAt}`;
  if (tags.length > 0) {
    fm += `\ntags: ${JSON.stringify(tags)}`;
  }
  if (slackPath) {
    fm += `\nslackPath: ${slackPath}`;
  }
  fm += "\n---";
  return fm;
}

/** scrap ファイルのベース名（拡張子なし）を衝突チェック付きで返す */
export async function resolveScrapBaseName(ts: string): Promise<string> {
  const date = tsToJSTDate(ts);
  const filePrefix = formatFilePrefix(date);
  const scrapsDir = join(config.projectRoot, "src", "content", "scraps");

  let baseName = `${filePrefix}-scrap`;
  let filePath = join(scrapsDir, `${baseName}.md`);

  let counter = 1;
  while (await Bun.file(filePath).exists()) {
    counter++;
    baseName = `${filePrefix}-scrap-${counter}`;
    filePath = join(scrapsDir, `${baseName}.md`);
  }
  return baseName;
}

/**
 * 新規 scrap ファイルを作成する。
 * @param baseName resolveScrapBaseName で決定したベース名
 * @returns 作成されたファイルの絶対パス
 */
export async function writeNewScrap(baseName: string, ts: string, body: string, slackPath?: string): Promise<string> {
  const date = tsToJSTDate(ts);
  const publishedAt = formatISO8601JST(date);
  const frontmatter = buildFrontmatter(publishedAt, config.defaultTags, slackPath);
  const content = `${frontmatter}\n\n${body}\n`;
  const filePath = join(config.projectRoot, "src", "content", "scraps", `${baseName}.md`);
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
