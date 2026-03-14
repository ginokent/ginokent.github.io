import { App } from "@slack/bolt";
import { config } from "./config.js";
import { handleEditMessage, handleNewMessage } from "./handlers/message.js";

const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  socketMode: true,
});

// 全受信イベントをログ出力
app.use(async ({ body, next }) => {
  const type = body.event?.type ?? body.type ?? "unknown";
  const subtype = body.event?.subtype ? ` (${body.event.subtype})` : "";
  const channel = body.event?.channel ?? "";
  console.log(`📥 イベント受信: type=${type}${subtype} channel=${channel}`);
  await next();
});

let botUserId: string;

// 全 message イベントをリッスン (subtype 付きも含む)
app.event("message", async ({ event }) => {
  // 対象チャンネル以外は無視
  if (event.channel !== config.slackChannelId) return;

  if (!("subtype" in event) || event.subtype === undefined) {
    // bot メッセージを除外
    if ("bot_id" in event && event.bot_id) return;
    await handleNewMessage(app.client, event, botUserId);
    return;
  }

  if (event.subtype === "message_changed") {
    await handleEditMessage(app.client, event, botUserId);
    return;
  }

  // その他の subtype (削除、join 等) は無視
});

(async () => {
  const authResult = await app.client.auth.test();
  botUserId = authResult.user_id!;
  await app.start();
  console.log(`🤖 Slack bot 起動 (チャンネル: ${config.slackChannelId}, bot: <@${botUserId}>)`);
})();
