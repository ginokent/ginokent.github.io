/// <reference lib="webworker" />
//
// OCR ツールのコア Web Worker。
// 複数の OCR エンジンをこのワーカ内でディスパッチする:
//   - PP-OCRv5_mobile : PaddleOCR PP-OCRv5 mobile (ONNX Runtime Web 経由)
//   - PP-OCRv5_server : PaddleOCR PP-OCRv5 server (同)
//   - Tesseract.js    : Tesseract.js (npm からバンドル)
//
// JS 本体はすべてバンドル (動的 CDN import なし)。
// モデル / wasm / 言語データなどのバイナリリソースは初回のみ CDN から取得し、
// Cache API に永続化する。すべての処理は Worker 内で完結し、画像データは
// 外部に送信されない。

import * as ort from 'onnxruntime-web';
import { PaddleOcrService } from 'paddleocr';
import type { PaddleOcrProgressEvent } from 'paddleocr';
import { createWorker as createTesseractWorker } from 'tesseract.js';
// worker.min.js (Tesseract.js が内部で spawn する Web Worker のスクリプト) は
// Vite の `?url` 経由でバンドルし、同一オリジンから読み込ませる。
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';

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

// Tesseract.js 本体は npm からバンドル (上の import 文)。
// core wasm (tesseract.js-core) と言語データ (traineddata.gz) はバイナリ
// リソースなので実行時 CDN 取得を維持する。バージョンは package.json の
// tesseract.js@5 の peer に合わせて pin する。
const TESSERACT_CORE_VERSION = '5.1.1';
const TESSERACT_CORE_BASE = `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_CORE_VERSION}`;
const TESSERACT_LANG_BASE = 'https://tessdata.projectnaptha.com/4.0.0';

export type Engine = 'PP-OCRv5_mobile' | 'PP-OCRv5_server' | 'Tesseract.js';

type PaddleEngine = 'PP-OCRv5_mobile' | 'PP-OCRv5_server';

function isPaddleEngine(e: Engine): e is PaddleEngine {
  return e === 'PP-OCRv5_mobile' || e === 'PP-OCRv5_server';
}

interface ModelSource {
  det: string;
  rec: string;
  dict: string;
}

const PADDLE_SOURCES: Record<PaddleEngine, ModelSource> = {
  'PP-OCRv5_mobile': {
    det: `${MOBILE_BASE}/PP-OCRv5_mobile_det_infer.onnx`,
    rec: `${MOBILE_BASE}/PP-OCRv5_mobile_rec_infer.onnx`,
    dict: `${MOBILE_BASE}/ppocrv5_dict.txt`,
  },
  'PP-OCRv5_server': {
    det: `${SERVER_BASE}/PP-OCRv5_server_det_infer.onnx`,
    rec: `${SERVER_BASE}/PP-OCRv5_server_rec_infer.onnx`,
    dict: `${MOBILE_BASE}/ppocrv5_dict.txt`,
  },
};

interface RecognizeMessage {
  type: 'recognize';
  engine: Engine;
  width: number;
  height: number;
  pixels: Uint8Array;
}

// Cache API でモデル ArrayBuffer を永続化する。
// URL は commit/version で pin しているので、URL 一致 = 内容一致が保証される。
const MODEL_CACHE_NAME = 'ginokent-ocr-models-v1';

async function getCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(MODEL_CACHE_NAME);
  } catch {
    return null;
  }
}

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

// =============================================================================
// PaddleOCR
// =============================================================================

let paddleService: PaddleOcrService | null = null;
let paddleEngine: PaddleEngine | null = null;
let paddleInitializing: Promise<PaddleOcrService> | null = null;

async function destroyPaddle() {
  if (paddleService) {
    try { await paddleService.destroy(); } catch { /* noop */ }
  }
  paddleService = null;
  paddleEngine = null;
  paddleInitializing = null;
}

async function ensurePaddleService(engine: PaddleEngine): Promise<PaddleOcrService> {
  if (paddleService && paddleEngine === engine) return paddleService;
  if (paddleInitializing && paddleEngine === engine) return paddleInitializing;
  await destroyPaddle();
  paddleEngine = engine;
  const src = PADDLE_SOURCES[engine];
  paddleInitializing = (async () => {
    const detBuf = await fetchCached(src.det, `検出モデル(${engine})をダウンロード中`);
    const recBuf = await fetchCached(src.rec, `認識モデル(${engine})をダウンロード中`);
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
    paddleService = s;
    paddleInitializing = null;
    return s;
  })();
  return paddleInitializing;
}

interface RunResult {
  text: string;
  confidence: number;
  lines: number;
  meta: string;
}

async function runPaddle(engine: PaddleEngine, msg: RecognizeMessage): Promise<RunResult> {
  const s = await ensurePaddleService(engine);
  postStatus('文字を検出中', 0);
  const results = await s.recognize(
    { width: msg.width, height: msg.height, data: msg.pixels },
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
  return {
    text: final.text,
    confidence: final.confidence,
    lines: final.lines.length,
    meta: '',
  };
}

// =============================================================================
// Tesseract.js
// =============================================================================

// Tesseract.js は npm からバンドル済 (動的 CDN import を廃止)。
// any 経由でアクセスするのは tesseract.js@5 の型が一部緩いため。
let tesseractWorkerInst: any = null;

async function ensureTesseractWorker(): Promise<any> {
  if (tesseractWorkerInst) return tesseractWorkerInst;
  postStatus('Tesseract.js (jpn+eng) を初期化中', 0);
  const statusLabels: Record<string, string> = {
    'loading tesseract core': 'Tesseract コアを読込中',
    'initializing tesseract': 'Tesseract を初期化中',
    'loading language traineddata': '言語モデル(jpn+eng)をダウンロード中',
    'initializing api': 'API を初期化中',
    'recognizing text': '文字を認識中',
  };
  tesseractWorkerInst = await createTesseractWorker('jpn+eng', 1, {
    workerPath: tesseractWorkerUrl,
    corePath: TESSERACT_CORE_BASE,
    langPath: TESSERACT_LANG_BASE,
    logger: (m: { status: string; progress: number }) => {
      const label = statusLabels[m.status] || m.status;
      postStatus(label, m.progress);
    },
  });
  return tesseractWorkerInst;
}

async function destroyTesseract() {
  if (tesseractWorkerInst) {
    try { await tesseractWorkerInst.terminate(); } catch { /* noop */ }
  }
  tesseractWorkerInst = null;
}

async function runTesseract(msg: RecognizeMessage): Promise<RunResult> {
  const w = await ensureTesseractWorker();
  // Worker 内では HTMLImageElement が使えない。ImageData を直接渡す。
  // Uint8Array → Uint8ClampedArray (RGBA, 4 channel)。
  const clamped = new Uint8ClampedArray(msg.pixels.buffer, msg.pixels.byteOffset, msg.pixels.byteLength);
  const imageData = new ImageData(clamped, msg.width, msg.height);
  const { data } = await w.recognize(imageData);
  const text: string = data.text || '';
  const confidence: number = typeof data.confidence === 'number' ? data.confidence / 100 : 0;
  const lineCount: number = Array.isArray(data.lines) ? data.lines.length : text.split('\n').filter(Boolean).length;
  return {
    text,
    confidence,
    lines: lineCount,
    meta: 'Tesseract.js は CJK 文字間にスペースを挿入する既知の挙動があります',
  };
}

// =============================================================================
// Dispatcher
// =============================================================================

self.addEventListener('message', async (e: MessageEvent<RecognizeMessage>) => {
  if (!e.data || e.data.type !== 'recognize') return;
  const engine = e.data.engine;
  try {
    // 別ファミリへ切替時は使わないリソースを解放する。
    if (isPaddleEngine(engine)) {
      await destroyTesseract();
    } else {
      await destroyPaddle();
    }

    const t0 = performance.now();
    const result: RunResult = isPaddleEngine(engine)
      ? await runPaddle(engine, e.data)
      : await runTesseract(e.data);
    const elapsed = (performance.now() - t0) / 1000;
    post({
      type: 'result',
      engine,
      text: result.text,
      confidence: result.confidence,
      lines: result.lines,
      elapsed,
      meta: result.meta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: 'error', message });
  }
});
