import { App } from "@slack/bolt";
import { config } from "./config.js";
import { handleEditMessage, handleNewMessage } from "./handlers/message.js";

const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  socketMode: true,
});

// 全 message イベントをリッスン (subtype 付きも含む)
app.event("message", async ({ event }) => {
  // 対象チャンネル以外は無視
  if (event.channel !== config.slackChannelId) return;

  if (!("subtype" in event) || event.subtype === undefined) {
    // 通常の新規メッセージ
    // bot メッセージを除外
    if ("bot_id" in event && event.bot_id) return;
    await handleNewMessage(event);
    return;
  }

  if (event.subtype === "message_changed") {
    await handleEditMessage(event);
    return;
  }

  // その他の subtype (削除、join 等) は無視
});

(async () => {
  await app.start();
  console.log(`🤖 Slack bot 起動 (チャンネル: ${config.slackChannelId})`);
})();
