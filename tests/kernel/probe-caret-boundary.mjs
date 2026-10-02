/**
 * 光标边界探针：**「元素之后的边界」会被 Blink 归一化进元素内部**。
 *
 * ## 为什么需要它
 *
 * 导图节点末尾正好是一个双链 / 链接 / 行内代码 / 图片时，用户在末尾接着敲字，
 * 那些字会变成**那个元素的内部文本**（双链的锚文本、链接的显示文字）——
 * kramdown 从 `…((id "锚文本"))` 变成 `…((id "锚文本补充"))`。
 * 光标位置和打出来的字看起来都在「末尾」，界面上没有任何异常，但语义已经变了。
 *
 * 所以「把光标落到末尾」这件事**不能**用 `setStart(txt, childNodes.length)` /
 * `setStartAfter(lastChild)` / `selectNodeContents + collapse(false)` 里的任何一个，
 * 必须**先补一个零宽空格文本节点、再把光标落在它之后**。
 *
 * 本探针把这个结论钉成断言：不依赖思源内核，只起一个无头 Chrome 跑 `data:` 页面，
 * 几秒就能跑完。改 `src/utils/caret.ts` 之后请务必重跑一次。
 *
 * ## 两个「探针自己踩过的坑」（别改回去）
 *
 *  1. **页面源码是外层模板串的一部分**：页面侧代码的注释里**不能出现反引号**，
 *     否则会把外层模板串提前闭合，报 `Unexpected identifier`。
 *     页面侧也不要写 `${…}`，那会被外层插值掉。用字符串拼接。
 *  2. **`Node` 上没有 `remove()`**（TS 的 DOM 类型里它属于 `ChildNode`），
 *     复刻插件逻辑时要用 `parentNode.removeChild(node)`。
 *
 * 用法：node tests/kernel/probe-caret-boundary.mjs
 */
import { launch } from "../cdp.mjs";

/* ---------------------------------------------------------------- 页面 */

const PAGE = `<!doctype html><meta charset="utf-8">
<style>#e{border:1px solid #999;padding:8px;font:16px/1.6 sans-serif;width:420px}</style>
<div id="e" contenteditable="true"></div>
<script>
const REF = '<span data-type="block-ref" data-id="x">锚文本</span>';
const RICH = '甲一 · <span data-type="strong">粗体</span>与双链并存' + REF;

window.reset = () => { document.getElementById('e').innerHTML = RICH; };

/** 把光标按指定写法落到末尾，返回落点的实际位置 */
window.place = (mode) => {
    const e = document.getElementById('e');
    e.focus();
    const r = document.createRange();
    if (mode === 'element-end') {
        r.setStart(e, e.childNodes.length);
    } else if (mode === 'after-last') {
        r.setStartAfter(e.lastChild);
    } else if (mode === 'select-collapse') {
        r.selectNodeContents(e);
        r.collapse(false);
    } else if (mode === 'empty-text') {
        e.appendChild(document.createTextNode(''));
        r.setStart(e.lastChild, 0);
    } else if (mode === 'br-before') {
        e.appendChild(document.createElement('br'));
        r.setStart(e, e.childNodes.length - 1);
    } else if (mode === 'zwsp-before') {
        e.appendChild(document.createTextNode('\\u200B'));
        r.setStart(e.lastChild, 0);
    } else if (mode === 'zwsp-after') {
        e.appendChild(document.createTextNode('\\u200B'));
        r.setStart(e.lastChild, 1);
    }
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    const n = s.anchorNode;
    return { anchor: n.nodeType === 3 ? 'text' : n.tagName, offset: s.anchorOffset };
};

/** 复刻插件的 replaceRange + caretAfterNode */
window.insertAndCaret = (padEnabled) => {
    const e = document.getElementById('e');
    e.innerHTML = '丁一 · 前缀[[画布';
    e.focus();
    const t = e.firstChild;
    const caret = document.createRange();
    caret.setStart(t, t.textContent.length);
    caret.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(caret);

    // 触发串范围 = 光标往前 4 个字符（「[[画布」）
    const trigger = document.createRange();
    trigger.setStart(t, t.textContent.length - 4);
    trigger.setEnd(t, t.textContent.length);

    const frag = trigger.createContextualFragment('<span data-type="block-ref" data-id="x">目标块</span>');
    const last = frag.lastChild;
    trigger.deleteContents();
    trigger.insertNode(frag);

    const before = Array.from(e.childNodes).map((n) => (n.nodeType === 3 ? 'text:' + JSON.stringify(n.textContent) : n.tagName));
    // ⚠️ 这个必须在清理**之前**取 —— 清理之后 lastChild 已经变成垫片了
    const rawLastChild = e.lastChild && e.lastChild.nodeType === 3 ? 'text:' + JSON.stringify(e.lastChild.textContent) : (e.lastChild && e.lastChild.tagName);

    // 修好之后的写法：先清掉插入点之后的空文本节点，再看是不是真的在末尾
    let tail = last.nextSibling;
    while (tail && tail.nodeType === 3 && !tail.textContent) {
        const next = tail.nextSibling;
        tail.parentNode.removeChild(tail);
        tail = next;
    }
    const after = document.createRange();
    if (padEnabled && !last.nextSibling) {
        const pad = document.createTextNode('\\u200B');
        last.parentNode.appendChild(pad);
        after.setStart(pad, 1);
    } else {
        after.setStartAfter(last);
    }
    after.collapse(true);
    s.removeAllRanges(); s.addRange(after);

    return {
        lastIsElement: last.nodeType === 1,
        rawLastChild: rawLastChild,
        childNodesBefore: before,
        childNodesAfter: Array.from(e.childNodes).map((n) => (n.nodeType === 3 ? 'text:' + JSON.stringify(n.textContent) : n.tagName)),
    };
};

window.read = () => document.getElementById('e').innerHTML;
</script>`;

/* ---------------------------------------------------------------- 断言 */

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
    if (ok) {
        passed++;
        console.log(`✓ ${name}${detail ? "  " + detail : ""}`);
    } else {
        failures.push(name);
        console.log(`✗ ${name}  ${detail}`);
    }
}

/** 真按键：与插件探针同一条路径（`Input.dispatchKeyEvent` + `text`） */
const typeChar = async (page, ch) => {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch, unmodifiedText: ch });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await new Promise((r) => setTimeout(r, 120));
};

const chrome = await launch({ headless: true, port: 9377, width: 900, height: 420, dpr: 1 });

try {
    const page = await chrome.newPage("data:text/html;charset=utf-8," + encodeURIComponent(PAGE));
    await new Promise((r) => setTimeout(r, 400));

    /* ---------------------------------------------- 一、末尾是行内元素时的七种落法 */
    console.log("\n[一] 末尾是双链（行内元素）时，七种「落到末尾」的写法");

    // 前六种都会把字打进双链内部 —— 这条断言是**反向**的：
    // 它们红才是对的（真绿说明 Blink 改了行为，该重新评估 care.ts 的写法）
    for (const mode of ["element-end", "after-last", "select-collapse", "empty-text", "br-before", "zwsp-before"]) {
        await page.eval(`window.reset()`);
        const at = await page.eval(`JSON.stringify(window.place(${JSON.stringify(mode)}))`);
        await typeChar(page, "补");
        const html = await page.eval(`window.read()`);
        check(
            `一.${mode} 确实会钻进元素内部（反证：这条绿了说明 Blink 改了行为）`,
            /锚文本补/.test(html),
            `落点=${at} html=${html.slice(-46)}`,
        );
    }

    // 唯一正确的那种
    await page.eval(`window.reset()`);
    const at = await page.eval(`JSON.stringify(window.place("zwsp-after"))`);
    await typeChar(page, "补");
    const html = await page.eval(`window.read()`);
    check("一.zwsp-after 字打在元素**外面**（补零宽空格 + 光标落在它之后）", !/锚文本补/.test(html), `落点=${at}`);
    check("一.zwsp-after 追加的字确实留在节点里", /<\/span>\u200B补$/.test(html), `html 尾部=${JSON.stringify(html.slice(-24))}`);

    /* ---------------------------------------------- 二、插入路径（Range.insertNode） */
    console.log("\n[二] 插入元素之后落光标：`Range.insertNode` 会留一个空文本节点");

    await page.eval(`window.reset()`);
    const noPad = JSON.parse(await page.eval(`JSON.stringify(window.insertAndCaret(false))`));
    await typeChar(page, "尾");
    const bad = await page.eval(`window.read()`);
    check(
        "二.1 直接 setStartAfter 会把字打进刚插入的双链里（反证）",
        /目标块尾/.test(bad),
        `html=${bad.slice(-46)}`,
    );
    check(
        "二.2 `insertNode` 收尾确实留下一个空文本节点（所以「是不是 lastChild」的判据会失手）",
        noPad.childNodesBefore.length === 3 && noPad.rawLastChild === 'text:""',
        `childNodes=${JSON.stringify(noPad.childNodesBefore)}`,
    );

    await page.eval(`window.reset()`);
    const padded = JSON.parse(await page.eval(`JSON.stringify(window.insertAndCaret(true))`));
    await typeChar(page, "尾");
    const good = await page.eval(`window.read()`);
    check("二.3 清掉空尾节点 + 补零宽空格之后，字落在双链外面", !/目标块尾/.test(good), `html=${good.slice(-46)}`);
    check(
        "二.4 垫片在 DOM 里、紧跟在双链之后",
        JSON.stringify(padded.childNodesAfter) === JSON.stringify(['text:"丁一 · 前缀"', "SPAN", 'text:"' + "\u200B" + '"']),
        `childNodes=${JSON.stringify(padded.childNodesAfter)}`,
    );
} finally {
    await chrome.close();
}

console.log("");
if (failures.length === 0) {
    console.log(`[probe-caret-boundary] 全部通过 ✓  共 ${passed} 项断言`);
    process.exit(0);
}
console.log(`[probe-caret-boundary] ${passed}/${passed + failures.length} 项断言通过`);
for (const f of failures) console.log(`   ✗ ${f}`);
process.exit(1);
