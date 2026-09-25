/**
 * 复现探针：两条默认快捷键在**真机**上的行为，尤其是「消息提示了但画面没变」。
 *
 * ## 起因（用户报告）
 *
 * | 快捷键 | 症状 |
 * | --- | --- |
 * | `⇧⌘D`（进出导图模式） | 头一两次正常，之后**消息正常提示进入/退出，但画面无变化** |
 * | `⇧⌘B`（并排模式，**旧默认**） | **完全没有任何反应** —— 被思源内置 `editor.general.insertBefore` 抢走 |
 *
 * 根因查明后并排模式的默认键位已换成 `⇧⌘X`，所以下面 C/D 段按的是**新键位**，
 * 并顺手把「旧键位会不会改正文」的副作用对照留在 D 段（见 `probe-hotkey-candidates.mjs`
 * 里对 `⇧⌘B` 的完整体检）。
 *
 * ## 这支探针量什么
 *
 * 每一次按键都记六样东西 —— 只记「画面变了没」分不清是没派发、被吞、还是命令跑了但没生效：
 *
 *  1. **用户看到的消息**：思源的 `showMessage` 会往 body 插 `.b3-snackbar`，
 *     用 MutationObserver 抓它的文字。命令回调**跑到没跑到**、走的哪个分支，看它就知道。
 *  2. **画面**：`.mm-root` / `.mm-side` 在不在，以及**是否还在文档里**（`isConnected`）。
 *  3. **插件内部标记**：`data-mm-mounted`（已挂载）与 `mm-source-hidden`（源大纲被藏起来）。
 *     这两个是「命令跑了但挂载被跳过」的直接证据 —— 画面类断言看不到它们。
 *  4. **源大纲到底可见不可见**：`getClientRects().length`。
 *     「消息说切回大纲了，大纲其实还藏着」在用户眼里也是「无变化」，但 `.mm-root` 已经没了。
 *  5. **插件会选中哪个列表**：在页面里**复刻一遍 `targetList()` 的解析逻辑**
 *     （光标 → `closest('.list')` → 逐层向外），报出它拿到的块 ID、是否还连着文档。
 *  6. **内核请求**：钩 `window.fetch`，看 `/api/` 发了哪些（`insertBlock` 之类的副作用）。
 *
 * 每个按键后取 **多个时间点** —— 「没出现」和「3 秒后才出现」是两个不同的 bug，
 * 只量一个时刻会把它们混为一谈。
 *
 * ## 场景（症状是「用过几次之后才坏」，所以必须分场景）
 *
 * | 段 | 场景 | 想排除的假设 |
 * | --- | --- | --- |
 * | A | 光标在大纲里，⇧⌘D 连按 | 抑制窗口 / 连按 |
 * | E | **焦点在导图里**（点过节点、按过方向键）再按 ⇧⌘D | 焦点争夺 / `restoreFocus` |
 * | F | 极速连按（200ms） | 挂载异步竞态 |
 * | G | 文档里**两个列表**，光标在第二个 | `targetList()` 选错列表 |
 * | C/D | ⇧⌘X（并排模式新键位） | 键位是否被思源内置命令抢走 / 会不会改正文 |
 *
 * ## ⚠️ 这支探针自己出过两次「静默说谎」，都已修
 *
 * 1. **`clickLi` 把文档点没了。** 段落容器的选择器写的是 `<p>`，而思源 3.8 用的是
 *    `<div class="p">`，于是必然落空、回退到 `<li>`，`left + 12` 正好点在列表项
 *    **左侧的圆点**上 —— 思源会**聚焦到这个列表项**（`data-doc-type` 从
 *    `NodeDocument` 变 `NodeListItem`、`.list` 归零）。G 段因此连着 8 秒报
 *    「没找到列表块」，**看起来像插件认不出列表**。现在改成点段落容器里的文字，
 *    并且点完**自证**「列表还在」，不满足就直接抛错。
 *    证据：`tests/.build/_diag-doc2-click-1.png`（+12px → 聚焦）与 `-2.png`（+90px → 正常）。
 * 2. **指标看错了列表。** `snap()` 的 `attr / 挂载标记 / 源隐藏 / 大纲可见` 原来都取
 *    页面里**第一个** `.list`；多列表文档里插件操作的是**光标所在**那一个。G 段于是报
 *    「源隐藏=否 大纲可见=是」，而实际上插件早已把目标列表藏起来、导图也挂上了 ——
 *    **结论正好相反**。现在这几项一律以 `pick`（复刻的 `targetList()` 结果）为准。
 *
 * 用法：node tests/kernel/probe-hotkey-repro.mjs
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
 * 补发裸修饰键的 keydown，再发字母 —— 与 `probe-hotkey-delivery.mjs` 的 `combo()` 同一份实现。
 * 单事件（只发字母 + modifiers 位）与真机不同，这里要的是**真机等价物**。
 */
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
    await sleep(60);
}

const MD_ONE = ["- 甲一", "  - 甲二", "- 乙一", "- 乙二", "- 丙一", "- 丙二", ""].join("\n");
const MD_TWO = ["- 甲一", "  - 甲二", "- 乙一", "- 乙二", "- 丙一", "", "正文一段。", "", "- 丁一", "- 丁二", "- 丁三", ""].join("\n");

const docOne = (await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-hotkeyrepro-${Date.now()}`, markdown: MD_ONE })).data;
const docTwo = (await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-hotkeyrepro2-${Date.now()}`, markdown: MD_TWO })).data;
const listOne = (await kids(docOne)).find((k) => k.type === "l").id;
const liOne = (await kids(listOne)).find((k) => k.type === "i").id;
const listTwoB = (await kids(docTwo)).filter((k) => k.type === "l").pop().id;
console.log(`文档1 ${docOne}  列表 ${listOne}（${(await kids(listOne)).length} 项）`);
console.log(`文档2 ${docTwo}  第二个列表 ${listTwoB}（${(await kids(listTwoB)).length} 项）\n`);

const chrome = await launch({ headless: true, port: 9411, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage("about:blank");

    /**
     * 装仪器。⚠️ 这段字符串里**不能出现反引号**：它本身是 node 模板串的内容，
     * 嵌一层反引号会把模板串提前闭合（本项目已经踩过三次）。
     */
    async function install() {
        await page.eval(`(() => {
            window.__k = [];
            window.__msgs = [];
            window.__net = [];
            window.__err = [];
            /* keydown：捕获 + 冒泡两次标记 —— 两者的差就是「中途有没有人 stopPropagation」 */
            document.addEventListener('keydown', (e) => {
                window.__k.push({
                    key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey,
                    target: (e.target && (e.target.className || e.target.tagName)) + '',
                    reachedBubble: false,
                });
            }, true);
            document.addEventListener('keydown', () => {
                const a = window.__k;
                for (let i = a.length - 1; i >= 0; i--) { if (!a[i].reachedBubble) { a[i].reachedBubble = true; break; } }
            }, false);
            /* 用户看到的通知：思源 showMessage 往 body 插 .b3-snackbar */
            const seen = new WeakSet();
            const grab = (root) => {
                if (!root || !root.querySelectorAll) return;
                root.querySelectorAll('.b3-snackbar').forEach((el) => {
                    if (seen.has(el)) return;
                    seen.add(el);
                    window.__msgs.push({ t: Math.round(performance.now()), text: (el.textContent || '').trim() });
                });
                if (root.classList && root.classList.contains('b3-snackbar') && !seen.has(root)) {
                    seen.add(root);
                    window.__msgs.push({ t: Math.round(performance.now()), text: (root.textContent || '').trim() });
                }
            };
            grab(document);
            new MutationObserver((muts) => {
                for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) grab(n);
            }).observe(document.body, { childList: true, subtree: true });
            /* 内核请求 —— 顺带看有没有 insertBlock 这种「别的命令干的活」 */
            const of = window.fetch;
            window.fetch = function () {
                try {
                    const a = arguments[0];
                    const u = typeof a === 'string' ? a : (a && a.url) || '';
                    const i = u.indexOf('/api/');
                    if (i >= 0) {
                        const b = arguments[1];
                        window.__net.push({
                            t: Math.round(performance.now()),
                            url: u.slice(i),
                            body: b && typeof b.body === 'string' ? b.body.slice(0, 240) : '',
                        });
                    }
                } catch (e) { /* 仪器不干扰被测对象 */ }
                return of.apply(this, arguments);
            };
            window.addEventListener('error', (e) => window.__err.push(String(e.message)));
            return true;
        })()`);
    }

    /**
     * 打开一篇文档，并等到**它真的接管了编辑器**。
     *
     * ⚠️ 只等 `.protyle-wysiwyg` 出现是不够的 —— 切换文档时**上一个文档的 DOM 还在**，
     * 那个条件会立刻满足。本探针第一版就这么写的，于是 G 段对着旧文档（其实已经
     * 被导航清空）按了一整轮键：`.list` 数量 0、`插件选中=无(回退!)`，
     * **看起来像插件认不出列表，其实是探针没等到新文档**。
     * 所以这里等到「新文档的 id 真的出现在编辑器里」+「列表渲染出来」。
     */
    async function openDoc(docId, label) {
        await page.send("Page.navigate", { url: `http://127.0.0.1:6806/stage/build/desktop/?id=${docId}` });
        await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: `${label} 编辑器出现` });
        await page.waitFor(
            `!!document.querySelector('.protyle [data-node-id="${docId}"]')`,
            { timeout: 60000, label: `${label} 新文档接管编辑器（${docId}）` },
        );
        await page.waitFor(
            "!!document.querySelector('.protyle-wysiwyg .list[data-node-id]')",
            { timeout: 30000, label: `${label} 列表渲染出来` },
        );
        await sleep(1800);
        await install();
        console.log(`\n\n######## 打开 ${label} ########`);
    }

    /**
     * 快照。`pick*` 是在页面里**复刻 `targetList()` 的解析逻辑** ——
     * 「插件会拿哪个列表」是这一整类 bug 的关键中间量，不记它就只能猜。
     */
    const snap = () =>
        page.eval(`(() => {
            const list = document.querySelector('.protyle-wysiwyg .list[data-node-id]');
            const root = document.querySelector('.mm-root');
            const side = document.querySelector('.mm-side');
            const sel = window.getSelection();
            let anchor = null;
            if (sel && sel.anchorNode) {
                const n = sel.anchorNode;
                const el = n.nodeType === 1 ? n : n.parentElement;
                anchor = el ? (el.className || el.tagName) + '' : null;
            }
            /* ---- 复刻 src/index.ts 的 outermostList + targetList ---- */
            const outer = (start) => {
                let l = start && start.closest ? start.closest('.list') : null;
                if (!l) return null;
                for (;;) {
                    const up = l.parentElement && l.parentElement.parentElement && l.parentElement.parentElement.closest
                        ? l.parentElement.parentElement.closest('.list') : null;
                    if (!up || up === l) break;
                    l = up;
                }
                return l;
            };
            const fromSel = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
            let pick = outer(fromSel);
            let viaFallback = false;
            if (!pick || !pick.dataset.nodeId) {
                const pro = (fromSel && fromSel.closest ? fromSel.closest('.protyle') : null) || document.querySelector('.protyle');
                pick = outer(pro ? pro.querySelector('.protyle-wysiwyg .list') : null);
                viaFallback = true;
            }
            /* ⚠️ 下面这些指标要看**插件会操作的那个列表**（pick），不是页面里第一个 .list。
               多列表文档里两者不同：G 段（两个列表、光标在第二个）第一版就报
               「源隐藏=否 大纲可见=是」，而实际上插件早已把第二个列表藏起来、
               导图也挂上了 —— 指标看错了对象，结论正好相反。 */
            const primary = pick || list;
            const li = primary ? primary.querySelector(':scope > .li') : null;
            const act = document.activeElement;
            const actIn = act ? (act.closest && act.closest('.mm-root') ? 'mm-root' : (act.closest && act.closest('.protyle-wysiwyg') ? 'protyle-wysiwyg' : (act.className || act.tagName) + '')) : 'null';
            return {
                root: !!root,
                rootConn: !!(root && root.isConnected),
                side: !!side,
                /* 以下全部针对 primary（= 插件会选中的那个列表），不是第一个 .list */
                attr: primary ? primary.getAttribute('custom-mindmap') : null,
                mounted: primary ? primary.hasAttribute('data-mm-mounted') : null,
                hidden: primary ? primary.classList.contains('mm-source-hidden') : null,
                listConn: !!(primary && primary.isConnected),
                outlineVisible: !!(li && li.getClientRects().length > 0),
                blocks: document.querySelectorAll('.protyle-wysiwyg > div[data-node-id]').length,
                pickId: pick ? (pick.dataset.nodeId || null) : null,
                pickAttr: pick ? pick.getAttribute('custom-mindmap') : null,
                pickConn: !!(pick && pick.isConnected),
                viaFallback: viaFallback,
                anchor: anchor,
                activeIn: actIn,
            };
        })()`);

    /* ⚠️ 从 `attr=` 到 `顶层块=` 这几项，量的都是**插件会选中的那个列表**
       （`pick`），不是页面里第一个 `.list` —— 多列表文档里两者不同，
       写错对象会把结论报反（G 段踩过）。 */
    const fmt = (s) =>
        `root=${s.root ? (s.rootConn ? "有" : "有(游离!)") : "无"} side=${s.side ? "有" : "无"}` +
        ` ｜选中项 attr=${s.attr === null ? "-" : s.attr} 挂载标记=${s.mounted ? "有" : "无"} 源隐藏=${s.hidden ? "是" : "否"}` +
        ` 大纲可见=${s.outlineVisible ? "是" : "否"} 顶层块=${s.blocks}` +
        ` ｜插件选中=${s.pickId ? s.pickId.slice(-6) : "无"}${s.viaFallback ? "(回退!)" : ""} attr=${s.pickAttr === null ? "-" : s.pickAttr}` +
        ` ｜焦点=${s.activeIn}`;

    /**
     * 页面 DOM 摘要。
     *
     * G 段曾经出现「`.list` 数量凭空变 0 而且不恢复」——`fmt()` 只能告诉我们
     * 「没有列表」，看不到底层结构，于是分不清是「文档没打开」「Protyle 把块换掉了」
     * 还是「列表被插件藏起来了」。把顶层子元素的类名与 id 打出来就能一眼看穿。
     */
    const digest = () =>
        page.eval(`(() => {
            const wys = [...document.querySelectorAll('.protyle-wysiwyg')];
            const top = wys[0] ? [...wys[0].children].map((c) => c.className + '[' + (c.dataset.nodeId || '').slice(-6) + ']') : [];
            return {
                protyle: document.querySelectorAll('.protyle').length,
                wysiwyg: wys.length,
                list: document.querySelectorAll('.protyle-wysiwyg .list[data-node-id]').length,
                li: document.querySelectorAll('.protyle-wysiwyg .li[data-node-id]').length,
                p: document.querySelectorAll('.protyle-wysiwyg p').length,
                titles: [...document.querySelectorAll('.protyle-title')].map((t) => (t.dataset.nodeId || '') + '').join(','),
                top: top.join(' | '),
            };
        })()`);
    const fmtDigest = (d) =>
        `protyle=${d.protyle} wysiwyg=${d.wysiwyg} .list=${d.list} .li=${d.li} p=${d.p} 标题块=${d.titles}` +
        `\n    顶层子元素：${d.top || "（空）"}`;

    async function pressAndWatch(n, label, send, waits = [700, 1900]) {
        const k0 = await page.eval("window.__k.length");
        const m0 = await page.eval("window.__msgs.length");
        const n0 = await page.eval("window.__net.length");
        const before = await snap();
        await send();
        const points = [];
        let acc = 0;
        for (const w of waits) {
            await sleep(w);
            acc += w;
            points.push(`+${acc}ms ${fmt(await snap())}`);
        }
        const keys = await page.eval(`window.__k.slice(${k0})`);
        const msgs = await page.eval(`window.__msgs.slice(${m0})`);
        const net = await page.eval(`window.__net.slice(${n0})`);
        const letters = keys.filter((k) => k.key && k.key.length === 1);

        console.log(`\n── #${n} ${label} ──`);
        console.log(`  按前：${fmt(before)}`);
        for (const p of points) console.log(`  ${p}`);
        console.log(`  消息：${msgs.length ? msgs.map((m) => JSON.stringify(m.text)).join(" ｜ ") : "（没有通知）"}`);
        if (letters.length) {
            for (const k of letters) {
                console.log(`  按键：key=${JSON.stringify(k.key)} ctrl=${k.ctrl} shift=${k.shift} target=${k.target} 到冒泡=${k.reachedBubble}`);
            }
        } else {
            console.log("  按键：★ 字母那一下没到达渲染层（被 OS / IME / Electron 吞了）");
        }
        const interesting = net.filter((r) => r.url !== "/api/query/sql");
        if (interesting.length) {
            for (const r of interesting) console.log(`  内核 ${r.url}  ${r.body}`);
        }
        return { points, msgs, letters };
    }

    /**
     * 把光标放进指定列表项。
     *
     * ## ⚠️ 坐标必须取**段落自己的矩形**（`.p`），x 和 y 都是
     *
     * 踩过两次，都是「页面被切走」而不是「断言变红」：
     *
     * 1. **x**：段落容器的选择器原来写的是 `<p>`，而思源 3.8 用的是
     *    `<div class="p">`（实测 `document.querySelectorAll('.protyle-wysiwyg p').length === 0`），
     *    于是必然落空、回退到 `<li>`，`li.left + 12` 正好落在列表项**左侧的圆点**上
     *    —— `.protyle-action` 是 `position: absolute`、宽 34px，整块压在 li 左边缘上。
     * 2. **y**：`li.top + li.height / 2` 同样不行 —— 带子项的列表项高度包含整棵子树
     *    （实测 139px vs 段落 44px），「中心」落在**子项那一行**上，而子项是缩进的，
     *    它的圆点正好挪到 x≈608 附近。「点第一个列表项」于是变成「点子项的圆点」。
     *
     * 那一下会让思源**聚焦到这个列表项**：`.protyle-wysiwyg` 的 `data-doc-type` 从
     * `NodeDocument` 变成 `NodeListItem`、顶层只剩一个 `.li`、`.list` 数量归零。
     * G 段因此连着 8 秒报「没找到列表块」，**看起来像插件认不出列表**。
     * 而且它是**间歇性**的：同一坐标换个滚动位置又「碰巧」落在子项文字上、安然无恙
     * （实测：`tests/.build/_diag-caret.mjs`）。
     *
     * 取 `.p` 的矩形则无歧义 —— 段落就是这一项自己的那一行（实测光标祖先链
     * `p <- li <- list <- protyle-wysiwyg`）。取不到时退到 `li.left + 90` / `li.top + 20`。
     * 点完还要**自证**「列表还在」：场景自己失效时要立刻炸，不能把
     * 「探针点坏了页面」伪装成「插件有 bug」。
     */
    async function clickLi(liId) {
        const caret = await page.eval(`(() => {
            const li = document.querySelector('.protyle-wysiwyg .li[data-node-id="${liId}"]');
            if (!li) return { err: 'no li' };
            const lr = li.getBoundingClientRect();
            const p = li.querySelector(':scope > .p, :scope > .protyle-wysiwyg > p, :scope > p');
            if (p) {
                const pr = p.getBoundingClientRect();
                if (pr.width > 40) return { x: Math.round(pr.left + 12), y: Math.round(pr.top + pr.height / 2) };
            }
            return { x: Math.round(lr.left + 90), y: Math.round(lr.top + 20) };
        })()`);
        if (caret.err) throw new Error(`定位不到列表项 ${liId}：${caret.err}`);
        await page.mouse("mouseMoved", caret.x, caret.y, { buttons: 0 });
        await page.mouse("mousePressed", caret.x, caret.y, { clickCount: 1 });
        await page.mouse("mouseReleased", caret.x, caret.y, { clickCount: 1 });
        await sleep(700);
        /* ---- 自证：点完页面还得好好的 ----
           没有这一步，上面那个「点出聚焦视图」的坑会让整段场景静默变空。 */
        const after = await page.eval(`(() => {
            const w = document.querySelector('.protyle-wysiwyg');
            return {
                docType: w ? w.getAttribute('data-doc-type') : null,
                lists: document.querySelectorAll('.protyle-wysiwyg .list[data-node-id]').length,
                liStill: !!document.querySelector('.protyle-wysiwyg .li[data-node-id="${liId}"]'),
            };
        })()`);
        if (after.docType !== "NodeDocument" || after.lists === 0 || !after.liStill) {
            throw new Error(
                `点击列表项 ${liId} 之后页面被改了：docType=${after.docType} 列表数=${after.lists} 目标项还在=${after.liStill}` +
                    `（点的是 x=${caret.x}, y=${caret.y}）` +
                    ` —— 多半是点到了左侧操作区（圆点 / 折叠箭头）或子项那一行，坐标要取段落自己的矩形。`,
            );
        }
    }

    /** 点导图里的一个节点，让焦点落到导图上 */
    async function clickMapNode() {
        const pt = await page.eval(`(() => {
            const n = document.querySelector('.mm-root .mm-node[data-mm-id]');
            if (!n) return { err: 'no node' };
            n.scrollIntoView({ block: 'center' });
            const r = n.getBoundingClientRect();
            return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
        })()`);
        if (pt.err) return false;
        await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
        await page.mouse("mousePressed", pt.x, pt.y, { clickCount: 1 });
        await page.mouse("mouseReleased", pt.x, pt.y, { clickCount: 1 });
        await sleep(500);
        return true;
    }

    /* ================================================================ 文档1 */
    await openDoc(docOne, "文档1（单列表）");
    await clickLi(liOne);
    console.log(`光标已放进列表：${fmt(await snap())}`);

    /* ---- A. 光标在大纲里，连按 ---- */
    console.log("\n\n════════ A. 光标在大纲里，⇧⌘D 连按 4 次 ════════");
    for (let i = 1; i <= 4; i++) {
        await pressAndWatch(i, "⇧⌘D", () => combo(page, "d", { ctrl: true, shift: true }));
        await sleep(200);
    }
    if (await page.eval("!!document.querySelector('.mm-root')")) {
        await combo(page, "d", { ctrl: true, shift: true });
        await sleep(2200);
    }

    /* ---- E. 焦点在导图里（点过节点、按过方向键）再按 ---- */
    console.log("\n\n════════ E. 焦点在导图里，⇧⌘D 连按 3 次 ════════");
    await clickLi(liOne);
    await combo(page, "d", { ctrl: true, shift: true });
    await sleep(2400);
    console.log(`  导图已开：${fmt(await snap())}`);
    const clicked = await clickMapNode();
    console.log(`  点了导图节点：${clicked}　${fmt(await snap())}`);
    await page.press("ArrowDown").catch(() => {});
    await page.press("ArrowDown").catch(() => {});
    await sleep(400);
    console.log(`  按了两次方向键：${fmt(await snap())}`);
    for (let i = 1; i <= 3; i++) {
        await pressAndWatch(i, "⇧⌘D(焦点在导图)", () => combo(page, "d", { ctrl: true, shift: true }));
        await sleep(200);
    }
    if (await page.eval("!!document.querySelector('.mm-root')")) {
        await combo(page, "d", { ctrl: true, shift: true });
        await sleep(2200);
    }

    /* ---- F. 极速连按 ---- */
    console.log("\n\n════════ F. 极速连按（两次间隔 200ms）════════");
    await clickLi(liOne);
    await combo(page, "d", { ctrl: true, shift: true, gap: 20 });
    await sleep(200);
    await combo(page, "d", { ctrl: true, shift: true, gap: 20 });
    await sleep(2600);
    console.log(`  极速两下之后：${fmt(await snap())}`);
    console.log(`  消息：${(await page.eval("window.__msgs")).map((m) => JSON.stringify(m.text)).join(" ｜ ")}`);
    await pressAndWatch(3, "⇧⌘D(极速之后)", () => combo(page, "d", { ctrl: true, shift: true }));

    /* ⚠️ C 段必须在**大纲模式**下按。
       并排面板是给大纲视图用的（`openSide()` 见到 `custom-mindmap` 属性会直接
       回一句「这个列表已经在导图模式了」），在导图模式里按 ⇧⌘X 只会拿到那条拒绝提示 ——
       那不是故障，但会把「命令到底有没有跑」这个真正要验的东西盖住。
       第一版就在这里踩了：C 段三条全是拒绝提示，等于什么都没验到。 */
    if (await page.eval("!!document.querySelector('.mm-root')")) {
        await combo(page, "d", { ctrl: true, shift: true });
        await sleep(1800);
    }
    console.log(`\n  已切回大纲模式（root=${await page.eval("!!document.querySelector('.mm-root')")}），准备验并排键`);

    /* ---- C/D. ⇧⌘X（并排模式新默认键位） ---- */
    console.log("\n\n════════ C. ⇧⌘X ×3（并排模式）════════");
    await clickLi(liOne);
    await sleep(400);
    await pressAndWatch(1, "⇧⌘X（第 1 次：应打开并排面板）", () => combo(page, "x", { ctrl: true, shift: true }));
    const sideOpened = await page.eval("!!document.querySelector('.mm-side')");
    console.log(
        sideOpened
            ? "  ✓ 并排面板出现了（`.mm-side` 在）—— 插件命令确实被唤起了"
            : "  ✗ `.mm-side` 没出现 —— 命令没跑，或被吞在半路（去看上面的「到冒泡」与消息）",
    );
    for (let i = 2; i <= 3; i++) {
        await pressAndWatch(i, "⇧⌘X（应关闭并排面板）", () => combo(page, "x", { ctrl: true, shift: true }));
        await sleep(300);
    }
    console.log(`  三下之后 side=${await page.eval("!!document.querySelector('.mm-side')")}（奇数次开、偶数次关）`);

    console.log("\n════════ D. ⇧⌘X 的副作用：正文有没有被改（回归）════════");
    const kram0 = (await api("/api/block/getBlockKramdown", { id: docOne })).data?.kramdown ?? "";
    await combo(page, "x", { ctrl: true, shift: true });
    await sleep(1600);
    const kram1 = (await api("/api/block/getBlockKramdown", { id: docOne })).data?.kramdown ?? "";
    console.log(`  正文行数：${kram0.split("\n").length} → ${kram1.split("\n").length}`);
    if (kram1 !== kram0) {
        console.log("  ★ 正文被改动了 —— 有**别的命令**（不是插件）在响应这个键。");
        console.log(`    改前：${JSON.stringify(kram0.slice(0, 200))}`);
        console.log(`    改后：${JSON.stringify(kram1.slice(0, 200))}`);
    } else {
        console.log("  正文没变 ✓");
    }

    console.log("\n════════ D2. 对照：旧键位 ⇧⌘B 确实会改正文（说明为什么要换）════════");
    const kramB0 = (await api("/api/block/getBlockKramdown", { id: docOne })).data?.kramdown ?? "";
    await combo(page, "b", { ctrl: true, shift: true });
    await sleep(1600);
    const kramB1 = (await api("/api/block/getBlockKramdown", { id: docOne })).data?.kramdown ?? "";
    if (kramB1 !== kramB0) {
        console.log(`  ★ ⇧⌘B 让正文行数 ${kramB0.split("\n").length} → ${kramB1.split("\n").length}`);
        console.log("    = 思源内置 `editor.general.insertBefore`（上方插入块）抢先处理了它。");
        console.log("    插件命令一次都没轮到 —— 这就是「并排模式完全没反应」的真身。");
    } else {
        console.log("  ⇧⌘B 这次没改正文（可能光标不在可插入的位置）。");
    }

    /* ================================================================ 文档2：两个列表 */
    await openDoc(docTwo, "文档2（两个列表）");
    console.log(`  刚打开时：${fmtDigest(await digest())}`);
    await clickLi((await kids(listTwoB)).find((k) => k.type === "i").id);
    console.log(`  点完列表项：${fmtDigest(await digest())}`);
    console.log(`光标已放进**第二个**列表：${fmt(await snap())}`);
    console.log("\n════════ G. 两个列表、光标在第二个，⇧⌘D 连按 3 次 ════════");
    for (let i = 1; i <= 3; i++) {
        await pressAndWatch(i, "⇧⌘D(文档2)", () => combo(page, "d", { ctrl: true, shift: true }));
        await sleep(200);
    }
    const which = await page.eval(`(() => {
        const out = [];
        document.querySelectorAll('.protyle-wysiwyg .list[data-node-id]').forEach((l) => {
            out.push({ id: l.dataset.nodeId.slice(-6), attr: l.getAttribute('custom-mindmap'), mounted: l.hasAttribute('data-mm-mounted') });
        });
        return out;
    })()`);
    console.log(`  两个列表的最终状态：${JSON.stringify(which)}`);
    console.log(`  G 段结束时：${fmtDigest(await digest())}`);
    console.log(`  截图：tests/.build/probe-hotkey-repro.png`);

    const errs = await page.eval("window.__err");
    console.log(`\n页面错误：${errs.length ? errs.join(" ｜ ") : "无"}`);
    await page.screenshot("tests/.build/probe-hotkey-repro.png");
} finally {
    await chrome.close();
    await removeDoc(api, docOne);
    await removeDoc(api, docTwo);
    console.log("\n已清理临时文档");
}
