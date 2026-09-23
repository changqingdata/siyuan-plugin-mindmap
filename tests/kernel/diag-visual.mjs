/**
 * 诊断：可视化验证页为什么没生成 #report。
 *
 * `npm run visual` 用 `chrome --dump-dom` 抓渲染后的 DOM，但它把页面里的
 * 异常全吞了 —— 只能看到「没有 #report」这个结果，看不到原因。
 *
 * 这里用 CDP 直接加载 .build/visual.html，订阅：
 *   - Runtime.exceptionThrown   未捕获异常（带完整栈）
 *   - Runtime.consoleAPICalled  页面里的 console 输出
 *   - Log.entryAdded            浏览器级日志（含资源加载失败）
 * 再把 body 末尾有没有 pre#report 报出来。
 *
 * 用法：node tests/kernel/diag-visual.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../cdp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const html = path.join(root, "tests", ".build", "visual.html");

if (!fs.existsSync(html)) {
    console.error(`[diag-visual] 找不到 ${html}，先跑 npm run visual`);
    process.exit(1);
}

const url = "file:///" + html.replace(/\\/g, "/");
console.log(`[diag-visual] 加载 ${url}`);

const chrome = await launch({ port: 9444, width: 1500, height: 2600 });
const page = await chrome.newPage();

const exceptions = [];
const logs = [];
const consoleMsgs = [];

page.on("Runtime.exceptionThrown", (p) => {
    const d = p.exceptionDetails;
    exceptions.push({
        text: d.text,
        desc: d.exception?.description ?? "",
        url: d.url,
        line: d.lineNumber,
        col: d.columnNumber,
    });
});
page.on("Log.entryAdded", (p) => {
    logs.push({ level: p.entry.level, text: p.entry.text, url: p.entry.url });
});
page.on("Runtime.consoleAPICalled", (p) => {
    consoleMsgs.push({
        type: p.type,
        text: (p.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(" "),
    });
});

await page.send("Page.navigate", { url });
// 给足时间让脚本跑完（模块顶层同步执行 + 可能的 rAF 收尾）
await new Promise((r) => setTimeout(r, 3000));

const state = await page.eval(`(() => {
    const pre = document.querySelector('#report');
    return {
        hasReport: !!pre,
        reportLen: pre ? String(pre.textContent || '').length : 0,
        appChildren: document.querySelectorAll('#app > *').length,
        mmRoot: document.querySelectorAll('.mm-root').length,
        mmNode: document.querySelectorAll('.mm-node').length,
        scripts: Array.from(document.querySelectorAll('script[src]')).map(function (s) {
            return { src: s.getAttribute('src'), resolved: s.src };
        }),
        bodyTail: document.body.lastElementChild ? document.body.lastElementChild.tagName + '#' + document.body.lastElementChild.id : 'none',
    };
})()`);

console.log("\n=== 页面状态 ===");
console.log(JSON.stringify(state, null, 2));

console.log("\n=== 未捕获异常 ===");
if (!exceptions.length) console.log("（无）");
for (const e of exceptions) {
    console.log(`- ${e.text} @ ${e.url}:${e.line}:${e.col}`);
    if (e.desc) console.log(e.desc.split("\n").map((l) => "    " + l).join("\n"));
}

console.log("\n=== console 输出 ===");
if (!consoleMsgs.length) console.log("（无）");
for (const m of consoleMsgs) console.log(`- [${m.type}] ${m.text}`);

console.log("\n=== 浏览器日志 ===");
if (!logs.length) console.log("（无）");
for (const l of logs) console.log(`- [${l.level}] ${l.text}${l.url ? " ← " + l.url : ""}`);

await chrome.close();

const ok = state.hasReport;
console.log(`\n${ok ? "✓" : "✗"} #report ${ok ? "存在" : "缺失"}（长度 ${state.reportLen}）`);
process.exit(ok ? 0 : 1);
