/**
 * 只读探针：把「点一下待办复选框」之后 8 秒内的**一切**摊在时间轴上。
 *
 * 起因：`diag-task-check.mjs` 里 UI 断言全绿，但紧随其后读到的 kramdown 还是旧值，
 * 而且看起来**稳定滞后一拍**（读到的永远是上一次操作的结果）。
 * `probe-marker-lag.mjs` 已经证明「从 Node 直接写 marker，254ms 后就能读到」，
 * 所以嫌疑只剩三种，必须靠一次实测分开：
 *
 *   (a) 插件压根没发请求        → 页面里 hook 不到 `/api/block/updateTaskListItemMarker`
 *   (b) 请求发了但内核拒绝了    → hook 到请求，响应 code ≠ 0（静默失败是这类接口的坑）
 *   (c) 内核写成功但读取滞后    → 响应 code = 0，但 kramdown 要过很久才变
 *
 * 做法：在页面里包一层 `fetch` / `XMLHttpRequest`，把带 `/api/` 的请求连**响应体**一起记下来；
 * 点完之后每 250ms 同时采两边的状态 —— 页面里 `.mm-task` 的勾选态、内核里 marker 的值。
 *
 * 用法：node tests/kernel/probe-click-timeline.mjs
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

/* ---------------------------------------------------------------- fixture */
const md = ["- [ ] 顶层任务", "  - [ ] 甲任务", "    - 甲的子条目", "  - [x] 乙任务", ""].join("\n");
const mk = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-点击时间轴-${Date.now()}`,
    markdown: md,
});
const docId = mk.data;
const listId = (await api("/api/block/getChildBlocks", { id: docId })).data.find((k) => k.type === "l").id;
const rootLi = (await api("/api/block/getChildBlocks", { id: listId })).data.find((k) => k.type === "i").id;
const innerList = (await api("/api/block/getChildBlocks", { id: rootLi })).data.find((k) => k.type === "l").id;
const idA = (await api("/api/block/getChildBlocks", { id: innerList })).data.filter((k) => k.type === "i")[0].id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

const flag = async () => {
    const kd = (await api("/api/block/getBlockKramdown", { id: listId })).data?.kramdown ?? "";
    const m = kd.match(new RegExp(`id="${idA}"[^}]*\\}\\[([xX ])\\]`));
    return m ? (m[1].toLowerCase() === "x" ? "X" : " ") : "?";
};

/* ---------------------------------------------------- 页面里的网络记录器 */
const HOOK = `(() => {
    if (window.__mmNet) return 'already';
    window.__mmNet = [];
    const t0 = performance.now();
    const now = () => Math.round(performance.now() - t0);
    const rec = (o) => window.__mmNet.push({ t: now(), ...o });

    const of = window.fetch;
    window.fetch = function (input, init) {
        const url = (typeof input === 'string' ? input : (input && input.url) || '') + '';
        const body = init && init.body;
        const p = of.apply(this, arguments);
        if (url.includes('/api/')) {
            rec({ k: 'fetch', url, body: typeof body === 'string' ? body.slice(0, 240) : '' });
            p.then((r) => r.clone().text().then((txt) => {
                let code = '?';
                try { code = JSON.parse(txt).code; } catch (_) {}
                rec({ k: 'fetch←', url, code, txt: txt.slice(0, 240) });
            }).catch(() => {})).catch((e) => rec({ k: 'fetch✗', url, err: String(e) }));
        }
        return p;
    };

    const oOpen = XMLHttpRequest.prototype.open;
    const oSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = u + ''; return oOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (body) {
        const url = this.__u || '';
        if (url.includes('/api/')) {
            rec({ k: 'xhr', url, body: typeof body === 'string' ? body.slice(0, 240) : '' });
            this.addEventListener('load', () => rec({ k: 'xhr←', url, code: this.status, txt: String(this.responseText || '').slice(0, 240) }));
        }
        return oSend.apply(this, arguments);
    };
    return 'installed';
})()`;

/* ------------------------------------------------------------ 页面状态 */
const pageState = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return { err: 'no root' };
    const el = root.querySelector('.mm-node[data-mm-id="${idA}"]');
    if (!el) return { err: 'no node' };
    const box = el.querySelector('.mm-task');
    return {
        boxDone: box ? box.classList.contains('mm-task--done') : null,
        nodeDone: el.classList.contains('mm-done'),
        pending: el.classList.contains('mm-pending'),
        ghost: !!root.querySelector('.mm-ghost'),
        inDoc: !!el.closest('.protyle-wysiwyg'),
    };
})()`;

const boxPoint = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    const el = root && root.querySelector('.mm-node[data-mm-id="${idA}"]');
    if (!el) return { err: 'no node' };
    el.scrollIntoView({ block: 'center' });
    const box = el.querySelector('.mm-task');
    if (!box) return { err: 'no checkbox' };
    const r = box.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

const chrome = await launch({ headless: true, port: 9358, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图出现" });
    await sleep(2000);

    console.log(await page.eval(HOOK));
    console.log(`docId ${docId}\n甲 ${idA}\n初始内核 marker: [${await flag()}]\n`);

    /**
     * 跑一个相位：先做动作（页面点击 / 从 Node 直写），再逐帧同时采页面与内核。
     *
     * 相位 0 是**对照组** —— 唯一的差别就是「谁发的请求」。
     * 如果 Node 直写很快、页面点击很慢，那问题就不在接口、不在读取，
     * 而在「页面发出的那次写入在到达内核之前发生了什么」。
     */
    const phase = async (label, act, want) => {
        console.log(`\n========== ${label} ==========`);
        if (act.kind === "click") {
            const pt = await page.eval(boxPoint);
            if (pt.err) {
                console.log("  取点失败:", pt.err);
                return;
            }
            await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
            await page.mouse("mousePressed", pt.x, pt.y, { clickCount: 1 });
            await page.mouse("mouseReleased", pt.x, pt.y, { clickCount: 1 });
            console.log(`  已点击 (${pt.x},${pt.y})`);
        } else {
            const r = await api("/api/block/updateTaskListItemMarker", { id: idA, marker: act.marker });
            console.log(`  从 Node 直写 marker="${act.marker}" → code=${r.code}`);
        }
        const t0 = Date.now();
        let first = -1;
        for (let i = 0; i < 16; i++) {
            await sleep(300);
            const st = await page.eval(pageState);
            const f = await flag();
            const dt = Date.now() - t0;
            if (f === want && first < 0) first = dt;
            console.log(
                `  +${String(dt).padStart(4)}ms  内核=[${f}]  box=${st.boxDone} node=${st.nodeDone} pending=${st.pending} ghost=${st.ghost}${st.err ? " " + st.err : ""}`,
            );
            if (f === want) break;
        }
        console.log(first < 0 ? "  ✗ 5 秒内内核始终没变" : `  ✔ 内核在 +${first}ms 变了`);
    };

    // 对照组：Node 直写（文档同样开着）
    await phase("对照 · 从 Node 直写 → X", { kind: "node", marker: "x" }, "X");
    await phase("对照 · 从 Node 直写 → 空格", { kind: "node", marker: " " }, " ");
    // 实验组：页面点击
    await phase("页面点击 #1（期望 → X）", { kind: "click" }, "X");
    await phase("页面点击 #2（期望 → 空格）", { kind: "click" }, " ");

    const net = await page.eval(`JSON.stringify(window.__mmNet || [])`);
    console.log("\n========== 页面里的 /api/ 调用 ==========");
    for (const r of JSON.parse(net)) {
        console.log(`  +${String(r.t).padStart(5)}ms ${r.k.padEnd(8)} ${(r.url || "").replace("http://127.0.0.1:6806", "")}${r.code !== undefined ? `  code=${r.code}` : ""}`);
        if (r.body) console.log(`             body: ${r.body}`);
        if (r.txt && r.code !== 0) console.log(`             resp: ${r.txt}`);
    }
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}
