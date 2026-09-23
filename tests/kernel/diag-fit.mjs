/**
 * 「适应画布」按钮点不动？专项定位。
 * 展开全部 → 打印按钮矩形 / 命中元素 / 点完的缩放变化。
 * 用法：node tests/kernel/diag-fit.mjs
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
const children = async (id) => (await api("/api/block/getChildBlocks", { id })).data ?? [];

const lines = ["- 适应诊断"];
for (let i = 1; i <= 9; i++) {
    lines.push(`  - 分支 ${i}`);
    for (let j = 1; j <= 6; j++) lines.push(`    - 条目 ${i}.${j}`);
}
lines.push("");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-适应诊断-${Date.now()}`,
    markdown: lines.join("\n"),
});
const docId = docRes.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

const chrome = await launch({ headless: true, port: 9347, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图" });
    await sleep(1500);

    const info = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog)');
        const btns = [...root.querySelectorAll('button')].map((b) => ({
            tip: b.dataset.mmTip || '', text: b.textContent.trim(),
        }));
        const b = [...root.querySelectorAll('button')].find((x) => (x.dataset.mmTip || '').includes('适应画布'));
        if (!b) return { btns };
        const r = b.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        return { btns, rect: { x: cx, y: cy, w: Math.round(r.width), h: Math.round(r.height) },
                 hit: hit ? (hit.tagName + '.' + (hit.className || '')) + ' tip=' + (hit.dataset ? hit.dataset.mmTip : '') : 'null',
                 zoomBarRect: (() => { const z = root.querySelector('.mm-zoombar'); const zr = z.getBoundingClientRect();
                     return { l: Math.round(zr.left), t: Math.round(zr.top), w: Math.round(zr.width), h: Math.round(zr.height) }; })(),
                 minimapRect: (() => { const m = root.querySelector('.mm-minimap'); if (!m || getComputedStyle(m).display === 'none') return null;
                     const mr = m.getBoundingClientRect(); return { l: Math.round(mr.left), t: Math.round(mr.top), w: Math.round(mr.width), h: Math.round(mr.height) }; })(),
                 world: { w: Math.round(parseFloat(root.querySelector('.mm-world').style.width) || 0),
                          h: Math.round(parseFloat(root.querySelector('.mm-world').style.height) || 0) },
                 scale: parseFloat(root.querySelector('.mm-world').style.zoom) || 1 };
    })()`);
    console.log("按钮清单:", JSON.stringify(info.btns));
    console.log("适应按钮:", JSON.stringify({ rect: info.rect, hit: info.hit }));
    console.log("zoombar:", JSON.stringify(info.zoomBarRect), " minimap:", JSON.stringify(info.minimapRect));
    console.log("画布:", JSON.stringify(info.world), "缩放", info.scale);

    // 先展开全部
    await page.eval(`(() => { const root = document.querySelector('.mm-root:not(.mm-root--dialog)');
        const b = [...root.querySelectorAll('button')].find((x) => (x.dataset.mmTip || '').includes('展开全部')); b.click(); return true; })()`);
    await sleep(900);
    console.log("展开后:", JSON.stringify(await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog)');
        const w = root.querySelector('.mm-world');
        return { w: Math.round(parseFloat(w.style.width) || 0), h: Math.round(parseFloat(w.style.height) || 0),
                 scale: parseFloat(w.style.zoom) || 1, vw: root.querySelector('.mm-viewport').clientWidth,
                 vh: root.querySelector('.mm-viewport').clientHeight };
    })()`)));

    // 用真实鼠标坐标点
    await page.mouse("mouseMoved", info.rect.x, info.rect.y, { buttons: 0 });
    await sleep(250);
    const afterHover = await page.eval(`(() => {
        const hit = document.elementFromPoint(${info.rect.x}, ${info.rect.y});
        const tip = document.querySelector('.mm-tip');
        return { hit: hit ? hit.tagName + '.' + (hit.className || '') : 'null',
                 tip: tip ? { on: tip.classList.contains('mm-tip--on'), l: tip.style.left, t: tip.style.top,
                              r: (() => { const x = tip.getBoundingClientRect(); return { l: Math.round(x.left), t: Math.round(x.top), w: Math.round(x.width), h: Math.round(x.height) }; })() } : null };
    })()`);
    console.log("悬停后命中:", JSON.stringify(afterHover));

    await page.mouse("mousePressed", info.rect.x, info.rect.y);
    await page.mouse("mouseReleased", info.rect.x, info.rect.y);
    await sleep(700);
    console.log("坐标点击后缩放:", await page.eval(`parseFloat(document.querySelector('.mm-root .mm-world').style.zoom) || 1`));

    // 再用 JS 直接 click()
    await page.eval(`(() => { const root = document.querySelector('.mm-root:not(.mm-root--dialog)');
        const b = [...root.querySelectorAll('button')].find((x) => (x.dataset.mmTip || '').includes('适应画布')); b.click(); return true; })()`);
    await sleep(700);
    console.log("JS 点击后缩放:", await page.eval(`parseFloat(document.querySelector('.mm-root .mm-world').style.zoom) || 1`));
} finally {
    await chrome.close();
    // 统一走 _doc-cleanup 的两步法（getPathByID → removeDoc）；失败要出声
    const ok = await removeDoc(api, docId);
    console.log(ok ? "已清理" : "⚠️ 清理失败: " + docId);
}
