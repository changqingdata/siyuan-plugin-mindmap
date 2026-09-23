/**
 * P1-5「诊断面板」的端到端验收。
 *
 * 要验的不是「有个按钮」，而是**这份报告能不能拿来排障**，以及它有没有越过
 * 方案里画的那条线：*只复制到剪贴板，不联网、不上报*。
 *
 * 所以判据分三层：
 *   1. 走真路 —— 点顶栏图标 → 点菜单里的「设置」→ 点那一项的「复制」。
 *      直接 `document.querySelector('.b3-button').click()` 是查不到任何东西的。
 *   2. 内容要对得上当下的真实状态 —— 版本号来自 plugin.json，内核版本来自内核，
 *      节点数来自画面上真实渲染的节点，过滤状态来自真实点过的 chip。
 *      拼死的字符串（比如硬写「3.8.4」）换个内核就假绿了。
 *   3. **不外发**必须是断言，不是注释 —— hook fetch / XHR / sendBeacon，
 *      断言窗口期内没有一条请求带着这份文本、也没有一条出到 127.0.0.1 之外。
 *
 * 用法：node tests/kernel/diag-diagnostics.mjs
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
const PKG = JSON.parse(fs.readFileSync("plugin.json", "utf8"));

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

/* ---------------------------------------------------------------- 建测试文档
 * 刻意整条列表都是任务（`data-subtype="t"`）——
 * 思源的 `.list` 只有**一个** subtype，往无序列表里塞一个 `- [ ] x` 并不会
 * 让它变成任务节点，所以「过滤」这一组根本不会出现。
 * 混合已完成 / 未完成是为了让「只看未完成」真的会**减少**画面上的节点，
 * 否则「过滤生效了」这条断言就是空转。
 */

const md = ["- [x] 甲", "  - [ ] 甲一", "  - [ ] 甲二", "- [ ] 乙", "- [x] 丙", ""].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-诊断面板-${Date.now()}`,
    markdown: md,
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;

const listId = (await kids(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

/* 第二份文档：故意不带导图 —— 「一张图都没有」时报告该怎么写，只能在这个场景里看 */
const emptyRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-诊断面板-空-${Date.now()}`,
    markdown: "这里没有任何导图。\n",
});
if (emptyRes.code !== 0) throw new Error("建空文档失败: " + JSON.stringify(emptyRes));
const emptyDocId = emptyRes.data;

const kernelVersion = (await api("/api/system/version")).data;

console.log(`临时文档 ${docId}`);
console.log(`空文档   ${emptyDocId}`);
console.log(`列表 ${listId}`);
console.log(`plugin.json 版本 ${PKG.version} · 内核版本 ${kernelVersion}\n`);

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

/** 装三样东西：剪贴板捕获、网络记录、以及一个「模拟一条插件警告」的入口 */
const INSTALL_HOOKS = `(() => {
    if (window.__mmHooked) return true;
    window.__mmHooked = true;
    window.__mmClip = null;
    window.__mmNet = [];
    window.__mmBeacon = 0;

    // 1. 剪贴板：拦下写入并留一份原文。
    //    真去读系统剪贴板在无头环境里要额外授权，不稳定；这里要验的是
    //    「插件交出去的文本对不对」，所以拦在写入点最直接。
    try {
        const c = navigator.clipboard;
        if (c && c.writeText) {
            c.writeText = (t) => { window.__mmClip = String(t); return Promise.resolve(); };
        }
    } catch (e) { /* 拿不到就退到 execCommand 分支 */ }
    const origExec = document.execCommand.bind(document);
    document.execCommand = (cmd, ...rest) => {
        if (cmd === 'copy') {
            const ae = document.activeElement;
            if (ae && 'value' in ae && typeof ae.value === 'string') window.__mmClip = ae.value;
        }
        return origExec(cmd, ...rest);
    };

    // 2. 网络：fetch / XHR / sendBeacon 三条外发通道全记下来
    const of = window.fetch;
    window.fetch = function (input, init) {
        try {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            let body = (init && init.body) || '';
            if (typeof body !== 'string') body = '[非字符串 body]';
            window.__mmNet.push({ url: String(url), method: String((init && init.method) || 'GET'), body: String(body).slice(0, 400) });
        } catch (e) {}
        return of.apply(this, arguments);
    };
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
        try { window.__mmNet.push({ url: String(u), method: String(m), body: '' }); } catch (e) {}
        return oo.apply(this, arguments);
    };
    const ob = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
    if (ob) navigator.sendBeacon = function (u, d) { window.__mmBeacon++; return ob(u, d); };
    return true;
})()`;

/** 点顶栏图标 → 菜单里点「设置」→ 等设置面板出来 */
async function openSettings(page) {
    const found = await page.eval(`(() => {
        const el = document.querySelector('.toolbar [id^="plugin_siyuan-plugin-mindmap"]')
            || [...document.querySelectorAll('.toolbar *')].find((e) => (e.getAttribute('title') || '') === '大纲导图');
        if (!el) return { err: 'no topbar icon' };
        el.click();
        return { ok: true, title: el.getAttribute('title') };
    })()`);
    await sleep(800);
    const menu = await page.eval(`(() => {
        const items = [...document.querySelectorAll('.b3-menu .b3-menu__item')].map((x) => (x.textContent || '').trim()).filter(Boolean);
        const it = [...document.querySelectorAll('.b3-menu .b3-menu__item')].find((x) => (x.textContent || '').trim() === '设置');
        if (it) it.click();
        return { items, hit: !!it };
    })()`);
    await sleep(1400);
    return { found, menu };
}

/** 设置面板里「复制诊断信息」那一项的坐标与文案 */
const DIAG_ITEM = `(() => {
    const d = document.querySelector('.b3-dialog--open') || document.querySelector('.b3-dialog');
    if (!d) return { err: 'no dialog' };
    const l = [...d.querySelectorAll('.b3-label')].find((x) => (x.textContent || '').includes('只复制到剪贴板'));
    if (!l) return { err: 'no diag item' };
    const b = l.querySelector('button');
    if (!b) return { err: 'no button' };
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return {
        x: Math.round(r.left + r.width / 2),
        y: Math.round(r.top + r.height / 2),
        title: ((l.querySelector('.config-name') || {}).textContent || '').trim(),
        desc: ((l.querySelector('.b3-label__text') || {}).textContent || '').trim(),
        btn: (b.textContent || '').trim(),
        dialogTitle: ((d.querySelector('.b3-dialog__header') || {}).textContent || '').trim(),
    };
})()`;

async function clickAt(page, pt) {
    if (!pt || pt.err) return pt;
    await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
    await page.mouse("mousePressed", pt.x, pt.y, { clickCount: 1 });
    await page.mouse("mouseReleased", pt.x, pt.y, { clickCount: 1 });
    return pt;
}

const chrome = await launch({ headless: true, port: 9368, width: 1680, height: 1050, dpr: 1 });
try {
    let page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    const logs = [];
    page.on("Runtime.consoleAPICalled", (p) => {
        const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
        if (text.includes("[mindmap]")) logs.push(`[${p.type}] ${text}`);
    });
    await page.send("Runtime.enable");
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图出现" });
    await sleep(1800);

    /* ============================== 0. 先量一遍真实状态 ============================== */
    console.log("【0 真实状态（等下要拿它去核对报告）】");
    const nodesOnCanvas = await page.eval(`document.querySelectorAll('.mm-root .mm-node').length`);
    /* 6 = 5 个列表项 + 1 个虚拟根（`wrapRoot` 在顶层项多于一个时会补一个标题根）。
       报告里的「节点 N」数的是解析出来的节点总数，**包含被过滤藏起来的那些**。 */
    ok(nodesOnCanvas === 6, "画布上 6 个节点 = 5 个列表项 + 1 个虚拟根", String(nodesOnCanvas));

    /* 过滤把节点标成 visibility:hidden，而不是把它们从 DOM 里摘掉 ——
       所以「看得见几个」要按 visibility 数，直接数 .mm-node 会永远是 6。 */
    const VISIBLE = `(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        return [...root.querySelectorAll('.mm-node')].filter((n) => n.style.visibility !== 'hidden').length;
    })()`;
    const visibleBefore = await page.eval(VISIBLE);
    ok(visibleBefore === 6, "没过滤时 6 个都看得见", String(visibleBefore));

    /* 点一下「未完成」chip —— 报告里的「过滤」必须反映它 */
    const chipPt = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        const b = [...root.querySelectorAll('.mm-filters button')].find((x) => (x.textContent || '').trim() === '未完成');
        if (!b) return { err: 'no chip' };
        const r = b.getBoundingClientRect();
        if (r.width < 1) return { err: 'chip 不可见（整组被收起了）' };
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    ok(!chipPt.err, "工具条上有「未完成」过滤 chip（图里有待办才会出现）", chipPt.err ?? "");
    await clickAt(page, chipPt);
    await sleep(900);
    const filtered = await page.eval(VISIBLE);
    ok(filtered < visibleBefore, "过滤生效了（画面上的节点少了）", `${filtered} < ${visibleBefore}`);
    const hiddenTexts = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        return [...root.querySelectorAll('.mm-node')]
            .filter((n) => n.style.visibility === 'hidden')
            .map((n) => ((n.querySelector('.mm-txt') || {}).textContent || '').trim());
    })()`);
    /* 甲 自己也已完成，但甲一 / 甲二 还没做完 —— 命中的是那两个，
       甲 作为它们的祖先必须留下，否则树就断了（这条规则写在 applyFilter 的注释里）。 */
    ok(filtered === 5, "★ 只剩 5 个：根 + 甲（祖先）+ 甲一 + 甲二 + 乙", String(filtered));
    ok(hiddenTexts.length === 1 && hiddenTexts[0] === "丙", "★ 被收走的是「丙」：已完成，且没有未完成的子孙", hiddenTexts.join(" / "));
    ok(!hiddenTexts.includes("甲"), "★ 甲虽然也已完成，但它是两个未完成子任务的祖先，必须留下");

    /* 装 hook —— 必须在点「复制」之前 */
    await page.eval(INSTALL_HOOKS);
    await page.eval(`window.__mmNet.length = 0`);

    /* ============================== A. 走真路打开设置面板 ============================== */
    console.log("\n【A 顶栏图标 → 菜单 → 设置】");
    const op = await openSettings(page);
    ok(!op.found.err, "顶栏上有插件图标（P2-5 的入口之一）", op.found.err ?? op.found.title);
    ok(op.menu.items.some((t) => t.includes("设置")), "菜单里有「设置」", op.menu.items.slice(-2).join(" | "));
    ok(op.menu.hit === true, "点中了它");

    const item = await page.eval(DIAG_ITEM);
    ok(!item.err, "设置面板里能找到「复制诊断信息」这一项", item.err ?? "");
    ok(item.title === "复制诊断信息", "★ 标题走的是 i18n（P0-2 的接线在这条链上也是通的）", item.title);
    ok(item.desc.includes("不联网"), "描述里写明了不外发", item.desc.slice(0, 28));
    ok(item.btn === "复制", "按钮初始文案是「复制」", item.btn);

    /* ============================== B. 点「复制」 ============================== */
    console.log("\n【B 点「复制」】");
    // 先塞两条日志：一条是插件的（该被收），一条不是（不该被收）
    await page.eval(`console.warn("[mindmap] 验收探针：这是一条模拟警告")`);
    await page.eval(`console.warn("这条来自别的插件，不该出现在诊断里")`);
    await sleep(400);

    await clickAt(page, await page.eval(DIAG_ITEM));
    await sleep(500);

    const after = await page.eval(DIAG_ITEM);
    ok(after.btn === "已复制", "★ 点完按钮变成「已复制」（用户知道点到了）", after.btn);

    const toast = await page.eval(
        `[...document.querySelectorAll('[class*="snackbar"]')].map((x) => (x.textContent || '').trim()).join(' | ')`,
    );
    ok(toast.includes("诊断信息已复制"), "弹了提示", toast.slice(0, 40));

    const text = await page.eval(`window.__mmClip`);
    ok(typeof text === "string" && text.length > 120, "★ 剪贴板里拿到一份文本", `${typeof text === "string" ? text.length : 0} 字符`);

    /* 1.6 秒后按钮该变回去，不然用户第二次会以为已经复制过了 */
    await sleep(1600);
    ok((await page.eval(DIAG_ITEM)).btn === "复制", "按钮自己变回「复制」");

    if (typeof text !== "string") throw new Error("没拿到剪贴板文本，后面的内容断言没法进行");

    /* ============================== C. 内容对不对 ============================== */
    console.log("\n【C 报告内容】");
    ok(text.includes("===== 大纲导图 诊断信息 ====="), "有抬头");
    ok(/时间: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text), "有完整时间戳", (text.match(/时间: .*/) || [""])[0]);
    ok(text.includes(`插件版本: ${PKG.version}`), "★ 版本号来自 plugin.json，不是写死的", `plugin.json = ${PKG.version}`);
    ok(text.includes(`内核版本: ${kernelVersion}`), "★ 内核版本来自内核（/api/system/version）", `内核 = ${kernelVersion}`);
    ok(text.includes("已挂载视图: 1"), "已挂载视图数对得上");
    ok(/撤销栈深度: \d+/.test(text), "有撤销栈深度（「Ctrl+Z 没反应」多半是这里空了）", (text.match(/撤销栈深度: \d+/) || [""])[0]);

    ok(text.includes("--- 配置 ---"), "有配置小节");
    ok(/布局 \S+ · 主题 \S+ · 连线 \S+ · 分支配色 (开|关)/.test(text), "配置快照带上了布局 / 主题 / 连线 / 分支配色", (text.match(/布局 .*分支配色 (开|关)/) || [""])[0]);
    ok(text.includes(`紧凑阈值 `), "带上了紧凑阈值");

    ok(text.includes("--- 视图 ---"), "有视图小节");
    const viewLine = (text.split("\n").find((l) => l.startsWith("行内 ")) || "").trim();
    ok(viewLine.includes(`行内 ${listId}`), "★ 视图行认得出是哪个列表（否则多图时分不清谁是谁）", viewLine.slice(0, 60));
    ok(new RegExp(`节点 ${nodesOnCanvas} · 布局 \\S+ · 主题 \\S+ · 连线 \\S+ · 缩放 \\d+%`).test(viewLine), "★ 节点数 = 画面上真实渲染的节点数", `${nodesOnCanvas}`);
    ok(viewLine.includes("过滤 todo"), "★ 报告里的过滤状态 = 刚点过的 chip（不是默认值）", (viewLine.match(/过滤 \S+/) || [""])[0]);
    ok(/选中 \d+ · 下钻 \d+$/.test(viewLine), "带上了选中数与下钻深度");

    ok(text.includes("--- 最近的警告 / 错误 ---"), "有警告小节");
    ok(text.includes("[mindmap] 验收探针：这是一条模拟警告"), "★ 插件自己的警告被收进来了");
    ok(/\d{2}:\d{2}:\d{2} \[warn\] \[mindmap\] 验收探针/.test(text), "★ 带上时间与级别", (text.split("\n").find((l) => l.includes("验收探针")) || "").trim());
    ok(!text.includes("这条来自别的插件"), "★ 不带 [mindmap] 的日志没被收进来（不然有用的会被挤掉）");
    ok(text.includes("插件不会自动发送任何数据"), "末尾写明了不外发");

    /* ============================== D. 不外发（真断言） ============================== */
    console.log("\n【D 只复制，不外发】");
    const net = await page.eval(`window.__mmNet`);
    const beacon = await page.eval(`window.__mmBeacon`);
    const urls = net.map((r) => r.url);
    console.log(`  窗口期内 ${net.length} 条请求:`);
    for (const r of net) console.log(`    ${r.method} ${r.url}${r.body && r.body !== "" ? `  body=${r.body.slice(0, 60)}` : ""}`);
    ok(beacon === 0, "sendBeacon 一次都没用（最典型的外发通道）", String(beacon));
    ok(
        net.every((r) => /^\/|^http:\/\/127\.0\.0\.1:6806/.test(r.url)),
        "★ 所有请求都出在本地内核，没有一条发到外面",
        urls.filter((u) => !/^\/|^http:\/\/127\.0\.0\.1:6806/.test(u)).join(", ") || "全部本地",
    );
    /* 「按块 ID 查内核」是插件的日常（写块属性、查子块都这样），拿它当外发证据是误判。
       真正要证的是：**这份报告本身**没有被塞进任何请求里。 */
    ok(
        net.every((r) => !r.body.includes("诊断信息") && !r.body.includes("插件版本") && !r.body.includes("内核版本:")),
        "★ 没有任何一条请求带着这份报告（报告本体一个字都没出门）",
        net.filter((r) => /诊断信息|插件版本|内核版本:/.test(r.body)).map((r) => r.url).join(", ") || "",
    );
    ok(
        net.some((r) => r.url.includes("/api/system/version")),
        "唯一的额外请求是读本地内核版本 —— 这正是「内核版本」那一行是真的的证据",
    );

    /* ============================== E. 警告被记了，但没被吞 ============================== */
    console.log("\n【E 记录日志不能吃掉日志】");
    ok(
        logs.some((l) => l.includes("验收探针")),
        "★ 那条警告在控制台里照旧可见（记录只是顺带，没有拦截）",
        logs.length ? `${logs.length} 条 [mindmap] 日志` : "0 条",
    );

    /* ============================== F. 一张图都没有的时候 ============================== */
    console.log("\n【F 换到没有导图的文档再复制：不能崩，也不能瞎编】");
    await page.send("Page.navigate", { url: `http://127.0.0.1:6806/stage/build/desktop/?id=${emptyDocId}` });
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "空文档的编辑器出现" });
    await sleep(2200);
    ok(!(await page.eval(`!!document.querySelector('.mm-root .mm-node')`)), "这份文档里确实一张导图都没有");

    await page.eval(INSTALL_HOOKS);
    await page.eval(`window.__mmNet.length = 0`);
    const op2 = await openSettings(page);
    ok(!op2.found.err && op2.menu.hit === true, "换个文档，顶栏入口照样能打开设置");
    await clickAt(page, await page.eval(DIAG_ITEM));
    await sleep(700);
    const t2 = await page.eval(`window.__mmClip`);
    ok(typeof t2 === "string" && t2.length > 60, "仍然复制出了内容", `${typeof t2 === "string" ? t2.length : 0} 字符`);
    ok(String(t2).includes("已挂载视图: 0"), "★ 视图数变成 0");
    ok(String(t2).includes("（当前没有挂载任何导图）"), "★ 明说没有导图，而不是留一片空白");
    ok(!String(t2).includes("行内 "), "没有图时不会编出视图行");
    const net2 = await page.eval(`window.__mmNet`);
    ok(net2.every((r) => /^\/|^http:\/\/127\.0\.0\.1:6806/.test(r.url)), "这一轮同样没有往外发", `${net2.length} 条，全部本地`);

    if (logs.length) console.log("\n控制台:", logs.join("\n            "));
    await page.screenshot(`${OUT}/diag-diagnostics.png`);

    console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
    if (fail === 0) console.log("✓ 诊断面板成立：走真路可达，内容对得上真实状态，且一条请求都没往外发");
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    await removeDoc(api, emptyDocId);
    console.log("已清理临时文档");
}

process.exit(fail === 0 ? 0 : 1);
