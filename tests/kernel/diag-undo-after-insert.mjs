/**
 * 诊断：为什么「Tab 加子节点 → Ctrl+Z」撤销不掉？
 *
 * 背景：`npm run live` 的真机验收里有三条红都指向同一个现象：
 *   `加子节点：7 → 8 → Ctrl+Z 后 8`（没回到 7），且 `撤销后焦点: mm-txt`。
 *
 * 读码得到的假设：
 *   `Tab` 是插件接管的动作（insertChild），**并且顺手把新节点带进编辑态**；
 *   而 `beginEdit` 里的按键处理器是
 *
 *       const onKey = (e) => { e.stopPropagation(); if (Enter) …; else if (Escape) … };
 *
 *   —— 所有按键都 `stopPropagation`，但 Ctrl+Z 没有 `preventDefault`。
 *   于是：插件自己的历史栈收不到（被拦在 txt 这一层），
 *   思源也收不到（事件没冒泡上去），Ctrl+Z 等于**空按**。
 *
 * 本探针用三组对照把假设钉死：
 *   A. Tab 之后直接 Ctrl+Z           → 期望：内核不变（复现）
 *   B. Tab 之后先 Esc 再 Ctrl+Z      → 期望：内核回到 Tab 之前（说明是编辑态挡的）
 *   C. 不按 Tab，直接选中节点 Ctrl+Z → 期望：能撤销（说明插件历史栈本身是好的）
 *
 * ⚠️ 本支是**诊断**，不设退出码：A 组「内核不变」是要记录的事实，不是失败。
 *
 * 用法：node tests/kernel/diag-undo-after-insert.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

const conf = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";

const api = async (p, payload) => {
    const res = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    return res.json();
};

const children = async (id) => {
    const j = await api("/api/block/getChildBlocks", { id });
    return j.code === 0 ? j.data : [];
};

/** 与真机断言同一套口径：只认「有段落子块」的列表项 */
async function itemShape(id, depth = 0, out = []) {
    for (const k of await children(id)) {
        if (k.type === "i") {
            const own = (await children(k.id)).find((c) => c.type === "p");
            if (own) out.push(`${depth}:${(own.content || "").trim()}`);
            await itemShape(k.id, depth + 1, out);
        } else {
            await itemShape(k.id, depth, out);
        }
    }
    return out;
}

const MD = ["- 根节点", "  - 甲", "  - 乙", ""].join("\n");

const created = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-撤销诊断-${Date.now()}`,
    markdown: MD,
});
if (created.code !== 0) {
    console.error("建文档失败:", JSON.stringify(created));
    process.exit(1);
}
const docId = created.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

const chrome = await launch({ headless: true, port: 9361, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图" });
    await sleep(2000);

    /** 按文本点节点。⚠️ 导图节点用 data-mm-id，不是 data-node-id（见 renderer.ts 的长注释） */
    const clickNodeText = async (text) => {
        const id = await page.eval(`(() => {
            const zw = /[\\u200B-\\u200D\\u2060\\uFEFF]/g;
            const hit = Array.from(document.querySelectorAll('.mm-root:not(.mm-root--dialog) .mm-node'))
                .find(n => ((n.querySelector('.mm-txt') || {}).textContent || '').replace(zw, '').trim() === ${JSON.stringify(text)});
            return hit ? hit.dataset.mmId : null;
        })()`);
        if (!id) return null;
        await page.click(`.mm-root:not(.mm-root--dialog) .mm-node[data-mm-id="${id}"]`);
        return id;
    };

    const focusOf = () =>
        page.eval(`(() => { const a = document.activeElement; return a ? (a.className || a.tagName) : 'none' })()`);
    const state = async () => ({ shape: await itemShape(listId), focus: await focusOf() });

    /* ---------------- A. Tab 之后直接 Ctrl+Z ---------------- */
    console.log("\n════ A. Tab 之后直接 Ctrl+Z（复现 live.mjs 那条红）");
    const a0 = await state();
    console.log("  操作前:", JSON.stringify(a0.shape), "焦点:", a0.focus);
    await clickNodeText("甲");
    await sleep(400);
    await page.press("Tab");
    await sleep(1500);
    const a1 = await state();
    console.log("  Tab 后:", JSON.stringify(a1.shape), "焦点:", a1.focus);
    await page.press("z", { ctrl: true });
    await sleep(1500);
    const a2 = await state();
    console.log("  Ctrl+Z 后:", JSON.stringify(a2.shape), "焦点:", a2.focus);
    console.log(`  → ${JSON.stringify(a2.shape) === JSON.stringify(a0.shape) ? "✔ 撤销成功" : "✘ 没撤销掉（内核仍多一项）"}`);
    console.log(`  → 焦点是否已离开编辑态(mm-txt): ${/mm-root/.test(String(a2.focus)) ? "是" : "否（仍在 " + a2.focus + "）"}`);

    /* ---------------- B. 先 Esc 退出编辑态，再 Ctrl+Z ---------------- */
    console.log("\n════ B. 在同一状态上先 Esc 再 Ctrl+Z");
    await page.press("Escape");
    await sleep(600);
    const b0 = await state();
    console.log("  Esc 后:", JSON.stringify(b0.shape), "焦点:", b0.focus);
    await page.press("z", { ctrl: true });
    await sleep(1600);
    const b1 = await state();
    console.log("  Ctrl+Z 后:", JSON.stringify(b1.shape), "焦点:", b1.focus);
    console.log(
        `  → ${JSON.stringify(b1.shape) === JSON.stringify(a0.shape) ? "✔ 撤销成功 —— 说明挡住它的确实是「编辑态」" : "✘ 仍未回到操作前"}`,
    );

    /* ---------------- C. 无编辑态插入：先 Esc 保证不在编辑态，再插入 ---------------- */
    console.log("\n════ C. 对照：不在编辑态时插入，Ctrl+Z 能否撤销");
    // 回到一个干净起点：再插一个（若上一步没撤销成功，这里仍能看出 Ctrl+Z 是否有效）
    const c0 = await state();
    console.log("  起点:", JSON.stringify(c0.shape), "焦点:", c0.focus);
    await clickNodeText("乙");
    await sleep(400);
    await page.press("Tab");
    await sleep(1500);
    const c1 = await state();
    console.log("  Tab 后:", JSON.stringify(c1.shape), "焦点:", c1.focus);
    // 关键：先退出编辑态，再撤销
    await page.press("Escape");
    await sleep(600);
    await page.press("z", { ctrl: true });
    await sleep(1600);
    const c2 = await state();
    console.log("  Esc + Ctrl+Z 后:", JSON.stringify(c2.shape), "焦点:", c2.focus);
    console.log(
        `  → ${JSON.stringify(c2.shape) === JSON.stringify(c0.shape) ? "✔ 撤销成功（插件历史栈本身是好的）" : "✘ 仍未撤销 —— 问题不在编辑态"}`,
    );

    console.log("\n════ 结论");
    console.log("  A 组若「没撤销掉」且 B/C 组「撤销成功」，则确认：");
    console.log("  挡住 Ctrl+Z 的是编辑态里那句 stopPropagation（Ctrl+Z 既没被插件接、也没冒泡给思源）。");
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("\n已清理临时文档");
}
