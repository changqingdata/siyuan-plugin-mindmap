/**
 * i18n 抽取工具：把类方法内的裸中文字符串字面量换成 `this.t("key", "原文")`。
 *
 * 为什么用脚本而不是手工改：
 *   394 处文案里绝大部分是「同一个词在不同地方重复出现」（如「删除」「关闭」），
 *   手工改既慢又容易漏。脚本 + 一张「中文 → 键名」映射表能保证：
 *     1. 同一个中文串在任何地方都落到同一个键（不会一个词两个键）；
 *     2. 替换是精确字面量匹配，改不到别处去。
 *
 * 用法：
 *   node scripts/i18n-apply.mjs --list          # 列出去重后的待抽文案（按频次）
 *   node scripts/i18n-apply.mjs --apply         # 按 scripts/i18n-map.json 执行替换
 *   node scripts/i18n-apply.mjs --check         # 只校验映射表是否覆盖全部待抽文案
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP_FILE = path.join(ROOT, "scripts", "i18n-map.json");
const HAN = /[\u4e00-\u9fa5]/;

/** 这些文件里的文案是「常量表」，值要留作 fallback，在消费点抽取 —— 不参与自动替换 */
const SKIP_FILES = new Set(["src/types.ts", "src/core/theme.ts", "src/core/tree.ts", "src/generated/style.ts"]);

/**
 * 有意**不抽**的文案：诊断信息的正文。
 *
 * 它会被复制到剪贴板交给开发者排障，读者是「能看懂中文的维护者」；
 * 把它翻成英文反而让 issue 里的报告中英混杂。界面上的按钮与说明照抽，
 * 只有这份「复制出去的报告正文」保持中文。
 */
const KEEP_ZH = new Set([
    "未知",
    "开",
    "关",
    "===== 大纲导图 诊断信息 =====",
    "--- 配置 ---",
    "--- 视图 ---",
    "--- 最近的警告 / 错误 ---",
    "（当前没有挂载任何导图）",
    "（以上信息仅供排障，插件不会自动发送任何数据）",
]);

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith(".ts")) out.push(p);
    }
    return out;
}

/** 只在类方法内才能用 `this.t()`；模块级函数与常量表走别的路子 */
function inClass(node) {
    let cur = node;
    while (cur.parent) {
        cur = cur.parent;
        if (ts.isFunctionDeclaration(cur)) return false;
        if (ts.isClassDeclaration(cur)) return true;
        if (ts.isSourceFile(cur)) return false;
    }
    return false;
}

/** 开发者可见的文案不进 i18n（console / throw / 内部断言），已在 t() 里的也不再处理 */
function isDevOnly(node, sf) {
    let cur = node;
    for (let i = 0; i < 6 && cur.parent; i++) {
        cur = cur.parent;
        if (ts.isCallExpression(cur)) {
            const callee = cur.expression.getText(sf);
            if (/^console\./.test(callee)) return true;
            if (/(^|\.)(warn|error|assert)$/.test(callee)) return true;
            if (/(^|\.)t$/.test(callee)) return true;
        }
        if (ts.isThrowStatement(cur)) return true;
    }
    return false;
}

/** 收集一个文件里所有「可自动替换」的字面量（带精确起止位置） */
function collect(file) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    if (SKIP_FILES.has(rel)) return [];
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const hits = [];
    function visit(node) {
        if (ts.isStringLiteral(node)) {
            if (HAN.test(node.text) && inClass(node) && !isDevOnly(node, sf) && !KEEP_ZH.has(node.text)) {
                hits.push({ start: node.getStart(sf), end: node.getEnd(), text: node.text, raw: node.getText(sf) });
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sf);
    return hits;
}

const files = walk(path.join(ROOT, "src")).sort();
const all = files.flatMap((f) => collect(f).map((h) => ({ ...h, file: f })));

const mode = process.argv[2] || "--list";

if (mode === "--list") {
    const freq = new Map();
    for (const h of all) freq.set(h.text, (freq.get(h.text) || 0) + 1);
    const rows = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    console.log(`待抽文案 ${rows.length} 种，共 ${all.length} 处\n`);
    for (const [txt, n] of rows) console.log(`${String(n).padStart(3)}  ${txt}`);
} else {
    const map = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) : {};
    const missing = [...new Set(all.map((h) => h.text))].filter((t) => !map[t]);
    if (missing.length) {
        console.log(`映射表缺少 ${missing.length} 条：`);
        for (const m of missing) console.log("   " + m);
        if (mode === "--check") process.exitCode = 1;
        else process.exit(1);
    }
    if (mode === "--check") {
        console.log("✔ 映射表覆盖全部待抽文案");
    } else {
        // 从后往前替换，避免前面的改动让后面的偏移失效
        const byFile = new Map();
        for (const h of all) {
            if (!byFile.has(h.file)) byFile.set(h.file, []);
            byFile.get(h.file).push(h);
        }
        let total = 0;
        for (const [file, hits] of byFile) {
            let text = fs.readFileSync(file, "utf8");
            hits.sort((a, b) => b.start - a.start);
            for (const h of hits) {
                const key = map[h.text];
                // 原文里若有双引号，转义后再塞进双引号字面量
                const fb = JSON.stringify(h.text);
                text = text.slice(0, h.start) + `this.t(${JSON.stringify(key)}, ${fb})` + text.slice(h.end);
                total++;
            }
            fs.writeFileSync(file, text);
            console.log(`  ${path.relative(ROOT, file).replace(/\\/g, "/")}  ${hits.length} 处`);
        }
        console.log(`\n✔ 已替换 ${total} 处`);
    }
}
