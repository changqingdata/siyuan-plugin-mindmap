/**
 * 第十六轮「画布与工具交互增强」的真机端到端验收。
 *
 * 这一轮加的东西大多有**时序**属性（占位框只活几百毫秒、收拢动画 270ms 后就销毁、
 * 高亮描边 1.5s 后消失），所以判据不能是「跑完之后查一眼 DOM」——
 * 那样永远查不到。凡是瞬态的东西，一律先挂 MutationObserver 把「出现过」记下来，
 * 再去读计数。这是从第十五轮折叠探针学到的教训：判据要盯**过程**，不能只盯**结果**。
 *
 * 覆盖：
 *   1. P0-2 乐观占位      按 Tab 加子节点 → 过程中确实出现过 .mm-ghost
 *   2. P0-2 失败反馈      顶层节点按 Alt+← 升级（必然失败）→ 出现 .mm-node.mm-error
 *   3. P0-3 视图跟文档    切换布局 → 块属性 custom-mindmap-view 写入；重载后保持
 *   4. P0-1 批量操作条    选中 ≥2 个 → .mm-batch 浮出；批量折叠真的折了
 *   5. P0-1 批量整体回滚  批量删除 → 节点数归零 → Ctrl+Z 还原
 *   6. P1-1 悬停预览      折叠节点后悬停珠子 → 浮出 .mm-preview 且列出子节点
 *   7. P1-2 连线语义化    已完成任务的支线带 stroke-dasharray；新插入节点有 .mm-fresh
 *   8. P1-3 小地图        小图隐藏；大图显示，且选中节点在小地图上有标记
 *   9. P1-4 缩放菜单      点缩放标签 → 菜单里出现「适应选中节点」
 *  10. P2-1 双向高亮      导图选中节点 → 大纲对应 .li 得到 mm-outline-hit
 *  11. P2-3 演示模式      进入后逐层展开、方向键推进、退出后**大纲 kramdown 一字未改**
 *  12. P2-5 收拢动画      折叠时出现过 .mm-node.mm-collapsing
 *  13. P2-2 导出增强      导出菜单里出现「Markdown 大纲」「复制为图片」
 *
 * 全程用自己新建的临时文档，跑完删掉。
 *
 * 用法：node tests/kernel/diag-canvas-v2.mjs
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
const attrs = async (id) => {
    const j = await api("/api/attr/getBlockAttrs", { id });
    return j.code === 0 ? j.data ?? {} : {};
};

/* ---------------------------------------------------------------- 建测试文档 */

const SMALL = [
    "- 交互增强验证",
    "  - 分支甲：一段用来观察折叠与收拢动画的标题文字",
    "    - 条目 甲.1：折起来时应当整段消失",
    "    - 条目 甲.2：折起来时应当整段消失",
    "  - 分支乙：另一段用来观察的标题文字",
    "    - 条目 乙.1：折起来时应当整段消失",
    "  - 任务组：用来观察连线语义化",
    "    - [x] 已完成的任务",
    "    - [ ] 未完成的任务",
    "",
].join("\n");

const bigLines = ["- 小地图验证"];
for (let i = 1; i <= 8; i++) {
    bigLines.push(`  - 大分支 ${i}`);
    for (let j = 1; j <= 4; j++) bigLines.push(`    - 叶子 ${i}.${j}`);
}
bigLines.push("");
const BIG = bigLines.join("\n");

async function makeDoc(title, markdown) {
    const res = await api("/api/filetree/createDocWithMd", {
        notebook: NOTEBOOK,
        path: `/临时-${title}-${Date.now()}`,
        markdown,
    });
    if (res.code !== 0) throw new Error(`建文档失败(${title}): ` + JSON.stringify(res));
    return res.data;
}

const docA = await makeDoc("画布增强", SMALL);
const docB = await makeDoc("小地图", BIG);

const listA = (await kids(docA)).find((k) => k.type === "l").id;
const listB = (await kids(docB)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listA, attrs: { "custom-mindmap": "logic" } });
await api("/api/attr/setBlockAttrs", { id: listB, attrs: { "custom-mindmap": "logic" } });

console.log(`小图文档 ${docA} · 列表 ${listA}`);
console.log(`大图文档 ${docB} · 列表 ${listB}\n`);

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
 * 页内拿到插件实例。
 *
 * 有些交付项**没有对应的 UI 入口**（例如自定义配色只能从设置面板改），
 * 走设置面板要开 Dialog、找 DOM、再点确认，脆得很；而设置确认之后
 * 内核里干的事只有两件 —— `saveConfig()` 与 `scanner.refreshAll()`。
 * 这里直接照抄后半段：改内存里的 config，再让扫描器把全部视图重刷一遍。
 * 验的是「配置项真的作用到画面上」，不是「设置面板的按钮能点」。
 */
const MM_PLUGIN = `((window.siyuan && window.siyuan.ws && window.siyuan.ws.app && window.siyuan.ws.app.plugins) || []).find((p) => p.name === 'siyuan-plugin-mindmap')`;

/** 页内探针：数可见节点 + 折叠珠子数 */
const STATE = `(() => {
    const root = ${ROOT};
    if (!root) return { err: 'no root' };
    const els = [...root.querySelectorAll('.mm-node')];
    return {
        total: els.length,
        visible: els.filter((e) => e.style.visibility !== 'hidden').length,
        collapsed: [...root.querySelectorAll('.mm-toggle--collapsed')].length,
        batch: !!root.querySelector('.mm-batch'),
        preview: !!root.querySelector('.mm-preview'),
        present: root.classList.contains('mm-present'),
        presentBar: !!root.querySelector('.mm-present-bar'),
        minimap: root.querySelector('.mm-minimap').style.display !== 'none',
        minimapSel: root.querySelectorAll('.mm-minimap .mm-mm-sel').length,
        minimapHit: root.querySelectorAll('.mm-minimap .mm-mm-hit').length,
        fresh: root.querySelectorAll('.mm-node.mm-fresh').length,
        error: root.querySelectorAll('.mm-node.mm-error').length,
        outlineHit: document.querySelectorAll('.li.mm-outline-hit').length,
        dashed: [...root.querySelectorAll('.mm-edges path')].filter((p) => p.getAttribute('stroke-dasharray')).length,
        seg: (root.querySelector('.mm-seg button.mm-on') || {}).dataset?.layout || '',
    };
})()`;

/**
 * 挂一个观察器，把「瞬态状态出现过」记下来。
 * 占位框 / 收拢动画 / 高亮描边都活不过 1.5 秒，只查最终 DOM 永远查不到。
 *
 * ⚠️ 必须**同时**盯 childList 和 attributes，不能二选一。
 * 收拢动画的节点是「先 el.remove() 摘出树 → 加 .mm-collapsing → 再挂回 world」，
 * 加 class 那一下它已经不在被观察的子树里了，attributes 回调根本不会触发；
 * 只有挂回去时的 childList 能看到它。反过来 .mm-fresh 是给树里已有的元素加 class，
 * 只能靠 attributes。两种都收，才不会有漏网的。
 */
const WATCH = (key, selector) => `(() => {
    const root = ${ROOT};
    if (!root) return false;
    window.__watch = window.__watch || {};
    window.__watch['${key}'] = 0;
    if (window.__watchMo) window.__watchMo.disconnect();
    const sel = ${JSON.stringify(selector)};
    const bump = (el) => {
        if (!el || el.nodeType !== 1 || !el.matches || !el.matches(sel)) return;
        window.__watch['${key}']++;
    };
    const mo = new MutationObserver((recs) => {
        for (const r of recs) {
            if (r.type === 'childList') {
                for (const n of r.addedNodes) bump(n);
            } else if (r.type === 'attributes') {
                bump(r.target);
            }
        }
    });
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    window.__watchMo = mo;
    // 已经在场的也算一次
    if (root.querySelector(sel)) window.__watch['${key}']++;
    return true;
})()`;

const WATCHED = (key) => `(window.__watch && window.__watch['${key}']) || 0`;

/** 点一个元素：页内取坐标，再派发真实鼠标事件 */
async function clickExpr(page, expr, { settle = 0 } = {}) {
    const pt = await page.eval(expr);
    if (!pt || pt.err) return null;
    await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
    await page.mouse("mousePressed", pt.x, pt.y, {});
    await page.mouse("mouseReleased", pt.x, pt.y, {});
    if (settle) await sleep(settle);
    return pt;
}

/**
 * 轮询直到条件成立。
 *
 * 「写进块属性 / 写回 kramdown」都是**异步**的（插件侧还有 420ms 防抖），
 * 拿固定 `sleep` 去等，在本机空跑时够用，但串起九支探针连跑时机器一忙就偶发假失败
 * （实测：`ux:all` 里「批量展开把 fold 清干净了」偶发不过，单跑三次全过）。
 * 这里要钉的是「最终会写进去」，不是「800ms 内写进去」——
 * 「必须立刻」那类判据由 UI 侧的断言负责（例如 diag-fold-sync 的 150ms 酸测试）。
 */
async function waitFor(fn, { timeout = 4000, interval = 150, label = "" } = {}) {
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

/** 第 n 个可见节点的中心坐标 */
const nodeAt = (n) => `(() => {
    const root = ${ROOT};
    if (!root) return { err: 'no root' };
    root.scrollIntoView({ block: 'center' });
    const els = [...root.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden');
    const e = els[${n}];
    if (!e) return { err: 'no node ' + ${n} + ' / ' + els.length };
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

/** 第 n 个折叠珠子的坐标 */
const beadAt = (n) => `(() => {
    const root = ${ROOT};
    if (!root) return { err: 'no root' };
    root.scrollIntoView({ block: 'center' });
    const t = [...root.querySelectorAll('.mm-toggle')][${n}];
    if (!t) return { err: 'no bead ' + ${n} };
    const r = t.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

/** 工具条按钮坐标（按 tooltip 找） */
const toolAt = (tip) => `(() => {
    const root = ${ROOT};
    if (!root) return { err: 'no root' };
    const b = [...root.querySelectorAll('.mm-icon')].find((e) => (e.dataset.mmTip || '').includes(${JSON.stringify(tip)}));
    if (!b) return { err: 'no button ' + ${JSON.stringify(tip)} };
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

/* ---------------------------------------------------------------- 打开浏览器 */

const chrome = await launch({ headless: true, width: 1500, height: 1000 });
const page = await chrome.newPage("about:blank");
// 收集页面报错，插件异常第一时间能看到
await page.eval(`window.__mmErrors = []; window.addEventListener('error', (e) => window.__mmErrors.push(String(e.message))); true`);

const openDoc = async (docId, label) => {
    await page.send("Page.navigate", { url: `${KERNEL}/stage/build/desktop/?id=${docId}` });
    await sleep(3600);
    const ready = await page.waitFor(`${ROOT} !== null`, { timeout: 30000, label: `${label}: 导图挂载` });
    await sleep(500);
    return ready;
};

try {
    /* ============================================================ 1. P0-2 乐观占位 */
    console.log("[1] P0-2 乐观占位（结构操作的结果反馈）");
    await openDoc(docA, "小图");
    const s0 = await page.eval(STATE);
    ok(!s0.err, "导图已挂载", JSON.stringify(s0));
    ok(s0.seg === "logic", "初始布局是块属性里记的 logic");

    await page.eval(WATCH("ghost", ".mm-ghost"));
    // 选中第一个可见节点（根），按 Tab 加子节点
    await clickExpr(page, nodeAt(0), { settle: 220 });
    await page.press("Tab");
    await sleep(900);
    const ghostSeen = await page.eval(WATCHED("ghost"));
    ok(ghostSeen > 0, "过程中确实出现过乐观占位框 .mm-ghost", `出现 ${ghostSeen} 次`);
    const s1 = await page.eval(STATE);
    ok(s1.total === s0.total + 1, "内核回推之后真节点补上了", `${s0.total} → ${s1.total}`);
    ok(s1.fresh > 0, "新节点带高亮描边 .mm-fresh", `${s1.fresh} 个`);
    // 收尾：撤掉刚插入的节点，别影响后面的计数
    await page.press("Escape");
    await page.press("Delete");
    await sleep(900);

    /* ============================================================ 2. P0-2 失败反馈 */
    console.log("\n[2] P0-2 失败反馈（在原节点上打红边）");
    await clickExpr(page, nodeAt(0), { settle: 200 });
    await page.press("ArrowLeft", { alt: true }); // 顶层节点升级 → 必然失败
    await sleep(260);
    const s2 = await page.eval(STATE);
    ok(s2.error > 0, "失败时在源节点上出现 .mm-node.mm-error", `${s2.error} 个`);
    await sleep(1000);
    const s2b = await page.eval(STATE);
    ok(s2b.error === 0, "红边是瞬时的，之后自动褪去", `${s2b.error} 个`);

    /* ============================================================ 3. P0-3 视图跟文档走 */
    console.log("\n[3] P0-3 视图偏好跟文档走");
    await clickExpr(page, `(() => {
        const b = ${ROOT}.querySelector('.mm-seg button[data-layout="mind"]');
        if (!b) return { err: 'no mind button' };
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`, { settle: 400 });
    // 块属性写入有 420ms 防抖，所以这里要等「最终写进去」，不能只看一眼
    const a3 = await waitFor(async () => {
        const a = await attrs(listA);
        return String(a["custom-mindmap-view"] || "").includes("layout=mind") ? a : null;
    }, { label: "custom-mindmap-view 出现 layout=mind" });
    ok(
        String(a3?.["custom-mindmap-view"] || "").includes("layout=mind"),
        "布局变更写进了块属性 custom-mindmap-view",
        a3?.["custom-mindmap-view"] ?? "(空)",
    );
    // 重载之后必须还是 mind
    await openDoc(docA, "小图重载");
    const s3 = await page.eval(STATE);
    ok(s3.seg === "mind", "重载后仍是文档里记的布局", s3.seg);
    // 恢复成 logic，后面的判据好写
    await clickExpr(page, `(() => {
        const b = ${ROOT}.querySelector('.mm-seg button[data-layout="logic"]');
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`, { settle: 500 });

    /* ============================================================ 4. P0-1 批量操作条 */
    console.log("\n[4] P0-1 批量操作条");
    // 选中根的第一个子分支，Ctrl+A 会选中它的全部同级（3 个）
    await clickExpr(page, nodeAt(1), { settle: 200 });
    await page.press("a", { ctrl: true });
    await sleep(320);
    const s4 = await page.eval(STATE);
    ok(s4.batch, "选中 ≥2 个节点后批量操作条浮出");
    const batchCount = await page.eval(`(() => {
        const el = ${ROOT}.querySelector('.mm-batch-count');
        return el ? el.textContent : '';
    })()`);
    ok(/已选\s*\d+\s*个/.test(batchCount), "批量条上显示了选中数量", batchCount);

    // 批量折叠：3 个分支都该折起来
    const before4 = await page.eval(STATE);
    await clickExpr(page, `(() => {
        const b = [...${ROOT}.querySelectorAll('.mm-batch-btn')].find((e) => e.textContent === '折叠');
        if (!b) return { err: 'no fold button' };
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`, { settle: 700 });
    const after4 = await page.eval(STATE);
    ok(
        after4.collapsed >= before4.collapsed + 3,
        "批量折叠真的把选中的 3 个分支都折了",
        `珠子 ${before4.collapsed} → ${after4.collapsed}`,
    );
    const kd4 = await waitFor(async () => ((await kramdown(listA)).match(/fold="1"/g) ?? []).length >= 3, {
        label: "kramdown 出现 3 个 fold=1",
    });
    ok(kd4, "折叠写回了大纲（kramdown 里有 fold=\"1\"）");
    // 展回去
    await clickExpr(page, `(() => {
        const b = [...${ROOT}.querySelectorAll('.mm-batch-btn')].find((e) => e.textContent === '展开');
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`, { settle: 500 });
    const kd4b = await waitFor(async () => !(await kramdown(listA)).includes('fold="1"'), {
        label: "kramdown 里的 fold=1 被清掉",
    });
    ok(kd4b, "批量展开把大纲里的 fold 清干净了");

    /* ============================================================ 5. P0-1 批量删除 + 撤销 */
    console.log("\n[5] P0-1 批量删除与整体回滚");
    await clickExpr(page, nodeAt(1), { settle: 200 });
    await page.press("a", { ctrl: true });
    await sleep(260);
    const before5 = await page.eval(STATE);
    await clickExpr(page, `(() => {
        const b = [...${ROOT}.querySelectorAll('.mm-batch-btn')].find((e) => e.textContent === '删除');
        if (!b) return { err: 'no delete button' };
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`, { settle: 1200 });
    const after5 = await page.eval(STATE);
    ok(after5.visible < before5.visible, "批量删除生效，可见节点变少", `${before5.visible} → ${after5.visible}`);
    // 撤销
    await clickExpr(page, nodeAt(0), { settle: 200 });
    await page.press("z", { ctrl: true });
    await sleep(1400);
    const undone = await page.eval(STATE);
    ok(undone.visible === before5.visible, "Ctrl+Z 把批量删除整体还原", `${after5.visible} → ${undone.visible}`);

    /* ============================================================ 6. P1-1 悬停预览 */
    console.log("\n[6] P1-1 悬停预览");
    // 先折一个分支
    await clickExpr(page, beadAt(1), { settle: 700 });
    const s6a = await page.eval(STATE);
    ok(s6a.collapsed >= 1, "已折起一个分支", `珠子 ${s6a.collapsed}`);
    const bead = await page.eval(beadAt(1));
    // ⚠️ 先移开再移上去。上一步刚点过这个珠子，鼠标就停在它上面，
    // 再发一个同坐标的 mouseMoved 浏览器不会派发 mousemove，
    // 也就不会有 mouseenter —— 悬停预览自然永远不浮出。
    await page.mouse("mouseMoved", 6, 6, { buttons: 0 });
    await sleep(90);
    await page.mouse("mouseMoved", bead.x, bead.y, { buttons: 0 });
    await sleep(1000); // 预览要悬停 600ms 才浮出
    const prev = await page.eval(`(() => {
        const el = document.querySelector('.mm-preview');
        if (!el) return null;
        return { head: (el.querySelector('.mm-preview-head') || {}).textContent || '', rows: el.querySelectorAll('.mm-preview-row').length };
    })()`);
    ok(!!prev, "悬停折叠节点浮出了预览卡片");
    ok(prev && prev.rows >= 1, "卡片里列出了子节点", prev ? `${prev.rows} 行 · ${prev.head}` : "");
    // 移开就消失
    await page.mouse("mouseMoved", 4, 4, { buttons: 0 });
    await sleep(320);
    ok(!(await page.eval(`!!document.querySelector('.mm-preview')`)), "鼠标移开后预览自动收起");
    // 展开回去
    await clickExpr(page, beadAt(1), { settle: 700 });

    /* ============================================================ 7. P1-2 连线语义化 */
    console.log("\n[7] P1-2 连线语义化");
    const s7 = await page.eval(STATE);
    ok(s7.dashed >= 1, "通往「已完成任务」的支线是虚线", `${s7.dashed} 条虚线`);
    // 新插入节点带高亮描边（已在 [1] 验过，这里补一次独立确认）
    await page.eval(WATCH("fresh", ".mm-node.mm-fresh"));
    await clickExpr(page, nodeAt(1), { settle: 200 });
    await page.press("Tab");
    await sleep(900);
    ok((await page.eval(WATCHED("fresh"))) > 0, "新插入的节点带高亮描边");
    await page.press("Escape");
    await page.press("Delete");
    await sleep(900);

    /* ============================================================ 12. P2-5 收拢动画 */
    console.log("\n[12] P2-5 折叠收拢动画");
    // 收拢动画只在「折起来」的那一下发生。先确保珠子 1 此刻是展开的 ——
    // 否则点下去是「展开」，一个消失的节点都没有，观察器当然是 0。
    const bead1Collapsed = () =>
        page.eval(`(() => {
            const t = ${ROOT}.querySelectorAll('.mm-toggle')[1];
            return !!(t && t.classList.contains('mm-toggle--collapsed'));
        })()`);
    if (await bead1Collapsed()) {
        await clickExpr(page, beadAt(1), { settle: 800 });
    }
    ok(!(await bead1Collapsed()), "收拢动画前，珠子 1 处于展开态");
    await page.eval(WATCH("collapse", ".mm-node.mm-collapsing"));
    await clickExpr(page, beadAt(1), { settle: 500 });
    const collapseSeen = await page.eval(WATCHED("collapse"));
    ok(collapseSeen > 0, "折叠时子节点朝父节点聚拢并淡出", `出现 ${collapseSeen} 次`);
    await clickExpr(page, beadAt(1), { settle: 700 });

    /* ============================================================ 10. P2-1 双向高亮 */
    console.log("\n[10] P2-1 大纲 ↔ 导图 双向高亮");
    await clickExpr(page, nodeAt(1), { settle: 300 });
    const s10 = await page.eval(STATE);
    ok(s10.outlineHit === 1, "导图里选中的节点在大纲里被标了出来", `${s10.outlineHit} 个`);

    /* ============================================================ 9. P1-4 缩放菜单 */
    console.log("\n[9] P1-4 缩放菜单");
    await clickExpr(page, `(() => {
        const b = ${ROOT}.querySelector('.mm-zoom-label');
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`, { settle: 400 });
    const menu9 = await page.eval(`document.body.innerText || ''`);
    ok(menu9.includes("适应选中节点"), "缩放菜单里有「适应选中节点」");
    ok(menu9.includes("只看当前分支"), "缩放菜单里有「只看当前分支」");
    ok(menu9.includes("记住这个缩放"), "缩放菜单里有「记住这个缩放」");
    await page.press("Escape");
    await sleep(300);
    // 真的用一次「记住这个缩放」，看它有没有落进文档
    await clickExpr(page, `(() => {
        const b = ${ROOT}.querySelector('.mm-zoom-label');
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`, { settle: 350 });
    const clicked9 = await page.eval(`(() => {
        // 只认**最后一个**菜单：Esc 关菜单是这一轮才修的，万一旧菜单还留着，
        // 按全局查 .b3-menu__item 会点到那个关不掉的残影上。
        const menus = [...document.querySelectorAll('.b3-menu')];
        const menu = menus[menus.length - 1];
        if (!menu) return false;
        const all = [...menu.querySelectorAll('.b3-menu__item')];
        const pool = all.length ? all : [...menu.querySelectorAll('*')].filter((e) => !e.children.length);
        const t = pool.find((e) => (e.textContent || '').includes('记住这个缩放'));
        if (!t) return false;
        const r = t.getBoundingClientRect();
        window.__mmRememberPt = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        return true;
    })()`);
    if (clicked9) {
        const pt = await page.eval("window.__mmRememberPt");
        await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
        await page.mouse("mousePressed", pt.x, pt.y, {});
        await page.mouse("mouseReleased", pt.x, pt.y, {});
        await sleep(600);
        const a9 = await waitFor(async () => {
            const a = await attrs(listA);
            return String(a["custom-mindmap-view"] || "").includes("scale=") ? a : null;
        }, { label: "custom-mindmap-view 里出现 scale=" });
        ok(
            String(a9?.["custom-mindmap-view"] || "").includes("scale="),
            "「记住这个缩放」写进了文档级偏好",
            a9?.["custom-mindmap-view"] ?? "(空)",
        );
    } else {
        ok(false, "菜单项「记住这个缩放」可点（没找到 .b3-menu__item）");
    }

    /* ============================================================ 11. P2-3 演示模式 */
    console.log("\n[11] P2-3 演示模式");
    const kdBefore11 = await kramdown(listA);
    await clickExpr(page, toolAt("演示模式"), { settle: 800 });
    const s11a = await page.eval(STATE);
    ok(s11a.present, "进入演示模式（根元素带上 mm-present）");
    ok(s11a.presentBar, "演示进度条已浮出");
    ok(s11a.collapsed >= 1, "进入时整张图折到只剩根", `珠子 ${s11a.collapsed}`);
    const cnt0 = await page.eval(`(${ROOT}.querySelector('.mm-present-count') || {}).textContent || ''`);
    await page.press("ArrowRight");
    await sleep(500);
    const cnt1 = await page.eval(`(${ROOT}.querySelector('.mm-present-count') || {}).textContent || ''`);
    ok(cnt0 !== cnt1, "方向键推进了进度", `${cnt0} → ${cnt1}`);
    // 逐层展开要推进到**折叠分支的子节点**才看得见：走到「甲.1」时父节点「甲」
    // 才会被展开。只推一步落在「甲」自己身上，它本来就可见，珠子数不变 ——
    // 这是设计如此（演示是「走到哪露出哪」），不是没生效。
    await page.press("ArrowRight");
    await sleep(600);
    const s11b = await page.eval(STATE);
    ok(s11b.collapsed < s11a.collapsed, "推进到折叠分支的子节点时逐层展开", `珠子 ${s11a.collapsed} → ${s11b.collapsed}`);
    await page.press("Escape");
    await sleep(900);
    const s11c = await page.eval(STATE);
    ok(!s11c.present && !s11c.presentBar, "Esc 退出演示模式");
    const kdAfter11 = await kramdown(listA);
    ok(kdAfter11 === kdBefore11, "演示全程**没有改动文档**（kramdown 一字未改）");

    /* ============================================================ 13. P2-2 导出增强 */
    // 放在演示模式**之后**：菜单一旦浮出会抢走键盘，而演示模式整段都靠方向键驱动。
    // 顺序反过来的话，「方向键没反应」会被误判成演示模式坏了。
    console.log("\n[13] P2-2 导出增强");
    await clickExpr(page, toolAt("导出图片"), { settle: 500 });
    const menu13 = await page.eval(`document.body.innerText || ''`);
    ok(menu13.includes("Markdown 大纲"), "导出菜单里有「导出 Markdown 大纲」");
    ok(menu13.includes("复制为图片"), "导出菜单里有「复制为图片到剪贴板」");
    await page.press("Escape");
    await sleep(250);

    /* ============================================================ 14. P1-1b 拖拽悬停的环形进度 */
    // P1-1 有两半：折起分支上**悬停预览**（[6] 已验）与拖拽经过时
    // **珠子套一圈环形进度**。后半段没有任何静态 DOM 痕迹可查 ——
    // 环只活 HOVER_EXPAND_DELAY（420ms）那一小段，且只在拖拽过程中存在，
    // 所以要用观察器抓，并顺手把「停够时间真的会自动展开」一并钉住。
    console.log("\n[14] P1-1b 拖拽悬停自动展开的环形进度");
    const bead14Folded = () =>
        page.eval(`(() => {
            const t = ${ROOT}.querySelectorAll('.mm-toggle')[1];
            return !!(t && t.classList.contains('mm-toggle--collapsed'));
        })()`);
    // 珠子 1 = 一级分支「甲」（0 是根），折起它当落点
    if (!(await bead14Folded())) await clickExpr(page, beadAt(1), { settle: 800 });
    ok(await bead14Folded(), "分支甲已折起，可以当拖拽落点");
    const before14 = await page.eval(STATE);

    const drag14 = await page.eval(`(() => {
        const root = ${ROOT};
        root.scrollIntoView({ block: 'center' });
        const branches = [...root.querySelectorAll('.mm-node.mm-d1')].filter((e) => e.style.visibility !== 'hidden');
        const target = branches[0];   // 甲（折起）
        const source = branches[1];   // 乙（拖拽起点，不在甲的子树里）
        if (!target || !source) return { err: 'branches=' + branches.length };
        const tr = target.getBoundingClientRect();
        const sr = source.getBoundingClientRect();
        return {
            tx: Math.round(tr.left + tr.width / 2),
            ty: Math.round(tr.top + tr.height / 2),
            sx: Math.round(sr.left + sr.width / 2),
            sy: Math.round(sr.top + sr.height / 2),
        };
    })()`);
    if (drag14.err) {
        ok(false, "找到「甲 / 乙」两个一级分支当拖拽两端", drag14.err);
    } else {
        await page.eval(WATCH("hoverload", ".mm-toggle--loading"));
        await page.mouse("mouseMoved", drag14.sx, drag14.sy, { buttons: 0 });
        await sleep(80);
        await page.mouse("mousePressed", drag14.sx, drag14.sy, {});
        // 先横向挪过 DRAG_THRESHOLD(4px) 让拖拽真正激活，再落到目标身上
        await page.mouse("mouseMoved", drag14.sx + 14, drag14.sy, { buttons: 1 });
        await sleep(60);
        await page.mouse("mouseMoved", drag14.tx, drag14.ty, { buttons: 1 });
        await sleep(240); // 仍在 HOVER_EXPAND_DELAY(420ms) 之内
        ok((await page.eval(WATCHED("hoverload"))) > 0, "拖拽停在折叠节点上，珠子套出了环形进度");
        ok(
            await page.eval(`!!${ROOT}.querySelector('.mm-toggle--loading')`),
            "进度环此刻正挂在落点的珠子上",
        );
        const expanded14 = await waitFor(
            async () => {
                const s = await page.eval(STATE);
                return s.visible > before14.visible ? s : null;
            },
            { label: "拖拽悬停自动展开" },
        );
        ok(
            !!expanded14,
            "停够时间后落点自动展开，露出子节点",
            `${before14.visible} → ${expanded14 ? expanded14.visible : "?"} 个可见节点`,
        );
        // 松手前先移开空白处：既不触发移动操作，也让进度环走「撤销」那条路
        await page.mouse("mouseMoved", 6, 6, { buttons: 1 });
        await sleep(160);
        await page.mouse("mouseReleased", 6, 6, {});
        await sleep(320);
        ok(
            !(await page.eval(`!!${ROOT}.querySelector('.mm-toggle--loading')`)),
            "松手后环形进度自动撤掉",
        );
        ok(
            (await kramdown(listA)).includes("条目 甲.1"),
            "全程没有把「乙」拖进「甲」（松开在空白处 = 取消拖拽）",
        );
    }

    /* ============================================================ 15. P2-4 自定义配色 */
    console.log("\n[15] P2-4 自定义一级分支配色");
    const PAL15 = ["#ff3b30", "#34c759", "#0a84ff"];
    const setPalette = async (value) =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            if (!p) return 'no-plugin';
            p.config.customPalette = ${JSON.stringify(value)};
            if (!p.scanner) return 'no-scanner';
            p.scanner.refreshAll();
            return 'ok';
        })()`);
    const branchColors = () =>
        page.eval(
            `[...${ROOT}.querySelectorAll('.mm-node.mm-d1')].map((e) => e.style.getPropertyValue('--c-solid').trim())`,
        );

    const r15 = await setPalette(PAL15.join(","));
    ok(r15 === "ok", "把自定义色板写进插件配置（等价于设置面板确认后的那条路径）", String(r15));
    await sleep(700);
    const cols15 = await branchColors();
    ok(cols15.length >= 3, "读到一级分支节点", `${cols15.length} 个`);
    ok(
        cols15[0] === PAL15[0] && cols15[1] === PAL15[1] && cols15[2] === PAL15[2],
        "自定义配色按顺序落到一级分支上",
        cols15.slice(0, 3).join(" / "),
    );

    // 只给两个色，第三个分支应当**循环取用**第一个色 —— 色板短于分支数不该掉色
    await setPalette(PAL15.slice(0, 2).join(","));
    await sleep(700);
    const cols15b = await branchColors();
    ok(
        cols15b[0] === PAL15[0] && cols15b[2] === PAL15[0],
        "色板短于分支数时循环取用，不会掉成透明",
        cols15b.slice(0, 3).join(" / "),
    );

    // 非法输入（一个颜色都不是）应当整体忽略，退回主题自带色板
    await setPalette("这不是颜色");
    await sleep(700);
    const cols15c = await branchColors();
    ok(
        cols15c[0] !== "" && cols15c[0] !== PAL15[0],
        "非法输入被忽略，退回主题自带色板",
        cols15c.slice(0, 2).join(" / "),
    );

    // 收尾：还原成默认（空串 = 跟随主题）
    await setPalette("");
    await sleep(600);
    ok(
        (await branchColors())[0] === cols15c[0],
        "清空自定义色板后回到主题默认色",
    );

    /* ============================================================ 8. P1-3 小地图 */
    console.log("\n[8] P1-3 小地图增强");
    const s8a = await page.eval(STATE);
    ok(!s8a.minimap, "小图（10 个节点）自动隐藏小地图");
    await openDoc(docB, "大图");
    const s8b = await page.eval(STATE);
    ok(s8b.total >= 30, "大图节点数达标", `${s8b.total} 个`);
    ok(s8b.minimap, "大图显示小地图");
    await clickExpr(page, nodeAt(1), { settle: 400 });
    const s8c = await page.eval(STATE);
    ok(s8c.minimapSel >= 1, "小地图上标出了选中节点", `${s8c.minimapSel} 个标记`);
    // 点小地图跳转
    const jump = await page.eval(`(() => {
        const mm = ${ROOT}.querySelector('.mm-minimap');
        const r = mm.getBoundingClientRect();
        const before = ${ROOT}.querySelector('.mm-world').style.transform;
        return { x: Math.round(r.right - 6), y: Math.round(r.bottom - 6), before };
    })()`);
    await page.mouse("mouseMoved", jump.x, jump.y, { buttons: 0 });
    await page.mouse("mousePressed", jump.x, jump.y, {});
    await page.mouse("mouseReleased", jump.x, jump.y, {});
    await sleep(350);
    const after = await page.eval(`${ROOT}.querySelector('.mm-world').style.transform`);
    ok(after !== jump.before, "点击小地图把视图跳过去了", `${jump.before} → ${after}`);

    /* ============================================================ 收尾 */
    const errs = await page.eval("window.__mmErrors || []");
    ok(errs.length === 0, "全程没有页面级报错", errs.length ? JSON.stringify(errs.slice(0, 3)) : "");
} finally {
    await chrome.close();
    await removeDoc(api, docA);
    await removeDoc(api, docB);
}

console.log("");
if (fail === 0) {
    console.log(`画布与工具交互增强验收通过 ✓  共 ${pass} 项断言`);
} else {
    console.error(`${fail} 项失败，${pass} 项通过`);
    process.exitCode = 1;
}
