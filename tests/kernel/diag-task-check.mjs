/**
 * P0-1「待办节点可勾选」的端到端验收。
 *
 * 背景（前几轮摸清的存储真相）：
 *   勾选态**不在段落里**，在列表项（`NodeListItem`）的 marker 上。kramdown 长这样：
 *
 *     - {: id="…" updated="…"}[X] 已完成的任务
 *     - {: id="…" updated="…"}[ ] 未完成的任务
 *
 *   写回只有一条路是对的：`/api/block/updateTaskListItemMarker { id, marker }`。
 *   另外两条实测都是错的（见 `src/utils/api.ts` 的注释）：
 *     ① `updateBlock(dataType:"markdown", "- [x] 文字")` → **子列表被整段冲掉**；
 *     ② `setBlockAttrs({ "data-task": "x" })`        → 内核拒绝并报出正确接口名。
 *   所以本测试里「子条目还在不在」是一条**硬断言**，不是顺带看看。
 *
 * ★ 这条测试真抓到过一个「界面全对、内核没动」的 bug：渲染层乐观翻转 `n.checked` 之后，
 *   执行侧又 `!node.checked` 反推目标态，两次取反正好写回原值 —— 一次原地踏步的空写。
 *   页面里看是「点了就勾上」，内核里纹丝不动（`probe-click-timeline.mjs` 的时间轴抓到）。
 *   所以「内核 marker 有没有真的变」必须是判据，光断言界面是不够的。
 *
 * 覆盖：
 *   A 点复选框     → 内核 marker 变 [X] · 子列表还在 · 块 ID 不变 · 节点画上已完成态
 *   B 再点一次     → 回到 [ ]
 *   C 键盘 X       → 勾选（键盘用户唯一的入口）
 *   D Ctrl+Z       → 撤销回操作前（勾选也是内容改动，必须进撤销栈）
 *   E 批量「完成」 → 选中的待办一起勾上（走 batchUpdateTaskListItemMarker 一次事务）
 *   F 批量「取消」 → 一起清回 [ ]
 *   G 右键菜单     → 「标记为已完成」也能勾
 *
 * 全程用自己新建的临时文档，不碰用户数据；跑完删掉。
 *
 * 用法：node tests/kernel/diag-task-check.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const OUT = "tests/.build";

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
const kids = async (id) => {
    const j = await api("/api/block/getChildBlocks", { id });
    return j.code === 0 ? j.data : [];
};

/* ---------------------------------------------------------------- 建测试文档 */

const T_ROOT = "顶层任务";
const T_A = "甲任务";
const T_A_KID = "甲的子条目";
const T_B = "乙任务";

const md = [`- [ ] ${T_ROOT}`, `  - [ ] ${T_A}`, `    - ${T_A_KID}`, `  - [x] ${T_B}`, ""].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-待办勾选-${Date.now()}`,
    markdown: md,
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;

const listId = (await kids(docId)).find((k) => k.type === "l").id;
const rootLi = (await kids(listId)).find((k) => k.type === "i").id;
const innerList = (await kids(rootLi)).find((k) => k.type === "l").id;
const itemIds = (await kids(innerList)).filter((k) => k.type === "i").map((b) => b.id);
const [idA, idB] = itemIds;

await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

/** 列表块的 kramdown（判据都从这里读） */
const kramdown = async () => (await api("/api/block/getBlockKramdown", { id: listId })).data?.kramdown ?? "";
/** 只看带 marker 的行：`<id 后 6 位> [x] 文字` */
const marks = (text) =>
    [...text.matchAll(/^\s*- \{: id="([^"]+)"[^}]*\}(\[[ xX]\]) (.*)$/gm)]
        .map((m) => `${m[1].slice(-6)} ${m[2].trim() || "[ ]"} ${m[3].trim()}`)
        .join("\n    ");
/** 某个块当前是不是勾上的 */
const isChecked = async (id) => {
    const kd = await kramdown();
    const re = new RegExp(`id="${id}"[^}]*\\}\\[([xX ])\\]`);
    const m = kd.match(re);
    return m ? m[1].toLowerCase() === "x" : null;
};
/** 子条目还在吗（这是「markdown 写回会冲掉子列表」那条坑的守门断言） */
const kidAlive = async () => (await kramdown()).includes(T_A_KID);

console.log(`临时文档 ${docId}`);
console.log(`列表 ${listId}\n甲 ${idA}\n乙 ${idB}`);
console.log(`初始:\n    ${marks(await kramdown())}\n`);

/* ---------------------------------------------------------------- 判据 */

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = "") => {
    if (cond) {
        pass++;
        console.log(`  ✓ ${label}${extra ? `  ${extra}` : ""}`);
    } else {
        fail++;
        console.log(`  ✗ ${label}${extra ? `  ${extra}` : ""}`);
    }
};

/**
 * 页内：导图节点当前的勾选态。
 *
 * **按块 ID 找节点**（`.mm-node[data-node-id]`），不按文字 ——
 * 第一版是按 `.mm-txt` 的文字找，结果点完一次之后就读不到了（文字匹配太脆：
 * 节点可能进编辑态、可能被重建、可能带上零宽字符），报出来的是 `{err:'no node'}`，
 * 表现为「aria-label 是 undefined」这种莫名其妙的现象，白查了半天。
 */
const nodeState = (id) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return { err: 'no root' };
    const el = root.querySelector('.mm-node[data-mm-id="${id}"]');
    if (!el) return { err: 'no node', have: [...root.querySelectorAll('.mm-node')].map((n) => n.dataset.mmId) };
    const box = el.querySelector('.mm-task');
    return {
        found: true,
        hasBox: !!box,
        boxTag: box ? box.tagName : '',
        boxDone: box ? box.classList.contains('mm-task--done') : false,
        nodeDone: el.classList.contains('mm-done'),
        ariaChecked: box ? box.getAttribute('aria-checked') : null,
        ariaLabel: box ? box.getAttribute('aria-label') : null,
    };
})()`;

/** 页内：某个节点上复选框的屏幕坐标 */
const boxPoint = (id) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return { err: 'no root' };
    const el = root.querySelector('.mm-node[data-mm-id="${id}"]');
    if (!el) return { err: 'no node' };
    el.scrollIntoView({ block: 'center' });
    const box = el.querySelector('.mm-task');
    if (!box) return { err: 'no checkbox' };
    const r = box.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

/**
 * 页内：某个节点的屏幕坐标（用来点选它）。
 *
 * 刻意往**右边缘**取点，避开正中间的文字 ——
 * 正中容易压到 `.mm-txt` 上（双击会进编辑态），也容易和悬停出来的操作条打架。
 */
const nodePoint = (id) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return { err: 'no root' };
    const el = root.querySelector('.mm-node[data-mm-id="${id}"]');
    if (!el) return { err: 'no node' };
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.right - 6), y: Math.round(r.top + r.height / 2) };
})()`;

async function clickPoint(page, expr, mods = {}) {
    const pt = await page.eval(expr);
    if (!pt || pt.err) return pt;
    await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
    await page.mouse("mousePressed", pt.x, pt.y, { ...mods, clickCount: 1 });
    await page.mouse("mouseReleased", pt.x, pt.y, { ...mods, clickCount: 1 });
    return pt;
}

/** 点批量条上的按钮（按文字找） */
const batchBtn = (label) => `(() => {
    const b = [...document.querySelectorAll('.mm-batch .mm-batch-btn')].find((x) => x.textContent.trim() === '${label}');
    if (!b) return { err: 'no button', have: [...document.querySelectorAll('.mm-batch .mm-batch-btn')].map((x) => x.textContent.trim()) };
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

/** 让导图拿到焦点 */
const focusMap = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return false;
    root.focus({ preventScroll: true });
    return document.activeElement === root;
})()`;

const chrome = await launch({ headless: true, port: 9352, width: 1680, height: 1050, dpr: 1 });
const url = `http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`;
const waitMap = async (page, label) => {
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label });
    await sleep(1600);
};

try {
    const page = await chrome.newPage(url);

    /*
     * 抓页面控制台。
     *
     * 插件里所有写内核失败的分支都是 `console.warn("[mindmap] …")` ——
     * 不抓的话，一次「点了没反应」只能看到「内核没变」，看不到到底是
     * 没点到、动作没派发、还是内核拒绝了。第一版就是在这里卡了很久。
     */
    const logs = [];
    page.on("Runtime.consoleAPICalled", (p) => {
        const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
        logs.push(`[${p.type}] ${text}`);
    });
    await page.send("Runtime.enable");

    await waitMap(page, "首次打开");

    /* ============================== 0. 初始形态 ============================== */
    console.log("【0 初始】");
    const s0 = await page.eval(nodeState(idA));
    ok(s0.found && s0.hasBox, "「甲任务」节点上有复选框");
    ok(s0.boxTag === "BUTTON", "复选框是 <button>（键盘 / 读屏可达）", `<${s0.boxTag}>`);
    ok(s0.ariaChecked === "false", "aria-checked 是 false", `${s0.ariaChecked}`);
    ok(s0.boxDone === false && s0.nodeDone === false, "视觉上是未完成态");
    const sB0 = await page.eval(nodeState(idB));
    ok(sB0.boxDone === true, "「乙任务」初始就是已完成态（fixture 里的 [x]）");
    ok((await isChecked(idA)) === false, "内核里「甲任务」是 [ ]");
    ok((await isChecked(idB)) === true, "内核里「乙任务」是 [x]");

    /* ============================== A. 点复选框勾选 ============================== */
    console.log("\n【A 点「甲任务」的复选框 → 应当写回内核】");
    const pA = await clickPoint(page, boxPoint(idA));
    ok(!!pA && !pA.err, "找到并点中了复选框", pA?.err ?? "");
    await sleep(1600);

    /* 失败时把现场摊开：内核里到底是什么样、页面有没有报 [mindmap] 警告。
       这里只打印，不作为判据 —— 判据在下面的 ok() 里。 */
    const mmLogs = logs.filter((l) => l.includes("mindmap"));
    logs.length = 0;
    if (mmLogs.length) console.log("  控制台:", mmLogs.join("\n            "));

    ok((await isChecked(idA)) === true, "内核里「甲任务」变成 [X]");
    ok(await kidAlive(), "★ 子条目「甲的子条目」还在（markdown 写回会冲掉子列表，这条是守门断言）");
    const kdA = await kramdown();
    ok(kdA.includes(`id="${idA}"`), "★ 「甲任务」的块 ID 没变（引用 / 反链安全）");
    ok(kdA.includes(`id="${idB}"`), "「乙任务」的块 ID 也没变");
    const sA = await page.eval(nodeState(idA));
    ok(sA.boxDone === true, "导图上复选框切到已完成态");
    ok(sA.nodeDone === true, "节点文字画上了删除线（.mm-done）");
    ok(sA.ariaChecked === "true", "aria-checked 跟着变成 true");
    ok(sA.ariaLabel === "标记为未完成", "aria-label 跟着翻转", `${sA.ariaLabel}`);

    /* ============================== B. 再点一次取消 ============================== */
    console.log("\n【B 再点一次 → 应当取消勾选】");
    await clickPoint(page, boxPoint(idA));
    await sleep(1600);
    ok((await isChecked(idA)) === false, "内核里回到 [ ]");
    ok(await kidAlive(), "子条目仍然在");
    const sB = await page.eval(nodeState(idA));
    ok(sB.boxDone === false && sB.nodeDone === false, "导图上回到未完成态");

    /* ============================== C. 键盘 X ============================== */
    console.log("\n【C 选中节点后按 X → 勾选】");
    await clickPoint(page, nodePoint(idA));
    await sleep(500);
    const focused = await page.eval(focusMap);
    ok(!!focused, "导图拿到了焦点");
    await page.press("x");
    await sleep(1600);
    ok((await isChecked(idA)) === true, "按 X 之后内核里是 [X]");
    ok(await kidAlive(), "子条目仍然在");
    const sC = await page.eval(nodeState(idA));
    ok(sC.boxDone === true, "导图上同步成已完成态");

    /* ============================== D. Ctrl+Z 撤销 ============================== */
    console.log("\n【D Ctrl+Z → 应当撤销回未勾选】");
    await page.press("z", { ctrl: true });
    await sleep(1800);
    ok((await isChecked(idA)) === false, "撤销后内核里回到 [ ]");
    ok(await kidAlive(), "撤销之后子条目还在");
    const sD = await page.eval(nodeState(idA));
    ok(sD.boxDone === false, "导图上回到未完成态");

    /* ============================== E/F. 批量勾选 ============================== */
    console.log("\n【E 选中甲 + 乙 → 批量条「完成」】");
    await clickPoint(page, nodePoint(idA));
    await sleep(400);
    await clickPoint(page, nodePoint(idB), { modifiers: 2 }); // Ctrl + 单击加选
    await sleep(700);
    const bar = await page.eval(`(() => {
        const b = document.querySelector('.mm-batch');
        if (!b) return { err: 'no batch bar' };
        return {
            count: (b.querySelector('.mm-batch-count') || {}).textContent,
            buttons: [...b.querySelectorAll('.mm-batch-btn')].map((x) => ({ t: x.textContent.trim(), shown: x.style.display !== 'none' })),
        };
    })()`);
    ok(!bar.err, "多选之后批量操作条浮出来了", bar.err ?? "");
    ok(bar.count === "已选 2 个", "计数正确", `${bar.count}`);
    const shown = (bar.buttons || []).filter((x) => x.shown).map((x) => x.t);
    ok(shown.includes("完成") && shown.includes("取消"), "★ 待办专用按钮「完成 / 取消」出现在批量条上", shown.join(" "));

    const pc = await clickPoint(page, batchBtn("完成"));
    ok(!!pc && !pc.err, "点到了「完成」", pc?.err ?? "");
    await sleep(2000);
    ok((await isChecked(idA)) === true, "批量「完成」把「甲任务」勾上了");
    ok((await isChecked(idB)) === true, "批量「完成」把「乙任务」也勾上了");
    ok(await kidAlive(), "批量勾选之后子条目还在");

    console.log("\n【F 批量条「取消」→ 应当一起清回 [ ]】");
    const pf = await clickPoint(page, batchBtn("取消"));
    ok(!!pf && !pf.err, "点到了「取消」", pf?.err ?? "");
    await sleep(2000);
    ok((await isChecked(idA)) === false, "批量「取消」把「甲任务」清回 [ ]");
    ok((await isChecked(idB)) === false, "批量「取消」把「乙任务」也清回 [ ]");
    ok(await kidAlive(), "批量取消之后子条目还在");

    /* ============================== G. 右键菜单 ============================== */
    console.log("\n【G 右键「甲任务」→ 菜单里「标记为已完成」】");
    await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        const el = root.querySelector('.mm-node[data-mm-id="${idA}"]');
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
        return true;
    })()`);
    await sleep(700);
    const menuLabels = await page.eval(
        `[...document.querySelectorAll('.b3-menu .b3-menu__item')].map((x) => (x.textContent || '').trim()).filter(Boolean)`,
    );
    ok(
        Array.isArray(menuLabels) && menuLabels.some((t) => t.includes("标记为已完成")),
        "右键菜单里有「标记为已完成」",
        (menuLabels || []).slice(0, 4).join(" | "),
    );
    const clicked = await page.eval(`(() => {
        const it = [...document.querySelectorAll('.b3-menu .b3-menu__item')].find((x) => (x.textContent || '').includes('标记为已完成'));
        if (!it) return false;
        it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        it.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        it.click();
        return true;
    })()`);
    ok(!!clicked, "点中了那一项");
    await sleep(1800);
    ok((await isChecked(idA)) === true, "右键菜单也能勾上（内核里是 [X]）");
    ok(await kidAlive(), "右键勾选之后子条目还在");

    await page.screenshot(`${OUT}/task-check-final.png`);

    console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
    if (fail === 0) console.log("✓ 待办勾选全链路成立：写回走 marker 接口，子列表与块 ID 都不受影响");
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}

process.exit(fail === 0 ? 0 : 1);
