/**
 * 钉死「布局 ↔ 视口高度」的反馈回路。
 *
 * 链条：
 *   layout({ maxCross: max(1200, viewportEl.clientHeight * 2.4) })
 *     → box.h
 *       → resizeViewport(box.h) → viewportEl.style.height
 *         → 下一轮 render 读到的 clientHeight 变了
 *           → maxCross 变了 → 列数变了 → box.h 又变了 → …
 *
 * 只要这条回路存在，同一份数据在不同渲染次序下就会得到不同布局 ——
 * 用户看到的就是「关闭前一个样、重新打开后另一个样」。
 *
 * 判据：连续触发多次 render（折叠/展开同一个节点），观察
 *       { 视口高, 列数, 画布尺寸 } 是否收敛。来回跳 = 回路实锤。
 *
 * 用法：node tests/kernel/diag-feedback.mjs
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

const BRANCHES = 9;
const PER = 6;
const md = ["- 回路验证 · 大纲导图"];
for (let i = 1; i <= BRANCHES; i++) {
    md.push(`  - 分支 ${i} · 一个有点长的主题标题文字`);
    for (let j = 1; j <= PER; j++) md.push(`    - 条目 ${i}.${j}：用来观察排版、连线与层级的说明文字`);
}
md.push("");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-回路验证-${Date.now()}`,
    markdown: md.join("\n"),
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

const SNAP = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return null;
    const vp = root.querySelector('.mm-viewport');
    const world = root.querySelector('.mm-world');
    const nodes = [...root.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden');
    return {
        vpH: Math.round(vp.getBoundingClientRect().height),
        vpStyleH: Math.round(parseFloat(vp.style.height) || 0),
        world: Math.round(parseFloat(world.style.width) || 0) + 'x' + Math.round(parseFloat(world.style.height) || 0),
        scale: +(parseFloat(world.style.zoom) || 1).toFixed(3),
        visible: nodes.length,
        cols: [...new Set(nodes.filter((e) => ((e.querySelector('.mm-txt')||{}).textContent||'').includes('分支'))
                             .map((e) => Math.round(parseFloat(e.style.left) || 0)))].sort((a, b) => a - b),
    };
})()`;

const btn = (tip) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return null;
    root.scrollIntoView({ block: 'center' });
    const b = [...root.querySelectorAll('button')].find((x) => (x.dataset.mmTip || '').includes(${JSON.stringify(tip)}));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const clickAt = async (page, pos) => {
    await page.mouse("mouseMoved", pos.x, pos.y, { buttons: 0 });
    await page.mouse("mousePressed", pos.x, pos.y, {});
    await page.mouse("mouseReleased", pos.x, pos.y, {});
};

/** 折一次 / 展一次同一个节点 —— 每次都会触发一轮 render */
const foldToggle = (idx) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return null;
    const t = [...root.querySelectorAll('.mm-toggle')][${idx}];
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const chrome = await launch({ headless: true, port: 9347, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图" });
    await sleep(1800);

    console.log("挂载后:", JSON.stringify(await page.eval(SNAP)));

    // 展开全部 → 画布会暴涨，视口高度跟着涨，看下一轮 maxCross 是否把列数改了
    const ub = await page.eval(btn("展开全部"));
    await clickAt(page, ub);
    await sleep(1200);
    const a = await page.eval(SNAP);
    console.log("展开全部后:", JSON.stringify(a));

    /* 反复折叠/展开同一个节点：每次 render 都会用「上一轮的视口高」算 maxCross。
       如果列数在两次之间来回跳，回路就实锤了。 */
    console.log("\n连续触发 render（折叠/展开同一个节点），观察是否收敛：");
    const seen = [];
    for (let i = 0; i < 6; i++) {
        const t = await page.eval(foldToggle(1));
        if (!t) {
            console.log("  找不到折叠按钮，跳过");
            break;
        }
        await clickAt(page, t);
        await sleep(700);
        const s = await page.eval(SNAP);
        seen.push(s);
        console.log(`  #${i + 1} 视口高=${s.vpH}(style=${s.vpStyleH}) 画布=${s.world} 缩放=${s.scale} 可见=${s.visible} 列数=${s.cols.length} ${JSON.stringify(s.cols)}`);
    }

    const colsSet = [...new Set(seen.map((s) => s.cols.length))];
    const worldSet = [...new Set(seen.map((s) => s.world))];
    const colsStable = colsSet.length === 1;
    console.log(
        colsStable
            ? `\n✓ 列数稳定在 ${colsSet[0]}`
            : `\n✗ 列数在 ${JSON.stringify(colsSet)} 之间来回跳 —— 布局↔视口 反馈回路实锤（用户反馈 1）`,
    );
    console.log(worldSet.length > 1 ? `  画布尺寸也在变: ${JSON.stringify(worldSet)}` : `  画布尺寸稳定: ${worldSet[0]}`);
    // ⚠️ 判定算出来了就得**传出去**。原先只 console.log，于是 `ux:all` 的 && 链
    //    看不到这条 ✗，脚本照样 exit 0 —— 「有判定、没门」。
    //    用 exitCode 而不是 process.exit()，别跳过 finally 里的清理。
    if (!colsStable) process.exitCode = 1;
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("\n已清理临时文档");
}
