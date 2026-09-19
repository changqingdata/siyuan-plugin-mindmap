/**
 * 生成可视化验证页：把 visual.ts 打成单文件 js，配上插件样式表，
 * 再用浏览器打开 .build/visual.html 就能看到真实渲染效果。
 *
 * 用法：node tests/visual.mjs
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(here, ".build");

fs.mkdirSync(outDir, { recursive: true });

await build({
    entryPoints: [path.join(here, "visual.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome110",
    outfile: path.join(outDir, "visual.js"),
    alias: { siyuan: path.join(here, "siyuan-stub.ts") },
    logLevel: "warning",
});

const css = fs.readFileSync(path.join(root, "src", "styles", "index.css"), "utf8");

const html = `<!DOCTYPE html>
<html lang="zh-CN" data-theme-mode="dark">
<head>
<meta charset="utf-8"/>
<title>大纲导图 · 渲染验证</title>
<style>
    html, body { margin: 0; padding: 0; background: #1b1d22; }
    body { font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; color: #dfe3ea; }
    #app { padding: 18px 22px 40px; display: flex; flex-direction: column; gap: 22px; }
    h2 { font-size: 14px; font-weight: 500; margin: 0 0 6px; opacity: .55; }
    .protyle-wysiwyg { position: relative; }
${css}
</style>
</head>
<body>
<div id="app"></div>
<script>
/* 用 hash 控制验证页的观察模式：
   #hover         强制显示悬停快捷按钮，方便截图确认它们的位置
   #only=0&zoom=2 只留第 N 个视图并放大，用来盯细节
   only/zoom 要等 visual.js 挂载完视图才能生效，所以挂到 load 上。 */
(function () {
    var p = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (p.has("hover")) {
        var s = document.createElement("style");
        s.textContent = "#app .mm-root .mm-acts{opacity:1!important;visibility:visible!important;transform:none!important}";
        document.head.appendChild(s);
    }
    window.addEventListener("load", function () {
        if (p.has("only")) {
            var keep = Number(p.get("only"));
            document.querySelectorAll("#app > .protyle-wysiwyg").forEach(function (w, i) {
                if (i !== keep) w.style.display = "none";
            });
        }
        if (p.has("zoom")) document.body.style.zoom = p.get("zoom");
    });
})();
</script>
<script src="./visual.js"></script>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, "visual.html"), html, "utf8");
console.log(`[mindmap] 可视化验证页已生成 → ${path.join(outDir, "visual.html")}`);
