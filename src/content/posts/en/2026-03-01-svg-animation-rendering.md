---
title: "Comparing Animated SVG Rendering Techniques: CPU Rasterization vs GPU Vector Rasterization"
description: "A comparison of CPU rasterization and GPU vector rasterization for rendering animated SVGs, covering the characteristics of Stencil-then-Cover, Tessellation, and Compute Shader-based approaches."
publishedAt: 2026-03-01T12:00:00+09:00
tags: ["SVG", "GPU", "Rendering", "Graphics"]
---

## Introduction

There are multiple ways to render animated SVGs. In a separate article on [svg-rs](/posts/2026-03-01-svg-rs), I discussed SMIL animation evaluation, but converting the resulting path data into actual pixels is an entirely different matter.

This article focuses on "how to draw evaluated path data to the screen," comparing CPU rasterization and GPU vector rasterization techniques.

## Attributes That Change During SVG Animation

The cost of rendering varies significantly depending on what changes during animation.

- **Path geometry** (`d` attribute morphing) — Re-rasterization is required. The most expensive case
- **Transforms** (`translate`, `rotate`, `scale`) — Sometimes only a matrix update is needed
- **Color and opacity** (`fill`, `opacity`) — Geometry doesn't change, so only fragment processing is needed

The case where paths change every frame is the most challenging, and how you handle this is the key deciding factor when choosing a technique.

## CPU Rasterization

The most straightforward approach. Paths are converted to pixels on the CPU side, and the result is uploaded to the GPU as a texture.

```text
SVG parsing → Flattening → CPU rasterization → Pixel buffer → GPU texture upload → Screen rendering
```

Notable implementations:

- Skia (software backend)
- Cairo
- resvg / tiny-skia

### The Problem: Per-Frame Texture Uploads

The biggest issue with CPU rasterization is that a large pixel buffer must be transferred from CPU to GPU every frame.

- 1920x1080 RGBA = ~8.3 MB/frame
- At 60fps, this consumes ~500 MB/s of bandwidth
- On mobile, memory bus bandwidth constraints are even tighter

On top of that, CPU-GPU synchronization causes pipeline stalls. The GPU has to wait until the CPU finishes rasterizing, and the CPU can't write the next frame's buffer until the GPU is done using the texture.

This isn't a problem for static SVGs or small icons, but it becomes a bottleneck when running a full-screen animated SVG at 60fps.

## GPU Vector Rasterization as an Alternative

Here's where we flip the approach. Instead of sending a pixel buffer (several MB), we send only the path control point data (a few KB to tens of KB) to the GPU and let it handle the rasterization.

The transfer volume drops by orders of magnitude. Path data consists of control point coordinate sequences, which typically fit within tens of KB even for full-screen content.

## Three Approaches to GPU Vector Rasterization

### Stencil-then-Cover

A two-pass algorithm that uses the GPU's stencil buffer to determine the fill region of a path.

1. **Stencil pass**: Draw a triangle fan from an anchor point to each edge of the path, incrementing/decrementing the stencil buffer values
2. **Cover pass**: Draw the path's bounding box, using the stencil test to paint only the actual fill region

```text
           anchor point
              *
             /|\
            / | \
           /  |  \
          / S | S \    S = Triangle with stencil update
         /  T | T  \
        /  E  |  E  \
       /  N   |   N  \
      *-------+-------*
      path edge
```

The nice thing is that winding rules (even-odd / non-zero) are naturally expressed through stencil operations. For even-odd, just check the LSB of the stencil value; for non-zero, just check whether the stencil value is non-zero.

Notable implementations:

- `NV_path_rendering` (NVIDIA's OpenGL extension)
- Pathfinder (Rust)

Pathfinder uses floating-point textures for trapezoid coverage calculation, achieving anti-aliasing quality equivalent to 256xAA.

### Tessellation-Based

This approach flattens paths (approximating Bézier curves as line segments), subdivides them into triangle meshes, and draws them using the standard GPU rasterizer.

```text
SVG parsing → Flattening → Tessellation (triangulation) → GPU vertex buffer → GPU rasterization → Screen rendering
```

Notable implementations:

- Lyon (Rust)

This fits directly into existing GPU pipelines, making implementation relatively straightforward. However, for animations where the path changes every frame, the bottleneck is that tessellation must be redone on the CPU each frame. Tessellation itself is a fairly heavy operation.

### Compute Shader-Based

This approach runs the entire pipeline — flattening, binning (tile subdivision), and rasterization — in GPU compute shaders. The CPU has almost no work to do.

Notable implementations:

- Vello / piet-gpu (Rust, linebender project)

Vello uses an algorithm called Sparse Strips, performing parallel rasterization in 4x4 tile units. It also supports retaining intermediate representations, allowing it to skip recomputation for unchanged parts.

Analytical anti-aliasing is also performed on the GPU, resulting in high AA quality.

However, it requires WebGPU / Vulkan / Metal and doesn't work on WebGL 2. This approach has the strictest environment requirements.

## Comparison

| Aspect | CPU Rasterization | Stencil-then-Cover | Tessellation | Compute Shader |
|------|:---:|:---:|:---:|:---:|
| Transfer/frame | Several MB | Tens of KB | Tens of KB | Tens of KB |
| CPU load | High | Low | Medium (tessellation) | Lowest |
| AA quality | High (analytical) | MSAA-dependent | MSAA-dependent | High (analytical) |
| Implementation complexity | Low | Medium | Medium | High |
| Environment requirements | None | OpenGL | OpenGL | WebGPU / Vulkan / Metal |

## Selection Guidelines

The optimal technique depends on your use case and environment.

- **Small icons and static SVGs** → CPU rasterization is sufficient. resvg / tiny-skia are easy to use
- **Full-screen, high-framerate animated SVGs** → Consider GPU vector rasterization
- **WebGPU-capable environments** → Vello (Compute Shader) offers the best performance
- **OpenGL environments** → Pathfinder (Stencil-then-Cover)
- **Mobile with compatibility priority** → Lyon (Tessellation) + GPU drawing

Personally, I think Vello's Sparse Strips approach has the most promising future. However, it partly depends on WebGPU adoption, and it's not something you can use everywhere just yet.

## Conclusion

CPU rasterization is simple but bottlenecked by texture upload bandwidth. GPU vector rasterization only needs to send path control point data, making bandwidth efficiency orders of magnitude better.

Compute Shader-based Vello has the most potential, but it requires WebGPU / Vulkan / Metal as an environment constraint. Choosing Stencil-then-Cover or Tessellation based on your target environment is the pragmatic decision.

For details on SVG parsing and SMIL evaluation, see the [svg-rs article](/posts/2026-03-01-svg-rs).
