/**
 * 只读探针：任务列表项的「勾选态」存在哪一层、怎么安全地改。
 *
 * ## 已确认的事实
 *
 * kramdown 里勾选态写在**列表项那一行**上：
 *
 *     - {: id="…" updated="…"}[X] 已完成的任务      ← 勾选
 *     - {: id="…" updated="…"}[ ] 未完成的任务      ← 未勾选
 *
 * 块属性里**没有** `checked`（只有 id / updated）。
 * 思源前端真正用的字段是列表项元素上的 **`data-task`** 属性：
 * `" "` 表示未勾选，勾选后是 marker 字符（`x` / `X`）。
 *
 * ## 本探针要回答的问题
 *
 * 从插件侧改勾选态，哪条路既改得动、又**不冲掉子列表**？
 *   A. `/api/block/updateBlock` + `dataType: "markdown"`，data = `- [x] 文字`
 *   B. `/api/block/updateBlock` + `dataType: "dom"`，data = 改过 data-task 的 outerHTML
 *
 * 跑完自删。
 */
import fs from "node:fs";

const K = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const NB = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const conf = JSON.parse(fs.readFileSync("D:/常青Data/conf/conf.json", "utf8"));
const T = conf.api?.token || "";
const api = async (p, b) =>
    (
        await fetch(K + p, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Token " + T },
            body: JSON.stringify(b ?? {}),
        })
    ).json();

const MD = [
    "- 任务探针",
    "  - [x] 有子项的任务",
    "    - 它的子条目",
    "  - [ ] 没有子项的任务",
    "",
].join("\n");

const mk = await api("/api/filetree/createDocWithMd", { notebook: NB, path: `/临时-任务探针-${Date.now()}`, markdown: MD });
const doc = mk.data;
const kd = async () => (await api("/api/block/getBlockKramdown", { id: listId })).data.kramdown;
/** 从 kramdown 里挖列表项 ID —— getChildBlocks 会把嵌套列表合并返回，不可靠 */
const itemsOf = (text) =>
    [...text.matchAll(/^\s*- \{: id="([^"]+)"[^}]*\}(\[[ xX]\])?/gm)].map((m) => ({ id: m[1], mark: m[2] ?? null }));
const show = (label, v) => console.log(`\n----- ${label} -----\n` + (typeof v === "string" ? v : JSON.stringify(v)));

let listId = "";
try {
    const kids = (await api("/api/block/getChildBlocks", { id: doc })).data;
    listId = kids.find((k) => k.type === "l").id;

    const first = itemsOf(await kd());
    console.log("列表", listId);
    console.log("列表项（从 kramdown 挖）:", JSON.stringify(first));

    const withKid = first.find((i) => i.mark === "[X]" || i.mark === "[x]");
    const noKid = first.find((i) => i.mark === "[ ]");
    show("有子项那条 的块属性", (await api("/api/attr/getBlockAttrs", { id: withKid.id })).data);

    /* ---------------- 实验 A：updateBlock markdown ---------------- */
    console.log("\n\n########## A：updateBlock(dataType=markdown) 到列表项 ##########");
    const rA = await api("/api/block/updateBlock", {
        dataType: "markdown",
        data: "- [ ] 有子项的任务",
        id: withKid.id,
    });
    console.log("响应:", JSON.stringify(rA));
    await new Promise((r) => setTimeout(r, 600));
    const kdA = await kd();
    show("A 之后的 kramdown", kdA);
    console.log("→ 子条目还在吗？", kdA.includes("它的子条目") ? "在 ✓" : "丢了 ✗");

    /* ---------------- 实验 B：updateBlock dom ---------------- */
    console.log("\n\n########## B：updateBlock(dataType=dom) 到列表项 ##########");
    // 先拿到当前 DOM 表示（kramdown 里没有 data-task，用 kramdown 反推不方便，
    // 所以这里直接构造一个最小 outerHTML 试水，看接口认不认）
    const rB = await api("/api/block/updateBlock", {
        dataType: "dom",
        data: `<div data-node-id="${noKid.id}" data-type="NodeListItem" data-subtype="t" data-marker="*" data-task="x" class="li protyle-task--done"><div class="protyle-action protyle-action--task" draggable="true"><svg><use xlink:href="#iconCheck"></use></svg></div><div data-node-id="${noKid.id}-p" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false">没有子项的任务</div><div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div>`,
        id: noKid.id,
    });
    console.log("响应:", JSON.stringify(rB));
    await new Promise((r) => setTimeout(r, 600));
    const kdB = await kd();
    show("B 之后的 kramdown", kdB);

    /* ---------------- 实验 C：直接改块属性 data-task ---------------- */
    console.log("\n\n########## C：setBlockAttrs 写 data-task ##########");
    const rC = await api("/api/attr/setBlockAttrs", { id: noKid.id, attrs: { "data-task": "x" } });
    console.log("响应:", JSON.stringify(rC));
    await new Promise((r) => setTimeout(r, 600));
    const kdC = await kd();
    show("C 之后的 kramdown", kdC);
} finally {
    const info = await api("/api/filetree/getPathByID", { id: doc }).catch(() => null);
    if (info?.data?.notebook) {
        await api("/api/filetree/removeDoc", { notebook: info.data.notebook, path: info.data.path }).catch(() => {});
    }
}
