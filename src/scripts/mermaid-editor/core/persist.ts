// 永続化: テキストを localStorage に自動保存し、URL ハッシュへエンコードして共有可能にする。

const KEY = "mermaid-editor:doc";
const HASH_PREFIX = "#code=";

/** テキストを URL-safe な base64 (UTF-8) へエンコードする */
export function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** encode の逆変換。失敗時は null */
export function decode(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** テキストを localStorage と URL ハッシュへ保存する */
export function save(text: string): void {
  try {
    localStorage.setItem(KEY, text);
  } catch {
    // ストレージ無効環境では無視する
  }
  history.replaceState(null, "", HASH_PREFIX + encode(text));
}

/** URL ハッシュ優先、無ければ localStorage からテキストを読み込む */
export function load(): string | null {
  if (location.hash.startsWith(HASH_PREFIX)) {
    const decoded = decode(location.hash.slice(HASH_PREFIX.length));
    if (decoded !== null) return decoded;
  }
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
