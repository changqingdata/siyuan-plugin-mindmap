/**
 * 一次性诊断：触摸点节点**中心**到底会不会选中？
 *
 * 为什么单开一个：在 `probe-mobile-touch.mjs` 里量这个会被污染 ——
 * 那份 fixture 是**任务列表**，点到复选框会切换待办 → 写内核 → 重渲染 →
 * `.mm-node` 元素被换掉、`.mm-node`[1] 可能已经变成另一个节点。
 * 于是「同元素、不同结果」，看不出是位置问题还是状态问题。
 *
 * 这里用**无序列表**（没有复选框）：点哪儿都不会改文档，测量干净。
 *
 * 用法：node tests/kernel/probe-mobile-tap.mjs
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

const MD = ["- 根", "  - 甲甲甲", "    - 甲.1", "  - 乙乙", ""].join("\n");
const doc = (await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-触摸诊断-${Date.now()}`, markdown: MD })).data;
const list = (await api("/api/block/getChildBlocks", { id: doc })).data.find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: list, attrs: { "custom-mindmap": "logic" } });
console.log(`文档 ${doc}\n`);

const ROOT = `document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)')`;

const chrome = await launch({ headless: true, width: 390, height: 844, dpr: 3 });
const page = await chrome.newPage("about:blank");

async function tap(x, y) {
    await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(60);
    await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await page.send("Page.navigate", { url: `${KERNEL}/stage/build/mobile/?id=${doc}` });
    await sleep(5000);
    await page.waitFor(`${ROOT} !== null`, { timeout: 25000, label: "挂载" });
    await sleep(1200);

    const geom = () => page.eval(`(() => {
        const n = ${ROOT}.querySelectorAll('.mm-node')[1];
        if (!n) return null;
        const b = n.getBoundingClientRect();
        return {
            id: n.dataset.mmId || '(无 id)', text: (n.querySelector('.mm-txt')?.textContent || '').trim(),
            left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom),
            w: Math.round(b.width), h: Math.round(b.height),
            cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2),
            nodeCount: ${ROOT}.querySelectorAll('.mm-node').length,
        };
    })()`);

    console.log("【初始几何】");
    let g = await geom();
    console.log(`  ${JSON.stringify(g)}`);
    const before = g;

    console.log("\n【连点中心 4 次，每次点后读状态】");
    for (let i = 1; i <= 4; i++) {
        const now = await geom();
        await tap(now.cx, now.cy);
        await sleep(900);
        const st = await page.eval(`(() => {
            const r = ${ROOT};
            const sel = r.querySelectorAll('.mm-node.mm-sel').length;
            const selText = [...r.querySelectorAll('.mm-node.mm-sel .mm-txt')].map((e) => e.textContent.trim()).join(',');
            const n = r.querySelectorAll('.mm-node')[1];
            return { sel, selText, id: n?.dataset?.mmId || '(无 id)', editing: !!r.querySelector('.mm-node[data-mm-editing]') };
        })()`);
        console.log(`  第 ${i} 次：点 (${now.cx},${now.cy}) 节点「${now.text}」id=${now.id} → 选中 ${st.sel} 个 [${st.selText}]｜编辑态 ${st.editing}`);
    }

    console.log("\n【点文字正中（mm-txt 的中心）4 次】");
    for (let i = 1; i <= 4; i++) {
        const t = await page.eval(`(() => {
            const n = ${ROOT}.querySelectorAll('.mm-node')[1];
            const x = n.querySelector('.mm-txt');
            if (!x) return null;
            const b = x.getBoundingClientRect();
            return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), txt: x.textContent.trim(), id: n.dataset.mmId || '(无 id)' };
        })()`);
        if (!t) { console.log("  没有 .mm-txt"); break; }
        await tap(t.x, t.y);
        await sleep(900);
        const sel = await page.eval(`(${ROOT}?.querySelectorAll('.mm-node.mm-sel') || []).length`);
        console.log(`  第 ${i} 次：点文字「${t.txt}」(id=${t.id}) → 选中 ${sel} 个`);
    }

    console.log("\n【节点数量有没有变（确认没被改坏）】");
    const after = await geom();
    console.log(`  前 ${before.nodeCount} 个 → 后 ${after?.nodeCount} 个｜节点[1] ${before.id} → ${after?.id}`);
} finally {
    await chrome.close();
    await removeDoc(api, doc);
    console.log("已清理临时文档");
}
