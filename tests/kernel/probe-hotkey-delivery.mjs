/**
 * 只读探针：一条插件全局快捷键到底走到哪一层了 —— 用来把「按了没反应」**分层定位**。
 *
 * ## 起因
 *
 * 默认键位从 `⌘空格` / `⌥空格` 换成 `⇧⌘D` / `⇧⌘S` 之后，`diag-commands.mjs` 出现 3 条红：
 *
 *   | 断言 | 现象 |
 *   | --- | --- |
 *   | C 段「★ 并排面板打开了」 | `⇧⌘S` 之后 `.mm-side` 不存在 |
 *   | C 段「面板里真的渲染出了导图」 | 同上 |
 *   | G 段「★ ⇧⌘C：没往剪贴板写东西」 | `⇧⌘C` 竟然写了剪贴板 |
 *
 * 而 B 段（`⇧⌘D` 切换导图 / 大纲）**全绿** —— 同一族、同一种发键方式，
 * 一个通一个不通，说明不是「发键方法不对」这种笼统原因。
 *
 * ## ★★ 结论（已跑过，留档）
 *
 * `⇧⌘S` 的 keydown **到得了 `document` 捕获、到不了 `document` 冒泡**：
 *
 *   | 按键 | 到 document 捕获 | 到 document 冒泡 | 结果 |
 *   | --- | --- | --- | --- |
 *   | `⇧⌘D` | ✓ | **✓** | 导图正常切换 |
 *   | `⇧⌘S` | ✓ | **✗** | 毫无反应 |
 *
 * 因为思源的**全局快捷键匹配器挂在冒泡阶段**，而 `Ctrl+S` 那一族是
 * **Protyle（编辑器）自己的处理范围**，它在路上 `stopPropagation()`。
 * ⇒ 事件既不是被 OS/IME 吞的、也不是被 Electron 吞的，而是**思源编辑器自己截断的**。
 *
 * 第 6 节顺便扫了 14 个安全候选（`A B C E H I J K L M O V X Z`）**全部可达冒泡**，
 * 只有 `S` 这一族不行 ⇒ `⇧⌘S` 弃用，默认改成 `⇧⌘B`（`B` = Beside / 并排）。
 *
 * ⚠️ 它**只在光标位于编辑器内时失效**（焦点在文档树等别处时又能用）——
 * 又是一个「有时灵、有时不灵」，和 `⌘空格` 那轮是同一类陷阱、但不同一层。
 *
 * ## 这支探针要回答的三件事
 *
 * 1. **keydown 有没有到 `document`？到了哪一阶段？**
 *    - 到捕获、不到冒泡 ⇒ 中途有人 `stopPropagation`（本项目实测就是这种）
 *    - 压根没到渲染层 ⇒ 被 **OS/IME 或 Electron** 吃了（换键位）
 * 2. **`.mm-side` 是不是「开了但很慢」？** 每 200ms 轮询 6 秒，
 *    而不是只看一个时刻（「量时间线，不要量一个时刻」）。
 * 3. **`⇧⌘C` 到底是谁写的剪贴板？** 把 `writeText` / `execCommand` 都钩上，
 *    并且**连调用栈一起记下来** —— 只记「+1」分不清是插件还是思源。
 *
 * 三件事都必须**同一页内对照 `⇧⌘D`**：它是已知能通的，作为基线。
 *
 * 用法：node tests/kernel/probe-hotkey-delivery.mjs
 *      （或 npm run probe:hotkeydelivery）
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

/** 补发裸修饰键的 keydown，再发字母 —— `combo()` 的等价物 */
async function combo(page, key, { ctrl = false, alt = false, shift = false, gap = 130 } = {}) {
    const bits = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const code = `Key${key.toUpperCase()}`;
    const vk = key.toUpperCase().charCodeAt(0);
    const held = [];
    if (ctrl) held.push({ key: "Control", code: "ControlLeft", vk: 17 });
    if (alt) held.push({ key: "Alt", code: "AltLeft", vk: 18 });
    if (shift) held.push({ key: "Shift", code: "ShiftLeft", vk: 16 });
    for (const m of held) {
        await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk, modifiers: bits });
    }
    if (gap) await sleep(gap);
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    for (const m of [...held].reverse()) {
        await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: m.key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk, modifiers: 0 });
    }
    await sleep(140);
}

/** 单事件发键：只发字母那一下 + modifiers 位 */
async function comboSingle(page, key, { ctrl = false, alt = false, shift = false } = {}) {
    const bits = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const code = `Key${key.toUpperCase()}`;
    const vk = key.toUpperCase().charCodeAt(0);
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    await sleep(180);
}

const md = ["- 甲一", "  - 甲二", "  - 甲三", "- 乙一", "- 乙二", ""].join("\n");
const docRes = await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-hotkey-${Date.now()}`, markdown: md });
const docId = docRes.data;
const listId = (await kids(docId)).find((k) => k.type === "l").id;
const firstLi = (await kids(listId)).find((k) => k.type === "i").id;
console.log(`临时文档 ${docId}\n列表 ${listId}（${(await kids(listId)).length} 项）\n`);

const chrome = await launch({ headless: true, port: 9395, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2600);

    /* ---- 装内省：keydown 全记录 + 剪贴板钩子（带调用栈）---- */
    await page.eval(`(() => {
        window.__k = [];
        window.__clip = [];
        /* 捕获阶段记「到达时」的状态；冒泡阶段再记一次 ——
           ★ 两次的差就是「中途有没有人 stopPropagation」。
           思源的全局快捷键处理器挂在冒泡阶段，所以「事件到不了冒泡」= 快捷键必然不触发。 */
        document.addEventListener('keydown', (e) => {
            const rec = {
                key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
                target: (e.target && (e.target.className || e.target.tagName)) + '',
                preventedAtCapture: e.defaultPrevented,
                reachedBubble: false,
                preventedAfter: null,
            };
            window.__k.push(rec);
            Promise.resolve().then(() => { rec.preventedAfter = e.defaultPrevented; });
        }, true);
        document.addEventListener('keydown', () => {
            /* 冒泡阶段只标记「最后一个还没标记的记录」——一次按键对应一条记录 */
            const a = window.__k;
            for (let i = a.length - 1; i >= 0; i--) {
                if (!a[i].reachedBubble) { a[i].reachedBubble = true; break; }
            }
        }, false);
        window.addEventListener('keydown', () => {
            const a = window.__k;
            for (let i = a.length - 1; i >= 0; i--) {
                if (a[i].reachedWindow === undefined) { a[i].reachedWindow = true; break; }
            }
        }, false);
        try {
            const ow = navigator.clipboard.writeText.bind(navigator.clipboard);
            navigator.clipboard.writeText = function (t) {
                window.__clip.push({ api: 'writeText', text: String(t).slice(0, 60), stack: (new Error().stack || '').split('\\n').slice(1, 7).join(' <- ') });
                return ow(t);
            };
        } catch (e) {}
        try {
            const oe = document.execCommand.bind(document);
            document.execCommand = function (c, ...r) {
                if (c === 'copy') window.__clip.push({ api: 'execCommand', text: '', stack: (new Error().stack || '').split('\\n').slice(1, 7).join(' <- ') });
                return oe(c, ...r);
            };
        } catch (e) {}
        return true;
    })()`);

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
    await sleep(700);

    /** 按一次键，然后每 200ms 轮询一次 `.mm-side` / `.mm-root`，直到出现或超时 */
    async function pressAndWatch(label, send) {
        const k0 = await page.eval(`window.__k.length`);
        const c0 = await page.eval(`window.__clip.length`);
        await send();
        const timeline = [];
        let seenSide = false;
        let seenRoot = false;
        for (let i = 0; i < 30; i++) {
            await sleep(200);
            const s = await page.eval(`!!document.querySelector('.mm-side')`);
            const r = await page.eval(`!!document.querySelector('.mm-root')`);
            const n = await page.eval(`document.querySelectorAll('.mm-side .mm-node').length`);
            if (s && !seenSide) timeline.push(`+${(i + 1) * 200}ms .mm-side 出现（${n} 节点）`);
            if (r && !seenRoot) timeline.push(`+${(i + 1) * 200}ms .mm-root 出现`);
            seenSide = seenSide || s;
            seenRoot = seenRoot || r;
            if ((seenSide || seenRoot) && i >= 4) break;
        }
        const newKeys = await page.eval(`window.__k.slice(${k0})`);
        const newClip = await page.eval(`window.__clip.slice(${c0})`);
        console.log(`\n──── ${label} ────`);
        console.log(`  结果：.mm-side=${seenSide}　.mm-root=${seenRoot}`);
        console.log(`  时间线：${timeline.length ? timeline.join("｜") : "（6 秒内一直没出现）"}`);
        console.log(`  本页收到的 keydown（${newKeys.length} 条）：`);
        for (const k of newKeys) {
            console.log(
                `    key=${JSON.stringify(k.key)} ctrl=${k.ctrl} shift=${k.shift} alt=${k.alt} target=${k.target}` +
                    ` 到document捕获=${true} 到document冒泡=${k.reachedBubble} 到window冒泡=${!!k.reachedWindow} prevented=${k.preventedAfter}`,
            );
        }
        if (newClip.length) {
            console.log(`  ★ 剪贴板被写了 ${newClip.length} 次：`);
            for (const c of newClip) console.log(`    [${c.api}] "${c.text}"\n      ${c.stack}`);
        } else {
            console.log("  剪贴板：没被动过");
        }
        return { seenSide, seenRoot };
    }

    /* ============ 1. 基线：⇧⌘D（已知能通）============ */
    console.log("\n【1 基线 ⇧⌘D —— 补发裸修饰键的 combo()】");
    await pressAndWatch("⇧⌘D / combo", () => combo(page, "d", { ctrl: true, shift: true }));
    /* 收掉导图，回到大纲，准备下一相 */
    if (await page.eval(`!!document.querySelector('.mm-root')`)) {
        await combo(page, "d", { ctrl: true, shift: true });
        await sleep(2000);
    }

    /* ============ 2. 待测：⇧⌘S（报红的那条）============ */
    await page.mouse("mouseMoved", caret.x, caret.y, { buttons: 0 });
    await page.mouse("mousePressed", caret.x, caret.y, { clickCount: 1 });
    await page.mouse("mouseReleased", caret.x, caret.y, { clickCount: 1 });
    await sleep(700);
    console.log("\n【2 待测 ⇧⌘S —— 补发裸修饰键的 combo()】");
    await pressAndWatch("⇧⌘S / combo", () => combo(page, "s", { ctrl: true, shift: true }));

    /* ============ 3. 换发法：⇧⌘S 单事件 ============ */
    await page.mouse("mouseMoved", caret.x, caret.y, { buttons: 0 });
    await page.mouse("mousePressed", caret.x, caret.y, { clickCount: 1 });
    await page.mouse("mouseReleased", caret.x, caret.y, { clickCount: 1 });
    await sleep(700);
    console.log("\n【3 ⇧⌘S —— 单事件（只发字母 + modifiers）】");
    await pressAndWatch("⇧⌘S / single", () => comboSingle(page, "s", { ctrl: true, shift: true }));

    /* ============ 4. 对照：⇧⌘D 单事件 ============ */
    await page.mouse("mouseMoved", caret.x, caret.y, { buttons: 0 });
    await page.mouse("mousePressed", caret.x, caret.y, { clickCount: 1 });
    await page.mouse("mouseReleased", caret.x, caret.y, { clickCount: 1 });
    await sleep(700);
    console.log("\n【4 对照 ⇧⌘D —— 单事件】");
    await pressAndWatch("⇧⌘D / single", () => comboSingle(page, "d", { ctrl: true, shift: true }));

    /* ============ 5. ⇧⌘C 是谁写的剪贴板 ============ */
    console.log("\n【5 ⇧⌘C —— 导图有焦点、有选中节点时】");
    /* 确保导图开着且选中一个节点 */
    if (!(await page.eval(`!!document.querySelector('.mm-root')`))) {
        await page.mouse("mouseMoved", caret.x, caret.y, { buttons: 0 });
        await page.mouse("mousePressed", caret.x, caret.y, { clickCount: 1 });
        await page.mouse("mouseReleased", caret.x, caret.y, { clickCount: 1 });
        await sleep(700);
        await combo(page, "d", { ctrl: true, shift: true });
        await sleep(2400);
    }
    const pt = await page.eval(`(() => {
        const n = document.querySelector('.mm-root .mm-node[data-mm-id="${firstLi}"]') || document.querySelector('.mm-root .mm-node[data-mm-id]');
        if (!n) return { err: 'no node' };
        n.scrollIntoView({ block: 'center' });
        const r = n.getBoundingClientRect();
        return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
    })()`);
    for (let i = 0; i < 6; i++) {
        await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
        await page.mouse("mousePressed", pt.x, pt.y, { clickCount: 1 });
        await page.mouse("mouseReleased", pt.x, pt.y, { clickCount: 1 });
        await sleep(500);
        await page.eval(`(() => { const r = document.querySelector('.mm-root'); if (r) r.focus({ preventScroll: true }); return true; })()`);
        if ((await page.eval(`document.querySelectorAll('.mm-root .mm-node.mm-sel').length`)) >= 1) break;
    }
    console.log(`  基线：选中 ${await page.eval(`document.querySelectorAll('.mm-root .mm-node.mm-sel').length`)} 个`);
    await pressAndWatch("⇧⌘C / single", () => comboSingle(page, "c", { ctrl: true, shift: true }));

    /* ============ 6. ★ 普查：⇧⌘<A–Z> 哪些能到达 document 冒泡 ============
       这一节直接决定「默认键位该选哪个」。
       判据只有一个：**事件能不能到达 document 冒泡阶段** ——
       思源的全局快捷键匹配器挂在那里，到不了就必然不触发（与命令实现无关）。

       必须**在大纲视图 + 光标在列表里**跑：这才是快捷键真正的使用场景，
       也正是 Protyle 会介入的那一层。 */
    console.log("\n【6 普查：⇧⌘<A–Z> 能不能到达 document 冒泡】");
    /* 确保处于大纲视图（关掉可能开着的导图） */
    if (await page.eval(`!!document.querySelector('.mm-root')`)) {
        await combo(page, "d", { ctrl: true, shift: true });
        await sleep(2000);
    }
    await page.mouse("mouseMoved", caret.x, caret.y, { buttons: 0 });
    await page.mouse("mousePressed", caret.x, caret.y, { clickCount: 1 });
    await page.mouse("mouseReleased", caret.x, caret.y, { clickCount: 1 });
    await sleep(800);

    /* ⚠️ **不能盲扫 A–Z**：`⇧⌘W`（关标签页）、`⇧⌘N`（新建）、`⇧⌘R` 这类会直接把这一页搞没，
       探针会在半路抛「Session with given id not found」——第一版就是这么翻的车。
       所以只扫**安全候选**：跳过会毁页面的 W/N/R/Q/P，以及已知被占的
       F/G/T（思源内置）、U/Y（quick-notes）、N（webview）、D/S（本插件自己）。 */
    const CANDIDATES = "abcehijklmovxz".split("");
    console.log(`  扫描 ${CANDIDATES.length} 个安全候选：${CANDIDATES.map((c) => c.toUpperCase()).join(" ")}`);
    console.log("  （跳过 W/N/R/Q/P：会把这一页关掉或弹系统对话框；跳过 F/G/T/U/Y/D/S：已被占用）");

    const reachable = [];
    const swallowed = [];
    for (const ch of CANDIDATES) {
        const k0 = await page.eval(`window.__k.length`);
        await comboSingle(page, ch, { ctrl: true, shift: true });
        await sleep(260);
        const rec = await page.eval(`(() => { const a = window.__k.slice(${k0}); return a.find((r) => r.key && r.key.length === 1) || null; })()`);
        if (!rec) {
            swallowed.push(`${ch.toUpperCase()}(未到达渲染层)`);
            continue;
        }
        if (rec.reachedBubble) reachable.push(ch.toUpperCase());
        else swallowed.push(`${ch.toUpperCase()}(被中途吞掉)`);
        /* 有些键会打开思源的面板 / 对话框，按一下 Esc 收掉，别让状态串味 */
        await page.press("Escape").catch(() => {});
        await sleep(140);
    }
    console.log(`\n  ✅ 能到达 document 冒泡（可用来绑全局快捷键）：${reachable.length} 个`);
    console.log(`     ${reachable.join(" ")}`);
    console.log(`\n  ✗ 到不了（思源编辑器 / 系统层面截走，绑了也不会触发）：${swallowed.length} 个`);
    console.log(`     ${swallowed.join(" ")}`);
    console.log("\n  注：这只是「投递层」可达性。真要当默认键，还得避开思源内置与别的插件已占的组合 ——");
    console.log("      用 `npm run probe:keymapdump` 查占用。两层都过才算能用的候选。");

    await page.screenshot("tests/.build/probe-hotkey-delivery.png");
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("\n已清理临时文档");
}
