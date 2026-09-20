/**
 * 验证「大纲原生折叠」这条路能不能当唯一真相：
 *   1. 折叠状态存在哪 —— 块属性？kramdown IAL？还是内存里？
 *   2. foldBlock / unfoldBlock 是否持久化（换一个会话读还是折叠态吗）？
 *   3. getBlockDOM 里的 DOM 是否带 fold="1"（解析器要靠它读状态）
 */
import fs from "node:fs";

const KERNEL = "http://127.0.0.1:6806";
const NOTEBOOK = "20221230192740-wpnntiv";
const conf = JSON.parse(fs.readFileSync("D:/常青Data/conf/conf.json", "utf8"));
const TOKEN = conf.api.token;

async function api(p, payload) {
    const r = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    return r.json();
}

const md = ["- 根节点", "  - 甲", "    - 甲1", "    - 甲2", "  - 乙", "    - 乙1", ""];
const doc = (await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK, path: `/临时-折叠API-${Date.now()}`, markdown: md.join("\n"),
})).data;
console.log("doc:", doc);

const kids = async (id) => (await api("/api/block/getChildBlocks", { id })).data ?? [];
const list = (await kids(doc)).find((k) => k.type === "l");
console.log("list:", list.id, "子块:", (await kids(list.id)).map((k) => `${k.type}:${k.id}`).join(" "));

const items = await kids(list.id);
const jia = items.find((k) => k.content?.includes("甲") && k.type === "i");
console.log("甲 (NodeListItem):", jia.id, JSON.stringify(jia.content));

const domOf = async (id) => (await api("/api/block/getBlockDOM", { id })).data?.dom ?? "";
const kramdown = async (id) => (await api("/api/block/getBlockKramdown", { id })).data?.kramdown ?? "";
const attrs = async (id) => (await api("/api/attr/getBlockAttrs", { id })).data ?? {};

console.log("\n========== 折叠前 ==========");
console.log("DOM     :", domOf ? (await domOf(jia.id)).slice(0, 200) : "");
console.log("kramdown:", JSON.stringify((await kramdown(jia.id)).slice(0, 200)));
console.log("attrs   :", JSON.stringify(await attrs(jia.id)));

console.log("\n========== 调 foldBlock ==========");
console.log(JSON.stringify(await api("/api/block/foldBlock", { id: jia.id })));

console.log("\n========== 折叠后 ==========");
console.log("DOM     :", (await domOf(jia.id)).slice(0, 200));
console.log("kramdown:", JSON.stringify((await kramdown(jia.id)).slice(0, 200)));
console.log("attrs   :", JSON.stringify(await attrs(jia.id)));

// 换一个「会话」：直接读磁盘上的 .sy 文件，看折叠到底有没有落盘
const sql = await api("/api/query/sql", { stmt: `SELECT path FROM blocks WHERE id='${doc}'` });
const docPath = sql.data?.[0]?.path ?? "";
console.log("\n.sy 路径:", docPath);
const raw = await api("/api/file/getFile", { path: docPath });
console.log("落盘内容里含 fold 吗:", JSON.stringify(raw).includes("fold"));

console.log("\n========== unfoldBlock 还原 ==========");
console.log(JSON.stringify(await api("/api/block/unfoldBlock", { id: jia.id })));
console.log("DOM     :", (await domOf(jia.id)).slice(0, 200));

await api("/api/block/deleteBlock", { id: doc });
console.log("\n已清理");
