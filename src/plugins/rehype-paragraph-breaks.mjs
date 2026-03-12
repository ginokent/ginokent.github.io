// 連続する <p> 要素の間に <br> を挿入し、空行を視覚的な改行としてレンダリングする
export default function rehypeParagraphBreaks() {
  return (tree) => {
    if (!tree.children) return;

    const newChildren = [];
    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i];
      newChildren.push(node);

      // 現在のノードが <p> で、次の要素ノードも <p> なら間に <br> を挿入
      if (node.type === 'element' && node.tagName === 'p') {
        // 次の要素ノードを探す（テキストノード等をスキップ）
        let next = null;
        for (let j = i + 1; j < tree.children.length; j++) {
          if (tree.children[j].type === 'element') {
            next = tree.children[j];
            break;
          }
        }
        if (next && next.tagName === 'p') {
          newChildren.push({ type: 'element', tagName: 'br', properties: {}, children: [] });
        }
      }
    }

    tree.children = newChildren;
  };
}
