/// <reference lib="webworker" />
//
// PaddleOCR (PP-OCRv5) を ONNX Runtime Web で実行する Web Worker。
//
// Tesseract.js は CJK で「文字単位の単語」と判定して文字間にスペースを挿入
// する根本的な問題があったため、PaddleOCR に差し替えた。PP-OCRv5 の rec
// モデルは中・日・英・繁体字を 1 モデルでカバーするので言語選択は不要。
//
// モデルは mobile (軽量・初期値) / server (高精度) の 2 種を切替可。
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

// PaddleOCR.js (X3ZvaWQ) リポジトリの assets/ にある PP-OCRv5 mobile モデル。
// commit ハッシュで pin することで上流変更の影響を受けない。
const MOBILE_COMMIT = '0e369855336cbee22be7fddb7e397aa0606027af';
const MOBILE_BASE = `https://cdn.jsdelivr.net/gh/X3ZvaWQ/paddleocr.js@${MOBILE_COMMIT}/assets`;
// PP-OCRv5 server モデルは marsena/paddleocr-onnx-models (HuggingFace) から取得。
// 文字辞書は mobile/server で共通なので mobile 側を使い回す。
const SERVER_HF_REVISION = '06c3603ca8002e22e1f41d47c1aae0a251b4d940';
const SERVER_BASE = `https://huggingface.co/marsena/paddleocr-onnx-models/resolve/${SERVER_HF_REVISION}`;

export type ModelVariant = 'mobile' | 'server';

interface ModelSource {
  det: string;
  rec: string;
  dict: string;
}

const SOURCES: Record<ModelVariant, ModelSource> = {
  mobile: {
    det: `${MOBILE_BASE}/PP-OCRv5_mobile_det_infer.onnx`,
    rec: `${MOBILE_BASE}/PP-OCRv5_mobile_rec_infer.onnx`,
    dict: `${MOBILE_BASE}/ppocrv5_dict.txt`,
  },
  server: {
    det: `${SERVER_BASE}/PP-OCRv5_server_det_infer.onnx`,
    rec: `${SERVER_BASE}/PP-OCRv5_server_rec_infer.onnx`,
    dict: `${MOBILE_BASE}/ppocrv5_dict.txt`,
  },
};

interface RecognizeMessage {
  type: 'recognize';
  variant: ModelVariant;
  width: number;
  height: number;
  pixels: Uint8Array;
}

// Cache API でモデル ArrayBuffer を永続化する。
// URL は commit/version で pin しているので、URL 一致 = 内容一致が保証される。
// 同じ URL を再要求した場合は cache から ArrayBuffer を返してネットワーク往復を省略。
const MODEL_CACHE_NAME = 'ginokent-ocr-models-v1';

async function getCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(MODEL_CACHE_NAME);
  } catch {
    return null;
  }
}

let service: PaddleOcrService | null = null;
let currentVariant: ModelVariant | null = null;
let initializing: Promise<PaddleOcrService> | null = null;

function post(msg: unknown) {
  (self as DedicatedWorkerGlobalScope).postMessage(msg);
}

function postStatus(status: string, progress?: number) {
  post({ type: 'status', status, progress: progress ?? null });
}

async function readBodyWithProgress(res: Response, label: string): Promise<ArrayBuffer> {
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

async function fetchCached(url: string, label: string): Promise<ArrayBuffer> {
  const cache = await getCache();
  if (cache) {
    const hit = await cache.match(url);
    if (hit && hit.ok) {
      postStatus(`${label} (キャッシュから読込)`, 1);
      return hit.arrayBuffer();
    }
  }
  postStatus(label, 0);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} に失敗 (${res.status}): ${url}`);
  // Response の body は一度しか読めないので、進捗読みする前に clone して
  // キャッシュ用に取り分けておく。
  const forCache = cache ? res.clone() : null;
  const buffer = await readBodyWithProgress(res, label);
  if (cache && forCache) {
    try {
      await cache.put(url, forCache);
    } catch (err) {
      // Quota 超過などは握り潰す。次回も再ダウンロードになるだけで動作には影響しない。
      console.warn('Cache API put failed:', err);
    }
  }
  return buffer;
}

async function ensureService(variant: ModelVariant): Promise<PaddleOcrService> {
  if (service && currentVariant === variant) return service;
  if (initializing && currentVariant === variant) return initializing;
  // 種類が違うサービスを保持している場合は破棄してから作り直す。
  if (service) {
    try { await service.destroy(); } catch { /* noop */ }
    service = null;
  }
  currentVariant = variant;
  const src = SOURCES[variant];
  initializing = (async () => {
    const detLabel = variant === 'server' ? '検出モデル(server)をダウンロード中' : '検出モデルをダウンロード中';
    const recLabel = variant === 'server' ? '認識モデル(server)をダウンロード中' : '認識モデルをダウンロード中';
    const detBuf = await fetchCached(src.det, detLabel);
    const recBuf = await fetchCached(src.rec, recLabel);
    const dictBuf = await fetchCached(src.dict, '辞書をダウンロード中');
    const dict = new TextDecoder().decode(dictBuf).split(/\r?\n/);
    postStatus('OCR エンジンを初期化中', 0);
    const s = await PaddleOcrService.createInstance({
      // onnxruntime-web の型は paddleocr 側の OrtModule よりも厳密だが
      // 実行時の I/F は互換。
      ort: ort as unknown as Parameters<typeof PaddleOcrService.createInstance>[0]['ort'],
      detection: { modelBuffer: detBuf },
      recognition: { modelBuffer: recBuf, charactersDictionary: dict },
    });
    service = s;
    initializing = null;
    return s;
  })();
  return initializing;
}

self.addEventListener('message', async (e: MessageEvent<RecognizeMessage>) => {
  if (!e.data || e.data.type !== 'recognize') return;
  try {
    const s = await ensureService(e.data.variant);
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
      variant: e.data.variant,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', message });
  }
});
