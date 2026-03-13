import type { GenericMessageEvent, MessageChangedEvent } from "@slack/bolt";
import { downloadFiles } from "../lib/image.js";
import { slackMrkdwnToMarkdown } from "../lib/markdown.js";
import { getFilePath, setFilePath } from "../lib/message-map.js";
import { overwriteScrap, writeNewScrap } from "../lib/scrap-writer.js";

interface SlackFile {
  name?: string;
  mimetype?: string;
  url_private?: string;
}

function hasBotMention(text: string, botUserId: string): boolean {
  return text.includes(`<@${botUserId}>`);
}

function stripBotMention(text: string, botUserId: string): string {
  return text
    .replace(new RegExp(`<@${botUserId}>`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Slack メッセージの path 部分を生成する (e.g. /archives/C.../p...) */
function buildMessagePath(channelId: string, ts: string): string {
  // ts: "1234567890.123456" -> "p1234567890123456"
  const messageId = `p${ts.replace(".", "")}`;
  return `/archives/${channelId}/${messageId}`;
}

/** ts から画像ファイル用のプレフィックスを生成する */
function tsToImagePrefix(ts: string): string {
  return ts.replace(".", "-");
}

/** 新規メッセージを処理して scrap ファイルを作成する */
export async function handleNewMessage(
  event: GenericMessageEvent,
  botUserId: string,
): Promise<void> {
  const text = event.text ?? "";
  const ts = event.ts;
  const files = (event as GenericMessageEvent & { files?: SlackFile[] }).files ?? [];

  // メンションがない場合は無視
  if (!hasBotMention(text, botUserId)) return;

  // メンションを除去してから処理
  const cleanText = stripBotMention(text, botUserId);
  let body = slackMrkdwnToMarkdown(cleanText);

  // 添付画像をダウンロードして Markdown に追加
  if (files.length > 0) {
    const downloaded = await downloadFiles(files, tsToImagePrefix(ts));
    const imageRefs = downloaded.map((d) => d.markdownRef).join("\n");
    if (imageRefs) {
      body = body ? `${body}\n\n${imageRefs}` : imageRefs;
    }
  }

  if (!body) {
    console.log(`⏭️ 空のメッセージをスキップ: ts=${ts}`);
    return;
  }

  const messagePath = buildMessagePath(event.channel, ts);
  const filePath = await writeNewScrap(ts, body, messagePath);
  await setFilePath(ts, filePath);
  console.log(`✅ scrap 作成: ${filePath}`);
}

/** メッセージ編集を処理する */
export async function handleEditMessage(
  event: MessageChangedEvent,
  botUserId: string,
): Promise<void> {
  const message = event.message as GenericMessageEvent;
  const ts = message.ts;
  const text = message.text ?? "";

  // メンションがない場合は無視
  if (!hasBotMention(text, botUserId)) return;

  // メンションを除去
  const cleanText = stripBotMention(text, botUserId);

  const existingPath = await getFilePath(ts);

  if (existingPath) {
    // 既存の scrap を更新
    const body = slackMrkdwnToMarkdown(cleanText);
    if (!body) {
      console.log(`⏭️ 空の編集をスキップ: ts=${ts}`);
      return;
    }
    await overwriteScrap(existingPath, body);
    console.log(`✏️ scrap 更新: ${existingPath}`);
  } else {
    // メンションが後から追加された場合: 新規作成
    let body = slackMrkdwnToMarkdown(cleanText);

    const files = (message as GenericMessageEvent & { files?: SlackFile[] }).files ?? [];
    if (files.length > 0) {
      const downloaded = await downloadFiles(files, tsToImagePrefix(ts));
      const imageRefs = downloaded.map((d) => d.markdownRef).join("\n");
      if (imageRefs) {
        body = body ? `${body}\n\n${imageRefs}` : imageRefs;
      }
    }

    if (!body) {
      console.log(`⏭️ 空のメッセージをスキップ: ts=${ts}`);
      return;
    }

    const messagePath = buildMessagePath(event.channel, ts);
    const filePath = await writeNewScrap(ts, body, messagePath);
    await setFilePath(ts, filePath);
    console.log(`✅ scrap 作成 (編集でメンション追加): ${filePath}`);
  }
}
