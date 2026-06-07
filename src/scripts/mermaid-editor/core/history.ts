// 編集履歴 (undo/redo) を管理する純粋なスタック
//
// テキスト状態の線形履歴を index で指す。新たな状態を push すると
// 現在位置より後ろ (redo 分) は破棄され、新しい分岐になる。

export class History {
  private stack: string[] = [];
  private index = -1;

  /** 初期状態を設定して履歴をリセットする */
  reset(initial: string): void {
    this.stack = [initial];
    this.index = 0;
  }

  /** 現在の状態 */
  get current(): string {
    return this.stack[this.index];
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  /**
   * 新しい状態を積む。現在と同一なら何もしない。
   * 現在位置より後ろの redo 履歴は破棄する。
   */
  push(state: string): void {
    if (this.index >= 0 && this.stack[this.index] === state) return;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(state);
    this.index = this.stack.length - 1;
  }

  /** 1 つ戻る。戻れない場合は null */
  undo(): string | null {
    if (!this.canUndo) return null;
    this.index--;
    return this.current;
  }

  /** 1 つ進む。進めない場合は null */
  redo(): string | null {
    if (!this.canRedo) return null;
    this.index++;
    return this.current;
  }
}
