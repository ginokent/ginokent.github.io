import { resolve } from "node:path";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ 環境変数 ${name} が設定されていません。.env ファイルを確認してください。`);
    process.exit(1);
  }
  return value;
}

export const config = {
  slackBotToken: requireEnv("SLACK_BOT_TOKEN"),
  slackAppToken: requireEnv("SLACK_APP_TOKEN"),
  slackChannelId: requireEnv("SLACK_CHANNEL_ID"),
  defaultTags: (process.env.DEFAULT_TAGS ?? "slack").split(",").map((t) => t.trim()).filter(Boolean),
  // tools/slack-bot/src/ から 3 階層上 = プロジェクトルート
  projectRoot: resolve(import.meta.dir, "../../../"),
} as const;
