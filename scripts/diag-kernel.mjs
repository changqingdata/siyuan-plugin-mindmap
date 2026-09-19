#!/usr/bin/env node
/**
 * 内核 API 诊断：确认「往列表项里插入子节点」到底该传什么 parentID。
 *
 * 背景：CheckListItemNesting 禁止列表项直接包含列表项，
 * 所以 parentID 传 NodeListItem 的 id 会被内核拒绝。
 * 本脚本在**临时文档**里实测四种写法，跑完自动删掉临时文档。
 *
 * 用法：node scripts/diag-kernel.mjs
 *       node scripts/diag-kernel.mjs --keep   （保留临时文档，便于人工检查）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ---------------------------------------------------------------- 连接内核 */

const wsCfg = path.join(os.homedir(), ".config", "siyuan", "workspace.json");
const workspace = JSON.parse(fs.readFileSync(wsCfg, "utf8"))[0];
const conf = JSON.parse(fs.readFileSync(path.join(workspace, "conf", "conf.json"), "utf8"));
const token = conf.api.token;
const BASE = "http://127.0.0.1:6806";

async function api(route, payload = {}) {
    const res = await fetch(BASE + route, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
        body: JSON.stringify(payload),
    });
    return res.json();
}

const log = (...a) => console.log(...a);

/* ------------------------------------------------------------ 建临时文档 */

const DOC_TITLE = `__mindmap_api_diag_${Date.now()}`;
const MD = [
    "- 甲",
    "  - 甲一",
    "  - 甲二",
    "- 乙",
].join("\n");

const notebooks = await api("/api/notebook/lsNotebooks");
const nb = (notebooks.data?.notebooks ?? []).find((n) => !n.closed);
if (!nb) {
    console.error("没有打开的笔记本，无法测试");
    process.exit(1);
}
log(`笔记本：${nb.name} (${nb.id})`);

const created = await api("/api/filetree/createDocWithMd", {
    notebook: nb.id,
    path: `/${DOC_TITLE}`,
    markdown: MD,
});
if (created.code !== 0) {
    console.error("建文档失败：", created.msg);
    process.exit(1);
}
const docId = created.data;
log(`临时文档：${docId}\n`);

/* ---------------------------------------------------------- 取出块 ID 结构 */

async function dumpBlocks(label) {
    const r = await api("/api/query/sql", {
        stmt: `SELECT id, type, subtype, parent_id, content, sort FROM blocks WHERE root_id = '${docId}' AND type != 'd' ORDER BY sort`,
    });
    log(`--- ${label} ---`);
    for (const b of r.data ?? []) {
        log(`  ${b.type}/${b.subtype ?? "-"}  id=${b.id}  parent=${b.parent_id}  content=${JSON.stringify((b.content ?? "").slice(0, 24))}`);
    }
    return r.data ?? [];
}

let blocks = await dumpBlocks("初始结构");

/** 按 content 找块 */
const byContent = (text, type) => blocks.find((b) => b.content === text && (!type || b.type === type));

const liJia = byContent("甲", "i");      // NodeListItem
const liJiaYi = byContent("甲一", "i");  // NodeListItem
const listRoot = blocks.find((b) => b.type === "l" && b.parent_id === docId);
const listJia = blocks.find((b) => b.type === "l" && b.parent_id === liJia?.id);

log("");
log(`甲(NodeListItem)     = ${liJia?.id}`);
log(`甲一(NodeListItem)   = ${liJiaYi?.id}`);
log(`甲 的子列表(NodeList) = ${listJia?.id}`);
log("");

if (!liJia || !liJiaYi || !listJia) {
    console.error("没能解析出预期的块结构，中止");
    process.exit(1);
}

/* ------------------------------------------------------------ 四种写法实测 */

const results = [];

async function attempt(label, payload, expectOk) {
    const res = await api("/api/block/insertBlock", { dataType: "markdown", data: "- 新节点", ...payload });
    const ok = res.code === 0;
    const ops = res.data?.transactions?.[0]?.doOperations ?? [];
    const newId = ops[0]?.id ?? null;
    const verdict = ok === expectOk ? "符合预期" : "★与预期不符★";
    results.push({ label, ok, msg: res.msg, newId, expectOk });
    log(`[${ok ? "成功" : "失败"}] ${label}`);
    log(`        msg=${JSON.stringify(res.msg ?? "")}  newId=${newId}  ${verdict}`);
    return { ok, newId };
}

log("=== 写法实测 ===\n");

// A. parentID = NodeListItem（列表项本身）—— 预期被 CheckListItemNesting 拒绝
await attempt("A. parentID = 列表项(甲) 的 id", { parentID: liJia.id }, false);

// B. parentID = NodeList（甲 的子列表）—— 预期成功
const b = await attempt("B. parentID = 甲的子列表(NodeList) 的 id", { parentID: listJia.id }, true);

// C. previousID = 最后一个子项（甲二）—— 预期成功
await attempt("C. previousID = 甲二(列表项) 的 id", { previousID: liJiaYi.id }, true);

// D. 同时给 parentID(NodeList) 与 previousID
if (b.newId) {
    await attempt("D. parentID=NodeList + previousID=刚插入的块", { parentID: listJia.id, previousID: b.newId }, true);
}

/* ---------------------------------------------------------------- 收尾 */

log("");
blocks = await dumpBlocks("最终结构");

if (process.argv.includes("--keep")) {
    log(`\n已保留临时文档（--keep）：${DOC_TITLE}`);
} else {
    const rm = await api("/api/filetree/removeDoc", { id: docId });
    log(`\n临时文档已删除：code=${rm.code}`);
}

/* ---------------------------------------------------------------- 结论 */

log("\n=== 结论 ===");
for (const r of results) {
    log(`${r.ok ? "✓" : "✗"} ${r.label}  →  ${r.ok ? "成功" : `失败(${r.msg})`}`);
}
