/**
 * 用户体验巡检：把关键界面逐个截下来，用来看「真实观感」而不是读代码猜。
 *
 * 造一棵 64 节点的列表（跨过小地图的 50 节点阈值），依次截：
 * 默认态 / 选中态 / 搜索 / 右键菜单 / 导出菜单 / 全屏。
 *
 * 用法：node tests/kernel/ux-tour.mjs
 * 产物：tests/.build/ux-01-default.png … ux-06-fullscreen.png
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

/* ---------------------------------------------------------------- 造一棵够大的树 */

const lines = ["- 体验巡检 · 大纲导图"];
for (let i = 1; i <= 9; i++) {
    lines.push(`  - 分支 ${i} · 一个有点长的主题标题文字`);
    for (let j = 1; j <= 6; j++) {
        lines.push(`    - 条目 ${i}.${j}：用来观察排版、连线与层级的说明文字`);
    }
}
lines.push("");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-体验巡检-${Date.now()}`,
    markdown: lines.join("\n"),
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "mind" } });
console.log("文档:", docId, " 列表:", listId, " 节点数约:", lines.length - 2);

const OUT = "tests/.build";
fs.mkdirSync(OUT, { recursive: true });

const chrome = await launch({ headless: true, port: 9339, width: 1680, height: 1050, dpr: 1 });
try {
    const t0 = Date.now();
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "protyle" });
    await page.waitFor("!!document.querySelector('.mm-root')", { timeout: 30000, label: "导图" });
    await sleep(1500);
    console.log(`首屏到导图可见: ${Date.now() - t0} ms`);

    /* 一些量化指标 */
    const stats = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog)');
        if (!root) return null;
        const vp = root.querySelector('.mm-viewport');
        const nodes = root.querySelectorAll('.mm-node');
        const r = root.getBoundingClientRect();
        const first = nodes[0] && nodes[0].getBoundingClientRect();
        return {
            nodeCount: nodes.length,
            toolbarButtons: root.querySelectorAll('.mm-toolbar button').length,
            viewportH: vp ? Math.round(vp.getBoundingClientRect().height) : 0,
            rootH: Math.round(r.height),
            rootW: Math.round(r.width),
            viewportRatio: window.innerHeight ? +(r.height / window.innerHeight).toFixed(2) : 0,
            firstNodeW: first ? Math.round(first.width) : 0,
            firstNodeH: first ? Math.round(first.height) : 0,
            minimap: !!root.querySelector('.mm-minimap'),
            scrollbar: root.querySelector('.mm-viewport') ? getComputedStyle(root.querySelector('.mm-viewport')).overflow : '',
        };
    })()`);
    console.log("指标:", JSON.stringify(stats, null, 2));

    await page.screenshot(`${OUT}/ux-01-default.png`);
    console.log("截图 ux-01-default.png");

    /* 选中一个中间节点 */
    const nodeBox = await page.eval(`(() => {
        const nodes = document.querySelectorAll('.mm-root:not(.mm-root--dialog) .mm-node');
        const el = nodes[Math.min(10, nodes.length - 1)];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: el.textContent.slice(0, 20) };
    })()`);
    if (nodeBox) {
        await page.mouse("mouseMoved", nodeBox.x, nodeBox.y, { buttons: 0 });
        await page.mouse("mousePressed", nodeBox.x, nodeBox.y);
        await page.mouse("mouseReleased", nodeBox.x, nodeBox.y);
        await sleep(500);
        await page.screenshot(`${OUT}/ux-02-selected.png`);
        console.log("截图 ux-02-selected.png  选中:", JSON.stringify(nodeBox.text));
    }

    /* 搜索 */
    await page.press("f", { ctrl: true });
    await sleep(400);
    await page.type("条目");
    await sleep(600);
    await page.screenshot(`${OUT}/ux-03-search.png`);
    console.log("截图 ux-03-search.png");
    await page.press("Escape");
    await sleep(300);

    /* 右键菜单 */
    if (nodeBox) {
        await page.mouse("mousePressed", nodeBox.x, nodeBox.y, { button: "right" });
        await page.mouse("mouseReleased", nodeBox.x, nodeBox.y, { button: "right" });
        await sleep(500);
        await page.screenshot(`${OUT}/ux-04-menu.png`);
        console.log("截图 ux-04-menu.png");
        await page.press("Escape");
        await sleep(300);
    }

    /* 导出菜单 */
    const dl = await page.eval(`(() => {
        const b = document.querySelector('.mm-root:not(.mm-root--dialog) .mm-toolbar button[data-mm-tip*="导出"]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (dl) {
        await page.mouse("mousePressed", dl.x, dl.y);
        await page.mouse("mouseReleased", dl.x, dl.y);
        await sleep(500);
        await page.screenshot(`${OUT}/ux-05-export.png`);
        console.log("截图 ux-05-export.png");
        await page.press("Escape");
        await sleep(300);
    }

    /* 全屏 */
    await page.press("f");
    await sleep(1200);
    await page.screenshot(`${OUT}/ux-06-fullscreen.png`);
    console.log("截图 ux-06-fullscreen.png");

    const fsStats = await page.eval(`(() => {
        const d = document.querySelector('.mm-root--dialog');
        if (!d) return null;
        const r = d.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), nodeCount: d.querySelectorAll('.mm-node').length,
                 toolbarButtons: d.querySelectorAll('.mm-toolbar button').length };
    })()`);
    console.log("全屏:", JSON.stringify(fsStats));
} finally {
    await chrome.close();
    // 统一走 _doc-cleanup 的两步法（getPathByID → removeDoc）；失败要出声
    const ok = await removeDoc(api, docId);
    console.log(ok ? "已清理临时文档" : "⚠️ 清理失败: " + docId);
}
