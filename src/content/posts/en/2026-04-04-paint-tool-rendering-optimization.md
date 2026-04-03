---
title: "Three Approaches I Tried to Optimize Rendering in a Paint Tool"
description: "A record of trial and error to fix FPS drops at thousands of strokes in a paint tool built with my own graphics library."
publishedAt: 2026-04-04T09:00:00+09:00
tags: ["graphics", "rendering", "optimization", "wgpu", "Rust"]
---

I'm building a paint tool using my own graphics library. I hit a problem where FPS dropped drastically around 2,000–8,000 strokes, so here's a record of three approaches I tried.

## Background

- Backend is wgpu
- Design rebuilds vertex buffers for all primitives every frame (`build_batches()`)
- FPS drops to ≈ 1 at 8,000 strokes

The bottleneck was clearly `build_batches()` — recalculating, recopying, and re-uploading vertices for thousands of strokes every frame, causing frame time (= time to render one frame) to increase proportionally with stroke count.

## Approach 1: GPU Transform + Vertex Cache + GPU Batch Cache

I planned a three-stage optimization.

1. GPU Transform migration: Move transform calculations from CPU to the vertex shader. Remove CPU-side `apply_transform_to_vertices()` and pass transforms to the GPU via dynamic uniform buffers
2. Vertex cache: Cache the results of `push_polyline()` per stroke to skip recomputation
3. GPU batch cache: Reuse committed stroke batches including their GPU buffers across frames, skipping memcpy + GPU upload entirely

### What went wrong

Using `Rc` pointer addresses as vertex cache keys caused two problems.

- Allocator memory reuse: Released addresses get reused for different data, causing the cache to return stale data (display flickering)
- `Rc::make_mut` in-place mutation: The address stays the same even when data changes, so the cache never invalidates (moves aren't reflected)

In hindsight this is obvious, but pointer addresses were unusable as cache keys.
I applied a quick fix using a fingerprint approach (sampling 3 points: head, center, tail), but it was clearly a heuristic so I dropped it.
In the end, I added `cache_key: Option<u64>` to `DrawPrimitive`, letting data producers explicitly declare cacheability.

The GPU batch cache also had many issues.

- Menu UI and committed strokes mixed into the same batch, causing menus to disappear
- Batch explosion led to GPU memory exhaustion → crash
- Pen tip coordinate misalignment

Trying to separate committed/dynamic batches inside `build_batches()` caused a combinatorial explosion from interactions with OpacityGroup and index consistency management.
I ended up reverting the GPU batch cache entirely.

## Approach 2: Structural Hash of DrawList to Skip

I considered a method where, at the `render()` level, if the DrawList is identical to the previous frame, `build_batches()` + Phase 1 would be skipped entirely — without modifying `build_batches()` internals.

But this was completely pointless.

The reason is simple: the UI I'm building is an immediate-mode UI, and when completely idle (no user interaction), `render()` isn't called at all by design.
FPS is only an issue during active use (drawing, moving, selection animations), and the DrawList changes every frame. The structural hash always misses.

The cause was proceeding with the design without verifying the preconditions of the optimization target. Incredibly foolish.

## Approach 3: Vertex Vec Reuse + Rasterize Cache (Final Decision)

I had been designing based on the assumption that "96MB of memcpy is the bottleneck," but this is when I finally measured properly.

| Process | Duration | Share |
|---------|----------|-------|
| `vcache_ext` (2,000 small `extend_from_slice` calls) | 7.4ms | 45% |
| GPU upload (Phase 1) | 4.6ms | 28% |
| Phase 2 | 1.6ms | 10% |

### Short-term: Vertex Vec Reuse for Committed Strokes

Retain the vertex `Vec` for committed strokes per batch across frames.

1. `std::mem::take` to move the entire `Vec` (zero-copy)
2. Append dynamic content (cursor, selection UI, etc.) to the end
3. GPU upload
4. `truncate` to trim off the dynamic portion and return it

The key is a hash of the `cache_key` sequence rather than batch position, so even when the batch structure changes (e.g., a stroke moves to a different batch due to repositioning), reuse works without spikes.

Note that `Vec::append` performs memcpy internally, so it's not zero-copy. You need to move the entire `Vec` with `std::mem::take` and return it with `truncate` after use.

Selection & move operations during scrolling were changed from CPU-side per-vertex offset to GPU transform via `PushTransform(translate(dx, dy))`.

### Long-term: Rasterize Cache

Bake committed strokes into a layer texture, and at draw time only display a single texture. Drawing cost becomes O(1), independent of stroke count.

- Treat as vector data only during editing (rasterize cache + on-demand vector editing)
- Undo uses partial texture backup (back up and restore only the stroke's bounding rect region)
- GPU memory management starts with 1 layer = 1 texture in the initial implementation, with a possible migration to a tiling approach in the future

## Retrospective

- Don't use pointer addresses as cache keys. Allocators reuse addresses, and in-place mutations via `Rc::make_mut` etc. leave addresses unchanged. Cache correctness requires producers to explicitly manage keys
- Measure before optimizing. Designing based on guesswork leads to complexity and rework, as with Approach 1. Periodically outputting N-frame averages avoids measurement pollution from per-frame logging
- Verify the preconditions of your optimization target. "Skip when idle" is meaningless in a framework that doesn't render when idle. Precisely understand the conditions under which the problem occurs before designing
- Caching inputs/outputs is simpler than modifying complex internal logic. Caching the inputs (vertex Vec) or outputs of `build_batches()` was safer and more effective than modifying its internals
- There's a limit to re-uploading massive vectors every frame. Thousands of strokes × hundreds of vertices × 60 bytes amounts to tens to hundreds of MB/frame. Migrating to a rendering approach that doesn't scale with stroke count (rasterize cache) is the ultimate solution
- `Vec::append` is not zero-copy. Rust's `Vec::append(&mut other)` performs memcpy internally. True zero-copy requires moving the entire `Vec` with `std::mem::take` and returning it with `truncate` after use
