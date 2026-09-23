/**
 * 只读探针：把待办节点在导图里的真实 DOM 结构 dump 出来。
 *
 * 起因：`diag-task-check.mjs` 里 `aria-checked` 读得到、`aria-label` 却是 undefined，
 * 而这两个属性是同一段代码里相邻两行 setAttribute 写的 —— 不可能只写上一个。
 * 说明「测试找到的那个元素」和「插件创建的那个元素」不是同一个东西。
 * 这里不猜，直接把结构打出来看。
 *
 * 用法：node tests/kernel/probe-task-node-dom.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";
const api = async (p, b) =>
    (
        await fetch(KERNEL + p, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
            body: JSON.stringify(b ?? {}),
        })
    ).json();

const md = ["- [ ] 顶层任务", "  - [ ] 甲任务", "    - 甲的子条目", "  - [x] 乙任务", ""].join("\n");
const mk = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-待办DOM-${Date.now()}`,
    markdown: md,
});
const docId = mk.data;
const listId = (await api("/api/block/getChildBlocks", { id: docId })).data.find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

const chrome = await launch({ headless: true, port: 9353, width: 1400, height: 900, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图出现" });
    await sleep(1800);

    const out = await page.eval(`(() => {
        const roots = [...document.querySelectorAll('.mm-root')];
        const clean = (s) => (s || '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').trim();
        const dump = roots.map((root, i) => ({
            idx: i,
            cls: root.className,
            nodes: [...root.querySelectorAll('.mm-node')].map((n) => ({
                text: clean((n.querySelector('.mm-txt') || {}).textContent),
                innerHTML: (n.querySelector('.mm-inner') || n).innerHTML.slice(0, 320),
                taskCount: n.querySelectorAll('.mm-task').length,
                taskTag: (n.querySelector('.mm-task') || {}).tagName ?? null,
                taskAttrs: n.querySelector('.mm-task')
                    ? [...n.querySelector('.mm-task').attributes].map((a) => a.name + '=' + JSON.stringify(a.value))
                    : null,
            })),
        }));
        return { rootCount: roots.length, roots: dump };
    })()`);
    console.log(JSON.stringify(out, null, 2));

    // 顺带量一下复选框的可点区域 —— 坐标打偏也会表现为「点了没反应」
    const geo = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        const clean = (s) => (s || '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').trim();
        const n = [...root.querySelectorAll('.mm-node')].find((x) => clean((x.querySelector('.mm-txt') || {}).textContent) === '甲任务');
        if (!n) return { err: 'no node' };
        const box = n.querySelector('.mm-task');
        if (!box) return { err: 'no box' };
        const rb = box.getBoundingClientRect();
        const rn = n.getBoundingClientRect();
        const at = document.elementFromPoint(Math.round(rb.left + rb.width / 2), Math.round(rb.top + rb.height / 2));
        return {
            box: { x: rb.left, y: rb.top, w: rb.width, h: rb.height },
            node: { x: rn.left, y: rn.top, w: rn.width, h: rn.height },
            hitTag: at ? at.tagName : null,
            hitCls: at ? at.className : null,
            hitIsBox: at === box,
        };
    })()`);
    console.log("\n几何 / 命中测试:", JSON.stringify(geo, null, 2));
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}
