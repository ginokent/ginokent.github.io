import { basename } from "node:path";
import type { GenericMessageEvent, MessageChangedEvent } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { downloadFiles } from "../lib/image.js";
import { slackMrkdwnToMarkdown } from "../lib/markdown.js";
import { findScrapBySlackPath } from "../lib/message-map.js";
import { gitCommitPush } from "../lib/git.js";
import { addReaction, removeReaction } from "../lib/reaction.js";
import { replyScrapUrl } from "../lib/reply.js";
import { overwriteScrap, resolveScrapBaseName, writeNewScrap } from "../lib/scrap-writer.js";

interface SlackFile {
  name?: string;
  mimetype?: string;
  url_private?: string;
}

/** 全メッセージではなく意図的な投稿のみ scrap 対象とするため、ボットへのメンション有無で判定する */
function hasBotMention(text: string, botUserId: string): boolean {
  return text.includes(`<@${botUserId}>`);
}

/** メンションタグのみ除去する。空白・改行は一切加工しない（Slack メッセージの原文をそのまま scrap に反映する） */
function stripBotMention(text: string, botUserId: string): string {
  return text.replace(new RegExp(`<@${botUserId}>`, "g"), "");
}

/** ドメインを含まない path のみ返す（frontmatter には slackUrl ではなく slackPath として記録する） */
function buildMessagePath(channelId: string, ts: string): string {
  const messageId = `p${ts.replace(".", "")}`;
  return `/archives/${channelId}/${messageId}`;
}

/**
 * 新規メッセージを処理して scrap ファイルを作成する。
 * ボットへのメンションを含むメッセージのみ処理する。
 */
export async function handleNewMessage(
  client: WebClient,
  event: GenericMessageEvent,
  botUserId: string,
): Promise<void> {
  const text = event.text ?? "";
  const ts = event.ts;
  const channel = event.channel;
  const files = (event as GenericMessageEvent & { files?: SlackFile[] }).files ?? [];

  // メンションがない場合は無視
  if (!hasBotMention(text, botUserId)) return;

  // 処理開始リアクション
  await removeReaction(client, channel, ts, "white_check_mark");
  await addReaction(client, channel, ts, "runner");

  // メンションを除去してから処理
  const cleanText = stripBotMention(text, botUserId);
  let body = slackMrkdwnToMarkdown(cleanText);

  // scrap ベース名を事前に計算（画像命名に使用）
  const scrapBaseName = await resolveScrapBaseName(ts);

  // 添付画像をダウンロードして Markdown に追加
  let imagePaths: string[] = [];
  if (files.length > 0) {
    const downloaded = await downloadFiles(files, scrapBaseName);
    imagePaths = downloaded.filter((d) => d.absolutePath).map((d) => d.absolutePath!);
    const imageRefs = downloaded.map((d) => d.markdownRef).join("\n");
    if (imageRefs) {
      body = body ? `${body}\n\n${imageRefs}` : imageRefs;
    }
  }

  if (!body) {
    console.log(`⏭️ 空のメッセージをスキップ: ts=${ts}`);
    await removeReaction(client, channel, ts, "runner");
    return;
  }

  const messagePath = buildMessagePath(channel, ts);
  const filePath = await writeNewScrap(scrapBaseName, ts, body, messagePath);
  console.log(`✅ scrap 作成: ${filePath}`);
  await gitCommitPush("add", filePath, ...imagePaths);
  await replyScrapUrl(client, channel, ts, scrapBaseName);

  // 処理完了リアクション
  await removeReaction(client, channel, ts, "runner");
  await addReaction(client, channel, ts, "white_check_mark");
}

/**
 * メッセージ編集を処理する。
 * 既存 scrap があれば上書き、ファイルが削除されていた場合やメンション後付けの場合は新規作成する。
 */
export async function handleEditMessage(
  client: WebClient,
  event: MessageChangedEvent,
  botUserId: string,
): Promise<void> {
  const message = event.message as GenericMessageEvent;
  const ts = message.ts;
  const channel = event.channel;
  const text = message.text ?? "";

  // メンションがない場合は無視
  if (!hasBotMention(text, botUserId)) return;

  // 処理開始リアクション
  await removeReaction(client, channel, ts, "white_check_mark");
  await addReaction(client, channel, ts, "runner");

  // メンションを除去
  const cleanText = stripBotMention(text, botUserId);

  // frontmatter の slackPath から既存ファイルを検索（外部状態ファイルではなく実ファイルを正とする）
  const messagePath = buildMessagePath(channel, ts);
  const existingPath = await findScrapBySlackPath(messagePath);

  if (existingPath) {
    const body = slackMrkdwnToMarkdown(cleanText);
    if (!body) {
      console.log(`⏭️ 空の編集をスキップ: ts=${ts}`);
      await removeReaction(client, channel, ts, "runner");
      return;
    }
    await overwriteScrap(existingPath, body);
    console.log(`✏️ scrap 更新: ${existingPath}`);
    await gitCommitPush("update", existingPath);
    const slug = basename(existingPath, ".md");
    await replyScrapUrl(client, channel, ts, slug);

    // 処理完了リアクション
    await removeReaction(client, channel, ts, "runner");
    await addReaction(client, channel, ts, "white_check_mark");
    return;
  }

  // 新規作成（メンション後付け）
  let body = slackMrkdwnToMarkdown(cleanText);

  const scrapBaseName = await resolveScrapBaseName(ts);
  const files = (message as GenericMessageEvent & { files?: SlackFile[] }).files ?? [];
  let imagePaths: string[] = [];
  if (files.length > 0) {
    const downloaded = await downloadFiles(files, scrapBaseName);
    imagePaths = downloaded.filter((d) => d.absolutePath).map((d) => d.absolutePath!);
    const imageRefs = downloaded.map((d) => d.markdownRef).join("\n");
    if (imageRefs) {
      body = body ? `${body}\n\n${imageRefs}` : imageRefs;
    }
  }

  if (!body) {
    console.log(`⏭️ 空のメッセージをスキップ: ts=${ts}`);
    await removeReaction(client, channel, ts, "runner");
    return;
  }

  const filePath = await writeNewScrap(scrapBaseName, ts, body, messagePath);
  console.log(`✅ scrap 作成 (編集でメンション追加): ${filePath}`);
  await gitCommitPush("add", filePath, ...imagePaths);
  await replyScrapUrl(client, channel, ts, scrapBaseName);

  // 処理完了リアクション
  await removeReaction(client, channel, ts, "runner");
  await addReaction(client, channel, ts, "white_check_mark");
}
