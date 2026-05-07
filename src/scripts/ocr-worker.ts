/// <reference lib="webworker" />
//
// PaddleOCR (PP-OCRv5 mobile) を ONNX Runtime Web で実行する Web Worker。
//
// Tesseract.js は CJK で「文字単位の単語」と判定して文字間にスペースを挿入
// する根本的な問題があったため、PaddleOCR に差し替えた。PP-OCRv5 mobile の
// rec モデルは中・日・英・繁体字を 1 モデルでカバーするので言語選択は不要。
//
// すべての処理は Worker 内で完結し、画像データは外部に送信されない。
// 初回のみ wasm / モデル / 辞書を CDN から取得する。

import * as ort from 'onnxruntime-web';
import { PaddleOcrService } from 'paddleocr';
import type { PaddleOcrProgressEvent } from 'paddleocr';

// onnxruntime-web の wasm を CDN から取得する。npm の onnxruntime-web と
// 完全に同一バージョンを指定する必要がある (構造体レイアウトが揃わないと
// 起動しない)。バージョンを上げる場合は package.json と一緒にここも更新。
const ORT_VERSION = '1.25.1';
ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

// PaddleOCR.js (X3ZvaWQ) リポジトリの assets/ にある PP-OCRv5 mobile モデルを使う。
// commit ハッシュで pin することで上流変更の影響を受けない。
const MODELS_COMMIT = '0e369855336cbee22be7fddb7e397aa0606027af';
const MODELS_BASE = `https://cdn.jsdelivr.net/gh/X3ZvaWQ/paddleocr.js@${MODELS_COMMIT}/assets`;

interface RecognizeMessage {
  type: 'recognize';
  width: number;
  height: number;
  pixels: Uint8Array;
}

let service: PaddleOcrService | null = null;
let initializing: Promise<PaddleOcrService> | null = null;

function post(msg: unknown) {
  (self as DedicatedWorkerGlobalScope).postMessage(msg);
}

function postStatus(status: string, progress?: number) {
  post({ type: 'status', status, progress: progress ?? null });
}

async function downloadWithProgress(url: string, label: string): Promise<ArrayBuffer> {
  postStatus(label, 0);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} に失敗 (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!total || !res.body) {
    return res.arrayBuffer();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      postStatus(label, received / total);
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged.buffer;
}

async function ensureService(): Promise<PaddleOcrService> {
  if (service) return service;
  if (initializing) return initializing;
  initializing = (async () => {
    const detBuf = await downloadWithProgress(
      `${MODELS_BASE}/PP-OCRv5_mobile_det_infer.onnx`,
      '検出モデルをダウンロード中',
    );
    const recBuf = await downloadWithProgress(
      `${MODELS_BASE}/PP-OCRv5_mobile_rec_infer.onnx`,
      '認識モデルをダウンロード中',
    );
    postStatus('辞書をダウンロード中', 0);
    const dictRes = await fetch(`${MODELS_BASE}/ppocrv5_dict.txt`);
    if (!dictRes.ok) throw new Error(`辞書のダウンロードに失敗 (${dictRes.status})`);
    const dict = (await dictRes.text()).split(/\r?\n/);
    postStatus('OCR エンジンを初期化中', 0);
    const s = await PaddleOcrService.createInstance({
      // onnxruntime-web の型は paddleocr 側の OrtModule よりも厳密だが
      // 実行時の I/F は互換。
      ort: ort as unknown as Parameters<typeof PaddleOcrService.createInstance>[0]['ort'],
      detection: { modelBuffer: detBuf },
      recognition: { modelBuffer: recBuf, charactersDictionary: dict },
    });
    service = s;
    return s;
  })();
  return initializing;
}

self.addEventListener('message', async (e: MessageEvent<RecognizeMessage>) => {
  if (!e.data || e.data.type !== 'recognize') return;
  try {
    const s = await ensureService();
    postStatus('文字を検出中', 0);
    const t0 = performance.now();
    const results = await s.recognize(
      { width: e.data.width, height: e.data.height, data: e.data.pixels },
      {
        onProgress: (ev: PaddleOcrProgressEvent) => {
          const p = ev.progress;
          const ratio = p.total ? p.current / p.total : 0;
          if (ev.type === 'det') {
            postStatus(`文字領域を検出中 (${ev.stage})`, ratio);
          } else {
            postStatus(`文字を認識中 (${p.current}/${p.total})`, ratio);
          }
        },
      },
    );
    const final = s.processRecognition(results);
    const elapsed = (performance.now() - t0) / 1000;
    post({
      type: 'result',
      text: final.text,
      confidence: final.confidence,
      lines: final.lines.length,
      elapsed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', message });
  }
});
