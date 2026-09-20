/**
 * 几何自检：默认态下画布内容是否真的落在视口里？
 *
 * 起因：v2-01 截图里 9 个分支的右边缘看起来几乎贴到面板右边界，而按
 * `worldW=661` / 视口宽 ≈1128 推算，内容应该只占 79% 宽、两侧留白很足。
 * 数字和观感对不上，就得量，不能猜。
 *
 * 这里同时给出两套证据：
 *   A. 布局侧的 worldW/H、scale、tx/ty（插件的自我认知）
 *   B. DOM 侧每个可见节点的 getBoundingClientRect 并集（浏览器的事实）
 * 两者不一致 = 测量宽度小于渲染宽度，属于真 bug。
 *
 * 用法：node tests/kernel/diag-geom.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";

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
const children = async (id) => {
    const j = await api("/api/block/getChildBlocks", { id });
    return j.code === 0 ? j.data : [];
};

const BRANCHES = 9;
const PER = 6;

const md = ["- 几何自检 · 大纲导图"];
for (let i = 1; i <= BRANCHES; i++) {
    md.push(`  - 分支 ${i} · 一个有点长的主题标题文字`);
    for (let j = 1; j <= PER; j++) md.push(`    - 条目 ${i}.${j}：用来观察排版、连线与层级的说明文字`);
}
md.push("");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-几何自检-${Date.now()}`,
    markdown: md.join("\n"),
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

const GEOM = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return { err: 'no root' };
    const vp = root.querySelector('.mm-viewport');
    const world = root.querySelector('.mm-world');
    const vr = vp.getBoundingClientRect();

    const shown = [...root.querySelectorAll('.mm-node')].filter((el) => el.style.visibility !== 'hidden');
    const rects = shown.map((el) => el.getBoundingClientRect());
    const union = rects.reduce((a, r) => ({
        l: Math.min(a.l, r.left), t: Math.min(a.t, r.top),
        r: Math.max(a.r, r.right), b: Math.max(a.b, r.bottom),
    }), { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity });

    // 每个节点相对视口的越界量（正数 = 超出）
    const over = rects.map((r) => ({
        l: vr.left - r.left, t: vr.top - r.top,
        r: r.right - vr.right, b: r.bottom - vr.bottom,
    }));
    const worst = over.reduce((a, o) => ({
        l: Math.max(a.l, o.l), t: Math.max(a.t, o.t),
        r: Math.max(a.r, o.r), b: Math.max(a.b, o.b),
    }), { l: -Infinity, t: -Infinity, r: -Infinity, b: -Infinity });

    return {
        vp: { w: Math.round(vr.width), h: Math.round(vr.height), l: Math.round(vr.left), t: Math.round(vr.top) },
        world: { w: Math.round(parseFloat(world.style.width) || 0), h: Math.round(parseFloat(world.style.height) || 0) },
        scale: +(parseFloat(world.style.zoom) || 1).toFixed(3),
        transform: world.style.transform,
        content: {
            w: Math.round(union.r - union.l), h: Math.round(union.b - union.t),
            l: Math.round(union.l - vr.left), t: Math.round(union.t - vr.top),
        },
        visible: shown.length,
        worstOverflow: { l: Math.round(worst.l), t: Math.round(worst.t), r: Math.round(worst.r), b: Math.round(worst.b) },
    };
})()`;

const chrome = await launch({ headless: true, port: 9345, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图" });
    await sleep(1600);

    const g = await page.eval(GEOM);
    console.log("默认态几何:", JSON.stringify(g, null, 2));

    const wRatio = g.content.w / g.vp.w;
    const hRatio = g.content.h / g.vp.h;
    console.log(`\n内容占视口：宽 ${(wRatio * 100).toFixed(1)}%  高 ${(hRatio * 100).toFixed(1)}%`);
    console.log(`布局自称画布：${g.world.w}×${g.world.h}（缩放 ${g.scale}）→ 应为 ${Math.round(g.world.w * g.scale)}×${Math.round(g.world.h * g.scale)}`);
    console.log(`DOM 实测内容：${g.content.w}×${g.content.h}`);
    // ⚠️ 别拿 content.w 直接比 world.w —— 画布两侧各留 padX=72 的内边距，
    // 差 144px 是正常的。第一版这里就误报了一次「测量宽度不符」。
    const PAD_X = 72;
    const expected = Math.max(0, g.world.w - PAD_X * 2) * g.scale;
    const dw = Math.abs(g.content.w - expected);
    console.log(`宽差 ${Math.round(dw)}px（已扣除左右各 ${PAD_X}px 内边距）${dw > 8 ? "  ⚠️ 测量宽度与实际渲染不符" : "  ✓ 一致"}`);
    console.log(`越界量（正数=超出视口）：${JSON.stringify(g.worstOverflow)}`);
    const over = Math.max(g.worstOverflow.l, g.worstOverflow.t, g.worstOverflow.r, g.worstOverflow.b);
    console.log(over > 2 ? `⚠️ 有内容超出视口 ${over}px` : "✓ 全部内容都在视口内");
} finally {
    await chrome.close();
    await api("/api/filetree/removeDoc", { notebook: NOTEBOOK, path: `/临时-几何自检-${docId}.sy` }).catch(() => {});
    await api("/api/block/deleteBlock", { id: docId }).catch(() => {});
    console.log("\n已清理临时文档");
}
