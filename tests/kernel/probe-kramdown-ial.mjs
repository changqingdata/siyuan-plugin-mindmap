/**
 * 只读探针：`getBlockKramdown` 的 IAL 里到底有没有**自定义块属性**？
 *
 * 起因：节点标记（P1-2）存在块属性上，撤销走的是「快照 kramdown → restoreBlock 写回」
 * 这条路。如果 kramdown 里根本不带 `custom-mindmap-mark`，那么
 * 「撤销设置标记」就是一句空话 —— 快照前后一模一样，写回去等于没写。
 *
 * 用法：node tests/kernel/probe-kramdown-ial.mjs
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

const mk = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-kramdown-ial-${Date.now()}`,
    markdown: ["- 节点甲", "  - 节点乙", ""].join("\n"),
});
const docId = mk.data;
const listId = (await api("/api/block/getChildBlocks", { id: docId })).data.find((k) => k.type === "l").id;
const liA = (await api("/api/block/getChildBlocks", { id: listId })).data.find((k) => k.type === "i").id;

try {
    await api("/api/attr/setBlockAttrs", { id: liA, attrs: { "custom-mindmap-mark": '{"icon":"⭐","label":"重要"}' } });

    const kd = async (id) => (await api("/api/block/getBlockKramdown", { id })).data?.kramdown ?? "";

    console.log("=== 设了 custom-mindmap-mark 之后 ===");
    console.log(kd === undefined ? "" : await kd(listId));
    const text = await kd(listId);
    console.log(`\n含 custom-mindmap-mark？ ${text.includes("custom-mindmap-mark") ? "✔ 有" : "✘ 没有"}`);
    console.log(`含节点甲？ ${text.includes("节点甲") ? "✔" : "✘"}`);

    // 顺带看看 getBlockAttrs 与 DOM 属性两条路是不是都对得上
    const attrs = (await api("/api/attr/getBlockAttrs", { id: liA })).data;
    console.log(`\ngetBlockAttrs[${liA}] =`, JSON.stringify(attrs?.["custom-mindmap-mark"] ?? null));

    // 再看整篇文档的 kramdown 有没有带上它（换个粒度试试）
    const docKd = (await api("/api/block/getBlockKramdown", { id: docId })).data?.kramdown ?? "";
    console.log(`整篇文档的 kramdown 里有没有？ ${docKd.includes("custom-mindmap-mark") ? "✔ 有" : "✘ 没有"}`);

    /* ---------------- 关键一问：把它当 markdown 写回去，属性还在吗 ---------------- */
    // 撤销走的就是这条路（restoreBlock → updateBlock dataType:"markdown"），
    // 如果属性在这一步被丢掉，「撤销设置标记」就是一句空话。
    console.log("\n=== 往返测试：读 kramdown → 改掉属性 → 把 kramdown 写回去 ===");
    const snap = await kd(listId);
    await api("/api/attr/setBlockAttrs", { id: liA, attrs: { "custom-mindmap-mark": '{"icon":"🔥"}' } });
    console.log(`改完之后: ${JSON.stringify((await api("/api/attr/getBlockAttrs", { id: liA })).data?.["custom-mindmap-mark"])}`);

    const up = await api("/api/block/updateBlock", { dataType: "markdown", data: snap, id: listId });
    console.log(`updateBlock code=${up.code}`);
    await new Promise((r) => setTimeout(r, 900));
    const after = (await api("/api/attr/getBlockAttrs", { id: liA })).data?.["custom-mindmap-mark"];
    console.log(`写回 kramdown 之后: ${JSON.stringify(after ?? null)}`);
    console.log(
        after && after.includes("重要")
            ? "✔ 自定义属性被 markdown 往返保住了 —— 撤销理应能还原"
            : "✘ 自定义属性在 markdown 往返里丢了 —— 撤销不可能靠快照还原它",
    );
    console.log(`块 ID 还是原来那个吗？ ${(await api("/api/block/getBlockKramdown", { id: liA })).code === 0 ? "✔" : "✘"}`);
} finally {
    await removeDoc(api, docId);
    console.log("\n已清理临时文档");
}
