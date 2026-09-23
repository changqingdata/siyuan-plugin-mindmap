/**
 * 只读探针：查清「点待办复选框」这一下到底发生了什么。
 *
 * 现象（diag-task-check.mjs）：点了之后内核没变，但导图上**「甲任务」那个节点元素消失了**，
 * 而它的子节点「甲的子条目」还在（深度也没变）。内核侧 kramdown 完全没动 ——
 * 说明这不是写回失败，是**渲染侧自己把节点弄丢了**。
 *
 * 这个探针按顺序做三件事，逐步缩小范围：
 *   1. dump 初始结构 + 给复选框挂一个捕获阶段的 click 监听（数一下到底有没有 click 事件）
 *   2. 合成 `box.click()` —— 绕开坐标问题，直接验证 handler 通不通
 *   3. 真实鼠标点击 —— 对比是不是坐标打偏
 * 每一步之后都把节点列表和内核 kramdown 打出来。
 *
 * 用法：node tests/kernel/probe-task-click.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";
const api = async (p, b) =>
    (
        await fetch(KERNEL + p, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
            body: JSON.stringify(b ?? {}),
        })
    ).json();

const md = ["- [ ] 顶层任务", "  - [ ] 甲任务", "    - 甲的子条目", "  - [x] 乙任务", ""].join("\n");
const mk = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-待办点击-${Date.now()}`,
    markdown: md,
});
const docId = mk.data;
const listId = (await api("/api/block/getChildBlocks", { id: docId })).data.find((k) => k.type === "l").id;
const rootLi = (await api("/api/block/getChildBlocks", { id: listId })).data.find((k) => k.type === "i").id;
const innerList = (await api("/api/block/getChildBlocks", { id: rootLi })).data.find((k) => k.type === "l").id;
const [idA, idB] = (await api("/api/block/getChildBlocks", { id: innerList })).data.filter((k) => k.type === "i").map((b) => b.id);
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

const kram = async () => (await api("/api/block/getBlockKramdown", { id: listId })).data?.kramdown ?? "";
const marks = (t) =>
    [...t.matchAll(/^\s*- \{: id="([^"]+)"[^}]*\}(\[[ xX]\]) (.*)$/gm)]
        .map((m) => `${m[1].slice(-6)}[${m[2].trim() || " "}]${m[3].trim()}`)
        .join(" | ");

const chrome = await launch({ headless: true, port: 9354, width: 1400, height: 900, dpr: 1 });

const SNAP = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return { err: 'no root' };
    return [...root.querySelectorAll('.mm-node')].map((n) => ({
        id: (n.dataset.mmId || '').slice(-6),
        d: n.className.match(/mm-d(\\d)/) ? n.className.match(/mm-d(\\d)/)[1] : '?',
        text: ((n.querySelector('.mm-txt') || {}).textContent || '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').trim(),
        box: !!n.querySelector('.mm-task'),
        pending: n.classList.contains('mm-pending'),
    }));
})()`;

try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    page.on("Runtime.consoleAPICalled", (p) => {
        console.log("  [页面控制台]", p.type, (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" "));
    });
    await page.send("Runtime.enable");
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图出现" });
    await sleep(1800);

    console.log("内核:", marks(await kram()));
    console.log("列表", listId, "· 甲", idA, "· 乙", idB);
    console.log("\n【1 初始导图】", JSON.stringify(await page.eval(SNAP)));

    // 给复选框挂捕获监听，数一下 click 事件有没有派发出来
    await page.eval(`(() => {
        window.__mmClicks = [];
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        root.addEventListener('click', (e) => {
            const t = e.target;
            window.__mmClicks.push((t.tagName || '?') + '.' + (t.className || '') + ' trusted=' + e.isTrusted);
        }, true);
        // 顺带看看 api 层有没有真的发请求
        window.__mmReqs = [];
        const of = window.fetch;
        window.fetch = function (...a) {
            const u = String((a[0] && a[0].url) || a[0]);
            if (u.includes('/api/')) window.__mmReqs.push(u.replace(/^.*\\/api\\//, ''));
            return of.apply(this, a);
        };
        const oo = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (m, u, ...r) {
            if (String(u).includes('/api/')) window.__mmReqs.push('XHR ' + String(u).replace(/^.*\\/api\\//, ''));
            return oo.call(this, m, u, ...r);
        };
        return true;
    })()`);

    console.log("\n【2 合成 box.click()】");
    const synth = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        const el = root.querySelector('.mm-node[data-mm-id="${idA}"]');
        if (!el) return { err: 'no node' };
        const box = el.querySelector('.mm-task');
        if (!box) return { err: 'no box' };
        box.click();
        return { ok: true };
    })()`);
    console.log("  结果:", JSON.stringify(synth));
    await sleep(1600);
    console.log("  点击记录:", JSON.stringify(await page.eval("window.__mmClicks")));
    console.log("  请求记录:", JSON.stringify(await page.eval("window.__mmReqs")));
    console.log("  导图:", JSON.stringify(await page.eval(SNAP)));
    console.log("  内核:", marks(await kram()));

    // 关键：源列表 DOM 到底长什么样？导图是照它解析的
    const src = await page.eval(`(() => {
        const list = document.querySelector('.list[data-node-id="${listId}"]');
        if (!list) return { err: 'no source list' };
        const walk = (el, d) => {
            const out = [];
            for (const c of el.children) {
                const cls = String(c.className || '').split(' ').slice(0, 3).join('.');
                out.push('  '.repeat(d) + c.tagName.toLowerCase() + '.' + cls + (c.dataset && c.dataset.nodeId ? '#' + c.dataset.nodeId.slice(-6) : '') + (c.dataset && c.dataset.subtype ? ' subtype=' + c.dataset.subtype : ''));
                if (d < 4 && !c.classList.contains('mm-root')) out.push(...walk(c, d + 1));
            }
            return out;
        };
        return { tree: walk(list, 0).join('\\n') };
    })()`);
    console.log("  源列表 DOM:\\n" + (src.tree || JSON.stringify(src)));

    // 复位
    await api("/api/block/updateTaskListItemMarker", { id: idA, marker: " " });
    await sleep(1200);

    console.log("\n【3 真实鼠标点击】");
    const pt = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        const el = root.querySelector('.mm-node[data-mm-id="${idA}"]');
        if (!el) return { err: 'no node' };
        el.scrollIntoView({ block: 'center' });
        const box = el.querySelector('.mm-task');
        if (!box) return { err: 'no box' };
        const r = box.getBoundingClientRect();
        const at = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), hit: at ? at.tagName + '.' + at.className : null };
    })()`);
    console.log("  目标点:", JSON.stringify(pt));
    if (!pt.err) {
        await page.eval("window.__mmClicks = []; window.__mmReqs = []; true");
        await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
        await page.mouse("mousePressed", pt.x, pt.y, {});
        await page.mouse("mouseReleased", pt.x, pt.y, {});
        await sleep(1600);
        console.log("  点击记录:", JSON.stringify(await page.eval("window.__mmClicks")));
        console.log("  请求记录:", JSON.stringify(await page.eval("window.__mmReqs")));
        console.log("  导图:", JSON.stringify(await page.eval(SNAP)));
        console.log("  内核:", marks(await kram()));
    }
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}
