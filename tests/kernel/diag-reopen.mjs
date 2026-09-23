/**
 * 复现两个真机反馈：
 *   1. 重新打开文档后，已展开的节点显示错位
 *   2. 双击进入编辑态后，再次点击会退出编辑态
 *
 * 判据全部量化，不靠肉眼：
 *   · 错位   → 可见节点两两矩形求交，统计重叠对数 / 最大重叠面积
 *   · 错位   → 每条连线路径的端点，是否落在某个节点边缘上（没落上的就是「线飘了」）
 *   · 错位   → 同一份数据、同样折叠态下，两次挂载的节点坐标是否逐点相同（布局是否确定性）
 *   · 编辑   → 双击后 editing=true；再单击一次后 editing 是否仍为 true
 *
 * 用法：node tests/kernel/diag-reopen.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";

/**
 * 本支的判定**要能传出去**。
 *
 * `ux:all` 是用 `&&` 串起来的 —— 脚本只要 exit 0，链子就继续往下走。
 * 原先这里的三处 ✗ 只 `console.log`，于是「布局依赖渲染次序」「单击就退出编辑态」
 * 这些**真机反馈复现出来的**判定，红了也没人知道。
 *
 * ⚠️ 用 `process.exitCode` 而不是 `process.exit()`：后者会跳过 finally 里的
 *    `chrome.close()` 与 `removeDoc()`，临时文档就留在用户工作空间里了。
 */
let failed = false;

async function api(p, payload) {
    const res = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    return res.json();
}
const children = async (id) => {
    const j = await api("/api/block/getChildBlocks", { id });
    return j.code === 0 ? j.data : [];
};

const OUT = "tests/.build";
fs.mkdirSync(OUT, { recursive: true });

const BRANCHES = 9;
const PER = 6;

const md = ["- 错位复现 · 大纲导图"];
for (let i = 1; i <= BRANCHES; i++) {
    md.push(`  - 分支 ${i} · 一个有点长的主题标题文字`);
    for (let j = 1; j <= PER; j++) md.push(`    - 条目 ${i}.${j}：用来观察排版、连线与层级的说明文字`);
}
md.push("");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-错位复现-${Date.now()}`,
    markdown: md.join("\n"),
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });
console.log(`文档 ${docId} · 列表 ${listId} · 共 ${1 + BRANCHES + BRANCHES * PER} 个节点\n`);

/**
 * 一次抓齐：画布认知 + 每个可见节点的实测矩形 + 连线端点 + 重叠统计。
 *
 * 重叠用「两两矩形求交」而不是看截图 —— 错位的本质就是「布局以为的尺寸」
 * 与「实际渲染的尺寸」对不上，重叠面积是最直接的度量。
 */
const PROBE = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return { err: 'no root' };
    const vp = root.querySelector('.mm-viewport');
    const world = root.querySelector('.mm-world');
    const vr = vp.getBoundingClientRect();
    const scale = parseFloat(world.style.zoom) || 1;

    const els = [...root.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden');
    const nodes = els.map((e) => {
        const r = e.getBoundingClientRect();
        return {
            // ⚠️ 导图节点用 data-mm-id（dataset.mmId），不是 data-node-id ——
            //    见 src/core/renderer.ts 的长注释。原先读错，这里恒为空串，
            //    虽然当前断言只按 txt 对齐、没被暴露，但留着就是个哑弹。
            //    （本段在 page.eval 的模板字符串里，注释里不能出现反引号。）
            id: e.dataset.mmId || '',
            txt: ((e.querySelector('.mm-txt') || {}).textContent || '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').trim().slice(0, 14),
            l: Math.round(r.left - vr.left), t: Math.round(r.top - vr.top),
            w: Math.round(r.width), h: Math.round(r.height),
            // 布局侧的内联坐标，用来判断「布局算的」与「实际渲染的」是否一致
            sx: Math.round(parseFloat(e.style.left) || 0),
            sy: Math.round(parseFloat(e.style.top) || 0),
            ow: e.offsetWidth, oh: e.offsetHeight,
        };
    });

    /* 重叠统计 */
    const overlap = [];
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            const ox = Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l);
            const oy = Math.min(a.t + a.h, b.t + b.h) - Math.max(a.t, b.t);
            if (ox > 2 && oy > 2) overlap.push({ a: a.txt, b: b.txt, area: ox * oy });
        }
    }
    overlap.sort((x, y) => y.area - x.area);

    /* 连线端点：每条 path 的起点与终点，是否落在某个节点的边缘上。
       ⚠️ path 的坐标是 **world 用户坐标系**，节点的 style.left/top 也是 —— 两边都在
       world 里，直接比就行，不要乘 scale、不要加偏移（第一版就是这么比错的，
       结果 attached=0 全是假阴性）。 */
    const paths = [...root.querySelectorAll('.mm-edges path')];
    const ends = [];
    for (const p of paths) {
        const L = p.getTotalLength();
        if (!L) continue;
        for (const at of [0, L]) {
            const pt = p.getPointAtLength(at);
            ends.push({ x: pt.x, y: pt.y });
        }
    }
    let attached = 0, orphan = 0;
    const orphans = [];
    for (const n of nodes) {
        const hit = ends.some((e) =>
            (Math.abs(e.x - n.sx) <= 10 || Math.abs(e.x - (n.sx + n.ow)) <= 10) &&
            e.y >= n.sy - 12 && e.y <= n.sy + n.oh + 12);
        if (hit) attached++; else { orphan++; if (n.txt) orphans.push(n.txt); }
    }

    return {
        scale: +scale.toFixed(3),
        world: { w: Math.round(parseFloat(world.style.width) || 0), h: Math.round(parseFloat(world.style.height) || 0) },
        vp: { w: Math.round(vr.width), h: Math.round(vr.height) },
        visible: nodes.length,
        paths: paths.length,
        overlapCount: overlap.length,
        overlapWorst: overlap.slice(0, 5),
        attached, orphan, orphans: orphans.slice(0, 6),
        // 一级分支落在几个不同的 x 上 = 分了几列
        cols: [...new Set(nodes.filter((n) => n.txt.startsWith('分支')).map((n) => n.l))].sort((a, b) => a - b),
        nodes,
    };
})()`;

/** 只取几何指纹，用于跨挂载比对 */
const fp = (s) => s.nodes.map((n) => `${n.txt}|${n.l},${n.t},${n.w},${n.h}`).sort().join(";");

/** 点工具条按钮（按 data-mm-tip 找），点前先滚到可视区中间 */
const toolButton = (tip) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return null;
    root.scrollIntoView({ block: 'center' });
    const b = [...root.querySelectorAll('button')].find((x) => (x.dataset.mmTip || '').includes(${JSON.stringify(tip)}));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const clickAt = async (page, pos) => {
    await page.mouse("mouseMoved", pos.x, pos.y, { buttons: 0 });
    await page.mouse("mousePressed", pos.x, pos.y, {});
    await page.mouse("mouseReleased", pos.x, pos.y, {});
};

const chrome = await launch({ headless: true, port: 9346, width: 1680, height: 1050, dpr: 1 });
const url = `http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`;

const boot = async (page, label) => {
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: `导图:${label}` });
    await sleep(1800);
    return page.eval(PROBE);
};

const brief = (s) =>
    `scale=${s.scale} 画布=${s.world.w}×${s.world.h} 视口=${s.vp.w}×${s.vp.h} 可见=${s.visible} ` +
    `连线=${s.paths} 重叠=${s.overlapCount} 线接不上=${s.orphan} 分支列=${JSON.stringify(s.cols)}`;

try {
    /* ============================================================ 第一次打开 */
    let page = await chrome.newPage(url);
    const s1 = await boot(page, "首次打开");
    console.log("【首次打开 · 自动折叠】", brief(s1));
    await page.screenshot(`${OUT}/re-01-first.png`);

    /* ---- 展开全部：这是用户「关闭前」的状态（已展开的节点） ---- */
    const btn = await page.eval(toolButton("展开全部"));
    if (!btn) throw new Error("找不到「展开全部」按钮");
    await clickAt(page, btn);
    await sleep(1200);
    const sA = await page.eval(PROBE);
    console.log("【展开后 · 关闭前】", brief(sA));
    if (sA.overlapCount) console.log("  重叠最严重:", JSON.stringify(sA.overlapWorst));
    if (sA.orphan) console.log("  连线没接上的:", JSON.stringify(sA.orphans));
    await page.screenshot(`${OUT}/re-02-expanded-before-close.png`);

    /* ============================================================ 重新打开 */
    await page.send("Page.reload", { ignoreCache: true });
    await sleep(2500);
    const sB = await boot(page, "重新打开");
    console.log("【重新打开 · 错位现场】", brief(sB));
    if (sB.overlapCount) console.log("  重叠最严重:", JSON.stringify(sB.overlapWorst));
    if (sB.orphan) console.log("  连线没接上的:", JSON.stringify(sB.orphans));
    await page.screenshot(`${OUT}/re-03-reopened.png`);

    /* ---- 布局确定性 ---- */
    const same = fp(sA) === fp(sB);
    console.log(`\n布局确定性（同一份数据、同一折叠态）: ${same ? "✓ 坐标一致" : "✗ 坐标不一致 —— 布局依赖渲染次序"}`);
    if (!same) {
        failed = true;
        const m1 = new Map(sA.nodes.map((n) => [n.txt, n]));
        let diff = 0;
        for (const b of sB.nodes) {
            const a = m1.get(b.txt);
            if (!a) continue;
            if (a.l !== b.l || a.t !== b.t || a.w !== b.w || a.h !== b.h) {
                if (diff < 6) console.log(`   ${b.txt}: (${a.l},${a.t}) ${a.w}×${a.h} → (${b.l},${b.t}) ${b.w}×${b.h}`);
                diff++;
            }
        }
        console.log(`   共 ${diff} 个节点位置/尺寸变了（可见 ${sA.visible} → ${sB.visible}）`);
    }
    console.log(`  画布 ${sA.world.w}×${sA.world.h} → ${sB.world.w}×${sB.world.h}`);
    console.log(`  分支列数 ${sA.cols.length} → ${sB.cols.length}  列位置 ${JSON.stringify(sA.cols)} → ${JSON.stringify(sB.cols)}`);

    /* ============================================================ 编辑交互 */
    console.log("\n【编辑交互】");
    const pick = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        if (!root) return null;
        root.scrollIntoView({ block: 'center' });
        const els = [...root.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden');
        const el = els.find((e) => (e.querySelector('.mm-txt') || {}).textContent?.includes('条目 1.2')) || els[1];
        if (!el) return null;
        const t = el.querySelector('.mm-txt');
        const r = t.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: t.textContent.trim().slice(0, 16) };
    })()`);
    if (!pick) {
        console.log("  ✗ 找不到可编辑的节点");
        failed = true;
    } else {
        const state = () => page.eval(`(() => {
            const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
            const ed = root && root.querySelector('.mm-node[data-mm-editing]');
            const txt = root && root.querySelector('.mm-node[data-mm-editing] .mm-txt');
            return {
                editing: !!ed,
                editable: txt ? txt.getAttribute('contenteditable') : null,
                active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName).toString().slice(0, 40) : null,
                sel: window.getSelection ? window.getSelection().toString() : '',
            };
        })()`);

        // 双击进入编辑（真实 dblclick：两次 press/release，clickCount 递增）
        await page.mouse("mouseMoved", pick.x, pick.y, { buttons: 0 });
        for (const cc of [1, 2]) {
            await page.mouse("mousePressed", pick.x, pick.y, { button: "left", clickCount: cc });
            await page.mouse("mouseReleased", pick.x, pick.y, { button: "left", clickCount: cc });
        }
        await sleep(500);
        const a = await state();
        console.log(`  目标「${pick.text}」双击后: editing=${a.editing} editable=${a.editable} active=${a.active} 选中「${a.sel}」`);

        // 再单击一次（用户说的「再次点击」）
        await page.mouse("mousePressed", pick.x, pick.y, { button: "left", clickCount: 1 });
        await page.mouse("mouseReleased", pick.x, pick.y, { button: "left", clickCount: 1 });
        await sleep(500);
        const b = await state();
        console.log(`  再单击一次: editing=${b.editing} editable=${b.editable} active=${b.active}`);
        console.log(b.editing ? "  ✓ 单击不退出编辑态" : "  ✗ 单击就退出编辑态 —— 复现成功（用户反馈 2）");
        if (!b.editing) failed = true;

        // 再点一次，确认能连续编辑
        if (b.editing) {
            await page.mouse("mousePressed", pick.x, pick.y, { button: "left", clickCount: 1 });
            await page.mouse("mouseReleased", pick.x, pick.y, { button: "left", clickCount: 1 });
            await sleep(300);
            const c = await state();
            console.log(`  连点两次: editing=${c.editing} ${c.editing ? "✓" : "✗ 被踢出"}`);
            if (!c.editing) failed = true;
        }
        await page.screenshot(`${OUT}/re-04-edit.png`);
    }
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("\n已清理临时文档");
    // 清理**之后**再设退出码：先设的话也拦不住（exitCode 只影响进程退出码，不中断执行），
    // 但放在这里读起来能一眼看出「清理一定会跑」。
    if (failed) process.exitCode = 1;
}
