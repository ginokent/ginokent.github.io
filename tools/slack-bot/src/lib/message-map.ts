import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { config } from "../config.js";

const SCRAPS_DIR = join(config.projectRoot, "src", "content", "scraps");

/**
 * slackPath を frontmatter に持つ scrap ファイルを検索する。
 * 外部状態ファイルではなく実ファイルの frontmatter を正とすることで、キャッシュの乖離を防ぐ。
 */
export async function findScrapBySlackPath(slackPath: string): Promise<string | undefined> {
  const files = await readdir(SCRAPS_DIR);
  for (const name of files) {
    if (!name.endsWith(".md")) continue;
    const filePath = join(SCRAPS_DIR, name);
    const content = await Bun.file(filePath).text();
    // frontmatter 内の slackPath を確認
    const match = content.match(/^---\n[\s\S]*?\n---/);
    if (match && match[0].includes(`slackPath: ${slackPath}`)) {
      return filePath;
    }
  }
  return undefined;
}
