/**
 * 真 GPU 下的清晰度对照。
 *
 * 背景：用户截图里，导图节点所在的子树整体发虚，而同一张截图里没被缩放的
 * 工具条文字是锐的（1:1 裁切后 Laplacian 边缘能量 1682 vs 139）。
 * 说明「放大变模糊」不是字体渲染问题，而是整棵子树被当成位图放大。
 *
 * 但无头 Chrome 走 SwiftShader 软件合成，复现不出来（zoom 与 transform:scale
 * 测出来一样锐）。所以这个脚本开一个**有头**浏览器，用真实 GPU 合成，
 * 在同一页面同一缩放比下把两种写法各截一张，直接比边缘能量。
 *
 * 用法：node tests/live-gpu.mjs
 *   会短暂弹出一个 Chrome 窗口，跑完自动关掉。
 */

import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "./cdp.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const SHOT_DIR = "tests/.build/gpu";

const conf = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || (conf.api && conf.api.token) || "";

async function api(p, payload) {
    const res = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    const json = await res.json();
    if (json.code !== 0) throw new Error(`${p}: ${json.code} ${json.msg}`);
    return json.data;
}

const MD = [
    "- 终极思考",
    "  - 环境选择",
    "    - 132",
    "      - 1231",
    "  - 123",
    "",
].join("\n");

const docId = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-GPU清晰度-${Date.now()}`,
    markdown: MD,
});
const list = (await api("/api/block/getChildBlocks", { id: docId })).find((k) => k.type === "l");
await api("/api/attr/setBlockAttrs", { id: list.id, attrs: { "custom-mindmap": "mind" } });

fs.mkdirSync(SHOT_DIR, { recursive: true });

// 有头 + 真 GPU
const chrome = await launch({ headless: false, gpu: true, port: 9335, width: 1400, height: 900, dpr: 1 });
let page;
try {
    page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000 });
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 30000 });
    console.log("导图已挂载");

    // 缩放到 ~460%
    for (let i = 0; i < 9; i++) {
        await page.click('.mm-zoombar button[data-mm-tip="放大"]');
        await sleep(80);
    }
    await sleep(600);
    console.log("缩放标签:", await page.eval("document.querySelector('.mm-zoom-label')?.textContent"));

    const gpuInfo = await page.eval(`(() => {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl');
        const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
        return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl ? 'webgl ok' : 'no webgl');
    })()`);
    console.log("渲染器:", gpuInfo);

    // 把目标节点挪到视口中间，几次截图位置一致
    const centerNode = () => page.eval(`(() => {
        const w = document.querySelector('.mm-root .mm-world');
        const n = document.querySelector('.mm-root .mm-node');
        const vp = document.querySelector('.mm-root .mm-viewport');
        const k = parseFloat(w.style.zoom || '1');
        const nx = parseFloat(n.style.left), ny = parseFloat(n.style.top);
        const tx = vp.clientWidth / 2 - (nx + n.offsetWidth / 2) * k;
        const ty = vp.clientHeight / 2 - (ny + n.offsetHeight / 2) * k;
        w.style.transform = 'translate(' + tx / k + 'px,' + ty / k + 'px)';
        return { tx, ty, k };
    })()`);

    /** 把当前 zoom 写法换成旧写法：zoom:1 + transform:translate(...)scale(k) */
    const toScale = (extraCss) => page.eval(`(() => {
        const w = document.querySelector('.mm-root .mm-world');
        if (w.dataset.saved) return 'already';
        const k = parseFloat(w.style.zoom || '1');
        const m = new DOMMatrix(getComputedStyle(w).transform);
        w.dataset.saved = JSON.stringify({ zoom: w.style.zoom, transform: w.style.transform });
        w.style.zoom = '1';
        w.style.willChange = 'transform';
        w.style.transform = 'translate(' + m.m41 * k + 'px,' + m.m42 * k + 'px) scale(' + k + ')';
        const st = document.createElement('style');
        st.id = 'ab-extra';
        st.textContent = ${JSON.stringify(extraCss)};
        document.head.appendChild(st);
        return 'ok';
    })()`);

    const backToZoom = () => page.eval(`(() => {
        const w = document.querySelector('.mm-root .mm-world');
        const prev = JSON.parse(w.dataset.saved || '{}');
        w.style.zoom = prev.zoom || '1';
        w.style.transform = prev.transform || '';
        w.style.willChange = '';
        delete w.dataset.saved;
        document.getElementById('ab-extra')?.remove();
        return true;
    })()`);

    /** 交互式改缩放：连着改几次，模拟用户滚轮放大，逼合成器重新栅格化 */
    const jiggleScale = async () => {
        for (const k of [4.2, 4.6, 5.0, 5.19]) {
            await page.eval(`(() => {
                const w = document.querySelector('.mm-root .mm-world');
                const m = new DOMMatrix(getComputedStyle(w).transform);
                const cur = Math.hypot(m.a, m.b) || 1;
                const tx = m.m41 / cur, ty = m.m42 / cur;
                w.style.transform = 'translate(' + tx * ${k} + 'px,' + ty * ${k} + 'px) scale(' + ${k} + ')';
                return true;
            })()`);
            await sleep(180);
        }
    };

    const shot = async (name) => {
        await sleep(700);
        await page.screenshot(`${SHOT_DIR}/${name}.png`);
        console.log("截图 ->", `${SHOT_DIR}/${name}.png`);
    };

    /* ---- A：当前写法（zoom），交互式放大 ---- */
    await centerNode();
    for (let i = 0; i < 3; i++) {
        await page.click('.mm-zoombar button[data-mm-tip="放大"]');
        await sleep(180);
    }
    await centerNode();
    await shot("A-zoom");

    /* ---- B：旧写法全套（scale + will-change + 三个 backdrop-filter） ---- */
    await toScale(
        ".mm-root .mm-zoombar,.mm-root .mm-minimap,.mm-root .mm-search{backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}",
    );
    await jiggleScale();
    await centerNode();
    await shot("B-scale-willchange-backdrop");

    /* ---- C：只去掉 backdrop-filter ---- */
    await page.eval(`(() => { const s = document.getElementById('ab-extra'); if (s) s.textContent = ''; return true })()`);
    await jiggleScale();
    await centerNode();
    await shot("C-scale-willchange");

    /* ---- D：再去掉 will-change ---- */
    await page.eval(`(() => { document.querySelector('.mm-root .mm-world').style.willChange = ''; return true })()`);
    await jiggleScale();
    await centerNode();
    await shot("D-scale-plain");

    await backToZoom();
    await shot("E-zoom-again");

    console.log("\n用 PIL 比较 tests/.build/gpu/*.png 的 Laplacian 边缘能量。");

} finally {
    await chrome.close();
    try {
        const info = await api("/api/block/getBlockInfo", { id: docId });
        await api("/api/filetree/removeDoc", { notebook: info.box, path: info.path });
        console.log("已清理临时文档");
    } catch (err) {
        console.warn("清理失败:", err.message, docId);
    }
}
