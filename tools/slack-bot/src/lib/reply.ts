import type { WebClient } from "@slack/web-api";
import { config } from "../config.js";

/** git push 後に scrap の URL をスレッド返信する。SITE_URL 未設定時はスキップする。 */
export async function replyScrapUrl(client: WebClient, channel: string, ts: string, scrapSlug: string): Promise<void> {
  if (!config.siteUrl) return;

  const url = `${config.siteUrl}/scraps/${scrapSlug}`;
  try {
    await client.chat.postMessage({
      channel,
      thread_ts: ts,
      text: url,
    });
  } catch (e) {
    console.error("⚠️ スレッド返信失敗:", e);
  }
}
