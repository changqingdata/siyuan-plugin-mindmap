/**
 * 只读探针：给一批候选组合做**端到端可用性体检**，输出「能不能拿来绑插件命令」。
 *
 * ## 为什么要单开一支（而不是继续用 hotkeydelivery 的第 6 节）
 *
 * `probe-hotkeydelivery.mjs` 只量「事件到不到得了 `document` 冒泡」，那只是**必要条件**。
 * 实测反例：`⇧⌘B` 到得了冒泡，但真机按下去**插件命令根本没跑** ——
 * 因为 `⇧⌘B` 是思源 `editor.general.insertBefore`（上方插入块）的默认键位，
 * Protyle 在编辑器里先处理掉了它（插了一个空段落），事件虽然继续上浮，
 * 思源的全局分发器已经不再认它。
 *
 * 所以「能用」的判据是三条**同时**成立：
 *
 * | # | 判据 | 不满足时的症状 |
 * | --- | --- | --- |
 * | 1 | keydown 到得了 `document` **冒泡** | 匹配器收不到 ⇒ 毫无反应（`⇧⌘S` 就是这样） |
 * | 2 | 到冒泡时**没有被 `preventDefault`** | 别人已经处理过了 ⇒ 命令轮不到（`⇧⌘B`） |
 * | 3 | 按下之后**没有别的内核请求** | 有副作用 ⇒ 某个内置命令被触发了 |
 *
 * 另外顺带量第 4 条：**思源 keymap 里有没有人占这个组合**（内置各作用域 + 其它插件）——
 * 这是最直接的信号，但必须**递归**读（`keymap.editor` 是两层结构，
 * 只读一层会把整个 `editor.*` 漏掉，本项目的键位事故就是这么来的）。
 *
 * 用法：node tests/kernel/probe-hotkey-candidates.mjs
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

/**
 * 候选表。
 * ⚠️ 刻意**不扫** `⇧⌘W`（Electron 里会关掉窗口）、`⇧⌘R`（硬重载）、`⇧⌘Q`、
 * `⇧⌘I`（DevTools，会把 CDP 会话搞乱）—— 这几支要么毁页面、要么毁探针自己。
 */
const CANDIDATES = [
    { combo: { key: "d", ctrl: true, shift: true }, label: "⇧⌘D", note: "当前默认（导图开关）" },
    { combo: { key: "o", ctrl: true, shift: true }, label: "⇧⌘O" },
    { combo: { key: "v", ctrl: true, shift: true }, label: "⇧⌘V" },
    { combo: { key: "x", ctrl: true, shift: true }, label: "⇧⌘X" },
    { combo: { key: "z", ctrl: true, shift: true }, label: "⇧⌘Z" },
    { combo: { key: "b", ctrl: true, shift: true }, label: "⇧⌘B", note: "★ 反例：被 insertBefore 抢走" },
    { combo: { key: "s", ctrl: true, shift: true }, label: "⇧⌘S", note: "★ 反例：死在 Protyle 层" },
    { combo: { key: "d", ctrl: true, alt: true, shift: true }, label: "⌥⇧D" },
    { combo: { key: "o", ctrl: true, alt: true, shift: true }, label: "⌥⇧O" },
    { combo: { key: "v", ctrl: true, alt: true, shift: true }, label: "⌥⇧V" },
];

/** 补发裸修饰键再发字母 —— 真机等价物 */
async function combo(page, { key, ctrl = false, alt = false, shift = false }) {
    const bits = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const code = `Key${key.toUpperCase()}`;
    const vk = key.toUpperCase().charCodeAt(0);
    const held = [];
    if (ctrl) held.push({ key: "Control", code: "ControlLeft", vk: 17 });
    if (alt) held.push({ key: "Alt", code: "AltLeft", vk: 18 });
    if (shift) held.push({ key: "Shift", code: "ShiftLeft", vk: 16 });
    for (const m of held) await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk, modifiers: bits });
    await sleep(120);
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    for (const m of [...held].reverse()) await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk, modifiers: 0 });
}

const md = ["- 甲一", "  - 甲二", "- 乙一", "- 乙二", "- 丙一", "- 丙二", ""].join("\n");
const docId = (await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-cand-${Date.now()}`, markdown: md })).data;
const listId = (await kids(docId)).find((k) => k.type === "l").id;
const firstLi = (await kids(listId)).find((k) => k.type === "i").id;
console.log(`临时文档 ${docId}\n列表 ${listId}\n`);

const chrome = await launch({ headless: true, port: 9471, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2600);

    /* ---- 递归读思源 keymap（★ 必须递归：keymap.editor 是两层结构）---- */
    const km = await page.eval(`(() => {
        const km = window.siyuan.config.keymap || {};
        const eff = (v) => { if (!v) return ''; if (typeof v === 'string') return v; return (typeof v.custom === 'string' && v.custom) || (typeof v.default === 'string' ? v.default : ''); };
        const rows = [];
        const walk = (scope, obj) => {
            for (const [k, v] of Object.entries(obj || {})) {
                if (!v || typeof v !== 'object') continue;
                if ('custom' in v || 'default' in v) { const key = eff(v); if (key) rows.push({ scope, id: k, key }); }
                else walk(scope + '.' + k, v);
            }
        };
        for (const [name, val] of Object.entries(km)) { if (name !== 'plugin') walk(name, val); }
        const plugins = [];
        for (const [name, cmds] of Object.entries(km.plugin || {})) {
            for (const [id, v] of Object.entries(cmds || {})) { const key = eff(v); if (key) plugins.push({ plugin: name, id, key }); }
        }
        return { rows, plugins };
    })()`);
    const norm = (s) => String(s || "").replace(/ /g, "␣");
    const occupied = (label) => {
        const k = norm(label);
        const hit = km.rows.filter((r) => norm(r.key) === k).map((r) => `${r.scope}/${r.id}`);
        const pl = km.plugins.filter((p) => norm(p.key) === k).map((p) => `${p.plugin}/${p.id}`);
        return [...hit, ...pl];
    };

    /* ---- 装仪器：keydown 捕获/冒泡 + preventDefault + 内核请求 ---- */
    await page.eval(`(() => {
        window.__k = [];
        window.__net = [];
        document.addEventListener('keydown', (e) => {
            window.__k.push({
                key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey,
                preventedAtCapture: e.defaultPrevented, preventedAtBubble: null, reachedBubble: false,
                target: (e.target && (e.target.className || e.target.tagName)) + '',
            });
        }, true);
        document.addEventListener('keydown', (e) => {
            const a = window.__k;
            for (let i = a.length - 1; i >= 0; i--) {
                if (!a[i].reachedBubble) { a[i].reachedBubble = true; a[i].preventedAtBubble = e.defaultPrevented; break; }
            }
        }, false);
        const of = window.fetch;
        window.fetch = function () {
            try {
                const a = arguments[0];
                const u = typeof a === 'string' ? a : (a && a.url) || '';
                const i = u.indexOf('/api/');
                if (i >= 0 && u.indexOf('/api/query/sql') < 0) window.__net.push(u.slice(i));
            } catch (e) { /* 仪器不干扰被测对象 */ }
            return of.apply(this, arguments);
        };
        return true;
    })()`);

    /* 光标放进列表：这才是快捷键真正的使用场景（Protyle 会介入的那一层） */
    const caret = await page.eval(`(() => {
        const li = document.querySelector('.protyle-wysiwyg .li[data-node-id="${firstLi}"]');
        if (!li) return { err: 'no li' };
        const p = li.querySelector(':scope > .protyle-wysiwyg > div') || li;
        const r = p.getBoundingClientRect();
        return { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) };
    })()`);
    await page.mouse("mouseMoved", caret.x, caret.y, { buttons: 0 });
    await page.mouse("mousePressed", caret.x, caret.y, { clickCount: 1 });
    await page.mouse("mouseReleased", caret.x, caret.y, { clickCount: 1 });
    await sleep(800);

    const results = [];
    for (const c of CANDIDATES) {
        const k0 = await page.eval("window.__k.length");
        const n0 = await page.eval("window.__net.length");
        await combo(page, c.combo);
        await sleep(500);
        const recs = await page.eval(`window.__k.slice(${k0})`);
        const net = await page.eval(`window.__net.slice(${n0})`);
        const letter = recs.find((r) => r.key && r.key.length === 1);
        const occ = occupied(c.label);
        const delivered = !!letter && letter.reachedBubble;
        /* ⚠️ 判「有没有别的命令被触发」时必须排掉两类请求，它们都**不是命令**：
         *
         * 1. `/api/attr/*` —— 插件自己的命令跑起来就会写块属性（`setBlockAttrs`），
         *    那是**命令跑了的证据**，不是副作用。不排掉的话基线键 `⇧⌘D` 会被误判成
         *    「有副作用」，而真正该报红的 `/api/transactions`（别人插了个块）反而被混在一起看不清。
         * 2. `/api/block/getBlocksWordCount` / `getContentWordCount` / `getTreeStat`
         *    —— **思源底部状态栏的字数统计**在刷新。它在「当前块选择变了」时被调用
         *    （实测调用点：`main.*.js` 里 `#status` 那一块，选中若干块就发
         *    `getBlocksWordCount({ids})` 去更新「N 字」）。任何改变选择的命令都会带上它，
         *    包括本插件自己的 `⇧⌘X`（打开并排面板）。
         *    ⚠️ 这一条是**实测踩出来的**：没排掉时 `⇧⌘X` 被标成「⚠ 有副作用」，
         *    看起来像有别的命令抢键，害得人去翻 keymap —— 而 keymap 里
         *    `⇧⌘X` 只有本插件一条（`probe-keymap-dump.mjs` 可证）。
         */
        const NOT_A_COMMAND = /^\/api\/attr\/|^\/api\/block\/getBlocksWordCount|^\/api\/block\/getContentWordCount|^\/api\/block\/getTreeStat/;
        const foreign = net.filter((u) => !NOT_A_COMMAND.test(u));
        const sideEffect = foreign.length > 0;
        const verdict = !letter
            ? "✗ 没到渲染层"
            : !delivered
              ? "✗ 被中途吞掉"
              : letter.preventedAtBubble
                ? "✗ 别人已处理（preventDefault）"
                : sideEffect
                  ? "⚠ 有副作用（别的命令被触发）"
                  : "✓ 可用";
        results.push({
            label: c.label,
            note: c.note,
            occ,
            delivered,
            prevented: letter ? letter.preventedAtBubble : null,
            foreign,
            pluginWrote: net.some((u) => u.startsWith("/api/attr/setBlockAttrs")),
            verdict,
        });

        /* 收尾：万一有键打开了面板/对话框，按 Esc 收掉，别让状态串味 */
        await page.press("Escape").catch(() => {});
        await sleep(200);
    }

    console.log("\n\n════════ 候选体检结果 ════════\n");
    console.log("  组合    到冒泡  冒泡时prevented  别的命令的副作用   思源侧占用                          结论");
    for (const r of results) {
        const occ = r.occ.length ? r.occ.join(", ") : "（无）";
        const fx = r.foreign.length ? r.foreign.join(",") : (r.pluginWrote ? "无（本插件写了属性）" : "无");
        console.log(
            `  ${r.label.padEnd(6)}  ${String(r.delivered).padEnd(6)}  ${String(r.prevented).padEnd(15)}  ${fx.padEnd(18)}  ${occ.padEnd(34)}  ${r.verdict}`,
        );
    }
    console.log("\n  「可用」= 到冒泡 ✓ + 冒泡时未被 preventDefault ✓ + 没有**别的命令**的副作用 ✓");
    console.log("  再加上「思源侧占用 =（无）」，才是一个能拿来当默认值的组合。");
    console.log("  ⚠️ 两类请求不算副作用（它们都不是命令）：`/api/attr/*` —— 本插件自己的命令写的块属性；");
    console.log("     `/api/block/get*WordCount` / `getTreeStat` —— 思源底部状态栏在刷新字数（选择一变就会发）。\n");
    for (const r of results) if (r.note) console.log(`  注 ${r.label}：${r.note}`);

    await page.screenshot("tests/.build/probe-hotkey-candidates.png");
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("\n已清理临时文档");
}
