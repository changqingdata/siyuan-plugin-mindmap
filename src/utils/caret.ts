/**
 * 光标落点的公共处理。
 *
 * 这个文件存在的唯一理由是一条 Blink 行为（2026-10-02 实测确认）：
 *
 *   **在 contenteditable 里，把光标设在「某个行内元素之后的那个边界」上，
 *   浏览器会把它归一化到那个元素**内部**。**
 *
 * 症状：节点末尾正好是一个双链（或链接 / 行内代码 / 图片）时，用户双击进编辑态、
 * 在末尾接着敲字，那些字会变成**双链的锚文本** —— kramdown 从
 * `…((id "锚文本"))` 变成 `…((id "锚文本补充"))`。用户看到的光标位置和打出来的字
 * 都在「末尾」，看不出任何异常，但语义已经变了。
 *
 * 六种落法并排实测（`place` → 打字 → 读回 innerHTML），只有最后一种把字打在元素外面：
 *
 *   | 落法 | 结果 |
 *   | --- | --- |
 *   | `setStart(txt, childNodes.length)` | ❌ 钻进元素内部 |
 *   | `setStartAfter(txt.lastChild)` | ❌ 钻进元素内部 |
 *   | `selectNodeContents` + `collapse(false)` | ❌ 钻进元素内部 |
 *   | 末尾补一个**空**文本节点，光标 `(空节点, 0)` | ❌ 空文本节点被丢弃，仍钻进元素 |
 *   | 末尾补一个 `<br>`，光标在它之前 | ❌ 钻进元素内部 |
 *   | 末尾补一个**零宽空格**文本节点，光标 `(它, 1)` | ✅ 打在元素外面 |
 *
 * 所以「末尾」一律要**先补一个零宽空格**（`CARET_PAD`），再把光标落在它之后。
 * 那个零宽空格不会落库：写回前的 `prepareInlineForWrite` 会剥掉所有零宽字符，
 * 「有没有改动」的基准线也是过同一个函数算的，所以它既不会污染笔记，也不会造成假提交。
 *
 * 另外，本文件也是**零宽字符的唯一出处**（`ZERO_WIDTH` / `stripZeroWidth`）——
 * 解析层（`core/parser.ts`）与编辑层（`core/inline-assistant.ts`）都要用同一份定义，
 * 免得两边各写一个正则、哪天漏掉一个码位。
 */

/**
 * 零宽字符集合。
 *
 * Protyle 会往块内容里塞 U+200B（零宽空格）。它**不在** ECMAScript 的
 * WhiteSpace 集合里，所以 `trim()` 去不掉 —— 实测每个节点的 textContent
 * 末尾都挂着一个，肉眼和普通字符串比较都看不出来。
 *
 * 留着它的代价：`node.text` 会带着它进 `serializeSubtree`，于是「复制节点」
 * 和「降级副本路径」会把不可见字符写回内核；搜索匹配、导出文本、
 * 重命名时的等值比较也都会被它干扰。所以解析那一层就清掉。
 */
export const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

/**
 * 零宽空格。
 *
 * 选它当光标垫片是因为它**不可见、零宽、且不是 ECMAScript 的 WhiteSpace**
 * （`trim()` 去不掉它，所以不会被浏览器的空白归一化顺手删掉）——
 * 换成普通空格会多出一个字宽、换成空文本节点会被直接丢弃（都实测过）。
 */
export const CARET_PAD = "\u200B";

/** 把选区设成给定 range（选区 API 失败不影响编辑本身，所以吞掉异常） */
function setSelection(range: Range) {
    try {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    } catch {
        /* 选区失败不影响编辑本身 */
    }
}

/**
 * 把「从 `from` 往后一直到底」的空文本节点全部删掉。
 *
 * 为什么必须删：`Range.insertNode()` 收尾会在插入的片段之后留下一个**空的文本节点**
 * （实测 `childNodes` = `[文本, SPAN, 空文本]`）。空文本节点本身无害，
 * 但 Chrome 在编辑态会把它丢掉 —— 于是「元素之后」这个位置又退化成会被归一化
 * 进元素内部的边界，垫片也就白补了。判「是不是最后一个子节点」之前必须先清掉它们。
 */
function dropEmptyTail(from: Node | null): void {
    let tail = from;
    while (tail && tail.nodeType === Node.TEXT_NODE && !tail.textContent) {
        const next = tail.nextSibling;
        tail.parentNode?.removeChild(tail);
        tail = next;
    }
}

/**
 * 光标落到 `container` 的末尾。
 *
 * 末尾是**元素**时先补零宽空格再落光标（见文件头）；末尾是文本节点时直接落在
 * 那个文本节点的末尾 —— 那是一个真实的文本位置，不存在归一化问题。
 */
export function caretToEnd(container: HTMLElement) {
    dropEmptyTail(container.lastChild);
    let tail = container.lastChild;
    if (tail && tail.nodeType !== Node.TEXT_NODE) {
        const pad = document.createTextNode(CARET_PAD);
        container.appendChild(pad);
        tail = pad;
    }
    const range = document.createRange();
    if (tail && tail.nodeType === Node.TEXT_NODE) {
        range.setStart(tail, (tail.textContent ?? "").length);
    } else {
        range.setStart(container, container.childNodes.length);
    }
    range.collapse(true);
    setSelection(range);
}

/**
 * 光标落到 `node` **之后**。
 *
 * 两种「会被归一化进元素内部」的边界都要挡住：
 * ① `node` 之后只剩空的文本节点（`Range.insertNode` 留下的），要先把它们清掉；
 * ② 清完之后 `node` 就是最后一个子节点、且本身是元素 —— 补零宽空格再落光标。
 */
export function caretAfterNode(node: Node) {
    const parent = node.parentNode;
    if (!parent) return;
    dropEmptyTail(node.nextSibling);
    const range = document.createRange();
    if (!node.nextSibling) {
        const pad = document.createTextNode(CARET_PAD);
        parent.appendChild(pad);
        range.setStart(pad, CARET_PAD.length);
    } else {
        range.setStartAfter(node);
    }
    range.collapse(true);
    setSelection(range);
}

/** 光标前的文本是否「只有零宽字符 / 空白」—— 判「这段选区值不值得给工具条」用 */
export function isBlankText(s: string): boolean {
    return stripZeroWidth(s).trim() === "";
}

/** 剥掉零宽字符：触发串识别、取词、选区判空都必须先过这一道 */
export function stripZeroWidth(s: string): string {
    return s.replace(ZERO_WIDTH, "");
}
