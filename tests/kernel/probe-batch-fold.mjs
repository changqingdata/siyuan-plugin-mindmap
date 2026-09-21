/**
 * 定向探针：批量折叠 / 展开到底有没有把 unfoldBlock 发出去。
 *
 * 背景：真机验收里「批量展开把大纲里的 fold 清干净了」失败，而直接打内核
 * 接口证明 unfoldBlock 本身没问题。所以要看的是**上层有没有真的调用它**——
 * 给 XMLHttpRequest 打桩，把请求 URL 记下来，比读最终状态有用得多。
 *
 * 用法：node tests/kernel/probe-batch-fold.mjs
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

const MD = [
    "- 批量折叠验证",
    "  - 分支甲：一段用来观察折叠的标题文字",
    "    - 条目 甲.1",
    "    - 条目 甲.2",
    "  - 分支乙：另一段用来观察的标题文字",
    "    - 条目 乙.1",
    "  - 分支丙：第三段用来观察的标题文字",
    "    - 条目 丙.1",
    "",
].join("\n");

const doc = (await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-批量折叠-${Date.now()}`, markdown: MD })).data;
const list = (await api("/api/block/getChildBlocks", { id: doc })).data.find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: list, attrs: { "custom-mindmap": "logic" } });
const kd = async () => (await api("/api/block/getBlockKramdown", { id: list })).data.kramdown;
const foldCount = async () => ((await kd()).match(/fold="1"/g) ?? []).length;

console.log(`文档 ${doc} · 列表 ${list}\n`);

const ROOT = `document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)')`;

const chrome = await launch({ headless: true, width: 1500, height: 1000 });
const page = await chrome.newPage("about:blank");

/** 给 XHR 打桩，记录所有 API 调用 */
const SPY_ON = `(() => {
    if (window.__xhrSpy) return true;
    window.__xhrSpy = [];
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u, ...rest) {
        this.__mmUrl = u;
        return open.call(this, m, u, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
        if (this.__mmUrl) {
            const body = args[0];
            window.__xhrSpy.push(String(this.__mmUrl).replace(/^.*\\/api\\//, '') + ' ' + (typeof body === 'string' ? body.slice(0, 120) : ''));
        }
        return send.apply(this, args);
    };
    return true;
})()`;
const SPY_DRAIN = `(() => { const a = window.__xhrSpy || []; window.__xhrSpy = []; return a; })()`;

async function clickExpr(expr, settle = 0) {
    const pt = await page.eval(expr);
    if (!pt || pt.err) {
        console.log(`    (取不到坐标: ${JSON.stringify(pt)})`);
        return null;
    }
    await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
    await page.mouse("mousePressed", pt.x, pt.y, {});
    await page.mouse("mouseReleased", pt.x, pt.y, {});
    if (settle) await sleep(settle);
    return pt;
}

const nodeAt = (n) => `(() => {
    const root = ${ROOT};
    root.scrollIntoView({ block: 'center' });
    const els = [...root.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden');
    const e = els[${n}];
    if (!e) return { err: 'no node' };
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const batchBtn = (label) => `(() => {
    const b = [...${ROOT}.querySelectorAll('.mm-batch-btn')].find((e) => e.textContent === ${JSON.stringify(label)});
    if (!b) return { err: 'no btn ' + ${JSON.stringify(label)} + ' / ' + [...${ROOT}.querySelectorAll('.mm-batch-btn')].map((e) => e.textContent).join('|') };
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

try {
    await page.send("Page.navigate", { url: `${KERNEL}/stage/build/desktop/?id=${doc}` });
    await sleep(3600);
    await page.waitFor(`${ROOT} !== null`, { timeout: 30000, label: "挂载" });
    await sleep(600);
    await page.eval(SPY_ON);

    console.log("[1] 选中根的第一个子分支 + Ctrl+A");
    await clickExpr(nodeAt(1), 250);
    await page.press("a", { ctrl: true });
    await sleep(400);
    console.log("    批量条文字:", await page.eval(`(${ROOT}.querySelector('.mm-batch-count') || {}).textContent || '(无)'`));
    console.log("    批量条按钮:", await page.eval(`[...${ROOT}.querySelectorAll('.mm-batch-btn')].map((e) => e.textContent)`));
    console.log("    选中的节点 id:", await page.eval(`[...${ROOT}.querySelectorAll('.mm-node.mm-sel, .mm-node.mm-multi')].map((e) => (e.dataset.mmId || e.getAttribute('data-mm-id') || '?') + ':' + (e.querySelector('.mm-txt') || {}).textContent)`));
    console.log("    节点 class 样本:", await page.eval(`[...${ROOT}.querySelectorAll('.mm-node')].map((e) => e.className).slice(0, 6)`));
    console.log("    初始 fold 数:", await foldCount());

    console.log("\n[2] 点「折叠」");
    await page.eval(SPY_DRAIN);
    await clickExpr(batchBtn("折叠"), 1200);
    console.log("    XHR:", await page.eval(SPY_DRAIN));
    console.log("    fold 数:", await foldCount());
    console.log("    collapsed 珠子:", await page.eval(`${ROOT}.querySelectorAll('.mm-toggle--collapsed').length`));

    console.log("\n[3] 点「展开」");
    await page.eval(SPY_DRAIN);
    const pt = await clickExpr(batchBtn("展开"), 1500);
    console.log("    点击坐标:", JSON.stringify(pt));
    console.log("    XHR:", await page.eval(SPY_DRAIN));
    console.log("    fold 数:", await foldCount());
    console.log("    collapsed 珠子:", await page.eval(`${ROOT}.querySelectorAll('.mm-toggle--collapsed').length`));
    console.log("    批量条还在吗:", await page.eval(`!!${ROOT}.querySelector('.mm-batch')`));
    console.log("    批量条按钮:", await page.eval(`[...${ROOT}.querySelectorAll('.mm-batch-btn')].map((e) => e.textContent)`));

    await sleep(1500);
    console.log("\n[4] 再等 1.5s 看覆盖表核对有没有回写");
    console.log("    XHR:", await page.eval(SPY_DRAIN));
    console.log("    fold 数:", await foldCount());

    console.log("\n[5] 只选一个分支（不按 Ctrl+A），单独折叠再展开");
    await clickExpr(nodeAt(1), 300);
    console.log("    批量条:", await page.eval(`!!${ROOT}.querySelector('.mm-batch')`));
    console.log("    单节点折叠走的是 onFoldChange（点珠子）");
    const beadPt = await page.eval(`(() => {
        const t = ${ROOT}.querySelectorAll('.mm-toggle')[1];
        const r = t.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await page.eval(SPY_DRAIN);
    await page.mouse("mouseMoved", beadPt.x, beadPt.y, { buttons: 0 });
    await page.mouse("mousePressed", beadPt.x, beadPt.y, {});
    await page.mouse("mouseReleased", beadPt.x, beadPt.y, {});
    await sleep(1100);
    console.log("    点珠子折 → XHR:", await page.eval(SPY_DRAIN));
    console.log("    fold 数:", await foldCount());
    await page.eval(SPY_DRAIN);
    await page.mouse("mouseMoved", beadPt.x, beadPt.y, { buttons: 0 });
    await page.mouse("mousePressed", beadPt.x, beadPt.y, {});
    await page.mouse("mouseReleased", beadPt.x, beadPt.y, {});
    await sleep(1100);
    console.log("    点珠子展 → XHR:", await page.eval(SPY_DRAIN));
    console.log("    fold 数:", await foldCount());

    console.log("\n[6] 批量折叠全部（工具条上的「折叠全部」）");
    await page.eval(SPY_DRAIN);
    await clickExpr(`(() => {
        const b = [...${ROOT}.querySelectorAll('.mm-icon')].find((e) => (e.dataset.mmTip || '').includes('折叠全部'));
        if (!b) return { err: 'no btn' };
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`, 1600);
    console.log("    XHR:", await page.eval(SPY_DRAIN));
    console.log("    fold 数:", await foldCount());
    await page.eval(SPY_DRAIN);
    await clickExpr(`(() => {
        const b = [...${ROOT}.querySelectorAll('.mm-icon')].find((e) => (e.dataset.mmTip || '').includes('展开全部'));
        if (!b) return { err: 'no btn' };
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`, 1600);
    console.log("    展开全部 XHR:", await page.eval(SPY_DRAIN));
    console.log("    fold 数:", await foldCount());
} finally {
    await chrome.close();
    await removeDoc(api, doc);
}
