/**
 * 只读探针：`migrateLegacy`（迁移【自定义块样式】的列表导图标记）到底走不走得通？
 *
 * ## 为什么要单独探一次
 *
 * 这是**三条命令里唯一会写数据的一条**（把 `custom-block-list-view="map"` 换成
 * `custom-mindmap`），而它此前只有「命令面板里标签显示中文」这一条断言 ——
 * 典型的「有实现、没断言」。真机上它有三个可能翻车的地方，肉眼看不出来：
 *
 *   ① 它是**从 DOM 读属性**（`document.querySelectorAll('.list[custom-block-list-view]')`），
 *      不是从内核查。思源会不会把自定义块属性渲染到 `.list` 元素上？如果不会，
 *      这条命令在真机上永远命中 0 个 —— 标签再漂亮也是死的。
 *   ② 迁移后 `runMigration` 里那句 `setTimeout(() => scanner.scanAll(), 150)`
 *      有没有真的把导图挂上去（还是只改了属性、画面没反应）。
 *   ③ 没有 legacy 标记时，是给出「没有找到…」还是静默失败。
 *
 * 本探针只 dump 真相，不做断言。判据确认后再补进 `diag-commands.mjs`。
 *
 * 用法：node tests/kernel/probe-migrate-command.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const OUT = "tests/.build";

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
const kids = async (id) => (await api("/api/block/getChildBlocks", { id })).data ?? [];
const attrsOf = async (id) => (await api("/api/attr/getBlockAttrs", { id })).data ?? {};

/* ---------------------------------------------------------------- fixture
 * 两个列表：A 打 `map`（应当被迁移），B 打 `table`（**不该被迁移**）。
 * B 这条是设计意图 —— 源码里写着「只迁移导图视图，表格 / 看板保持原样」，
 * 而这条注释此前没有任何测试兜着。
 */
const md = ["- 甲一", "  - 甲二", "  - 甲三", "- 乙一", "- 乙二", "", "分开两段", "", "- 丙一", "  - 丙二", "- 丁一", "- 丁二", ""].join("\n");
const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-迁移命令-${Date.now()}`,
    markdown: md,
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;

const allLists = (await kids(docId)).filter((k) => k.type === "l");
const listId = allLists[0].id;
const listB = allLists[1].id;
console.log(`临时文档 ${docId}\n列表A（map，应迁移） ${listId}\n列表B（table，应原样保留） ${listB}\n`);

/* ---- 用内核 API 打上【自定义块样式】的标记（模拟「用户以前用过那个插件」）---- */
const setRes = await api("/api/attr/setBlockAttrs", {
    id: listId,
    attrs: { "custom-block-list-view": "map" },
});
const setResB = await api("/api/attr/setBlockAttrs", {
    id: listB,
    attrs: { "custom-block-list-view": "table" },
});
console.log(`打 legacy 标记：A code=${setRes.code} / B code=${setResB.code}`);
await sleep(600);
console.log(`内核属性 A：${JSON.stringify(await attrsOf(listId))}`);
console.log(`内核属性 B：${JSON.stringify(await attrsOf(listB))}\n`);

/** 页面侧：legacy 标记 / 我们的标记 / 挂了几张图 */
const one = (id) => `(() => {
    const l = document.querySelector('.protyle-wysiwyg .list[data-node-id="${id}"]');
    return {
        listFound: !!l,
        legacy: l ? l.getAttribute('custom-block-list-view') : '(no list)',
        view: l ? l.getAttribute('custom-mindmap') : '(no list)',
    };
})()`;
const DUMP = `(() => {
    const legacyLists = document.querySelectorAll('.protyle-wysiwyg .list[custom-block-list-view]');
    return {
        A: ${one(listId)},
        B: ${one(listB)},
        legacyCount: legacyLists.length,
        legacyVals: [...legacyLists].map((x) => x.getAttribute('custom-block-list-view')),
        mmRoots: document.querySelectorAll('.mm-root').length,
        mmNodes: document.querySelectorAll('.mm-root .mm-node').length,
    };
})()`;

const chrome = await launch({ headless: true, port: 9382, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2400);

    console.log("【① 思源会不会把 custom-* 渲染到 .list 上？】");
    let dump = await page.eval(DUMP);
    console.log("  " + JSON.stringify(dump));
    if (dump.legacyCount === 0) {
        console.log("  → 内核改了但 DOM 没跟上，重载页面再看（属性是渲染期读的）");
        await page.send("Page.reload");
        await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 60000, label: "重载后编辑器" });
        await sleep(2600);
        dump = await page.eval(DUMP);
        console.log("  " + JSON.stringify(dump));
    }
    console.log("\n【② 从命令面板（⌥⇧P）真实触发这条命令】");
    /* 发键要显式补发修饰键，否则唤不起思源的全局快捷键（见 probe-keydispatch.mjs） */
    async function combo(key, { ctrl = false, alt = false, shift = false } = {}) {
        const bits = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
        const code = `Key${key.toUpperCase()}`;
        const vk = key.toUpperCase().charCodeAt(0);
        const held = [];
        if (ctrl) held.push({ key: "Control", code: "ControlLeft", vk: 17 });
        if (alt) held.push({ key: "Alt", code: "AltLeft", vk: 18 });
        if (shift) held.push({ key: "Shift", code: "ShiftLeft", vk: 16 });
        for (const m of held) await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk, modifiers: bits });
        await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
        await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
        for (const m of [...held].reverse()) await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk, modifiers: 0 });
        await sleep(150);
    }

    await combo("p", { alt: true, shift: true });
    await sleep(1500);
    const palette = await page.eval(`!!document.querySelector('.b3-dialog--open')`);
    console.log(`  命令面板：${palette ? "已打开" : "没打开 ✗"}`);

    await page.eval(`(() => {
        const i = document.querySelector('.b3-dialog--open input');
        if (!i) return false;
        i.focus(); i.value = '迁移';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    })()`);
    await sleep(1300);
    const rows = await page.eval(`[...document.querySelectorAll('.b3-dialog--open .b3-list-item')].map((x) => (x.textContent || '').trim())`);
    console.log(`  搜「迁移」命中 ${rows.length} 条：${JSON.stringify(rows)}`);

    const clicked = await page.eval(`(() => {
        const it = [...document.querySelectorAll('.b3-dialog--open .b3-list-item')].find((x) => (x.textContent || '').includes('迁移'));
        if (!it) return { err: 'no item' };
        const r = it.getBoundingClientRect();
        const opt = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        it.dispatchEvent(new MouseEvent('mousedown', opt));
        it.dispatchEvent(new MouseEvent('mouseup', opt));
        it.click();
        return { ok: true, text: (it.textContent || '').trim() };
    })()`);
    console.log(`  点击结果：${JSON.stringify(clicked)}`);

    /* 迁移后要写内核 + 内核回推 + scanAll，轮询等一等 */
    await sleep(1200);
    for (let i = 0; i < 16; i++) {
        dump = await page.eval(DUMP);
        if (dump.view !== null && dump.view !== "(no list)") break;
        await sleep(400);
    }

    console.log("\n【③ 迁移后】");
    console.log("  页面：" + JSON.stringify(dump));
    console.log("  内核 A：" + JSON.stringify(await attrsOf(listId)));
    console.log("  内核 B：" + JSON.stringify(await attrsOf(listB)));
    const toast = await page.eval(`[...document.querySelectorAll('[class*="snackbar"]')].map((x) => (x.textContent || '').trim()).join(' | ')`);
    console.log("  提示：" + JSON.stringify(toast));

    /* ---- ④ 再点一次：已经没有 legacy 标记了，应当是「没有找到…」而不是静默 ---- */
    console.log("\n【④ 没有 legacy 标记时再点一次】");
    await combo("p", { alt: true, shift: true });
    await sleep(1400);
    await page.eval(`(() => {
        const i = document.querySelector('.b3-dialog--open input');
        if (!i) return false;
        i.focus(); i.value = '迁移';
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    })()`);
    await sleep(1200);
    await page.eval(`(() => {
        const it = [...document.querySelectorAll('.b3-dialog--open .b3-list-item')].find((x) => (x.textContent || '').includes('迁移'));
        if (!it) return false;
        const r = it.getBoundingClientRect();
        const opt = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        it.dispatchEvent(new MouseEvent('mousedown', opt));
        it.dispatchEvent(new MouseEvent('mouseup', opt));
        it.click();
        return true;
    })()`);
    await sleep(1600);
    console.log("  页面：" + JSON.stringify(await page.eval(DUMP)));
    const toast2 = await page.eval(`[...document.querySelectorAll('[class*="snackbar"]')].map((x) => (x.textContent || '').trim()).join(' | ')`);
    console.log("  提示：" + JSON.stringify(toast2));

    /* ---- ⑤ 提示为什么会出现「重复计数」？是 DOM 嵌套，还是命令被触发了好几次？----
       （后者会重复写属性，是真 bug —— 必须分清楚，否则断言会写歪） */
    console.log("\n【⑤ snackbar 的真实 DOM 形状】");
    const snackDom = await page.eval(`[...document.querySelectorAll('[class*="snackbar"]')].map((x) => ({ cls: x.className, tag: x.tagName, text: (x.textContent || '').trim(), kids: x.children.length }))`);
    for (const s of snackDom) console.log(`  <${s.tag}> .${s.cls}  kids=${s.kids}  "${s.text.slice(0, 30)}"`);

    await page.screenshot(`${OUT}/probe-migrate-command.png`);
    console.log(`\n截图 ${OUT}/probe-migrate-command.png`);
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}
