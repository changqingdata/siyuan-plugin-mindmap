/**
 * 只读探针：确认 `/api/block/batchUpdateTaskListItemMarker` 的**入参形状**。
 *
 * `probe-task-marker-api.mjs` 试过 `{ids:[...], marker}` 和 `{id, marker}` 两种，
 * 但源码里 `setTaskMarkers()` 用的是 `{items:[{id, marker}, ...]}` —— 那一支从没实测过。
 * 批量接口是「一次事务」，形状猜错的话不会报错、只会**静默不生效**，
 * 而 P0-1 的批量勾选全靠它，所以必须坐实。
 *
 * 跑完自删。
 */
import fs from "node:fs";

const K = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const NB = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const WS = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const conf = JSON.parse(fs.readFileSync(`${WS}/conf/conf.json`, "utf8"));
const T = process.env.SIYUAN_TOKEN || conf.api?.token || "";
const api = async (p, b) =>
    (
        await fetch(K + p, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Token " + T },
            body: JSON.stringify(b ?? {}),
        })
    ).json();

const MD = ["- 批量标记探针", "  - [ ] 甲", "  - [ ] 乙", "  - [ ] 丙", ""].join("\n");
const mk = await api("/api/filetree/createDocWithMd", {
    notebook: NB,
    path: `/临时-批量标记-${Date.now()}`,
    markdown: MD,
});
const doc = mk.data;

let listId = "";
const kd = async () => (await api("/api/block/getBlockKramdown", { id: listId })).data.kramdown;
const marks = (text) =>
    [...text.matchAll(/^\s*- \{: id="([^"]+)"[^}]*\}(\[[ xX]\]) (.*)$/gm)]
        .map((m) => `${m[1].slice(-6)}${m[2]}${m[3]}`)
        .join(" | ");

const reset = async (ids) => {
    await api("/api/block/batchUpdateTaskListItemMarker", { items: ids.map((id) => ({ id, marker: " " })) });
    await new Promise((x) => setTimeout(x, 300));
};

try {
    const kids = (await api("/api/block/getChildBlocks", { id: doc })).data;
    listId = kids.find((k) => k.type === "l").id;
    const ids = [...(await kd()).matchAll(/^\s*- \{: id="([^"]+)"[^}]*\}(\[[ xX]\]) /gm)].map((m) => m[1]);
    console.log("列表", listId, "\n任务项:", ids.join(", "));
    console.log("初始:", marks(await kd()));

    const shapes = [
        ["items[]  ← 源码用的这个", { items: ids.map((id) => ({ id, marker: "x" })) }],
        ["ids[] + marker", { ids, marker: "x" }],
        ["id + marker（单个）", { id: ids[0], marker: "x" }],
        ["items[] + marker", { items: ids, marker: "x" }],
    ];

    for (const [name, payload] of shapes) {
        const r = await api("/api/block/batchUpdateTaskListItemMarker", payload);
        await new Promise((x) => setTimeout(x, 400));
        const after = marks(await kd());
        const n = (after.match(/\[[xX]\]/g) || []).length;
        console.log(
            `\n【${name}】 ${JSON.stringify(payload).slice(0, 120)}\n  code=${r.code} ${r.msg || ""}\n  → 勾上 ${n}/${ids.length}\n  ${after}`,
        );
        if (n > 0) console.log("  ✔ 这个形状有效");
        await reset(ids);
    }

    // 再验一次「有效形状 + 复位」是否也走同一条路（双向）
    const okShape = { items: ids.map((id) => ({ id, marker: "x" })) };
    await api("/api/block/batchUpdateTaskListItemMarker", okShape);
    await new Promise((x) => setTimeout(x, 400));
    const up = marks(await kd());
    await api("/api/block/batchUpdateTaskListItemMarker", { items: ids.map((id) => ({ id, marker: " " })) });
    await new Promise((x) => setTimeout(x, 400));
    const down = marks(await kd());
    console.log(`\n双向验证:\n  勾选 → ${up}\n  复位 → ${down}`);
} finally {
    const info = await api("/api/filetree/getPathByID", { id: doc }).catch(() => null);
    if (info?.data?.notebook) {
        await api("/api/filetree/removeDoc", { notebook: info.data.notebook, path: info.data.path }).catch(() => {});
    }
}
