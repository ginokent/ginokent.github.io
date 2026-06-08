import type { ActorToken, BlockBranch, BlockToken, BlockType, MessageToken, NoteToken, SourceRange } from "../types";

// ソースモデル層 (シーケンス図)
//
// 行指向で走査し、編集可能な要素のテキスト範囲を算出する。
//   - アクター宣言:  participant A as Alice / actor A as Bob  → 表示名を編集
//   - メッセージ:    A->>+B: text  → 本文・矢印種別・起動/終了を編集
//   - ノート:        Note over A,B: text          → 本文を編集
//   - 制御ブロック:  loop/alt/opt/par <label>     → ラベルを編集
// 正規表現の d フラグ (hasIndices) で各グループの絶対範囲を得る。

// participant/actor <id> as <display>
const ACTOR_RE = /^(\s*)(?:participant|actor)\s+(\w+)\s+as\s+(.+?)\s*$/d;
// <from> <arrow> [+-]? <to> : <text>   (arrow = -/-- + >|>>|x|) )
const MESSAGE_RE = /^(\s*)(\w+)\s*(--?(?:>>?|x|\)))\s*([+-]?)(\w+)\s*:\s*(.+?)\s*$/d;
// Note over A[,B] : text  /  Note (right|left) of A : text
// group2 = 配置句 (over A,B / right of A 等)、group3 = 本文
const NOTE_RE = /^(\s*)[Nn]ote\s+(over\s+\w+(?:\s*,\s*\w+)?|(?:right|left)\s+of\s+\w+)\s*:\s*(.+?)\s*$/d;
// 制御ブロック: ヘッダ (loop/alt/opt/par [label]) / 分岐 (else/and [label]) / end。
// ラベルは省略可。キーワード直後の空白を [ \t]+ で要求し、message (loop->>B 等) との誤認を避ける
const BLOCK_HEAD_RE = /^(\s*)(loop|alt|opt|par)(?:[ \t]+(.+?))?[ \t]*$/d;
const BLOCK_BRANCH_RE = /^(\s*)(else|and)(?:[ \t]+(.+?))?[ \t]*$/d;
const BLOCK_END_RE = /^[ \t]*end[ \t]*$/;

export interface SequenceTokens {
  actors: ActorToken[];
  messages: MessageToken[];
  notes: NoteToken[];
  blocks: BlockToken[];
}

interface RawActor {
  id: string;
  display: string;
  displayRange: SourceRange;
  lineRange: SourceRange;
}
interface RawMessage {
  text: string;
  textRange: SourceRange;
  fromRange: SourceRange;
  toRange: SourceRange;
  arrowRange: SourceRange;
  activationRange: SourceRange;
  lineRange: SourceRange;
  fromId: string;
  toId: string;
}

export function tokenizeSequence(text: string): SequenceTokens {
  const rawActors: RawActor[] = [];
  const rawMessages: RawMessage[] = [];
  const notes: NoteToken[] = [];
  const blocks: BlockToken[] = [];

  // 制御ブロックはネストし得るのでスタックで対応付ける。end で閉じた時点で確定する
  const blockStack: Omit<BlockToken, "endLineRange">[] = [];

  let offset = 0;
  for (const line of text.split("\n")) {
    const base = offset;
    offset += line.length + 1; // 改行分
    const lineRange: SourceRange = { start: base, end: base + line.length };

    const actor = ACTOR_RE.exec(line);
    if (actor?.indices) {
      const [start, end] = actor.indices[3]!; // 表示名グループ
      rawActors.push({ id: actor[2], display: actor[3], displayRange: abs(base, start, end), lineRange });
      continue;
    }

    const note = NOTE_RE.exec(line);
    if (note?.indices) {
      const p = note.indices[2]!; // 配置句
      const t = note.indices[3]!; // 本文
      notes.push({
        text: note[3],
        textRange: abs(base, t[0], t[1]),
        placementRange: abs(base, p[0], p[1]),
        removeLines: [lineRange],
      });
      continue;
    }

    const head = BLOCK_HEAD_RE.exec(line);
    if (head?.indices) {
      const kw = head.indices[2]!;
      const labelIdx = head.indices[3]; // ラベルは省略可
      blockStack.push({
        type: head[2] as BlockType,
        keywordRange: abs(base, kw[0], kw[1]),
        label: head[3] ?? "",
        labelRange: labelIdx ? abs(base, labelIdx[0], labelIdx[1]) : abs(base, kw[1], kw[1]),
        headerLineRange: lineRange,
        branches: [],
      });
      continue;
    }

    const branch = BLOCK_BRANCH_RE.exec(line);
    if (branch?.indices) {
      const top = blockStack[blockStack.length - 1];
      if (top) {
        const kw = branch.indices[2]!;
        const labelIdx = branch.indices[3];
        const b: BlockBranch = {
          keyword: branch[2] as "else" | "and",
          keywordRange: abs(base, kw[0], kw[1]),
          label: branch[3] ?? "",
          labelRange: labelIdx ? abs(base, labelIdx[0], labelIdx[1]) : abs(base, kw[1], kw[1]),
          lineRange,
        };
        top.branches.push(b);
      }
      continue;
    }

    if (BLOCK_END_RE.test(line)) {
      const top = blockStack.pop();
      if (top) blocks.push({ ...top, endLineRange: lineRange });
      continue;
    }

    const msg = MESSAGE_RE.exec(line);
    if (msg?.indices) {
      const fromIdx = msg.indices[2]!;
      const arrow = msg.indices[3]!;
      const activation = msg.indices[4]!; // [+-]? 空幅の場合もある
      const toIdx = msg.indices[5]!;
      const body = msg.indices[6]!;
      rawMessages.push({
        text: msg[6],
        textRange: abs(base, body[0], body[1]),
        fromRange: abs(base, fromIdx[0], fromIdx[1]),
        toRange: abs(base, toIdx[0], toIdx[1]),
        arrowRange: abs(base, arrow[0], arrow[1]),
        activationRange: abs(base, activation[0], activation[1]),
        lineRange,
        fromId: msg[2],
        toId: msg[5],
      });
    }
  }

  // アクター削除は参照メッセージ行も巻き込む (カスケード)
  const actors: ActorToken[] = rawActors.map((a) => ({
    id: a.id,
    display: a.display,
    displayRange: a.displayRange,
    removeLines: uniqueByStart([
      a.lineRange,
      ...rawMessages.filter((m) => m.fromId === a.id || m.toId === a.id).map((m) => m.lineRange),
    ]),
  }));
  const messages: MessageToken[] = rawMessages.map((m) => ({
    text: m.text,
    textRange: m.textRange,
    fromRange: m.fromRange,
    toRange: m.toRange,
    arrowRange: m.arrowRange,
    activationRange: m.activationRange,
    removeLines: [m.lineRange],
  }));

  // end で閉じた順 (内側が先) で積まれるため、ヘッダ出現順 = loopText の描画順に整列する
  blocks.sort((a, b) => a.headerLineRange.start - b.headerLineRange.start);

  return { actors, messages, notes, blocks };
}

function uniqueByStart(ranges: SourceRange[]): SourceRange[] {
  const byStart = new Map<number, SourceRange>();
  for (const r of ranges) if (!byStart.has(r.start)) byStart.set(r.start, r);
  return [...byStart.values()];
}

/** 行内オフセットを絶対オフセットへ変換する */
function abs(base: number, start: number, end: number): SourceRange {
  return { start: base + start, end: base + end };
}
