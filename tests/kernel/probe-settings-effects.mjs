/**
 * 只读探针：**9 个从没被测试碰过的设置项**，实际效果到底长什么样？
 *
 * 起因：`scripts/coverage-audit.mjs`（把入口从源码里枚举出来，逐条对账测试命中）
 * 报出一批零命中 —— `compact` / `compactThreshold` / `lazyRender` / `hardLimit` /
 * `flipAnimation` / `showOrder` / `ctrlWheelZoom` / `wheelPan` / `hoverPreview` /
 * `viewPerDoc` / `LAYOUT_OPTIONS` 在 `tests/` 里**一次都没出现过**。
 * 典型的「有实现、没断言」。
 *
 * 这个探针只 dump，不下结论 —— 目的是先看清每项的**可观测信号**是什么，
 * 再据此写断言（顺序不能反：先断言后找信号，很容易写成永远绿的装饰）。
 *
 * ## 第一版探针踩的四个坑（信号找错了，全测成「没反应」）
 *
 * 1. `hardLimit` —— `mount()` 只在**首次挂载**时判上限。列表早就挂上了，
 *    改 config + `refreshAll()` 不会再走 mount，所以永远看不到提示。
 *    必须**先卸掉再重挂**。
 * 2. 折叠态不是 `.mm-node.mm-folded`，而是珠子上的 **`.mm-toggle--collapsed`**。
 * 3. `viewSummaries()` 返回的是 `{ where, info }` —— **没有 `id` 字段**，
 *    按 `id` 找视图永远找不着（`scale` 读出来是 null）。要按 `where` 匹配。
 * 4. `flipAnimation` 不是 CSS transition（`.mm-node` 的 transition 恒为 opacity），
 *    它是 JS 驱动：消失的节点会被加上 **`.mm-collapsing`** 再双 rAF 收拢。
 *    所以要看那个 class，不能看 computed transition。
 *
 * ## 第二版探针又踩的两个坑
 *
 * 5. `hardLimit` 的第二层拦截 —— `lazyRender` 默认 **true**，`scan()` 里有
 *    `if (opts.lazyRender && !this.visible.has(id)) { observeLazy(list); continue; }`。
 *    专门预留的「从未挂载过」的列表在文档底部、从没进过视口 → 永远不在 `visible` 里
 *    → **scan 根本没走到 `mount()`**，上限判定一次都没执行。
 *    必须连 `lazyRender: false` 一起临时关掉。
 * 6. `hoverPreview` 的悬停目标 —— `armPreview` 绑的是**珠子本身**的
 *    `tog.onmouseenter`（renderer.ts:2842），不是整个 `.mm-node`。
 *    悬停节点中心 → 珠子收不到 mouseenter → 永远没有卡片。
 * 7. 靠鼠标点珠子来折叠，在这条长链路里**不可靠**（前面几步滚过页面 / 悬停过，
 *    点击坐标会落空，而且落空是静默的 —— 只是「没折成」，不是报错）。
 *    ⑥ 因此改成程序化 `view.toggleFold(n)`。要验键盘 / 鼠标路径的另开一支。
 *
 * ## 结论速览（本探针的产出）
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
 * | `lazyRender` | 是否进视口才挂载 | 见 ③ 的反面用法 |
 *
 * 改配置走的是「直接改内存 config + `scanner.refreshAll()`」这条路
 * （与 `diag-canvas-v2.mjs` 里自定义配色那条一致）——
 * 不去点三层设置 UI，省时且不引入 UI 层噪音。
 *
 * 用法：node tests/kernel/probe-settings-effects.mjs
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
 * 三个列表：
 *   listO —— **有序**列表（`showOrder` 只对有序列表生效，没它这项测不出来）
 *   listU —— 普通列表，节点多一些，用来量间距 / 折叠出预览 / 写视图偏好
 *   listL —— **先不打标记**，专门留给 `hardLimit`：上限判定只在**首次挂载**时走，
 *            所以必须留一个「从未挂载过」的列表，到那一步再给它打标记。
 *            （第一版拿已挂载的列表反复摘/挂属性，撞上「抑制重挂」窗口，
 *             把后面所有依赖画布的步骤一起带崩了。）
 */
const md = [
    "1. 有序甲",
    "   1. 有序甲子",
    "2. 有序乙",
    "3. 有序丙",
    "",
    "分开两段",
    "",
    "- 普通根",
    "  - 子一",
    "    - 孙一",
    "    - 孙二",
    "  - 子二",
    "  - 子三",
    "",
    "再分一段",
    "",
    "- 上限甲",
    "- 上限乙",
    "- 上限丙",
    "",
].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-设置项效果-${Date.now()}`, markdown: md });
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;

const lists = (await kids(docId)).filter((k) => k.type === "l");
const [listO, listU, listL] = lists;
if (!listO || !listU || !listL) throw new Error(`预期三个顶层列表，实际 ${lists.length} 个`);

await api("/api/attr/setBlockAttrs", { id: listO.id, attrs: { "custom-mindmap": "logic" } });
await api("/api/attr/setBlockAttrs", { id: listU.id, attrs: { "custom-mindmap": "logic" } });

console.log(`临时文档 ${docId}`);
console.log(`有序列表 ${listO.id}（${(await kids(listO.id)).length} 项）`);
console.log(`普通列表 ${listU.id}（${(await kids(listU.id)).length} 个顶层项）`);
console.log(`上限专用列表 ${listL.id}（${(await kids(listL.id)).length} 项，暂不打标记）\n`);

/* ---------------------------------------------------------------- 脚手架 */

const MM_PLUGIN = `((window.siyuan && window.siyuan.ws && window.siyuan.ws.app && window.siyuan.ws.app.plugins) || []).find((p) => p.name === 'siyuan-plugin-mindmap')`;
const R_U = `.protyle-wysiwyg .list[data-node-id="${listU.id}"] .mm-root`;
const R_O = `.protyle-wysiwyg .list[data-node-id="${listO.id}"] .mm-root`;

const chrome = await launch({ headless: true, port: 9386, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2600);

    const setCfg = (patch, refresh = true) =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            if (!p) return 'no-plugin';
            Object.assign(p.config, ${JSON.stringify(patch)});
            if (${refresh}) p.scanner && p.scanner.refreshAll();
            return 'ok';
        })()`);

    /** 视图信息：注意 `where` 里才有块 id，没有 `id` 字段 */
    const infoOf = (listId) =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const vs = (p && p.scanner && p.scanner.viewSummaries()) || [];
            const v = vs.find((x) => String(x.where).includes(${JSON.stringify(listId)}));
            return v ? v.info : null;
        })()`);
    const rects = (sel, n = 6) =>
        page.eval(`[...document.querySelectorAll(${JSON.stringify(sel)} + ' .mm-node')].slice(0, ${n}).map((e) => {
            const r = e.getBoundingClientRect();
            return { t: Math.round(r.top), l: Math.round(r.left), txt: (e.textContent || '').trim().slice(0, 8) };
        })`);
    const foldFirst = async () => {
        const pt = await page.eval(`(() => {
            const root = document.querySelector(${JSON.stringify(R_U)});
            if (!root) return { err: 'no root' };
            const t = [...root.querySelectorAll('.mm-node .mm-toggle')].find((x) => !x.classList.contains('mm-toggle--collapsed'));
            if (!t) return { err: 'no expandable toggle' };
            t.scrollIntoView({ block: 'center' });
            const r = t.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
        if (pt.err) return pt;
        await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
        await page.mouse("mousePressed", pt.x, pt.y, { clickCount: 1 });
        await page.mouse("mouseReleased", pt.x, pt.y, { clickCount: 1 });
        return { ok: true };
    };

    console.log("挂载情况：有序图", await page.eval(`document.querySelectorAll(${JSON.stringify(R_O)} + ' .mm-node').length`), "节点；普通图", await page.eval(`document.querySelectorAll(${JSON.stringify(R_U)} + ' .mm-node').length`), "节点\n");

    /* ---- ① showOrder ---- */
    console.log("【① showOrder 显示层级编号】");
    await setCfg({ showOrder: false });
    await sleep(700);
    console.log("  关：.mm-badge", await page.eval(`document.querySelectorAll(${JSON.stringify(R_O)} + ' .mm-badge').length`), "个 →", JSON.stringify(await page.eval(`[...document.querySelectorAll(${JSON.stringify(R_O)} + ' .mm-node')].map((e) => (e.textContent || '').trim())`)));
    await setCfg({ showOrder: true });
    await sleep(700);
    console.log("  开：.mm-badge", await page.eval(`document.querySelectorAll(${JSON.stringify(R_O)} + ' .mm-badge').length`), "个 →", JSON.stringify(await page.eval(`[...document.querySelectorAll(${JSON.stringify(R_O)} + ' .mm-badge')].map((e) => (e.textContent || '').trim())`)));

    /* ---- ② compact / compactThreshold ---- */
    console.log("\n【② compact / compactThreshold 节点间距】");
    const gaps = (rs) => rs.slice(1).map((r, i) => r.t - rs[i].t);
    await setCfg({ compact: false, compactThreshold: 9999 });
    await sleep(900);
    const wide = await rects(R_U);
    console.log("  关：相邻纵向间距", JSON.stringify(gaps(wide)), JSON.stringify(wide.map((r) => r.l)));
    await setCfg({ compact: true });
    await sleep(900);
    const tight = await rects(R_U);
    console.log("  开：相邻纵向间距", JSON.stringify(gaps(tight)), JSON.stringify(tight.map((r) => r.l)));
    await setCfg({ compact: false, compactThreshold: 1 });
    await sleep(900);
    const thr = await rects(R_U);
    console.log("  阈值=1（自动收紧）：", JSON.stringify(gaps(thr)), JSON.stringify(thr.map((r) => r.l)));
    await setCfg({ compact: false, compactThreshold: 5000 });

    /* ---- ③ hardLimit：用**从未挂载过**的 listL，走一次全新的 mount ----
       `mount()` 只在首次挂载时判上限，所以改 config + refreshAll 对已挂载的列表无效。
       拿已挂载的列表反复摘/挂属性也不行 —— 会撞上「抑制重挂」窗口（3 秒内不再挂），
       第一版就是这么把后面所有依赖画布的步骤一起带崩的。

       ★ 第二版失败的真根因（读了 scan() 才看明白）：`lazyRender` 默认 true，
       `scan()` 里有 `if (opts.lazyRender && !this.visible.has(id)) { observeLazy; continue; }`。
       listL 在文档底部、从没进过视口 → 永远不在 `visible` 里 → **scan 根本没走到 mount()**，
       上限判定自然一次都没执行。所以必须连 `lazyRender: false` 一起临时关掉。 */
    console.log("\n【③ hardLimit 渲染上限（安全阀）】");
    const R_L = `.protyle-wysiwyg .list[data-node-id="${listL.id}"]`;
    await setCfg({ hardLimit: 2, lazyRender: false }, false);
    await sleep(300);
    await api("/api/attr/setBlockAttrs", { id: listL.id, attrs: { "custom-mindmap": "logic" } });
    await sleep(1500);
    // 属性回推不一定会触发扫描（列表在视口外时 Protyle 的 MutationObserver 可能不派发），手动补一次
    await page.eval(`(() => { const p = ${MM_PLUGIN}; if (p && p.scanner) p.scanner.scanAll(); return 'ok'; })()`);
    await sleep(1800);
    console.log("  该列表的 .mm-root（期望 0，被安全阀拦下）：", await page.eval(`document.querySelectorAll(${JSON.stringify(R_L)} + ' .mm-root').length`));
    console.log("  .mm-notice：", await page.eval(`document.querySelectorAll('.mm-notice').length`), "个");
    console.log("  提示文案：", JSON.stringify(await page.eval(`[...document.querySelectorAll('.mm-notice')].map((e) => (e.textContent || '').trim())`)));
    console.log("  该列表画布节点数：", await page.eval(`document.querySelectorAll(${JSON.stringify(R_L)} + ' .mm-root .mm-node').length`));
    const forced = await page.eval(`(() => {
        const b = [...document.querySelectorAll('.mm-notice button')].find((x) => (x.textContent || '').includes('仍然渲染'));
        if (!b) return 'no-button';
        b.click();
        return 'clicked';
    })()`);
    console.log("  点「仍然渲染」：", forced);
    await sleep(2000);
    console.log("  之后节点数：", await page.eval(`document.querySelectorAll(${JSON.stringify(R_L)} + ' .mm-root .mm-node').length`), "｜.mm-notice", await page.eval(`document.querySelectorAll('.mm-notice').length`));
    await setCfg({ hardLimit: 5000, lazyRender: true });
    await sleep(1200);

    /* ---- ④ hoverPreview ----
       ★ 第一版悬停点找错了：`armPreview` 绑的是 **珠子本身** 的
       `tog.onmouseenter`（renderer.ts:2842），不是整个 `.mm-node`。
       悬停节点中心 → 珠子根本没收到 mouseenter → 永远没有卡片。
       改成悬停珠子自己的 rect 中心。 */
    console.log("\n【④ hoverPreview 悬停预览】");
    await setCfg({ hoverPreview: true });
    await sleep(800);
    const f = await foldFirst();
    await sleep(800);
    console.log("  折叠：", JSON.stringify(f), "｜.mm-toggle--collapsed", await page.eval(`document.querySelectorAll(${JSON.stringify(R_U)} + ' .mm-toggle--collapsed').length`));
    const beadPt = () => page.eval(`(() => {
        const root = document.querySelector(${JSON.stringify(R_U)});
        const t = root && root.querySelector('.mm-toggle--collapsed');
        if (!t) return { err: 'no collapsed toggle' };
        const r = t.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    const hoverPt = await beadPt();
    if (!hoverPt.err) {
        await page.mouse("mouseMoved", 4, 4, { buttons: 0 });
        await sleep(150);
        await page.mouse("mouseMoved", hoverPt.x, hoverPt.y, { buttons: 0 });
        await sleep(1500);
        console.log("  珠子 rect", `${hoverPt.w}x${hoverPt.h} @(${hoverPt.x},${hoverPt.y})`, "｜悬停 1.5s：.mm-preview", await page.eval(`document.querySelectorAll('.mm-preview').length`), "个 →", JSON.stringify(await page.eval(`[...document.querySelectorAll('.mm-preview')].map((e) => (e.textContent || '').trim())`)));
        // 若还没有，补一句内省：看 armPreview 到底有没有被调到（previewTimer 非 0 说明计时器已起）
        console.log("  内省：", await page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p.scanner.views && p.scanner.views.get(${JSON.stringify(listU.id)});
            return JSON.stringify({ hoverPreview: p.config.hoverPreview, previewTimer: v ? v.previewTimer : 'no-view', previewEl: !!(v && v.previewEl) });
        })()`));
    } else console.log("  找不到折叠珠子：", hoverPt.err);
    await setCfg({ hoverPreview: false });
    await sleep(700);
    await page.mouse("mouseMoved", 4, 4, { buttons: 0 });
    await sleep(300);
    if (!hoverPt.err) {
        await page.mouse("mouseMoved", hoverPt.x, hoverPt.y, { buttons: 0 });
        await sleep(1500);
        console.log("  关掉后同样悬停 1.5s：.mm-preview", await page.eval(`document.querySelectorAll('.mm-preview').length`), "个");
    }

    /* ---- ⑤ ctrlWheelZoom / wheelPan ---- */
    console.log("\n【⑤ ctrlWheelZoom / wheelPan 滚轮行为】");
    const wheelAt = async (modifiers, dy) => {
        const c = await page.eval(`(() => {
            const root = document.querySelector(${JSON.stringify(R_U)});
            if (!root) return null;
            const r = root.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
        if (!c) return "(找不到画布，跳过)";
        await page.mouse("mouseMoved", c.x, c.y, { buttons: 0 });
        await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: c.x, y: c.y, deltaX: 0, deltaY: dy, modifiers, button: "none", buttons: 0 });
        await sleep(700);
        return "";
    };
    const worldTransform = () => page.eval(`(() => { const w = document.querySelector(${JSON.stringify(R_U)} + ' .mm-world'); return w ? w.style.transform : null; })()`);
    const scaleNow = async () => (await infoOf(listU.id))?.scale ?? null;

    await setCfg({ ctrlWheelZoom: true, wheelPan: false });
    await sleep(800);
    let s0 = await scaleNow();
    let w0 = await worldTransform();
    await wheelAt(2, -240);
    console.log(`  ctrlWheelZoom=开 + Ctrl 滚轮↑：scale ${s0} → ${await scaleNow()}｜world ${w0} → ${await worldTransform()}`);

    await setCfg({ ctrlWheelZoom: false, wheelPan: false });
    await sleep(800);
    s0 = await scaleNow();
    await wheelAt(2, -240);
    console.log(`  ctrlWheelZoom=关 + Ctrl 滚轮↑：scale ${s0} → ${await scaleNow()}`);

    await setCfg({ ctrlWheelZoom: false, wheelPan: true });
    await sleep(800);
    w0 = await worldTransform();
    await wheelAt(0, 240);
    console.log(`  wheelPan=开 + 普通滚轮↓：world ${w0} → ${await worldTransform()}`);

    await setCfg({ ctrlWheelZoom: true, wheelPan: false });
    await sleep(700);

    /* ---- ⑥ flipAnimation：看 .mm-collapsing ----
       ★ `runCollapse` 第一句是
       `if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;`
       —— 一开始怀疑 headless 默认报 `reduce`。实测**不是**：环境报 false，
       显式 `Emulation.setEmulatedMedia` 模拟 no-preference 之后仍然是 0。

       真因是**这一步的折叠没真的发生**：靠鼠标点珠子（`foldFirst`）在这条
       长链路里不可靠（前面几步滚过页面 / 悬停过，点击坐标会落空），
       折叠没发生 → `detachVanishing` 一次都没被调 → 自然是 0。

       所以这里改成**程序化折叠**（直接调 `view.toggleFold(n)`），
       再配合 `detachVanishing` / `runCollapse` 的计数器 —— 与几何无关，可复现。
       专项验证见 `tests/kernel/probe-flip-anim.mjs`（那支是干净的独立复现）。 */
    console.log("\n【⑥ flipAnimation 布局动效】");
    const reduced = await page.eval(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`);
    console.log("  环境 prefers-reduced-motion:reduce =", reduced);
    if (reduced) {
        await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
        await sleep(200);
        console.log("  模拟后 =", await page.eval(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`));
    }
    /** 给 view 的两个私有方法包一层计数器（TS 的 private 只是编译期约束） */
    const installFlipHooks = () =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p.scanner.views && p.scanner.views.get(${JSON.stringify(listU.id)});
            if (!v) return 'no-view';
            window.__flip = { detach: [], collapse: [] };
            const od = v.detachVanishing.bind(v);
            v.detachVanishing = (a, b) => { const out = od(a, b); window.__flip.detach.push(out.length); return out; };
            const oc = v.runCollapse.bind(v);
            v.runCollapse = (items) => { window.__flip.collapse.push(items.length); return oc(items); };
            return 'ok';
        })()`);
    /** 程序化折叠「第一个还有子节点、且还没折」的节点；随后 500ms 内抓 .mm-collapsing 峰值 */
    const foldProgrammatic = async () => {
        const who = await page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p.scanner.views && p.scanner.views.get(${JSON.stringify(listU.id)});
            if (!v || !v.tree) return 'no-view';
            let found = null;
            const w = (x) => { if (!found && x.children.length > 0 && !x.folded) found = x; x.children.forEach(w); };
            w(v.tree);
            if (!found) return 'no-node';
            const t = (found.text || '').slice(0, 6);
            v.toggleFold(found);
            return 'ok:' + t;
        })()`);
        if (!String(who).startsWith('ok')) return { err: who, peak: 0 };
        let peak = 0;
        for (let i = 0; i < 30; i++) {
            const n = await page.eval(`document.querySelectorAll('.mm-collapsing').length`);
            if (n > peak) peak = n;
            await sleep(16);
        }
        return { ok: true, who, peak };
    };
    const flipStats = () => page.eval(`JSON.stringify(window.__flip || null)`);
    /** 把当前折叠的节点全展开，让下一轮从干净状态开始 */
    const unfoldAll = () =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p.scanner.views && p.scanner.views.get(${JSON.stringify(listU.id)});
            if (!v || !v.tree) return 'no-view';
            const list = [];
            const w = (x) => { if (x.children.length > 0 && x.folded) list.push(x); x.children.forEach(w); };
            w(v.tree);
            for (const n of list) v.toggleFold(n);
            return 'unfolded:' + list.length;
        })()`);

    await unfoldAll();
    await sleep(1500);
    await setCfg({ flipAnimation: false });
    await sleep(800);
    await installFlipHooks();
    let fr = await foldProgrammatic();
    console.log("  关：", JSON.stringify(fr), "｜计数器", await flipStats());
    await sleep(1200);
    await unfoldAll();
    await sleep(1600);
    await setCfg({ flipAnimation: true });
    await sleep(800);
    await installFlipHooks();
    fr = await foldProgrammatic();
    console.log("  开：", JSON.stringify(fr), "｜计数器", await flipStats());
    await sleep(1400);
    await unfoldAll();
    await sleep(1200);

    /* ---- ⑦ viewPerDoc：偏好写不写进块属性 ---- */
    console.log("\n【⑦ viewPerDoc 视图偏好跟文档走】");
    const markScale = () =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p.scanner.views && p.scanner.views.get(${JSON.stringify(listU.id)});
            if (!v) return 'no-view';
            /* 等价于工具条缩放菜单里点「记住这个缩放」 */
            v.markPref('scale', 1.25);
            return 'ok';
        })()`);
    await setCfg({ viewPerDoc: false });
    await sleep(800);
    console.log("  关：markPref →", await markScale(), "｜内核属性", JSON.stringify((await attrsOf(listU.id))["custom-mindmap-view"]));
    await sleep(1200);
    console.log("    等 1.2s 后：", JSON.stringify((await attrsOf(listU.id))["custom-mindmap-view"]));
    await setCfg({ viewPerDoc: true });
    await sleep(800);
    console.log("  开：markPref →", await markScale(), "｜内核属性", JSON.stringify((await attrsOf(listU.id))["custom-mindmap-view"]));
    await sleep(1400);
    console.log("    等 1.4s 后：", JSON.stringify((await attrsOf(listU.id))["custom-mindmap-view"]));

    /* ---- ⑧ 设置面板 ---- */
    console.log("\n【⑧ 设置面板】");
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
    const titles = await page.eval(`[...document.querySelectorAll('.b3-dialog--open .config-name')].map((e) => (e.textContent || '').trim())`);
    console.log(`  面板条目 ${titles.length} 项：${titles.join(" · ")}`);
    const helpBtn = await page.eval(`(() => {
        const row = [...document.querySelectorAll('.b3-dialog--open .config-name')].find((e) => (e.textContent || '').includes('查看快捷键'));
        if (!row) return 'no-row';
        const item = row.closest('.b3-label') || row.parentElement;
        const b = item && item.querySelector('button');
        if (!b) return 'no-button';
        b.click();
        return 'clicked';
    })()`);
    console.log("  点「查看」：", helpBtn);
    await sleep(1100);
    console.log("  提示：", JSON.stringify((await page.eval(`[...document.querySelectorAll('.b3-snackbar__content')].map((e) => (e.textContent || '').trim()).join(' ⏎ ')`)).slice(0, 260)));

    await page.screenshot(`${OUT}/probe-settings-effects.png`);
    console.log(`\n截图 ${OUT}/probe-settings-effects.png`);
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}
