/**
 * 只读探针：`blocks` 表里，一个列表项（type='i'）到底哪个字段是**它自己的文字**。
 *
 * 起因：跨图搜索用 `content` 匹配关键词，结果搜「跨图目标」把它的父节点
 * 「第二章」也搜出来了 —— 因为 `content` 对列表项是**整棵子树拼在一起**的
 * （实测 `顶层任务 甲任务 甲的子条目 乙任务`）。这样搜任何词都会把祖先一网打尽。
 *
 * 看看 `markdown` / `fcontent` / `name` 哪个是干净的。
 *
 * 用法：node tests/kernel/probe-sql-item-content.mjs
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

const md = ["- [ ] 顶层任务", "  - [ ] 甲任务", "    - 甲的子条目", "  - [x] 乙任务", "", "- 第二章", "  - 跨图目标节点", ""].join("\n");
const mk = await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-sql字段-${Date.now()}`, markdown: md });
const docId = mk.data;

try {
    /* 建完文档立刻查是查不到的 —— 思源是**异步建索引**的。
       上一版就是在这里拿到 0 行，白以为「SQL 查不到列表项」。
       轮询到出结果为止。 */
    let rows = [];
    for (let i = 0; i < 40; i++) {
        const j = await api("/api/query/sql", {
            stmt: `select id, type, subtype, content, fcontent, markdown, name, length from blocks where root_id = '${docId}' and type in ('l','i')`,
        });
        rows = j.data || [];
        if (rows.length > 0) {
            console.log(`索引就绪：等了约 ${i * 250}ms，拿到 ${rows.length} 行\n`);
            break;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    if (rows.length === 0) console.log("⚠ 10 秒内索引始终没建起来\n");

    for (const r of rows) {
        console.log(`--- type=${r.type}${r.subtype ? "/" + r.subtype : ""}  id=…${String(r.id).slice(-6)}`);
        for (const k of ["content", "fcontent", "markdown", "name"]) {
            const v = r[k];
            console.log(`    ${k.padEnd(10)} = ${v === null ? "NULL" : JSON.stringify(v)}`);
        }
    }

    // 顺带确认：拿 markdown 去匹配，父节点还会不会被搜出来
    const q = await api("/api/query/sql", {
        stmt: `select id, markdown from blocks where root_id = '${docId}' and type = 'i' and markdown like '%跨图目标%'`,
    });
    console.log(`\n用 markdown 匹配「跨图目标」→ ${(q.data || []).length} 行`);
    for (const r of q.data || []) console.log(`    …${String(r.id).slice(-6)}  ${JSON.stringify(r.markdown)}`);

    const q2 = await api("/api/query/sql", {
        stmt: `select id, content from blocks where root_id = '${docId}' and type = 'i' and content like '%跨图目标%'`,
    });
    console.log(`用 content 匹配「跨图目标」 → ${(q2.data || []).length} 行`);
    for (const r of q2.data || []) console.log(`    …${String(r.id).slice(-6)}  ${JSON.stringify(r.content)}`);
} finally {
    await removeDoc(api, docId);
    console.log("\n已清理临时文档");
}
