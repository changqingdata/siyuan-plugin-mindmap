/**
 * 只读探针：摸清 `/api/block/updateTaskListItemMarker` 的入参形状。
 *
 * 上一轮探针里 `setBlockAttrs({ "data-task": "x" })` 被内核拒绝，
 * 但错误信息顺带把官方接口报了出来：
 *
 *   Please use "/api/block/updateTaskListItemMarker" or
 *   "/api/block/batchUpdateTaskListItemMarker" to update the task list item marker
 *
 * 这里把几种可能的参数名挨个试一遍，找出能真正改动 kramdown 的那个，
 * 并确认**子列表不会被冲掉**（这是 P0-1 的硬约束）。
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

const MD = ["- 任务探针", "  - [ ] 有子项的任务", "    - 它的子条目", "  - [ ] 另一个任务", ""].join("\n");
const mk = await api("/api/filetree/createDocWithMd", { notebook: NB, path: `/临时-任务标记-${Date.now()}`, markdown: MD });
const doc = mk.data;

let listId = "";
const kd = async () => (await api("/api/block/getBlockKramdown", { id: listId })).data.kramdown;
/** 只看带 marker 的那些行，输出精简 */
const marks = (text) =>
    [...text.matchAll(/^\s*- \{: id="([^"]+)"[^}]*\}(\[[ xX]\])? (.*)$/gm)]
        .filter((m) => m[2])
        .map((m) => `${m[1].slice(-6)} ${m[2]} ${m[3]}`)
        .join(" | ");

try {
    const kids = (await api("/api/block/getChildBlocks", { id: doc })).data;
    listId = kids.find((k) => k.type === "l").id;

    const ids = [...(await kd()).matchAll(/^\s*- \{: id="([^"]+)"[^}]*\}(\[[ xX]\])/gm)].map((m) => m[1]);
    console.log("列表", listId, "\n任务项:", ids.join(", "));
    console.log("初始:", marks(await kd()));

    const [withKid, plain] = ids;

    const trials = [
        ["updateTaskListItemMarker", { id: withKid, marker: "x" }],
        ["updateTaskListItemMarker", { id: withKid, marker: "X" }],
        ["updateTaskListItemMarker", { id: withKid, dataTask: "x" }],
        ["updateTaskListItemMarker", { id: withKid, task: "x" }],
        ["updateTaskListItemMarker", { id: withKid, checked: true }],
        ["updateTaskListItemMarker", { id: withKid, data: "x" }],
    ];

    for (const [path, payload] of trials) {
        const r = await api(`/api/block/${path}`, payload);
        await new Promise((x) => setTimeout(x, 350));
        const after = marks(await kd());
        const hit = after.includes("[x]") || after.includes("[X]");
        console.log(
            `\n/api/block/${path} ${JSON.stringify(payload)}\n  响应 code=${r.code} ${r.msg || ""}\n  现在: ${after}\n  → ${hit ? "改动生效 ✓" : "无变化"}`,
        );
        if (hit) {
            console.log("  子条目还在吗？", (await kd()).includes("它的子条目") ? "在 ✓" : "丢了 ✗");
            // 复位
            await api("/api/block/updateTaskListItemMarker", { id: withKid, marker: " " });
            await new Promise((x) => setTimeout(x, 350));
            console.log("  复位后:", marks(await kd()));
            break;
        }
    }

    /* ---------------- 批量接口 ---------------- */
    console.log("\n\n########## batchUpdateTaskListItemMarker ##########");
    for (const payload of [
        { ids: [withKid, plain], marker: "x" },
        { id: withKid, marker: "x" },
    ]) {
        const r = await api("/api/block/batchUpdateTaskListItemMarker", payload);
        await new Promise((x) => setTimeout(x, 350));
        console.log(`\n${JSON.stringify(payload)}\n  响应 code=${r.code} ${r.msg || ""}\n  现在: ${marks(await kd())}`);
        await api("/api/block/batchUpdateTaskListItemMarker", { ids: [withKid, plain], marker: " " }).catch(() => {});
        await new Promise((x) => setTimeout(x, 300));
    }
} finally {
    const info = await api("/api/filetree/getPathByID", { id: doc }).catch(() => null);
    if (info?.data?.notebook) {
        await api("/api/filetree/removeDoc", { notebook: info.data.notebook, path: info.data.path }).catch(() => {});
    }
}
