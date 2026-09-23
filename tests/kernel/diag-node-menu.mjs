/**
 * 节点右键菜单的真机验收。
 *
 * 起因：`scripts/coverage-audit.mjs` 修好「静默空转」之后，零命中清单里最扎眼的
 * 是**整个节点右键菜单** —— 编辑文字 / 在下方插入 / 复制子树 / 复制文字 /
 * 定位到编辑器 / 降级为上一个节点的子节点 / 升级为父节点的兄弟 / 折叠子节点 /
 * 聚焦此分支 / 退出聚焦 …… 十几条入口一次都没被跑过。
 *
 * 它们全是「点一下就该有反应」的东西，而「有实现、没断言」正是最容易悄悄坏掉的一类：
 * 菜单弹得出来（`probe-menu.mjs` 覆盖了菜单本身），但里面的动作可能压根没接上、
 * 或者接错了块、或者置灰逻辑反了。
 *
 * 所以这一支的原则是：**每一项都真的点下去，然后看内核里有没有对应变化**。
 * 只断言「菜单里有没有这几个字」不算验收 —— 那只能证明 label 写对了。
 *
 * ── 三条踩过的坑（都是这支探针自己的错，不是插件的）────────────────────
 *
 * 1. **kramdown 里混着 IAL**（`- {: id="…" updated="…"}甲分支`），`updated` 还是时间戳。
 *    所以任何「按字符串比较前后是否一致」的写法都必然失败。这里统一过一道
 *    `outline()`：只留「缩进深度 + 文字 + 待办勾选态」，其余全丢。
 *
 * 2. **页内补丁会被导航清掉**。拦剪贴板 / 拦 `scrollIntoView` 这类钩子如果在
 *    `Page.navigate` **之前**装，导航一发生就没了 —— 表现是「记录恒为空数组」，
 *    看起来像功能坏了。必须装完再导航（这里导航了两次，所以装了两次）。
 *
 * 3. **「定位到编辑器」会先退出导图视图**。源列表在导图模式下是 `display:none`，
 *    不退出就没法滚过去（`scanner.locate()` 里写着）。这是**设计**，不是 bug ——
 *    所以断言要写成「视图真的退了 + 大纲里那个块真的被高亮」，然后重新把图开起来。
 *
 * 覆盖：
 *   1. 菜单结构            右键「甲分支」→ 15 项齐全；未聚焦时没有「退出聚焦」；
 *                          没标记时是「添加标记」而不是「编辑标记」
 *   2. 置灰判据            首个子节点的「上移 / 降级」该灰、「升级」该灰、「下移」不该灰
 *                          （这一节同时是**置灰探针的自检** —— 全灰或全不灰都会报红）
 *   3. 编辑文字            点它 → 进入编辑态
 *   4. 在下方插入          点它 → 内核多出一个兄弟节点，且紧跟在原节点之后
 *   5. 聚焦此分支          点它 → 面包屑出现、画布收窄到这一支
 *   6. 退出聚焦，回到全图  聚焦后菜单里才出现；点它 → 还原
 *   7. 折叠 / 展开子节点   点「折叠子节点」→ 子节点隐藏；再点「展开（2 个子节点）」→ 还原
 *   8. 降级 / 升级         在「甲.2」上做（它的前一个兄弟是「甲.1」）→ 缩进真的变了，且可逆
 *   9. 上移 / 下移         在「乙分支」上做 → 大纲里顺序真的变了，且可逆
 *  10. 复制子树            剪贴板拿到整棵子树的 markdown（含缩进）
 *  11. 复制文字            剪贴板拿到该节点这一行
 *  12. 定位到编辑器        退出视图 + 大纲对应块被高亮（mm-flash）
 *  13. 快速复制            点它 → 节点数 +1，副本紧跟原节点
 *  14. 待办：标记为已完成 / 标记为未完成  勾选态真的翻转
 *  15. 添加标记 / 编辑标记 浮层弹得出来；加完标记后菜单文案变成「编辑标记」
 *  16. 删除节点（含 n 个子节点）  点它 → 那棵子树真的从内核消失
 *  17. 批量条「导出这些」+ 导出菜单「只导出选中的 {n} 个节点」
 *
 * 全程用自己新建的临时文档，跑完删掉。
 *
 * 用法：node tests/kernel/diag-node-menu.mjs
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
const kramdown = async (id) => {
    const j = await api("/api/block/getBlockKramdown", { id });
    return j.code === 0 ? j.data?.kramdown ?? "" : "";
};

/* ---------------------------------------------------------------- 建测试文档 */

const MD = [
    "- 菜单验证",
    "  - 甲分支",
    "    - 甲.1",
    "    - 甲.2",
    "  - 乙分支",
    "    - 乙.1",
    "  - 任务组",
    "    - [x] 已办事项",
    "    - [ ] 待办事项",
    "",
].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-节点菜单-${Date.now()}`,
    markdown: MD,
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const doc = docRes.data;
const listId = (await kids(doc)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });
console.log(`文档 ${doc} · 列表 ${listId}\n`);

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

const ROOT = `document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)')`;

/**
 * kramdown → 「深度 + 文字 + 待办勾选态」。
 *
 * 必须过这一道：内核回出来的 kramdown 里每条都挂着 IAL
 * （`- {: id="…" updated="…"}甲分支`），`updated` 是时间戳 ——
 * 直接拿两个时刻的 kramdown 比字符串，**永远不可能相等**。
 * 这里只留下结构信息，把 id / updated / 空行 / 缩进以外的空白全部丢掉。
 */
const outline = (md) =>
    md.split("\n")
        .filter((l) => /^\s*- /.test(l))
        .map((l) => {
            const indent = (l.match(/^\s*/) || [""])[0].length;
            let text = l.replace(/^\s*- /, "").replace(/\{:[^}]*\}/g, "").trim();
            const m = /^\[([ xX])\]\s*/.exec(text);
            const checked = m ? m[1].toLowerCase() === "x" : null;
            if (m) text = text.slice(m[0].length).trim();
            return { depth: Math.floor(indent / 2), text, checked };
        });

const outlineOf = async () => outline(await kramdown(listId));
/** 只比结构，不比时间戳 */
const shapeOf = async () => (await outlineOf()).map((x) => `${"  ".repeat(x.depth)}${x.text}`).join("\n");
const idxOf = (o, t) => o.findIndex((x) => x.text === t);
const depthOf = (o, t) => {
    const f = o.find((x) => x.text === t);
    return f ? f.depth : -1;
};
const countOf = (o, t) => o.filter((x) => x.text === t).length;
/** 最后一次出现的下标。粘贴出副本之后，「首次出现」那一条还在原处 —— 用它判断位置会得出相反结论。 */
const lastIdxOf = (o, t) => {
    let k = -1;
    o.forEach((x, i) => {
        if (x.text === t) k = i;
    });
    return k;
};

/** 把某个节点的右键菜单弹出来（按节点文字找） */
const menuOn = (text) => `(() => {
    const root = ${ROOT};
    if (!root) return { err: 'no root' };
    root.scrollIntoView({ block: 'center' });
    const els = [...root.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden');
    const hit = els.find((e) => ((e.querySelector('.mm-txt') || e).textContent || '').trim().includes(${JSON.stringify(text)}));
    if (!hit) return { err: 'no node', have: els.map((e) => ((e.querySelector('.mm-txt') || e).textContent || '').trim()) };
    const r = hit.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    return { x, y };
})()`;

/**
 * 读当前打开着的那个菜单。
 *
 * ⚠️ 思源的 Menu 是**单例容器**（`#commonMenu`），关闭只是加 `fn__none`，
 * 所以不能数 `.b3-menu` 的个数 —— 必须看 `display`。
 *
 * ⚠️⚠️ 禁用态是 **`disabled` 属性**，不是 class。前端产物里那句是
 * `if (T.disabled && this.element.setAttribute("disabled","disabled"), …)`
 * —— `b3-menu__item--disabled` 这个类名只被思源自己的属性视图菜单手动用，
 * 通用 `Menu.addItem` **从不加它**。
 * 查错标记的后果是「探针恒为 false」：所有「该置灰」的断言全红，
 * 而所有「不该置灰」的断言全绿 —— 看起来像插件置灰逻辑全反了，其实是探针瞎了。
 * 所以 [2] 特意留了「下移该可用」这条反例：它和「上移该置灰」互为自检，
 * 一个恒 true / 恒 false 的探针不可能同时骗过两边。
 */
const MENU = `(() => {
    const ms = [...document.querySelectorAll('.b3-menu')].filter((m) => getComputedStyle(m).display !== 'none');
    const m = ms[ms.length - 1];
    if (!m) return { open: false, items: [] };
    return {
        open: true,
        items: [...m.querySelectorAll('.b3-menu__item')].map((e) => ({
            text: (e.textContent || '').trim(),
            disabled: e.hasAttribute('disabled') || e.classList.contains('b3-menu__item--disabled'),
        })),
    };
})()`;

/** 点菜单里的一项（合成事件，跟 diag-canvas-v2 的导出一致） */
const clickMenuItem = (text) => `(() => {
    const ms = [...document.querySelectorAll('.b3-menu')].filter((m) => getComputedStyle(m).display !== 'none');
    const m = ms[ms.length - 1];
    if (!m) return 'no-menu';
    const it = [...m.querySelectorAll('.b3-menu__item')].find((x) => (x.textContent || '').trim().includes(${JSON.stringify(text)}));
    if (!it) return 'no-item';
    const r = it.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
    it.dispatchEvent(new MouseEvent('mousedown', o));
    it.dispatchEvent(new MouseEvent('mouseup', o));
    it.click();
    return 'clicked';
})()`;

const STATE = `(() => {
    const root = ${ROOT};
    if (!root) return { err: 'no root' };
    const els = [...root.querySelectorAll('.mm-node')];
    const ed = root.querySelector('.mm-node[data-mm-editing]');
    return {
        total: els.length,
        visible: els.filter((e) => e.style.visibility !== 'hidden').length,
        texts: els.map((e) => ((e.querySelector('.mm-txt') || e).textContent || '').trim()),
        editing: !!ed,
        // 面包屑的开关类名是 mm-crumb--on（挂在 .mm-crumb 自己身上），不是 mm-crumb-on
        crumbOn: !!root.querySelector('.mm-crumb.mm-crumb--on'),
        crumbText: ((root.querySelector('.mm-crumb') || {}).textContent || '').trim(),
        batch: !!root.querySelector('.mm-batch'),
        markPop: !!root.querySelector('.mm-mark-pop'),
    };
})()`;

/** 页内钩子：拦剪贴板 / 拦 scrollIntoView。**每次导航之后都要重装。** */
const HOOKS = `(() => {
    window.__copies = [];
    window.__scrolls = [];
    window.__mmErrors = window.__mmErrors || [];
    try {
        const c = navigator.clipboard;
        if (c && c.writeText && !c.__mmHooked) {
            const ow = c.writeText.bind(c);
            c.writeText = (t) => { window.__copies.push(String(t)); return ow(t); };
            c.__mmHooked = true;
        }
    } catch (e) { window.__copyHookErr = String(e); }
    // 兜底分支（execCommand）也记一笔 —— 非安全上下文下插件会走这里
    if (!document.__mmExecHooked) {
        const oe = document.execCommand && document.execCommand.bind(document);
        if (oe) {
            document.execCommand = function (cmd, ...rest) {
                const okv = oe(cmd, ...rest);
                if (cmd === 'copy') {
                    const ta = [...document.querySelectorAll('textarea')].pop();
                    window.__copies.push(ta ? ta.value : '');
                }
                return okv;
            };
            document.__mmExecHooked = true;
        }
    }
    if (!Element.prototype.__mmScrollHooked) {
        const os = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (...a) {
            window.__scrolls.push(this.getAttribute && (this.getAttribute('data-node-id') || this.getAttribute('data-mm-id') || ''));
            return os.apply(this, a);
        };
        Element.prototype.__mmScrollHooked = true;
    }
    return 'ok';
})()`;

/* ---------------------------------------------------------------- 打开浏览器 */

const chrome = await launch({ headless: true, width: 1500, height: 1000 });
const page = await chrome.newPage("about:blank");

const copies = () => page.eval(`window.__copies.slice()`);
const clearCopies = () => page.eval(`(() => { window.__copies = []; return 'ok'; })()`);
const scrolls = () => page.eval(`window.__scrolls.slice()`);

async function waitFor(fn, { timeout = 5000, interval = 200, label = "" } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    for (;;) {
        last = await fn();
        if (last) return last;
        if (Date.now() >= deadline) {
            if (label) console.log(`  （等待超时：${label}）`);
            return last;
        }
        await sleep(interval);
    }
}

/**
 * 等「结构」变成 pred 满意的样子，**并把那一刻的结构返回出来**。
 * 写回是异步的（420ms 防抖），拿固定 sleep 等不稳。
 *
 * ⚠️ 必须返回 outline 本身，不能返回 `true` —— 调用方后面要拿它去
 * `idxOf / depthOf`。返回布尔的话，下一行就是 `o.find is not a function`。
 */
const waitShape = (pred, label) =>
    waitFor(
        async () => {
            const o = await outlineOf();
            return pred(o) ? o : null;
        },
        { label },
    );

/** 打开（或重新打开）导图页面 */
async function openMap(label) {
    await page.send("Page.navigate", { url: `${KERNEL}/stage/build/desktop/?id=${doc}` });
    await sleep(3600);
    const okv = await page.waitFor(`${ROOT} !== null`, { timeout: 30000, label });
    await sleep(600);
    await page.eval(HOOKS); // ⚠️ 导航会清掉页内钩子，每次都要重装
    return okv;
}

/** 按节点文字取坐标（用于真实鼠标点击 / 加选） */
const selAt = (t) => `(() => {
    const root = ${ROOT};
    if (!root) return { err: 'no root' };
    root.scrollIntoView({ block: 'center' });
    const els = [...root.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden');
    const hit = els.find((e) => ((e.querySelector('.mm-txt') || e).textContent || '').trim() === ${JSON.stringify(t)});
    if (!hit) return { err: 'no node ' + ${JSON.stringify(t)} };
    const r = hit.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

/**
 * 真实鼠标点击。
 * ⚠️ `page.mouse` 的 `extra.modifiers` 是**位掩码**（Alt=1 Ctrl=2 Meta=4 Shift=8），
 *    不是 `{ ctrl: true }`。写成对象会被静默忽略 → 变成普通单击 → 加选不成立，
 *    而报错信息只会说「批量条没出现」，查半天查不到根因。
 */
const tap = async (pt, modifiers = 0) => {
    if (!pt || pt.err) return false;
    await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0, modifiers });
    await page.mouse("mousePressed", pt.x, pt.y, { modifiers });
    await page.mouse("mouseReleased", pt.x, pt.y, { modifiers });
    return true;
};

/** 弹菜单 → 点某一项。返回点击结果字符串 */
async function pick(nodeText, itemText, settle = 900) {
    const opened = await page.eval(menuOn(nodeText));
    await sleep(350);
    const r = await page.eval(clickMenuItem(itemText));
    await sleep(settle);
    if (r !== "clicked" && opened && opened.err) console.log(`    （菜单没弹出来：${JSON.stringify(opened)}）`);
    return r;
}

try {
    await openMap("导图挂载");

    /* ============================================================ 1. 菜单结构 */
    console.log("\n[1] 菜单结构");
    await page.eval(menuOn("甲分支"));
    await sleep(400);
    const s1 = await page.eval(MENU);
    const texts1 = (s1.items || []).map((i) => i.text);
    const WANT = [
        "添加标记（图标 / 标签 / 颜色）",
        "编辑文字",
        "插入子节点",
        "在下方插入",
        "聚焦此分支（只看这一支）",
        "上移",
        "下移",
        "降级为上一个节点的子节点",
        "升级为父节点的兄弟",
        "折叠子节点",
        "复制子树",
        "快速复制",
        "复制文字",
        "定位到编辑器",
        "删除节点（含 2 个子节点）",
    ];
    const missing = WANT.filter((w) => !texts1.some((t) => t.includes(w)));
    ok(s1.open, "右键节点弹出了菜单", `${texts1.length} 项`);
    ok(missing.length === 0, "菜单里 15 项该有的全都有", missing.length ? `缺：${missing.join(" / ")}` : "");
    ok(!texts1.some((t) => t.includes("退出聚焦")), "没聚焦时菜单里没有「退出聚焦，回到全图」");
    ok(!texts1.some((t) => t.includes("编辑标记")), "没标记时是「添加标记」，不是「编辑标记」");

    /* ============================================================ 2. 置灰判据 */
    console.log("\n[2] 置灰判据（同时是探针自检）");
    const dis1 = (t) => (s1.items.find((i) => i.text.includes(t)) || {}).disabled;
    // 「甲分支」是根的第一个子节点：前面没有兄弟 → 上移 / 降级 都不该可用
    ok(dis1("上移") === true, "「甲分支」是首个子节点 → 「上移」置灰");
    ok(dis1("降级为上一个节点的子节点") === true, "「甲分支」前面没有兄弟 → 「降级」置灰");
    // 但它的父是根节点「菜单验证」，那是个**真实列表项** → 升级是合法的
    ok(dis1("升级为父节点的兄弟") === false, "「甲分支」的父是真实列表项 → 「升级」可用");
    // 反例：下移该是**可用**的。如果置灰探针坏了（恒为 true），这条会红。
    ok(dis1("下移") === false, "「甲分支」后面还有兄弟 → 「下移」可用");
    ok(dis1("定位到编辑器") === false, "有块 ID 的节点 → 「定位到编辑器」可用");
    await page.press("Escape");
    await sleep(300);

    // 「甲.2」前面有「甲.1」→ 降级该可用；父是「甲分支」（真实列表项）→ 升级也可用
    await page.eval(menuOn("甲.2"));
    await sleep(400);
    const s2 = await page.eval(MENU);
    const dis2 = (t) => (s2.items.find((i) => i.text.includes(t)) || {}).disabled;
    ok(dis2("降级为上一个节点的子节点") === false, "「甲.2」前面有「甲.1」→ 「降级」可用");
    ok(dis2("升级为父节点的兄弟") === false, "「甲.2」的父是真实列表项 → 「升级」可用");
    // 同一个「上移」在「甲分支」上该灰、在「甲.2」上该亮 —— 这一对才是真正的自检
    ok(dis2("上移") === false, "「甲.2」前面有兄弟 → 「上移」可用（与「甲分支」那条互为反例）");
    await page.press("Escape");
    await sleep(300);

    // 根节点「菜单验证」的父才是**虚拟根** —— 只有它这里「升级」才该灰
    await page.eval(menuOn("菜单验证"));
    await sleep(400);
    const s2r = await page.eval(MENU);
    const disR = (t) => (s2r.items.find((i) => i.text.includes(t)) || {}).disabled;
    ok(disR("升级为父节点的兄弟") === true, "根节点「菜单验证」的父是虚拟根 → 「升级」置灰");
    ok(disR("上移") === true, "根节点没有兄弟 → 「上移」置灰");
    ok(disR("降级为上一个节点的子节点") === true, "根节点没有前一个兄弟 → 「降级」置灰");
    ok(disR("折叠子节点") === false, "根节点有 3 个子节点 → 「折叠子节点」可用");
    await page.press("Escape");
    await sleep(300);

    /* ============================================================ 3. 编辑文字 */
    console.log("\n[3] 编辑文字");
    const c3 = await pick("乙.1", "编辑文字");
    const s3 = await page.eval(STATE);
    ok(c3 === "clicked" && s3.editing, "点「编辑文字」进入了编辑态", `clicked=${c3} editing=${s3.editing}`);
    await page.press("Escape");
    await sleep(400);
    ok(!(await page.eval(STATE)).editing, "Esc 退出编辑态");

    /* ============================================================ 4. 在下方插入 */
    console.log("\n[4] 在下方插入");
    const before4 = (await page.eval(STATE)).total;
    const c4 = await pick("乙.1", "在下方插入", 1200);
    const s4 = await page.eval(STATE);
    ok(c4 === "clicked", "点到了「在下方插入」", c4);
    ok(s4.total === before4 + 1, "画布上多出一个节点", `${before4} → ${s4.total}`);
    ok(s4.editing, "新节点自动进入编辑态（省一次双击）");
    await page.press("Escape");
    await sleep(600);
    const o4 = await waitFor(async () => {
        const o = await outlineOf();
        return o.some((x) => x.text === "新节点") ? o : null;
    }, { label: "kramdown 出现「新节点」" });
    ok(!!o4, "新节点写进了内核");
    // 位置判据：它必须紧跟在「乙.1」之后，而不是掉到列表末尾
    const o4v = o4 || (await outlineOf());
    ok(idxOf(o4v, "新节点") === idxOf(o4v, "乙.1") + 1, "新节点紧跟在「乙.1」之后（不是掉到末尾）", `乙.1@${idxOf(o4v, "乙.1")} 新节点@${idxOf(o4v, "新节点")}`);

    /* ============================================================ 5. 聚焦此分支 */
    console.log("\n[5] 聚焦此分支");
    const before5 = (await page.eval(STATE)).total;
    const c5 = await pick("甲分支", "聚焦此分支（只看这一支）", 1100);
    const s5 = await page.eval(STATE);
    ok(c5 === "clicked", "点到了「聚焦此分支」", c5);
    ok(s5.crumbOn, "面包屑出现了（说明真的下钻了）", s5.crumbText.slice(0, 20));
    ok(s5.total < before5, "画布收窄到这一支", `共 ${before5} → ${s5.total}`);
    ok(
        ["甲分支", "甲.1", "甲.2"].every((t) => s5.texts.includes(t)) && !s5.texts.includes("乙分支"),
        "留在画布上的正好是「甲分支」这一支",
        JSON.stringify(s5.texts),
    );

    /* ============================================================ 6. 退出聚焦 */
    console.log("\n[6] 退出聚焦，回到全图");
    await page.eval(menuOn("甲.1"));
    await sleep(400);
    const s6a = await page.eval(MENU);
    ok((s6a.items || []).some((i) => i.text.includes("退出聚焦，回到全图")), "聚焦后菜单里才有「退出聚焦，回到全图」");
    const c6 = await page.eval(clickMenuItem("退出聚焦，回到全图"));
    await sleep(1100);
    const s6 = await page.eval(STATE);
    ok(c6 === "clicked" && !s6.crumbOn, "点它之后回到全图", `clicked=${c6} crumb=${s6.crumbOn}`);
    ok(s6.total === before5, "全部节点重新出现", `${s6.total} / 原 ${before5}`);
    ok(s6.texts.includes("乙分支") && s6.texts.includes("任务组"), "其它分支也回来了");

    /* ============================================================ 7. 折叠 / 展开 */
    console.log("\n[7] 折叠子节点 / 展开");
    const before7 = (await page.eval(STATE)).visible;
    const c7 = await pick("甲分支", "折叠子节点", 900);
    const s7 = await page.eval(STATE);
    ok(c7 === "clicked", "点到了「折叠子节点」", c7);
    ok(s7.visible < before7, "子节点真的收起来了", `可见 ${before7} → ${s7.visible}`);

    await page.eval(menuOn("甲分支"));
    await sleep(400);
    const s7b = await page.eval(MENU);
    ok((s7b.items || []).some((i) => i.text.includes("展开（2 个子节点）")), "折叠后菜单文案变成「展开（2 个子节点）」");
    const c7b = await page.eval(clickMenuItem("展开（2 个子节点）"));
    await sleep(900);
    const s7c = await page.eval(STATE);
    ok(c7b === "clicked" && s7c.visible === before7, "点「展开」后回到原来的可见数", `clicked=${c7b} 可见 ${s7c.visible}`);

    /* ============================================================ 8. 降级 / 升级 */
    console.log("\n[8] 降级为上一个节点的子节点 / 升级为父节点的兄弟");
    const shape8a = await shapeOf();
    const c8 = await pick("甲.2", "降级为上一个节点的子节点", 1200);
    const o8 = await waitShape((o) => depthOf(o, "甲.2") === 3, "「甲.2」缩进到「甲.1」下面");
    ok(c8 === "clicked", "点到了「降级」", c8);
    ok(!!o8, "「甲.2」在内核里真的缩进了一层", `深度 2 → ${depthOf(o8 || (await outlineOf()), "甲.2")}`);
    const o8v = o8 || (await outlineOf());
    ok(idxOf(o8v, "甲.2") === idxOf(o8v, "甲.1") + 1, "而且紧跟在「甲.1」之后（降级为它的子节点）");
    if (!o8) console.log("    实际:\n" + (await shapeOf()).split("\n").map((l) => "      " + l).join("\n"));

    const c8b = await pick("甲.2", "升级为父节点的兄弟", 1200);
    const o8b = await waitShape((o) => depthOf(o, "甲.2") === 2, "「甲.2」升回「甲分支」下");
    ok(c8b === "clicked", "点到了「升级」", c8b);
    ok(!!o8b, "「甲.2」在内核里真的升回了一层");
    ok((await shapeOf()) === shape8a, "一降一升之后结构逐行还原（可逆）");

    /* ============================================================ 9. 上移 / 下移 */
    console.log("\n[9] 上移 / 下移");
    const shape9a = await shapeOf();
    const c9 = await pick("乙分支", "上移", 1200);
    const o9 = await waitShape((o) => idxOf(o, "乙分支") < idxOf(o, "甲分支"), "「乙分支」排到「甲分支」前面");
    ok(c9 === "clicked", "点到了「上移」", c9);
    ok(!!o9, "「乙分支」在大纲里跑到了「甲分支」前面", `乙@${idxOf(o9 || (await outlineOf()), "乙分支")} 甲@${idxOf(o9 || (await outlineOf()), "甲分支")}`);
    const c9b = await pick("乙分支", "下移", 1200);
    await waitShape((o) => idxOf(o, "乙分支") > idxOf(o, "甲分支"), "「乙分支」挪回原位");
    ok(c9b === "clicked" && (await shapeOf()) === shape9a, "「下移」把它挪回原位（结构逐行还原）", c9b);

    /* ============================================================ 10. 复制子树 */
    console.log("\n[10] 复制子树（图内剪贴板放子树，系统剪贴板放节点文字）");
    await clearCopies();
    const c10 = await pick("甲分支", "复制子树", 1000);
    const cp10 = await copies();
    const last10 = (cp10[cp10.length - 1] || "").trim();
    ok(c10 === "clicked", "点到了「复制子树」", c10);
    // 速查表的承诺是「Ctrl+C 复制子树 · Ctrl+V 粘贴为子节点」——
    // 所以子树进的是**图内**剪贴板，系统剪贴板只放这个节点自己的文字
    // （往系统剪贴板塞一段带 `-` 缩进的 markdown，粘到别处反而碍事）。
    ok(last10 === "甲分支", "系统剪贴板拿到的是这个节点自己的文字（不是一整段 markdown）", JSON.stringify(last10));

    // 真判据：图内粘贴。选中「乙.1」按 Ctrl+V，整棵子树该挂到它下面。
    //
    // ⚠️ `serializeSubtree(n)` 是**带自己那一行**的（depth 从 0 起），所以复制「甲分支」
    //    得到的是「甲分支 + 甲.1 + 甲.2」三行。粘到「乙.1」下面之后长这样：
    //        乙.1
    //          甲分支      ← 副本，depth = 乙.1 + 1
    //            甲.1      ← depth = 乙.1 + 2
    //            甲.2
    //    我第一版按「甲.1 的 depth 应该等于 乙.1 + 1」写断言，**差了一层**，
    //    于是等待超时 —— 而 `甲.1 ×2` 明摆着粘贴已经成功。教训：断言写错时，
    //    报红的是探针，不是插件。
    const shape10a = await shapeOf();
    await tap(await page.eval(selAt("乙.1")));
    await sleep(400);
    await page.press("v", { ctrl: true });
    // ⚠️ 判据必须看**最后一次**出现的「甲分支」：粘贴出的是副本，
    //    原来那份还在原位，用「首次出现」比位置会得出相反结论。
    const o10 = await waitShape((o) => {
        if (countOf(o, "甲分支") !== 2) return false;
        const yi = idxOf(o, "乙.1");
        const j = lastIdxOf(o, "甲分支");
        if (yi < 0 || j !== yi + 1) return false;
        return (
            o[j].depth === o[yi].depth + 1 &&
            o[j + 1]?.text === "甲.1" && o[j + 1].depth === o[j].depth + 1 &&
            o[j + 2]?.text === "甲.2" && o[j + 2].depth === o[j].depth + 1
        );
    }, "整棵「甲分支」子树挂到「乙.1」下面");
    ok(!!o10, "Ctrl+V 把整棵子树粘贴成了「乙.1」的子节点（含它自己那一行）");
    if (!o10) console.log("    实际:\n" + (await shapeOf()).split("\n").map((l) => "      " + l).join("\n"));
    const o10v = o10 || (await outlineOf());
    const cnt = (t) => countOf(o10v, t);
    ok(cnt("甲分支") === 2 && cnt("甲.1") === 2 && cnt("甲.2") === 2, "整棵子树 3 个节点都跟着过来了", `甲分支 ×${cnt("甲分支")} 甲.1 ×${cnt("甲.1")} 甲.2 ×${cnt("甲.2")}`);

    // 撤销：Protyle 会把整个 `.list` 元素换掉，插件要等下一次扫描才把视图重挂到新元素上。
    // 这里装一个页内计时器，把「导图不在页面上」那段空白**量出来** ——
    // 光看「某一刻 ROOT 是 null」会误判成「导图永远消失了」（我第一版就是这么误判的，
    // 其实只空了 150ms）。这条断言是 `rescanSoon()` 连扫修复的**回归门**：
    // 一旦有人把连扫改回一次，空白会立刻涨回秒级，这里就会红。
    await page.eval(`(() => {
        window.__mmGap = { t0: performance.now(), down: 0, up: 0, events: [] };
        const has = () => !!${ROOT};
        let was = has();
        window.__mmGapTimer = setInterval(() => {
            const up = has();
            const at = Math.round(performance.now() - window.__mmGap.t0);
            if (was && !up) { window.__mmGap.down = at; window.__mmGap.events.push('没了@' + at); }
            if (!was && up) { window.__mmGap.up = at; window.__mmGap.events.push('回来@' + at); }
            was = up;
        }, 50);
        return 'ok';
    })()`);
    await page.press("z", { ctrl: true });
    await waitShape((o) => countOf(o, "甲.1") === 1, "撤销粘贴");
    ok((await shapeOf()) === shape10a, "Ctrl+Z 撤销粘贴，结构还原（后面几节的前提没被破坏）");
    await sleep(3200);
    const gap = await page.eval(`(() => { clearInterval(window.__mmGapTimer); const g = window.__mmGap; return { down: g.down, up: g.up, events: g.events }; })()`);
    // 全程都在（`down === 0`）当然最好，也算过；真掉下去了才量空白。
    const gapMs = gap.down === 0 ? 0 : gap.up - gap.down;
    ok(gap.down === 0 || (gap.up > 0 && gapMs < 900), "撤销后导图很快自己回来（空白 < 900ms，不会让人以为坏了）",
        gap.down === 0 ? "全程都在，没断过" : `空白 ${gapMs} ms｜${JSON.stringify(gap.events)}`);

    /* ============================================================ 11. 复制文字 */
    console.log("\n[11] 复制文字");
    // 上一节刚经历一次整块写回 + 撤销，Protyle 换 `.list` 是异步的。
    // 不等导图回来就弹菜单，探针会报 `no-menu` / `no root` —— 那是探针太急，不是功能坏了。
    await page.waitFor(`!!${ROOT}`, { timeout: 15000, label: "等导图回来再点下一项" });
    await clearCopies();
    const c11 = await pick("乙.1", "复制文字", 1000);
    const cp11 = await copies();
    const last11 = (cp11[cp11.length - 1] || "").trim();
    ok(c11 === "clicked", "点到了「复制文字」", c11);
    ok(last11 === "乙.1", "剪贴板拿到的正好是这个节点的文字", JSON.stringify(last11));
    ok(!last11.includes("甲"), "没有把别的节点一起带上");

    /* ============================================================ 12. 定位到编辑器 */
    console.log("\n[12] 定位到编辑器（会先退出导图视图 —— 源列表在导图模式下是隐藏的）");
    await page.eval(`(() => { window.__scrolls = []; return 'ok'; })()`);
    const id12 = await page.eval(`(() => {
        const root = ${ROOT};
        const els = [...root.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden');
        const hit = els.find((e) => ((e.querySelector('.mm-txt') || e).textContent || '').trim() === '乙.1');
        return hit ? (hit.getAttribute('data-mm-id') || '') : '';
    })()`);
    await page.eval(menuOn("乙.1"));
    await sleep(400);
    const c12 = await page.eval(clickMenuItem("定位到编辑器"));
    await sleep(450);
    const s12 = await page.eval(`(() => ({
        rootGone: !${ROOT},
        flash: [...document.querySelectorAll('.protyle-wysiwyg [data-node-id].mm-flash')].map((e) => e.getAttribute('data-node-id')),
    }))()`);
    ok(c12 === "clicked", "点到了「定位到编辑器」", c12);
    ok(s12.rootGone, "导图视图退出了（不退出去，源列表还是 display:none，滚过去也看不见）");
    ok(!!id12 && (s12.flash || []).includes(id12), "大纲里那个块被高亮出来了（mm-flash）", `目标 ${id12}｜高亮 ${JSON.stringify(s12.flash)}`);
    const sc12 = await scrolls();
    ok(sc12.includes(id12), "确实对那个块调了 scrollIntoView", JSON.stringify(sc12.filter(Boolean)));

    /* ---- 重新把图开起来（退出视图时 custom-mindmap 被摘掉了，要重新写上）---- */
    await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });
    await openMap("导图重新挂载");
    ok(await page.eval(`!!${ROOT}`), "重新打开文档后导图又回来了");

    /* ============================================================ 13. 快速复制 */
    console.log("\n[13] 快速复制");
    const before13 = (await page.eval(STATE)).total;
    const c13 = await pick("乙.1", "快速复制", 1300);
    const s13 = await page.eval(STATE);
    ok(c13 === "clicked", "点到了「快速复制」", c13);
    ok(s13.total === before13 + 1, "节点数 +1", `${before13} → ${s13.total}`);
    const o13 = await waitShape((o) => countOf(o, "乙.1") === 2, "内核里出现两份「乙.1」");
    ok(!!o13, "副本真的落盘了", `「乙.1」出现 ${countOf(o13 || (await outlineOf()), "乙.1")} 次`);
    const o13v = o13 || (await outlineOf());
    const i13 = idxOf(o13v, "乙.1");
    ok(i13 >= 0 && o13v[i13 + 1]?.text === "乙.1", "副本紧跟在原节点之后（不是掉到末尾）");

    /* ============================================================ 14. 待办勾选 */
    console.log("\n[14] 待办：标记为已完成 / 标记为未完成");
    const checkedOf = async (t) => {
        const f = (await outlineOf()).find((x) => x.text === t);
        return f ? f.checked : null;
    };
    await page.eval(menuOn("待办事项"));
    await sleep(400);
    const s14a = await page.eval(MENU);
    ok((s14a.items || []).some((i) => i.text.includes("标记为已完成")), "未完成节点上菜单是「标记为已完成」");
    const c14 = await page.eval(clickMenuItem("标记为已完成"));
    const done14 = await waitFor(async () => (await checkedOf("待办事项")) === true, { label: "「待办事项」变成已勾选" });
    ok(c14 === "clicked" && !!done14, "点它之后内核里真的勾上了", `clicked=${c14}`);

    await page.eval(menuOn("待办事项"));
    await sleep(400);
    const s14b = await page.eval(MENU);
    ok((s14b.items || []).some((i) => i.text.includes("标记为未完成")), "已完成节点上菜单是「标记为未完成」");
    const c14b = await page.eval(clickMenuItem("标记为未完成"));
    const undone14 = await waitFor(async () => (await checkedOf("待办事项")) === false, { label: "「待办事项」取消勾选" });
    ok(c14b === "clicked" && !!undone14, "再点一次真的取消了", `clicked=${c14b}`);

    /* ============================================================ 15. 标记浮层 */
    console.log("\n[15] 添加标记 / 编辑标记");
    const id15 = await page.eval(`(() => {
        const root = ${ROOT};
        const els = [...root.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden');
        const hit = els.find((e) => ((e.querySelector('.mm-txt') || e).textContent || '').trim() === '乙.1');
        return hit ? (hit.getAttribute('data-mm-id') || '') : '';
    })()`);
    const c15 = await pick("乙.1", "添加标记（图标 / 标签 / 颜色）", 900);
    const s15 = await page.eval(STATE);
    ok(c15 === "clicked", "点到了「添加标记」", c15);
    ok(s15.markPop, "标记浮层弹了出来");

    // ⚠️ 必须**真点浮层里的图标**，不能直接调 API 写块属性。
    //    块属性变化不触发思源的文档事务 → 不会有 DOM 回推，插件得自己
    //    `syncMarkToDom()`（见 scanner.applyMark 的注释）。绕过插件写属性，
    //    属性确实进了内核，但视图永远读不到 —— 会得到「属性在、标记不在」的假象。
    const iconHit = await page.eval(`(() => {
        const pop = ${ROOT}.querySelector('.mm-mark-pop');
        if (!pop) return 'no-pop';
        const b = [...pop.querySelectorAll('[data-icon]')].find((e) => e.dataset.icon === '⭐');
        if (!b) return 'no-icon';
        const r = b.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        b.dispatchEvent(new MouseEvent('mousedown', o));
        b.dispatchEvent(new MouseEvent('mouseup', o));
        b.click();
        return 'clicked';
    })()`);
    await sleep(1500);
    const attr15 = ((await api("/api/attr/getBlockAttrs", { id: id15 })).data || {})["custom-mindmap-mark"] || "";
    ok(iconHit === "clicked", "点到了浮层里的图标", iconHit);
    ok(attr15.includes("⭐"), "标记写进了块属性 custom-mindmap-mark", JSON.stringify(attr15));
    const s15b = await page.eval(STATE);
    ok(!!s15b.markPop, "浮层还开着（可以接着加标签 / 改颜色）");
    await page.press("Escape");
    await sleep(600);
    ok(!(await page.eval(STATE)).markPop, "Esc 关掉了浮层");

    await page.eval(menuOn("乙.1"));
    await sleep(400);
    const s15c = await page.eval(MENU);
    ok((s15c.items || []).some((i) => i.text.includes("编辑标记")), "有标记之后菜单变成「编辑标记（图标 / 标签 / 颜色）…」");
    await page.press("Escape");
    await sleep(300);

    // 顺手把标记清掉（走浮层里的「清除标记」，同样不绕过插件）
    await page.eval(menuOn("乙.1"));
    await sleep(400);
    const cleared = await page.eval(clickMenuItem("编辑标记"));
    await sleep(700);
    const clearHit = await page.eval(`(() => {
        const b = ${ROOT}.querySelector('.mm-mark-pop .mm-mark-clear');
        if (!b) return 'no-btn';
        const r = b.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        b.dispatchEvent(new MouseEvent('mousedown', o));
        b.dispatchEvent(new MouseEvent('mouseup', o));
        b.click();
        return 'clicked';
    })()`);
    await sleep(1500);
    const attr15b = ((await api("/api/attr/getBlockAttrs", { id: id15 })).data || {})["custom-mindmap-mark"];
    ok(cleared === "clicked" && clearHit === "clicked", "「编辑标记」也能再打开浮层并点到「清除标记」", `${cleared}/${clearHit}`);
    ok(!attr15b, "清除之后块属性被删掉了（不是写空串）", JSON.stringify(attr15b ?? null));
    await page.press("Escape");
    await sleep(300);

    /* ============================================================ 16. 删除节点 */
    console.log("\n[16] 删除节点（含 n 个子节点）");
    await page.eval(menuOn("甲分支"));
    await sleep(400);
    const s16a = await page.eval(MENU);
    const del16 = (s16a.items || []).find((i) => i.text.includes("删除节点"));
    ok(!!del16 && del16.text.includes("含 2 个子节点"), "带子树的节点上，菜单写明了会一起删几个", del16 ? del16.text : "(没找到)");
    const before16 = (await page.eval(STATE)).total;
    const c16 = await page.eval(clickMenuItem("删除节点"));
    const gone16 = await waitShape((o) => idxOf(o, "甲分支") < 0, "整棵「甲分支」从大纲消失");
    const md16 = await kramdown(listId);
    ok(c16 === "clicked" && !!gone16, "整棵「甲分支」子树从内核消失", `clicked=${c16}`);
    ok(!md16.includes("甲分支") && !md16.includes("甲.2"), "「甲分支」「甲.2」都没了");
    await sleep(800);
    const s16 = await page.eval(STATE);
    ok(s16.total < before16, "画布上的节点也少了", `${before16} → ${s16.total}`);

    /* ============================================================ 17. 批量条与导出 */
    console.log("\n[17] 批量条「导出这些」+ 导出菜单「只导出选中的 2 个节点」");
    await tap(await page.eval(selAt("乙.1")));
    await sleep(400);
    await tap(await page.eval(selAt("任务组")), 2);
    await sleep(900);
    const s17 = await page.eval(STATE);
    ok(s17.batch, "选中 2 个之后浮出了批量操作条");

    const bar17 = await page.eval(`(() => {
        const b = ${ROOT} && ${ROOT}.querySelector('.mm-batch');
        if (!b) return [];
        return [...b.querySelectorAll('button')].map((e) => (e.textContent || '').trim());
    })()`);
    ok(bar17.some((t) => t.includes("导出这些")), "批量条上有「导出这些」", JSON.stringify(bar17));

    // 拦下载：把产物留在页内
    await page.eval(`(() => {
        window.__dl = [];
        if (!window.__dlHooked) {
            window.__dlHooked = true;
            const orig = URL.createObjectURL.bind(URL);
            URL.createObjectURL = (b) => { window.__dl.push(b); return orig(b); };
            HTMLAnchorElement.prototype.click = function () {};
        }
        return 'ok';
    })()`);
    const exportMenu = await page.eval(`(() => {
        const b = ${ROOT} && ${ROOT}.querySelector('.mm-batch');
        if (!b) return 'no-bar';
        const it = [...b.querySelectorAll('button')].find((e) => (e.textContent || '').includes('导出这些'));
        if (!it) return 'no-btn';
        const r = it.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        it.dispatchEvent(new MouseEvent('mousedown', o));
        it.dispatchEvent(new MouseEvent('mouseup', o));
        it.click();
        return 'clicked';
    })()`);
    await sleep(3000);
    const dl17 = await page.eval(`(window.__dl || []).map((b) => ({ type: b.type, size: b.size }))`);
    ok(exportMenu === "clicked", "点到了批量条上的「导出这些」", exportMenu);
    ok((dl17 || []).some((b) => b.type === "image/png" && b.size > 2000), "「导出这些」真的产出了一个 PNG（只含选中的子树）", JSON.stringify(dl17));

    // 导出菜单（工具条）在多选时该显示「只导出选中的 2 个节点」
    const toolAt = (tip) => `(() => {
        const b = ${ROOT} && [...${ROOT}.querySelectorAll('.mm-icon')].find((e) => (e.dataset.mmTip || '').includes(${JSON.stringify(tip)}));
        if (!b) return { err: 'no button' };
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`;
    await tap(await page.eval(toolAt("导出图片")));
    await sleep(800);
    const s17b = await page.eval(MENU);
    ok(
        (s17b.items || []).some((i) => i.text.includes("只导出选中的 2 个节点")),
        "多选时导出菜单写着「只导出选中的 2 个节点」",
        JSON.stringify((s17b.items || []).map((i) => i.text).slice(0, 4)),
    );
    await page.press("Escape");
    await sleep(300);

    /* ============================================================ 收尾 */
    const errs = await page.eval("window.__mmErrors || []");
    ok(errs.length === 0, "全程没有页面级报错", errs.length ? JSON.stringify(errs.slice(0, 3)) : "");
} finally {
    await chrome.close();
    await removeDoc(api, doc);
}

console.log("");
if (fail === 0) {
    console.log(`节点右键菜单验收通过 ✓  共 ${pass} 项断言`);
} else {
    console.log(`节点右键菜单验收失败 ✗  ${fail} 项不过（通过 ${pass} 项）`);
}
process.exit(fail === 0 ? 0 : 1);
