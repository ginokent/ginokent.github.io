import type { WebClient } from "@slack/web-api";

/** リアクションを追加する。既に付いている場合は無視する */
export async function addReaction(client: WebClient, channel: string, timestamp: string, name: string): Promise<void> {
  try {
    await client.reactions.add({ channel, name, timestamp });
  } catch (e: unknown) {
    // already_reacted は正常ケース（冪等性のため無視）
    if (e instanceof Error && "data" in e && (e as any).data?.error === "already_reacted") return;
    throw e;
  }
}

/** リアクションを削除する。付いていない場合は無視する */
export async function removeReaction(client: WebClient, channel: string, timestamp: string, name: string): Promise<void> {
  try {
    await client.reactions.remove({ channel, name, timestamp });
  } catch (e: unknown) {
    // no_reaction は正常ケース（冪等性のため無視）
    if (e instanceof Error && "data" in e && (e as any).data?.error === "no_reaction") return;
    throw e;
  }
}
