/**
 * 默认缩放的可读性测量。
 *
 * 问题背景：`autoFit` 默认开启，`fit()` 用的是 `min(vw/w, vh/h, 2)` ——
 * 大图会被一路压到 `MIN_SCALE = 0.15`。节点再多一点，文字就只有几个像素高。
 *
 * 本探针在不同规模下量「实际渲染出来的字号」，给「多大图开始不可读」一个硬数据。
 *
 * 用法：node tests/kernel/measure-scale.mjs
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

/** 造一棵 branches 个分支、每支 per 个子项的树 */
function makeMd(branches, per) {
    const out = ["- 规模测量根节点"];
    for (let i = 1; i <= branches; i++) {
        out.push(`  - 分支 ${i} 的主题标题`);
        for (let j = 1; j <= per; j++) out.push(`    - 条目 ${i}.${j} 的说明文字`);
    }
    out.push("");
    return out.join("\n");
}

const CASES = [
    ["小图 · 3 分支", 3, 2],
    ["中图 · 6 分支", 6, 4],
    ["大图 · 9 分支", 9, 6],
    ["超大 · 12 分支", 12, 8],
];

const chrome = await launch({ headless: true, port: 9341, width: 1680, height: 1050, dpr: 1 });
const rows = [];

/* ⚠️ 本支每轮循环都建一份文档，docId 是循环内的 const —— finally 里够不着，
   所以要在外层留一个「当轮还没删掉的那个」的引用。
   原先把清理写在循环体末尾：中途任何一步抛异常（本支要 newPage + waitFor，
   超时是常事），那一轮就在用户笔记本里留下「临时-缩放测量-时间戳」。 */
let pendingDocId = null;

try {
    for (const [label, branches, per] of CASES) {
        const docRes = await api("/api/filetree/createDocWithMd", {
            notebook: NOTEBOOK,
            path: `/临时-缩放测量-${Date.now()}`,
            markdown: makeMd(branches, per),
        });
        if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
        const docId = docRes.data;
        pendingDocId = docId;
        const listId = (await children(docId)).find((k) => k.type === "l").id;
        await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

        const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
        await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 60000, label: "导图" });
        await sleep(1400);

        const m = await page.eval(`(() => {
            const root = document.querySelector('.mm-root:not(.mm-root--dialog)');
            const world = root.querySelector('.mm-world');
            const txt = root.querySelector('.mm-node .mm-txt');
            const node = root.querySelector('.mm-node');
            const cs = txt ? getComputedStyle(txt) : null;
            // 注意：缩放写在 world.style.zoom 上，不是 transform: scale()。
            // 读 transform 只会拿到 translate，永远得到 1 —— 第一次就是这么量错的。
            const scale = parseFloat(world.style.zoom) || 1;
            const r = node ? node.getBoundingClientRect() : null;
            const vp = root.querySelector('.mm-viewport').getBoundingClientRect();
            // 折叠的节点元素仍然在 DOM 里（只是 visibility: hidden），
            // 所以「看得见几个」要单独数 —— 直接用 querySelectorAll 会把它们算进去。
            const all = [...root.querySelectorAll('.mm-node')];
            const shown = all.filter((el) => el.style.visibility !== 'hidden');
            return {
                nodes: all.length,
                visible: shown.length,
                scale: +scale.toFixed(3),
                cssFontSize: cs ? cs.fontSize : '?',
                renderedFontPx: cs ? +(parseFloat(cs.fontSize) * scale).toFixed(2) : 0,
                nodeH: r ? Math.round(r.height) : 0,
                viewportH: Math.round(vp.height),
                worldW: Math.round(parseFloat(world.style.width) || 0),
                worldH: Math.round(parseFloat(world.style.height) || 0),
            };
        })()`);
        rows.push({ label, ...m });
        console.log(
            `${label.padEnd(14)} 节点 ${String(m.nodes).padStart(3)}（可见 ${String(m.visible).padStart(3)}）  缩放 ${String(m.scale).padEnd(6)}  实际字号 ${String(m.renderedFontPx).padStart(5)}px  画布 ${m.worldW}×${m.worldH}`,
        );

        const info = await api("/api/block/getBlockInfo", { id: docId });
        if (info.code === 0) await api("/api/filetree/removeDoc", { notebook: info.data.box, path: info.data.path });
        pendingDocId = null; // 这一轮删干净了，finally 不用兜底
    }
} finally {
    await chrome.close();
    // 兜底：中途抛异常时，当轮那份还留着（pendingDocId 非空）
    if (pendingDocId) {
        const ok = await removeDoc(api, pendingDocId);
        console.log(ok ? "已清理当轮临时文档" : "⚠️ 临时文档未能清理: " + pendingDocId);
    }
}

console.log("\n可读性参考：正文 14px，缩到 8px 以下基本没法读，6px 以下只剩色块。");
const bad = rows.filter((r) => r.renderedFontPx < 8);
console.log(bad.length ? `⚠️ 有 ${bad.length} 个规模档位落到不可读区间` : "全部档位可读");
