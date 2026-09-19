/**
 * 无头浏览器验收：跑一遍真实渲染，断言视觉与键盘的硬指标。
 *
 * Node 端的 DOM 模拟拿不到真实布局（offsetWidth 全是桩值），
 * 所以「节点有没有坍缩成一个字宽」「Tab 有没有漏给思源」这类问题
 * 只能靠真实浏览器验证。这个脚本把整套流程固化成一条命令。
 *
 * 用法：node tests/visual-check.mjs
 *       node tests/visual-check.mjs --keep   （保留截图）
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, ".build");
const htmlPath = path.join(outDir, "visual.html");

/* ------------------------------------------------------------ 找 Chrome */

const CANDIDATES = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
].filter(Boolean);

const chrome = CANDIDATES.find((p) => {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
});

if (!chrome) {
    console.error("[visual] 找不到 Chrome，可用 CHROME_PATH 环境变量指定");
    process.exit(2);
}

if (!fs.existsSync(htmlPath)) {
    console.error("[visual] 缺少验证页，请先执行 node tests/visual.mjs");
    process.exit(2);
}

/* ------------------------------------------------------------ 跑浏览器 */

const url = `file:///${htmlPath.replace(/\\/g, "/")}`;

function run(args) {
    return execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", ...args], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
    });
}

const dom = run(["--window-size=1500,2600", "--virtual-time-budget=6000", "--dump-dom", url]);
fs.writeFileSync(path.join(outDir, "dump.html"), dom, "utf8");

const m = dom.match(/<pre id="report"[^>]*>([\s\S]*?)<\/pre>/);
if (!m) {
    console.error("[visual] 页面上没有找到 #report，验证页可能渲染失败");
    process.exit(1);
}

const decode = (s) =>
    s
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");

const report = JSON.parse(decode(m[1]));

/* ------------------------------------------------------------ 断言 */

let pass = 0;
const fails = [];

function ok(name, cond, detail = "") {
    if (cond) {
        pass += 1;
        return;
    }
    fails.push(`${name}${detail ? `  → ${detail}` : ""}`);
}

/** 解析 #rgb / #rrggbb / rgb() / rgba() 为 [r,g,b] */
function rgb(str) {
    const s = String(str).trim();
    const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
        const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
        const n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = s.match(/-?\d+(?:\.\d+)?/g);
    return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : null;
}

/** WCAG 相对亮度对比度，用来判断「这个颜色在画布上到底看不看得见」 */
function contrast(a, b) {
    const la = rgb(a);
    const lb = rgb(b);
    if (!la || !lb) return null;
    const lum = ([r, g, b]) => {
        const f = (v) => {
            const x = v / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const [x, y] = [lum(la), lum(lb)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}

console.log("\n[视觉]");
for (const v of report.views) {
    const tag = `视图 ${v.view}`;
    console.log(
        `  ${tag}  节点 ${v.nodes}  宽度 ${v.minNodeWidth}~${v.maxNodeWidth}px  ` +
            `连线 ${v.edges}  线宽 ${v.maxStroke}→${v.minStroke}  画布 ${v.world}`,
    );

    // 逐字竖排的典型特征：宽度坍缩到几十像素以内
    ok(`${tag} 无节点宽度坍缩`, v.collapsed === 0, `坍缩节点数=${v.collapsed}`);
    ok(`${tag} 节点宽度已撑开`, v.minNodeWidth >= 48, `最小宽度=${v.minNodeWidth}px`);
    ok(`${tag} 节点未异常换行`, v.tallestNode <= 96, `最高节点=${v.tallestNode}px`);
    ok(`${tag} 有连线`, v.edges > 0, `连线数=${v.edges}`);
    // 主干比支线粗，说明汇聚形态生效
    ok(`${tag} 连线有粗细层次`, v.maxStroke > v.minStroke, `${v.maxStroke} vs ${v.minStroke}`);
    // 用不透明混色而不是 rgba，避免重叠段叠深
    ok(`${tag} 连线为不透明实色`, v.opaque === true, `含半透明色`);
    ok(`${tag} 画布尺寸有效`, /^\d+px x \d+px$/.test(v.world) && !v.world.startsWith("0px"), v.world);
    ok(`${tag} 导图容器可获得焦点`, v.tabIndex === 0, `tabIndex=${v.tabIndex}`);
    ok(`${tag} 有悬停快捷按钮`, v.hoverActions === v.nodes, `${v.hoverActions}/${v.nodes}`);
    ok(`${tag} 悬停按钮默认不可见`, v.actsHidden === true, "有按钮常驻显示");
    ok(`${tag} 节点内没有画错位置的元素`, v.strayInNodes.length === 0, v.strayInNodes.join(", "));

    /* 折叠按钮压在画布上，一旦配色与画布撞色就会彻底隐形 */
    const canvas = v.canvasSolid || "#000000";
    for (const t of v.toggleInfo) {
        const cr = contrast(t.color, canvas);
        ok(
            `${tag} 折叠按钮「${t.text}」在画布上可见`,
            cr !== null && cr >= 3,
            `color=${t.color} 画布=${canvas} 对比度=${cr === null ? "无法解析" : cr.toFixed(2)}`,
        );
        ok(
            `${tag} 折叠按钮用分支色描边`,
            t.border === t.solid || rgb(t.border)?.join() === rgb(t.solid)?.join(),
            `border=${t.border} --c-solid=${t.solid}`,
        );
        // 文字色必须跟描边一致，否则就是取色时机错了（会闪一下再纠正）
        ok(
            `${tag} 折叠按钮文字与描边同色`,
            rgb(t.color)?.join() === rgb(t.solid)?.join(),
            `color=${t.color} --c-solid=${t.solid}`,
        );

        /* 按钮要「贴在主干上」，不能被节点卡片压住，也不能飘太远 */
        if (t.hostRect) {
            const [tl, tt, tr, tb] = t.rect;
            const [hl, ht, hr, hb] = t.hostRect;
            const overlap = tl < hr && tr > hl && tt < hb && tb > ht;
            const dx = Math.max(hl - tr, tl - hr);
            const dy = Math.max(ht - tb, tt - hb);
            ok(`${tag} 折叠按钮不压节点卡片`, !overlap, `按钮=${t.rect} 节点=${t.hostRect}`);
            ok(`${tag} 折叠按钮贴在节点边缘`, dx <= 4 || dy <= 4, `水平间隙=${dx} 垂直间隙=${dy}`);
        }
    }
}

// 思维导图模式必须左右两侧都出连线
ok("思维导图有左向分支连线", report.views[1].leftward > 0, `leftward=${report.views[1].leftward}`);

console.log("\n[键盘]");
for (const k of report.keyboard) {
    console.log(`  ${k.ok ? "✓" : "✗"} ${k.name}${k.detail ? `   ${k.detail}` : ""}`);
    ok(k.name, k.ok, k.detail);
}

/* ------------------------------------------------------------ 截图 */

const shots = [
    ["shot.png", ""],
    ["shot-hover.png", "#hover"],
];
for (const [file, hash] of shots) {
    run(["--window-size=1500,2600", "--virtual-time-budget=6000", `--screenshot=${path.join(outDir, file)}`, url + hash]);
}

/* ------------------------------------------------------------ 收尾 */

const total = pass + fails.length;
if (fails.length) {
    console.error(`\n[visual] ✗ ${fails.length}/${total} 项不通过：`);
    for (const f of fails) console.error(`  - ${f}`);
    process.exit(1);
}

console.log(`\n[visual] 全部通过 ✓  ${pass}/${total} 项断言`);
console.log(`[visual] 截图 → ${path.join(outDir, "shot.png")} / shot-hover.png`);
