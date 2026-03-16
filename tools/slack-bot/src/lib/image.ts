import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.js";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);

interface SlackFile {
  name?: string;
  mimetype?: string;
  url_private?: string;
}

interface DownloadedImage {
  markdownRef: string;
  absolutePath?: string;
}

function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * Slack メッセージの添付ファイルをダウンロードし、Markdown 参照文字列を返す。
 * 画像以外は "(ファイル添付: filename)" プレースホルダーを返す。
 */
export async function downloadFiles(
  files: SlackFile[],
  slug: string,
): Promise<DownloadedImage[]> {
  const results: DownloadedImage[] = [];
  let imageIndex = 0;

  for (const file of files) {
    const name = file.name ?? "unknown";
    const ext = getExtension(name);

    if (!IMAGE_EXTENSIONS.has(ext) || !file.url_private) {
      results.push({ markdownRef: `(ファイル添付: ${name})` });
      continue;
    }

    imageIndex++;
    const savedName = `${slug}-${imageIndex}.${ext}`;
    const relativePath = `/images/scraps/${savedName}`;
    const absolutePath = join(config.projectRoot, "public", "images", "scraps", savedName);

    await mkdir(dirname(absolutePath), { recursive: true });

    const response = await fetch(file.url_private, {
      headers: { Authorization: `Bearer ${config.slackBotToken}` },
    });

    if (!response.ok) {
      console.error(`⚠️ 画像ダウンロード失敗: ${name} (${response.status})`);
      results.push({ markdownRef: `(画像取得失敗: ${name})` });
      continue;
    }

    await Bun.write(absolutePath, await response.arrayBuffer());
    console.log(`📷 画像保存: ${absolutePath}`);

    results.push({ markdownRef: `![${name}](${relativePath})`, absolutePath });
  }

  return results;
}
