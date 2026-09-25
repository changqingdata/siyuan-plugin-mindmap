/**
 * 设置面板「有实现、没断言」的端到端验收 —— 9 个从没被测试碰过的设置项。
 *
 * ## 为什么要开这一支
 *
 * 起因是 `scripts/coverage-audit.mjs`（把插件的**全部用户可见入口**从源码里枚举出来，
 * 逐条对照 `tests/` 的命中情况）。它报出一批零命中：
 * `compact` / `compactThreshold` / `lazyRender` / `hardLimit` / `flipAnimation` /
 * `showOrder` / `ctrlWheelZoom` / `wheelPan` / `hoverPreview` / `viewPerDoc`。
 *
 * 这个项目已经因为「有实现、没断言」连续挖出三个真 bug：
 *   · `⌥⌘D` 被导图自己的 Ctrl+D 吞掉 → 静默把选中节点的子树复制进笔记
 *   · `migrateLegacy`（唯一会写数据的命令）动作从没被真机跑过
 *   · 真实键盘下整套 Ctrl 快捷键失灵（焦点被思源编辑器抢走）
 * 三次都是「碰巧想到」才去查的。这一支把「碰巧」变成「扫一遍」。
 *
 * ## 断言的可观测信号是从探针里量出来的，不是猜的
 *
 * 每一项的信号都先在 `tests/kernel/probe-settings-effects.mjs` 里 dump 过一遍，
 * 确认「关 → 开」真的有区别，才写成断言。顺序不能反 ——
 * 先写断言再找信号，很容易写成永远绿的装饰。
 *
 * | 设置项 | 可观测信号 | 关 → 开 |
 * |---|---|---|
 * | `showOrder` | `.mm-badge` 个数与文案 | 0 个 → 4 个（`1.1` / `1.1.1` / `1.2` / `1.3`） |
 * | `compact` | 相邻节点纵向间距 | 53 → 45（`compactThreshold=1` 同效） |
 * | `hardLimit` | `.mm-notice` + 「仍然渲染」按钮 | 0 个 → 1 个；点后节点 0 → 4 |
 * | `hoverPreview` | `.mm-preview` 卡片 | 0 个 → 1 个（「折叠了 3 个子节点…」） |
 * | `ctrlWheelZoom` | `scale` | 147 → 147（关）／147 → 165（开） |
 * | `wheelPan` | `.mm-world` 的 translateY | 0 → −163.385px |
 * | `flipAnimation` | `.mm-collapsing` 峰值 | 0 → 6（计数器 `detach=[3]` `collapse=[3]`） |
 * | `viewPerDoc` | 块属性 `custom-mindmap-view` | `undefined` → `"scale=1.2500"` |
 * | `lazyRender` | `data-mm-lazy="1"` + 无 `.mm-root` | 见 G 段 |
 * | `edge`（连线样式） | `.mm-edges path` 的条数与 `d` 命令 | 直线 n 条 / 折线 2+n 条 / 曲线含 `Q` |
 *
 * ## 审计跑出来的是**两个**真缺口，不是一个
 *
 * 第一次审计只报了 9 个设置项。补完这 9 项之后再跑一遍，零命中从 18 条降到 7 条，
 * 剩下的 7 条里有 5 条是「把整句中文当探针」的已知噪音、1 条是命令/菜单的已覆盖项，
 * 还有 1 条是真的：**`edge` 连线样式**。
 *
 * `tests/` 里有 4 支脚本会去数 `.mm-edges path`，但**没有一支**验过
 * 「三种连线样式产出的是三种不同的线」—— 也就是说，
 * `EDGE_OPTIONS`（曲线 / 直角折线 / 直线）如果哪天接错了线，测试全绿。
 * 这就是静态审计的价值：它不看「有没有碰过这个模块」，只看「有没有碰过这个**入口**」。
 *
 * ## 「能红」是怎么保证的
 *
 * 绝大多数断言**自带反例**：同一个 run 里先量「关」再量「开」，
 * 两次数值不同才算过。功能要是坏的，「开」就会长得跟「关」一样 → 断言自己就红了。
 * 这比「改源码 → 重打包 → 确认变红 → 改回来」更省事，而且**反例是常驻的**。
 *
 * 唯一没有自带反例的是 `hardLimit`（上限判定只在**首次挂载**时走，一个列表只能验一次），
 * 所以它靠「点『仍然渲染』之后 `.mm-notice` 消失 + 节点出现」来证明那个提示
 * 真的在拦渲染，而不是一个装饰性的 div。
 *
 * ## 三个操作上的坑（都写在这里，省得下次再踩）
 *
 * 1. **靠鼠标点珠子来折叠不可靠**：这条链路前面滚过页面 / 悬停过之后，
 *    点击坐标会落空，而落空是**静默**的（只是「没折成」，不报错）。
 *    所以 E / D 两段都用程序化 `view.toggleFold(n)`，只有 D 段最后那次
 *    **悬停**才是真鼠标事件（那正是要验的东西）。
 * 2. **`setCfg` 会连带 `render(true)`**（`refreshAll → setOptions → render(true)`），
 *    `autoFit` 打开时重新取景会改缩放 → 节点坐标变。所以每次悬停 / 滚轮之前
 *    都要**重新取**坐标，不能用上一段存下来的。
 * 3. **`hardLimit` 有第二层拦截**：`lazyRender` 默认 true，`scan()` 里有
 *    `if (opts.lazyRender && !this.visible.has(id)) { observeLazy(list); continue; }`。
 *    视口外的列表**根本走不到 `mount()`**，上限判定一次都不会执行。
 *    所以 G 段（lazyRender）排在 H 段（hardLimit）前面，结束时把 `lazyRender`
 *    留在 false 上，H 段正好接着用。
 * 4. **markdown fixture 里两个列表之间必须夹一个段落**：Lute 会把「中间只隔空行」的
 *    两个列表合并成同一个列表块（实测：`- 懒甲/乙/丙` + `- 上限甲/乙/丙`
 *    变成了 1 个 6 项列表）。合并之后 `kids()` 只数得出 3 个列表，
 *    而报错是「预期四个顶层列表，实际 3 个」—— 看着像建文档失败，其实是 markdown 语义。
 *
 * 用法：node tests/kernel/diag-settings.mjs
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
 * 四个列表：
 *   listO —— **有序**列表（`showOrder` 只对有序列表生效，没它这项测不出来）
 *   listU —— 普通列表，节点多一些，用来量间距 / 折叠出预览 / 写视图偏好
 *   listL —— **先不打标记**，专供 `hardLimit`（上限判定只在首次挂载时走）
 *   listZ —— **先不打标记**，专供 `lazyRender`（要一个「从没进过视口」的列表）
 *
 * listL / listZ 前面塞了 10 段长文本当填充 —— 要的就是把它们**推到视口外面**，
 * 不然 IntersectionObserver 一上来就把它们标成「可见」，懒渲染无从测起。
 * 用「少而长」的段落而不是「多而短」，是因为 Protyle 对文档块也是懒渲染的：
 * 段落太多的话，列表元素可能压根没进 DOM。
 */
const FILLER = [
    "填充段落一：把下面的列表推到视口外面，这样才能测懒渲染。这一段故意写得长一些，让它换行、占掉更多高度；段落里的字要够多，不然一行就放完了，撑不开高度。",
    "填充段落二：Protyle 自己也会懒渲染文档块，所以填充要用「少而长」而不是「多而短」——块太少的话列表元素可能压根没进 DOM，那懒渲染就无从测起，断言会变成「测空气」。",
    "填充段落三：继续占高度。这一段也写长一点，保持每段三行左右的高度，累积起来才能把下面两个列表稳稳推出视口。",
    "填充段落四：继续占高度。视口高度 1050，上面已经有有序列表、普通列表和标题栏了，再叠上十几段三行文本，下面的列表一定在视口之外。",
    "填充段落五：再补一段。这里刻意不用「短段落 × 很多个」，因为块数量一多，Protyle 就会开始虚拟滚动，反而把列表元素从 DOM 里摘掉。",
    "填充段落六：再补一段，保持同样的长度，让整段填充的高度可预期。",
    "填充段落七：再补一段，保持同样的长度，让整段填充的高度可预期。",
    "填充段落八：再补一段，保持同样的长度，让整段填充的高度可预期。",
    "填充段落九：再补一段，保持同样的长度，让整段填充的高度可预期。",
    "填充段落十：再补一段，保持同样的长度，让整段填充的高度可预期。",
    "填充段落十一：再补一段，保持同样的长度，让整段填充的高度可预期。",
    "填充段落十二：到这里，下面的两个列表肯定落在视口外面了。",
];
const md = [
    "1. 有序甲",
    "   1. 有序甲子",
    "2. 有序乙",
    "3. 有序丙",
    "",
    "分开一段",
    "",
    "- 普通根",
    "  - 子一",
    "    - 孙一",
    "    - 孙二",
    "  - 子二",
    "  - 子三",
    "",
    ...FILLER.flatMap((t) => [t, ""]),
    "- 懒甲",
    "- 懒乙",
    "- 懒丙",
    "",
    // ★ 两个列表之间**必须**夹一个段落：Lute 会把「中间只隔空行」的两个列表
    //   合并成同一个列表块（实测：懒甲…丙 + 上限甲…丙 变成 1 个 6 项列表）。
    //   合并之后 `kids()` 只数得出 3 个列表，而报错信息会是「预期四个」，
    //   看起来像建文档失败，其实是 markdown 语义问题。
    "隔开一段",
    "",
    "- 上限甲",
    "- 上限乙",
    "- 上限丙",
    "",
].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-设置项断言-${Date.now()}`, markdown: md });
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;

const lists = (await kids(docId)).filter((k) => k.type === "l");
const [listO, listU, listZ, listL] = lists;
if (!listO || !listU || !listZ || !listL) throw new Error(`预期四个顶层列表，实际 ${lists.length} 个`);

await api("/api/attr/setBlockAttrs", { id: listO.id, attrs: { "custom-mindmap": "logic" } });
await api("/api/attr/setBlockAttrs", { id: listU.id, attrs: { "custom-mindmap": "logic" } });

console.log(`临时文档 ${docId}`);
console.log(`有序 ${listO.id} ｜普通 ${listU.id} ｜懒 ${listZ.id}（不打标记）｜上限 ${listL.id}（不打标记）\n`);

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

const MM_PLUGIN = `((window.siyuan && window.siyuan.ws && window.siyuan.ws.app && window.siyuan.ws.app.plugins) || []).find((p) => p.name === 'siyuan-plugin-mindmap')`;
const R_O = `.protyle-wysiwyg .list[data-node-id="${listO.id}"]`;
const R_U = `.protyle-wysiwyg .list[data-node-id="${listU.id}"]`;
const R_Z = `.protyle-wysiwyg .list[data-node-id="${listZ.id}"]`;
const R_L = `.protyle-wysiwyg .list[data-node-id="${listL.id}"]`;

const chrome = await launch({ headless: true, port: 9388, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2800);
    await page.waitFor(`document.querySelectorAll(${JSON.stringify(R_U)} + ' .mm-node').length > 0`, { timeout: 30000, label: "导图挂载" });
    await sleep(800);

    /* ------------------------------------------------------------ 脚手架 */

    const setCfg = (patch, refresh = true) =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            if (!p) return 'no-plugin';
            Object.assign(p.config, ${JSON.stringify(patch)});
            if (${refresh}) p.scanner && p.scanner.refreshAll();
            return 'ok';
        })()`);
    const scanAll = () => page.eval(`(() => { const p = ${MM_PLUGIN}; if (p && p.scanner) p.scanner.scanAll(); return 'ok'; })()`);
    const count = (sel) => page.eval(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
    const texts = (sel) => page.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => (e.textContent || '').trim())`);
    const viewOf = (listId) =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p && p.scanner && p.scanner.views && p.scanner.views.get(${JSON.stringify(listId)});
            return v ? 'ok' : 'no-view';
        })()`);
    /** 视图诊断行（`viewSummaries()` 只有 `where`，没有 `id` —— 要按 where 匹配） */
    const infoOf = (listId) =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const vs = (p && p.scanner && p.scanner.viewSummaries()) || [];
            const v = vs.find((x) => String(x.where).includes(${JSON.stringify(listId)}));
            return v ? v.info : null;
        })()`);
    /** 节点矩形（按纵向 top 排序，便于量间距） */
    const rects = (rootSel, n = 8) =>
        page.eval(`[...document.querySelectorAll(${JSON.stringify(rootSel)} + ' .mm-node')].slice(0, ${n}).map((e) => {
            const r = e.getBoundingClientRect();
            return { t: Math.round(r.top), l: Math.round(r.left), txt: (e.textContent || '').trim().slice(0, 8) };
        })`);
    const gaps = (rs) => rs.slice(1).map((r, i) => r.t - rs[i].t);
    /** 程序化折叠「第一个还有子节点、且还没折」的节点。返回折叠了谁 */
    const foldFirst = (listId) =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p.scanner.views && p.scanner.views.get(${JSON.stringify(listId)});
            if (!v || !v.tree) return 'no-view';
            let found = null;
            const w = (x) => { if (!found && x.children.length > 0 && !x.folded) found = x; x.children.forEach(w); };
            w(v.tree);
            if (!found) return 'no-node';
            const t = (found.text || '').slice(0, 6);
            v.toggleFold(found);
            return t;
        })()`);
    const unfoldAll = (listId) =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p.scanner.views && p.scanner.views.get(${JSON.stringify(listId)});
            if (!v || !v.tree) return 'no-view';
            const list = [];
            const w = (x) => { if (x.children.length > 0 && x.folded) list.push(x); x.children.forEach(w); };
            w(v.tree);
            for (const n of list) v.toggleFold(n);
            return list.length;
        })()`);
    /** 给 view 的收拢动画两个私有方法包计数器（TS 的 private 只是编译期约束） */
    const installFlipHooks = (listId) =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p.scanner.views && p.scanner.views.get(${JSON.stringify(listId)});
            if (!v) return 'no-view';
            window.__flip = { detach: [], collapse: [] };
            const od = v.detachVanishing.bind(v);
            v.detachVanishing = (a, b) => { const out = od(a, b); window.__flip.detach.push(out.length); return out; };
            const oc = v.runCollapse.bind(v);
            v.runCollapse = (items) => { window.__flip.collapse.push(items.length); return oc(items); };
            return 'ok';
        })()`);
    /** 折叠一次，并在 480ms 内以 16ms 粒度抓 `.mm-collapsing` 的峰值 */
    const foldAndPeak = async (listId) => {
        const who = await foldFirst(listId);
        if (who === 'no-view' || who === 'no-node') return { err: who, peak: 0 };
        let peak = 0;
        for (let i = 0; i < 30; i++) {
            const n = await count(".mm-collapsing");
            if (n > peak) peak = n;
            await sleep(16);
        }
        return { ok: true, who, peak };
    };
    const flipStats = () => page.eval(`JSON.stringify(window.__flip || null)`);
    /** 画布中心点（每次重新取 —— setCfg 会连带 render(true)，缩放可能变） */
    const canvasCenter = (rootSel) =>
        page.eval(`(() => {
            const root = document.querySelector(${JSON.stringify(rootSel)});
            if (!root) return null;
            // ⚠️ 两个坑，踩过：
            //   ① 不能取 .mm-root 的矩形中心 —— 它含工具栏 + 面包屑，中心可能落到
            //      .mm-viewport 之外，滚轮就打不到导图上（实测落点 fn__flex-1）。
            //   ② 必须先把它滚进可视区 —— 导图高 700~900px 而 innerHeight 只有 ~955，
            //      root 中心会落到窗口底边（实测 y=948 / innerH=955），那里
            //      elementFromPoint 返回的是底层容器，坐标点击静默失效。
            //      （ux-v2.mjs 的 nodeCenter 里也是这么做的，见那里的长注释。）
            //   ③ 本段在 page.eval 的模板字符串里，注释里**不能出现反引号** ——
            //      会把外层模板提前截断，报 missing ) after argument list。
            root.scrollIntoView({ block: 'center' });
            const vp = root.querySelector('.mm-viewport') || root;
            const r = vp.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
    const worldTransform = (rootSel) =>
        page.eval(`(() => { const w = document.querySelector(${JSON.stringify(rootSel)} + ' .mm-world'); return w ? w.style.transform : null; })()`);
    const scaleOf = async (listId) => (await infoOf(listId))?.scale ?? null;
    /** 折叠珠子（`.mm-toggle--collapsed`）的中心点 */
    const beadPoint = (rootSel) =>
        page.eval(`(() => {
            const root = document.querySelector(${JSON.stringify(rootSel)});
            const t = root && root.querySelector('.mm-toggle--collapsed');
            if (!t) return { err: 'no collapsed toggle' };
            const r = t.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);

    console.log(`挂载：有序图 ${await count(`${R_O} .mm-node`)} 节点 ｜普通图 ${await count(`${R_U} .mm-node`)} 节点\n`);

    /* ============================================================ A showOrder */
    console.log("【A showOrder 显示层级编号】");
    await setCfg({ showOrder: false });
    await sleep(700);
    const badgeOff = await count(`${R_O} .mm-badge`);
    await setCfg({ showOrder: true });
    await sleep(700);
    const badgeOn = await count(`${R_O} .mm-badge`);
    const badgeText = await texts(`${R_O} .mm-badge`);
    ok(badgeOff === 0, "关：有序列表上没有层级编号", `${badgeOff} 个`);
    ok(badgeOn > 0, "开：层级编号出现", `${badgeOff} → ${badgeOn} 个`);
    ok(badgeText.includes("1.1.1"), "编号是真实层级号（含三级 1.1.1）", JSON.stringify(badgeText));
    // 参照组：`showOrder` 的判据是 `n.numbered && n.depth > 0`，普通列表的 numbered 为假
    // —— 上面那条「开」如果只是无条件给所有节点加编号，这一条就会红。
    ok((await count(`${R_U} .mm-badge`)) === 0, "参照：普通列表不受影响（编号只加在有序列表上）", `普通图 ${await count(`${R_U} .mm-badge`)} 个`);

    /* ============================================================ B compact */
    console.log("\n【B compact / compactThreshold 节点间距】");
    await setCfg({ compact: false, compactThreshold: 9999 });
    await sleep(900);
    const wide = await rects(R_U);
    const gapWide = Math.max(...gaps(wide));
    await setCfg({ compact: true });
    await sleep(900);
    const tight = await rects(R_U);
    const gapTight = Math.max(...gaps(tight));
    await setCfg({ compact: false, compactThreshold: 1 });
    await sleep(900);
    const auto = await rects(R_U);
    const gapAuto = Math.max(...gaps(auto));
    ok(gapTight < gapWide, "开 compact 后相邻节点纵向间距收紧", `最大间距 ${gapWide} → ${gapTight}`);
    ok(gapAuto === gapTight, "compactThreshold=1 与 compact:true 等效（节点数超过阈值就自动收紧）", `${gapAuto} vs ${gapTight}`);
    await setCfg({ compact: false, compactThreshold: 5000 });
    await sleep(700);

    /* ============================================================ C 滚轮 */
    console.log("\n【C ctrlWheelZoom / wheelPan 滚轮行为】");
    const wheelAt = async (rootSel, modifiers, dy) => {
        const c = await canvasCenter(rootSel);
        if (!c) return { ok: false, hit: "拿不到画布中心" };
        await page.mouse("mouseMoved", c.x, c.y, { buttons: 0 });
        await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: c.x, y: c.y, deltaX: 0, deltaY: dy, modifiers, button: "none", buttons: 0 });
        await sleep(700);
        // ⚠️ 诊断：这个坐标底下到底是什么元素？
        // 落点不在画布上（被对话框盖住 / 落到可视区外）时，滚轮根本到不了导图 ——
        // 那时断言只会说「scale 没变」，看不出是没滚到、还是滚了没反应。
        // `ux-v2.mjs` 的 `nodeCenter` 里有 `scrollIntoView` 就是为这个（见那里的长注释）。
        const d = await page.eval(`(() => {
            const el = document.elementFromPoint(${c.x}, ${c.y});
            return {
                hit: el ? String(el.className || el.tagName).slice(0, 44) : 'null',
                x: ${c.x}, y: ${c.y},
                innerH: innerHeight, scrollY: Math.round(scrollY),
            };
        })()`);
        return { ok: true, ...d };
    };
    await setCfg({ ctrlWheelZoom: true, wheelPan: false });
    await sleep(800);
    const s0 = await scaleOf(listU.id);
    const wA = await wheelAt(R_U, 2, -240); // modifiers 位 2 = Ctrl
    const s1 = await scaleOf(listU.id);
    ok(s1 > s0, "ctrlWheelZoom=开：Ctrl+滚轮↑ 放大",
        `scale ${s0} → ${s1}｜落点 ${wA.hit} @(${wA.x},${wA.y}) innerH=${wA.innerH} scrollY=${wA.scrollY}`);

    await setCfg({ ctrlWheelZoom: false, wheelPan: false });
    await sleep(800);
    const s2 = await scaleOf(listU.id);
    await wheelAt(R_U, 2, -240);
    const s3 = await scaleOf(listU.id);
    ok(s3 === s2, "ctrlWheelZoom=关：同一个手势不再改缩放", `scale ${s2} → ${s3}`);

    await setCfg({ ctrlWheelZoom: false, wheelPan: true });
    await sleep(800);
    const w0 = await worldTransform(R_U);
    const wB = await wheelAt(R_U, 0, 240);
    const w1 = await worldTransform(R_U);
    ok(w0 !== w1, "wheelPan=开：普通滚轮平移画布",
        `${w0} → ${w1}｜落点 ${wB.hit} @(${wB.x},${wB.y}) innerH=${wB.innerH} scrollY=${wB.scrollY}`);
    await setCfg({ ctrlWheelZoom: true, wheelPan: false });
    await sleep(700);

    /* ============================================================ E 布局动效
       排在 D 前面：E 只用程序化折叠，不碰鼠标；D 要悬停，放在后面互不干扰。 */
    console.log("\n【E flipAnimation 布局动效】");
    const reduced = await page.eval(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`);
    ok(!reduced, "（环境）prefers-reduced-motion 不是 reduce —— 否则 runCollapse 会被短路，这一项测不了", `reduce=${reduced}`);
    if (reduced) {
        await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
        await sleep(200);
    }
    await unfoldAll(listU.id);
    await sleep(1500);
    await setCfg({ flipAnimation: false });
    await sleep(800);
    await installFlipHooks(listU.id);
    const fOff = await foldAndPeak(listU.id);
    const statsOff = await flipStats();
    await sleep(1200);
    await unfoldAll(listU.id);
    await sleep(1600);
    await setCfg({ flipAnimation: true });
    await sleep(800);
    await installFlipHooks(listU.id);
    const fOn = await foldAndPeak(listU.id);
    const statsOn = await flipStats();
    ok(fOff.peak === 0, "关：折叠时没有收拢动画元素（.mm-collapsing 峰值 0）", `峰值 ${fOff.peak}｜计数器 ${statsOff}`);
    ok(JSON.parse(statsOff).detach.length === 0, "关：detachVanishing 一次都没被调 —— 消失的节点是「啪一下没了」", statsOff);
    ok(fOn.peak > 0, "开：收拢动画真的跑了（.mm-collapsing 峰值 > 0）", `峰值 ${fOn.peak}`);
    ok(JSON.parse(statsOn).detach.some((n) => n > 0), "开：detachVanishing 确实摘出了要消失的节点", `计数器 ${statsOn}`);
    await sleep(1400);
    await unfoldAll(listU.id);
    await sleep(1500);

    /* ============================================================ D 悬停预览 */
    console.log("\n【D hoverPreview 悬停预览折叠节点】");
    await setCfg({ hoverPreview: true });
    await sleep(800);
    const foldedWho = await foldFirst(listU.id);
    await sleep(1200);
    const beadOn = await beadPoint(R_U);
    ok(!beadOn.err, "（前置）折叠后珠子变成「已折叠」态（.mm-toggle--collapsed）", `折叠了 ${foldedWho}`);
    let previewText = [];
    if (!beadOn.err) {
        await page.mouse("mouseMoved", 4, 4, { buttons: 0 });
        await sleep(150);
        await page.mouse("mouseMoved", beadOn.x, beadOn.y, { buttons: 0 });
        await sleep(1400); // PREVIEW_DELAY = 600ms
        previewText = await texts(".mm-preview");
    }
    ok(previewText.length === 1 && /折叠了\s*\d+\s*个子节点/.test(previewText[0] ?? ""), "开：悬停折叠珠子浮出预览卡片，文案是「折叠了 N 个子节点…」", JSON.stringify(previewText));

    await setCfg({ hoverPreview: false });
    await sleep(900);
    const beadOff = await beadPoint(R_U);
    let previewOff = [];
    if (!beadOff.err) {
        await page.mouse("mouseMoved", 4, 4, { buttons: 0 });
        await sleep(300);
        await page.mouse("mouseMoved", beadOff.x, beadOff.y, { buttons: 0 });
        await sleep(1400);
        previewOff = await texts(".mm-preview");
    }
    ok(previewOff.length === 0, "关：同样悬停同样时长，不再有卡片", `${previewOff.length} 个`);
    await unfoldAll(listU.id);
    await sleep(1400);

    /* ============================================================ F viewPerDoc */
    console.log("\n【F viewPerDoc 视图偏好跟文档走】");
    const markScale = (listId) =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p.scanner.views && p.scanner.views.get(${JSON.stringify(listId)});
            if (!v) return 'no-view';
            v.markPref('scale', 1.25);   /* 等价于工具条缩放菜单里点「记住这个缩放」 */
            return 'ok';
        })()`);
    await setCfg({ viewPerDoc: false });
    await sleep(800);
    const mOff = await markScale(listU.id);
    await sleep(1500);
    const attrOff = (await attrsOf(listU.id))["custom-mindmap-view"];
    ok(mOff === 'ok' && attrOff === undefined, "关：markPref 照常记账，但**不写**块属性 custom-mindmap-view", `markPref=${mOff}｜属性=${JSON.stringify(attrOff)}`);
    await setCfg({ viewPerDoc: true });
    await sleep(800);
    const mOn = await markScale(listU.id);
    await sleep(1700);
    const attrOn = (await attrsOf(listU.id))["custom-mindmap-view"];
    ok(mOn === 'ok' && /scale=1\.25/.test(attrOn ?? ""), "开：偏好写进块属性（换设备 / 复制块都跟着走）", `属性=${JSON.stringify(attrOn)}`);

    /* ============================================================ G lazyRender
       排在 H 前面，结束时把 lazyRender 留在 false 上，H 段正好接着用。 */
    console.log("\n【G lazyRender 懒渲染】");
    await setCfg({ lazyRender: true });
    await sleep(500);
    await api("/api/attr/setBlockAttrs", { id: listZ.id, attrs: { "custom-mindmap": "logic" } });
    await sleep(1600);
    await scanAll();
    await sleep(1200);
    const zInDom = await count(R_Z);
    const zLazy = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(R_Z)}); return el ? el.getAttribute('data-mm-lazy') : null; })()`);
    const zRoot = await count(`${R_Z} .mm-root`);
    ok(zInDom === 1, "（前置）视口外的列表元素确实在 DOM 里 —— 否则下面那条测的是空气", `元素 ${zInDom} 个`);
    ok(zLazy === "1" && zRoot === 0, "开：没进过视口的列表被打了懒渲染标记、且没有挂导图", `data-mm-lazy=${zLazy}｜.mm-root ${zRoot} 个`);

    await setCfg({ lazyRender: false }, false);
    await scanAll();
    await sleep(2200);
    const zRoot2 = await count(`${R_Z} .mm-root`);
    ok(zRoot2 === 1, "关：同一次扫描里立刻挂上（懒渲染真的在拦挂载，不是别的原因）", `.mm-root ${zRoot} → ${zRoot2}`);

    /* ============================================================ H hardLimit */
    console.log("\n【H hardLimit 渲染上限（安全阀）】");
    await setCfg({ hardLimit: 2 }, false); // lazyRender 仍是 false（G 段留下的）
    await sleep(300);
    await api("/api/attr/setBlockAttrs", { id: listL.id, attrs: { "custom-mindmap": "logic" } });
    await sleep(1500);
    await scanAll();
    await sleep(1800);
    const lRoot = await count(`${R_L} .mm-root`);
    const notice = await texts(".mm-notice");
    ok(lRoot === 0 && notice.length === 1, "上限 2 遇到 3 个节点的列表：不渲染，改为提示", `.mm-root ${lRoot} 个｜提示 ${notice.length} 条`);
    ok(/超过渲染上限\s*2/.test(notice[0] ?? ""), "提示文案带真实数字（节点数 / 上限）", JSON.stringify(notice[0] ?? ""));
    const clicked = await page.eval(`(() => {
        const b = [...document.querySelectorAll('.mm-notice button')].find((x) => (x.textContent || '').includes('仍然渲染'));
        if (!b) return 'no-button';
        b.click();
        return 'clicked';
    })()`);
    await sleep(2000);
    const lRoot2 = await count(`${R_L} .mm-root .mm-node`);
    const notice2 = await count(".mm-notice");
    ok(clicked === 'clicked' && lRoot2 > 0 && notice2 === 0, "点「仍然渲染」：提示消失、导图真的挂上（证明那个提示在拦渲染，不是装饰）", `节点 0 → ${lRoot2}｜提示 ${notice2} 条`);
    await setCfg({ hardLimit: 5000, lazyRender: true }, false);
    await sleep(500);

    /* ============================================================ J 连线样式
       这一项是跑 `coverage-audit.mjs` 才发现的**第二个真缺口**：
       `tests/` 里有 4 支脚本会去数 `.mm-edges path`，但**没有一支**验过
       「三种连线样式产出的是三种不同的线」—— 也就是说，
       `EDGE_OPTIONS`（曲线 / 直角折线 / 直线）如果哪天接错了线，测试全绿。

       判据来自 `src/core/edge.ts` 的实现：
         · `straight` —— 每个子节点一条 `M… L…`，**没有主干 / 脊**，也**没有 Q**
         · `elbow`    —— 主干 + 脊 + 逐子节点短线，全是直角，**没有 Q**，条数比直线多
         · `curve`    —— 非同一水平线的那些子节点走 `Q` 圆角汇聚
       三条互不相同，任何一条接线接错都会红。 */
    console.log("\n【J 连线样式 edge】");
    const edgeShape = () =>
        page.eval(`(() => {
            const ps = [...document.querySelectorAll(${JSON.stringify(R_U)} + ' .mm-edges path')];
            return { n: ps.length, d: ps.map((p) => p.getAttribute('d') || '') };
        })()`);
    await setCfg({ edge: "straight" });
    await sleep(800);
    const eS = await edgeShape();
    await setCfg({ edge: "elbow" });
    await sleep(800);
    const eE = await edgeShape();
    await setCfg({ edge: "curve" });
    await sleep(800);
    const eC = await edgeShape();
    ok(eS.n > 0 && eE.n > 0 && eC.n > 0, "（前置）三种样式都画出了连线", `直线 ${eS.n} · 折线 ${eE.n} · 曲线 ${eC.n} 条`);
    ok(!eS.d.some((d) => /[QC]/.test(d)), "直线：每条路径只有 M/L，没有任何曲线命令", `样例 ${eS.d[0] ?? "(无)"}`);
    ok(eE.n > eS.n, "直角折线：多了主干 + 脊，路径条数比直线多", `${eS.n} → ${eE.n} 条`);
    ok(!eE.d.some((d) => /[QC]/.test(d)), "直角折线：全直角，没有曲线命令", `样例 ${eE.d[0] ?? "(无)"}`);
    ok(eC.d.some((d) => /Q/.test(d)), "曲线：真的出现了圆角汇聚（Q 命令）", `含 Q 的 ${eC.d.filter((d) => /Q/.test(d)).length}/${eC.n} 条`);
    ok(new Set([eS.d.join(), eE.d.join(), eC.d.join()]).size === 3, "三种样式产出三种互不相同的路径 —— 不是「选项写了但没接线」");
    await setCfg({ edge: "curve" });
    await sleep(600);

    /* ============================================================ I 设置面板 */
    console.log("\n【I 设置面板】");
    await page.eval(`(() => {
        if (document.querySelector('.b3-menu')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const el = document.querySelector('.toolbar [id^="plugin_siyuan-plugin-mindmap"]');
        if (el) el.click();
        return !!el;
    })()`);
    await sleep(900);
    await page.eval(`(() => {
        const it = [...document.querySelectorAll('.b3-menu .b3-menu__item')].find((x) => (x.textContent || '').trim() === '设置');
        if (!it) return false;
        const r = it.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        it.dispatchEvent(new MouseEvent('mousedown', o));
        it.dispatchEvent(new MouseEvent('mouseup', o));
        it.click();
        return true;
    })()`);
    await sleep(1800);
    // ⚠️ 面板现在是**侧边分区**的（5 个 tab，见 `core/settings-tabs.ts`）。
    // 这里照旧用 `.config-name` 数条目：分区只是把行**搬**进不同的 pane，
    // 非当前分区的行仍然在 DOM 里（只是 `display: none`），`textContent` 照样读得到。
    // 「有没有被搬丢」是 `diag-settings-tabs.mjs` 的专项断言，不在这一支重复。
    const titles = await texts(".b3-dialog--open .config-name");
    const WANT = ["显示层级编号", "紧凑模式", "Ctrl + 滚轮缩放", "滚轮平移导图", "懒渲染", "布局动效", "视图偏好跟文档走", "悬停预览折叠节点", "渲染上限", "紧凑模式阈值", "画布高度"];
    const missing = WANT.filter((w) => !titles.some((t) => t.includes(w)));
    ok(titles.length >= 28, "设置面板条目数（≥28）", `${titles.length} 项`);
    ok(missing.length === 0, "本文件验的每一项都能在设置面板上找到（设置项与代码没脱节）", missing.length ? `缺：${missing.join(" / ")}` : `${WANT.length}/${WANT.length} 命中`);
    // 「画布高度」有**两行**（策略下拉 + 像素数字框），而两个标题互为子串 ——
    // 上面那条用 `includes` 查，任何一行都能替另一行冒充。所以这两条按**精确相等**查。
    ok(titles.includes("画布高度"), "面板上有「画布高度」策略下拉（精确标题，不让数字框冒充）");
    ok(titles.includes("画布高度（px）"), "面板上有「画布高度（px）」数字框（精确标题）");
    // 「查看快捷键」在 1.0.x 期间从**通知**改成了**分组表格对话框**（老实现是
    // `showMessage` 弹一条 12 秒后自己消失的通知，四十多个键位挤在 12 条长句里）。
    // 所以这里不再读 `.b3-snackbar__content`，而是读 `.mm-sc` 那个对话框。
    // 面板现在有侧边分区，「查看快捷键」在「帮助」里 —— 先切过去（顺便走一遍真实路径）。
    await page.eval(`(() => {
        const t = [...document.querySelectorAll('.b3-dialog--open .mm-set__tab')].find((x) => (x.textContent || '').trim() === '帮助');
        if (t) t.click();
        return true;
    })()`);
    await sleep(300);
    const helpBtn = await page.eval(`(() => {
        const row = [...document.querySelectorAll('.b3-dialog--open .config-name')].find((e) => (e.textContent || '').includes('查看快捷键'));
        if (!row) return 'no-row';
        const item = row.closest('.config-item') || row.closest('.b3-label') || row.parentElement;
        const b = item && item.querySelector('button');
        if (!b) return 'no-button';
        b.click();
        return 'clicked';
    })()`);
    await sleep(1100);
    const scGroups = (await texts(".b3-dialog--open .mm-sc__head")).join(" / ");
    const scRows = await texts(".b3-dialog--open .mm-sc__row");
    const scSnackbars = await page.eval(`document.querySelectorAll('.b3-snackbar').length`);
    ok(helpBtn === 'clicked', "「查看快捷键」的按钮点得动", helpBtn);
    ok(
        scRows.length > 0 && /导航/.test(scGroups) && /编辑/.test(scGroups) && /剪贴/.test(scGroups),
        "「查看快捷键」弹出**分组表格**，覆盖 导航 / 编辑 / 剪贴 等分组",
        `${scRows.length} 行｜${scGroups.slice(0, 40)}…`,
    );
    ok(scSnackbars === 0, "★ 不再是会自己消失的通知（老实现是 showMessage + 12 秒）", `snackbar ${scSnackbars} 个`);

    // ★ 键位写法必须与**平台**一致，且空格必须**看得见**。
    //
    // 两件事叠在这里，都是只有真机能验的：
    //  ① 思源的键位表示法是 macOS 字形（`⇧⌘D`），而思源自己的菜单在 Windows 上
    //     显示的是 `Ctrl+...`（实测：主菜单里「魔法排版」显示 `Ctrl+Alt+P`，
    //     其 keymap 存值正是 `⌥⌘P`）。说明文字若写死字形，Windows 用户看到的就是
    //     一套在自己「设置 → 快捷键」里根本找不到的符号。
    //  ② 空格在思源的键位串里是**一个字面空格**（`KEYCODELIST[32] = " "`）。
    //     不换算就渲染成看不见的 `Ctrl+ `，用户完全读不出该按什么。
    //
    // ⚠️ 默认键位换过三轮：`⌥⌘D` → `⌘空格`/`⌥空格`（死在 OS/IME）→ `⇧⌘D`/`⇧⌘S`
    // （`⇧⌘S` 死在 Protyle 的 stopPropagation）→ **`⇧⌘D`/`⇧⌘B`**
    // （中间那版被 Windows / 输入法层吃掉，结论见 `probe-keymap-dump.mjs` 文件头）。
    // 换键位后**第 ② 条断言不能跟着删** —— 速查里仍有走 `{space}` 占位符的行
    // （折叠 / 展开、演示推进）。所以现在把它钉在**含「空格」二字的那些行**上，
    // 而不是钉在全局那两行（那会变成真空断言）。
    //
    // 断言范围要**收窄**：第一版写成对整段弹层扫 `/[⌥⌘]/`，
    // 结果被「聚焦：Ctrl / ⌘ + 双击节点」这行判红 —— 那是**故意的跨平台写法**
    // （两种都给出），本身没问题。所以只禁 `⌥`：
    // `⌘` 在「Ctrl / ⌘」这类跨平台写法里是合法的，`⌥` 则没有任何合法用途。
    const isMac = await page.eval(`!!(window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.os === 'darwin')`);
    const scPairs = await page.eval(`[...document.querySelectorAll('.b3-dialog--open .mm-sc__row')].map((r) => ({
        k: ((r.querySelector('.mm-sc__key') || {}).textContent || '').trim(),
        d: ((r.querySelector('.mm-sc__what') || {}).textContent || '').trim(),
    }))`);
    const toggleRow = scPairs.find((r) => /把光标所在的列表切换为导图/.test(r.d)) || { k: "", d: "" };
    const sideRow = scPairs.find((r) => /并排面板打开导图/.test(r.d)) || { k: "", d: "" };
    ok(
        isMac ? toggleRow.k === "⇧⌘D" && sideRow.k === "⇧⌘B" : toggleRow.k === "Ctrl+Shift+D" && sideRow.k === "Ctrl+Shift+B",
        "★ 全局键位按平台换算（Windows：Ctrl+Shift+D / Ctrl+Shift+B；macOS：⇧⌘D / ⇧⌘B）",
        `os=${isMac ? "darwin" : "win/linux"}｜${JSON.stringify(toggleRow.k)} / ${JSON.stringify(sideRow.k)}`,
    );
    const spaceRows = scPairs.filter((r) => /空格/.test(r.k));
    ok(spaceRows.length >= 2, "★ 速查里仍有走 `{space}` 占位符的行（折叠 / 演示推进）", spaceRows.map((r) => r.k).join(" / "));
    const badSpace = spaceRows.filter((r) => /\s$/.test(r.k));
    ok(
        badSpace.length === 0,
        "★ 那些行的空格渲染成了**可见**的「空格」，没有尾随空白（否则用户看到的是 `Ctrl+ `）",
        badSpace.map((r) => JSON.stringify(r.k)).join(" ") || "(无)",
    );
    const optionGlyphAnywhere = scPairs.some((r) => r.k.includes("⌥"));
    ok(isMac || !optionGlyphAnywhere, "★ Windows 上整份速查不出现 ⌥（那是 macOS 字形）", `含 ⌥ 的行 ${scPairs.filter((r) => r.k.includes("⌥")).length} 条`);

    // 关掉速查对话框，好让下面的「迁移」按钮露出来（它也在「帮助」分区里）
    const closedSc = await page.eval(`(() => {
        const dlg = [...document.querySelectorAll('.b3-dialog--open')].find((d) => d.querySelector('.mm-sc'));
        if (!dlg) return 'gone';
        // 首选走思源自己的 Dialog 实例：destroy() 关掉的不只是 DOM，还有实例里登记的监听
        const inst = (window.siyuan.dialogs || []).find((x) => x.element && x.element.querySelector('.mm-sc'));
        if (inst && typeof inst.destroy === 'function') { inst.destroy(); return 'destroyed'; }
        // ⚠️ 兜底点关闭按钮时**不能**调 .click()：那个按钮是 <svg>，而
        // Element.prototype.click 只长在 HTMLElement 上，SVGElement 上没有 ——
        // 直接调会抛 "close.click is not a function"（第一版就是这么翻的车）。
        const close = dlg.querySelector('.b3-dialog__close') || dlg.querySelector('[class*="__close"]');
        if (close) { close.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 'clicked-close'; }
        dlg.remove();
        return 'removed';
    })()`);
    ok(closedSc !== "gone", "速查对话框关得掉", closedSc);
    await sleep(500);

    // 面板里的「迁移【自定义块样式】标记」按钮 —— 它的**文案**在 tests/ 里零命中。
    // 命令本身由 `diag-commands.mjs` 的 F 段验过，但「面板上这个按钮有没有接上线」
    // 是另一回事（按钮接空是纯 UI 层的事，命令测不出来）。
    // 本文档没有 legacy 标记，所以正确行为是**明确提示**「没有找到…」，不是静默。
    await sleep(3600); // 等上一条 snackbar 自己过期，免得串台
    const migBtn = await page.eval(`(() => {
        const row = [...document.querySelectorAll('.b3-dialog--open .config-name')].find((e) => (e.textContent || '').includes('迁移'));
        if (!row) return 'no-row';
        const item = row.closest('.config-item') || row.closest('.b3-label') || row.parentElement;
        const b = item && item.querySelector('button');
        if (!b) return 'no-button';
        b.click();
        return 'clicked';
    })()`);
    await sleep(1400);
    const migToast = (await texts(".b3-snackbar__content")).join(" ⏎ ");
    ok(migBtn === 'clicked' && /没有找到来自/.test(migToast), "设置面板里的「迁移【自定义块样式】标记」按钮真的接上了命令（无 legacy 标记时明确提示，不静默）", `${migBtn}｜${migToast.slice(0, 50)}`);

    await page.screenshot(`${OUT}/diag-settings.png`);

    console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
    if (fail === 0) {
        console.log("✓ 9 个「有实现、没断言」的设置项全部有了真断言：showOrder / compact / compactThreshold /");
        console.log("  ctrlWheelZoom / wheelPan / flipAnimation / hoverPreview / viewPerDoc / lazyRender / hardLimit");
    }
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}

process.exit(fail === 0 ? 0 : 1);
