/**
 * 临时探针：kramdown → updateBlock(markdown) 往返，哪种喂法能一次到位？
 *
 * 背景：真机验收「删除节点 → Ctrl+Z」失败。载荷里 7 个节点一个不少、code 也是 0，
 * 落库后却只有 6 个，还多出一个**没有段落的坏列表项**。
 * 已定位：快照里带着「刚刚被删掉的块 ID」，内核的 markdown 重导入会整体错位一格。
 *
 * 这里对比三种喂法（每种都从全新文档开始）：
 *   raw       —— 原样喂（带 {: id=… }）
 *   noIal     —— 剥掉所有块属性注释，让内核全新构建
 *   rawTwice  —— 原样喂两次
 *
 * 结论（决定了 src/utils/api.ts 里 restoreBlock 为什么写两次）：
 *   喂一次 —— ✘ 最后一项的段落子块脱开，落成「有内容、没段落」的坏列表项；
 *   剥掉 IAL 再喂一次 —— ✘ 一样坏（所以不是「已删块 ID」的锅）；
 *   喂两次 —— ✔ 完全还原。
 *
 * 用法：npm run kernel:restore -- c      MM_KEEP=1 保留文档
 */

import fs from "node:fs";
import path from "node:path";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const SCENARIO = (process.argv[2] || process.env.MM_SCENARIO || "c").toLowerCase();

const conf = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";

const MD = {
    a: ["- 终极思考", "  - 环境选择", "    - 132", "      - 1231", "  - 123", ""].join("\n"),
    b: ["- 终极思考", "  - 环境选择", "    - 新节点", "  - 132", "    - 1231", "  - 123", ""].join("\n"),
    // 真机形态：带子列表的列表项后面又跟同级项
    c: ["- 终极思考", "  - 环境选择", "    - 新节点", "  - 132", "    - 1231", "  - 123", "  - 新节点", ""].join("\n"),
}[SCENARIO];

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

/** 只认「有段落子块」的列表项 —— 和真机断言同一套口径，坏项会被静默吃掉 */
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
    return out;
}

/** 连带「没有段落的坏列表项」一起报出来 */
async function rawShape(id, depth = 0, out = []) {
    for (const k of await children(id)) {
        if (k.type === "i") {
            const own = (await children(k.id)).find((c) => c.type === "p");
            out.push(`${depth}:${(own?.content || "").trim() || "⚠无段落"}`);
            await rawShape(k.id, depth + 1, out);
        } else {
            await rawShape(k.id, depth, out);
        }
    }
    return out;
}

async function findItem(id, text) {
    for (const k of await children(id)) {
        if (k.type === "i") {
            const own = (await children(k.id)).find((c) => c.type === "p");
            if ((own?.content || "").trim() === text) return k;
            const hit = await findItem(k.id, text);
            if (hit) return hit;
        } else {
            const hit = await findItem(k.id, text);
            if (hit) return hit;
        }
    }
    return null;
}

/** 建一份干净文档，返回 {doc, listId} */
async function fresh() {
    const created = await api("/api/filetree/createDocWithMd", {
        notebook: NOTEBOOK,
        path: `/临时-还原探针-${Date.now()}`,
        markdown: MD,
    });
    if (created.code !== 0) throw new Error("建文档失败: " + JSON.stringify(created));
    const doc = created.data;
    const listId = (await children(doc)).find((k) => k.type === "l").id;
    await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "mind" } });
    return { doc, listId };
}

async function drop(doc) {
    if (process.env.MM_KEEP) {
        console.log("  MM_KEEP=1 保留:", doc);
        return;
    }
    /* ⚠️ 本支是探针（顶层 await，没有 try/finally 包住主逻辑），
       `drop()` 又写在循环体末尾 —— 中途抛异常就会跳过清理，留下「临时-还原探针-时间戳」。
       这里没做结构改造（探针跑得少、收益低于改动风险），但两点必须做到：
         1. 清理走 _doc-cleanup 的两步法（getPathByID → removeDoc），
            原来用 getBlockInfo 取 box/path 是另一条路径，字段名不保证一致；
         2. 失败要**出声**，不能静默吞掉。
       万一真漏了，用 `npm run clean:tmp` 扫掉（它按「临时-」+ 签名匹配）。 */
    if (!(await removeDoc(api, doc))) console.warn("  ⚠️ 清理失败:", doc);
}

/** 剥掉所有块属性注释行（最后一行是列表块自己的 IAL，留着） */
const stripIal = (s) =>
    s
        .split("\n")
        .filter((line, i, arr) => !(i < arr.length - 1 && /^\s*\{:.*\}\s*$/.test(line)))
        .join("\n");

console.log(`场景 ${SCENARIO}  markdown:\n${MD}\n`);

for (const variant of ["raw", "noIal", "rawTwice"]) {
    const { doc, listId } = await fresh();
    const k = (await api("/api/block/getBlockKramdown", { id: listId })).data.kramdown;
    const before = await itemShape(listId);

    // 删掉 "123"，制造「快照里含已删块 ID」的局面
    const target = await findItem(listId, "123");
    await api("/api/block/deleteBlock", { id: target.id });
    await new Promise((r) => setTimeout(r, 500));
    const dropped = await itemShape(listId);

    const data = variant === "noIal" ? stripIal(k) : k;
    const times = variant === "rawTwice" ? 2 : 1;
    for (let i = 0; i < times; i++) {
        await api("/api/block/updateBlock", { id: listId, dataType: "markdown", data: data });
        await new Promise((r) => setTimeout(r, 700));
    }

    const after = await itemShape(listId);
    const raw = await rawShape(listId);
    const good = JSON.stringify(after) === JSON.stringify(before) && !raw.some((x) => x.includes("⚠"));
    // 便宜的校验口径：kramdown 里 `{: … }` 块属性行的条数。
    // 坏项少了那个段落子块，就会少一行 —— 比遍历块树便宜得多。
    const kBack = (await api("/api/block/getBlockKramdown", { id: listId })).data.kramdown;
    const ialCount = (s) => s.split("\n").filter((l) => /^\s*\{:/.test(l)).length;
    console.log(`---- 喂法 ${variant} ----`);
    console.log(`  IAL 行数：目标 ${ialCount(k)} → 还原后 ${ialCount(kBack)}${ialCount(k) === ialCount(kBack) ? "  ✔一致" : "  ✘少了"}`);
    console.log(`  还原前 ${before.length} 项：${before.join(" | ")}`);
    console.log(`  删除后 ${dropped.length} 项`);
    console.log(`  还原后 ${after.length} 项：${after.join(" | ")}`);
    console.log(`  坏项可见      ：${raw.join(" | ")}`);
    /*
     * ⚠️⚠️ 这里的 ✘ 是**预期结果，不是失败** —— 本支是探针，故意不设退出码。
     *
     * 本脚本要证明的命题就是「喂一次还原不干净、喂两次才行」：
     *   raw      → ✘（最后一项的段落子块脱开，落成「有内容、没段落」的坏列表项）
     *   noIal    → ✘（一样坏，所以不是「已删块 ID」的锅）
     *   rawTwice → ✔
     * 所以前两个变体**本来就该 ✘**，正是它让 src/utils/api.ts 的 restoreBlock 写两次。
     *
     * 判据（与 diag-zoom-measure 同一条）：
     *   这段代码红了，说明「产品坏了」还是「我搞错了」？前者才配当门。
     *   这里是「红」本身就是要记录的结论 —— 加门就会造出一扇永远红的门，
     *   而永远红的门比没有门更糟（会被所有人无视）。
     */
    console.log(`  ${good ? "✔ 完全还原" : "✘ 没还原干净（见脚本头部注释：raw / noIal 变体本就如此，属预期）"}`);

    await drop(doc);
}
