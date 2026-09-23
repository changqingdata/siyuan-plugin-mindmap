/**
 * 只读探针：量一下「文档开着的时候，updateTaskListItemMarker 写进去之后，
 * 内核的 getBlockKramdown 多久才反映出来」。
 *
 * 起因：`diag-task-check.mjs` 里 UI 明明翻了，但紧随其后的 kramdown 读取还是旧值，
 * 而且看起来**滞后一拍**（点两次之后读到的是第一次的结果）。要先确认这是
 * 「读取延迟」还是「写入被前端覆盖」，两种情况的处置完全不同。
 *
 * 做法：文档在浏览器里开着，从 Node 直接调内核接口写 marker，
 * 然后每 250ms 读一次 kramdown，看它什么时候变、会不会又变回去。
 *
 * 用法：node tests/kernel/probe-marker-lag.mjs
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
    path: `/临时-marker延迟-${Date.now()}`,
    markdown: md,
});
const docId = mk.data;
const listId = (await api("/api/block/getChildBlocks", { id: docId })).data.find((k) => k.type === "l").id;
const rootLi = (await api("/api/block/getChildBlocks", { id: listId })).data.find((k) => k.type === "i").id;
const innerList = (await api("/api/block/getChildBlocks", { id: rootLi })).data.find((k) => k.type === "l").id;
const idA = (await api("/api/block/getChildBlocks", { id: innerList })).data.filter((k) => k.type === "i")[0].id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

const kram = async () => (await api("/api/block/getBlockKramdown", { id: listId })).data?.kramdown ?? "";
const flag = async () => {
    const kd = await kram();
    const m = kd.match(new RegExp(`id="${idA}"[^}]*\\}\\[([xX ])\\]`));
    return m ? (m[1].toLowerCase() === "x" ? "X" : " ") : "?";
};

console.log(`docId ${docId} / 甲 ${idA}`);
console.log("初始:", await flag());

const chrome = await launch({ headless: true, port: 9356, width: 1400, height: 900, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图出现" });
    await sleep(2000);
    console.log("文档已在浏览器里打开，导图就绪。");
    console.log("（顺带确认导图里那份没有 data-node-id：）");
    console.log("  ", await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        return {
            节点数: root.querySelectorAll('.mm-node').length,
            带dataNodeId的节点数: root.querySelectorAll('.mm-node[data-node-id]').length,
            带dataMmId的节点数: root.querySelectorAll('.mm-node[data-mm-id]').length,
            导图内部残留的dataNodeId元素数: root.querySelectorAll('[data-node-id]').length,
        };
    })()`));

    for (const [label, marker] of [["写 x（勾选）", "x"], ["写空格（取消）", " "]]) {
        console.log(`\n===== ${label} =====`);
        const r = await api("/api/block/updateTaskListItemMarker", { id: idA, marker });
        console.log(`  接口响应: code=${r.code} ${r.msg || ""}`);
        const t0 = Date.now();
        for (let i = 0; i < 16; i++) {
            await sleep(250);
            const f = await flag();
            console.log(`  +${String(Date.now() - t0).padStart(4)}ms  kramdown=[${f}]`);
            if (f === (marker === "x" ? "X" : " ")) {
                console.log(`  ✔ ${Date.now() - t0}ms 后读到新值`);
                break;
            }
        }
        // 再多看 2 秒，确认不会被前端覆盖回去
        await sleep(2000);
        console.log(`  +2s 后复读: [${await flag()}]（若与上面不同，说明被前端覆盖了）`);
    }
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}
