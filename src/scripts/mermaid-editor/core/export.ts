// エクスポート / コピー: 描画済み SVG を書き出す。
// 編集用に注入した透明ヒット (.edge-hit) は除いてクリーンな図を出力する。

/** mermaid コードをクリップボードへコピーする */
export function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/** 描画済み SVG から編集用要素を除いた複製を返す */
function cleanSvg(diagram: HTMLElement): SVGSVGElement | null {
  const svg = diagram.querySelector("svg");
  if (!svg) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(".edge-hit").forEach((n) => n.remove());
  if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return clone;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** SVG ファイルとして書き出す */
export function exportSvg(diagram: HTMLElement): void {
  const svg = cleanSvg(diagram);
  if (!svg) return;
  const str = new XMLSerializer().serializeToString(svg);
  download(new Blob([str], { type: "image/svg+xml;charset=utf-8" }), "diagram.svg");
}

/** PNG ファイルとして書き出す (描画サイズの scale 倍で rasterize) */
export async function exportPng(diagram: HTMLElement, scale = 2): Promise<void> {
  const live = diagram.querySelector("svg");
  const svg = cleanSvg(diagram);
  if (!live || !svg) return;

  const rect = live.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));

  const str = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    await new Promise<void>((resolve) => {
      canvas.toBlob((b) => {
        if (b) download(b, "diagram.png");
        resolve();
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to rasterize svg"));
    img.src = url;
  });
}
