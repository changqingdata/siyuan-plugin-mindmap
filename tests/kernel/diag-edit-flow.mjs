/**
 * 编辑生命周期的端到端验证。
 *
 * 只断言「editing=true」是不够的 —— 那只能说明类名还在。
 * 这里把用户真正会做的一串动作全走一遍，并且**核对内核**：
 *
 *   1. 双击           → 进入编辑态、文字全选
 *   2. 单击正文       → 仍在编辑态（用户反馈 2 的修复点）
 *   3. 打字           → 文字真的被替换（证明 caret 在、选区可写）
 *   4. 回车           → 退出编辑态，且**内核里的块内容确实改了**
 *   5. 双击 → Esc     → 退出编辑态，且**内核内容不变**（放弃修改）
 *   6. 双击 → 点节点外 → 退出编辑态并提交
 *
 * 用法：node tests/kernel/diag-edit-flow.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";

async function api(p, payload) {
    const res = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    return res.json();
}
const children = async (id) => {
    const j = await api("/api/block/getChildBlocks", { id });
    return j.code === 0 ? j.data : [];
};

const OUT = "tests/.build";
fs.mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- 造数据 */
// 刻意用「纯文本节点」：含行内格式的节点会走「回源编辑」分支，那是另一条链路
const md = [
    "- 编辑流程验证 · 大纲导图",
    "  - 分支甲 · 主题文字",
    "    - 待改条目：这是原始内容",
    "    - 另一条目：保持不动",
    "  - 分支乙 · 主题文字",
    "    - 第三条：同样保持不动",
    "",
];
const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-编辑流程-${Date.now()}`,
    markdown: md.join("\n"),
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });
console.log(`文档 ${docId} · 列表 ${listId}\n`);

/**
 * 读内核里那个列表的纯文本，用来核对提交是否真的落地。
 *
 * ⚠️ 块树有三层：列表块(l) → 列表项(i) → 段落(p) + 子列表(l)。
 * 只认 p 和 l 会在 i 这一层断掉，得到空数组 —— 第一版就是这么误报的。
 * 段落文字只在 p 上，所以一路下钻到 p 为止。
 */
const kernelText = async () => {
    const out = [];
    const walk = async (id) => {
        const kids = await children(id);
        for (const k of kids) {
            if (k.type === "p") out.push((k.content ?? "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, ""));
            else if (k.type === "i" || k.type === "l") await walk(k.id);
        }
    };
    await walk(listId);
    return out;
};

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? "✓" : "✗"} ${name}  ${detail}`);
};

/* ---------------------------------------------------------------- 页面探针 */
const NODE_POS = (needle) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return null;
    root.scrollIntoView({ block: 'center' });
    const el = [...root.querySelectorAll('.mm-node')].find((e) =>
        e.style.visibility !== 'hidden' && ((e.querySelector('.mm-txt') || {}).textContent || '').includes(${JSON.stringify(needle)}));
    if (!el) return null;
    const t = el.querySelector('.mm-txt');
    const r = t.getBoundingClientRect();
    const nr = el.getBoundingClientRect();
    return {
        tx: Math.round(r.left + r.width / 2), ty: Math.round(r.top + r.height / 2),
        // 节点左上角往里 3px：避开正文，落在节点自身的 padding 上
        ex: Math.round(nr.left + 3), ey: Math.round(nr.top + 3),
        text: t.textContent.trim().slice(0, 20),
    };
})()`;

const EDIT_STATE = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    const ed = root && root.querySelector('.mm-node[data-mm-editing]');
    const txt = ed && ed.querySelector('.mm-txt');
    return {
        editing: !!ed,
        editable: txt ? txt.getAttribute('contenteditable') : null,
        text: txt ? (txt.textContent || '').trim().slice(0, 30) : null,
        active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName).toString().slice(0, 30) : null,
        sel: window.getSelection ? window.getSelection().toString().slice(0, 30) : '',
    };
})()`;

const chrome = await launch({ headless: true, port: 9349, width: 1680, height: 1050, dpr: 1 });

const tap = async (page, x, y, clickCount = 1) => {
    await page.mouse("mouseMoved", x, y, { buttons: 0 });
    await page.mouse("mousePressed", x, y, { button: "left", clickCount });
    await page.mouse("mouseReleased", x, y, { button: "left", clickCount });
};

const dbl = async (page, x, y) => {
    await page.mouse("mouseMoved", x, y, { buttons: 0 });
    for (const cc of [1, 2]) await tap(page, x, y, cc);
};

try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图" });
    await sleep(1800);

    const before = await kernelText();
    console.log("内核初始:", JSON.stringify(before), "\n");

    /* ---- 1. 双击进入编辑 ---- */
    let pos = await page.eval(NODE_POS("待改条目"));
    if (!pos) throw new Error("找不到「待改条目」节点");
    await dbl(page, pos.tx, pos.ty);
    await sleep(500);
    let s = await page.eval(EDIT_STATE);
    check("双击进入编辑态", s.editing && s.editable === "true", `editing=${s.editing} editable=${s.editable} active=${s.active}`);
    check("进入编辑即全选", s.sel.includes("原始内容"), `选中「${s.sel}」`);

    /* ---- 2. 单击正文：不能退出 ---- */
    await tap(page, pos.tx, pos.ty);
    await sleep(400);
    s = await page.eval(EDIT_STATE);
    check("单击正文不退出编辑态", s.editing, `editing=${s.editing} active=${s.active}`);

    /* ---- 3. 打字：真的能改 ---- */
    await page.type("改好了");
    await sleep(400);
    s = await page.eval(EDIT_STATE);
    check("可以正常打字修改", (s.text || "").includes("改好了"), `当前文本「${s.text}」`);

    /* ---- 4. 回车提交 ---- */
    await page.press("Enter");
    await sleep(1200);
    s = await page.eval(EDIT_STATE);
    check("回车退出编辑态", !s.editing, `editing=${s.editing}`);
    let after = await kernelText();
    const committed = after.some((t) => t.includes("改好了"));
    check("回车提交写回内核", committed, JSON.stringify(after));

    /* ---- 5. 双击 → Esc：放弃修改 ---- */
    pos = await page.eval(NODE_POS("改好了"));
    await dbl(page, pos.tx, pos.ty);
    await sleep(500);
    s = await page.eval(EDIT_STATE);
    const entered = s.editing;
    await page.type("不要这个");
    await sleep(300);
    await page.press("Escape");
    await sleep(1000);
    s = await page.eval(EDIT_STATE);
    after = await kernelText();
    check(
        "Esc 放弃修改且内核不变",
        entered && !s.editing && after.some((t) => t.includes("改好了")) && !after.some((t) => t.includes("不要这个")),
        `editing=${s.editing} 内核=${JSON.stringify(after)}`,
    );

    /* ---- 6. 双击 → 点节点自身 padding：不能退出（用户反馈 2 的另一种点法） ---- */
    pos = await page.eval(NODE_POS("改好了"));
    await dbl(page, pos.tx, pos.ty);
    await sleep(500);
    await tap(page, pos.ex, pos.ey);
    await sleep(400);
    s = await page.eval(EDIT_STATE);
    check("点节点自身边角不退出编辑态", s.editing, `editing=${s.editing} active=${s.active}`);

    /* ---- 7. 点节点外面：应当退出并提交 ---- */
    const outside = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        const vp = root.querySelector('.mm-viewport');
        const r = vp.getBoundingClientRect();
        // 视口右下角，保证不落在任何节点上
        return { x: Math.round(r.right - 12), y: Math.round(r.bottom - 12) };
    })()`);
    await tap(page, outside.x, outside.y);
    await sleep(1000);
    s = await page.eval(EDIT_STATE);
    check("点节点外面退出编辑态", !s.editing, `editing=${s.editing}`);

    /* ---- 8. 编辑期间插入节点，退出编辑后必须出现 ----
       render() 在编辑态下会被挡掉（不能重建 DOM，否则打断输入）。
       挡掉之后如果没人补做，编辑期间插进去的节点就**永远不显示**。 */
    pos = await page.eval(NODE_POS("改好了"));
    await dbl(page, pos.tx, pos.ty);
    await sleep(500);
    s = await page.eval(EDIT_STATE);
    const editingNow = s.editing;

    const countBefore = await page.eval(
        `document.querySelectorAll('.mm-root:not(.mm-root--dialog):not(.mm-root--side) .mm-node').length`,
    );
    const addBtn = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        const b = root && root.querySelector('.mm-node[data-mm-editing] .mm-acts button');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        if (r.width < 1) return null;   // 操作条还没显示出来
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (editingNow && addBtn) {
        await tap(page, addBtn.x, addBtn.y);
        await sleep(2800); // 内核写回 + 扫描（此时 render 被编辑态挡下）
        const midCount = await page.eval(
            `document.querySelectorAll('.mm-root:not(.mm-root--dialog):not(.mm-root--side) .mm-node').length`,
        );
        const stillEditing = (await page.eval(EDIT_STATE)).editing;
        await page.press("Escape");
        await sleep(1200);
        const afterCount = await page.eval(
            `document.querySelectorAll('.mm-root:not(.mm-root--dialog):not(.mm-root--side) .mm-node').length`,
        );
        check(
            "编辑期间插入的节点在退出编辑后出现",
            afterCount === countBefore + 1,
            `插入前 ${countBefore} → 编辑中 ${midCount} → 退出编辑后 ${afterCount}（期望 ${countBefore + 1}）`,
        );
        check("插入子节点不会打断正在进行的编辑", stillEditing, `stillEditing=${stillEditing}`);
    } else {
        check("编辑期间插入的节点在退出编辑后出现", false, `找不到「+」按钮（editing=${editingNow}）`);
        check("插入子节点不会打断正在进行的编辑", false, "同上");
        await page.press("Escape");
        await sleep(600);
    }

    await page.screenshot(`${OUT}/ef-final.png`);

    const pass = results.filter((r) => r.ok).length;
    console.log(`\n${pass}/${results.length} 项通过`);
    // ⚠️ 必须把失败**传出去**。`ux:all` 是用 `&&` 串起来的，脚本只要 exit 0，
    //    链子就继续往下走 —— 这 13 条断言红了也没人知道（本支原先就是这个问题）。
    // ⚠️ 用 `process.exitCode` 而不是 `process.exit()`：后者会**跳过 finally**，
    //    `chrome.close()` 与 `removeDoc()` 都不执行，临时文档就留在用户工作空间里了。
    if (pass !== results.length) process.exitCode = 1;
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}
