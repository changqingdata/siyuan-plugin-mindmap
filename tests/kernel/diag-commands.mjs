/**
 * P2-5「更多入口」的端到端验收 —— 顶栏图标、命令面板、默认快捷键。
 *
 * 这一支补的是一个典型的**「有实现、没断言」**缺口：顶栏图标与两条带 hotkey 的
 * 命令在上一轮就写完了，但只验过「顶栏图标存在」，没人按过那两个键。
 *
 * ## 一个必须先讲清楚的坑：`page.press` 驱动不了思源的全局快捷键
 *
 * `tests/cdp.mjs` 的 `page.press(key, { ctrl: true })` 只发一次 `rawKeyDown`
 * 并把 `modifiers` 位置 2。实测：**连思源内建的 ⌘P（命令面板）都唤不起来**，
 * 而页面上的 keydown 监听器收得到（`ctrl: true`、`isTrusted: true`）。
 * 对照实验（`probe-keydispatch.mjs`）：
 *   ① rawKeyDown + modifiers 位        → 唤不起
 *   ② 显式补发 ControlLeft 按下 / 抬起 → 唤得起
 *   ③ keyDown 带 text                  → 唤得起
 *
 * 所以本文件用 `combo()` / `altShift()`（方法 ②）发键。**这不是插件的问题，是发键方式的问题** ——
 * 上一版探针正因为踩了这个坑，把「快捷键没反应」误判成了插件的 bug。
 *
 * ## 覆盖
 *   A 命令面板   → 三条命令显示中文，不是裸标识符（P0-2 的真机验收）
 *   B ⇧⌘D       → 导图 / 大纲来回切，内核属性跟着写、跟着清
 *   C ⇧⌘B       → 并排面板开 / 关
 *   D ★ 回归     → 导图**有焦点**时按 ⇧⌘D，不能被导图自己的 ⌘D（快速复制）吃掉
 *   E 顶栏菜单   → 五个动作逐个点，逐个生效
 *   F 迁移命令   → 唯一**会写数据**的那条命令，真机跑一遍（含 table 反例）
 *   G ★ 通用规则 → 导图不吃**任何** ⌥⌘ 组合，也不吃 ⇧⌘ 组合
 *   H ★ 回归     → **真实键盘式**的 Ctrl+D 也要能到插件（焦点不被思源编辑器抢走）
 *
 * ## ⚠️⚠️ 键位换过三次，后两次都是因为「真机不触发」
 *
 * | 时期 | 键位 | 结果 |
 * | --- | --- | --- |
 * | 1.0.x 初版 | `⌥⌘D` / `⌥⌘V` | 可用 |
 * | 1.0.x 后段 | `⌘空格` / `⌥空格` | **用户报「按了没反应」** —— 死在 OS/IME 层，见下 |
 * | 1.1.x 前一版 | `⇧⌘D` / `⇧⌘S` | `⇧⌘S` **真机不触发** —— 死在 Protyle 层，见下 |
 * | 现在（1.1.x） | `⇧⌘D` / `⇧⌘B` | 两道实测都过（占用 + 投递） |
 *
 * ### 空格那版：死在最外层 OS / 输入法（本文件**从原理上**抓不到）
 *
 * 冲突在 Windows / 输入法（`Ctrl+空格` = 中文输入法中英文切换、
 * `Alt+空格` = Windows 窗口系统菜单），而 CDP 的 `Input.dispatchKeyEvent`
 * 是**合成**事件、从渲染层注入，**绕过输入法与系统窗口过程** ——
 * 于是这里 71 条断言全绿，真机上却一个都按不出来。
 *
 * **不是断言写少了，是测量手段够不着那一层。**（同族：无头浏览器复现不了 GPU 合成问题。）
 *
 * ### ★ `⇧⌘S` 那版：死在**思源编辑器**层（本文件**当时**也没抓到）
 *
 * 换到 `⇧⌘S` 之后本文件确实红了 2 条（C 段），但**红得没有解释力** ——
 * 只知道「面板没开」，不知道卡在哪一层。后来用 `probe-hotkey-delivery.mjs`
 * 逐层量才定位：**思源的全局快捷键匹配器挂在 `document` 冒泡阶段**，
 * 而 `Ctrl+S` 那一族是 **Protyle 自己的处理范围**，它在路上 `stopPropagation()` ——
 * 事件到得了捕获、到不了冒泡，匹配器根本收不到。实测对照：
 *
 *   | 按键 | 到 document 捕获 | 到 document 冒泡 | 结果 |
 *   | --- | --- | --- | --- |
 *   | `⇧⌘D` | ✓ | **✓** | 生效 |
 *   | `⇧⌘S` | ✓ | **✗** | 毫无反应 |
 *
 * ⚠️ 它**只在光标位于编辑器内时失效**，焦点在别处又能用 —— 又一个「有时灵、有时不灵」。
 * ⇒ `⇧⌘S` 弃用，改 `⇧⌘B`。
 *
 * **教训：断言只告诉你「坏了」，不告诉你「坏在哪一层」。**
 * 分层定位要另做探针（`probe-keymap-dump.mjs` 查占用、`probe-hotkey-delivery.mjs` 查投递）。
 *
 * ⚠️ 换键位**没有削弱 D / G 两段的价值**：它们守的是「导图只判主键、不判修饰键」
 * 这个机理，与具体是哪个键无关 ——
 *  · D 段守的是 `⌘D`（快速复制）会不会把 `⇧⌘D` 也吃掉（`modOnly` 原先只排 Alt 不排 Shift）；
 *  · G 段守的是 `⌥⌘` 那一族要整族让开。
 *
 * ## 第二个坑：命令面板是 ⌥⇧P，不是 ⌘P
 *
 * `⌘P`（`/general/search`）打开的是**文档 / 块搜索**，搜「导图」只会出文档标题，
 * 底部还提示「搜索结果为空，回车创建新文档」—— 拿它当命令面板会得出
 * 「命令没显示中文」的错误结论。真正的命令面板是 `⌥⇧P`（`/general/commandPanel`）。
 *
 * ## 第三个坑：snackbar 一个提示会命中三个元素
 *
 * `[class*="snackbar"]` 同时命中 `.b3-snackbars`（容器）、`.b3-snackbar`（单条）、
 * `.b3-snackbar__content`（文案）三层 —— 于是「一次点击」在 dump 里看起来像
 * 「提示出现了三次」，很容易被误判成**命令被执行了三次**（那会是重复写属性的真 bug）。
 * 精确读文案要用 `.b3-snackbar__content`（见 `toasts()`）。
 *
 * ## 第四个坑：发修饰键组合有两种方式，用途**不能互换**
 *
 *  · `combo()` / `ctrlShift()` —— 先补发裸修饰键（ControlLeft / ShiftLeft）的 keydown，再发主键。
 *    **能唤起思源的全局快捷键**（`⇧⌘D` / `⇧⌘B` / `⌥⇧P` 都靠它）。
 *  · `comboSingle()` —— 只发字母那一下并带上 `modifiers` 位，不补修饰键。
 *    事件目标留在导图里，**插件的键盘处理器收得到**；但唤不起全局快捷键。
 *
 * 为什么不能混用：补发裸修饰键的那一下，实测**焦点会从 `.mm-root` 被踢到
 * `.protyle-wysiwyg`**（插件只在 `e.defaultPrevented` 为真时才 `restoreFocus()`，
 * 而裸修饰键它不接管；思源编辑器接住了并 focus 自己）——
 * 于是紧接着的字母键 target 不在导图里，`handleGlobalKey` 直接 return。
 *
 * 结果就是：拿 `combo()` 去测「导图会不会误吃 ⌥⌘X」，测出来永远是绿的，
 * 但绿的原因是「插件根本没收到」，属于假绿。**G 段第一版正是这么翻的车。**
 * 所以：测全局快捷键用 `hotkeyToggle` / `hotkeySide` / `altShift`，
 * 测「导图自己的 Ctrl+X 会不会误触发」必须用 `hotkeySingle`。
 *
 * **反过来也成立，而且更严重**：真实键盘就是「先裸修饰键、再字母」的顺序，
 * 而 `tests/` 里所有键盘用例用的都是单事件发法 —— 于是「真实键盘下按 Ctrl+D
 * 焦点会被思源编辑器抢走、插件的整套 Ctrl 快捷键失灵」这个 bug
 * 被测试完美掩盖了（H 段现在钉着它，见那里的长注释）。
 *
 * 用法：node tests/kernel/diag-commands.mjs
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

/* ---------------------------------------------------------------- 建测试文档
 * 两个列表，**各 3 个顶层项** —— `docLists()` 只认「至少 3 个列表项」的顶层列表，
 * 少一项的话「本页列表：全部转为导图」会整条变成 disabled，
 * 点下去什么都不发生，而断言会误以为「已经转过了」（上一版就是这么假绿的）。
 */

const md = ["- 甲一", "  - 甲二", "  - 甲三", "- 乙一", "- 乙二", "", "分开两段", "", "- 丙一", "  - 丙二", "  - 丙三", "- 丁一", "- 丁二", ""].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-命令入口-${Date.now()}`,
    markdown: md,
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;

const lists = (await kids(docId)).filter((k) => k.type === "l");
const listA = lists[0].id;
const listB = lists[1]?.id;
const firstLi = (await kids(listA)).find((k) => k.type === "i").id;
const itemsA = (await kids(listA)).length;

console.log(`临时文档 ${docId}`);
console.log(`列表A ${listA}（${itemsA} 项）\n列表B ${listB}\n`);

/* ---------------------------------------------------------------- 判据 */

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = "") => {
    if (cond) {
        pass++;
        console.log(`  ✓ ${label}${extra ? `  ${extra}` : ""}`);
    } else {
        fail++;
        console.log(`  ✗ ${label}${extra ? `  ${extra}` : ""}`);
    }
};

/**
 * 发一个「修饰键 + 字母」的组合。`modifiers` 位：Alt=1 Ctrl=2 Meta=4 Shift=8
 *
 * `gap` 是「按下修饰键」与「按下字母」之间的间隔，默认 0（连发）。
 * 真人按键是有间隔的（按住 Ctrl 之后过几十毫秒才按字母），而**这个间隔决定了
 * 焦点争夺谁赢**：插件抢回焦点是异步的（setTimeout 0 / 60 / 200ms），
 * 零间隔连发时字母键可能比抢焦点还早到。要复现真实键盘就得给个 `gap`，
 * 见 `ctrlReal`。
 */
async function combo(page, key, { ctrl = false, alt = false, shift = false, gap = 0 } = {}) {
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

/** ⌥⇧<key>（命令面板） */
const altShift = (page, key) => combo(page, key, { alt: true, shift: true });

/**
 * 插件两条全局命令的默认键位：`⇧⌘D`（切换导图 / 大纲）、`⇧⌘B`（并排打开）。
 *
 * 走 `combo()` 就够 —— 补发 `ShiftLeft` + `ControlLeft` 再发字母，
 * 这样思源的全局键位匹配器收得到。
 *
 * ⚠️ 这里曾经有个 `spaceKey()`（因为老键位是 `Ctrl+空格` / `Alt+空格`，
 * 而空格既不是字母、也没有 `KeySpace` 这种 code，得手写 `code: "Space"` + vk 32）。
 * 键位换成 `⇧⌘D` / `⇧⌘B` 之后它就没人用了，**已删除**。
 * 那版为什么必须换掉（以及「本文件从原理上抓不到 OS/IME 拦截」），见文件头的长注释。
 */
const ctrlShift = (page, key) => combo(page, key, { ctrl: true, shift: true });
/** 插件默认的「把光标所在的列表切换为导图 / 大纲」= ⇧⌘D */
const hotkeyToggle = (page) => ctrlShift(page, "d");
/** 插件默认的「并排面板打开导图」= ⇧⌘B */
const hotkeySide = (page) => ctrlShift(page, "b");

/**
 * 单事件发键：**不补发裸修饰键的 keydown**，只在字母那一下带上 `modifiers` 位。
 *
 * 用途与 `combo()` 不同，别混（见文件头「第四个坑」）：
 * 这样发出来的事件目标留在导图里，**插件的键盘处理器收得到** ——
 * 要验「导图会不会误吃 ⌥⌘X」只能用这种。代价是唤不起思源的全局快捷键。
 */
async function comboSingle(page, key, { ctrl = false, alt = false, shift = false } = {}) {
    const bits = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const code = `Key${key.toUpperCase()}`;
    const vk = key.toUpperCase().charCodeAt(0);
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: bits });
    await sleep(180);
}
const hotkeySingle = (page, key) => comboSingle(page, key, { ctrl: true, alt: true });
/** ⇧⌘<key> 的单事件版 —— 与 `hotkeySingle` 同理，用来验「导图会不会误吃 ⇧⌘ 那一族」 */
const hotkeyShiftSingle = (page, key) => comboSingle(page, key, { ctrl: true, shift: true });
/** Ctrl+<key>，**补发裸修饰键 + 留出真人按键的间隔** —— 复现真实键盘，验「按键能不能到插件」 */
const ctrlReal = (page, key) => combo(page, key, { ctrl: true, gap: 130 });

async function clickAt(page, pt) {
    if (!pt || pt.err) return pt;
    await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
    await page.mouse("mousePressed", pt.x, pt.y, { clickCount: 1 });
    await page.mouse("mouseReleased", pt.x, pt.y, { clickCount: 1 });
    return pt;
}

/** 真实点进列表项的文字，把光标放进列表 */
const caretPoint = (liId) => `(() => {
    const li = document.querySelector('.protyle-wysiwyg .li[data-node-id="${liId}"]');
    if (!li) return { err: 'no li' };
    const p = li.querySelector(':scope > .protyle-wysiwyg > p, :scope > p') || li;
    const r = p.getBoundingClientRect();
    if (r.width < 1) return { err: 'li 不可见' };
    return { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) };
})()`;

/** 某个列表块上挂的导图数量（`custom-mindmap` 属性） */
const attrOf = (id) => `(() => { const l = document.querySelector('.protyle-wysiwyg .list[data-node-id="${id}"]'); return l ? l.getAttribute('custom-mindmap') : '(找不到 list)'; })()`;

/** 等某个列表的属性变成「有」或「没有」。批量操作要写内核 + 内核回推，固定 sleep 容易赌运气。 */
async function waitAttr(page, id, want, timeout = 9000) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
        last = await page.eval(attrOf(id));
        const has = last !== null && last !== "(找不到 list)";
        if (has === want) return last;
        await sleep(250);
    }
    return last;
}

/** 某个列表块上的【自定义块样式】标记（迁移命令要读的就是它） */
const legacyAttrOf = (id) => `(() => { const l = document.querySelector('.protyle-wysiwyg .list[data-node-id="${id}"]'); return l ? l.getAttribute('custom-block-list-view') : '(找不到 list)'; })()`;

/** 等 DOM 上出现 / 消失 legacy 标记 */
async function waitLegacy(page, id, want, timeout = 9000) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
        last = await page.eval(legacyAttrOf(id));
        const has = last !== null && last !== "(找不到 list)";
        if (has === want) return last;
        await sleep(250);
    }
    return last;
}

/** 内核侧的块属性 */
const kernelAttrs = async (id) => (await api("/api/attr/getBlockAttrs", { id })).data ?? {};

/**
 * 读 snackbar 文案。**必须用 `.b3-snackbar__content`** ——
 * `[class*="snackbar"]` 会同时命中 `.b3-snackbars`（容器）/ `.b3-snackbar`（单条）
 * / `.b3-snackbar__content`（文案），一条提示被数成三条，
 * 看起来就像「命令被执行了三次」（实测踩过这个误判）。
 */
const toasts = (page) => page.eval(`[...document.querySelectorAll('.b3-snackbar__content')].map((x) => (x.textContent || '').trim()).join(' | ')`);

/** 打开顶栏菜单，返回条目文案。先确保没有残留菜单 —— 两块菜单同时在 DOM 里时，
 *  `querySelectorAll` 会命中旧的那块（位置已经不对了），点下去等于没点。 */
async function openTopBar(page) {
    await page.eval(`(() => {
        if (document.querySelector('.b3-menu')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
    })()`);
    await sleep(400);
    await page.eval(`(() => {
        const el = document.querySelector('.toolbar [id^="plugin_siyuan-plugin-mindmap"]')
            || [...document.querySelectorAll('.toolbar *')].find((e) => (e.getAttribute('title') || '') === '大纲导图');
        if (el) el.click();
        return !!el;
    })()`);
    await sleep(800);
    return page.eval(`[...document.querySelectorAll('.b3-menu .b3-menu__item')].map((x) => (x.textContent || '').trim()).filter(Boolean)`);
}

/**
 * 点顶栏菜单里文案包含 needle 的那一项。
 *
 * 用合成事件而不是 CDP 的真实鼠标事件 —— 和 `diag-mark` / `diag-task-check` 一致：
 * 菜单项只认 `click`，而 CDP 的 `Input.dispatchMouseEvent` 在菜单这种
 * 「打开时抢焦点、关闭时异步摘 DOM」的浮层上偶发 30s 超时（实测踩到过一次），
 * 会让整支验收因为一个基础设施问题红掉。菜单本身「有没有、文案对不对」
 * 已经由上面的断言覆盖，这里要验的是**点下去动作生不生效**。
 */
async function clickMenuItem(page, needle) {
    return page.eval(`(() => {
        const it = [...document.querySelectorAll('.b3-menu .b3-menu__item')].find((x) => (x.textContent || '').includes(${JSON.stringify(needle)}));
        if (!it) return { err: 'no item' };
        const r = it.getBoundingClientRect();
        const opt = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        it.dispatchEvent(new MouseEvent('mousedown', opt));
        it.dispatchEvent(new MouseEvent('mouseup', opt));
        it.click();
        return { ok: true, text: (it.textContent || '').trim() };
    })()`);
}

/** 画布上某个列表项对应的节点中心点（先滚进视口再量，避免量到屏幕外） */
const nodePoint = (liId) => `(() => {
    const n = document.querySelector('.mm-root .mm-node[data-mm-id="${liId}"]') || document.querySelector('.mm-root .mm-node');
    if (!n) return { err: 'no node' };
    n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
})()`;

/**
 * 从命令面板（⌥⇧P）搜一条命令并点它 —— 走的是用户真实路径。
 *
 * 两个坑：
 *  · 面板残留时 `⌥⇧P` 会把它**关掉**，于是「没打开」被误报成「面板坏了」；
 *    所以进来先清干净。
 *  · 输入框要手动派发 `input` 事件，直接赋 value 不会触发思源的过滤。
 */
async function runFromPalette(page, query, needle) {
    if (await page.eval(`!!document.querySelector('.b3-dialog--open')`)) {
        await page.press("Escape");
        await sleep(700);
    }
    await altShift(page, "p");
    await sleep(1400);
    if (!(await page.eval(`!!document.querySelector('.b3-dialog--open')`))) return { err: "面板没打开" };
    await page.eval(`(() => {
        const i = document.querySelector('.b3-dialog--open input');
        if (!i) return false;
        i.focus();
        i.value = ${JSON.stringify(query)};
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    })()`);
    await sleep(1200);
    return page.eval(`(() => {
        const it = [...document.querySelectorAll('.b3-dialog--open .b3-list-item')].find((x) => (x.textContent || '').includes(${JSON.stringify(needle)}));
        if (!it) return { err: 'no item: ' + [...document.querySelectorAll('.b3-dialog--open .b3-list-item')].map((x) => (x.textContent || '').trim()).join(' / ') };
        const r = it.getBoundingClientRect();
        const opt = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        it.dispatchEvent(new MouseEvent('mousedown', opt));
        it.dispatchEvent(new MouseEvent('mouseup', opt));
        it.click();
        return { ok: true, text: (it.textContent || '').trim() };
    })()`);
}

/** 轮询直到 `fn()` 返回真值（返回真值本身），超时返回最后一次的结果 */
async function waitUntil(fn, timeout = 9000, interval = 250) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
        last = await fn();
        if (last) return last;
        await sleep(interval);
    }
    return last;
}

/**
 * 点一下画布上的节点，直到它**真的被选中**，并让导图拿到焦点。
 *
 * 为什么要重试：命令面板刚关闭时，紧跟着的第一次点击会被吃掉
 * （点下去 `.mm-sel` 数还是 0，第二次就正常）—— 面板的关闭是异步摘 DOM 的。
 * 只点一次的话，「选中 0 个」会被当成插件的问题。
 */
async function selectNode(page, liId) {
    return waitUntil(
        async () => {
            await clickAt(page, await page.eval(nodePoint(liId)));
            await sleep(450);
            await page.eval(`(() => { const r = document.querySelector('.mm-root'); if (r) r.focus({ preventScroll: true }); return true; })()`);
            await sleep(200);
            const n = await page.eval(`document.querySelectorAll('.mm-root .mm-node.mm-sel').length`);
            return n >= 1 ? n : null;
        },
        9000,
        350,
    );
}

const chrome = await launch({ headless: true, port: 9380, width: 1680, height: 1050, dpr: 1 });try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2400);

    /*
     * 「本页列表：全部转为导图」会先弹一个 `window.confirm`（见 index.ts 的 convertDocLists）——
     * 原生模态框会**卡住渲染进程**：触发它的那次 `Runtime.evaluate` 永远不返回，
     * 于是整支验收挂在一个 30s 的 CDP 超时上（实测踩到过）。
     * 这里统一接管：记下文案，一律确认。顺带这也成了一条断言 ——
     * 一次改动两个以上列表之前，插件**会**问一句。
     */
    const dialogs = [];
    page.on("Page.javascriptDialogOpening", (p) => {
        dialogs.push(p.message || "");
        page.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    });
    await page.send("Page.enable");

    /* ============================== A. 命令面板显示中文（P0-2 真机） ============================== */
    console.log("【A 命令面板（⌥⇧P）里的三条命令】");
    const caret = await page.eval(caretPoint(firstLi));
    ok(!caret.err, "点得到列表项（后面几步都要把光标放进去）", caret.err ?? "");
    await clickAt(page, caret);
    await sleep(600);

    await altShift(page, "p");
    await sleep(1400);
    const paletteOn = await page.eval(`!!document.querySelector('.b3-dialog--open')`);
    ok(paletteOn, "⌥⇧P 唤起了命令面板");

    if (paletteOn) {
        await page.eval(`(() => {
            const i = document.querySelector('.b3-dialog--open input');
            if (!i) return false;
            i.focus();
            i.value = '导图';
            i.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        })()`);
        await sleep(1200);
        const rows = await page.eval(
            `[...document.querySelectorAll('.b3-dialog--open .b3-list-item')].map((x) => (x.textContent || '').trim())`,
        );
        const txt = rows.join(" | ");
        console.log(`  命中 ${rows.length} 条：${txt.slice(0, 160)}`);
        ok(rows.length > 0, "搜「导图」有命中（说明这确实是命令列表）");
        ok(txt.includes("切换为导图"), "★ 命令显示中文（toggleMindMap →「把光标所在的列表切换为导图 / 大纲」）");
        ok(txt.includes("并排面板"), "★ 另一条也是中文（toggleSidePanel）");
        ok(!txt.includes("toggleMindMap") && !txt.includes("toggleSidePanel") && !txt.includes("migrateLegacy"), "★ 没有裸标识符漏出来（P0-2 修的就是这个）");
        await page.press("Escape");
        await sleep(700);
    }

    /* ============================== B. ⇧⌘D 切换导图 / 大纲 ============================== */
    console.log("\n【B ⇧⌘D 一键切换】");
    await clickAt(page, await page.eval(caretPoint(firstLi)));
    await sleep(500);
    await hotkeyToggle(page);
    await sleep(2200);
    ok(await page.eval(`!!document.querySelector('.mm-root .mm-node')`), "★ 按下后列表变成了导图");
    ok((await page.eval(attrOf(listA))) === "logic", "★ 内核属性也写上了", String(await page.eval(attrOf(listA))));
    ok((await kids(listA)).length === itemsA, "内核列表项数没变（切换只是换视图，不动内容）", `${itemsA} → ${(await kids(listA)).length}`);

    await hotkeyToggle(page);
    await sleep(2200);
    ok(!(await page.eval(`!!document.querySelector('.mm-root .mm-node')`)), "★ 再按一次切回大纲");
    ok((await page.eval(attrOf(listA))) === null, "★ 内核属性被清掉了", String(await page.eval(attrOf(listA))));

    /* ============================== C. ⇧⌘B 并排面板 ============================== */
    console.log("\n【C ⇧⌘B 并排查看】");
    await clickAt(page, await page.eval(caretPoint(firstLi)));
    await sleep(500);

    /* ★★ 投递层自证：先确认「这个键能不能到 document 冒泡」。
       思源的全局快捷键匹配器挂在**冒泡阶段**，而 `Ctrl+S` 那一族会被 Protyle
       在中途 `stopPropagation()` —— 事件到得了捕获、到不了冒泡，命令永远收不到。
       曾经默认键位就是 `⇧⌘S`，红出来的只是「面板没打开」，**完全看不出坏在哪一层**
       （换成 `⇧⌘B` 之后才用 `probe-hotkey-delivery.mjs` 逐层量出来）。
       有这条前置断言，下次再有人改键位改到被吞的字母，红的第一条会直接说明原因。 */
    await page.eval(`(() => {
        window.__mmDeliv = null;
        if (window.__mmDelivHooked) return true;
        window.__mmDelivHooked = true;
        document.addEventListener('keydown', (e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            const rec = { key: e.key, shift: e.shiftKey, reachedBubble: false };
            window.__mmDeliv = rec;
            Promise.resolve().then(() => { rec.prevented = e.defaultPrevented; });
        }, true);
        document.addEventListener('keydown', () => { if (window.__mmDeliv) window.__mmDeliv.reachedBubble = true; }, false);
        return true;
    })()`);
    await hotkeySide(page);
    await sleep(2000);
    const deliv = await page.eval(`window.__mmDeliv`);
    ok(
        !!deliv && deliv.reachedBubble,
        "★★ 前置：⇧⌘B 的事件到达了 document 冒泡 —— 思源的全局匹配器收得到（到不了就说明被 Protyle 吞了，换键位）",
        deliv ? `key=${JSON.stringify(deliv.key)} shift=${deliv.shift} reachedBubble=${deliv.reachedBubble}` : "没收到按键",
    );
    ok(await page.eval(`!!document.querySelector('.mm-side')`), "★ 并排面板打开了");
    ok(await page.eval(`!!document.querySelector('.mm-side .mm-node')`), "面板里真的渲染出了导图");

    await hotkeySide(page);
    await sleep(1600);
    ok(!(await page.eval(`!!document.querySelector('.mm-side')`)), "★ 再按一次关掉");

    /* ============================== D. ★ 回归：导图有焦点时全局键不能被吃掉 ============================== */
    console.log("\n【D ★ 回归：导图有焦点时按 ⇧⌘D】");
    console.log("  （起因：导图自己的 `⌘D` 是「快速复制」，判据 `modOnly = mod && !e.altKey`");
    console.log("   **只排 Alt、不排 Shift** —— 于是 `⇧⌘D` 会命中它，全局切换键失效，");
    console.log("   而且**把选中节点的子树复制一份写进了内核**。修法是加 `modLetter = modOnly && !e.shiftKey`）");
    console.log("  （这条回归与具体键位无关，守的是「导图不该吞掉不属于它的修饰键族」这个机理：");
    console.log("   `⌥⌘` 靠 !e.altKey 让开、`⇧⌘` 靠 !e.shiftKey 让开）");
    await clickAt(page, await page.eval(caretPoint(firstLi)));
    await sleep(500);
    await hotkeyToggle(page);
    await sleep(2200);
    ok(await page.eval(`!!document.querySelector('.mm-root .mm-node')`), "先把导图开起来");

    /* 真实点一下节点：既选中它，也让导图拿到焦点 */
    const nodePt = await page.eval(nodePoint(firstLi));
    await clickAt(page, nodePt);
    await sleep(700);
    const focused = await page.eval(`(() => { const r = document.querySelector('.mm-root'); return !!r && (document.activeElement === r || r.contains(document.activeElement)); })()`);
    if (!focused) await page.eval(`(() => { const r = document.querySelector('.mm-root'); if (r) r.focus({ preventScroll: true }); return true; })()`);
    ok(
        await page.eval(`(() => { const r = document.querySelector('.mm-root'); return !!r && (document.activeElement === r || r.contains(document.activeElement)); })()`),
        "导图拿到了焦点（这一步才是关键：焦点在导图上，按键才会先经过导图）",
    );
    ok(await page.eval(`!!document.querySelector('.mm-root .mm-node.mm-sel')`), "并且有一个选中的节点（复制有明确的作用对象，真出问题就会写进内核）");

    const beforeItems = (await kids(listA)).length;
    await hotkeyToggle(page);
    await sleep(2400);
    const afterItems = (await kids(listA)).length;
    ok(afterItems === beforeItems, "★★ 内核列表项数不变 —— 没有被偷偷复制节点", `${beforeItems} → ${afterItems}`);
    ok(!(await page.eval(`!!document.querySelector('.mm-root .mm-node')`)), "★★ 导图被切回大纲 —— 全局快捷键确实送达了");

    /* ============================== E. 顶栏菜单五个动作 ============================== */
    console.log("\n【E 顶栏菜单】");
    let items = await openTopBar(page);
    ok(items.some((t) => t.includes("当前列表")), "菜单里有「当前列表」动作", items[0] ?? "");
    ok(items.some((t) => t.includes("并排查看")), "菜单里有「并排查看」");
    ok(items.some((t) => t.includes("全部转为导图")), "菜单里有「本页列表：全部转为导图」", items.find((t) => t.includes("全部转为导图")) ?? "");
    ok(items.some((t) => t === "设置"), "菜单里有「设置」");

    /* ---- ① 并排查看（此刻列表还在大纲视图）---- */
    await clickMenuItem(page, "并排查看");
    await sleep(2200);
    ok(await page.eval(`!!document.querySelector('.mm-side')`), "★「并排查看」打开了面板");
    ok(await page.eval(`!!document.querySelector('.mm-side .mm-node')`), "面板里真的渲染出了导图");
    await page.eval(`(() => { const x = document.querySelector('.mm-side-close'); if (x) x.click(); return true; })()`);
    await sleep(1300);
    ok(!(await page.eval(`!!document.querySelector('.mm-side')`)), "面板上的 ✕ 能关掉它");

    /* ---- ② 当前列表：转为导图 ---- */
    await openTopBar(page);
    await clickMenuItem(page, "当前列表");
    await sleep(2400);
    ok((await page.eval(attrOf(listA))) !== null, "★「当前列表：转为导图」生效了", String(await page.eval(attrOf(listA))));

    /* ---- ②b 同一项应当**跟着状态翻面**，点回去能收回大纲 ----
       这是「点一下没反应」最容易藏身的地方：标签没跟着状态走，用户在已经转了导图的
       列表上再看到「转为导图」，点下去画面当然毫无变化 —— 他会以为插件坏了，
       而静态审计里这一项一直是零命中（只测过「转为导图」这个方向）。
       所以这里把**标签翻面 + 反向生效**两件事一起钉住。 */
    const items2b = await openTopBar(page);
    const backLabel = items2b.find((t) => t.includes("当前列表")) || "";
    ok(backLabel.includes("切回大纲视图"), "★ 已是导图时，同一项翻成「当前列表：切回大纲视图」", backLabel);
    await clickMenuItem(page, "当前列表");
    await sleep(2400);
    ok((await page.eval(attrOf(listA))) === null, "★「当前列表：切回大纲视图」真的把它收回了大纲", String(await page.eval(attrOf(listA))));
    // 再转回导图 —— 下面 ③ 的前提是「列表已经是导图」
    await openTopBar(page);
    await clickMenuItem(page, "当前列表");
    await sleep(2400);
    ok((await page.eval(attrOf(listA))) !== null, "再点一次又转回导图（它本来就是同一个开关）", String(await page.eval(attrOf(listA))));

    /* ---- ③ 已经是导图时点「并排查看」：应当**明确拒绝**，而不是默默无反应 ----
       并排面板的定位是「大纲在左、导图在右」，列表本身已经是导图时没有大纲可并排。 */
    await openTopBar(page);
    await clickMenuItem(page, "并排查看");
    await sleep(1800);
    ok(!(await page.eval(`!!document.querySelector('.mm-side')`)), "★ 列表已经是导图时，并排面板不开");
    const refuseToast = await page.eval(
        `[...document.querySelectorAll('[class*="snackbar"]')].map((x) => (x.textContent || '').trim()).join(' | ')`,
    );
    ok(refuseToast.includes("已经在导图模式"), "★ 而且说清了原因（不是「点了没反应」）", refuseToast.slice(0, 44));

    /* ---- ④ 本页列表：全部转为导图 ---- */
    await openTopBar(page);
    const batchLabel = (await page.eval(`[...document.querySelectorAll('.b3-menu .b3-menu__item')].map((x)=>x.textContent.trim()).find((t)=>t.includes('全部转为导图'))`)) || "";
    dialogs.length = 0;
    await clickMenuItem(page, "全部转为导图");
    await sleep(600);
    ok(dialogs.length === 1 && dialogs[0].includes("确定把本页这"), "★ 一次改多个列表之前会先问一句", (dialogs[0] || "(没弹)").split("\n")[0].slice(0, 40));
    const aOn = await waitAttr(page, listA, true);
    const bOn = await waitAttr(page, listB, true);
    ok(aOn !== null, "★ 列表A 是导图", String(aOn));
    ok(bOn !== null, "★ 列表B 也一起转了（这才叫「本页列表」）", String(bOn));
    ok(/（\d+ 个）/.test(batchLabel), "菜单项上标了会作用几个列表", batchLabel);

    /* ---- ⑤ 本页列表：全部切回大纲 ---- */
    await openTopBar(page);
    dialogs.length = 0;
    await clickMenuItem(page, "全部切回大纲");
    await sleep(600);
    ok(dialogs.length === 1, "★ 切回去之前同样会问一句");
    const aOff = await waitAttr(page, listA, false);
    const bOff = await waitAttr(page, listB, false);
    ok(aOff === null, "★ 列表A 收回大纲", String(aOff));
    ok(bOff === null, "★ 列表B 也一起收回", String(bOff));

    /* ---- ⑥ 设置 ---- */
    await openTopBar(page);
    await clickMenuItem(page, "设置");
    await sleep(1600);
    ok(await page.eval(`!!document.querySelector('.b3-dialog--open')`), "★「设置」打开了设置面板");

    /* ============================== F. 迁移【自定义块样式】的标记 ==============================
     * 这是三条命令里**唯一会写数据**的一条（把 custom-block-list-view="map" 换成
     * custom-mindmap）。此前它只有「命令面板里标签显示中文」这一条断言 ——
     * 动作本身从没被真机跑过。三个肉眼看不出来的翻车点：
     *   ① 它是**从 DOM 读属性**（querySelectorAll('.list[custom-block-list-view]')），
     *      不是从内核查 —— 思源到底会不会把自定义块属性贴到 .list 元素上？
     *   ② 迁移后 runMigration 里那句 setTimeout(scanAll, 150) 有没有真的把导图挂上去；
     *   ③ 没有可迁移标记时，是给出明确提示还是静默失败。
     * 顺带钉住一条**设计意图**：非 map 的 legacy 值（表格 / 看板）必须保持原样。
     */
    console.log("\n【F 迁移命令（唯一会写数据的一条）】");
    /* 关掉上一步的设置面板。关闭按钮是个 <svg>（**没有 .click() 方法**，
       直接调会抛 "c.click is not a function"），所以走真实坐标点击。 */
    const closePt = await page.eval(`(() => {
        const c = document.querySelector('.b3-dialog--open .b3-dialog__close');
        if (!c) return { err: 'no close btn' };
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!closePt.err) await clickAt(page, closePt);
    await sleep(700);
    if (await page.eval(`!!document.querySelector('.b3-dialog--open')`)) {
        await page.press("Escape");
        await sleep(800);
    }
    ok(!(await page.eval(`!!document.querySelector('.b3-dialog--open')`)), "先关掉上一步的设置面板（不然按键会被它吃掉）");

    await api("/api/attr/setBlockAttrs", { id: listA, attrs: { "custom-block-list-view": "map" } });
    await api("/api/attr/setBlockAttrs", { id: listB, attrs: { "custom-block-list-view": "table" } });
    const domLegacyA = await waitLegacy(page, listA, true);
    const domLegacyB = await waitLegacy(page, listB, true);
    ok(domLegacyA === "map", "★ 思源确实会把自定义块属性贴到 .list 元素上（这条命令是从 DOM 读的，读不到就永远是死的）", String(domLegacyA));
    ok(domLegacyB === "table", "反例列表（table）也贴上了", String(domLegacyB));

    const hit = await runFromPalette(page, "迁移", "迁移");
    ok(!hit.err, "命令面板里点得到这条命令", hit.text ?? hit.err);

    /* ★ 关键测量细节：`migrateLegacy` 是「**先** list.setAttribute(...)，
       **再** await setBlockAttrs(...)」—— DOM 立刻变、内核稍后才写。
       所以「DOM 已经变了」不能拿来当「内核已经写了」的证据（上一版就是这么红的），
       内核必须单独等。下面把三段耗时都打出来，免得下次又靠猜。 */
    const t0 = Date.now();
    const domView = await waitAttr(page, listA, true);
    const tDom = Date.now() - t0;
    ok(domView !== null, "★ 迁移后 A 变成了导图", `custom-mindmap=${domView}（${tDom}ms）`);
    ok((await page.eval(legacyAttrOf(listA))) === null, "★ legacy 标记从 DOM 上摘掉了");

    const kA = await waitUntil(async () => {
        const a = await kernelAttrs(listA);
        return a["custom-mindmap"] === "logic" && a["custom-block-list-view"] === undefined ? a : null;
    });
    const tKernel = Date.now() - t0;
    ok(!!kA, "★ 内核里换成了 custom-mindmap", `custom-mindmap=${JSON.stringify(kA?.["custom-mindmap"])}（${tKernel}ms）`);
    ok(!!kA && kA["custom-block-list-view"] === undefined, "★ 内核里的 legacy 标记也清掉了", String(kA?.["custom-block-list-view"]));

    const fNodes = await waitUntil(async () => {
        const n = await page.eval(`document.querySelectorAll('.mm-root .mm-node').length`);
        return n > 0 ? n : null;
    });
    ok(!!fNodes, "★ 迁移后导图真的挂上了（runMigration 里那句 setTimeout(scanAll) 生效了）", `${fNodes} 个节点（${Date.now() - t0}ms）`);

    const t1 = await waitUntil(async () => {
        const t = await toasts(page);
        return t.includes("已迁移 1 个列表块") ? t : null;
    });
    ok(!!t1, "★ 提示说迁移了 1 个 —— map 过滤生效（table 那个不算）", (t1 ?? "(没等到)").slice(0, 30));

    /* ---- 反例：table 标记必须原样保留（源码注释里的设计意图，此前无任何覆盖）---- */
    ok((await page.eval(legacyAttrOf(listB))) === "table", "★ table 标记的列表原样保留（只迁移导图视图）", String(await page.eval(legacyAttrOf(listB))));
    const kB = await kernelAttrs(listB);
    ok(kB["custom-block-list-view"] === "table" && kB["custom-mindmap"] === undefined, "★ 内核侧也没动它", `legacy=${kB["custom-block-list-view"]} view=${kB["custom-mindmap"]}`);

    /* ---- 再点一次：没有可迁移的导图标记了，应当是明确提示而不是静默 ---- */
    const hit2 = await runFromPalette(page, "迁移", "迁移");
    ok(!hit2.err, "第二次也点得到（命令不会因为跑过一次就失效）", hit2.err ?? hit2.text);
    const t2 = await waitUntil(async () => {
        const t = await toasts(page);
        return t.includes("没有找到来自【自定义块样式】的导图列表") ? t : null;
    });
    ok(!!t2, "★ 没有可迁移标记时给出明确提示，而不是点了没反应", (t2 ?? "(没等到)").slice(0, 40));

    /* ============================== G. ★ 通用规则：导图不吃 ⌥⌘ / ⇧⌘ 两个共享族 ==============================
     * D 段只钉住了 `⇧⌘D` 这一个具体键，但真正的规则是**通用的**：
     * `⌥⌘` 与 `⇧⌘` 都是思源与所有插件共享的命名空间，导图必须整族让开。
     *
     * 导图自己绑了 ⌘A/C/V/X/D/F 六个编辑动作，判据漏掉哪个修饰键，
     * 对应的那一族就会在用户按下时变成一次**误操作** —— 其中最狠的是 `⌘X`：
     * 它会照着「剪掉选中节点的子树」去改内核，等于**静默删用户笔记**。
     *
     * 两族的修法不同、也因此**必须分开测**：
     *   · `⌥⌘` → `modOnly = mod && !e.altKey`
     *   · `⇧⌘` → `modLetter = modOnly && !e.shiftKey`（本轮新加；漏了它 `⇧⌘D` 会被 `⌘D` 吃掉）
     *
     * 判据已用对照版证明过**能红**（把 renderer.ts 的判据临时改回 `mod`）：
     *   ⌥⌘A → `.mm-multi` 0 → 2（触发了「全选同级」）
     *   ⌥⌘C → 剪贴板写入次数 0 → 1（触发了「复制节点」）
     *   ⌥⌘X → 内核列表项数 3 → 2（**把用户的列表项剪掉了**）
     * 见 tests/kernel/probe-altmod-swallow.mjs。
     *
     * ⚠️ **「剪贴板被写」≠「导图写了剪贴板」**：`⇧⌘C` 是**思源内置的「复制块引用」**，
     * 导图正确让开之后，思源照样会往剪贴板写一个块引用 ——
     * 于是这条断言会把「让开了」判成失败（**恰好判反**）。
     * ⇒ 这里按**调用栈**把插件写的和别人写的分开（见下面 `pluginCopies`），
     * 并且先跑一次「导图自己的 ⌘C」做**阳性对照**，免得判据本身失效时全绿。
     */
    console.log("\n【G ★ 通用规则：导图不吃 ⌥⌘ / ⇧⌘ 两个共享族】");
    console.log("  （对照实验：判据回退成 mod 时，⌥⌘A → .mm-multi 0→2、⌥⌘C → 剪贴板 0→1、⌥⌘X → 内核 3→2）");
    await page.eval(`(() => {
        if (window.__mmCopyHook) return true;
        window.__mmCopyHook = true;
        window.__mmCopies = 0;
        /* ⚠️ 只记「+1」是查不出东西的 —— 必须连**调用栈**一起记。
           实测踩过：「⇧⌘C」这一格红了（copies 0 → 1），但光看数字分不清是
           导图自己的「复制节点」、思源编辑器的复制、还是浏览器行为。
           记了栈一眼就能定位（copyText ← copySubtree 就是插件，
           栈里有 protyle 的就是思源编辑器）。
           ⚠️ 注释里**不能写反引号** —— 这里整段是模板字符串，一个反引号就把外层截断了
           （本轮又踩一次，症状是「missing ) after argument list」）。 */
        window.__mmCopyStack = [];
        const note = (api, t) => {
            window.__mmCopies++;
            window.__mmCopyStack.push({ api, text: String(t ?? '').slice(0, 40), stack: (new Error().stack || '').split('\\n').slice(1, 8).join(' <- ') });
        };
        try {
            const oe = document.execCommand.bind(document);
            document.execCommand = (c, ...r) => { if (c === 'copy') note('execCommand', ''); return oe(c, ...r); };
        } catch (e) {}
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                const ow = navigator.clipboard.writeText.bind(navigator.clipboard);
                navigator.clipboard.writeText = (t) => { note('writeText', t); return ow(t); };
            }
        } catch (e) {}
        return true;
    })()`);

    /* ★★ 「剪贴板被写」不等于「导图写了剪贴板」。
       实测踩过：「⇧⌘C」这一格红了（copies 0 → 1），但**写入者根本不是插件** ——
       调用栈里是 `stage/build/desktop/main.*.js`，内容是 `((id '甲一'))`（一个块引用）。
       那是**思源自己的「复制块引用」**：`⇧⌘C` 是它的内置键位。
       ⇒ 判据必须按调用栈把「插件写的」和「别人写的」分开，
       否则这条断言会把「导图正确地让开了 ⇧⌘C」判成失败 —— 恰好判反。
       插件是从 `/plugins/siyuan-plugin-mindmap/index.js` 加载的，帧里认得出这个路径。 */
    const PLUGIN_COPY_FRAME = /siyuan-plugin-mindmap/;
    const pluginCopies = (stack) => (stack || []).filter((s) => PLUGIN_COPY_FRAME.test(s.stack));

    const selStart = await selectNode(page, firstLi);
    ok(selStart === 1, "起点干净：导图有焦点、恰好选中 1 个节点", `选中 ${selStart ?? 0} 个`);

    /* ★ 阳性对照：先按一次**导图自己的** ⌘C（单事件 → modLetter 命中 → 插件复制节点），
       确认「按调用栈认插件」这个判据真的认得出来。
       没有它，下面那条「没触发导图的复制」在**判据失效**时会全绿 —— 那是假绿。 */
    await comboSingle(page, "c", { ctrl: true });
    await sleep(900);
    const ctlAll = await page.eval(`window.__mmCopyStack`);
    const ctlPlugin = pluginCopies(ctlAll);
    ok(
        ctlPlugin.length > 0,
        "（前置）阳性对照：导图自己的 ⌘C 写剪贴板时，调用栈里认得出插件 —— 否则下面的「没写」是假绿",
        `插件帧 ${ctlPlugin.length} 条 / 总计 ${ctlAll.length} 条`,
    );
    if (ctlPlugin.length === 0) {
        for (const s of (ctlAll || []).slice(-2)) console.log(`      ↳ 对照写入者 [${s.api}] "${s.text}"\n        ${s.stack}`);
    }
    await selectNode(page, firstLi);

    /* 两族一起跑。`⌥⌘` 与 `⇧⌘` 的修法不同（!e.altKey vs !e.shiftKey），
       只测一族会漏掉另一族的回归 —— 本轮就是 `⇧⌘` 那一族漏了。 */
    const FAMILIES = [
        { prefix: "⌥⌘", send: hotkeySingle, family: "Alt" },
        { prefix: "⇧⌘", send: hotkeyShiftSingle, family: "Shift" },
    ];
    for (const fam of FAMILIES) {
        for (const k of ["a", "c", "x"]) {
            /* 每个键都从干净状态起跑，不然上一个键的副作用会串味 */
            const selBefore = await selectNode(page, firstLi);
            const multiBefore = await page.eval(`document.querySelectorAll('.mm-root .mm-node.mm-multi').length`);
            const itemsBefore = (await kids(listA)).length;
            const copiesBefore = pluginCopies(await page.eval(`window.__mmCopyStack`)).length;
            /* ★ 必须用 `hotkeySingle` / `hotkeyShiftSingle`（单事件）。
               用补发裸修饰键的版本，焦点会被踢出导图、插件根本收不到，
               三条断言会变成「因为没焦点所以什么都没发生」的假绿 —— 第一版就是这么翻的车。 */
            await fam.send(page, k);
            await sleep(1300);
            const itemsAfter = (await kids(listA)).length;
            const multiAfter = await page.eval(`document.querySelectorAll('.mm-root .mm-node.mm-multi').length`);
            const copiesAfter = pluginCopies(await page.eval(`window.__mmCopyStack`)).length;
            const K = k.toUpperCase();
            const tag = `${fam.prefix}${K}`;
            ok(itemsAfter === itemsBefore, `★ ${tag}：内核列表项数不变 —— 没被剪掉（${fam.prefix}X 会直接删用户笔记）`, `${itemsBefore} → ${itemsAfter}`);
            ok(multiBefore === 0 && multiAfter === 0, `★ ${tag}：没出现多选 —— 没触发导图自己的「全选同级」（⌘A）`, `.mm-multi ${multiBefore} → ${multiAfter}`);
            ok(
                copiesAfter === copiesBefore,
                `★ ${tag}：没触发导图自己的「复制节点」（${tag} 不该被当成 ⌘C）`,
                `插件写剪贴板 ${copiesBefore} → ${copiesAfter}（思源自己写的不算）`,
            );
            if (copiesAfter !== copiesBefore) {
                /* 红了就把**谁写的**打出来。没有这段，下一个人还是只能盯着「0 → 1」猜。 */
                const st = pluginCopies(await page.eval(`window.__mmCopyStack`)).slice(-2);
                for (const s of st) console.log(`      ↳ 插件写入者 [${s.api}] "${s.text}"\n        ${s.stack}`);
            }
            /* 自证式前置：没有它，上面三条在「焦点丢了」时也会全绿 */
            ok(selBefore >= 1, `（前置）${tag} 之前确实选中了节点 —— 不然上面三条测的是空气`, `选中 ${selBefore} 个`);
        }
    }
    ok(await page.eval(`!!document.querySelector('.mm-root .mm-node')`), "导图还开着（以上按键一个都没把它关掉）");

    /* ============================== H. ★ 回归：真实键盘式的按键也要能到插件 ==============================
     * 这一条钉的是一个**被测试掩盖了很久**的真 bug：
     *
     * 真实键盘按 Ctrl+D 会先产生一个 `key === "Control"` 的 keydown。这一下导图
     * 没有动作可做（不会 preventDefault），可思源的编辑器照样在这个 keydown 里
     * focus 自己 —— 焦点被抢到 `.protyle-wysiwyg`，而它**是 `.mm-root` 的祖先**，
     * 于是紧接着的 `D` 那一下 target 已经不在导图里，`handleGlobalKey` 开头就 return。
     * 结果：**整套 Ctrl 快捷键（A / C / V / X / D、缩放那几个）在真实键盘下全部失灵。**
     *
     * 为什么以前没发现：本文件（以及 tests/ 里所有键盘用例）用的都是
     * `comboSingle` 那种「只发字母 + modifiers 位」的单事件发法，**没有裸修饰键那一下**，
     * 焦点不会丢 —— 于是测试全绿，真实用户按 Ctrl+D 却没反应。
     *
     * 实测（修复前）：真键盘式 Ctrl+D → 焦点 mm-root → protyle-wysiwyg，内核 3 → 3。
     * 修复见 renderer.ts 的 `handleGlobalKey` / `restoreFocus`。
     */
    console.log("\n【H ★ 回归：真实键盘式的 Ctrl+D】");
    console.log("  （先发 ControlLeft 的 keydown、再发 D —— 真实键盘就是这个顺序，");
    console.log("   而这一步必须用补发裸修饰键的 `ctrlReal`，单事件发法引不出这个 bug）");
    const selH = await selectNode(page, firstLi);
    const itemsH = (await kids(listA)).length;
    const focusH0 = await page.eval(`(document.activeElement && (document.activeElement.className || document.activeElement.tagName)) + ''`);
    await ctrlReal(page, "d");
    await sleep(1800);
    const itemsH2 = (await kids(listA)).length;
    const focusH1 = await page.eval(`(document.activeElement && (document.activeElement.className || document.activeElement.tagName)) + ''`);
    ok(selH >= 1, "（前置）导图有焦点、选中了节点 —— 不然下面两条测的是空气", `选中 ${selH} 个`);
    ok(
        itemsH2 > itemsH,
        "★★ 真实键盘式的 Ctrl+D 被插件收到了（复制节点生效）—— 焦点没被思源编辑器抢走",
        `${itemsH} → ${itemsH2}｜焦点 ${focusH0} → ${focusH1}`,
    );
    ok(
        await page.eval(`(() => { const r = document.querySelector('.mm-root'); return !!r && r.contains(document.activeElement); })()`),
        "★★ 按键之后焦点仍然落在导图里（后续的 Ctrl+字母 才能继续生效）",
        focusH1,
    );

    await page.screenshot(`${OUT}/diag-commands.png`);

    console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
    if (fail === 0) console.log("✓ 四个入口 + 三条命令都成立：顶栏菜单逐个生效，命令面板显示中文，默认快捷键能切换且不吃掉全局键，迁移命令真机跑通；⌥⌘ 通用规则成立；真实键盘下的 Ctrl 快捷键也能到插件");
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}

process.exit(fail === 0 ? 0 : 1);
