/**
 * 「插入即编辑」专项诊断。
 *
 * 造一棵小树（低于自动折叠阈值，排除折叠干扰），点根节点 → 按 Tab →
 * 每 300ms 采一次状态，看清楚「新节点建出来了没有 / 视图有没有被重挂 /
 * pendingEdit 有没有兑现」。
 *
 * 用法：node tests/kernel/diag-insert.mjs
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
const children = async (id) => {
    const j = await api("/api/block/getChildBlocks", { id });
    return j.code === 0 ? j.data : [];
};

const md = ["- 诊断根", "  - 甲分支", "    - 甲一", "    - 甲二", "  - 乙分支", "    - 乙一", "    - 乙二", ""].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-插入诊断-${Date.now()}`,
    markdown: md,
});
const docId = docRes.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });
console.log(`文档 ${docId} · 列表 ${listId}`);

const chrome = await launch({ headless: true, port: 9345, width: 1500, height: 1000, dpr: 1 });
const SNAP = `(() => {
    const list = document.querySelector('.protyle-wysiwyg .list[data-node-id="${listId}"]');
    const root = document.querySelector('.mm-root:not(.mm-root--dialog)');
    const lists = [...document.querySelectorAll('.protyle-wysiwyg .list')].map((l) => ({
        id: (l.dataset.nodeId || '').slice(-6),
        attr: l.getAttribute('custom-mindmap'),
        mounted: l.hasAttribute('data-mm-mounted'),
        hidden: l.classList.contains('mm-source-hidden'),
        hasRoot: !!l.querySelector('.mm-root'),
    }));
    if (!root) return { root: false, listAlive: !!list, listAttr: list ? list.getAttribute('custom-mindmap') : 'NO-LIST', lists };
    const all = [...root.querySelectorAll('.mm-node')];
    const ed = root.querySelector('.mm-node[data-mm-editing]');
    return {
        root: true,
        total: all.length,
        visible: all.filter((x) => x.style.visibility !== 'hidden').length,
        sel: root.querySelector('.mm-node.mm-sel') ? root.querySelector('.mm-node.mm-sel').textContent.trim().slice(0, 8) : null,
        editing: !!ed,
        editingText: ed ? ed.textContent.trim().slice(0, 12) : null,
        active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : '?',
        listAlive: !!list,
        listAttr: list ? list.getAttribute('custom-mindmap') : 'NO-LIST',
        lists,
    };
})()`;

try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图" });

    // 抓「谁在清 custom-mindmap」：拦掉 XHR 与 fetch，把调用栈记下来
    await page.eval(`(() => {
        window.__mmCalls = [];
        const tag = (url, body) => {
            if (!String(url).includes('/api/attr/setBlockAttrs')) return;
            if (!String(body).includes('custom-mindmap')) return;
            window.__mmCalls.push({ body: String(body), stack: (new Error().stack || '').split('\\n').slice(1, 7).join(' | ') });
        };
        const XO = XMLHttpRequest.prototype.open;
        const XS = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__u = u; return XO.call(this, m, u, ...rest); };
        XMLHttpRequest.prototype.send = function (b) { tag(this.__u, b); return XS.call(this, b); };
        const F = window.fetch;
        window.fetch = function (u, opt) { tag(u && u.url ? u.url : u, opt && opt.body); return F.apply(this, arguments); };
        return true;
    })()`);

    await sleep(1500);
    console.log("初始:", JSON.stringify(await page.eval(SNAP)));
    console.log("  内核属性:", JSON.stringify((await api("/api/attr/getBlockAttrs", { id: listId })).data));

    const rootPos = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog)');
        const el = [...root.querySelectorAll('.mm-node')].filter((x) => x.style.visibility !== 'hidden')[0];
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await page.mouse("mouseMoved", rootPos.x, rootPos.y, { buttons: 0 });
    await page.mouse("mousePressed", rootPos.x, rootPos.y);
    await page.mouse("mouseReleased", rootPos.x, rootPos.y);
    await sleep(400);
    console.log("点完根:", JSON.stringify(await page.eval(SNAP)));

    await page.press("Tab");
    for (let i = 1; i <= 6; i++) {
        await sleep(300);
        console.log(`  +${i * 300}ms`, JSON.stringify(await page.eval(SNAP)));
    }
    const calls = await page.eval("window.__mmCalls");
    console.log("\n谁写过 custom-mindmap：");
    for (const c of calls ?? []) console.log("  -", c.body.slice(0, 200), "\n      ", c.stack);

    const dbg = await page.eval("document.documentElement.dataset.mmReveal");
    console.log("revealAndEdit:", dbg);
    const newHtml = await page.eval(`(() => {
        const lis = [...document.querySelectorAll('.protyle-wysiwyg .list .li')];
        const last = lis[lis.length - 1];
        const p = last ? last.querySelector('p') : null;
        return { liCount: lis.length, lastText: last ? last.textContent.trim().slice(0, 20) : null,
                 lastHtml: p ? p.innerHTML : null, lastLiId: last ? last.dataset.nodeId : null };
    })()`);
    console.log("新节点 DOM:", JSON.stringify(newHtml));
    await page.screenshot("tests/.build/diag-insert.png");
} finally {
    await chrome.close();
    // 统一走 _doc-cleanup 的两步法（getPathByID → removeDoc）；失败要出声
    const ok = await removeDoc(api, docId);
    console.log(ok ? "已清理" : "⚠️ 清理失败: " + docId);
}
