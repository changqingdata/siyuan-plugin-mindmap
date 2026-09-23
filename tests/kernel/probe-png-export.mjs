/**
 * 只读探针：`导出 PNG` 到底在哪一步断的？
 *
 * ## 起因
 *
 * 给 `diag-canvas-v2.mjs` 的导出段补真断言时，`导出 SVG` 一次就过
 * （产出了 907×489、含连线层与 12 个节点的 SVG），但 **`导出 PNG` 什么都没产出** ——
 * 下载拦截器里一个 Blob 都没抓到，而 `window.onerror` 也是空的。
 *
 * `exportPng` 的实现是「`buildSvg` → `createObjectURL` → `new Image()` → `canvas.drawImage`
 * → `canvas.toBlob`」，中间任何一步都可能返回 null / reject，而 `doExport` 只把异常
 * 吞成一句 `console.warn("[mindmap] 导出失败")` + 一个 4 秒的 snackbar。
 * 所以「没产出」有三种可能，光看黑盒分不出来：
 *   ① 插件的代码有问题
 *   ② `foreignObject` 在「SVG 当图片加载」时不被光栅化（**这是 Chromium 的已知限制方向**）
 *   ③ 无头 + `--disable-gpu` 的环境限制
 *
 * 这一支把三种可能分开：
 *   1. 真机点一遍 `导出 PNG`，把 `console.warn` 与 snackbar 抓下来（拿到插件自己的报错）
 *   2. 把第 1 步里**同一个 SVG 文本**拿去做一遍等价的光栅化，逐步报错在哪
 *   3. 再做一个**最小对照**：同样尺寸的 SVG，一个含 `foreignObject`、一个只有 `<rect>`，
 *      看是不是「含 foreignObject 就画不出来」
 *
 * 用法：
 *   node tests/kernel/probe-png-export.mjs            # 无头（默认）
 *   MM_HEADFUL=1 node tests/kernel/probe-png-export.mjs   # 有头 + 真实 GPU 合成
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const OUT = "tests/.build";
const HEADFUL = !!process.env.MM_HEADFUL;

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
const kids = async (id) => (await api("/api/block/getChildBlocks", { id })).data ?? [];

const md = ["- 导出验证根", "  - 分支甲", "    - 甲.1", "    - 甲.2", "  - 分支乙", "  - 分支丙", ""].join("\n");
const docRes = await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-导出PNG-${Date.now()}`, markdown: md });
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
const list = (await kids(docId)).filter((k) => k.type === "l")[0];
await api("/api/attr/setBlockAttrs", { id: list.id, attrs: { "custom-mindmap": "logic" } });
console.log(`临时文档 ${docId} ｜列表 ${list.id}`);
console.log(`模式：${HEADFUL ? "有头 + 真实 GPU 合成" : "无头 + --disable-gpu"}\n`);

const ROOT = `document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)')`;

const chrome = await launch({ headless: !HEADFUL, gpu: HEADFUL, port: 9389, width: 1600, height: 1000, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2600);
    await page.waitFor(`${ROOT} !== null`, { timeout: 30000, label: "导图挂载" });
    await sleep(900);

    // 抓插件自己的报错：console.warn + 未处理的 promise 拒绝 + snackbar 文案
    await page.eval(`(() => {
        window.__warns = [];
        window.__rejects = [];
        window.__dl = [];
        window.__dlNames = [];
        const ow = console.warn.bind(console);
        console.warn = (...a) => { window.__warns.push(a.map((x) => (x && x.message) ? x.message : String(x)).join(' ')); ow(...a); };
        window.addEventListener('unhandledrejection', (e) => window.__rejects.push(String(e.reason && e.reason.message || e.reason)));
        const oc = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (b) => { window.__dl.push(b); return oc(b); };
        HTMLAnchorElement.prototype.click = function () { window.__dlNames.push(this.download || ''); };
        return 'ok';
    })()`);

    const toolAt = (tip) => `(() => {
        const root = ${ROOT};
        const b = [...root.querySelectorAll('.mm-icon')].find((e) => (e.dataset.mmTip || '').includes(${JSON.stringify(tip)}));
        if (!b) return { err: 'no button' };
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`;
    const clickAt = async (expr, settle = 400) => {
        const pt = await page.eval(expr);
        if (!pt || pt.err) return pt;
        await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
        await page.mouse("mousePressed", pt.x, pt.y, {});
        await page.mouse("mouseReleased", pt.x, pt.y, {});
        await sleep(settle);
        return pt;
    };
    const clickMenuItem = (text) =>
        page.eval(`(() => {
            const it = [...document.querySelectorAll('.b3-menu .b3-menu__item')].find((x) => (x.textContent || '').trim().includes(${JSON.stringify(text)}));
            if (!it) return 'no-item';
            const r = it.getBoundingClientRect();
            const o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
            it.dispatchEvent(new MouseEvent('mousedown', o));
            it.dispatchEvent(new MouseEvent('mouseup', o));
            it.click();
            return 'clicked';
        })()`);
    const dump = () =>
        page.eval(`(async () => ({
            names: (window.__dlNames || []).slice(),
            warns: (window.__warns || []).slice(),
            rejects: (window.__rejects || []).slice(),
            blobs: await Promise.all((window.__dl || []).map(async (b) => {
                if (/svg/.test(b.type)) return { type: b.type, size: b.size, kind: 'svg' };
                if (/png/.test(b.type)) return { type: b.type, size: b.size, kind: 'png' };
                return { type: b.type, size: b.size, kind: 'other' };
            })),
            toast: [...document.querySelectorAll('.b3-snackbar__content')].map((e) => (e.textContent || '').trim()).join(' | '),
        }))()`, true);
    const resetDl = () => page.eval(`(() => { window.__dl = []; window.__dlNames = []; window.__warns = []; window.__rejects = []; return 'ok'; })()`);

    /* ============================================================ ① 先拿 SVG 文本 */
    console.log("【① 导出 SVG（对照组，已知能成）】");
    await resetDl();
    await clickAt(toolAt("导出图片"));
    console.log("  点「导出 SVG」：", await clickMenuItem("导出 SVG"));
    await sleep(1800);
    const svgText = await page.eval(
        `(async () => { const b = (window.__dl || []).find((x) => /svg/.test(x.type)); return b ? await b.text() : ''; })()`,
        true,
    );
    console.log("  SVG 文本长度：", svgText.length, "｜含 foreignObject：", svgText.includes("foreignObject"));
    fs.writeFileSync(`${OUT}/probe-png-export.svg`, svgText);
    console.log("  已存", `${OUT}/probe-png-export.svg`);

    /* ============================================================ ② 真机点导出 PNG */
    console.log("\n【② 导出 PNG（真机点一遍，抓插件自己的报错）】");
    await resetDl();
    await clickAt(toolAt("导出图片"));
    console.log("  点「导出 PNG」：", await clickMenuItem("导出 PNG"));
    await sleep(3000);
    const pngRun = await dump();
    console.log("  下载文件名：", JSON.stringify(pngRun.names));
    console.log("  抓到的 Blob：", JSON.stringify(pngRun.blobs));
    console.log("  console.warn：", JSON.stringify(pngRun.warns));
    console.log("  未处理 promise 拒绝：", JSON.stringify(pngRun.rejects));
    console.log("  snackbar：", JSON.stringify(pngRun.toast));

    /* ============================================================ ③ 手动重放光栅化 */
    console.log("\n【③ 拿同一个 SVG 手动重放「图片 → canvas」这几步，看断在哪】");
    const replay = await page.eval(
        `(async () => {
            const svg = ${JSON.stringify(svgText)};
            const steps = [];
            const say = (s, v) => steps.push(s + ' → ' + v);
            // a) blob URL 能不能建
            let url = '';
            try { url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })); say('createObjectURL', url.slice(0, 12) + '…'); }
            catch (e) { say('createObjectURL 抛错', e.message); return { steps }; }
            // b) 当图片加载
            const img = await new Promise((res) => {
                const i = new Image();
                i.onload = () => res(i);
                i.onerror = () => res(null);
                i.src = url;
            });
            if (!img) { say('new Image() 加载', '❌ onerror'); URL.revokeObjectURL(url); return { steps }; }
            say('new Image() 加载', '✓ ' + img.naturalWidth + '×' + img.naturalHeight);
            // c) 画到 canvas
            let canvas, ctx;
            try {
                canvas = document.createElement('canvas');
                canvas.width = Math.max(1, img.naturalWidth);
                canvas.height = Math.max(1, img.naturalHeight);
                ctx = canvas.getContext('2d');
                say('getContext("2d")', ctx ? '✓' : '❌ null');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                say('drawImage', '✓');
            } catch (e) { say('drawImage 抛错', e.message); URL.revokeObjectURL(url); return { steps }; }
            // d) 非空白像素占比（0 说明画出来是一张空图）
            try {
                const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                let nonBg = 0;
                for (let i = 0; i < d.length; i += 4) if (d[i] !== 255 || d[i+1] !== 255 || d[i+2] !== 255) nonBg++;
                say('非白像素', nonBg + ' / ' + (d.length / 4) + '（' + (100 * nonBg / (d.length / 4)).toFixed(1) + '%）');
            } catch (e) { say('getImageData 抛错（画布被污染？）', e.message); }
            // e) toBlob —— ⚠️ 必须包 try/catch：污染的画布会**直接抛 SecurityError**，
            //    不包的话整个 page.eval 抛出去，后面的最小对照段就再也跑不到了（第一版就断在这）
            try {
                const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
                say('canvas.toBlob', blob ? '✓ ' + blob.size + ' 字节' : '❌ null');
            } catch (e) { say('canvas.toBlob 抛错', e.message); }
            URL.revokeObjectURL(url);
            return { steps };
        })()`,
        true,
    );
    for (const s of replay.steps) console.log("  ·", s);

    /* ============================================================ ④ 最小对照 */
    console.log("\n【④ 最小对照】");
    const minimal = await page.eval(
        `(async () => {
            const mk = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60">' + inner + '</svg>';
            const FO = '<rect x="0" y="0" width="120" height="60" fill="#ffffff"/><foreignObject x="0" y="0" width="120" height="60"><div xmlns="http://www.w3.org/1999/xhtml" style="font:14px sans-serif">hi</div></foreignObject>';
            /** 用三种「图片源」分别加载同一份 SVG，看污染判定是否一样 */
            const sources = (svg) => ({
                'blob URL': URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })),
                'data URL (encodeURIComponent)': 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
                'data URL (base64)': 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))),
            });
            const probe = async (src) => {
                const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
                if (!img) return '图片加载失败';
                const c = document.createElement('canvas');
                c.width = 120; c.height = 60;
                const cx = c.getContext('2d');
                cx.drawImage(img, 0, 0);
                let dirty;
                try {
                    const d = cx.getImageData(0, 0, 120, 60).data;
                    let nonBg = 0;
                    for (let i = 0; i < d.length; i += 4) if (d[i] !== 255 || d[i+1] !== 255 || d[i+2] !== 255) nonBg++;
                    dirty = '可读，非白像素 ' + nonBg;
                } catch (e) { dirty = '❌ 被污染（' + e.name + '）'; }
                let blobInfo;
                try {
                    const b = await new Promise((res) => c.toBlob(res, 'image/png'));
                    blobInfo = b ? '✓ toBlob ' + b.size + ' 字节' : 'toBlob null';
                } catch (e) { blobInfo = '❌ toBlob 抛错'; }
                return blobInfo + '｜' + dirty;
            };

            const out = { cases: {}, sources: {} };
            // ① 内容维度的对照（都用 blob URL）
            const cases = {
                '纯 rect': mk('<rect x="0" y="0" width="120" height="60" fill="#ff0000"/>'),
                'text 元素': mk('<rect x="0" y="0" width="120" height="60" fill="#ffffff"/><text x="10" y="30" fill="#000">hi</text>'),
                'foreignObject': mk(FO),
                '@font-face 相对 url': '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><style>@font-face{font-family:K;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2")}</style><rect width="120" height="60" fill="#eee"/></svg>',
            };
            for (const [name, svg] of Object.entries(cases)) {
                const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
                out.cases[name] = await probe(url);
                URL.revokeObjectURL(url);
            }
            // ② 同一个 foreignObject 内容，换三种图片源 —— 这一组决定「能不能一行修好」
            for (const [name, src] of Object.entries(sources(mk(FO)))) {
                out.sources[name] = await probe(src);
                if (src.startsWith('blob:')) URL.revokeObjectURL(src);
            }
            return out;
        })()`,
        true,
    );
    console.log("\n【④ 内容维度对照（都用 blob URL）】");
    for (const [k, v] of Object.entries(minimal.cases)) console.log(`  · ${k}：${v}`);
    console.log("\n【⑤ 同一个 foreignObject，换三种图片源（决定能不能一行修好）】");
    for (const [k, v] of Object.entries(minimal.sources)) console.log(`  · ${k}：${v}`);

    /* ============================================================ ⑥ 2 倍导出值不值得修 */
    // 背景：`renderPngBlob` 原来写的是 `Math.min(scale, maxSide / max(W,H), 1)`，
    // 尾部那个 1 把倍率封死在 ≤1，于是「2 倍高清导出」从来没生效过（已修）。
    // 但修之前得先回答一个**渲染质量**问题，不能靠推断：
    // Chromium 把 SVG 当图片 `drawImage` 到 2 倍画布时，到底是
    //   ① 按目标尺寸**重新光栅化**（→ 2 倍是真的更清晰，值得修）
    //   ② 先按固有尺寸光栅化，再把那张位图**放大**（→ 2 倍只是变大，白修）
    // 做法：把同一份 SVG 分别按这两条路各画一张 2 倍图，逐像素比。
    // 若 ① 成立，两张图会有大量像素差异；若 ② 成立，两张图几乎逐像素相同。
    console.log("\n【⑥ 2 倍导出：SVG 会按目标尺寸重新光栅化，还是把 1 倍位图放大？】");
    const sharp = await page.eval(
        `(async () => {
            const svg = ${JSON.stringify(svgText)};
            const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
            const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
            if (!img) return { err: 'SVG 加载失败' };
            const W = img.naturalWidth, H = img.naturalHeight;
            // A：直接画进 2 倍画布 —— 修复后 renderPngBlob 的做法
            const a = document.createElement('canvas'); a.width = W * 2; a.height = H * 2;
            const ax = a.getContext('2d'); ax.drawImage(img, 0, 0, W * 2, H * 2);
            // B：先画 1 倍，再把那张**位图**放大到 2 倍 —— 若浏览器按固有尺寸光栅化，A 就约等于 B
            const m = document.createElement('canvas'); m.width = W; m.height = H;
            const mx = m.getContext('2d'); mx.drawImage(img, 0, 0, W, H);
            const b = document.createElement('canvas'); b.width = W * 2; b.height = H * 2;
            const bx = b.getContext('2d'); bx.imageSmoothingEnabled = true; bx.drawImage(m, 0, 0, W * 2, H * 2);

            const da = ax.getImageData(0, 0, W * 2, H * 2).data;
            const db = bx.getImageData(0, 0, W * 2, H * 2).data;
            let diff = 0, n = 0;
            for (let i = 0; i < da.length; i += 4) {
                const d = Math.abs(da[i] - db[i]) + Math.abs(da[i+1] - db[i+1]) + Math.abs(da[i+2] - db[i+2]);
                if (d > 12) diff++;
                n++;
            }
            // 清晰度：灰度梯度均值（边缘越锐越大）
            const grad = (d, w, h) => {
                const g = new Float32Array(w * h);
                for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
                let s = 0, c = 0;
                for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; s += Math.abs(g[i] - g[i-1]) + Math.abs(g[i] - g[i-w]); c++; }
                return s / c;
            };
            const bytes = async (c) => { const bl = await new Promise((r) => c.toBlob(r, 'image/png')); return bl ? bl.size : 0; };
            // 顺手做一张「上 A 下 B」的对照条，肉眼也能看。
            // ⚠️ 裁剪区域必须**自动定位到有内容的地方** —— 第一版写死取左上角 760×200，
            //    结果那一块是空白画布，对照条上什么都看不出来。
            const md = mx.getImageData(0, 0, W, H).data;
            const bg = [md[0], md[1], md[2]];
            let x0 = W, y0 = H, x1 = 0, y1 = 0;
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;
                if (Math.abs(md[i] - bg[0]) + Math.abs(md[i+1] - bg[1]) + Math.abs(md[i+2] - bg[2]) > 24) {
                    if (x < x0) x0 = x; if (x > x1) x1 = x;
                    if (y < y0) y0 = y; if (y > y1) y1 = y;
                }
            }
            if (x1 <= x0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
            // 取内容左上角一块（文字最密的地方），2 倍坐标下 760×220
            const cw = Math.min((x1 - x0 + 1) * 2, 760);
            const ch = Math.min((y1 - y0 + 1) * 2, 220);
            const cx0 = x0 * 2, cy0 = y0 * 2;
            const cmp = document.createElement('canvas'); cmp.width = cw; cmp.height = ch * 2 + 6;
            const cc = cmp.getContext('2d');
            cc.fillStyle = '#ff00ff'; cc.fillRect(0, 0, cw, ch * 2 + 6);
            cc.drawImage(a, cx0, cy0, cw, ch, 0, 0, cw, ch);
            cc.drawImage(b, cx0, cy0, cw, ch, 0, ch + 6, cw, ch);
            return {
                size: W + 'x' + H,
                bbox: x0 + ',' + y0 + ' → ' + x1 + ',' + y1,
                diffPct: (100 * diff / n).toFixed(2),
                gradA: grad(da, W * 2, H * 2).toFixed(3),
                gradB: grad(db, W * 2, H * 2).toFixed(3),
                bytesA: await bytes(a),
                bytesB: await bytes(b),
                cmp: cmp.toDataURL('image/png'),
                full2x: a.toDataURL('image/png'),
            };
        })()`,
        true,
    );
    if (sharp.err) {
        console.log("  ✗", sharp.err);
    } else {
        console.log(`  画布固有尺寸 ${sharp.size} → 2 倍画布 ${Number(sharp.size.split("x")[0]) * 2}×${Number(sharp.size.split("x")[1]) * 2}`);
        console.log(`  有内容的区域（1 倍坐标）${sharp.bbox}`);
        console.log(`  A（按目标尺寸重新光栅化）vs B（1 倍位图放大）：有差异的像素占 ${sharp.diffPct}%`);
        console.log(`  清晰度（灰度梯度均值，越大越锐）：A ${sharp.gradA} vs B ${sharp.gradB}`);
        console.log(`  PNG 体积：A ${Math.round(sharp.bytesA / 1024)} KB vs B ${Math.round(sharp.bytesB / 1024)} KB`);
        console.log(`  结论：${Number(sharp.diffPct) > 2 ? "① 重新光栅化 —— 2 倍是真的更清晰，值得修" : "② 只是把位图放大 —— 2 倍只是变大，修了意义不大"}`);
        fs.writeFileSync(`${OUT}/probe-png-sharp-cmp.png`, Buffer.from(sharp.cmp.split(",")[1], "base64"));
        fs.writeFileSync(`${OUT}/probe-png-2x.png`, Buffer.from(sharp.full2x.split(",")[1], "base64"));
        console.log(`  对照条（上 A 下 B）已存 ${OUT}/probe-png-sharp-cmp.png`);
        console.log(`  修复后的 2 倍成品已存 ${OUT}/probe-png-2x.png`);
    }

    await page.screenshot(`${OUT}/probe-png-export.png`);
    console.log(`\n截图 ${OUT}/probe-png-export.png`);
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}
