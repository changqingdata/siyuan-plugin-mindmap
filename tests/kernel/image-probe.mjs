/**
 * 图片在导图里到底能不能活？—— 真资源实测。
 *
 * 要回答三件事：
 *   1. 列表项里放图片，思源产出的真实 DOM 长什么样
 *   2. 导图侧那个节点还在不在（只有图片没有文字的项会被解析层当空节点丢掉）
 *   3. 图片的 src 有没有被填上 —— 源列表被 display:none 隐藏，
 *      如果思源走的是 IntersectionObserver 懒加载，src 可能永远是空的
 *
 * 用法：node tests/kernel/image-probe.mjs     MM_KEEP=1 保留文档
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

const conf = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";

async function api(p, payload) {
    const res = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    return res.json();
}

async function children(id) {
    const j = await api("/api/block/getChildBlocks", { id });
    return j.code === 0 ? j.data : [];
}

/* 1. 传一张真图当资源
 *
 * ⚠️ 必须用 zlib 老老实实生成、CRC 算对。手写 base64 拼出来的 PNG 如果 CRC 不对，
 * curl / 文件大小检查全都正常，但 **Chromium 会拒绝解码**（naturalWidth 恒为 0），
 * 于是「图片加载不出来」这个结论就完全是自己造出来的假象。
 */
function crc32(buf) {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
function makePng(w, h) {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        const off = y * (w * 3 + 1);
        raw[off] = 0;
        for (let x = 0; x < w; x++) {
            raw[off + 1 + x * 3] = (x * 255) / w;
            raw[off + 2 + x * 3] = (y * 255) / h;
            raw[off + 3 + x * 3] = 128;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}
const PNG = makePng(120, 60);
const fd = new FormData();
fd.append("assetsDirPath", "/assets/");
fd.append("file[]", new Blob([PNG], { type: "image/png" }), "mm-probe.png");
const upRes = await fetch(KERNEL + "/api/asset/upload", {
    method: "POST",
    headers: { Authorization: `Token ${TOKEN}` },
    body: fd,
});
const up = await upRes.json();
console.log("上传资源:", JSON.stringify(up).slice(0, 300));
const assetPath = up.data?.succMap?.["mm-probe.png"] ?? "";
if (!assetPath) throw new Error("资源上传失败，后面没意义");

/* 2. 建文档：一个纯图片项、一个图文混排项 */
const MD = [
    "- 图片测试根",
    `  - ![纯图片](${assetPath})`,
    `  - 图前文字 ![混排图](${assetPath}) 图后文字`,
    "",
].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-图片探针-${Date.now()}`,
    markdown: MD,
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "mind" } });
console.log("文档:", docId, "列表:", listId, "资源:", assetPath);

const chrome = await launch({ headless: true, port: 9338, width: 1600, height: 1000, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "protyle" });
    const ok = await page
        .waitFor("!!document.querySelector('.mm-root')", { timeout: 30000, label: "导图" })
        .then(() => true)
        .catch(() => false);
    if (!ok) throw new Error("导图没挂载");
    await sleep(1500);

    console.log("\n================ 源列表 DOM（不截断）================");
    const srcDump = await page.eval(`(() => {
        const list = document.querySelector('.list[data-node-id="${listId}"]');
        return Array.from(list.querySelectorAll('.li')).map(li => {
            const c = Array.from(li.children).find(e => e.hasAttribute && e.hasAttribute('data-node-id') && !e.classList.contains('list'));
            return { text: (c?.textContent || '').trim(), html: c ? c.outerHTML : '' };
        });
    })()`);
    for (const d of srcDump) {
        console.log(`\n  ── 文字: ${JSON.stringify(d.text)}`);
        console.log(d.html.replace(/></g, ">\n     <"));
    }

    console.log("\n================ 源列表里 img 的加载状态 ================");
    const imgs = await page.eval(`(() => {
        const list = document.querySelector('.list[data-node-id="${listId}"]');
        return Array.from(list.querySelectorAll('img')).map(i => {
            const r = i.getBoundingClientRect();
            return { src: i.getAttribute('src'), dataSrc: i.getAttribute('data-src'), loading: i.getAttribute('loading'),
                     complete: i.complete, naturalW: i.naturalWidth, rect: [Math.round(r.width), Math.round(r.height)],
                     display: getComputedStyle(i).display, offsetParent: !!i.offsetParent };
        });
    })()`);
    console.log(JSON.stringify(imgs, null, 2));

    console.log("\n================ 导图侧 ================");
    const got = await page.eval(`(() => {
        return Array.from(document.querySelectorAll('.mm-root:not(.mm-root--dialog) .mm-node')).map(el => {
            const txt = el.querySelector('.mm-txt');
            const r = el.getBoundingClientRect();
            return { text: (txt?.textContent || '').trim(), html: (txt?.innerHTML || '').slice(0, 200),
                     imgs: txt ? txt.querySelectorAll('img').length : 0, w: Math.round(r.width), h: Math.round(r.height) };
        });
    })()`);
    console.log(JSON.stringify(got, null, 2));
    console.log(`\n  导图节点数: ${got.length}（源列表 3 项 —— 少了就是被当空节点丢了）`);
    console.log(`  导图里 img 元素数: ${got.reduce((a, b) => a + b.imgs, 0)}`);

    // 等图加载完再看一次：导图里那张图到底出没出来
    await sleep(3000);
    const mapImg = await page.eval(`(() => {
        const i = document.querySelector('.mm-root:not(.mm-root--dialog) .mm-txt img');
        if (!i) return '(导图里没有 img)';
        const r = i.getBoundingClientRect();
        return { attrSrc: i.getAttribute('src'), resolved: i.src, complete: i.complete, naturalW: i.naturalWidth,
                 rect: [Math.round(r.width), Math.round(r.height)], loading: i.getAttribute('loading'),
                 parentDisplay: getComputedStyle(i.closest('.mm-txt') || i).display };
    })()`);
    console.log("  导图里那张图（等 3 秒后）:", JSON.stringify(mapImg));
    const getStatus = await page.eval(`fetch('/' + 'assets/' + '${assetPath.split('/').pop()}').then(r => r.status)`, true);
    console.log("  该资源 GET 状态:", getStatus);
    // 同一张图、同一个 URL，用全新 <img> 再加载一次 —— 区分「图本身坏了」和「那个元素的状态坏了」
    const fresh = await page.eval(
        `new Promise(res => { const i = new Image(); i.onload = () => res({ ok: true, w: i.naturalWidth, h: i.naturalHeight });
             i.onerror = (e) => res({ ok: false, msg: String(e && e.message) }); i.src = 'assets/${assetPath.split("/").pop()}'; })`,
        true,
    );
    console.log("  同一个 URL 用全新 Image() 加载:", JSON.stringify(fresh));
    const bypassCache = await page.eval(
        `new Promise(res => { const i = new Image(); i.onload = () => res({ ok: true, w: i.naturalWidth });
             i.onerror = () => res({ ok: false }); i.src = 'assets/${assetPath.split("/").pop()}?t=' + Date.now(); })`,
        true,
    );
    console.log("  加时间戳绕开缓存再加载:", JSON.stringify(bypassCache));
} finally {
    await chrome.close();
    /* ⚠️ 清理放 finally —— 放 try 末尾的话，中间任何一步抛异常（本支要上传资源、
       造文档，抛点很多）都会跳过清理，在用户笔记本里留下「临时-图片探针-时间戳」。
       删文档走 _doc-cleanup 的两步法（getPathByID → removeDoc），
       直接传 {id} 会报「Field [notebook] is required」而被静默吞掉。 */
    if (docId && !process.env.MM_KEEP) {
        const ok = await removeDoc(api, docId);
        console.log(ok ? "\n已清理临时文档" : "\n⚠️ 临时文档未能清理: " + docId);
    } else if (docId) {
        console.log("\nMM_KEEP=1，保留文档:", docId);
    }
}
