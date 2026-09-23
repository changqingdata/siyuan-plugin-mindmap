/**
 * 真机验收：连真实思源内核 + 真实 Web 前端，点真实按钮。
 *
 * 为什么要有这一层：
 * 前面的 visual-check 是「把插件塞进一个仿造页面」，能验样式和键盘分发，
 * 但验不了「思源自己的弹层、焦点陷阱、块操作响应」这些宿主行为 ——
 * 而用户报的三个问题恰好都长在宿主边界上。所以这里直接开一个无头 Chrome
 * 访问 http://127.0.0.1:6806 的 Web 前端，用 CDP 派发真实鼠标/键盘事件。
 *
 * 用法：node tests/live.mjs
 *   SIYUAN_TOKEN  内核 token（默认读 conf/conf.json）
 *   SIYUAN_KERNEL 内核地址，默认 http://127.0.0.1:6806
 *   MM_KEEP=1     跑完不删临时文档，方便自己进思源看现场
 */

import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "./cdp.mjs";
import { removeDoc } from "./kernel/_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const SHOT_DIR = "tests/.build/live";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv"; // A1=收集箱

const MD = [
    "- 终极思考",
    "  - 环境选择",
    "    - 132",
    "      - 1231",
    "  - 123",
    "",
].join("\n");

/* ------------------------------------------------------------------ 内核 API */

function readToken() {
    if (process.env.SIYUAN_TOKEN) return process.env.SIYUAN_TOKEN;
    const conf = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8"));
    return conf.api?.token ?? "";
}

const TOKEN = readToken();

async function api(p, payload) {
    const res = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    const json = await res.json();
    if (json.code !== 0) throw new Error(`${p} 失败: ${json.code} ${json.msg}`);
    return json.data;
}

/** 取块的直接子块（/api/query/sql 在这台机器上返回空，只能走块树接口） */
async function children(id) {
    try {
        return await api("/api/block/getChildBlocks", { id });
    } catch {
        return [];
    }
}

/** getChildBlocks 只给直接子块，要自己递归 */
async function subtree(id, ind = 0, out = []) {
    for (const k of await children(id)) {
        out.push(`${"  ".repeat(ind)}${k.type}/${k.subType ?? "-"} …${k.id.slice(-7)} ${JSON.stringify((k.content || "").slice(0, 22))}`);
        await subtree(k.id, ind + 1, out);
    }
    return out;
}

/** 内核里列表项的总数 */
async function countItems(id) {
    let n = 0;
    for (const k of await children(id)) {
        if (k.type === "i") n += 1;
        n += await countItems(k.id);
    }
    return n;
}

/**
 * 内核里每个列表项「自己的文字」，带层级 —— 形如 "2:132"。
 * 只取列表项直接的那个段落，不带子树 —— 否则父节点的 content 会把子孙文字也带上。
 */
async function itemShape(id, depth = 0, out = []) {
    for (const k of await children(id)) {
        if (k.type === "i") {
            const own = (await children(k.id)).find((c) => c.type === "p");
            if (own) out.push(`${depth}:${(own.content || "").trim()}`);
            await itemShape(k.id, depth + 1, out);
        } else {
            await itemShape(k.id, depth, out);
        }
    }
    return out.sort();
}

/* ------------------------------------------------------------------ 断言记账 */

const results = [];
function check(name, ok, detail = "") {
    results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
    console.log(`${ok ? "  ✔" : "  ✘"} ${name}${detail ? `  — ${detail}` : ""}`);
    return ok;
}
function section(title) {
    console.log(`\n== ${title}`);
}

/* ------------------------------------------------------------------ 建/删临时文档 */

async function createDoc() {
    const docId = await api("/api/filetree/createDocWithMd", {
        notebook: NOTEBOOK,
        path: `/临时-导图真机验收-${Date.now()}`,
        markdown: MD,
    });
    const kids = await children(docId);
    const list = kids.find((k) => k.type === "l");
    if (!list) throw new Error(`文档里没找到列表块，子块：${JSON.stringify(kids.map((k) => k.type))}`);
    await api("/api/attr/setBlockAttrs", { id: list.id, attrs: { "custom-mindmap": "mind" } });
    return { docId, listId: list.id };
}

/* 清理临时文档统一走 `_doc-cleanup.mjs` 的两步法（getPathByID → removeDoc）。
   这里原先有一份本地实现，用 `getBlockInfo` 取 `info.box / info.path` ——
   注意它取的是**顶层** `info.box`，而别的脚本取的是 `info.data.box`，
   两种写法并存本身就说明这个字段路径不牢靠（不检查 code、出错还被 catch 吞成一句 warn）。
   助手只此一份，改一处就够。 */

/* ------------------------------------------------------------------ 页面探针注入 */

/** 在页面里装一套「抓现场」的工具：错误、toast、块操作请求 */
const PROBE_BOOT = `
(() => {
    if (window.__mmProbe) return "already";
    const P = { errors: [], toasts: [], requests: [], renames: [] };
    window.__mmProbe = P;

    window.addEventListener("error", (e) => P.errors.push({ msg: String(e.message), stack: String(e.error?.stack ?? "").slice(0, 500) }));
    window.addEventListener("unhandledrejection", (e) => P.errors.push({ msg: "reject: " + String(e.reason), stack: String(e.reason?.stack ?? "").slice(0, 500) }));

    // 记录所有 keydown，判断按键到底有没有送到页面
    P.keys = [];
    document.addEventListener(
        "keydown",
        (e) => {
            const rec = {
                key: e.key,
                target: (e.target?.className || e.target?.tagName || "?") + "",
                prevented: e.defaultPrevented,
            };
            P.keys.push(rec);
            setTimeout(() => {
                rec.prevented = e.defaultPrevented;
                rec.stopped = true;
            }, 0);
        },
        true,
    );

    // 盯着导图的节点层，看它到底有没有被重建过
    P.renders = [];
    const watchNodes = () => {
        const nodes = document.querySelector(".mm-nodes");
        if (!nodes) return window.setTimeout(watchNodes, 200);
        new MutationObserver((recs) => {
            let removed = 0;
            let added = 0;
            for (const r of recs) {
                removed += r.removedNodes.length;
                added += r.addedNodes.length;
            }
            if (removed || added) P.renders.push({ at: Date.now(), removed, added, nodes: nodes.children.length });
        }).observe(nodes, { childList: true });
    };
    watchNodes();

    // 思源的 showMessage 会往 #message 里塞 .b3-message 节点；抓它的文字
    const grab = (node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.classList.contains("b3-message") || node.querySelector?.(".b3-message")) {
            const text = (node.textContent || "").trim();
            if (text) P.toasts.push({ text, at: Date.now() });
        }
    };
    const mo = new MutationObserver((recs) => {
        for (const r of recs) for (const n of r.addedNodes) grab(n);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // 记录所有 /api/block/* 调用，方便判断「到底发出去没有 / 内核怎么回的」
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : input?.url ?? "";
        if (url.includes("/api/block/") || url.includes("/api/attr/")) {
            const rec = { url: url.replace(/^.*\\/api\\//, "api/"), body: init?.body ?? null, at: Date.now() };
            P.requests.push(rec);
            return origFetch.apply(this, arguments).then((res) => {
                const clone = res.clone();
                clone.text().then((t) => { rec.res = t.slice(0, 600); }).catch(() => {});
                return res;
            });
        }
        return origFetch.apply(this, arguments);
    };

    return "ok";
})()
`;

/* ------------------------------------------------------------------ 主流程 */

const chrome = await launch({ headless: true, port: 9334, width: 1600, height: 1000, dpr: 1 });
let docId = "";
let page;

try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    section("准备");
    const doc = await createDoc();
    docId = doc.docId;
    console.log("  临时文档:", docId, " 列表块:", doc.listId);

    page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.eval(PROBE_BOOT);

    // 等思源把编辑器渲染出来（首屏要加载插件，给足时间）
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "protyle 就绪" });
    console.log("  protyle 就绪");

    // 等导图挂载
    const mounted = await page
        .waitFor("!!document.querySelector('.mm-root')", { timeout: 30000, label: "导图挂载" })
        .then(() => true)
        .catch(() => false);

    check("插件在真实思源里挂载了导图", mounted);
    if (!mounted) {
        const diag = await page.eval(`JSON.stringify({
            hasSiyuan: !!window.siyuan,
            plugins: (window.siyuan?.plugins || []).map(p => p.name),
            listAttrs: (() => { const l = document.querySelector('.protyle-wysiwyg .list'); return l ? l.getAttribute('custom-mindmap') : null })(),
            errs: window.__mmProbe.errors,
        })`);
        console.log("  诊断:", diag);
        throw new Error("导图没挂载，后续探针无意义");
    }

    const nodeCount = (scope = ".mm-root:not(.mm-root--dialog)") =>
        page.eval(`document.querySelectorAll(${JSON.stringify(scope)} + " .mm-node").length`);
    const nodeTexts = () =>
        page.eval(
            `Array.from(document.querySelectorAll('.mm-root:not(.mm-root--dialog) .mm-node .mm-txt')).map(e => e.textContent.trim())`,
        );
    /** 某个视图里当前选中的节点文字（键盘导航探针用） */
    const selectedText = (scope) =>
        page.eval(
            `(() => { const s = document.querySelector(${JSON.stringify(scope)} + " .mm-node.mm-sel"); return s ? s.querySelector('.mm-txt')?.textContent?.trim() : null })()`,
        );
    /** 页面里所有可见的提示条文字（思源的消息 / 我们自己塞的） */
    const toastText = () =>
        page.eval(`(() => {
            const out = [];
            for (const el of document.querySelectorAll('.b3-message, .b3-snackbar, [class*="message"]')) {
                const t = (el.textContent || '').trim();
                if (t) out.push(t);
            }
            return Array.from(new Set(out));
        })()`);
    /**
     * 某个视图里渲染出来的「层级 + 文字」，形如 ["0:终极思考","1:环境选择","2:132"]。
     *
     * 渲染器给每个节点打了 mm-d{深度} 类，深度是布局算出来的，
     * 正好可以拿来和内核的嵌套层级对账。
     */
    const viewShape = (scope = ".mm-root--dialog") =>
        page.eval(`Array.from(document.querySelectorAll(${JSON.stringify(scope)} + " .mm-node")).map(el => {
            const d = (String(el.className).match(/mm-d(\\d+)/) || [])[1] || '?';
            const zw = /[\\u200B-\\u200D\\u2060\\uFEFF]/g;
            const t = ((el.querySelector('.mm-txt') || {}).textContent || '').replace(zw, '').trim();
            return d + ':' + t;
        }).sort()`);
    /**
     * 从源列表 DOM 还原缩进结构（每项只取自己的段落文字，按层级缩进）。
     *
     * 有了它就能把三方对账分清：
     *   内核块树 / 源列表 DOM / 导图视图
     * 「内核改了但 DOM 没跟上」和「DOM 对了但视图没重渲染」是两种完全不同的 bug，
     * 只看最终画面分不出来。
     */
    const sourceTree = (scope = ".mm-root:not(.mm-root--dialog)") =>
        page.eval(`(() => {
            const root = document.querySelector(${JSON.stringify(scope)});
            const list = root && root.parentElement;
            if (!list || !list.classList.contains('list')) return null;
            const zw = /[\\u200B-\\u200D\\u2060\\uFEFF]/g;
            const walk = (l, ind) => {
                const out = [];
                for (const li of l.children) {
                    if (!li.classList || !li.classList.contains('li')) continue;
                    const own = Array.from(li.children).find(c => c.classList.contains('p'));
                    out.push('  '.repeat(ind) + ((own && own.textContent) || '').replace(zw, '').trim());
                    const sub = Array.from(li.children).find(c => c.classList.contains('list'));
                    if (sub) out.push(...walk(sub, ind + 1));
                }
                return out;
            };
            return walk(list, 0);
        })()`);

    /**
     * 结构操作之后，视图渲染出的节点必须与内核里的列表项逐一对应 ——
     * 文字和层级都要对得上。
     *
     * 这是问题 1 那类 bug 的通用检出器：内核已经改了、界面没跟上。
     * 只比节点数量会漏（删一个又加一个，数量刚好对得上）；
     * 只比文字集合也会漏（节点都在，但挂错了父节点 —— 实测踩过：
     * Shift+Tab 之后 132 该提升到「终极思考」下面，视图里却仍挂在「环境选择」下面）。
     * 所以必须连层级一起比。
     */
    const assertViewSync = async (label) => {
        const kernel = await itemShape(doc.listId);
        const view = (await viewShape()) ?? [];
        return check(
            label,
            JSON.stringify(kernel) === JSON.stringify(view),
            `内核 ${JSON.stringify(kernel)} vs 视图 ${JSON.stringify(view)}`,
        );
    };

    console.log("  节点数:", await nodeCount(), JSON.stringify(await nodeTexts()));

    /* ============================== 键盘通路：行内 vs 全屏 */

    section("键盘通路 — 按键有没有真的进到导图");

    // 根节点没有兄弟，用 ↓ 探不出东西；→ 从根走到第一个子节点，变化明确
    await page.click(".mm-root:not(.mm-root--dialog) .mm-node");
    await sleep(300);
    const actInline = await page.eval(`(() => {
        const a = document.activeElement;
        return a ? (a.className || a.tagName) + '|tabindex=' + a.getAttribute('tabindex') : 'none';
    })()`);
    console.log("  点击节点后 activeElement =", actInline);
    check(
        "行内：点击节点后焦点留在导图上",
        String(actInline).startsWith("mm-root"),
        `实际 ${actInline}`,
    );

    const selInline0 = await selectedText(".mm-root:not(.mm-root--dialog)");
    await page.press("ArrowRight");
    await sleep(250);
    const selInline1 = await selectedText(".mm-root:not(.mm-root--dialog)");
    console.log(`  行内：选中 ${JSON.stringify(selInline0)} → 按 → 后 ${JSON.stringify(selInline1)}`);
    check("行内：方向键能移动选中", !!selInline1 && selInline1 !== selInline0, `${selInline0} → ${selInline1}`);

    const keys = await page.eval("window.__mmProbe.keys");
    console.log("  捕获到的 keydown:", JSON.stringify(keys));

    /* ============================== 问题 1：插入子节点报「操作未生效」 */

    section("问题 1 — 插入子节点是否还报「操作未生效，请重试」");

    const before1 = await nodeCount();
    const before1Texts = await nodeTexts();

    // 悬停根节点露出 .mm-acts，再点「+」
    const rootBox = await page.center(".mm-root .mm-node");
    await page.moveMouse(rootBox.x, rootBox.y);
    await sleep(250);

    // 确认要点的是哪个节点的「+」
    const targetNode = await page.eval(`(() => {
        const n = document.querySelector('.mm-root .mm-node');
        return { text: n?.querySelector('.mm-txt')?.textContent?.trim(), acts: !!n?.querySelector('.mm-acts') };
    })()`);
    console.log("  悬停的节点:", JSON.stringify(targetNode));

    await page.click('.mm-root .mm-node .mm-acts button[data-mm-tip="插入子节点"]');
    await sleep(700);
    await page.screenshot(`${SHOT_DIR}/after-insert.png`);
    await sleep(1500);

    const toasts = await toastText();
    const probeToasts = await page.eval("window.__mmProbe.toasts.map(t => t.text)");
    const requests = await page.eval(
        "window.__mmProbe.requests.filter(r => r.url.includes('insertBlock')).map(r => ({ body: r.body, res: r.res }))",
    );
    const after1 = await nodeCount();
    const after1Texts = await nodeTexts();

    console.log("  页面上的提示条:", JSON.stringify(toasts));
    console.log("  MutationObserver 抓到的:", JSON.stringify(probeToasts));
    console.log("  insertBlock 请求:", JSON.stringify(requests).slice(0, 700));
    console.log(`  节点 ${before1} → ${after1}`);
    console.log(`  节点文字 ${JSON.stringify(before1Texts)} → ${JSON.stringify(after1Texts)}`);

    // 再等一会儿，排除「重渲染比 1.5s 还慢」的可能
    await sleep(2500);
    const after1b = await nodeCount();
    console.log(`  再等 2.5s 后节点数: ${after1b}`);

    // 源 DOM 里到底有没有新列表项（Protyle 收到内核事务后会自己更新 DOM）
    const srcDom = await page.eval(`(() => {
        const list = document.querySelector('.protyle-wysiwyg .list[custom-mindmap]');
        if (!list) return null;
        const outline = (el, ind) => {
            let out = [];
            for (const c of el.children) {
                // 导图自己挂在源列表里，别把它算进「源 DOM 结构」
                if (c.classList.contains("mm-root")) continue;
                out.push('  '.repeat(ind) + c.tagName.toLowerCase() + '.' + (c.className || '-') +
                    ' id=…' + String(c.dataset.nodeId || '').slice(-6) +
                    ' type=' + (c.dataset.type || '-') +
                    ' text=' + JSON.stringify((c.textContent || '').trim().slice(0, 18)));
                if (ind < 4) out = out.concat(outline(c, ind + 1));
            }
            return out;
        };
        return {
            outline: outline(list, 0),
            rootInList: !!list.querySelector(':scope > .mm-root'),
        };
    })()`);
    console.log("  源 DOM 结构:\n" + (srcDom?.outline ?? []).map((l) => "    " + l).join("\n"));
    console.log("  .mm-root 是否还在源列表里:", srcDom?.rootInList);

    // 内核侧：递归 dump 整棵树
    const tree = await subtree(doc.listId);
    console.log("  内核块树:\n" + tree.map((l) => "    " + l).join("\n"));
    const items = await countItems(doc.listId);

    const badToast = [...toasts, ...probeToasts].some((t) => t.includes("操作未生效") || t.includes("重试"));
    check("没有弹出「操作未生效」", !badToast, badToast ? `实际: ${JSON.stringify([...toasts, ...probeToasts])}` : "");
    check("插入子节点后导图节点数增加", after1 > before1, `${before1} → ${after1}（再等 2.5s 后 ${after1b}），文字 ${JSON.stringify(after1Texts)}`);
    check(
        "insertBlock 返回 code 0",
        requests.length > 0 && /"code"\s*:\s*0/.test(requests[0].res ?? ""),
        (requests[0]?.res ?? "无请求").slice(0, 120),
    );
    check("内核侧确实多了列表项", items > 5, `内核列表项 ${items}`);
    // 行内视图也要逐一对应（文字 + 层级），不能只是「数量变了」
    {
        const kernel = await itemShape(doc.listId);
        const view = (await viewShape(".mm-root:not(.mm-root--dialog)")) ?? [];
        check(
            "行内：插入后视图与内核一致",
            JSON.stringify(kernel) === JSON.stringify(view),
            `内核 ${JSON.stringify(kernel)} vs 视图 ${JSON.stringify(view)}`,
        );
    }

    /* ============================== 问题 2：放大后是否模糊 */

    section("问题 2 — 放大后的清晰度");

    // 走真实交互：连点缩放条上的「+」（每次 ×1.2），点到 ≈400%
    const zoomLabelBefore = await page.eval("document.querySelector('.mm-zoom-label')?.textContent");
    for (let i = 0; i < 8; i++) {
        await page.click('.mm-zoombar button[data-mm-tip="放大"]');
        await sleep(90);
    }
    await sleep(500);
    console.log(`  缩放 ${zoomLabelBefore} → ${await page.eval("document.querySelector('.mm-zoom-label')?.textContent")}`);

    const geom = await page.eval(`(() => {
        const world = document.querySelector('.mm-root .mm-world');
        const node = document.querySelector('.mm-root .mm-node');
        const txt = node?.querySelector('.mm-txt');
        if (!world || !node) return null;
        const wr = world.getBoundingClientRect();
        const nr = node.getBoundingClientRect();
        const s = getComputedStyle(world);
        const ts = txt ? getComputedStyle(txt) : null;
        return {
            zoom: s.zoom, transform: s.transform, willChange: s.willChange, filter: s.filter,
            worldW: Math.round(wr.width), nodeW: Math.round(nr.width),
            fontSize: ts ? ts.fontSize : null,
            txtH: txt ? Math.round(txt.getBoundingClientRect().height) : null,
            zoomLabel: document.querySelector('.mm-zoom-label')?.textContent,
        };
    })()`);
    console.log("  几何:", JSON.stringify(geom));

    await page.screenshot(`${SHOT_DIR}/zoom-400.png`);
    console.log(`  截图 -> ${SHOT_DIR}/zoom-400.png`);

    /* --- 对照实验：同一个页面、同一个缩放比，zoom vs 旧的 transform:scale ---
       两者把 world 原点放在同一屏幕位置（translate 在 zoom 下被自动放大，
       正好抵消 updateTransform 里的除以 k），所以直接换样式就能逐像素对比。 */
    const a = await page.eval(`(() => {
        const w = document.querySelector('.mm-root .mm-world');
        const s = getComputedStyle(w);
        return { zoom: s.zoom, transform: s.transform };
    })()`);
    console.log("  当前 world 样式:", JSON.stringify(a));

    await page.eval(`(() => {
        const w = document.querySelector('.mm-root .mm-world');
        // zoom 模式下 updateTransform 写的是 translate(tx/k, ty/k)，
        // 而 zoom 会把这段位移再放大 k 倍，屏幕上的实际位移是 (tx, ty)。
        // 换成 transform:scale 时位移不再被放大，所以要自己乘回 k。
        const k = parseFloat(w.style.zoom || '1');
        const m = new DOMMatrix(getComputedStyle(w).transform);
        w.dataset.ab = JSON.stringify({ zoom: w.style.zoom, transform: w.style.transform });
        w.style.zoom = '1';
        w.style.willChange = 'transform';
        w.style.transform = 'translate(' + m.m41 * k + 'px,' + m.m42 * k + 'px) scale(' + k + ')';
        return true;
    })()`);
    await sleep(700);
    await page.screenshot(`${SHOT_DIR}/ab-transform.png`);
    console.log(`  对照截图（transform:scale）-> ${SHOT_DIR}/ab-transform.png`);

    // 换回来
    await page.eval(`(() => {
        const w = document.querySelector('.mm-root .mm-world');
        const prev = JSON.parse(w.dataset.ab || '{}');
        w.style.zoom = prev.zoom || '1';
        w.style.transform = prev.transform || '';
        w.style.willChange = '';
        delete w.dataset.ab;
        return true;
    })()`);
    await sleep(500);
    await page.screenshot(`${SHOT_DIR}/ab-zoom.png`);
    console.log(`  对照截图（zoom）-> ${SHOT_DIR}/ab-zoom.png`);


    // 再抓一张只含根节点附近的高倍图，方便肉眼判断边缘是否发虚
    await page.eval(`(() => {
        const n = document.querySelector('.mm-root .mm-node');
        const r = n.getBoundingClientRect();
        window.scrollTo(0, window.scrollY + r.top - 80);
        return true;
    })()`);
    await sleep(300);
    await page.screenshot(`${SHOT_DIR}/zoom-400-node.png`);

    /* ============================== 问题 3：全屏（弹层）里能不能编辑 */

    section("问题 3 — 全屏模式下是否还能编辑");

    // 先回到 100%，避免缩放干扰命中测试
    await page.click(".mm-zoom-label");
    await sleep(300);

    await page.click('.mm-root .mm-icon[data-mm-tip="全屏查看"]');
    const dialogOk = await page
        .waitFor("!!document.querySelector('.b3-dialog--open .mm-root--dialog')", { timeout: 8000, label: "全屏弹层" })
        .then(() => true)
        .catch(() => false);
    check("点「全屏查看」能打开弹层", dialogOk);

    if (dialogOk) {
        await sleep(600);

        // (a) 双击进编辑态
        const dlgNode = ".b3-dialog--open .mm-root--dialog .mm-node";
        await page.dblclick(dlgNode);
        await sleep(400);
        const editing = await page.eval(`(() => {
            const t = document.querySelector('.b3-dialog--open .mm-root--dialog .mm-txt[contenteditable="true"]');
            return t ? { ok: true, focused: document.activeElement === t, sel: String(window.getSelection()) } : { ok: false };
        })()`);
        console.log("  双击后编辑态:", JSON.stringify(editing));
        check("全屏里双击能进入编辑态", editing.ok, JSON.stringify(editing));

        // (b) 编辑态里能不能真的敲进字
        let typed = null;
        if (editing.ok) {
            await page.press("End");
            await page.type("X");
            await sleep(200);
            typed = await page.eval(
                `document.querySelector('.b3-dialog--open .mm-root--dialog .mm-txt[contenteditable="true"]')?.textContent`,
            );
            console.log("  敲字后文本:", JSON.stringify(typed));
            check("全屏编辑态里能敲进字符", typeof typed === "string" && typed.includes("X"), JSON.stringify(typed));
            await page.press("Escape"); // 放弃，别污染原文档
            await sleep(200);
        }

        // (c) 键盘结构操作：Tab 加子节点（这正是思源 Dialog 的焦点陷阱最爱吃掉的键）
        await page.click(dlgNode);
        await sleep(200);
        const focusNow = await page.eval(`(() => {
            const a = document.activeElement;
            return a ? (a.className || a.tagName) + '|tabindex=' + a.getAttribute('tabindex') : 'none';
        })()`);
        console.log("  点击节点后焦点:", focusNow);

        // 先用方向键探键盘通路（不依赖内核 API）
        const dlgSel0 = await selectedText(".mm-root--dialog");
        await page.press("ArrowRight");
        await sleep(250);
        const dlgSel1 = await selectedText(".mm-root--dialog");
        console.log(`  全屏：选中 ${JSON.stringify(dlgSel0)} → 按 → 后 ${JSON.stringify(dlgSel1)}`);
        check("全屏：方向键能移动选中", !!dlgSel1 && dlgSel1 !== dlgSel0, `${dlgSel0} → ${dlgSel1}`);

        const focusAfterArrow = await page.eval(`(() => {
            const a = document.activeElement;
            return a ? (a.className || a.tagName) : 'none';
        })()`);
        console.log("  全屏：按 ↓ 后焦点 =", focusAfterArrow);

        const beforeTab = await nodeCount();
        await page.press("Tab");
        await sleep(1500);
        const afterTab = await nodeCount();
        const focusAfterTab = await page.eval(`(() => {
            const a = document.activeElement;
            return a ? (a.className || a.tagName) : 'none';
        })()`);
        const tabToast = await toastText();
        console.log(`  Tab 前后节点数 ${beforeTab} → ${afterTab}，焦点落在 ${focusAfterTab}`);
        console.log("  Tab 之后页面提示:", JSON.stringify(tabToast));
        check("全屏里按 Tab 能加子节点", afterTab > beforeTab, `${beforeTab} → ${afterTab}，焦点=${focusAfterTab}`);
        await assertViewSync("全屏：Tab 之后视图与内核一致");

        // (d) Shift+Tab 降级 —— 这是思源 Dialog 焦点陷阱唯一会真正吃掉的键：
        //     焦点在 .mm-root（= 弹层里第一个可聚焦元素）时按 Shift+Tab，
        //     trapFocus 必然命中 activeElement === r[0]，preventDefault + stopPropagation。
        const beforeOutdent = (await subtree(doc.listId)).join("\n");
        await page.click(".b3-dialog--open .mm-root--dialog .mm-node");
        await sleep(200);
        await page.press("ArrowRight"); // → 环境选择
        await sleep(250);
        await page.press("ArrowRight"); // → 132
        await sleep(250);
        const outdentTarget = await selectedText(".mm-root--dialog");
        await page.press("Tab", { shift: true });
        await sleep(1800);
        const afterOutdent = (await subtree(doc.listId)).join("\n");
        console.log(`  Shift+Tab 目标节点: ${JSON.stringify(outdentTarget)}`);
        console.log("  Shift+Tab 后内核块树:\n" + (await subtree(doc.listId)).map((l) => "    " + l).join("\n"));
        check(
            "全屏里 Shift+Tab 能降级",
            afterOutdent !== beforeOutdent,
            `选中 ${outdentTarget}，内核结构${afterOutdent !== beforeOutdent ? "已变" : "没变"}`,
        );
        await assertViewSync("全屏：Shift+Tab 之后视图与内核一致");
        console.log("  Shift+Tab 后源列表 DOM:\n" + ((await sourceTree()) ?? []).map((l) => "    " + l).join("\n"));
        console.log("  Shift+Tab 后源列表 DOM:\n" + ((await sourceTree()) ?? []).map((l) => "    " + l).join("\n"));

        // (e) 弹层里的几何：有没有被 .b3-dialog__content 的 padding / word-break 搞坏
        const dlgGeom = await page.eval(`(() => {
            const body = document.querySelector('.b3-dialog__body');
            const content = document.querySelector('.b3-dialog__content');
            const root = document.querySelector('.b3-dialog--open .mm-root--dialog');
            const cs = content ? getComputedStyle(content) : null;
            const bs = body ? getComputedStyle(body) : null;
            const rr = root?.getBoundingClientRect();
            return {
                contentPadding: cs?.padding, contentWordBreak: cs?.wordBreak,
                bodyOverflow: bs?.overflow, bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : null,
                rootW: rr ? Math.round(rr.width) : null, rootH: rr ? Math.round(rr.height) : null,
                containerTransform: getComputedStyle(document.querySelector('.b3-dialog__container')).transform,
                scrim: !!document.querySelector('.b3-dialog__scrim'),
            };
        })()`);
        console.log("  弹层几何:", JSON.stringify(dlgGeom));

        await page.screenshot(`${SHOT_DIR}/fullscreen.png`);
        console.log(`  截图 -> ${SHOT_DIR}/fullscreen.png`);

        // 关掉弹层（.b3-dialog__close 是个 svg，没有 .click()）
        await page.eval(`(() => {
            const c = document.querySelector('.b3-dialog__close');
            if (c) c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return !!c;
        })()`);
        await sleep(600);
    }

    /* ============================== 回归：写回能否被 Ctrl+Z 撤销 */

    section("回归 — 导图写回能否被 Ctrl+Z 撤销");

    // 插件对 Ctrl+Z 是「放行」的（renderer 的白名单里明确 return，交给思源自己的 undo 栈），
    // 但「内核 API 写出来的事务会不会进思源的撤销栈」是另一回事，只能实测。
    // 这条比什么都重要：撤销不了就意味着一次误删就是不可逆的数据丢失。
    const clickNodeText = async (text) => {
        const id = await page.eval(`(() => {
            const zw = /[\\u200B-\\u200D\\u2060\\uFEFF]/g;
            const hit = Array.from(document.querySelectorAll('.mm-root:not(.mm-root--dialog) .mm-node'))
                .find(n => ((n.querySelector('.mm-txt') || {}).textContent || '').replace(zw, '').trim() === ${JSON.stringify(text)});
            // ⚠️ 是 dataset.mmId（属性 data-mm-id），不是 dataset.nodeId ——
            //    导图节点**不能**带 data-node-id（会和真大纲块撞车，
            //    见 src/core/renderer.ts 里那段长注释）。
            //    原先读错了，返回 undefined，下一行的选择器就变成
            //    [data-mm-id="undefined"]，报「找不到元素」。
            //    （本段在 page.eval 的模板字符串里，注释里不能出现反引号。）
            return hit ? hit.dataset.mmId : null;
        })()`);
        if (!id) return null;
        await page.click(`.mm-root:not(.mm-root--dialog) .mm-node[data-mm-id="${id}"]`);
        return id;
    };

    // (a) 加子节点 → Ctrl+Z
    //
    // ⚠️⚠️ 这里**必须先 Esc 退出编辑态**，再按 Ctrl+Z。原因不是「顺手多按一下」：
    //
    //   `Tab` 是「插入子节点 **并进入编辑态**」（插入即改名）。
    //   而编辑态下导图的键盘**整体让位给输入框** —— renderer 的 onKeyDown
    //   首行就是 `if (this.editing) return;`，编辑态里所有按键都被
    //   txt 自己的处理器 `stopPropagation()` 吃掉（它只认 Enter / Esc）。
    //   于是 Ctrl+Z 既没被插件的历史栈接住、也没冒泡给思源，
    //   只会去撤销 contenteditable 里正在输入的文字 —— 这**是设计如此**：
    //   用户在改名字的时候按 Ctrl+Z，期待的当然是撤销刚敲的字，不是撤销整个块操作。
    //
    //   本段原先没有 Esc —— 写它的时候 Tab 还只插入、不进编辑态。
    //   实测（tests/kernel/diag-undo-after-insert.mjs 三组对照）：
    //     编辑态直接 Ctrl+Z → 内核不变、焦点留在 mm-txt       ← 就是那条红
    //     先 Esc 再 Ctrl+Z  → 焦点回到 mm-root、撤销成功
    //   所以这里补一次 Esc，把动作序列对齐到用户真实会做的那一套。
    //
    //   用 Esc 而不是 Enter：Esc 是「放弃改名」，不会多写一条 rename 记录，
    //   Ctrl+Z 撤掉的正好是插入那一步 —— 这正是本条要测的东西。
    const undoAdd0 = await itemShape(doc.listId);
    await clickNodeText("环境选择");
    await sleep(300);
    await page.press("Tab");
    await sleep(1500);
    const undoAdd1 = await itemShape(doc.listId);
    await page.press("Escape"); // 退出编辑态并把焦点还给导图（见上方长注释）
    await sleep(600);
    await page.press("z", { ctrl: true });
    await sleep(1500);
    const undoAdd2 = await itemShape(doc.listId);
    console.log(`  加子节点：${undoAdd0.length} → ${undoAdd1.length} → Ctrl+Z 后 ${undoAdd2.length}`);
    check(
        "Ctrl+Z 能撤销「加子节点」",
        undoAdd1.length > undoAdd0.length && JSON.stringify(undoAdd2) === JSON.stringify(undoAdd0),
        `内核 ${JSON.stringify(undoAdd2)} vs 操作前 ${JSON.stringify(undoAdd0)}`,
    );

    // 撤销之后焦点必须还在导图上，否则第二次 Ctrl+Z 根本没人接。
    //
    // 判据是 `/mm-root/` 而不是「焦点在导图内」：`.mm-txt`（编辑态）也在导图内，
    // 但那时 Ctrl+Z 归 contenteditable，没人接 —— 只有落在 `.mm-root` 上才算数。
    // 这条曾经红过：退出编辑态后焦点掉到布局容器（`fn__flex-column`），
    // 修法是 finish() 在键盘主动退出（Enter / Esc）时 restoreFocus()。
    const focusAfterUndo = await page.eval(`(() => {
        const a = document.activeElement;
        return a ? (a.className || a.tagName) : 'none';
    })()`);
    console.log("  撤销后焦点:", focusAfterUndo);
    check("撤销后焦点仍在导图上", /mm-root/.test(String(focusAfterUndo)), String(focusAfterUndo));

    // (b) 重做：撤销完紧接着 Ctrl+Y，应当回到刚加过的状态
    await page.press("y", { ctrl: true });
    await sleep(1600);
    const redoAdd = await itemShape(doc.listId);
    console.log(`  Ctrl+Y 重做后：${undoAdd2.length} → ${redoAdd.length}`);
    check("Ctrl+Y 能重做「加子节点」", JSON.stringify(redoAdd) === JSON.stringify(undoAdd1), `内核 ${JSON.stringify(redoAdd)}`);

    // 重做之后还要能再撤销 —— 连续操作不能因为焦点丢失而断掉
    await page.press("z", { ctrl: true });
    await sleep(1600);
    const undoAgain = await itemShape(doc.listId);
    check("重做之后还能再撤销", JSON.stringify(undoAgain) === JSON.stringify(undoAdd0), `内核 ${JSON.stringify(undoAgain)}`);

    // (c) 删除节点 → Ctrl+Z。这条更要紧：撤销不了就是不可逆的丢失
    const undoDel0 = await itemShape(doc.listId);
    const delId = await clickNodeText("123");
    await sleep(400);
    // 点没点中很要紧：鼠标事件走的是元素中心坐标，节点重叠 / 被滚动裁掉时
    // 会落到别的节点上，Delete 删的就是另一个了 —— 后面的断言会因此误导。
    const selAfterClick = await selectedText(".mm-root:not(.mm-root--dialog)");
    check("前置：点中的节点确实是「123」", selAfterClick === "123", `选中=${JSON.stringify(selAfterClick)}，点击的块 ${delId}`);
    await page.press("Delete");
    await sleep(1600);
    const undoDel1 = await itemShape(doc.listId);
    console.log(`  删除节点：${undoDel0.length} → ${undoDel1.length}（点了块 ${delId}）`);
    console.log(`  删除前 ${JSON.stringify(undoDel0)}`);
    console.log(`  删除后 ${JSON.stringify(undoDel1)}`);
    check("前置：Delete 确实删掉了节点", undoDel1.length < undoDel0.length, `${undoDel0.length} → ${undoDel1.length}`);

    // 删除会让 Protyle 重建整个 .list，视图得在新元素上重挂 —— 这期间导图不能消失
    await sleep(1600);
    const afterDelete = await page.eval(`(() => {
        const root = document.querySelector('.mm-root');
        const a = document.activeElement;
        return { hasRoot: !!root, nodes: document.querySelectorAll('.mm-node').length, focus: a ? (a.className || a.tagName) : 'none' };
    })()`);
    console.log("  删除 1.6s 后:", JSON.stringify(afterDelete));
    check("删除后导图没有消失", afterDelete.hasRoot && afterDelete.nodes > 0, JSON.stringify(afterDelete));
    check("删除后焦点仍在导图上", /mm-root/.test(String(afterDelete.focus)), String(afterDelete.focus));

    await page.press("z", { ctrl: true });
    // 写回会重建列表 DOM，视图要卸载重挂 —— 中间有个「根元素不在」的瞬时窗口，
    // 立刻读会读到空。等一拍再读，并且明确区分「没接过键」和「元素不在」。
    // （也别写 `?.dataset.x ?? 'no-root'`：元素在、属性没设过时同样返回 undefined，
    //   两种情况会混成一个值。）
    await sleep(300);
    const histSignal = await page.eval(`document.documentElement.dataset.mmHistory ?? 'no-dataset(没接过这个键)'`);
    console.log("  Ctrl+Z 插件是否接住:", histSignal);
    // 插件有没有真的发出写回请求？「没接住」和「接住了但写回失败」是两回事
    const recentReqs = await page.eval(`JSON.stringify((window.__mmProbe?.requests || []).slice(-4).map(r => ({
        url: r.url, at: r.at, body: String(r.body || '').slice(0, 120), res: String(r.res || '').slice(0, 120)
    })))`);
    console.log("  最近的块请求:", recentReqs);
    // 撤销写回之后还有没有别的写操作？内核状态对不上时，先看有没有第二只手
    const afterUndo = await page.eval(`(() => {
        const rs = (window.__mmProbe?.requests || []);
        return JSON.stringify(rs.slice(-12).map(r => r.url + ' @' + r.at), null, 1);
    })()`);
    console.log("  撤销前后的块请求序列:\n" + afterUndo);
    const undoBody = await page.eval(`(() => {
        const rs = (window.__mmProbe?.requests || []).filter(r => r.url.includes('updateBlock'));
        return rs.length ? String(rs[rs.length - 1].body) : '(无)';
    })()`);
    console.log("  撤销写回载荷:\n" + undoBody);
    console.log("  撤销后内核块树:\n" + (await subtree(doc.listId)).join("\n"));
    const lastKeys = await page.eval(`JSON.stringify((window.__mmProbe?.keys || []).slice(-3))`);
    console.log("  最近三次 keydown:", lastKeys);
    await sleep(1600);
    const undoDel2 = await itemShape(doc.listId);
    console.log(`  Ctrl+Z 后：${undoDel2.length}`);
    check(
        "Ctrl+Z 能撤销「删除节点」",
        JSON.stringify(undoDel2) === JSON.stringify(undoDel0),
        `接住=${histSignal}，内核 ${JSON.stringify(undoDel2)} vs 操作前 ${JSON.stringify(undoDel0)}`,
    );

    /* ============================== 其它隐患 */

    section("其它");

    const strays = await page.eval(`(() => {
        const root = document.querySelector('.mm-root');
        if (!root) return null;
        return {
            rootContenteditable: root.getAttribute('contenteditable'),
            willChangeOnWorld: getComputedStyle(root.querySelector('.mm-world')).willChange,
            backdropFilters: Array.from(root.querySelectorAll('*')).filter(e => {
                const s = getComputedStyle(e);
                return s.backdropFilter && s.backdropFilter !== 'none';
            }).map(e => e.className),
            zoomLabel: root.querySelector('.mm-zoom-label')?.textContent,
            scrollW: document.querySelector('.mm-viewport')?.scrollWidth,
            clientW: document.querySelector('.mm-viewport')?.clientWidth,
        };
    })()`);
    console.log("  现场:", JSON.stringify(strays));

    const errs = await page.eval("window.__mmProbe.errors");
    // 页面上还住着十几个别人的插件，它们自己的报错不归我们管
    const mine = errs.filter((e) => String(e.stack ?? e.msg ?? "").includes("siyuan-plugin-mindmap"));
    console.log("  全部页面错误:", JSON.stringify(errs).slice(0, 400));
    check("本插件没有未捕获错误", mine.length === 0, JSON.stringify(mine).slice(0, 900));

    const renders = await page.eval("window.__mmProbe.renders");
    console.log("  导图节点层重建记录:", JSON.stringify(renders));

    const allToasts = await page.eval("window.__mmProbe.toasts.map(t => t.text)");
    console.log("  全程弹过的提示:", JSON.stringify(allToasts));
} catch (err) {
    console.error("\n运行失败:", err.message);
    results.push({ name: "运行未抛错", ok: false, detail: err.message });
    if (page) {
        try {
            fs.mkdirSync(SHOT_DIR, { recursive: true });
            await page.screenshot(`${SHOT_DIR}/failure.png`);
            console.error("失败截图 ->", `${SHOT_DIR}/failure.png`);
        } catch {
            /* ignore */
        }
    }
} finally {
    await chrome.close();
    if (docId && !process.env.MM_KEEP) {
        const ok = await removeDoc(api, docId);
        console.log(ok ? "已清理临时文档" : "⚠️ 临时文档未能清理: " + docId);
    }
    else if (docId) console.log("\n保留临时文档（MM_KEEP=1）:", docId);
}

/* ------------------------------------------------------------------ 汇总 */

const pass = results.filter((r) => r.ok).length;
console.log(`\n${"=".repeat(60)}\n真机验收：${pass}/${results.length} 通过`);
for (const r of results.filter((r) => !r.ok)) console.log(`  ✘ ${r.name} — ${r.detail}`);
process.exit(pass === results.length ? 0 : 1);
