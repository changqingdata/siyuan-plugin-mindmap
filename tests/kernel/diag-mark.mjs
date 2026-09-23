/**
 * P1-2「节点标记」的端到端验收。
 *
 * 核心不变量：**块是唯一真相源**。
 * 标记存在块属性 `custom-mindmap-mark` 上，所以必须验到内核那一层 ——
 * 只看画面上出现了图标 / 标签是不够的（乐观 UI 也会让画面变样），
 * 一旦写回失败，重开文档就什么都没了。
 *
 * 覆盖：
 *   A 打开浮层     → 图标 / 标签 / 颜色三组控件都在
 *   B 选图标       → 节点上出现图标 · 内核属性里有它
 *   C 输标签       → 节点上出现标签 · 内核属性里有它
 *   D 选颜色       → 节点换了色 · 内核属性里有它
 *   E 再点一次     → 同一个图标/颜色再点一次 = 取消
 *   F 清除标记     → 节点干净了 · 内核里属性被**删掉**（不是写成空串）
 *   G 重开文档     → 标记还在（这才证明它是持久化在块属性上的）
 *   H 撤销         → 标记回到上一步
 *
 * 用法：node tests/kernel/diag-mark.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const OUT = "tests/.build";
const ATTR = "custom-mindmap-mark";

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

const N1 = "普通节点";
const N2 = "另一个节点";
const md = [`- ${N1}`, `  - ${N2}`, ""].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-节点标记-${Date.now()}`,
    markdown: md,
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;

const listId = (await kids(docId)).find((k) => k.type === "l").id;
const rootLi = (await kids(listId)).find((k) => k.type === "i").id;
const innerList = (await kids(rootLi)).find((k) => k.type === "l").id;
const id2 = (await kids(innerList)).find((k) => k.type === "i").id;
const id1 = rootLi;

await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

/** 内核里这个块的标记属性（原始字符串） */
const rawAttr = async (id) => {
    const j = await api("/api/attr/getBlockAttrs", { id });
    const v = j.data?.[ATTR];
    return v === undefined ? null : v;
};
const mark = async (id) => {
    const raw = await rawAttr(id);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return { __unparsable: raw };
    }
};

console.log(`临时文档 ${docId}`);
console.log(`列表 ${listId}\n节点1 ${id1}\n节点2 ${id2}\n`);

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

const nodeState = (id) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return { err: 'no root' };
    const el = root.querySelector('.mm-node[data-mm-id="${id}"]');
    if (!el) return { err: 'no node' };
    const icon = el.querySelector('.mm-mark-icon');
    const label = el.querySelector('.mm-mark-label');
    return {
        found: true,
        icon: icon ? icon.textContent : null,
        label: label ? label.textContent : null,
        solid: el.style.getPropertyValue('--c-solid').trim(),
        text: ((el.querySelector('.mm-txt') || {}).textContent || '').trim(),
    };
})()`;

const nodePoint = (id) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    const el = root && root.querySelector('.mm-node[data-mm-id="${id}"]');
    if (!el) return { err: 'no node' };
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.right - 6), y: Math.round(r.top + r.height / 2) };
})()`;

/** 打开某个节点的标记浮层（走真实的右键菜单，顺带验证入口还在） */
async function openMarkPop(page, id) {
    await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        const el = root.querySelector('.mm-node[data-mm-id="${id}"]');
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
        return true;
    })()`);
    await sleep(600);
    const labels = await page.eval(
        `[...document.querySelectorAll('.b3-menu .b3-menu__item')].map((x) => (x.textContent || '').trim()).filter(Boolean)`,
    );
    const hit = await page.eval(`(() => {
        const it = [...document.querySelectorAll('.b3-menu .b3-menu__item')].find((x) => (x.textContent || '').includes('标记'));
        if (!it) return false;
        it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        it.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        it.click();
        return true;
    })()`);
    await sleep(700);
    return { labels, hit };
}

/** 浮层里的控件状态 */
const popState = `(() => {
    const p = document.querySelector('.mm-mark-pop');
    if (!p) return { err: 'no popover' };
    return {
        on: true,
        icons: [...p.querySelectorAll('[data-icon]')].map((b) => b.textContent),
        iconOn: [...p.querySelectorAll('[data-icon].mm-on')].map((b) => b.textContent),
        colors: [...p.querySelectorAll('[data-color]')].map((b) => b.dataset.color),
        colorOn: [...p.querySelectorAll('[data-color].mm-on')].map((b) => b.dataset.color),
        label: (p.querySelector('.mm-mark-input') || {}).value,
        clearDim: !!p.querySelector('.mm-mark-clear.mm-dim'),
    };
})()`;

/** 点浮层里的某个控件 */
const popPoint = (sel, nth = 0) => `(() => {
    const p = document.querySelector('.mm-mark-pop');
    if (!p) return { err: 'no popover' };
    const list = [...p.querySelectorAll(${JSON.stringify(sel)})];
    const b = list[${nth}];
    if (!b) return { err: 'no target' };
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

async function clickAt(page, pt) {
    if (!pt || pt.err) return pt;
    await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
    await page.mouse("mousePressed", pt.x, pt.y, { clickCount: 1 });
    await page.mouse("mouseReleased", pt.x, pt.y, { clickCount: 1 });
    return pt;
}

/** 在浮层的标签输入框里打字 */
const typeLabel = (text) => `(() => {
    const i = document.querySelector('.mm-mark-pop .mm-mark-input');
    if (!i) return false;
    i.focus();
    i.value = ${JSON.stringify(text)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
})()`;

const chrome = await launch({ headless: true, port: 9362, width: 1680, height: 1050, dpr: 1 });
try {
    let page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    const logs = [];
    page.on("Runtime.consoleAPICalled", (p) => {
        const text = (p.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
        if (text.includes("mindmap")) logs.push(`[${p.type}] ${text}`);
    });
    await page.send("Runtime.enable");
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图出现" });
    await sleep(1600);

    /* ============================== 0. 初始 ============================== */
    console.log("【0 初始】");
    const s0 = await page.eval(nodeState(id1));
    ok(s0.found && s0.icon === null && s0.label === null, "节点上没有任何标记");
    ok((await rawAttr(id1)) === null, "内核里也没有这个属性");

    /* ============================== A. 打开浮层 ============================== */
    console.log("\n【A 右键 →「添加标记」打开浮层】");
    const opened = await openMarkPop(page, id1);
    ok(
        opened.labels.some((t) => t.includes("标记")),
        "右键菜单里有标记入口",
        (opened.labels || []).slice(0, 3).join(" | "),
    );
    ok(opened.hit === true, "点中了它");
    const p0 = await page.eval(popState);
    ok(p0.on === true, "标记浮层打开了", p0.err ?? "");
    ok((p0.icons || []).length === 8, "8 个图标可选", String((p0.icons || []).length));
    ok((p0.colors || []).length === 9, "8 个颜色 + 一个「跟随分支色」", String((p0.colors || []).length));
    ok(p0.label === "", "标签输入框是空的");
    ok(p0.clearDim === true, "还没有标记时「清除标记」是灰的");
    const solid0 = (await page.eval(nodeState(id1))).solid;

    /* ============================== B. 选图标 ============================== */
    console.log("\n【B 选一个图标】");
    await clickAt(page, await page.eval(popPoint("[data-icon]", 0)));
    await sleep(900);
    let st = await page.eval(nodeState(id1));
    ok(st.icon === "⭐", "★ 节点上出现了图标", String(st.icon));
    let mk = await mark(id1);
    ok(mk?.icon === "⭐", "★ 内核属性里也写进去了", JSON.stringify(mk));
    ok((await page.eval(popState)).iconOn.join("") === "⭐", "浮层里那个图标高亮了");

    /* ============================== C. 输标签 ============================== */
    console.log("\n【C 输一个标签】");
    await page.eval(typeLabel("重要"));
    await sleep(900);
    st = await page.eval(nodeState(id1));
    ok(st.label === "重要", "★ 节点上出现了标签", String(st.label));
    ok(st.icon === "⭐", "图标没被挤掉");
    mk = await mark(id1);
    ok(mk?.label === "重要", "★ 内核属性里有标签", JSON.stringify(mk));
    ok(st.text === N1, "★ 标记没有混进节点文字（改名 / 复制不会带上它）", st.text);

    /* ============================== D. 选颜色 ============================== */
    console.log("\n【D 选一个自定义色】");
    const colorPt = await page.eval(`(() => {
        const p = document.querySelector('.mm-mark-pop');
        const b = [...p.querySelectorAll('[data-color]')].find((x) => x.dataset.color === '#e5534b');
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await clickAt(page, colorPt);
    await sleep(900);
    st = await page.eval(nodeState(id1));
    ok(st.solid === "#e5534b", "★ 节点换成了自定义色", st.solid);
    ok(st.solid !== solid0, "（确实和原来的分支色不同）", `原 ${solid0}`);
    mk = await mark(id1);
    ok(mk?.color === "#e5534b", "★ 内核属性里有颜色", JSON.stringify(mk));
    ok(mk?.icon === "⭐" && mk?.label === "重要", "改颜色没有覆盖掉图标 / 标签（三项共存）");

    /* ============================== E. 再点一次 = 取消 ============================== */
    console.log("\n【E 同一个图标再点一次 → 取消它】");
    const pop1 = await page.eval(popState);
    ok(pop1.iconOn.join("") === "⭐", "（点之前它是选中的）");
    await clickAt(page, await page.eval(popPoint("[data-icon]", 0)));
    await sleep(900);
    st = await page.eval(nodeState(id1));
    ok(st.icon === null, "★ 图标被取消了");
    mk = await mark(id1);
    ok(mk?.icon === undefined, "内核属性里图标也没了", JSON.stringify(mk));
    ok(mk?.label === "重要" && mk?.color === "#e5534b", "标签和颜色还在（只取消了图标）");
    // 放回来，后面的重开文档要用
    await clickAt(page, await page.eval(popPoint("[data-icon]", 0)));
    await sleep(900);
    ok((await mark(id1))?.icon === "⭐", "再点一次放回来了");

    /* ============================== F. 清除标记 ============================== */
    console.log("\n【F 清除标记 → 属性应当被删掉，而不是写成空串】");
    await clickAt(page, await page.eval(popPoint(".mm-mark-clear")));
    await sleep(900);
    st = await page.eval(nodeState(id1));
    ok(st.icon === null && st.label === null, "★ 节点上的标记都清掉了");
    ok(st.solid !== "#e5534b", "颜色回到分支色", st.solid);
    ok((await rawAttr(id1)) === null, "★ 内核里这个属性被删掉了（不是留一个空串）", String(await rawAttr(id1)));
    ok((await page.eval(popState)).clearDim === true, "「清除标记」又变灰了");

    /* 重新设一套，供 G / H 用 */
    await clickAt(page, await page.eval(popPoint("[data-icon]", 1)));
    await sleep(700);
    await page.eval(typeLabel("待办"));
    await sleep(900);
    mk = await mark(id1);
    ok(mk?.icon === "🔥" && mk?.label === "待办", "重新设了一套标记（图标 + 标签）", JSON.stringify(mk));

    /* ============================== G. 撤销 ============================== */
    console.log("\n【G Ctrl+Z 撤销刚才那一步】");
    await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        root.focus({ preventScroll: true });
        return true;
    })()`);
    const beforeUndo = await mark(id1);
    await page.press("z", { ctrl: true });
    await sleep(1800);
    /* 撤销走的是插件自己的撤销栈（不是思源的），所以这里还要确认一下
       它到底有没有接住这个 Ctrl+Z —— 接不住的话，下面的失败就无从归因。 */
    const took = await page.eval(`document.documentElement.dataset.mmHistory || 'unset'`);
    ok(took === "undo", "插件接住了 Ctrl+Z", `mmHistory=${took}，撤销前内核 ${JSON.stringify(beforeUndo)}`);
    mk = await mark(id1);
    ok(mk?.label === undefined || mk?.label !== "待办", "★ 撤销把标签退回去了", JSON.stringify(mk));

    /* ============================== H. 重开文档 ============================== */
    console.log("\n【H 关掉页签重开 → 标记必须还在（证明它真的存进了块属性）】");
    // 先重新设一套确定的状态
    const opened2 = await openMarkPop(page, id1);
    if (!opened2.hit) console.log("  （提示：第二次打开浮层没点到菜单项）");
    await clickAt(page, await page.eval(popPoint("[data-icon]", 3)));
    await sleep(700);
    await page.eval(typeLabel("已验证"));
    await sleep(1200);
    const before = await mark(id1);
    ok(before?.icon === "✅" && before?.label === "已验证", "重开之前内核里是这样", JSON.stringify(before));
    // 关掉浮层
    await clickAt(page, await page.eval(popPoint(".mm-mark-done")));
    await sleep(300);

    await page.send("Page.navigate", { url: "about:blank" });
    await sleep(600);
    page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "重开后导图出现" });
    await sleep(2000);
    const stH = await page.eval(nodeState(id1));
    ok(stH.found === true, "重开后节点还在");
    ok(stH.icon === "✅", "★ 重开后图标还在", String(stH.icon));
    ok(stH.label === "已验证", "★ 重开后标签还在", String(stH.label));
    ok((await mark(id1))?.icon === "✅", "内核属性也没变", JSON.stringify(await mark(id1)));

    /* 另一个节点没有被误伤 */
    const st2 = await page.eval(nodeState(id2));
    ok(st2.icon === null && st2.label === null, "没被标记的节点仍然干净");

    if (logs.length) console.log("\n控制台:", logs.join("\n            "));
    await page.screenshot(`${OUT}/mark-final.png`);

    console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
    if (fail === 0) console.log("✓ 节点标记成立：存在块属性上，撤销可回退，重开文档仍在");
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}

process.exit(fail === 0 ? 0 : 1);
