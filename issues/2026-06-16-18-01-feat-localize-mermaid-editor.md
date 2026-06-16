# Mermaid Editor を i18n 対応し /en/ で英語配信する

- Priority: Medium
- Created: 2026-06-16 18:01 JST
- Completed: 2026-06-16 18:01 JST
- Model: Opus 4.8
- Branch: feature/add-i18n

## 目的

ginokent/mermaid-editor の i18n 対応 (ja 既定 / en) を親サイトへ取り込み、
`/tools/mermaid-editor` (ja) と `/en/tools/mermaid-editor` (en) の両方で配信する。
ヘッダの言語切替で両言語を行き来できるようにし、サイトのロケール流儀
(Astro i18n・パスベース・`prefixDefaultLocale:false`) と一貫させる。

## 経緯

上流 mermaid-editor に i18n 土台 (`core/i18n.ts` / `drawOverlay(..., msg)` /
`Editor` の `options.locale`) が入った (上流 PR #34)。本リポジトリはロジックを
無改変同期して取り込む構成のため、再同期 + グルー (`.astro`) の手当てで対応する。

## 実施内容

- `scripts/sync-mermaid-editor.sh` でロジックを `8f227cf` まで再同期
  (`core/i18n.ts` 追加、`editor.ts` / `ui/overlay.ts` 更新、SOURCE スタンプ更新)。
- グルーを共有コンポーネント `src/components/MermaidEditor.astro` に集約。
  `locale` prop で `getMessages(locale)` を引き、固定文言 (ヘッダ・ペイン見出し・
  ツールバー) はビルド時に locale で確定してサーバ描画、動的文言 (連番ラベル・トースト・
  テンプレート) は `data-locale` を読む bootstrap で描画する。`Editor` には
  `{ locale }` を渡してメニュー・ヒントもロケールに従わせる。
- `src/pages/tools/mermaid-editor.astro` (ja ルート) をコンポーネント利用に置換。
- `src/pages/[lang]/tools/mermaid-editor.astro` を新設し、`/en/tools/mermaid-editor`
  (と既定別名 `/ja/...`) を生成 (他ページ `[lang]/about.astro` 等と同じ流儀)。
- エディタ内に言語トグルは置かない。言語切替はヘッダの lang-switch
  (`getAlternateLocaleUrl`) が担い、両ページが正しく対向することを確認した。

## 完了条件

1. `pnpm run build` 緑。`/tools/mermaid-editor`・`/en/tools/mermaid-editor` が生成される。 ... 達成
2. en ページは英語 UI・`<html lang="en">`、ja ページは日本語 UI・`<html lang="ja">`。 ... 達成
3. ヘッダ言語切替が両ページ間で正しく対向する。 ... 達成

## 検証

- `pnpm run build`: 322 ページ生成・緑。
- 生成 HTML を確認: en は `data-locale="en"` + 英語ラベル (＋ Add / Templates: / Export SVG)、
  ja は `data-locale="ja"` + 日本語ラベル。`<html lang>` も一致。
- lang-switch: ja ルート → `/en/tools/mermaid-editor/`、en → `/tools/mermaid-editor/`。

## 残作業 (本 issue スコープ外)

- `/en/tools` (Tools 一覧) と `/en/tools/ocr` は未整備のため、en ヘッダの「Tools」リンクは
  現状 404 になる (本対応以前からの既存ギャップ)。tools 一覧・OCR の i18n は別途。
