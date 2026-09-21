/**
 * 定向探针：插件自己的菜单，Esc 能不能关掉、关了之后能不能再开。
 *
 * 背景：验收里「缩放菜单 → Esc → 再点缩放标签 → 找菜单项」这一串失败。
 * 需要分清是「菜单关不掉」还是「关了之后开不出来」，也要看清 SiYuan Menu
 * 到底渲染成什么 DOM（`.b3-menu__item` 是不是真的类名）。
 *
 * 用法：node tests/kernel/probe-menu.mjs
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

const MD = ["- 菜单验证", "  - 甲", "    - 甲.1", "  - 乙", ""].join("\n");
const doc = (await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-菜单-${Date.now()}`, markdown: MD })).data;
const list = (await api("/api/block/getChildBlocks", { id: doc })).data.find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: list, attrs: { "custom-mindmap": "logic" } });
console.log(`文档 ${doc}\n`);

const ROOT = `document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)')`;

const show = (label, v) => console.log(`  ${label}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const MENUS = `(() => {
    const ms = [...document.querySelectorAll('.b3-menu')];
    return ms.map((m) => ({
        cls: m.className,
        id: m.id || '',
        display: getComputedStyle(m).display,
        rect: (() => { const r = m.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(),
        itemCls: [...new Set([...m.querySelectorAll('*')].map((e) => e.className).filter((c) => typeof c === 'string' && c.includes('menu')))],
        texts: [...m.querySelectorAll('.b3-menu__item')].map((e) => e.textContent),
    }));
})()`;

const chrome = await launch({ headless: true, width: 1500, height: 1000 });
const page = await chrome.newPage("about:blank");

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

const zoomLabel = `(() => {
    const b = ${ROOT}.querySelector('.mm-zoom-label');
    if (!b) return { err: 'no label' };
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

try {
    await page.send("Page.navigate", { url: `${KERNEL}/stage/build/desktop/?id=${doc}` });
    await sleep(3600);
    await page.waitFor(`${ROOT} !== null`, { timeout: 30000, label: "挂载" });
    await sleep(600);

    console.log("[1] 点缩放标签开菜单");
    show("菜单", await page.eval(MENUS));
    await clickExpr(zoomLabel, 600);
    show("开完菜单", await page.eval(MENUS));
    show("activeElement", await page.eval(`(document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className)) || '(none)'`));

    console.log("\n[2] Esc 关菜单");
    await page.press("Escape");
    await sleep(500);
    show("Esc 后菜单", await page.eval(MENUS));
    show("Esc 后 activeElement", await page.eval(`(document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className)) || '(none)'`));

    console.log("\n[3] 再点一次缩放标签");
    await clickExpr(zoomLabel, 700);
    show("再开后菜单", await page.eval(MENUS));

    console.log("\n[4] 直接找「记住这个缩放」并点它");
    const pt = await page.eval(`(() => {
        const ms = [...document.querySelectorAll('.b3-menu')];
        const m = ms[ms.length - 1];
        if (!m) return { err: 'no menu' };
        const pool = [...m.querySelectorAll('.b3-menu__item')];
        const t = pool.find((e) => (e.textContent || '').includes('记住这个缩放'));
        if (!t) return { err: 'no item', texts: pool.map((e) => e.textContent) };
        const r = t.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    show("找到的坐标", pt);
    if (pt && !pt.err) {
        await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
        await page.mouse("mousePressed", pt.x, pt.y, {});
        await page.mouse("mouseReleased", pt.x, pt.y, {});
        await sleep(1000);
        show("点完菜单", await page.eval(MENUS));
        const a = (await api("/api/attr/getBlockAttrs", { id: list })).data;
        show("块属性 custom-mindmap-view", a["custom-mindmap-view"] ?? "(无)");
    }

    console.log("\n[5] 演示模式里 Esc 该退出演示（菜单开着的时候）");
    await clickExpr(zoomLabel, 600);
    show("菜单开着", await page.eval(`document.querySelectorAll('.b3-menu').length`));
    await clickExpr(`(() => {
        const b = [...${ROOT}.querySelectorAll('.mm-icon')].find((e) => (e.dataset.mmTip || '').includes('演示模式'));
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`, 800);
    show("present", await page.eval(`${ROOT}.classList.contains('mm-present')`));
    await page.press("Escape");
    await sleep(800);
    show("Esc 后 present", await page.eval(`${ROOT}.classList.contains('mm-present')`));
    show("Esc 后菜单数", await page.eval(`document.querySelectorAll('.b3-menu').length`));
} finally {
    await chrome.close();
    await removeDoc(api, doc);
}
