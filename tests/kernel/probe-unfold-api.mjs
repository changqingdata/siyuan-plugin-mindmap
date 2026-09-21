/**
 * 直接验证内核的折叠接口行为（foldBlock / unfoldBlock）。
 *
 * 起因：第十六轮真机验收里「批量展开把大纲里的 fold 清干净了」失败。
 * 折叠写回是走内核 API 的，所以先确认 API 本身的行为，再怀疑上层。
 *
 * 用法：node tests/kernel/probe-unfold-api.mjs
 */
import fs from "node:fs";
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

const md = ["- 折叠接口验证", "  - 甲", "    - 甲.1", "    - 甲.2", "  - 乙", "    - 乙.1", ""].join("\n");
const doc = (await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-接口验证-${Date.now()}`, markdown: md })).data;
const list = (await api("/api/block/getChildBlocks", { id: doc })).data.find((k) => k.type === "l").id;
const kids = (await api("/api/block/getChildBlocks", { id: list })).data;
console.log("getChildBlocks 原始返回:", JSON.stringify(kids).slice(0, 600));

const kd = async () => (await api("/api/block/getBlockKramdown", { id: list })).data.kramdown;
const count = async () => ((await kd()).match(/fold="1"/g) ?? []).length;

// 直接从 kramdown 里挖块 ID：比猜 API 的返回结构稳
const kd0 = await kd();
console.log("\nkramdown 原文:\n" + kd0);
const ids = [...kd0.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
console.log("挖到的块 ID:", ids);
const [a, b] = ids;

console.log("\n--- 初始 ---");
console.log("fold 数:", await count());

console.log("\n--- foldBlock(甲) ---");
console.log("返回:", JSON.stringify(await api("/api/block/foldBlock", { id: a })));
console.log("fold 数:", await count());

console.log("\n--- foldBlock(乙) ---");
console.log("返回:", JSON.stringify(await api("/api/block/foldBlock", { id: b })));
console.log("fold 数:", await count());

console.log("\n--- unfoldBlock(甲) ---");
console.log("返回:", JSON.stringify(await api("/api/block/unfoldBlock", { id: a })));
console.log("fold 数:", await count());

console.log("\n--- unfoldBlock(乙) ---");
console.log("返回:", JSON.stringify(await api("/api/block/unfoldBlock", { id: b })));
const kd2 = await kd();
console.log("fold 数:", (kd2.match(/fold="1"/g) ?? []).length);
console.log("kramdown:\n" + kd2);

console.log("\n--- 块属性(甲) ---");
console.log(JSON.stringify(await api("/api/attr/getBlockAttrs", { id: a })));

console.log("\n--- 换个顺序：先 fold 两个再立刻 unfold 两个 ---");
await api("/api/block/foldBlock", { id: a });
await api("/api/block/foldBlock", { id: b });
console.log("折完 fold 数:", await count());
const r1 = await api("/api/block/unfoldBlock", { id: a });
const r2 = await api("/api/block/unfoldBlock", { id: b });
console.log("unfold 返回:", JSON.stringify(r1), JSON.stringify(r2));
console.log("展开后 fold 数:", await count());

await removeDoc(api, doc);
console.log("\n已清理");
