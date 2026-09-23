/**
 * 插入块调用形态矩阵。
 * 目的：找出「把新列表项放到指定位置」到底该怎么调内核。
 * 只看结果树，不做断言。
 */
import fs from "node:fs";
import { removeDoc } from "./_doc-cleanup.mjs";

const c = JSON.parse(fs.readFileSync("D:/常青Data/conf/conf.json", "utf8"));
const T = c.api.token;
const api = async (p, b) =>
    (
        await fetch("http://127.0.0.1:6806" + p, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Token " + T },
            body: JSON.stringify(b || {}),
        })
    ).json();

const kids = async (id) => {
    const r = await api("/api/block/getChildBlocks", { id });
    return r.code === 0 ? r.data : [];
};

async function dump(id, ind, out) {
    for (const k of await kids(id)) {
        const label = k.type + "/" + (k.subType ?? "-");
        out.push("  ".repeat(ind) + label + "  …" + k.id.slice(-7) + "  " + JSON.stringify((k.content || "").slice(0, 24)));
        await dump(k.id, ind + 1, out);
    }
}

const MD = ["- 终极思考", "  - 环境选择", "    - 132", "      - 1231", "  - 123", ""].join("\n");

async function fresh(tag) {
    const docId = (
        await api("/api/filetree/createDocWithMd", {
            notebook: "20221230192740-wpnntiv",
            path: "/临时-插入矩阵-" + tag + "-" + Date.now(),
            markdown: MD,
        })
    ).data;
    const list = (await kids(docId)).find((k) => k.type === "l");
    const rootItem = (await kids(list.id))[0];
    const rk = await kids(rootItem.id);
    const subList = rk.find((k) => k.type === "l");
    const items = await kids(subList.id);
    const env = items[0];
    const envSub = (await kids(env.id)).find((k) => k.type === "l");
    return { docId, listId: list.id, rootItem, subList: subList.id, items, env, envSub: envSub?.id };
}

async function cleanup(docId) {
    /* 走 _doc-cleanup 的两步法（getPathByID → removeDoc）。
       原先用 getBlockInfo 取 box/path —— 那是另一条路径，字段名也不保证一致。 */
    if (!(await removeDoc(api, docId))) console.warn("  ⚠️ 清理失败:", docId);
}

const cases = [
    ["A parentID=子列表id", (s) => ({ data: "- 新节点", parentID: s.subList })],
    ["B parentID=列表项id(有子列表)", (s) => ({ data: "- 新节点", parentID: s.rootItem.id })],
    ["C previousID=末个列表项id", (s) => ({ data: "- 新节点", previousID: s.items[s.items.length - 1].id })],
    ["D parentID=列表项id(叶子)", (s) => ({ data: "- 新节点", parentID: s.env.id })],
    ["E parentID=列表项id(叶子)+纯文本", (s) => ({ data: "新节点", parentID: s.env.id })],
    ["F previousID=列表项id(叶子)", (s) => ({ data: "- 新节点", previousID: s.env.id })],
    ["G previousID=子列表id", (s) => ({ data: "- 新节点", previousID: s.subList })],
    ["H nextID=子列表id", (s) => ({ data: "- 新节点", nextID: s.subList })],
    ["I parentID=列表块id", (s) => ({ data: "- 新节点", parentID: s.listId })],
];

for (const [name, mk] of cases) {
    const s = await fresh(name[0]);
    /* ⚠️ 清理放 finally：原先写在循环体末尾，中途任何一步抛异常
       （内核拒绝、dump 出错）就会跳过清理，
       在用户笔记本里留下「临时-插入矩阵-x-时间戳」。 */
    try {
        const payload = mk(s);
        const res = await api("/api/block/insertBlock", { dataType: "markdown", ...payload });
        const out = [];
        await dump(s.listId, 0, out);
        const short = JSON.stringify(payload).replace(/"([a-z0-9-]{18,})"/g, (m, g) => '"…' + g.slice(-7) + '"');
        console.log("\n### " + name);
        console.log("   请求: " + short);
        console.log("   code=" + res.code + (res.code !== 0 ? " " + res.msg : ""));
        console.log(out.map((l) => "   " + l).join("\n"));
    } finally {
        await cleanup(s.docId);
    }
}
