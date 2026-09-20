/**
 * `world.style.zoom` 会不会影响 `offsetWidth` / `offsetHeight`？
 *
 * 背景：同一棵树、同样的节点、同样的窗口，首次渲染算出 1752×2096，
 * 之后再渲染算出 1761×2122 —— 唯一差别是第二次量测时 world 上已经挂了 `zoom: 0.55`。
 * 布局用的是 `n.w = el.offsetWidth`，所以只要 zoom 会影响它，布局就会依赖渲染次序。
 *
 * 用法：node tests/kernel/diag-zoom-measure.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";

const WORKSPACE = "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = conf.api?.token || "";
const api = async (p, b) =>
    (
        await fetch("http://127.0.0.1:6806" + p, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
            body: JSON.stringify(b ?? {}),
        })
    ).json();
const kids = async (id) => (await api("/api/block/getChildBlocks", { id })).data || [];

const md = ["- zoom 量测验证"];
for (let i = 1; i <= 3; i++) {
    md.push(`  - 分支 ${i} · 一个有点长的主题标题文字`);
    for (let j = 1; j <= 3; j++) md.push(`    - 条目 ${i}.${j}：用来观察排版与量测的文字`);
}
md.push("");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-zoom-${Date.now()}`,
    markdown: md.join("\n"),
});
const docId = docRes.data;
const listId = (await kids(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

const chrome = await launch({ headless: true, port: 9356, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图" });
    await sleep(2000);

    const r = await page.eval(`(() => {
        const root = document.querySelector('.mm-root');
        const world = root.querySelector('.mm-world');
        const els = [...root.querySelectorAll('.mm-node')].slice(0, 6);
        const snap = () => els.map((e) => ({ w: e.offsetWidth, h: e.offsetHeight, cw: e.clientWidth, ch: e.clientHeight }));
        const before = snap();
        const savedZoom = world.style.zoom;
        world.style.zoom = '1';
        const at1 = snap();
        world.style.zoom = '0.55';
        const at055 = snap();
        world.style.zoom = savedZoom;
        const back = snap();
        // 顺便看看世界容器的定位方式
        const cs = getComputedStyle(els[0]);
        const ws = getComputedStyle(world);
        return {
            savedZoom,
            before, at1, at055, back,
            nodePos: cs.position, nodeWidth: cs.width, nodeMaxWidth: cs.maxWidth,
            worldPos: ws.position, worldWidth: ws.width, worldTransform: ws.transform,
        };
    })()`);

    console.log("当前 zoom =", JSON.stringify(r.savedZoom));
    console.log(".mm-node position =", r.nodePos, "width =", r.nodeWidth, "maxWidth =", r.nodeMaxWidth);
    console.log(".mm-world position =", r.worldPos, "width =", r.worldWidth, "transform =", r.worldTransform);
    const show = (label, arr) => console.log(`  ${label}: ${arr.map((x) => `${x.w}x${x.h}`).join(" ")}`);
    show("原始(zoom 现状) ", r.before);
    show("zoom=1        ", r.at1);
    show("zoom=0.55     ", r.at055);
    show("还原后        ", r.back);

    const same = (a, b) => a.every((x, i) => x.w === b[i].w && x.h === b[i].h);
    console.log("\nzoom=1 与 zoom=0.55 量测一致?", same(r.at1, r.at055) ? "一致 → zoom 不影响量测" : "不一致 → zoom 影响量测，布局会依赖渲染次序");
} finally {
    await chrome.close();
    await api("/api/block/deleteBlock", { id: docId });
}
