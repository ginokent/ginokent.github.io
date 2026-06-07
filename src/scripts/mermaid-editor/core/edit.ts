import type { EditableField, TextEdit } from "./types";

/**
 * 変更されたフィールドから結合 TextEdit 群を生成する。
 * 各フィールドは値が現れる全範囲 (ranges) を新値で置換する。
 * 値が未指定または現在値と同一のフィールドは対象外とする。
 */
export function buildFieldEdits(
  fields: readonly EditableField[],
  changes: Readonly<Record<string, string>>,
): TextEdit[] {
  const edits: TextEdit[] = [];
  for (const field of fields) {
    const value = changes[field.name];
    if (value === undefined || value === field.value) continue;
    for (const range of field.ranges) edits.push({ range, newText: value });
  }
  return edits;
}

/**
 * 戦略 B の中核: TextEdit 群をテキストへ surgical に適用する
 *
 * 編集をオフセットの降順 (右 → 左) に適用することで、前段の置換が
 * 後段の range のオフセットを破壊しないことを保証する。これにより
 * 「変更した範囲以外はバイト単位で不変」という局所性が成立する。
 */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  // 開始オフセットの降順に整列 (元配列は破壊しない)
  const ordered = [...edits].sort((a, b) => b.range.start - a.range.start);

  // 編集範囲の重なりはセマンティクスを壊すため即座に弾く
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (cur.range.end > prev.range.start) {
      throw new Error("overlapping text edits are not allowed");
    }
  }

  let result = text;
  for (const { range, newText } of ordered) {
    result = result.slice(0, range.start) + newText + result.slice(range.end);
  }
  return result;
}
