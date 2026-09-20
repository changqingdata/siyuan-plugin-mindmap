/**
 * 迁移路径会不会导致「首次打开」与「之后再打开」的布局不同？
 *
 * 上一轮实测到过这个现象：同一份内容、同样 37 个可见节点，
 * 首次打开的画布是 1860×1861，重载之后是 1849×1832。
 * 差别很小，但它正是「布局依赖渲染路径」这一类问题，值得钉死。
 *
 * 做法：造一份一模一样的文档，分别用两种方式给它设折叠态 ——
 *   (a) 走旧属性 `custom-mindmap-fold`（会触发一次性迁移）
 *   (b) 直接写原生 fold（不走迁移）
 * 每种都测「首次打开」与「重载后」，看两者是否一致、以及 (a)(b) 是否一致。
 *
 * 用法：node tests/kernel/diag-migrate-layout.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";

const WORKSPACE = "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = conf.api?.token || "";
const api = async (p, b) =>
    (
        await fetch("http://127.0.0.1:6806" + p, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
            body: JSON.stringify(b ?? {}),
        })
    ).json();
const kids = async (id) => (await api("/api/block/getChildBlocks", { id })).data || [];

const BRANCHES = 9;
const PER = 6;
const md = ["- 迁移布局对照 · 大纲导图"];
for (let i = 1; i <= BRANCHES; i++) {
    md.push(`  - 分支 ${i} · 一个有点长的主题标题文字`);
    for (let j = 1; j <= PER; j++) md.push(`    - 条目 ${i}.${j}：用来观察排版、连线与层级的说明文字`);
}
md.push("");

const FP = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return null;
    const world = root.querySelector('.mm-world');
    const els = [...root.querySelectorAll('.mm-node')];
    const vis = els.filter((e) => e.style.visibility !== 'hidden');
    return {
        world: Math.round(parseFloat(world.style.width)) + 'x' + Math.round(parseFloat(world.style.height)),
        visible: vis.length,
        collapsed: root.querySelectorAll('.mm-toggle--collapsed').length,
        scale: parseFloat(world.style.zoom) || 1,
    };
})()`;

const chrome = await launch({ headless: true, port: 9354, width: 1680, height: 1050, dpr: 1 });
const results = {};

try {
    // 一个页面复用到底（cdp 的 page 没有 close()）
    const page = await chrome.newPage("about:blank");
    const waitMap = async (label) => {
        await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label });
        await sleep(2200);
    };

    for (const mode of ["legacy", "native"]) {
        const docRes = await api("/api/filetree/createDocWithMd", {
            notebook: NOTEBOOK,
            path: `/临时-迁移布局-${mode}-${Date.now()}`,
            markdown: md.join("\n"),
        });
        const docId = docRes.data;
        const listId = (await kids(docId)).find((k) => k.type === "l").id;
        const rootLi = (await kids(listId)).find((k) => k.type === "i").id;
        const innerList = (await kids(rootLi)).find((k) => k.type === "l").id;
        const branchIds = (await kids(innerList)).filter((k) => k.type === "i").map((b) => b.id);

        // 折「分支 1 / 3 / 7」——与用户那份文档的形态一致
        const foldIds = [branchIds[0], branchIds[2], branchIds[6]];

        if (mode === "legacy") {
            // 只写旧属性，不写原生 fold —— 逼插件走迁移
            await api("/api/attr/setBlockAttrs", {
                id: listId,
                attrs: { "custom-mindmap": "logic", "custom-mindmap-fold": foldIds.join(",") },
            });
        } else {
            await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });
            for (const id of foldIds) await api("/api/block/foldBlock", { id });
        }

        const go = async (label) => {
            await page.send("Page.navigate", {
                url: `http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`,
            });
            await sleep(3200);
            await waitMap(label);
        };

        await go(mode + "-首次");
        const first = await page.eval(FP);
        await page.send("Page.reload", { ignoreCache: true });
        await sleep(3200);
        await waitMap(mode + "-重载");
        const second = await page.eval(FP);

        // 顺带核对：迁移有没有真的把旧属性搬过去并清掉
        const attrs = await api("/api/attr/getBlockAttrs", { id: listId });
        const st = await api("/api/attr/getBlockAttrs", { id: foldIds[0] });

        console.log(`\n【${mode}】文档 ${docId}`);
        console.log(`  首次打开 ${JSON.stringify(first)}`);
        console.log(`  重载之后 ${JSON.stringify(second)}`);
        console.log(
            `  旧属性残留=${JSON.stringify(attrs.data?.["custom-mindmap-fold"] ?? null)}  分支1 原生 fold=${JSON.stringify(st.data?.fold ?? null)}`,
        );
        results[mode] = { first, second };
        await api("/api/block/deleteBlock", { id: docId });
    }

    console.log("\n===== 结论 =====");
    const k = (s) => `${s.world}|${s.visible}|${s.collapsed}`;
    for (const mode of ["legacy", "native"]) {
        const { first, second } = results[mode];
        console.log(
            `${mode.padEnd(6)} 首次=${k(first)}  重载=${k(second)}  ${k(first) === k(second) ? "一致 ✓" : "不一致 ✗"}`,
        );
    }
    const same =
        k(results.legacy.first) === k(results.native.first) &&
        k(results.legacy.second) === k(results.native.second);
    console.log(same ? "两种路径结果一致 ✓" : "两种路径结果不一致 ✗ —— 迁移会改变布局");
} finally {
    await chrome.close();
}
