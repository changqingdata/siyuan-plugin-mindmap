/**
 * i18n 盘点：把 `src/` 里**字符串字面量**中的中文捞出来，并分类。
 *
 * 为什么用 TS AST 而不是 grep：grep 会把注释里的中文也算进去，
 * 而本项目注释极多（占了 renderer.ts 一千多行里的绝大多数），用 grep 得到的数字
 * 完全没有指导意义 —— 会让人误以为有上千处待抽。
 *
 * 四类：
 *   todo  待抽（用户可见、还没接 i18n）—— **这一类必须为 0**
 *   const 模块级常量表的值（中文留作 fallback，在消费点抽取）
 *   keep  显式保留（诊断信息正文：复制出去给开发者看的）
 *   dev   开发者可见（console / throw / new Error）
 *
 * 用法：
 *   node scripts/i18n-audit.mjs            # 全量明细
 *   node scripts/i18n-audit.mjs --count    # 每文件分类计数
 *   node scripts/i18n-audit.mjs --done     # 只检查 todo 是否为 0（当门用）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const HAN = /[\u4e00-\u9fa5]/;

/** 生成文件不参与（`style.ts` 整个是一段 CSS 模板串） */
const SKIP = new Set(["src/generated/style.ts"]);

/**
 * 有意**不抽**的文案：诊断信息的正文。
 *
 * 它会被复制到剪贴板交给开发者排障，读者是「能看懂中文的维护者」；
 * 翻成英文反而让 issue 里的报告中英混杂。界面上的按钮与说明照抽，
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
    "（本次会话没有 [mindmap] 警告或错误）",
]);

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith(".ts")) out.push(p);
    }
    return out;
}

/**
 * 源码里用注释显式声明「这一段不参与 i18n」：
 *   `// i18n-audit-ignore-start` … `// i18n-audit-ignore-end`
 *
 * 比在脚本里维护行号 / 文案白名单可读得多 —— 豁免理由就写在被豁免的代码旁边，
 * 读代码的人一眼能看到「这里是故意留中文的」，不用来翻这个脚本。
 */
function ignoredLines(text) {
    const set = new Set();
    let start = null;
    text.split(/\r?\n/).forEach((line, i) => {
        if (line.includes("i18n-audit-ignore-start")) start = i;
        if (start !== null) set.add(i);
        if (line.includes("i18n-audit-ignore-end")) start = null;
    });
    return set;
}

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

/** 模块级对象 / 数组字面量里的值 —— 常量表，中文留作 fallback */
function inModuleLiteral(node) {
    let cur = node;
    while (cur.parent) {
        cur = cur.parent;
        if (ts.isObjectLiteralExpression(cur) || ts.isArrayLiteralExpression(cur)) return !inClass(cur);
        if (ts.isClassDeclaration(cur) || ts.isSourceFile(cur)) return false;
    }
    return false;
}

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
        if (ts.isNewExpression(cur) && cur.expression.getText(sf) === "Error") return true;
        if (ts.isThrowStatement(cur)) return true;
    }
    return false;
}

function collect(file) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const ignored = ignoredLines(text);
    const hits = [];
    const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const skipped = (n) => ignored.has(lineOf(n) - 1);

    function visit(node) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            if (HAN.test(node.text) && !skipped(node)) {
                let kind = "todo";
                if (isDevOnly(node, sf)) kind = "dev";
                else if (KEEP_ZH.has(node.text)) kind = "keep";
                else if (inModuleLiteral(node)) kind = "const";
                hits.push({ line: lineOf(node), text: node.text, kind });
            }
        } else if (ts.isTemplateExpression(node)) {
            const whole = node.getText(sf);
            if (HAN.test(whole) && !skipped(node)) {
                let kind = "todo";
                if (isDevOnly(node, sf)) kind = "dev";
                else if (inModuleLiteral(node)) kind = "const";
                hits.push({ line: lineOf(node), text: whole.replace(/\s+/g, " ").slice(0, 90), kind });
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sf);
    return hits;
}

const files = walk(SRC).sort();
const table = [];
for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    if (SKIP.has(rel)) continue;
    const hits = collect(f);
    if (hits.length) table.push({ file: rel, hits });
}

const mode = process.argv[2] || "";
const tally = { todo: 0, const: 0, keep: 0, dev: 0 };
for (const { hits } of table) for (const h of hits) tally[h.kind]++;

if (mode === "--done") {
    const todo = table.flatMap((x) => x.hits.filter((h) => h.kind === "todo").map((h) => ({ ...h, file: x.file })));
    if (todo.length === 0) {
        console.log("✔ 没有「用户可见但未接 i18n」的文案");
    } else {
        console.log(`✘ 还有 ${todo.length} 处用户可见文案没接 i18n：`);
        for (const t of todo) console.log(`   ${t.file}:${t.line}  ${t.text}`);
        process.exitCode = 1;
    }
} else if (mode === "--count") {
    console.log("文件".padEnd(34) + "待抽".padStart(6) + "常量表".padStart(8) + "保留".padStart(6) + "开发者".padStart(8));
    for (const { file, hits } of table) {
        const c = { todo: 0, const: 0, keep: 0, dev: 0 };
        for (const h of hits) c[h.kind]++;
        console.log(file.padEnd(34) + String(c.todo).padStart(6) + String(c.const).padStart(8) + String(c.keep).padStart(6) + String(c.dev).padStart(8));
    }
    console.log("─".repeat(62));
    console.log("合计".padEnd(34) + String(tally.todo).padStart(6) + String(tally.const).padStart(8) + String(tally.keep).padStart(6) + String(tally.dev).padStart(8));
} else {
    for (const { file, hits } of table) {
        const byKind = { todo: [], const: [], keep: [], dev: [] };
        for (const h of hits) byKind[h.kind].push(h);
        console.log(`\n### ${file}`);
        for (const [kind, label] of [["todo", "待抽"], ["const", "常量表"], ["keep", "保留"], ["dev", "开发者"]]) {
            if (!byKind[kind].length) continue;
            console.log(`  ── ${label}（${byKind[kind].length}）`);
            for (const h of byKind[kind]) console.log(`  ${String(h.line).padStart(4)}  ${h.text}`);
        }
    }
    console.log(`\n待抽 ${tally.todo} · 常量表 ${tally.const} · 保留 ${tally.keep} · 开发者 ${tally.dev}`);
}
