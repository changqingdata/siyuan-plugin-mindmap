/**
 * 第十六轮排障用的内省探针。
 *
 * 不是验收，是「把 DOM 真相 dump 出来」。当验收失败时，第一件要分清的事是
 * 「判据写错了」还是「功能真坏了」—— 光看失败列表分不出来，得看现场。
 *
 * 用法：node tests/kernel/introspect-v2.mjs
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
const kids = async (id) => {
    const j = await api("/api/block/getChildBlocks", { id });
    return j.code === 0 ? j.data : [];
};

const MD = [
    "- 内省验证",
    "  - 分支甲：一段用来观察折叠与收拢动画的标题文字",
    "    - 条目 甲.1：折起来时应当整段消失",
    "    - 条目 甲.2：折起来时应当整段消失",
    "  - 分支乙：另一段用来观察的标题文字",
    "    - 条目 乙.1：折起来时应当整段消失",
    "  - 任务组：用来观察连线语义化",
    "    - [x] 已完成的任务",
    "    - [ ] 未完成的任务",
    "",
].join("\n");

const doc = (
    await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-内省-${Date.now()}`, markdown: MD })
).data;
const list = (await kids(doc)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: list, attrs: { "custom-mindmap": "logic" } });
console.log(`文档 ${doc} · 列表 ${list}\n`);

const ROOT = `document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)')`;

const show = (label, v) => console.log(`  ${label}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

const chrome = await launch({ headless: true, width: 1500, height: 1000 });
const page = await chrome.newPage("about:blank");
await page.eval(`window.__mmErrors = []; window.addEventListener('error', (e) => window.__mmErrors.push(String(e.message))); true`);

try {
    await page.send("Page.navigate", { url: `${KERNEL}/stage/build/desktop/?id=${doc}` });
    await sleep(3600);
    await page.waitFor(`${ROOT} !== null`, { timeout: 30000, label: "导图挂载" });
    await sleep(500);

    /* ---------------------------------------------------------- A. 工具条 / seg */
    console.log("[A] 工具条与布局分段控件");
    show("root class", await page.eval(`${ROOT}.className`));
    show("toolbar 在 root 里吗", await page.eval(`${ROOT}.querySelector('.mm-toolbar') !== null`));
    show("toolbarEl 是 root 的后代吗", await page.eval(`!!(${ROOT}.querySelector('.mm-toolbar'))`));
    show(".mm-seg 存在", await page.eval(`!!${ROOT}.querySelector('.mm-seg')`));
    show("seg 按钮数", await page.eval(`${ROOT}.querySelectorAll('.mm-seg button').length`));
    show("seg 各按钮 class", await page.eval(`[...${ROOT}.querySelectorAll('.mm-seg button')].map((b) => b.dataset.layout + ':' + b.className)`));
    show("带 data-layout 的元素总数", await page.eval(`${ROOT}.querySelectorAll('[data-layout]').length`));
    show("带 data-layout 的元素（含非 seg）", await page.eval(`[...${ROOT}.querySelectorAll('[data-layout]')].map((b) => b.tagName + '.' + b.className + '[' + b.dataset.layout + ']')`));

    /* ---------------------------------------------------------- B. 折叠与 byId */
    console.log("\n[B] 折叠态与节点登记");
    show("节点总数", await page.eval(`${ROOT}.querySelectorAll('.mm-node').length`));
    show("可见节点数", await page.eval(`[...${ROOT}.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden').length`));
    show("珠子数", await page.eval(`${ROOT}.querySelectorAll('.mm-toggle').length`));
    show("collapsed 珠子数", await page.eval(`${ROOT}.querySelectorAll('.mm-toggle--collapsed').length`));
    // 折起第一个分支，看折叠后节点是被移除还是只藏起来
    const beadPt = await page.eval(`(() => {
        const t = ${ROOT}.querySelectorAll('.mm-toggle')[1];
        if (!t) return { err: 'no bead' };
        const r = t.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await page.mouse("mouseMoved", beadPt.x, beadPt.y, { buttons: 0 });
    await page.mouse("mousePressed", beadPt.x, beadPt.y, {});
    await page.mouse("mouseReleased", beadPt.x, beadPt.y, {});
    await sleep(900);
    show("折叠后节点总数", await page.eval(`${ROOT}.querySelectorAll('.mm-node').length`));
    show("折叠后可见节点数", await page.eval(`[...${ROOT}.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden').length`));
    show("折叠后 collapsed 珠子数", await page.eval(`${ROOT}.querySelectorAll('.mm-toggle--collapsed').length`));

    /* ---------------------------------------------------------- C. 悬停预览 */
    console.log("\n[C] 悬停预览");
    const bead2 = await page.eval(`(() => {
        const t = ${ROOT}.querySelectorAll('.mm-toggle')[1];
        const r = t.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), cls: t.className };
    })()`);
    show("珠子坐标与 class", bead2);
    // 真实鼠标：先移开，再移上去（只发一次 mouseMoved 未必触发 mouseenter）
    await page.mouse("mouseMoved", 5, 5, { buttons: 0 });
    await sleep(60);
    await page.mouse("mouseMoved", bead2.x, bead2.y, { buttons: 0 });
    await sleep(1000);
    show("预览元素（真实鼠标）", await page.eval(`(() => {
        const el = document.querySelector('.mm-preview');
        if (!el) return null;
        return { cls: el.className, rows: el.querySelectorAll('.mm-preview-row').length, head: (el.querySelector('.mm-preview-head') || {}).textContent || '' };
    })()`));
    // 手动派发 mouseenter 看处理器是否绑上了
    show("手动派发 mouseenter 后", await page.eval(`(() => {
        const t = ${ROOT}.querySelectorAll('.mm-toggle')[1];
        if (!t) return 'no bead';
        t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: 100, clientY: 100 }));
        return 'dispatched';
    })()`));
    await sleep(1000);
    show("预览元素（派发后）", await page.eval(`(() => {
        const el = document.querySelector('.mm-preview');
        return el ? { rows: el.querySelectorAll('.mm-preview-row').length } : null;
    })()`));
    await page.mouse("mouseMoved", 5, 5, { buttons: 0 });
    await sleep(400);
    show("移开后预览还在吗", await page.eval(`!!document.querySelector('.mm-preview')`));

    /* ---------------------------------------------------------- D. 连线语义化 */
    console.log("\n[D] 连线语义化（虚线）");
    show("连线 path 总数", await page.eval(`${ROOT}.querySelectorAll('.mm-edges path').length`));
    show("带 dasharray 的 path", await page.eval(`[...${ROOT}.querySelectorAll('.mm-edges path')].filter((p) => p.getAttribute('stroke-dasharray')).length`));
    show("path 样本属性", await page.eval(`[...${ROOT}.querySelectorAll('.mm-edges path')].slice(0, 12).map((p) => ({
        dash: p.getAttribute('stroke-dasharray'),
        parent: p.getAttribute('data-mm-parent'),
        cls: p.getAttribute('class'),
    }))`));
    show("任务节点（含 checkbox 的节点）", await page.eval(`[...${ROOT}.querySelectorAll('.mm-node')].map((n) => ({
        cls: n.className,
        task: n.dataset.mmTask || null,
        txt: (n.querySelector('.mm-txt') || {}).textContent || '',
    })).filter((x) => /任务|完成/.test(x.txt))`));

    /* ---------------------------------------------------------- E. 演示模式键盘 */
    console.log("\n[E] 演示模式与键盘");
    const toolPt = await page.eval(`(() => {
        const b = [...${ROOT}.querySelectorAll('.mm-icon')].find((e) => (e.dataset.mmTip || '').includes('演示模式'));
        if (!b) return { err: 'no present button' };
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    show("演示按钮坐标", toolPt);
    await page.mouse("mouseMoved", toolPt.x, toolPt.y, { buttons: 0 });
    await page.mouse("mousePressed", toolPt.x, toolPt.y, {});
    await page.mouse("mouseReleased", toolPt.x, toolPt.y, {});
    await sleep(900);
    show("present class", await page.eval(`${ROOT}.classList.contains('mm-present')`));
    show("present bar", await page.eval(`!!${ROOT}.querySelector('.mm-present-bar')`));
    show("进度文本", await page.eval(`(${ROOT}.querySelector('.mm-present-count') || {}).textContent || ''`));
    show("activeElement（点完按钮）", await page.eval(`(document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className)) || '(none)'`));
    show("activeElement 在 root 里吗", await page.eval(`(${ROOT}).contains(document.activeElement)`));
    // 手动派发一次 keydown，看处理链通不通
    show("手动派发 ArrowRight", await page.eval(`(() => {
        const t = document.activeElement || document.body;
        const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
        t.dispatchEvent(ev);
        return { target: t.tagName + '.' + t.className, prevented: ev.defaultPrevented };
    })()`));
    await sleep(400);
    show("派发后进度文本", await page.eval(`(${ROOT}.querySelector('.mm-present-count') || {}).textContent || ''`));
    // 真实按键
    await page.press("ArrowRight");
    await sleep(500);
    show("真实按键后进度文本", await page.eval(`(${ROOT}.querySelector('.mm-present-count') || {}).textContent || ''`));
    show("真实按键后 activeElement", await page.eval(`(document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className)) || '(none)'`));
    // 点画布空白再按一次
    await page.eval(`${ROOT}.focus(); true`);
    await page.press("ArrowRight");
    await sleep(500);
    show("焦点在 root 上再按 → 进度", await page.eval(`(${ROOT}.querySelector('.mm-present-count') || {}).textContent || ''`));
    await page.press("Escape");
    await sleep(900);
    show("Esc 后 present class", await page.eval(`${ROOT}.classList.contains('mm-present')`));

    /* ---------------------------------------------------------- F. 小地图 */
    console.log("\n[F] 小地图与选中标记");
    show("小地图 display", await page.eval(`${ROOT}.querySelector('.mm-minimap').style.display`));
    show("小地图 svg 子元素种类", await page.eval(`(() => {
        const mm = ${ROOT}.querySelector('.mm-minimap svg');
        if (!mm) return 'no svg';
        const tags = {};
        for (const c of mm.children) tags[c.tagName + '.' + (c.getAttribute('class') || '-')] = (tags[c.tagName + '.' + (c.getAttribute('class') || '-')] || 0) + 1;
        return tags;
    })()`));
    // 选中一个节点
    const nodePt = await page.eval(`(() => {
        const els = [...${ROOT}.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden');
        const e = els[1] || els[0];
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await page.mouse("mouseMoved", nodePt.x, nodePt.y, { buttons: 0 });
    await page.mouse("mousePressed", nodePt.x, nodePt.y, {});
    await page.mouse("mouseReleased", nodePt.x, nodePt.y, {});
    await sleep(500);
    show("选中节点 class", await page.eval(`[...${ROOT}.querySelectorAll('.mm-node')].filter((n) => n.classList.contains('mm-sel')).map((n) => n.className)`));
    show(".mm-mm-sel 数量", await page.eval(`${ROOT}.querySelectorAll('.mm-mm-sel').length`));
    show("小地图 svg 子元素种类（选中后）", await page.eval(`(() => {
        const mm = ${ROOT}.querySelector('.mm-minimap svg');
        if (!mm) return 'no svg';
        const tags = {};
        for (const c of mm.children) {
            const k = c.tagName + '.' + (c.getAttribute('class') || '-');
            tags[k] = (tags[k] || 0) + 1;
        }
        return tags;
    })()`));

    /* ---------------------------------------------------------- G. 收拢动画 */
    console.log("\n[G] 折叠收拢动画");
    show("观察器挂载", await page.eval(`(() => {
        const root = ${ROOT};
        window.__col = 0;
        if (window.__colMo) window.__colMo.disconnect();
        const mo = new MutationObserver((recs) => {
            for (const r of recs) {
                if (r.type === 'attributes' && r.target.classList && r.target.classList.contains('mm-collapsing')) window.__col++;
                if (r.type === 'childList') {
                    for (const n of r.addedNodes) if (n.classList && n.classList.contains('mm-collapsing')) window.__col++;
                }
            }
        });
        mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
        window.__colMo = mo;
        return true;
    })()`));
    const bead3 = await page.eval(`(() => {
        const t = ${ROOT}.querySelectorAll('.mm-toggle')[1];
        const r = t.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await page.mouse("mouseMoved", bead3.x, bead3.y, { buttons: 0 });
    await page.mouse("mousePressed", bead3.x, bead3.y, {});
    await page.mouse("mouseReleased", bead3.x, bead3.y, {});
    await sleep(600);
    show("collapsing 出现过几次", await page.eval(`window.__col`));
    show("折叠后 collapsed 珠子", await page.eval(`${ROOT}.querySelectorAll('.mm-toggle--collapsed').length`));
    show("残留 .mm-collapsing 元素", await page.eval(`${ROOT}.querySelectorAll('.mm-collapsing').length`));

    /* ---------------------------------------------------------- I. 菜单与键盘的相互干扰 */
    console.log("\n[I] 导出菜单 → Esc → 演示模式 → 方向键（复刻验收脚本里的失败序列）");
    show("打开前 .b3-menu 数", await page.eval(`document.querySelectorAll('.b3-menu').length`));
    const expPt = await page.eval(`(() => {
        const b = [...${ROOT}.querySelectorAll('.mm-icon')].find((e) => (e.dataset.mmTip || '').includes('导出图片'));
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await page.mouse("mouseMoved", expPt.x, expPt.y, { buttons: 0 });
    await page.mouse("mousePressed", expPt.x, expPt.y, {});
    await page.mouse("mouseReleased", expPt.x, expPt.y, {});
    await sleep(500);
    show("打开后 .b3-menu 数", await page.eval(`document.querySelectorAll('.b3-menu').length`));
    show("activeElement", await page.eval(`(document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className)) || '(none)'`));
    await page.press("Escape");
    await sleep(400);
    show("Esc 之后 .b3-menu 数", await page.eval(`document.querySelectorAll('.b3-menu').length`));
    show("Esc 之后 activeElement", await page.eval(`(document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className)) || '(none)'`));
    // 进演示模式
    await page.mouse("mouseMoved", toolPt.x, toolPt.y, { buttons: 0 });
    await page.mouse("mousePressed", toolPt.x, toolPt.y, {});
    await page.mouse("mouseReleased", toolPt.x, toolPt.y, {});
    await sleep(900);
    show("present class", await page.eval(`${ROOT}.classList.contains('mm-present')`));
    show("进演示后 activeElement", await page.eval(`(document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className)) || '(none)'`));
    show("进度", await page.eval(`(${ROOT}.querySelector('.mm-present-count') || {}).textContent || ''`));
    await page.press("ArrowRight");
    await sleep(500);
    show("ArrowRight 后进度", await page.eval(`(${ROOT}.querySelector('.mm-present-count') || {}).textContent || ''`));
    await page.press("Escape");
    await sleep(800);
    show("Esc 后 present", await page.eval(`${ROOT}.classList.contains('mm-present')`));

    /* ---------------------------------------------------------- 收尾 */
    console.log("\n[H] 页面报错");
    show("errors", await page.eval("window.__mmErrors || []"));
} finally {
    await chrome.close();
    await removeDoc(api, doc);
}
