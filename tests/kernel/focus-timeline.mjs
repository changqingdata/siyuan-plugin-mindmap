/**
 * 焦点时序探针：在导图上按键之后，焦点被谁、在第几毫秒抢走。
 *
 * 做法：给 `HTMLElement.prototype.focus` 打桩抓调用栈，再加一套页面内 rAF
 * 采样器（毫秒级），然后跑真实的「点节点 → Delete」，把时序整条打出来。
 *
 * 结论（决定了 renderer 里 handleGlobalKey 为什么要 restoreFocus）：
 *   按下 Delete 之后 **+2ms** 焦点就从 `.mm-root` 变成了 `.protyle-wysiwyg`，
 *   调用栈指向思源自己的编辑器 keydown 监听 ——
 *   `.mm-root` 长在 `.protyle-wysiwyg` 里面，按键一样会经过它。
 *   之后 3.5 秒内焦点不再变，所以一个 `setTimeout(0)` 的抢回就足够稳。
 *
 * 用法：npm run kernel:focus      MM_KEEP=1 保留文档
 */

import fs from "node:fs";
import path from "node:path";
// ⚠️ 路径是 `../cdp.mjs`（`cdp.mjs` 在 `tests/` 下，不在 `tests/kernel/`）。
//    这里原先写的是 `./cdp.mjs` —— 全仓唯一一处，而且因为本脚本从来没被跑过
//    （`kernel:focus` 不在 `ux:all` 也不在 `check:all` 里），一直没人发现：
//    一跑就是 `ERR_MODULE_NOT_FOUND`，连第一行都执行不到。
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

const MD = ["- 终极思考", "  - 环境选择", "    - 132", "      - 1231", "  - 123", ""].join("\n");

const conf = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";

async function api(p, payload) {
    const res = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    const json = await res.json();
    if (json.code !== 0) throw new Error(`${p} 失败: ${json.code} ${json.msg}`);
    return json.data;
}

async function children(id) {
    try {
        return await api("/api/block/getChildBlocks", { id });
    } catch {
        return [];
    }
}

async function itemShape(id, depth = 0, out = []) {
    for (const k of await children(id)) {
        if (k.type === "i") {
            const own = (await children(k.id)).find((c) => c.type === "p");
            if (own) out.push(`${depth}:${(own.content || "").trim()}`);
            await itemShape(k.id, depth + 1, out);
        } else {
            await itemShape(k.id, depth, out);
        }
    }
    return out.sort();
}

const PROBE = `
(() => {
    if (window.__fp) return 'already';
    const P = { trace: [], focus: [], dom: [], focusCalls: [], notes: [] };
    window.__fp = P;

    const tag = (n) => {
        if (!n) return 'null';
        if (n === document.body) return 'body';
        if (n.nodeType !== 1) return '#' + n.nodeName;
        const c = String(n.className || n.tagName);
        return n.id ? '#' + n.id + '.' + c.split(' ')[0] : c.split(' ').slice(0, 2).join(' ');
    };
    const mmRoot = () => document.querySelector('.mm-root:not(.mm-root--dialog)');

    P.t0 = 0;
    P.rel = () => Math.round(performance.now() - P.t0);

    document.addEventListener('focusin', (e) => P.focus.push({ t: P.rel(), op: 'in', node: tag(e.target) }), true);
    document.addEventListener('focusout', (e) => P.focus.push({ t: P.rel(), op: 'out', node: tag(e.target) }), true);

    // 监视整个 .protyle 子树里 .mm-root 的增删（不只是 .protyle-wysiwyg）
    const watch = () => {
        const host = document.querySelector('.protyle');
        if (!host) return window.setTimeout(watch, 200);
        new MutationObserver((recs) => {
            for (const r of recs) {
                for (const n of r.removedNodes) {
                    if (n.nodeType === 1 && (n.classList?.contains('mm-root') || n.querySelector?.('.mm-root')))
                        P.dom.push({ t: P.rel(), op: 'remove', what: tag(n) });
                }
                for (const n of r.addedNodes) {
                    if (n.nodeType === 1 && (n.classList?.contains('mm-root') || n.querySelector?.('.mm-root')))
                        P.dom.push({ t: P.rel(), op: 'add', what: tag(n) });
                }
            }
        }).observe(host, { childList: true, subtree: true });
        P.notes.push('watching .protyle');
    };
    watch();

    // 所有 focus() 调用都记下来（带调用栈），一次问清是谁在抢焦点
    const origFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) {
        const stack = String(new Error().stack || '').split('\\n').slice(1, 5).map((s) => s.trim()).join(' <- ');
        P.focusCalls.push({ t: P.rel(), node: tag(this), active: tag(document.activeElement), stack });
        return origFocus.apply(this, args);
    };

    // rAF 采样：activeElement + mm-root 是否还在
    P.start = () => {
        P.trace.length = 0; P.focus.length = 0; P.dom.length = 0; P.focusCalls.length = 0;
        P.t0 = performance.now();
        let last = '';
        const tick = () => {
            const root = mmRoot();
            const a = tag(document.activeElement);
            const row = (root ? 'R' : '-') + '|' + a;
            if (row !== last) { P.trace.push({ t: P.rel(), row }); last = row; }
            if (P.rel() < 3500) requestAnimationFrame(tick);
        };
        tick();
    };
    return 'ok';
})()
`;

const chrome = await launch({ headless: true, port: 9336, width: 1600, height: 1000, dpr: 1 });
let docId = "";
try {
    docId = await api("/api/filetree/createDocWithMd", {
        notebook: NOTEBOOK,
        path: `/临时-焦点探针-${Date.now()}`,
        markdown: MD,
    });
    const kids = await children(docId);
    const list = kids.find((k) => k.type === "l");
    await api("/api/attr/setBlockAttrs", { id: list.id, attrs: { "custom-mindmap": "mind" } });
    console.log("文档:", docId, "列表:", list.id);

    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "protyle" });
    await page.waitFor("!!document.querySelector('.mm-root')", { timeout: 30000, label: "导图" });
    await page.eval(PROBE);
    await sleep(500);

    const id = await page.eval(`(() => {
        const zw = /[\\u200B-\\u200D\\u2060\\uFEFF]/g;
        const hit = Array.from(document.querySelectorAll('.mm-root:not(.mm-root--dialog) .mm-node'))
            .find(n => ((n.querySelector('.mm-txt') || {}).textContent || '').replace(zw, '').trim() === '123');
        // ⚠️ 是 dataset.mmId（属性 data-mm-id），不是 dataset.nodeId ——
        //    见 src/core/renderer.ts 里那段「绝对不能用 data-node-id」的长注释。
        //    原先读错了，返回 undefined，下一行的选择器就变成
        //    [data-mm-id="undefined"]，报「找不到元素」。
        //    （本段在 page.eval 的模板字符串里，注释里不能出现反引号。）
        return hit ? hit.dataset.mmId : null;
    })()`);
    console.log("目标节点:", id);
    await page.click(`.mm-root:not(.mm-root--dialog) .mm-node[data-mm-id="${id}"]`);
    await sleep(300);
    console.log("点完之后 activeElement:", await page.eval(`(() => { const a = document.activeElement; return a ? (a.className || a.tagName) : 'none' })()`));

    await page.eval(`window.__fp.start()`);
    console.log("--- 按 Delete ---");
    await page.press("Delete");
    await sleep(4000);

    const raw = JSON.parse(await page.eval(`JSON.stringify(window.__fp)`));
    console.log("\n--- activeElement 变化（R = .mm-root 存在）---");
    for (const r of raw.trace) console.log(`  +${r.t}ms  ${r.row}`);
    console.log("\n--- focusin/focusout ---");
    for (const f of raw.focus) console.log(`  +${f.t}ms  ${f.op}  ${f.node}`);
    console.log("\n--- .mm-root 增删 ---");
    for (const d of raw.dom) console.log(`  +${d.t}ms  ${d.op}  ${d.what}`);
    console.log("\n--- focus() 调用（谁抢的焦点）---");
    for (const c of raw.focusCalls) {
        console.log(`  +${c.t}ms  focus(${c.node})  之前 active=${c.active}`);
        console.log(`        ${c.stack}`);
    }
    if (!raw.focusCalls.length) console.log("  （没有显式 focus()，说明是浏览器默认行为）");
    console.log("\n笔记:", raw.notes.join(", "));

    console.log("\n删除后内核:", JSON.stringify(await itemShape(list.id)));
} finally {
    await chrome.close();
    /* ⚠️ 清理**必须在 finally 里**，不能在 try 末尾 —— 本支就崩过两次
       （import 路径写错、在 .mm-node 上读 dataset.nodeId），一崩就跳过清理，
       在用户笔记本里留下「临时-焦点探针-时间戳」。实测本轮正是它漏了 1 个。
       删文档要用 _doc-cleanup 的两步法（getPathByID → removeDoc），
       直接传 {id} 会报「Field [notebook] is required」而被静默吞掉。 */
    if (docId && !process.env.MM_KEEP) {
        const ok = await removeDoc(api, docId);
        console.log(ok ? "已清理临时文档" : "⚠️ 临时文档未能清理: " + docId);
    } else if (docId) {
        console.log("MM_KEEP=1，保留文档:", docId);
    }
}
