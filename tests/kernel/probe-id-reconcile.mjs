/**
 * 只读探针：把「内核侧 ID」和「前端 DOM 侧 ID」摆在同一张表上对账。
 *
 * 起因：`probe-task-click.mjs` 里点了一下复选框之后，源列表 DOM 里
 * 各个 `.li` 的 `data-node-id` 和内核 kramdown / getChildBlocks 报出来的
 * 对不上（DOM 是 mk6ekx / 20rzmj / dcjnti，内核是 a10fdi / 8bujvy / o1dihb）。
 * 而 `getChildKramdown` 与 `getChildBlocks` 两边是自洽的。
 *
 * 同一个列表的内核 ID 和前端 ID 不可能不同 —— 所以一定是某一边读错了对象。
 * 这个探针把页面标题、docId、列表 ID、两边的 ID 全打出来，一次看明白。
 *
 * 用法：node tests/kernel/probe-id-reconcile.mjs
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

const PATH = `/临时-ID对账-${Date.now()}`;
const md = ["- [ ] 顶层任务", "  - [ ] 甲任务", "    - 甲的子条目", "  - [x] 乙任务", ""].join("\n");
const mk = await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: PATH, markdown: md });
const docId = mk.data;

const kids = async (id) => (await api("/api/block/getChildBlocks", { id })).data ?? [];
const listId = (await kids(docId)).find((k) => k.type === "l")?.id;
const rootLi = (await kids(listId)).find((k) => k.type === "i")?.id;
const innerList = (await kids(rootLi)).find((k) => k.type === "l")?.id;
const itemIds = (await kids(innerList)).filter((k) => k.type === "i").map((b) => b.id);
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

const kram = async () => (await api("/api/block/getBlockKramdown", { id: listId })).data?.kramdown ?? "";
const kramIds = (t) => [...t.matchAll(/^\s*- \{: id="([^"]+)"[^}]*\}(\[[ xX]\]) (.*)$/gm)].map((m) => `${m[1]} ${m[2].trim() || "[ ]"} ${m[3].trim()}`);

console.log(`docId    ${docId}`);
console.log(`listId   ${listId}`);
console.log(`rootLi   ${rootLi}`);
console.log(`innerList ${innerList}`);
console.log(`itemIds  ${itemIds.join(", ")}`);
console.log(`\n内核 kramdown 的 id:`);
for (const l of kramIds(await kram())) console.log("   " + l);

const chrome = await launch({ headless: true, port: 9355, width: 1400, height: 900, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图出现" });
    await sleep(1800);

    const dom = await page.eval(`(() => {
        const out = { protyleDocId: null, titles: [], lists: [] };
        out.protyleDocId = document.querySelector('.protyle')?.dataset?.docId ?? null;
        out.titles = [...document.querySelectorAll('.protyle-title .protyle-title__input')].map((x) => x.textContent.trim());
        for (const list of document.querySelectorAll('.list[data-node-id]')) {
            out.lists.push({
                listId: list.dataset.nodeId,
                isTarget: list.dataset.nodeId === '${listId}',
                items: [...list.querySelectorAll(':scope > .li[data-node-id]')].map((li) => ({
                    li: li.dataset.nodeId,
                    p: li.querySelector(':scope > .p')?.dataset?.nodeId ?? null,
                    sub: li.querySelector(':scope > .list')?.dataset?.nodeId ?? null,
                    text: (li.querySelector(':scope > .p')?.textContent ?? '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').trim(),
                })),
            });
        }
        return out;
    })()`);
    console.log(`\n页面 protyle docId: ${dom.protyleDocId}`);
    console.log(`页面标题: ${JSON.stringify(dom.titles)}`);
    console.log(`页面上的 .list 共 ${dom.lists.length} 个：`);
    for (const l of dom.lists) {
        console.log(`  list ${l.listId}${l.isTarget ? "  ← 目标" : ""}`);
        for (const it of l.items) console.log(`     li ${it.li}  p=${it.p}  sub=${it.sub}  ${it.text}`);
    }

    /* ---------------- 点一下复选框，再看一遍 ---------------- */

    const DUMP = `(() => {
        const out = [];
        for (const list of document.querySelectorAll('.list[data-node-id]')) {
            const chain = [];
            for (let e = list.parentElement; e && chain.length < 4; e = e.parentElement) {
                chain.push(e.tagName.toLowerCase() + '.' + String(e.className || '').split(' ').slice(0, 2).join('.'));
            }
            out.push({
                listId: list.dataset.nodeId.slice(-6),
                inMap: !!list.closest('.mm-root'),
                parent: chain.join(' < '),
                items: [...list.querySelectorAll(':scope > .li[data-node-id]')].map((li) => li.dataset.nodeId.slice(-6)),
            });
        }
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        return {
            lists: out,
            map: root ? [...root.querySelectorAll('.mm-node')].map((n) => (n.dataset.mmId || '').slice(-6)) : null,
        };
    })()`;

    page.on("Runtime.consoleAPICalled", (p) => {
        const t = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
        if (t.includes("mindmap")) console.log("  [页面]", p.type, t);
    });
    await page.send("Runtime.enable");

    const before = await page.eval(DUMP);
    console.log(`\n【点击前】\n  DOM:  ${JSON.stringify(before.lists)}`);
    console.log(`  导图: ${JSON.stringify(before.map)}`);
    console.log(`  内核: ${JSON.stringify(kramIds(await kram()).map((s) => s.split(" ")[0].slice(-6)))}`);

    console.log("\n【点一下「甲任务」的复选框】");
    await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        const el = root.querySelector('.mm-node[data-mm-id="${itemIds[0]}"]');
        if (!el) return { err: 'no node' };
        el.querySelector('.mm-task').click();
        return { ok: true };
    })()`);

    for (const wait of [400, 800, 1600, 2600]) {
        await sleep(wait === 400 ? 400 : wait - 400);
        const d = await page.eval(DUMP);
        console.log(`  t=${wait}ms DOM:  ${JSON.stringify(d.lists)}`);
        console.log(`         导图: ${JSON.stringify(d.map)}`);
        console.log(`         内核: ${JSON.stringify(kramIds(await kram()).map((s) => s.split(" ")[0].slice(-6)))}`);
    }

    // 决定性证据：.mm-nodes 里到底装了什么
    const nodesHtml = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        const nodes = root.querySelector('.mm-nodes');
        return {
            nodesChildren: [...nodes.children].map((c) => c.tagName.toLowerCase() + '.' + String(c.className || '')),
            html: nodes.innerHTML.slice(0, 1400),
        };
    })()`);
    console.log("\n.mm-nodes 的直接子元素:", JSON.stringify(nodesHtml.nodesChildren, null, 0));
    console.log(".mm-nodes 的 HTML 开头:\n" + nodesHtml.html);
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}
