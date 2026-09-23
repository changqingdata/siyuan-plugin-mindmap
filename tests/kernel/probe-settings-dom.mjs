/**
 * 只读探针：设置面板与顶栏图标的真实 DOM。
 *
 * 目的：P1-5 的验收要走「点顶栏图标 → 点菜单里的设置 → 点复制按钮」这条真路，
 * 而这两处的类名（思源的 Setting 渲染成什么、addTopBar 挂在哪）不能靠记忆猜。
 *
 * 用法：node tests/kernel/probe-settings-dom.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";

const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
void conf;

const chrome = await launch({ headless: true, port: 9366, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage("http://127.0.0.1:6806/stage/build/desktop/");
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2500);

    console.log("=== 1. 顶栏候选 ===");
    const tops = await page.eval(`(() => {
        const out = [];
        for (const el of document.querySelectorAll('#barWorkspace *, .toolbar *, [data-type="topbar"] *')) {
            const t = el.getAttribute('title') || el.getAttribute('aria-label') || '';
            const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || '');
            if (String(cls).includes('iconListTree') || String(t).includes('大纲导图') || String(t).includes('导图')) {
                const r = el.getBoundingClientRect();
                out.push({ tag: el.tagName, cls: String(cls).slice(0, 120), title: t, id: el.id, parentCls: String(el.parentElement?.className || '').slice(0, 80), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
            }
        }
        return out;
    })()`);
    console.log(JSON.stringify(tops, null, 2));

    console.log("\n=== 2. 点它 → 菜单 ===");
    const clicked = await page.eval(`(() => {
        const el = document.querySelector('.toolbar [id^="plugin_siyuan-plugin-mindmap"]')
            || [...document.querySelectorAll('.toolbar *')].find((e) => (e.getAttribute('title') || '') === '大纲导图');
        if (!el) return false;
        el.click();
        return true;
    })()`);
    console.log("点到了:", clicked);
    await sleep(900);
    const menu = await page.eval(`(() => {
        const m = document.querySelector('.b3-menu');
        if (!m) return { on: false, html: document.querySelectorAll('.b3-menu').length };
        return { on: true, cls: String(m.className), items: [...m.querySelectorAll('.b3-menu__item')].map((x) => (x.textContent || '').trim()) };
    })()`);
    console.log(JSON.stringify(menu, null, 2));

    console.log("\n=== 3. 点「设置」→ 设置面板 DOM ===");
    const hit = await page.eval(`(() => {
        const it = [...document.querySelectorAll('.b3-menu .b3-menu__item')].find((x) => (x.textContent || '').trim() === '设置');
        if (!it) return false;
        it.click();
        return true;
    })()`);
    console.log("点中了设置:", hit);
    await sleep(1400);

    const dlg = await page.eval(`(() => {
        const d = document.querySelector('.b3-dialog--open') || document.querySelector('.b3-dialog');
        if (!d) return { on: false, dialogs: document.querySelectorAll('.b3-dialog').length };
        return {
            on: true,
            cls: String(d.className),
            labels: [...d.querySelectorAll('.b3-label')].length,
            items: [...d.querySelectorAll('.b3-label')].map((l) => {
                const t = l.querySelector('.b3-label__text');
                const btn = l.querySelector('button');
                return {
                    title: (t?.textContent || '').trim().slice(0, 40),
                    cls: String(l.className),
                    btn: btn ? (btn.textContent || '').trim() : null,
                    btnCls: btn ? String(btn.className) : null,
                    ctrl: [...l.querySelectorAll('select,input,button,span')].map((c) => c.tagName + '.' + String(c.className).slice(0, 40)).slice(0, 4),
                };
            }),
        };
    })()`);
    console.log(JSON.stringify(dlg, null, 2).slice(0, 6000));

    console.log("\n=== 4. 「复制诊断信息」这一项的完整 HTML ===");
    const one = await page.eval(`(() => {
        const d = document.querySelector('.b3-dialog--open') || document.querySelector('.b3-dialog');
        const l = [...d.querySelectorAll('.b3-label')].find((x) => (x.textContent || '').includes('只复制到剪贴板'));
        return l ? l.outerHTML : '(没找到)';
    })()`);
    console.log(one);

    console.log("\n=== 5. 弹窗标题 ===");
    const head = await page.eval(`(() => {
        const d = document.querySelector('.b3-dialog--open') || document.querySelector('.b3-dialog');
        return {
            title: (d.querySelector('.b3-dialog__header') || {}).textContent,
            bodyCls: String((d.querySelector('.b3-dialog__body') || {}).className),
            labels: [...d.querySelectorAll('.b3-label__text')].slice(0, 6).map((x) => (x.textContent || '').trim().slice(0, 30)),
        };
    })()`);
    console.log(JSON.stringify(head, null, 2));

    await page.screenshot("tests/.build/probe-settings.png");
} finally {
    await chrome.close();
}
