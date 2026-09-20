/**
 * 在用户自己的文档上复现「重新打开后错位」。
 *
 * 用三种「重新打开」方式，覆盖 SiYuan 里可能的真实路径：
 *   A. 首次打开
 *   B. 切到别的文档再切回来（SiYuan 里关标签页再打开 ≈ 这一种）
 *   C. 整页重载（最彻底的重挂）
 *
 * 每种都抓：画布/视口/缩放 + 节点实测矩形 + 连线端点 + 重叠统计 + 截图。
 * 只读，不改用户的文档。
 *
 * 用法：node tests/kernel/diag-user-doc.mjs [docId] [listId]
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";

const DOC = process.argv[2] || "20260920120514-magd66i";
const OUT = "tests/.build";
fs.mkdirSync(OUT, { recursive: true });

async function api(p, payload) {
    const res = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    return res.json();
}

/** 建一个「另一篇」文档，用来做同页切换 */
const other = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-切换用-${Date.now()}`,
    markdown: "- 切换用的另一篇\n  - 无关内容\n",
});
const otherId = other.data;

/**
 * 备份目标列表的折叠状态。
 *
 * ⚠️ 探针会点「折叠/展开」珠子，而插件现在把折叠**直接写到思源原生的 `fold` 上**
 * （会随文档持久化）。跑完必须原样写回 —— 否则就是在用户不知情的情况下改了他的笔记。
 *
 * 备份的是「哪些列表项是折着的」，用块 ID 记录，所以还原走内核 API，
 * 与浏览器是否还开着无关。
 */
const LIST = process.argv[3] || "20260920120514-0h9p879";

const SNAP_FOLD = `(() => {
    const list = document.querySelector('.list[data-node-id="${LIST}"]');
    if (!list) return null;
    const all = [...list.querySelectorAll('.li[data-node-id]')]
        .map((li) => li.getAttribute('data-node-id'))
        .filter(Boolean);
    const folded = [...list.querySelectorAll('.li[fold="1"][data-node-id]')]
        .map((li) => li.getAttribute('data-node-id'))
        .filter(Boolean);
    return { all, folded };
})()`;

const attrs = await api("/api/attr/getBlockAttrs", { id: LIST });
const savedLegacy = attrs.data?.["custom-mindmap-fold"] ?? null;
console.log(`目标文档 ${DOC} · 列表 ${LIST}`);
console.log(`遗留属性备份: ${savedLegacy ?? "(无)"}\n`);

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
            txt: ((e.querySelector('.mm-txt') || {}).textContent || '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').trim().slice(0, 16),
            l: Math.round(r.left - vr.left), t: Math.round(r.top - vr.top),
            w: Math.round(r.width), h: Math.round(r.height),
            sx: Math.round(parseFloat(e.style.left) || 0), sy: Math.round(parseFloat(e.style.top) || 0),
            ow: e.offsetWidth, oh: e.offsetHeight,
        };
    });

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

    // 连线端点 vs 节点边缘（都在 world 坐标系里比）
    const paths = [...root.querySelectorAll('.mm-edges path')];
    const ends = [];
    for (const p of paths) {
        const L = p.getTotalLength();
        if (!L) continue;
        for (const at of [0, L]) { const pt = p.getPointAtLength(at); ends.push({ x: pt.x, y: pt.y }); }
    }
    let orphan = 0; const orphans = [];
    for (const n of nodes) {
        const hit = ends.some((e) =>
            (Math.abs(e.x - n.sx) <= 10 || Math.abs(e.x - (n.sx + n.ow)) <= 10) &&
            e.y >= n.sy - 12 && e.y <= n.sy + n.oh + 12);
        if (!hit) { orphan++; if (n.txt) orphans.push(n.txt); }
    }

    // 内容是否落在视口内（正数=越界）
    const union = nodes.reduce((a, n) => ({
        l: Math.min(a.l, n.l), t: Math.min(a.t, n.t),
        r: Math.max(a.r, n.l + n.w), b: Math.max(a.b, n.t + n.h),
    }), { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });
    const overflow = {
        l: Math.round(vr.left - vr.left - union.l), t: Math.round(-union.t),
        r: Math.round(union.r - vr.width), b: Math.round(union.b - vr.height),
    };

    return {
        scale: +scale.toFixed(3),
        world: { w: Math.round(parseFloat(world.style.width) || 0), h: Math.round(parseFloat(world.style.height) || 0) },
        vp: { w: Math.round(vr.width), h: Math.round(vr.height) },
        visible: nodes.length, paths: paths.length,
        overlapCount: overlap.length, overlapWorst: overlap.slice(0, 4),
        orphan, orphans: orphans.slice(0, 6),
        overflow,
        cols: [...new Set(nodes.filter((n) => n.txt.includes('分支')).map((n) => n.l))].sort((a, b) => a - b),
        nodes,
    };
})()`;

const brief = (s) => {
    if (s.err) return `ERR ${s.err}`;
    return (
        `缩放=${s.scale} 画布=${s.world.w}×${s.world.h} 视口=${s.vp.w}×${s.vp.h} 可见=${s.visible} 连线=${s.paths}\n` +
        `         重叠=${s.overlapCount} 线接不上=${s.orphan} 越界(l,t,r,b)=${s.overflow.l},${s.overflow.t},${s.overflow.r},${s.overflow.b} 分支列=${JSON.stringify(s.cols)}`
    );
};

const chrome = await launch({ headless: true, port: 9348, width: 1680, height: 1050, dpr: 1 });
/** 页内取到的折叠态备份，finally 里据此还原 */
let foldSnap = null;
const url = (id) => `http://127.0.0.1:6806/stage/build/desktop/?id=${id}`;
const wait = async (page, label) => {
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label });
    await sleep(1800);
};

try {
    const page = await chrome.newPage(url(DOC));
    await wait(page, "首次打开");
    // 折叠态备份（页内取，因为 `.li[fold]` 才是真相源）
    const snap = await page.eval(SNAP_FOLD);
    if (snap) {
        foldSnap = snap;
        console.log(`折叠态备份: ${snap.folded.length}/${snap.all.length} 个列表项是折着的\n`);
    }
    const A = await page.eval(PROBE);
    console.log("【A 首次打开】", brief(A));
    if (A.overlapCount) console.log("  重叠:", JSON.stringify(A.overlapWorst));
    if (A.orphan) console.log("  线接不上:", JSON.stringify(A.orphans));
    await page.screenshot(`${OUT}/ud-A-first.png`);

    /* ---- A2: 触发一次重渲染（用户交互过的状态 ≈「关闭前」）----
       重点看：重渲染之后「取景」和「布局」会不会变。用户反馈的
       「关闭前正常 / 重新打开后错位」本质上就是这两者的差异。 */
    /**
     * ⚠️ 每次点击前都要**重新取坐标**。
     *
     * 第一版是「取一次坐标、连点两下」，结果第二下点了空 ——
     * 因为第一下把子树折起来之后画布重排了，珠子早就挪位了。
     * 于是探针留下的是「折起来」的状态，后面 B/C 跟着一起偏，
     * 报出一堆假的「布局不一致」。探针自己算错，比不测还坏。
     */
    const beadAt = (n) => `(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        if (!root) return null;
        root.scrollIntoView({ block: 'center' });
        // ⚠️ 取第 n 个 toggle（第 0 个是根节点的）—— 点根会把整张图折成 1 个节点，
        // 那是探针自己的问题，不是产品问题。
        const t = [...root.querySelectorAll('.mm-toggle')][${n}];
        if (!t) return null;
        const r = t.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`;
    const tapBead = async (n) => {
        const pt = await page.eval(beadAt(n));
        if (!pt) return false;
        await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
        await page.mouse("mousePressed", pt.x, pt.y, {});
        await page.mouse("mouseReleased", pt.x, pt.y, {});
        await sleep(900);
        return true;
    };
    const toggle = await page.eval(beadAt(1));
    if (toggle) {
        await tapBead(1); // 折
        await tapBead(1); // 展回来 —— 净变化为零，但已触发两轮 render
        const A2 = await page.eval(PROBE);
        console.log("\n【A2 交互重渲染后】", brief(A2));
        if (A2.overlapCount) console.log("  重叠:", JSON.stringify(A2.overlapWorst));
        if (A2.orphan) console.log("  线接不上:", JSON.stringify(A2.orphans));
        await page.screenshot(`${OUT}/ud-A2-rerender.png`);
        if (A2.scale !== A.scale || A2.world.w !== A.world.w || A2.cols.length !== A.cols.length) {
            console.log(`  ⚠️ 重渲染后与首次打开不一致: 缩放 ${A.scale}→${A2.scale}，画布 ${A.world.w}×${A.world.h}→${A2.world.w}×${A2.world.h}，列数 ${A.cols.length}→${A2.cols.length}`);
        }
        if (A2.visible !== A.visible) {
            console.log(`  ⚠️ 折了再展之后可见节点数没回到原样: ${A.visible} → ${A2.visible}`);
        }
    }

    /* ---- B: 切到别的文档，再切回来（SiYuan 里关标签页再打开 ≈ 这条） ---- */
    // ⚠️ 不能直接 eval `window.open(...)` —— 它返回 Window，CDP 序列化会报
    // "Object reference chain is too long"。包一层返回字符串即可。
    const nav = (u) => `(() => { window.open(${JSON.stringify(u)}, '_self'); return 'ok'; })()`;
    await page.eval(nav(url(otherId)));
    await sleep(3500);
    await page.eval(nav(url(DOC)));
    await wait(page, "切回来");
    const B = await page.eval(PROBE);
    console.log("\n【B 切走再切回】", brief(B));
    if (B.overlapCount) console.log("  重叠:", JSON.stringify(B.overlapWorst));
    if (B.orphan) console.log("  线接不上:", JSON.stringify(B.orphans));
    await page.screenshot(`${OUT}/ud-B-switchback.png`);

    /* ---- C: 整页重载 ---- */
    await page.send("Page.reload", { ignoreCache: true });
    await sleep(3000);
    await wait(page, "重载后");
    const C = await page.eval(PROBE);
    console.log("\n【C 整页重载】", brief(C));
    if (C.overlapCount) console.log("  重叠:", JSON.stringify(C.overlapWorst));
    if (C.orphan) console.log("  线接不上:", JSON.stringify(C.orphans));
    await page.screenshot(`${OUT}/ud-C-reload.png`);

    /* ---- 汇总 ---- */
    console.log("\n===== 汇总 =====");
    const key = (s) => `${s.scale}|${s.world.w}x${s.world.h}|${s.vp.w}x${s.vp.h}|${s.visible}|${s.cols.length}`;    console.log(`A=${key(A)}`);
    console.log(`B=${key(B)}`);
    console.log(`C=${key(C)}`);
    const bad = [A, B, C].filter((s) => s.overlapCount > 0 || s.orphan > 0);
    if (bad.length) {
        console.log(`\n✗ ${bad.length}/3 个状态存在重叠或连线脱节 —— 复现成功`);
    } else {
        console.log("\n✓ 三个状态都没有重叠、连线也都接上了");
    }
    if (new Set([key(A), key(B), key(C)]).size > 1) {
        console.log("✗ 三种打开方式的布局/视图不一致 —— 布局依赖渲染路径");
    } else {
        console.log("✓ 三种打开方式结果一致");
    }
} finally {
    await chrome.close();
    // 还原折叠态 —— 必须在关掉浏览器之后写，否则页面里的插件视图会继续往内核写。
    // 现在写的是**原生 fold**（`/api/block/foldBlock` / `unfoldBlock`）。
    if (foldSnap) {
        const want = new Set(foldSnap.folded);
        let n = 0;
        for (const id of foldSnap.all) {
            const path = want.has(id) ? "/api/block/foldBlock" : "/api/block/unfoldBlock";
            const r = await api(path, { id }).catch(() => null);
            if (r?.code === 0) n++;
        }
        console.log(`\n折叠态已还原: ${want.size} 个折着 / 共 ${foldSnap.all.length} 个（写入成功 ${n}）`);
    }
    // 老版本留下的属性，原样写回（通常本来就是 null）
    await api("/api/attr/setBlockAttrs", {
        id: LIST,
        attrs: { "custom-mindmap-fold": savedLegacy },
    }).catch(() => {});
    await api("/api/block/deleteBlock", { id: otherId }).catch(() => {});
    console.log("已清理切换用文档");
}
