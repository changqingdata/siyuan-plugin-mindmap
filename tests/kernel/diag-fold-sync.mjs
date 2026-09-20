/**
 * 折叠状态「大纲 ↔ 导图」双向同步的端到端验收。
 *
 * 设计前提（第十五轮定的）：
 *   折叠态**没有**插件私有副本。真相源就是思源原生的 `fold` ——
 *   解析侧读 `.li[fold="1"]`，写入侧调 `/api/block/foldBlock`，
 *   内核把 kramdown 里那份存进 `.sy`，所以持久化由思源自己保证。
 *
 * 于是「用户离开时什么状态、下次进来就是什么状态」这件事不该由插件决定，
 * 插件只负责**别把状态弄丢**。这条探针就钉死这件事：
 *
 *   A 导图 → 大纲   点导图上的折叠珠子 → 大纲的 `.li` 出现 fold="1"、
 *                   块属性是 "1"、kramdown 里也写了 fold="1"；
 *                   且**在 150ms 内**画面就已经收起来了（覆盖表补空窗的酸测试）
 *   B 大纲 → 导图   从内核折另一个分支（等价于用户在大纲里折）→ 导图可见节点收敛
 *   C 覆盖表退场    A 里刚折过的那一个，再在大纲侧展开 → 导图**必须**跟着展开
 *                   （覆盖表要是赖着不走，导图会无动于衷 —— 这是本轮最大的回归风险）
 *   D 持久化        整页重载 → 折叠态还在，导图还是那个样子
 *   E 全局按钮      「折叠全部」把每个分支都写进大纲；「展开全部」把它们清回去
 *
 * 两个已知的坑，别再踩：
 *   1. 页面里**没有** `fetchSyncPost` 这个全局（`typeof` 是 undefined）。
 *      要模拟「用户在大纲里折」就走内核 REST —— 实测内核会把事务回推给前端，
 *      `.li[fold]` 会跟着变，与用户手点等价。
 *   2. 判据要跟**上一步的实际状态**比，不能一律跟初始值比。
 *      第一版就是这么写错的：B 拿 base.visible 当基准，于是「什么都没发生」也判通过。
 *
 * 全程用自己新建的临时文档，不碰用户数据；跑完删掉。
 *
 * 用法：node tests/kernel/diag-fold-sync.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";

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

const BRANCHES = 3;
const PER = 3;
const itemText = (i, j) => `条目 ${i}.${j}：被折起来时应当整段消失`;
const md = ["- 折叠同步验证"];
for (let i = 1; i <= BRANCHES; i++) {
    md.push(`  - 分支${i}：一段用来观察折叠的标题文字`);
    for (let j = 1; j <= PER; j++) md.push(`    - ${itemText(i, j)}`);
}
md.push("");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-折叠同步-${Date.now()}`,
    markdown: md.join("\n"),
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;

/** 走一遍块树拿到各个层级的 ID */
const listId = (await kids(docId)).find((k) => k.type === "l").id;
const rootLi = (await kids(listId)).find((k) => k.type === "i").id;
const innerList = (await kids(rootLi)).find((k) => k.type === "l").id;
const branchIds = (await kids(innerList)).filter((k) => k.type === "i").map((b) => b.id);

await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

console.log(`临时文档 ${docId}`);
console.log(`列表 ${listId} · 根 ${rootLi} · 分支 ${branchIds.length} 个`);
console.log(`分支 ID: ${branchIds.join(", ")}\n`);

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

/** 页内探针：数可见节点 + 列出可见文字 */
const VIS = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return { err: 'no root' };
    const els = [...root.querySelectorAll('.mm-node')];
    const vis = els.filter((e) => e.style.visibility !== 'hidden');
    const txt = (e) => ((e.querySelector('.mm-txt') || {}).textContent || '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').trim();
    return {
        total: els.length,
        visible: vis.length,
        texts: vis.map(txt).filter((t) => t && t !== '+'),
        collapsed: [...root.querySelectorAll('.mm-toggle--collapsed')].length,
    };
})()`;

/** 点一个元素（页内给坐标，然后走真实鼠标事件） */
async function clickAt(page, expr) {
    const pt = await page.eval(expr);
    if (!pt || pt.err) return null;
    await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
    await page.mouse("mousePressed", pt.x, pt.y, {});
    await page.mouse("mouseReleased", pt.x, pt.y, {});
    return pt;
}
/** 第 n 个折叠珠子（0 = 根）的屏幕坐标 */
const beadExpr = (n) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return { err: 'no root' };
    root.scrollIntoView({ block: 'center' });
    const t = [...root.querySelectorAll('.mm-toggle')][${n}];
    if (!t) return { err: 'no bead' };
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;
/** 工具栏按钮坐标（按 tooltip 找） */
const toolExpr = (tip) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return { err: 'no root' };
    const b = [...root.querySelectorAll('.mm-icon')].find((e) => (e.dataset.mmTip || '').includes('${tip}'));
    if (!b) return { err: 'no button' };
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

/** 大纲侧的真实状态：块属性 + kramdown 两处 */
async function outlineState(id) {
    const attrs = await api("/api/attr/getBlockAttrs", { id });
    const kd = await api("/api/block/getBlockKramdown", { id });
    return {
        attr: attrs.data?.fold ?? null,
        kramdown: /fold="1"/.test(kd.data?.kramdown ?? ""),
    };
}

const chrome = await launch({ headless: true, port: 9351, width: 1680, height: 1050, dpr: 1 });
const url = `http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`;
const waitMap = async (page, label) => {
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label });
    await sleep(1600);
};

try {
    const page = await chrome.newPage(url);
    await waitMap(page, "首次打开");

    const base = await page.eval(VIS);
    const FULL = 1 + BRANCHES + BRANCHES * PER;
    console.log(`【初始】可见 ${base.visible}/${base.total} 个节点，折着 ${base.collapsed} 个`);
    ok(base.visible === base.total, "初始全部展开", `${base.visible}/${base.total}`);
    ok(base.total === FULL, "节点总数符合预期", `${base.total} = 1+${BRANCHES}+${BRANCHES * PER}`);

    /* ================================ A. 导图 → 大纲 ================================ */
    console.log("\n【A 导图上折「分支1」→ 大纲应当跟着折】");
    const bead = await clickAt(page, beadExpr(1));
    ok(!!bead, "找到「分支1」的折叠珠子");

    // ★ 覆盖表的酸测试：内核还没回推（几百毫秒），画面必须**立刻**是折起来的。
    //   toggleFold 之后紧接着的那次 render 会重新 parseList，而此刻 DOM 上
    //   还没有 fold="1" —— 没有覆盖表的话这里会看到「折了又弹回来」。
    await sleep(150);
    const Aearly = await page.eval(VIS);
    ok(
        Aearly.visible === base.visible - PER,
        "点击后 150ms 画面就已经收起来了（覆盖表补住了空窗）",
        `${base.visible} → ${Aearly.visible}`,
    );

    await sleep(1200); // 等内核事务回推
    const A = await page.eval(VIS);
    console.log(`  导图：可见 ${A.visible}/${A.total}，折着 ${A.collapsed}`);
    ok(A.visible === base.visible - PER, "导图上被折的子树消失", `${base.visible} → ${A.visible}`);
    ok(A.collapsed === 1, "折叠珠子切到了「已折叠」态", `${A.collapsed}`);
    ok(!A.texts.includes(itemText(1, 1)), "消失的确实是「分支1」的子树");
    ok(A.texts.includes(itemText(2, 1)), "「分支2」不受影响");

    const st = await outlineState(branchIds[0]);
    console.log(`  大纲：块属性 fold=${JSON.stringify(st.attr)}，kramdown 含 fold="1"=${st.kramdown}`);
    ok(st.attr === "1", "大纲的块属性写上了 fold=1");
    ok(st.kramdown, "kramdown 里也写了 fold=1（思源据此持久化进 .sy）");
    const domFold = await page.eval(
        `document.querySelector('.list[data-node-id="${listId}"] .li[data-node-id="${branchIds[0]}"]')?.getAttribute('fold') ?? null`,
    );
    ok(domFold === "1", "大纲 DOM 上的 .li[fold] 也是 1", `fold=${JSON.stringify(domFold)}`);

    /* ================================ C. 覆盖表必须退场 ================================ */
    console.log("\n【C 在「大纲」侧展开刚折的那个 → 导图必须跟得上】");
    await api("/api/block/unfoldBlock", { id: branchIds[0] });
    await sleep(1400);
    const C = await page.eval(VIS);
    console.log(`  导图：可见 ${C.visible}/${C.total}，折着 ${C.collapsed}`);
    ok(C.visible === base.visible, "导图跟着大纲展开了（覆盖表没赖着不走）", `${A.visible} → ${C.visible}`);
    ok(C.collapsed === 0, "没有残留的「已折叠」珠子", `${C.collapsed}`);

    /* ================================ B. 大纲 → 导图 ================================ */
    console.log("\n【B 在大纲侧折「分支2」→ 导图应当跟着折】");
    await api("/api/block/foldBlock", { id: branchIds[1] });
    await sleep(1400);
    const B = await page.eval(VIS);
    console.log(`  导图：可见 ${B.visible}/${B.total}，折着 ${B.collapsed}`);
    ok(B.visible === C.visible - PER, "导图跟着大纲折起来了", `${C.visible} → ${B.visible}`);
    ok(B.collapsed === 1, "只有「分支2」是折着的", `${B.collapsed}`);
    ok(!B.texts.includes(itemText(2, 1)), "被折子树里的文字确实从画面上消失了");
    ok(B.texts.includes(itemText(1, 1)), "「分支1」已经展开回来了");

    /* ================================ D. 持久化 ================================ */
    console.log("\n【D 整页重载 → 折叠态应当还在】");
    await page.send("Page.reload", { ignoreCache: true });
    await sleep(3200);
    await waitMap(page, "重载后");
    const D = await page.eval(VIS);
    console.log(`  导图：可见 ${D.visible}/${D.total}，折着 ${D.collapsed}`);
    ok(D.visible === B.visible, "重载后可见节点数与关闭前一致", `${B.visible} → ${D.visible}`);
    ok(D.collapsed === 1, "重载后仍是「分支2」折着", `${D.collapsed}`);
    const stB = await outlineState(branchIds[1]);
    ok(stB.attr === "1", "内核里「分支2」的 fold 依然在", `fold=${JSON.stringify(stB.attr)}`);

    /* ================================ E. 折叠全部 / 展开全部 ================================ */
    console.log("\n【E 工具栏「折叠全部」→ 大纲应当同步收拢】");
    const b1 = await clickAt(page, toolExpr("折叠全部"));
    ok(!!b1, "找到「折叠全部」按钮");
    await sleep(1800);
    const E = await page.eval(VIS);
    console.log(`  导图：可见 ${E.visible}/${E.total}，折着 ${E.collapsed}`);
    ok(E.visible === 1 + BRANCHES, "折叠全部之后只剩根 + 各分支", `${E.visible}`);
    let foldedCount = 0;
    for (const id of branchIds) {
        const s = await outlineState(id);
        if (s.attr === "1") foldedCount++;
    }
    ok(foldedCount === BRANCHES, "所有分支在大纲里都写上了 fold=1", `${foldedCount}/${BRANCHES}`);

    console.log("\n【E2 工具栏「展开全部」→ 大纲应当同步展开】");
    const b2 = await clickAt(page, toolExpr("展开全部"));
    ok(!!b2, "找到「展开全部」按钮");
    await sleep(1800);
    const E2 = await page.eval(VIS);
    console.log(`  导图：可见 ${E2.visible}/${E2.total}，折着 ${E2.collapsed}`);
    ok(E2.visible === base.total, "展开全部之后节点全回来", `${E2.visible}`);
    let stillFolded = 0;
    for (const id of branchIds) {
        const s = await outlineState(id);
        if (s.attr === "1") stillFolded++;
    }
    ok(stillFolded === 0, "大纲里的 fold 也被清掉了", `${stillFolded} 个残留`);

    await page.screenshot(`${OUT}/fold-sync-final.png`);

    console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
    if (fail === 0) console.log("✓ 折叠状态双向同步成立，且持久化由思源原生保证");
} finally {
    await chrome.close();
    await api("/api/block/deleteBlock", { id: docId }).catch(() => {});
    console.log("已清理临时文档");
}

process.exit(fail === 0 ? 0 : 1);
