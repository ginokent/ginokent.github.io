import mermaid from "mermaid";

// 視覚モデル層: Mermaid でテキストを SVG へ描画する

let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
  initialized = true;
}

/** テキストが有効な Mermaid 構文か検証する */
export async function validate(text: string): Promise<boolean> {
  ensureInit();
  return mermaid.parse(text, { suppressErrors: true }).then((r) => r !== false);
}

/** 構文エラーがあればそのメッセージを、無ければ null を返す */
export async function parseError(text: string): Promise<string | null> {
  ensureInit();
  try {
    await mermaid.parse(text);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * テキストを描画し、生成した SVG を container に挿入する。
 * 一意な描画 ID を用いて再描画ごとの DOM ID 衝突を避ける。
 */
export async function renderInto(container: HTMLElement, text: string): Promise<SVGSVGElement> {
  ensureInit();
  const renderId = `mermaid-${Date.now()}`;
  const { svg } = await mermaid.render(renderId, text);
  container.innerHTML = svg;
  const root = container.querySelector("svg");
  if (!root) throw new Error("rendered svg root not found");
  return root;
}
