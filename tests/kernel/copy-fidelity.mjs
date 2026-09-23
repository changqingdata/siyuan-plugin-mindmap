/**
 * 副本路径的保真度矩阵。
 *
 * 背景：`actions.ts` 的 `relocateByCopy` / `duplicateNode` 会把节点序列化成一段字符串
 * 喂给 `/api/block/insertBlock`。现在用的是 `escapeMd(node.text)` —— 纯文本，
 * 于是「边界位置的降级/升级」「复制节点」会把整棵子树的格式静默抹掉。
 *
 * 要换成什么？本探针逐项测出 **markdown 通道到底能承载哪些行内格式**，
 * 再验证「kramdown 原文直接往返」这条更粗的路子行不行。
 *
 * ⚠️ 定位新块必须用「插入前后 ID 集合的差集」。
 * 用「锚点后一个」在下标上会错位（前面插入的块还留在列表里），
 * 我第一次跑就是这么误判的 —— 把老块当成了新块，得出完全相反的结论。
 *
 * 用法：node tests/kernel/copy-fidelity.mjs
 */
import fs from "node:fs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function kramdown(id) {
    const j = await api("/api/block/getBlockKramdown", { id });
    return j.code === 0 ? j.data.kramdown : `<err ${j.msg}>`;
}

async function domOf(id) {
    const j = await api("/api/block/getBlockDOM", { id });
    return j.code === 0 ? j.data.dom : "";
}

async function allItems(id, out = []) {
    for (const k of await children(id)) {
        if (k.type === "i") {
            out.push(k);
            await allItems(k.id, out);
        } else {
            await allItems(k.id, out);
        }
    }
    return out;
}

function features(html) {
    const count = (re) => (html.match(re) ?? []).length;
    return {
        strong: count(/data-type="strong"/g),
        em: count(/data-type="em"/g),
        u: count(/data-type="u"/g),
        s: count(/data-type="s"/g),
        code: count(/data-type="code"/g),
        mark: count(/data-type="mark"/g),
        sup: count(/data-type="sup"/g),
        sub: count(/data-type="sub"/g),
        math: count(/data-type="inline-math"/g),
        ref: count(/data-type="block-ref"/g),
        tag: count(/data-type="tag"/g),
        link: count(/data-type="a"/g),
        color: count(/style="color/g),
        img: count(/data-type="img"|<img /g),
    };
}

const fmt = (f) =>
    Object.entries(f)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}×${v}`)
        .join(" ") || "（无格式）";

/* ------------------------------------------------------------------ 造数据 */

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-副本保真-${Date.now()}`,
    markdown: ["- 副本保真度", "  - 甲", "  - 乙", "    - 乙的子项", ""].join("\n"),
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
console.log("文档:", docId, " 列表:", listId);

/* 用真实行内 HTML 注入「甲」，绕开 markdown 导入器 */
const RICH = [
    `<span data-type="strong">粗体</span> 普通 <span data-type="em">斜体</span> <span data-type="u">下划线</span>`,
    `<span data-type="mark">高亮</span> <span data-type="code">code</span>`,
    `<span data-type="text" style="color: var(--b3-font-color1)">红字</span>`,
    `<span data-type="block-ref" data-id="${docId}" data-subtype="s">块引用</span>`,
    `<span data-type="tag">标签</span>`,
].join(" ");

let items = await allItems(listId);
const itemA = items[1];
const itemB = items[2];
await api("/api/block/updateBlock", {
    id: (await children(itemA.id)).find((c) => c.type === "p").id,
    dataType: "dom",
    data: RICH,
});
await sleep(400);

items = await allItems(listId);
const srcFeatures = features(await domOf(itemA.id));
console.log("\n【基准】源列表项（甲）:", fmt(srcFeatures));

const kdA = await kramdown(itemA.id);
const kdB = await kramdown(itemB.id);
console.log("\n【kramdown 原文】单个列表项（甲）:\n" + kdA);
console.log("\n【kramdown 原文】带子树（乙）:\n" + kdB);

/* ------------------------------------------------------------------ 逐项测 markdown 通道 */

async function probe(label, data, expect) {
    const before = new Set((await allItems(listId)).map((i) => i.id));
    const res = await api("/api/block/insertBlock", { dataType: "markdown", data, previousID: itemA.id });
    if (res.code !== 0) {
        console.log(`  ${label.padEnd(26)} ✘ 内核拒绝: ${res.msg}`);
        return;
    }
    await sleep(220);
    const fresh = (await allItems(listId)).filter((i) => !before.has(i.id));
    if (fresh.length === 0) {
        console.log(`  ${label.padEnd(26)} ✘ 没找到新块`);
        return;
    }
    const first = fresh[0];
    const f = features(await domOf(first.id));
    const kids = await children(first.id);
    const sub = kids.find((k) => k.type === "l");
    const subCount = sub ? (await children(sub.id)).length : 0;
    const got = Object.entries(f)
        .filter(([, v]) => v > 0)
        .map(([k]) => k);
    const hit = expect.every((e) => got.includes(e));
    console.log(
        `  ${label.padEnd(26)} ${hit ? "✓" : "✘"} ${fmt(f).padEnd(34)} 子项 ${subCount}  新块数 ${fresh.length}`,
    );
}

console.log("\n" + "=".repeat(78));
console.log("一、markdown 通道逐项能力（每种语法单独插一条）");
console.log("=".repeat(78));
await probe("**粗体**", "- **粗体**", ["strong"]);
await probe("*斜体*", "- *斜体*", ["em"]);
await probe("<u>下划线</u>", "- <u>下划线</u>", ["u"]);
await probe("~~删除线~~", "- ~~删除线~~", ["s"]);
await probe("`行内代码`", "- `行内代码`", ["code"]);
await probe("==高亮==", "- ==高亮==", ["mark"]);
await probe("^上标^", "- ^上标^", ["sup"]);
await probe("~下标~", "- ~下标~", ["sub"]);
await probe("$E=mc^2$", "- $E=mc^2$", ["math"]);
await probe("#标签#", "- #标签#", ["tag"]);
await probe("[链接](url)", "- [思源](https://b3log.org/siyuan/)", ["link"]);
await probe("((id \"锚\")) 块引用", `- ((20221230192740-wpnntiv "锚文本"))`, ["ref"]);
await probe('<span style="color">', '- <span style="color:#ff5c5c">红字</span>', ["color"]);
await probe('<span data-type="strong">', '- <span data-type="strong">粗</span>', ["strong"]);
await probe("![]()  图片", "- ![图](assets/不存在.png)", ["img"]);

console.log("\n" + "=".repeat(78));
console.log("一之二、data-type 形式的 span（关键：源 HTML 就是这种形态）");
console.log("=".repeat(78));
const PX = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAAA1BMVEX/AAAAJ4XwAAAADUlEQVQI12P4//8/AwAI/AL+XJ/PAAAAAElFTkSuQmCC";
await probe('<span data-type="mark">', '- <span data-type="mark">高亮</span>', ["mark"]);
await probe('<span data-type="tag">', '- <span data-type="tag">标签</span>', ["tag"]);
await probe('<span data-type="em">', '- <span data-type="em">斜</span>', ["em"]);
await probe('<span data-type="u">', '- <span data-type="u">下划</span>', ["u"]);
await probe('<span data-type="s">', '- <span data-type="s">删除</span>', ["s"]);
await probe('<span data-type="code">', '- <span data-type="code">码</span>', ["code"]);
await probe('<span data-type="sup">', '- <span data-type="sup">上</span>', ["sup"]);
await probe('<span data-type="sub">', '- <span data-type="sub">下</span>', ["sub"]);
await probe('text+style 颜色', '- <span data-type="text" style="color: var(--b3-font-color1)">红字</span>', ["color"]);
await probe('text+style 字号', '- <span data-type="text" style="font-size: 22px">大字</span>', []);
await probe('a + data-href', '- <span data-type="a" data-href="https://b3log.org/siyuan/">链接</span>', ["link"]);
await probe(
    "block-ref + data-id",
    `- <span data-type="block-ref" data-id="${docId}" data-subtype="s">块引用</span>`,
    ["ref"],
);
await probe(
    "inline-math + data-content",
    '- <span data-type="inline-math" data-subtype="math" data-content="E=mc^2"></span>',
    ["math"],
);
await probe('img 包在 data-type="img"', `- <span data-type="img"><img src="data:image/png;base64,${PX}" alt=""></span>`, ["img"]);
await probe(
    "整段混合（源 HTML 原样）",
    "- " + RICH.replace(/<span data-type="block-ref" data-id="[^"]*"/, `<span data-type="block-ref" data-id="${docId}"`),
    ["strong", "em", "u", "code", "mark", "ref", "tag", "color"],
);

console.log("\n" + "=".repeat(78));
console.log("一之三、直接喂「甲」的 DOM 内层 HTML");
console.log("=".repeat(78));
const innerA = (await domOf(itemA.id)).replace(/^<div[^>]*>/, "").replace(/<\/div>$/, "");
await probe("dom 内层 HTML 原样", "- " + innerA, ["strong", "em", "u", "code", "mark", "ref", "tag", "color"]);

console.log("\n" + "=".repeat(78));
console.log("二、kramdown 原文往返");
console.log("=".repeat(78));
await probe("kramdown(甲) 原文", kdA, ["strong", "em", "u", "code", "mark", "ref", "tag", "color"]);
await probe("kramdown(乙) 含子树", kdB, ["strong"]);

console.log("\n" + "=".repeat(78));
console.log("三、混合拼装（模拟 serializeSubtree 的输出形态）");
console.log("=".repeat(78));
await probe(
    "两条带格式的列表项",
    ["- **父** `码`", "  - *子* ==亮==", ""].join("\n"),
    ["strong", "code", "em"],
);

console.log("\n基准对照: 源列表项（甲） " + fmt(srcFeatures));

/* ------------------------------------------------------------------ 清理 */

/* ⚠️ 本支是探针（顶层 await，没有 try/finally 包住主逻辑）—— 中途抛异常会跳过这里，
   在用户笔记本里留下「临时-副本保真-时间戳」。没做结构改造（探针跑得少、
   收益低于改动风险），但两点必须做到：
     1. 清理走 _doc-cleanup 的两步法（getPathByID → removeDoc）——
        原来用 getBlockInfo 取 box/path 是另一条路径，字段名不保证一致；
     2. 失败要**出声**，不能静默吞掉。
   万一真漏了，用 `npm run clean:tmp` 扫掉（按「临时-」+ 签名匹配）。 */
const cleaned = await removeDoc(api, docId);
console.log(cleaned ? "\n已清理临时文档" : "\n⚠️ 未能清理临时文档: " + docId);
