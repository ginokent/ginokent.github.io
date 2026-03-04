---
title: "CPU→GPU Transfer Cost When Playing Video with wgpu, and the Road to Zero-Copy"
description: "The pipeline for implementing video playback in a wgpu-based UI framework, CPU→GPU transfer bandwidth costs, comparison with SVG rasterization, and the external texture API for achieving zero-copy."
publishedAt: 2026-03-04T12:00:00+09:00
tags: ["Rust", "wgpu", "GPU", "Video"]
---

## Introduction

I implemented video playback in a wgpu-based UI framework, so I'm documenting the pipeline and bandwidth costs.

The bottom line: the CPU decode → `write_texture()` approach uses about 249 MB/s of bandwidth at 1080p30fps. This isn't a problem in practice, but there's room for optimization with zero-copy. However, given the instability of the wgpu HAL and the amount of platform-specific code required, zero-copy isn't something to tackle right now.

## Video Playback Pipeline

The straightforward implementation looks like this:

```text
動画ファイル
  │
  ▼
┌─────────────────────┐
│  FFmpeg デコーダ     │  CPU 上で動作
│  (libavcodec)       │
└──────────┬──────────┘
           │ YUV420P フレーム
           ▼
┌─────────────────────┐
│  swscale            │  CPU 上でピクセルフォーマット変換
│  (YUV → RGBA)       │
└──────────┬──────────┘
           │ RGBA バッファ (8.3 MB @ 1080p)
           ▼
┌─────────────────────┐
│  write_texture()    │  CPU → GPU 転送
│  (wgpu)             │
└──────────┬──────────┘
           │ GPU テクスチャ
           ▼
┌─────────────────────┐
│  レンダーパス       │  GPU 上でテクスチャを描画
│  (wgpu)             │
└─────────────────────┘
```

Every step runs every frame. Decoding and color conversion happen on the CPU, texture upload goes through the CPU→GPU bus, and rendering happens on the GPU.

## Calculating Bandwidth Cost

Data size per frame for 1080p RGBA:

```text
1920 × 1080 × 4 bytes (RGBA) = 8,294,400 bytes ≈ 8.3 MB/frame
```

Bandwidth by frame rate:

| Resolution | fps | Bandwidth |
|--------|----:|------:|
| 1920×1080 | 30 | 249 MB/s |
| 1920×1080 | 60 | 498 MB/s |
| 3840×2160 | 30 | 995 MB/s |
| 3840×2160 | 60 | 1,990 MB/s |

249 MB/s at 1080p30fps. PCIe 3.0 x16 offers about 16 GB/s of bandwidth, so there's plenty of headroom. But on mobile memory buses, 4K60fps gets tight.

## Comparison with SVG Rasterization

Compared to the Stencil-then-Cover SVG animation approach I wrote about in [the previous post](/posts/2026-03-01-svg-animation-rendering), the transfer volume differs by orders of magnitude.

| | SVG Animation (Stencil-then-Cover) | Video Playback |
|---|---|---|
| What's sent to GPU | Path control points (vertex data) | Full pixels (RGBA) |
| Transfer/frame | Hundreds of bytes to tens of KB | ~8.3 MB (1080p) |
| Bandwidth at 30fps | A few KB/s to hundreds of KB/s | 249 MB/s |
| GPU's job | Rasterization (vertices → pixels) | Texture sampling only |
| CPU's job | SMIL evaluation (light) | Decode + swscale (heavy) |

SVG sends "shape definitions" and lets the GPU rasterize them. Video sends "the pixels themselves." The bandwidth cost differs by 3–4 orders of magnitude.

## Why Bandwidth Cost Is Unavoidable for Video

Geometric data like SVG only needs control points sent over—the GPU handles rasterization. But for video, pixel data *is* the content itself.

```text
SVG:  定義 (数 KB) → GPU がラスタライズ → ピクセル
動画: ピクセル (数 MB) → GPU にそのまま渡す → ピクセル
```

Video frames are a sequence of photographs. There's no alternative where the GPU generates them from geometry. Compression codecs (H.264, VP9, AV1) help with storage and network transfer, but by the time you hand data to the GPU, you need decompressed pixel data.

In other words, as long as you use CPU decoding, the CPU→GPU bandwidth cost is structurally unavoidable.

## Room for Reduction

You can't eliminate the bandwidth cost entirely, but there are ways to reduce it.

### Direct YUV Texture Upload

Instead of converting to RGBA with swscale, send YUV420P directly to the GPU and do the color conversion in a shader.

```text
YUV420P: Y(1920×1080) + U(960×540) + V(960×540) = 3,110,400 bytes ≈ 3.0 MB
RGBA:    1920×1080×4                              = 8,294,400 bytes ≈ 8.3 MB
```

YUV420P is about 36% the size of RGBA—a 60% reduction in transfer volume. It also eliminates the need for swscale on the CPU, reducing CPU load.

However, you need to write YUV→RGB conversion in the shader. The conversion matrix differs between BT.601 and BT.709, so you need an implementation that switches based on the codec's metadata.

### Texture Reuse

Rather than calling `create_texture()` every frame, pre-allocate textures and only update their contents with `write_texture()`. This eliminates texture allocation/deallocation costs. With double buffering, you can write the next frame while the GPU is still sampling the previous one.

## The Ideal of Zero-Copy and the External Texture API

The ultimate optimization is zero-copy—eliminating the CPU→GPU transfer entirely.

```text
【現状: CPU デコード方式】

 動画ファイル → CPU デコード → CPU メモリ (RGBA) → write_texture() → GPU テクスチャ → 描画
                                                     ~~~~~~~~~~~~~~~
                                                     この転送を消したい

【理想: ゼロコピー方式】

 動画ファイル → HW デコーダ (GPU 上) → GPU テクスチャ → 描画
                                       ↑
                                       デコーダが直接 GPU メモリに書く
                                       CPU→GPU 転送がゼロ
```

Hardware decoders (VideoToolbox, MediaCodec, VAAPI, etc.) generate textures on the GPU. If these textures could be imported into wgpu, zero-copy would be achieved.

However, wgpu has no standard API for "importing externally created textures." To do this, you'd need to drop down to the HAL layer and use `create_texture_from_hal`.

```text
HW デコーダ
  │
  │ プラットフォーム固有のテクスチャハンドル
  │ (Metal: MTLTexture, Vulkan: VkImage, etc.)
  ▼
wgpu HAL レイヤー
  │
  │ create_texture_from_hal()
  │ ※ unsafe, バックエンド固有
  ▼
wgpu::Texture
  │
  │ 通常の wgpu API で使える
  ▼
レンダーパスで描画
```

`create_texture_from_hal` is treated as an internal wgpu API with no stability guarantees. It requires separate implementations for each backend (Metal / Vulkan / DX12).

## Platform-Specific Realities

Every major platform has hardware decoders, but typical implementations today incur a GPU→CPU→GPU round trip.

```text
【ありがちなパターン】

 HW デコーダ (GPU) → CPU メモリにコピー → write_texture() → GPU テクスチャ → 描画
                     ~~~~~~~~~~~~~~~~~~   ~~~~~~~~~~~~~~~
                     GPU→CPU             CPU→GPU
                     往復してしまっている
```

| Platform | HW Decoder | Decode Target | Why It Falls Back to CPU |
|---|---|---|---|
| macOS / iOS | VideoToolbox | GPU (Metal texture) | No API to directly import into wgpu |
| Android | MediaCodec | GPU (AHardwareBuffer) | Limited means to import via wgpu's Vulkan backend |
| Linux | VAAPI / VDPAU | GPU (Vulkan / GL texture) | Same as above |
| WASM (Browser) | WebCodecs | GPU (VideoFrame) | Requires `copyTo()` to pull back to CPU |

On every platform, "decoding itself happens fast on the GPU, but passing data to wgpu requires going through CPU memory."

There is a way to directly import a WebCodecs `VideoFrame` using WebGPU's `importExternalTexture()`, but that's the browser's WebGPU API—not something you can use from Rust's wgpu crate.

## Conclusion

For now, the CPU decode → `write_texture()` approach is sufficient in practice. 249 MB/s of bandwidth at 1080p30fps is no problem in a PCIe environment.

Achieving zero-copy requires using wgpu HAL's `create_texture_from_hal` to import platform-specific textures, but:

- The HAL API is unstable (may break with wgpu version upgrades)
- Requires separate implementations for Metal / Vulkan / DX12
- Hardware decoder integration code also differs per platform

Holding off is the right call until performance actually becomes a problem. Direct YUV upload and texture reuse can cut bandwidth by 60%, so exploring those first offers a much better cost-benefit ratio.
