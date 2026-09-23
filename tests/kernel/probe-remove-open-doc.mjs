/**
 * 受控实验：文档**正在前端打开着**的时候，removeDoc 到底删没删？
 *
 * 起因：ux:all 跑完复查说「零残留」，过一会儿又冒出一个 `临时-小地图-xxx`
 * —— 而那正是 diag-canvas-v2 的 docB，收尾里明确调过 removeDoc。
 * 怀疑是「文档开在前端时删不掉」。
 *
 * ## 结论（已实测）：假设**不成立**
 *
 *   ① 文档已在前端打开: 20260921103812-d7uvxa6 文件在? true
 *   ② 页面还开着时 removeDoc → {"code":0,...,"data":null}  文件还在? false
 *   ③ 关掉浏览器之后 文件还在? false
 *
 * 也就是说 removeDoc 对「开着的文档」照样删得掉。单跑 diag-canvas-v2 三次、
 * 每次跑完立刻看磁盘，也都是 0 残留。
 *
 * 所以那一次漏网只能定性为**间歇性的收尾竞态**（`chrome.close()` 与内核落盘 /
 * 索引之间的时序），复现不了，但确实发生过一次。处置办法不是继续查它，
 * 而是**把清理做成幂等的一步**：整条 ux:all 跑完补一句 `npm run clean:tmp!`。
 * 这个探针留着，是为了以后有人再怀疑「开着的文档删不掉」时不用重测一遍。
 *
 * 用法：node tests/kernel/probe-remove-open-doc.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";

const K = "http://127.0.0.1:6806";
const NB = "20221230192740-wpnntiv";
const T = JSON.parse(fs.readFileSync("D:/常青Data/conf/conf.json", "utf8")).api.token;
const api = async (p, b) =>
    (
        await fetch(K + p, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Token ${T}` },
            body: JSON.stringify(b ?? {}),
        })
    ).json();
const DIR = "D:/常青Data/data/20221230192740-wpnntiv/";
const exists = (id) => fs.existsSync(DIR + id + ".sy");

const mk = async (tag) =>
    (
        await api("/api/filetree/createDocWithMd", {
            notebook: NB,
            path: "/临时-删测" + tag + "-" + Date.now(),
            markdown: "- x\n  - y\n",
        })
    ).data;
const del = async (id) => {
    const i = await api("/api/filetree/getPathByID", { id });
    return api("/api/filetree/removeDoc", { notebook: i.data.notebook, path: i.data.path });
};

const c = await launch({ headless: true, width: 1000, height: 700 });
const page = await c.newPage("about:blank");

const doc = await mk("C");
await page.send("Page.navigate", { url: K + "/stage/build/desktop/?id=" + doc });
await sleep(4000);
console.log("① 文档已在前端打开:", doc, "文件在?", exists(doc));

console.log("② 页面还开着时 removeDoc →", JSON.stringify(await del(doc)));
await sleep(2000);
console.log("   文件还在?", exists(doc));

await c.close();
await sleep(2500);
console.log("③ 关掉浏览器之后 文件还在?", exists(doc));

if (exists(doc)) {
    console.log("④ 再删一次 →", JSON.stringify(await del(doc)), "还在?", exists(doc));
}
