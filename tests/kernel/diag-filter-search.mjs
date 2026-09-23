/**
 * P1-1「按状态过滤 + 跨图搜索」的端到端验收。
 *
 * 两件事合在一起测，是因为它们在同一个搜索框里相遇，而且**会互相影响**：
 *   - 过滤只作用于当前这张图（改的是 `kids`，折叠态与它无关）；
 *   - 跨图搜索搜的是**整篇文档里所有被标记成导图的列表**，结果点一下要能跳过去；
 *   - 两者叠加时，搜索只在**筛出来的范围**里找 —— 否则会出现「计数说 3 条，
 *     画面上一个高亮都看不见」这种自相矛盾的画面。
 *
 * fixture 刻意建**两张**导图：跨图搜索要是只有一张图，就永远测不出
 * 「命中在别的图里」这条分支（而它恰恰是最容易写错的那条）。
 *
 * 用法：node tests/kernel/diag-filter-search.mjs
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
const kids = async (id) => {
    const j = await api("/api/block/getChildBlocks", { id });
    return j.code === 0 ? j.data : [];
};

/* ---------------------------------------------------------------- 建测试文档 */

const T_ROOT = "顶层任务";
const T_A = "甲任务";
const T_A_KID = "甲的子条目";
const T_B = "乙任务";
const P_HEAD = "第二章";
const P_LEAF = "跨图目标节点";

const md = [
    `- [ ] ${T_ROOT}`,
    `  - [ ] ${T_A}`,
    `    - ${T_A_KID}`,
    `  - [x] ${T_B}`,
    "",
    `- ${P_HEAD}`,
    `  - ${P_LEAF}`,
    "",
].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-过滤与跨图搜索-${Date.now()}`,
    markdown: md,
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;

/* 两张图：第一张有待办（会挂过滤器），第二张没有待办（过滤器应当自动收起） */
const topLists = (await kids(docId)).filter((k) => k.type === "l");
const [listA, listB] = topLists;
if (!listA || !listB) throw new Error(`预期两个顶层列表，实际 ${topLists.length} 个`);

const rootLiA = (await kids(listA.id)).find((k) => k.type === "i").id;
const innerListA = (await kids(rootLiA)).find((k) => k.type === "l").id;
const [idA, idB] = (await kids(innerListA)).filter((k) => k.type === "i").map((b) => b.id);

const rootLiB = (await kids(listB.id)).find((k) => k.type === "i").id;
const innerListB = (await kids(rootLiB)).find((k) => k.type === "l").id;
const idLeafB = (await kids(innerListB)).filter((k) => k.type === "i")[0].id;

await api("/api/attr/setBlockAttrs", { id: listA.id, attrs: { "custom-mindmap": "logic" } });
await api("/api/attr/setBlockAttrs", { id: listB.id, attrs: { "custom-mindmap": "mind" } });

console.log(`临时文档 ${docId}`);
console.log(`图A ${listA.id}\n  甲 ${idA} / 乙 ${idB}`);
console.log(`图B ${listB.id}\n  叶子 ${idLeafB}\n`);

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
 * 找到「装着某个已知块 ID 的那张图」的根元素。
 *
 * 这个测试里有**两张**导图同时挂在页面上，`querySelector` 只会拿到第一张，
 * 拿错了就会得到一堆莫名其妙的断言失败。所有页内查询都先经过这里定根。
 */
const rootFor = (id) => `[...document.querySelectorAll('.mm-root:not(.mm-root--dialog):not(.mm-root--side)')]
    .find((r) => r.querySelector('.mm-node[data-mm-id="${id}"]'))`;

/** 页内：某张图里当前**看得见**（参与布局）的节点文字，按文档顺序 */
const visibleTexts = (probeId) => `(() => {
    const root = ${rootFor(probeId)};
    if (!root) return { err: 'no root' };
    return [...root.querySelectorAll('.mm-node')]
        .filter((n) => n.style.visibility !== 'hidden')
        .map((n) => ((n.querySelector('.mm-txt') || {}).textContent || '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').trim());
})()`;

/** 页内：过滤器 chip 组的状态 */
const filterChips = (probeId) => `(() => {
    const root = ${rootFor(probeId)};
    if (!root) return { err: 'no root' };
    const group = root.querySelector('.mm-filters');
    if (!group) return { err: 'no filters group' };
    return {
        shown: group.style.display !== 'none',
        chips: [...group.querySelectorAll('button')].map((b) => ({
            t: b.textContent.trim(),
            on: b.classList.contains('mm-on'),
        })),
    };
})()`;

/** 页内：点某个 chip（按文字找） */
const chipPoint = (probeId, label) => `(() => {
    const root = ${rootFor(probeId)};
    if (!root) return { err: 'no root' };
    const b = [...root.querySelectorAll('.mm-filters button')].find((x) => x.textContent.trim() === '${label}');
    if (!b) return { err: 'no chip' };
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

/** 页内：搜索框（**限定在图A 的那一个** —— 页面上有两张图，就有两个搜索框） */
const BOX = `(() => { const r = ${rootFor(idA)}; return r ? r.querySelector('.mm-search') : null; })()`;

/** 页内：搜索框与结果面板的状态 */
const searchState = `(() => {
    const box = ${BOX};
    if (!box) return { err: 'no search box' };
    const root = ${rootFor(idA)};
    return {
        on: box.classList.contains('mm-search--on'),
        count: (box.querySelector('.mm-search-count') || {}).textContent || '',
        scope: (box.querySelector('.mm-search-scope') || {}).textContent || '',
        scopeOn: !!box.querySelector('.mm-search-scope.mm-on'),
        panelOn: !!box.querySelector('.mm-results.mm-results--on'),
        /** 本图高亮了几条 —— 与「文档级命中数」是两回事，必须分开看 */
        mapHits: root ? root.querySelectorAll('.mm-node.mm-hit').length : -1,
        results: [...box.querySelectorAll('.mm-results .mm-result')].map((r) => ({
            text: (r.querySelector('.mm-result-text') || {}).textContent || '',
            path: (r.querySelector('.mm-result-path') || {}).textContent || '',
        })),
    };
})()`;

/** 页内：把搜索框里的词换掉并触发一次输入 */
const typeQuery = (q) => `(() => {
    const box = ${BOX};
    if (!box) return false;
    const i = box.querySelector('input');
    i.focus();
    i.value = ${JSON.stringify(q)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
})()`;

/** 页内：点搜索框里的某个控件（按类名 / 文字找） */
const boxPoint = (sel) => `(() => {
    const box = ${BOX};
    const b = box && box.querySelector(${JSON.stringify(sel)});
    if (!b) return { err: 'no target' };
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

/** 页内：当前图里有没有被 `.mm-hit` 标中的某个块 */
const isHit = (id) => `!!document.querySelector('.mm-node[data-mm-id="${id}"].mm-hit')`;

/** 让导图拿到焦点 */
const focusMap = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return false;
    root.focus({ preventScroll: true });
    return document.activeElement === root;
})()`;

const chrome = await launch({ headless: true, port: 9360, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);

    const logs = [];
    page.on("Runtime.consoleAPICalled", (p) => {
        const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
        if (text.includes("mindmap")) logs.push(`[${p.type}] ${text}`);
    });
    await page.send("Runtime.enable");

    await page.waitFor(
        `document.querySelectorAll('.mm-root:not(.mm-root--dialog):not(.mm-root--side) .mm-node').length >= 6`,
        { timeout: 90000, label: "两张导图都挂上" },
    );
    await sleep(1600);

    /* ============================== 0. 初始 ============================== */
    console.log("【0 初始】");
    ok((await page.eval(`document.querySelectorAll('.mm-root:not(.mm-root--dialog):not(.mm-root--side)').length`)) === 2, "文档里两张导图都渲染出来了");
    const chipsA = await page.eval(filterChips(idA));
    ok(chipsA.shown === true, "有待办的图A：过滤器 chip 组是显示的");
    ok((chipsA.chips || []).map((c) => c.t).join("/") === "全部/未完成/已完成", "三个 chip 文案正确", (chipsA.chips || []).map((c) => c.t).join(" "));
    ok((chipsA.chips || []).find((c) => c.t === "全部")?.on === true, "默认停在「全部」");
    const chipsB = await page.eval(filterChips(idLeafB));
    ok(chipsB.shown === false, "★ 没有待办的图B：chip 组自动收起（不给非任务列表添乱）");
    const v0 = await page.eval(visibleTexts(idA));
    ok(v0.length === 4, "图A 初始 4 个节点全可见", (v0 || []).join(" / "));

    /* ============================== A. 只看未完成 ============================== */
    console.log("\n【A 点「未完成」→ 已完成的待办收起来】");
    const pa = await page.eval(chipPoint(idA, "未完成"));
    ok(!pa.err, "找到「未完成」chip", pa.err ?? "");
    await page.mouse("mouseMoved", pa.x, pa.y, { buttons: 0 });
    await page.mouse("mousePressed", pa.x, pa.y, { clickCount: 1 });
    await page.mouse("mouseReleased", pa.x, pa.y, { clickCount: 1 });
    await sleep(900);

    const vA = await page.eval(visibleTexts(idA));
    ok(!vA.err, "读到了可见节点", vA.err ?? "");
    ok(!vA.includes(T_B), "★ 已完成的「乙任务」被筛掉了", (vA || []).join(" / "));
    ok(vA.includes(T_ROOT) && vA.includes(T_A), "未完成的「顶层任务 / 甲任务」还在");
    ok(vA.includes(T_A_KID), "★ 非待办子条目跟着它那个未完成的父任务一起留下（继承状态）");
    ok((await page.eval(filterChips(idA))).chips.find((c) => c.t === "未完成").on === true, "chip 高亮切到「未完成」");
    const vB = await page.eval(visibleTexts(idLeafB));
    ok(vB.length === 2, "★ 过滤只作用于当前这张图，图B 不受影响", (vB || []).join(" / "));

    /* 过滤后导航不能走进看不见的节点 */
    console.log("  · 过滤下的方向键导航");
    const navPt = await page.eval(`(() => {
        const root = ${rootFor(idA)};
        const el = root.querySelector('.mm-node[data-mm-id="${idA}"]');
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.right - 6), y: Math.round(r.top + r.height / 2) };
    })()`);
    await page.mouse("mouseMoved", navPt.x, navPt.y, { buttons: 0 });
    await page.mouse("mousePressed", navPt.x, navPt.y, { clickCount: 1 });
    await page.mouse("mouseReleased", navPt.x, navPt.y, { clickCount: 1 });
    await sleep(400);
    await page.eval(focusMap);
    await page.press("ArrowDown");
    await sleep(400);
    const selAfterDown = await page.eval(`(() => {
        const root = ${rootFor(idA)};
        const el = root && root.querySelector('.mm-node.mm-sel');
        return el ? el.dataset.mmId : 'none';
    })()`);
    ok(selAfterDown !== idB, "★ ↓ 不会走到被筛掉的「乙任务」上", String(selAfterDown));

    /* ============================== B. 只看已完成 ============================== */
    console.log("\n【B 切到「已完成」→ 只剩完成的那条（和它的祖先）】");
    const pb = await page.eval(chipPoint(idA, "已完成"));
    await page.mouse("mouseMoved", pb.x, pb.y, { buttons: 0 });
    await page.mouse("mousePressed", pb.x, pb.y, { clickCount: 1 });
    await page.mouse("mouseReleased", pb.x, pb.y, { clickCount: 1 });
    await sleep(900);
    const vB2 = await page.eval(visibleTexts(idA));
    ok(vB2.includes(T_B), "「乙任务」出现了");
    ok(vB2.includes(T_ROOT), "★ 祖先「顶层任务」作为通路被留下（不然树就断了）");
    ok(!vB2.includes(T_A) && !vB2.includes(T_A_KID), "未完成的那一支整体收起来", (vB2 || []).join(" / "));

    /* ============================== C. 回到全部 ============================== */
    console.log("\n【C 回到「全部」】");
    const pc = await page.eval(chipPoint(idA, "全部"));
    await page.mouse("mouseMoved", pc.x, pc.y, { buttons: 0 });
    await page.mouse("mousePressed", pc.x, pc.y, { clickCount: 1 });
    await page.mouse("mouseReleased", pc.x, pc.y, { clickCount: 1 });
    await sleep(900);
    const vC = await page.eval(visibleTexts(idA));
    ok(vC.length === 4, "4 个节点全回来了", (vC || []).join(" / "));

    /* ============================== D. 跨图搜索 ============================== */
    console.log("\n【D Ctrl+F → 切「全文档」→ 搜另一张图里的节点】");
    await page.eval(focusMap);
    await page.press("f", { ctrl: true });
    await sleep(500);
    let s = await page.eval(searchState);
    ok(s.on === true, "搜索框打开了");
    ok(s.scope === "本图", "默认范围是「本图」", s.scope);

    const scopePt = await page.eval(boxPoint(".mm-search-scope"));
    ok(!scopePt.err, "找到范围开关", scopePt.err ?? "");
    await page.mouse("mouseMoved", scopePt.x, scopePt.y, { buttons: 0 });
    await page.mouse("mousePressed", scopePt.x, scopePt.y, { clickCount: 1 });
    await page.mouse("mouseReleased", scopePt.x, scopePt.y, { clickCount: 1 });
    await sleep(400);
    s = await page.eval(searchState);
    ok(s.scope === "全文档" && s.scopeOn, "切到了「全文档」");

    await page.eval(typeQuery("跨图目标"));
    await sleep(1400); // 防抖 220ms + 一次 SQL 往返
    s = await page.eval(searchState);
    ok(s.panelOn === true, "★ 结果面板浮出来了");
    ok(s.results.length === 1, "★ 只命中真正含关键词的那一个节点", JSON.stringify(s.results));
    ok((s.results[0] || {}).text === P_LEAF, "★ 结果文字是该项自己的文字，不是整棵子树拼起来的", (s.results[0] || {}).text);
    ok((s.results[0] || {}).path === P_HEAD, "★ 结果标出了它在哪条路径下", (s.results[0] || {}).path);
    ok(s.count === "1 条", "计数报的是文档级命中数", s.count);
    ok(s.mapHits === 0, "命中不在当前图里，所以画布上没有高亮（正常）");

    /* 点结果 → 应当定位到正文块 */
    const resPt = await page.eval(`(() => {
        const box = ${BOX};
        const b = box && box.querySelector('.mm-results .mm-result');
        if (!b) return { err: 'no result row' };
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    ok(!resPt.err, "结果行可点", resPt.err ?? "");
    await page.mouse("mouseMoved", resPt.x, resPt.y, { buttons: 0 });
    await page.mouse("mousePressed", resPt.x, resPt.y, { clickCount: 1 });
    await page.mouse("mouseReleased", resPt.x, resPt.y, { clickCount: 1 });
    await sleep(900);
    const located = await page.eval(`!!document.querySelector('.protyle-wysiwyg [data-node-id="${idLeafB}"]')`);
    ok(located === true, "★ 跨图命中点一下就定位到了正文里的那个块");

    /* ============================== E. 搜本图 ============================== */
    console.log("\n【E 跨图范围下搜本图的节点 → 结果标「本图」】");
    await page.eval(typeQuery("甲任务"));
    await sleep(1400);
    s = await page.eval(searchState);
    ok(s.results.length >= 1, "有结果", JSON.stringify(s.results));
    ok((s.results[0] || {}).path === "本图", "★ 本图的命中标成「本图」", (s.results[0] || {}).path);
    ok((await page.eval(isHit(idA))) === true, "同时画布上把它高亮了");

    /* ============================== F. 过滤 + 搜索叠加 ============================== */
    console.log("\n【F 过滤「未完成」时搜已完成的那条 → 本图不该有命中】");
    await page.eval(typeQuery(""));
    await page.press("Escape");
    await sleep(400);
    const pf = await page.eval(chipPoint(idA, "未完成"));
    await page.mouse("mouseMoved", pf.x, pf.y, { buttons: 0 });
    await page.mouse("mousePressed", pf.x, pf.y, { clickCount: 1 });
    await page.mouse("mouseReleased", pf.x, pf.y, { clickCount: 1 });
    await sleep(800);
    await page.eval(focusMap);
    await page.press("f", { ctrl: true });
    await sleep(400);
    await page.eval(typeQuery("乙任务"));
    await sleep(700);
    s = await page.eval(searchState);
    ok(s.mapHits === 0, "★ 被筛掉的节点不参与本图命中（画布上没有高亮）", String(s.mapHits));
    ok(s.results.length >= 1, "★ 但跨图范围照旧能搜到它 —— 它确实在文档里（过滤器只影响画布，不影响「东西在哪」）", JSON.stringify(s.results));
    // 点它一下：应当自动撤掉过滤器，否则焦点会落在一个看不见的节点上
    const fPt = await page.eval(`(() => {
        const box = ${BOX};
        const b = box && box.querySelector('.mm-results .mm-result');
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await page.mouse("mouseMoved", fPt.x, fPt.y, { buttons: 0 });
    await page.mouse("mousePressed", fPt.x, fPt.y, { clickCount: 1 });
    await page.mouse("mouseReleased", fPt.x, fPt.y, { clickCount: 1 });
    await sleep(900);
    const vF = await page.eval(visibleTexts(idA));
    ok(vF.length === 4, "★ 点它之后过滤器自动撤回「全部」，节点真的看得见了", (vF || []).join(" / "));
    ok((await page.eval(isHit(idB))) === true, "并且它被高亮选中");

    /* ============================== G. 关闭 ============================== */
    console.log("\n【G 关掉搜索框】");
    await page.press("Escape");
    await sleep(400);
    s = await page.eval(searchState);
    ok(s.on === false, "搜索框关掉了");
    ok(s.panelOn === false && s.results.length === 0, "★ 结果面板跟着一起清掉（不留孤儿浮层）");

    if (logs.length) console.log("\n控制台:", logs.join("\n            "));
    await page.screenshot(`${OUT}/filter-search-final.png`);

    console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
    if (fail === 0) console.log("✓ 过滤与跨图搜索成立：过滤只改内存、跨图结果可跳转、两者叠加时不打架");
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}

process.exit(fail === 0 ? 0 : 1);
