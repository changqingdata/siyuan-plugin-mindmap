/**
 * 只读探针：两件事，都和键盘焦点有关。
 *
 * ## 一、导图会不会把 `⌥⌘<key>` 一起吃掉？
 *
 * `renderer.ts` 的 onKeyDown 里，判据 `mod = ctrlKey || metaKey` 若不排除
 * `altKey`，则 ⌥⌘A / ⌥⌘C / ⌥⌘X 会分别命中导图自己的 Ctrl+A（全选节点）、
 * Ctrl+C（复制节点）、Ctrl+X（**剪掉选中节点的子树**）——最后一个等于静默删用户笔记。
 *
 * 为什么要单独探：把这条判据塞进 `diag-commands.mjs` 的 G 段后，我拿「回退版」
 * 去验它「能不能红」，结果是红的 —— 但红错了地方（基线选中就没建立，三条断言
 * 变成「因为没焦点所以什么都没发生」的假绿）。**判据本身必须先被证明能红**，
 * 所以这里做成一支不依赖任何前置章节的独立探针。
 *
 * 结论（对照版 `modOnly = mod` vs 修复版 `modOnly = mod && !e.altKey`）：
 *
 *   | 按键 | 回退版（有 bug）        | 修复版 |
 *   |------|------------------------|--------|
 *   | ⌥⌘A | `.mm-multi` 0 → 2      | 0 → 0  |
 *   | ⌥⌘C | 剪贴板写入 0 → 1       | 0 → 0  |
 *   | ⌥⌘X | 内核列表项数 3 → 2     | 3 → 3  |
 *
 * ## 二、★ 顺带挖出来的真 bug：真实键盘下导图的 Ctrl 系列快捷键全部失灵
 *
 * 真实键盘按 Ctrl+D 会**先**产生一个 `key === "Control"` 的 keydown。这一下导图
 * 没有任何动作可做（不会 preventDefault），可思源的编辑器照样在这个 keydown 里
 * focus 自己 —— 焦点被抢到 `.protyle-wysiwyg`，而它**是 `.mm-root` 的祖先**，
 * 于是紧接着的 `D` 那一下 target 已经不在导图里，`handleGlobalKey` 开头就 return。
 *
 *   | 发法 | 焦点 | 内核列表项数 | 插件收到？ |
 *   |------|------|-------------|-----------|
 *   | 真键盘式 Ctrl+D（先 ControlLeft） | mm-root → **protyle-wysiwyg** | 3 → 3 | ❌ |
 *   | 单事件 Ctrl+D（只发字母 + modifiers） | mm-root → mm-txt | 3 → 4 | ✅ |
 *
 * 而 `tests/` 里所有键盘用例用的都是**单事件**发法（`page.press` 那一路），
 * 没有裸修饰键那一下，焦点不会丢 —— 所以这个 bug 一直被测试掩盖着。
 * 修复见 `renderer.ts` 的 `handleGlobalKey` / `restoreFocus`（修饰键那一下也要抢回焦点）。
 *
 * ## 三、还有一个「假红」的坑：零间隔连发不等于真实键盘
 *
 * 第一版 `combo()` 把「按下 Ctrl」和「按下 D」**零间隔**连发，比真人快得多，
 * 于是字母键比插件异步抢焦点（setTimeout 0 / 60 / 200ms）还早到，
 * 测出来的是「抢跑」而不是真实行为 —— 修复后仍然时红时绿。
 * 真人会按住 Ctrl 几十毫秒才按字母，所以 `combo()` 现在带一个 `gap`（默认 130ms）。
 * **补上间隔之后修复版稳定通过**（3 → 4），撤掉修复则稳定变红（3 → 3）。
 *
 * 用法：
 *   node tests/kernel/probe-altmod-swallow.mjs          # 当前部署的版本
 * 对照：
 *   把 renderer.ts 的 `modOnly` 临时改成 `mod`（验第一条），
 *   或把 `handleGlobalKey` 里的 `MODIFIER_ONLY_KEYS` 分支注释掉（验第二条），
 *   build + deploy 后再跑一次。
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
const kids = async (id) => (await api("/api/block/getChildBlocks", { id })).data ?? [];

const md = ["- 甲一", "  - 甲二", "  - 甲三", "- 乙一", "- 乙二", ""].join("\n");
const docRes = await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-altmod-${Date.now()}`, markdown: md });
const docId = docRes.data;
const listId = (await kids(docId)).find((k) => k.type === "l").id;
const firstLi = (await kids(listId)).find((k) => k.type === "i").id;
console.log(`临时文档 ${docId}\n列表 ${listId}（${(await kids(listId)).length} 项）\n首项 ${firstLi}\n`);

/**
 * 补发裸修饰键的 keydown，再发字母 —— 真实键盘的顺序。
 *
 * `gap` 是「按下修饰键」到「按下字母」的间隔。**必须留出间隔**：
 * 真人会按住 Ctrl 几十毫秒才按字母，而插件抢回焦点是异步的（setTimeout 0 / 60 / 200ms），
 * 零间隔连发时字母键可能比抢焦点还早到，测出来的是「抢跑」而不是真实行为。
 */
async function combo(page, key, { ctrl = false, alt = false, shift = false, gap = 130 } = {}) {
    const bits = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const code = `Key${key.toUpperCase()}`;
    const vk = key.toUpperCase().charCodeAt(0);
    const held = [];
    if (ctrl) held.push({ key: "Control", code: "ControlLeft", vk: 17 });
    if (alt) held.push({ key: "Alt", code: "AltLeft", vk: 18 });
    if (shift) held.push({ key: "Shift", code: "ShiftLeft", vk: 16 });
    for (const m of held) await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk, modifiers: bits });
    if (gap) await sleep(gap);
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    for (const m of [...held].reverse()) await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk, modifiers: 0 });
    await sleep(160);
}
const altMod = (page, key) => combo(page, key, { ctrl: true, alt: true });

/**
 * 单事件发键：**不补发修饰键的 keydown**，只在字母那一下带上 modifiers 位。
 *
 * 为什么两种都要有：补发裸修饰键的 keydown 时，实测焦点会被踢出 `.mm-root`
 * （落到 `.protyle-wysiwyg`），于是后续字母键的 target 不在导图里，
 * `handleGlobalKey` 直接 return —— 探针看起来「插件没反应」，其实插件根本没收到。
 * 两种发键方式的结果要分开看，不能混。
 */
async function comboSingle(page, key, { ctrl = false, alt = false, shift = false } = {}) {
    const bits = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const code = `Key${key.toUpperCase()}`;
    const vk = key.toUpperCase().charCodeAt(0);
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    await sleep(180);
}
const altModSingle = (page, key) => comboSingle(page, key, { ctrl: true, alt: true });

const chrome = await launch({ headless: true, port: 9384, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2400);

    /* 把光标放进列表项，再用插件自己的 ⌥⌘D 开导图 —— 不靠写属性，走真路径 */
    const caret = await page.eval(`(() => {
        const li = document.querySelector('.protyle-wysiwyg .li[data-node-id="${firstLi}"]');
        if (!li) return { err: 'no li' };
        const p = li.querySelector(':scope > .protyle-wysiwyg > p, :scope > p') || li;
        const r = p.getBoundingClientRect();
        return { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) };
    })()`);
    await page.mouse("mouseMoved", caret.x, caret.y, { buttons: 0 });
    await page.mouse("mousePressed", caret.x, caret.y, { clickCount: 1 });
    await page.mouse("mouseReleased", caret.x, caret.y, { clickCount: 1 });
    await sleep(600);
    await altMod(page, "d");
    await sleep(2200);
    console.log(`导图：${await page.eval(`document.querySelectorAll('.mm-root .mm-node').length`)} 个节点，选中 ${await page.eval(`document.querySelectorAll('.mm-node.mm-sel').length`)} 个`);

    /* 选中一个**有真 id** 的节点（虚拟根点不动，用它当选不上） */
    const pt = await page.eval(`(() => {
        const n = document.querySelector('.mm-root .mm-node[data-mm-id="${firstLi}"]') || document.querySelector('.mm-root .mm-node[data-mm-id]');
        if (!n) return { err: 'no node with data-mm-id' };
        n.scrollIntoView({ block: 'center' });
        const r = n.getBoundingClientRect();
        return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
    })()`);
    console.log(`节点定位：${JSON.stringify(pt)}`);
    for (let i = 0; i < 6; i++) {
        await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
        await page.mouse("mousePressed", pt.x, pt.y, { clickCount: 1 });
        await page.mouse("mouseReleased", pt.x, pt.y, { clickCount: 1 });
        await sleep(500);
        await page.eval(`(() => { const r = document.querySelector('.mm-root'); if (r) r.focus({ preventScroll: true }); return true; })()`);
        const n = await page.eval(`document.querySelectorAll('.mm-root .mm-node.mm-sel').length`);
        if (n >= 1) break;
    }
    const sel0 = await page.eval(`document.querySelectorAll('.mm-root .mm-node.mm-sel').length`);
    const items0 = (await kids(listId)).length;
    const nodes0 = await page.eval(`document.querySelectorAll('.mm-root .mm-node').length`);
    console.log(`\n基线：选中 ${sel0} 个 / 画布 ${nodes0} 个节点 / 内核 ${items0} 项\n`);

    /* 钩住剪贴板，看 ⌥⌘C 会不会真的写进去 */
    await page.eval(`(() => {
        if (window.__mmCopyHook) return true;
        window.__mmCopyHook = true; window.__mmCopies = 0;
        try { const oe = document.execCommand.bind(document); document.execCommand = (c, ...r) => { if (c === 'copy') window.__mmCopies++; return oe(c, ...r); }; } catch (e) {}
        try { if (navigator.clipboard && navigator.clipboard.writeText) { const ow = navigator.clipboard.writeText.bind(navigator.clipboard); navigator.clipboard.writeText = (t) => { window.__mmCopies++; return ow(t); }; } } catch (e) {}
        return true;
    })()`);

    /* ---- 内省：每次按键的真实 target / 有没有被插件 preventDefault ----
       `handleGlobalKey` 要求 `rootEl.contains(e.target)`，所以「焦点在哪」
       决定了按键到底有没有机会被插件看到。不记这个，红/绿都说不清原因。 */
    await page.eval(`(() => {
        if (window.__mmKeyLog) return true;
        window.__mmKeyLog = true;
        window.__mmKeys = [];
        document.addEventListener('keydown', (e) => {
            const r = document.querySelector('.mm-root');
            window.__mmKeys.push({
                key: e.key, alt: e.altKey, ctrl: e.ctrlKey,
                target: (e.target && (e.target.className || e.target.tagName)) + '',
                inRoot: !!r && r.contains(e.target),
                active: (document.activeElement && (document.activeElement.className || document.activeElement.tagName)) + '',
                preventedBefore: e.defaultPrevented,
            });
        }, true);
        document.addEventListener('keydown', () => {
            const a = window.__mmKeys;
            if (a.length) a[a.length - 1].preventedAfter = true;
        }, false);
        return true;
    })()`);

    for (const k of ["a", "c", "x", "d"]) {
        /* 每个键都重新把「焦点 + 选中」建立起来：上一下按键可能已经把焦点踢走 */
        let selBefore = 0;
        for (let i = 0; i < 6 && selBefore < 1; i++) {
            await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
            await page.mouse("mousePressed", pt.x, pt.y, { clickCount: 1 });
            await page.mouse("mouseReleased", pt.x, pt.y, { clickCount: 1 });
            await sleep(450);
            await page.eval(`(() => { const r = document.querySelector('.mm-root'); if (r) r.focus({ preventScroll: true }); return true; })()`);
            await sleep(200);
            selBefore = await page.eval(`document.querySelectorAll('.mm-root .mm-node.mm-sel').length`);
        }
        const itemsBefore = (await kids(listId)).length;
        const activeBefore = await page.eval(`(document.activeElement && (document.activeElement.className || document.activeElement.tagName)) + ''`);
        const multiBefore = await page.eval(`document.querySelectorAll('.mm-root .mm-node.mm-multi').length`);
        await altModSingle(page, k);
        await sleep(1300);
        const selAfter = await page.eval(`document.querySelectorAll('.mm-root .mm-node.mm-sel').length`);
        const multiAfter = await page.eval(`document.querySelectorAll('.mm-root .mm-node.mm-multi').length`);
        const itemsAfter = (await kids(listId)).length;
        const copies = await page.eval(`window.__mmCopies`);
        const lastKey = await page.eval(`window.__mmKeys[window.__mmKeys.length - 1]`);
        console.log(`⌥⌘${k.toUpperCase()}（单事件）：主选中 ${selBefore} → ${selAfter}｜多选 .mm-multi ${multiBefore} → ${multiAfter}｜内核 ${itemsBefore} → ${itemsAfter}｜剪贴板累计 ${copies}`);
        console.log(`        按键前焦点=${activeBefore}｜本次按键=${JSON.stringify(lastKey)}`);
    }

    const keys = await page.eval(`window.__mmKeys`);
    console.log(`\n共记录到 ${keys.length} 次 keydown：`);
    for (const k of keys) console.log(`  ${JSON.stringify(k)}`);

    /* ---- 第三相：真键盘式（补发裸修饰键）的 Ctrl+D 到底能不能到插件？----
       这一相回答的是「用户真的按 Ctrl+D 时导图还收不收得到」：
       收不到的话，插件的 Ctrl+A/C/V/X/D 在真机上**全部失灵**。
       判断依据：复制节点生效 → 内核列表项数增加。

       必须**另开一页干净起跑**：上面几相已经按过一堆组合键，会留下浮层 / 弹窗，
       焦点早就不知道飘到哪了（第一版就因为这个把焦点测成了 `b3-dialog__container`）。 */
    console.log("\n【真键盘式 Ctrl+D（补发 ControlLeft 的 keydown）· 另开一页干净起跑】");
    const page2 = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page2.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2600);

    const caret2 = await page2.eval(`(() => {
        const li = document.querySelector('.protyle-wysiwyg .li[data-node-id="${firstLi}"]');
        if (!li) return { err: 'no li' };
        const p = li.querySelector(':scope > .protyle-wysiwyg > p, :scope > p') || li;
        const r = p.getBoundingClientRect();
        return { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) };
    })()`);
    await page2.mouse("mouseMoved", caret2.x, caret2.y, { buttons: 0 });
    await page2.mouse("mousePressed", caret2.x, caret2.y, { clickCount: 1 });
    await page2.mouse("mouseReleased", caret2.x, caret2.y, { clickCount: 1 });
    await sleep(600);
    await altMod(page2, "d");
    await sleep(2400);
    console.log(`导图：${await page2.eval(`document.querySelectorAll('.mm-root .mm-node').length`)} 个节点`);

    const pt2 = await page2.eval(`(() => {
        const n = document.querySelector('.mm-root .mm-node[data-mm-id="${firstLi}"]') || document.querySelector('.mm-root .mm-node[data-mm-id]');
        if (!n) return { err: 'no node' };
        n.scrollIntoView({ block: 'center' });
        const r = n.getBoundingClientRect();
        return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
    })()`);
    let selNow = 0;
    for (let i = 0; i < 6 && selNow < 1; i++) {
        await page2.mouse("mouseMoved", pt2.x, pt2.y, { buttons: 0 });
        await page2.mouse("mousePressed", pt2.x, pt2.y, { clickCount: 1 });
        await page2.mouse("mouseReleased", pt2.x, pt2.y, { clickCount: 1 });
        await sleep(450);
        await page2.eval(`(() => { const r = document.querySelector('.mm-root'); if (r) r.focus({ preventScroll: true }); return true; })()`);
        await sleep(200);
        selNow = await page2.eval(`document.querySelectorAll('.mm-root .mm-node.mm-sel').length`);
    }
    const activePre = await page2.eval(`(document.activeElement && (document.activeElement.className || document.activeElement.tagName)) + ''`);
    const beforeD = (await kids(listId)).length;
    await combo(page2, "d", { ctrl: true });
    await sleep(1800);
    const afterD = (await kids(listId)).length;
    const activePost = await page2.eval(`(document.activeElement && (document.activeElement.className || document.activeElement.tagName)) + ''`);
    console.log(`选中 ${selNow} 个｜按键前焦点=${activePre}｜按键后焦点=${activePost}`);
    console.log(`内核列表项数 ${beforeD} → ${afterD}　${afterD > beforeD ? "→ 插件收到了 Ctrl+D（复制节点生效）" : "→ 插件**没收到**，焦点大概被抢走了"}`);

    /* ---- 对照组：同一个键，三种发法。差别只在「先按了哪个修饰键」----
       结论决定这件事该怎么定性：如果单事件能到、真键盘式到不了，
       那插件的 Ctrl 系列快捷键在**真实键盘下全部失灵**（只有测试能过）。 */
    async function reselect() {
        let n = 0;
        for (let i = 0; i < 6 && n < 1; i++) {
            await page2.mouse("mouseMoved", pt2.x, pt2.y, { buttons: 0 });
            await page2.mouse("mousePressed", pt2.x, pt2.y, { clickCount: 1 });
            await page2.mouse("mouseReleased", pt2.x, pt2.y, { clickCount: 1 });
            await sleep(450);
            await page2.eval(`(() => { const r = document.querySelector('.mm-root'); if (r) r.focus({ preventScroll: true }); return true; })()`);
            await sleep(200);
            n = await page2.eval(`document.querySelectorAll('.mm-root .mm-node.mm-sel').length`);
        }
        return n;
    }
    const focusNow = () => page2.eval(`(document.activeElement && (document.activeElement.className || document.activeElement.tagName)) + ''`);

    console.log("\n【对照：同一个 Ctrl+D，三种发法】");
    const cases = [
        ["真键盘式（先 ControlLeft）", () => combo(page2, "d", { ctrl: true }), true],
        ["单事件（只发字母 + modifiers）", () => comboSingle(page2, "d", { ctrl: true }), true],
        /* 这一格「插件没收到」是**正确**的：⌥⌘D 本来就该由思源全局处理（切换导图/大纲），
           导图不该接。要验的是它有没有被导图自己的 Ctrl+D 吞掉 —— 那才是 bug。 */
        ["真键盘式（先 ControlLeft + AltLeft）", () => combo(page2, "d", { ctrl: true, alt: true }), false],
    ];
    for (const [label, send, expectPlugins] of cases) {
        const sel = await reselect();
        const f0 = await focusNow();
        const i0 = (await kids(listId)).length;
        await send();
        await sleep(1800);
        const i1 = (await kids(listId)).length;
        const f1 = await focusNow();
        const got = i1 > i0;
        const verdict = got === expectPlugins ? "✅ 符合预期" : "❌ 不符合预期";
        console.log(`  ${label}　（期望：${expectPlugins ? "插件收到" : "插件不接"}）`);
        console.log(`    选中 ${sel} 个｜焦点 ${f0} → ${f1}｜内核 ${i0} → ${i1}　${verdict}`);
    }
    await page2.screenshot("tests/.build/probe-altmod-ctrl-d.png");

    await page.screenshot("tests/.build/probe-altmod-swallow.png");
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}
