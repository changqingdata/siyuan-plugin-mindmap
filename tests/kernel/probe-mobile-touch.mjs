/**
 * 移动端 / 触屏实测探针：`plugin.json` 的 `frontends: ["all"]` 到底成不成立？
 *
 * 为什么必须测**移动端前端**（`/stage/build/mobile/`）而不是「桌面端开窄窗口」：
 * 思源的移动端 App 走的是另一套前端构建，DOM 结构、工具栏、事件模型都不一样。
 * 在桌面端把窗口调窄，测的是「桌面端在窄屏下的表现」，跟 `frontends: ["mobile"]`
 * 这句声明**不是一回事**。
 *
 * 本探针只读不写（除了自建的临时文档，跑完自删）。
 *
 * 用法：node tests/kernel/probe-mobile-touch.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";

const api = async (p, b) =>
    (
        await fetch(KERNEL + p, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
            body: JSON.stringify(b ?? {}),
        })
    ).json();

// ⚠️ 用**任务列表**而不是无序列表：过滤 chip（全部 / 未完成 / 已完成）在图里
// 没有待办时会**按设计自动收起**（`display: none`，量到 0×0）。用无序列表的话
// 那三个按钮量不到，看起来像「热区不合格」，其实是被有意藏起来了 ——
// 第一版就是这么误判的。带待办才能把它们逼出来一起量。
const MD = ["- [ ] 移动端根", "  - [ ] 甲", "    - [x] 甲.1", "    - [ ] 甲.2", "  - [x] 乙", "  - [ ] 丙", ""].join("\n");
const doc = (await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-移动端-${Date.now()}`, markdown: MD })).data;
const list = (await api("/api/block/getChildBlocks", { id: doc })).data.find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: list, attrs: { "custom-mindmap": "logic" } });
console.log(`文档 ${doc}\n`);

const ROOT = `document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)')`;

const W = 390;
const H = 844;

const chrome = await launch({ headless: true, width: W, height: H, dpr: 3 });
const page = await chrome.newPage("about:blank");

/** 在指定坐标点一下（真实 touch 事件，不是 mouse） */
async function tap(x, y) {
    await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(60);
    await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** 长按：按下 → 等 → 松开 */
async function longPress(x, y, ms = 700) {
    await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(ms);
    await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** 拖动：按下 → 连续移动 → 松开 */
async function drag(x1, y1, x2, y2, steps = 8) {
    await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] });
    for (let i = 1; i <= steps; i++) {
        const x = x1 + ((x2 - x1) * i) / steps;
        const y = y1 + ((y2 - y1) * i) / steps;
        await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
        await sleep(28);
    }
    await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const results = [];
const ok = (cond, label, diag = "") => {
    results.push({ pass: !!cond, label, diag });
    console.log(`  ${cond ? "✓" : "✗"} ${label}${diag ? `  ${diag}` : ""}`);
};

try {
    // 移动端设备仿真：mobile=true 才会让 `@media (hover: none)` 等媒体查询生效
    await page.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await page.send("Page.navigate", { url: `${KERNEL}/stage/build/mobile/?id=${doc}` });
    await sleep(5000);

    /* ---------------------------------------------------------- A 基本装载 */
    console.log("【A 移动端前端装载】");
    const stage = await page.eval(`location.pathname`);
    console.log(`  当前前端：${stage}`);
    const hasSiyuan = await page.eval(`!!(window.siyuan && window.siyuan.ws && window.siyuan.ws.app)`);
    ok(hasSiyuan, "移动端前端已就绪（window.siyuan.ws.app 存在）");

    const pluginLoaded = await page.eval(
        `((window.siyuan?.ws?.app?.plugins) || []).some((x) => x.name === 'siyuan-plugin-mindmap')`,
    );
    ok(pluginLoaded, "★ 插件在移动端被加载（frontends 声明允许）");

    const isMobileFlag = await page.eval(`!!(window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.os !== undefined)`);
    console.log(`  system.os = ${await page.eval(`window.siyuan?.config?.system?.os`)}`);

    /* ---------------------------------------------------------- B 是否渲染 */
    console.log("\n【B 导图是否渲染出来】");
    await page.waitFor(`${ROOT} !== null`, { timeout: 25000, label: "导图挂载" }).catch(() => {});
    await sleep(900);
    const mounted = await page.eval(`!!${ROOT}`);
    const nodeCount = await page.eval(`(${ROOT}?.querySelectorAll('.mm-node') || []).length`);
    ok(mounted, "★ 导图根容器挂载成功");
    ok(nodeCount >= 5, "★ 节点渲染出来了（不是空图）", `${nodeCount} 个节点`);

    if (!mounted) {
        console.log("\n导图没挂载，后面几项无法进行。");
        throw new Error("unmounted");
    }

    /* ---------------------------------------------------------- C 布局适配 */
    console.log("\n【C 窄屏布局】");
    const layout = await page.eval(`(() => {
        const r = ${ROOT};
        const tb = r.querySelector('.mm-toolbar');
        const vp = r.querySelector('.mm-viewport');
        const box = r.getBoundingClientRect();
        return {
            rootW: Math.round(box.width), rootH: Math.round(box.height),
            toolbarScrollW: tb ? tb.scrollWidth : 0,
            toolbarClientW: tb ? tb.clientWidth : 0,
            toolbarH: tb ? Math.round(tb.getBoundingClientRect().height) : 0,
            vpW: vp ? Math.round(vp.getBoundingClientRect().width) : 0,
            vpH: vp ? Math.round(vp.getBoundingClientRect().height) : 0,
            docScrollW: document.documentElement.scrollWidth,
            winW: window.innerWidth,
        };
    })()`);
    console.log(`  ${JSON.stringify(layout)}`);
    ok(layout.rootW <= layout.winW + 2, "导图宽度没有溢出视口", `根 ${layout.rootW}px / 窗口 ${layout.winW}px`);
    ok(layout.docScrollW <= layout.winW + 2, "整页没有横向滚动条", `文档宽 ${layout.docScrollW}px`);
    ok(layout.vpW > 100 && layout.vpH > 100, "画布视口拿到了可用尺寸", `${layout.vpW}×${layout.vpH}`);

    /* ---------------------------------------------------------- D 点击热区 */
    console.log("\n【D 手指点得中吗（热区尺寸）】");
    const targets = await page.eval(`(() => {
        const r = ${ROOT};
        // ⚠️ 只量**可见**的按钮。隐藏的分组（比如没有待办时收起的过滤 chip）
        // 量出来是 0×0，那是设计如此，不是热区不合格 —— 把它算进来就会误判。
        // 顺带按元素去重：\`.mm-toolbar button\` 本来就包含 \`.mm-filters button\` 与 \`.mm-seg button\`。
        const seen = new Set();
        const out = [];
        for (const b of r.querySelectorAll('.mm-toolbar button, .mm-filters button, .mm-seg button')) {
            if (seen.has(b)) continue;
            seen.add(b);
            const cs = getComputedStyle(b);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const x = b.getBoundingClientRect();
            if (x.width < 1 || x.height < 1) continue;
            out.push({
                w: Math.round(x.width), h: Math.round(x.height),
                t: (b.dataset.mmTip || b.textContent || '').trim().slice(0, 14),
                cls: b.closest('.mm-filters') ? 'filter' : b.closest('.mm-seg') ? 'seg' : 'toolbar',
            });
        }
        return out;
    })()`);
    const byCls = { toolbar: 0, filter: 0, seg: 0 };
    for (const b of targets) byCls[b.cls]++;
    console.log(`  可见按钮：工具条 ${byCls.toolbar} · 过滤 ${byCls.filter} · 布局 ${byCls.seg} 个`);
    ok(byCls.filter >= 3, "★ 带待办时过滤 chip 是可见的（没被误判成「热区为 0」）", `${byCls.filter} 个`);
    if (targets.length) {
        const tiny = targets.filter((b) => b.h < 22 || b.w < 22);
        const minH = Math.min(...targets.map((b) => b.h));
        const minW = Math.min(...targets.map((b) => b.w));
        console.log(`  最小热区 ${minW}×${minH}px`);
        ok(tiny.length === 0, "★ 所有可见按钮热区 ≥ 22px（手指点得中）", tiny.length ? `偏小 ${tiny.length} 个：${tiny.map((b) => `${b.t}(${b.w}×${b.h})`).join(" ")}` : "全部达标");
    }

    /* ---------------------------------------------------------- E 触摸选择 */
    console.log("\n【E 触摸选择与操作条】");
    //
    // ⚠️ 这里**不做**「沿节点横向扫描」。原因是踩出来的，值得记：
    //   这份 fixture 是任务列表，节点左边有个复选框。点复选框是**切换待办** ——
    //   会写内核、触发重渲染，于是 `.mm-node` 元素被换掉、盒子尺寸也变
    //   （实测 43px → 87px），`querySelectorAll('.mm-node')[1]` 可能已经是另一个节点。
    //   表现是「同一个元素两次点击结果不同」，看起来像 bug，其实是**测的是移动靶**。
    //
    //   干净的量法在 `probe-mobile-tap.mjs`（用无序列表，点哪儿都不改文档）：
    //   点节点中心 8/8 命中、点文字中心 4/4 命中 —— 有效点击区域覆盖整个节点。
    //
    //   所以这里只断言两件事，都是稳定且有意义的：
    //     ① 点**文字**（不是复选框）能选中，且操作条在触屏下可见；
    //     ② 点**复选框**会切换待办 —— 这是正确行为，不该被当成「没选中」的失败。

    // ① 点文字中心
    const txtPt = await page.eval(`(() => {
        const n = ${ROOT}.querySelectorAll('.mm-node')[1];
        const x = n && n.querySelector('.mm-txt');
        if (!x) return null;
        const b = x.getBoundingClientRect();
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), t: (x.textContent || '').trim() };
    })()`);
    await tap(txtPt.x, txtPt.y);
    await sleep(900);
    const selCount = await page.eval(`(${ROOT}?.querySelectorAll('.mm-node.mm-sel') || []).length`);
    const acts = await page.eval(`(() => {
        const r = ${ROOT};
        const bar = r.querySelector('.mm-node.mm-sel .mm-acts') || r.querySelector('.mm-acts');
        if (!bar) return { found: false };
        const cs = getComputedStyle(bar);
        return { found: true, display: cs.display, visibility: cs.visibility, opacity: cs.opacity, h: Math.round(bar.getBoundingClientRect().height) };
    })()`);
    console.log(`  点文字「${txtPt.t}」→ 选中 ${selCount} 个｜操作条 ${JSON.stringify(acts)}`);
    ok(selCount >= 1, "★ 触摸点文字能选中节点", `选中 ${selCount} 个`);
    ok(
        acts.found && acts.display !== "none" && acts.visibility !== "hidden" && Number(acts.opacity) > 0.05,
        "★ 触屏下选中后操作条可见（没有 hover 也能露出来）",
        JSON.stringify(acts),
    );

    // ② 点复选框 → 应切换待办（读**内核**确认，不看 DOM，避免被重渲染骗到）
    const taskPt = await page.eval(`(() => {
        const n = ${ROOT}.querySelectorAll('.mm-node')[1];
        const c = n && n.querySelector('.mm-task');
        if (!c) return null;
        const b = c.getBoundingClientRect();
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    })()`);
    if (taskPt) {
        const kdBefore = await api("/api/block/getBlockKramdown", { id: list }).then((r) => r.data?.kramdown || "");
        await tap(taskPt.x, taskPt.y);
        await sleep(1600);
        const kdAfter = await api("/api/block/getBlockKramdown", { id: list }).then((r) => r.data?.kramdown || "");
        const cnt = (s) => (s.match(/\[[ xX]\]/g) || []).filter((m) => m !== "[ ]").length;
        console.log(`  点复选框：内核已完成待办 ${cnt(kdBefore)} → ${cnt(kdAfter)} 项`);
        ok(cnt(kdBefore) !== cnt(kdAfter), "★ 触摸点复选框会切换待办（写进内核，不是假按钮）", `${cnt(kdBefore)} → ${cnt(kdAfter)}`);
    }

    /* ---------------------------------------------------------- F 长按菜单 */
    console.log("\n【F 长按呼出菜单】");
    if (txtPt) {
        await longPress(txtPt.x, txtPt.y, 750);
        await sleep(700);
        const menuOpen = await page.eval(`!!document.querySelector('.b3-menu')`);
        const menuTxt = await page.eval(`(() => { const m = document.querySelector('.b3-menu'); return m ? (m.textContent || '').trim().slice(0, 60) : ''; })()`);
        ok(menuOpen, "★ 长按节点能呼出上下文菜单", menuOpen ? menuTxt : "没弹出");
        if (menuOpen) {
            await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 5, y: 5 }] });
            await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await sleep(500);
        }
    }

    /* ---------------------------------------------------------- G 手势平移 */
    console.log("\n【G 触摸拖动平移画布】");
    const beforeT = await page.eval(`(() => { const w = ${ROOT}.querySelector('.mm-world'); return w ? getComputedStyle(w).transform : null; })()`);
    const vpBox = await page.eval(`(() => { const v = ${ROOT}.querySelector('.mm-viewport'); const b = v.getBoundingClientRect(); return { x: Math.round(b.left + b.width/2), y: Math.round(b.top + b.height/2) }; })()`);
    await drag(vpBox.x + 60, vpBox.y, vpBox.x - 60, vpBox.y);
    await sleep(700);
    const afterT = await page.eval(`(() => { const w = ${ROOT}.querySelector('.mm-world'); return w ? getComputedStyle(w).transform : null; })()`);
    ok(beforeT !== afterT, "★ 横向拖动真的平移了画布", `${beforeT} → ${afterT}`);

    /* ---------------------------------------------------------- H 控制台 */
    console.log("\n【H 控制台错误】");
    const errs = await page.consoleErrors();
    const mine = errs.filter((e) => /mindmap/i.test(JSON.stringify(e)));
    ok(mine.length === 0, "★ 本插件在移动端没有未捕获错误", mine.length ? JSON.stringify(mine).slice(0, 200) : "无");
    if (errs.length !== mine.length) {
        console.log(`  （页面其它错误 ${errs.length - mine.length} 条，与本插件无关）`);
    }

    console.log("\n=== 总计 ===");
    const failed = results.filter((r) => !r.pass);
    console.log(`  ${results.length - failed.length} 通过 / ${failed.length} 失败`);
    if (failed.length) {
        for (const f of failed) console.log(`  ✗ ${f.label}  ${f.diag}`);
        process.exitCode = 1;
    }
} catch (e) {
    console.log(`\n中断：${e.message}`);
    if (!results.length) process.exitCode = 1;
} finally {
    await chrome.close();
    await removeDoc(api, doc);
    console.log("已清理临时文档");
}
