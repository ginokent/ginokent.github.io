import type { GenericMessageEvent, MessageChangedEvent } from "@slack/bolt";
import { downloadFiles } from "../lib/image.js";
import { slackMrkdwnToMarkdown } from "../lib/markdown.js";
import { getFilePath, setFilePath } from "../lib/message-map.js";
import { overwriteScrap, writeNewScrap } from "../lib/scrap-writer.js";
import { generateSlug } from "../lib/slug.js";

interface SlackFile {
  name?: string;
  mimetype?: string;
  url_private?: string;
}

/** 新規メッセージを処理して scrap ファイルを作成する */
export async function handleNewMessage(event: GenericMessageEvent): Promise<void> {
  const text = event.text ?? "";
  const ts = event.ts;
  const files = (event as GenericMessageEvent & { files?: SlackFile[] }).files ?? [];

  const slug = generateSlug(text, ts);
  let body = slackMrkdwnToMarkdown(text);

  // 添付画像をダウンロードして Markdown に追加
  if (files.length > 0) {
    const downloaded = await downloadFiles(files, slug);
    const imageRefs = downloaded.map((d) => d.markdownRef).join("\n");
    if (imageRefs) {
      body = body ? `${body}\n\n${imageRefs}` : imageRefs;
    }
  }

  if (!body) {
    console.log(`⏭️ 空のメッセージをスキップ: ts=${ts}`);
    return;
  }

  const filePath = await writeNewScrap(slug, ts, body);
  await setFilePath(ts, filePath);
  console.log(`✅ scrap 作成: ${filePath}`);
}

/** メッセージ編集を処理して既存 scrap ファイルを上書きする */
export async function handleEditMessage(event: MessageChangedEvent): Promise<void> {
  const message = event.message as GenericMessageEvent;
  const ts = message.ts;
  const text = message.text ?? "";

  const filePath = await getFilePath(ts);
  if (!filePath) {
    console.log(`⏭️ マッピングなし、編集をスキップ: ts=${ts}`);
    return;
  }

  const body = slackMrkdwnToMarkdown(text);
  if (!body) {
    console.log(`⏭️ 空の編集をスキップ: ts=${ts}`);
    return;
  }

  await overwriteScrap(filePath, body);
  console.log(`✏️ scrap 更新: ${filePath}`);
}
