/**
 * i18n 词表工具：从源码里提取 `t()` 的键，并校验词表与代码是否对得上。
 *
 * 为什么需要它：键名拼错在中文环境下**看不出来** —— `t("menu.inserChild", "插入子节点")`
 * 拼错了键，fallback 照样把「插入子节点」显示出来，界面一切正常，
 * 只有英文用户会看到中文。这种错必须靠静态校验兜住。
 *
 * 用法：
 *   node scripts/i18n-keys.mjs --extract   # 输出代码里用到的全部键（JSON）
 *   node scripts/i18n-keys.mjs --write     # 按代码里的 fallback 重建 src/i18n/zh_CN.json
 *   node scripts/i18n-keys.mjs --verify    # 校验：代码里的键都在词表里、中英键集合一致、英文无中文
 *   node scripts/i18n-keys.mjs --built     # 校验：构建产物 i18n/ 与真源一致（**只能在 build 之后跑**）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

/**
 * ⚠️ 词表的**真源是 `src/i18n/`**，根目录的 `i18n/` 是构建产物
 * （`scripts/build.mjs` 会先删后建地把它从 `src/i18n/` 拷过去）。
 *
 * 这个坑踩过一次：一开始读写的是根目录那份，`--write` 写进去 296 个键、
 * `--verify` 也报绿 —— 但下一次 `npm run build` 就把它原样覆盖回旧的 14 个键，
 * 而 index.js / plugin.json 走的是另一条拷贝路径、每次照常更新。
 * 现象会变成「代码改了生效了、文案改了死活不变」，极难排查。
 * 所以校验必须**盯真源**，否则绿得毫无意义。
 */
const I18N = path.join(SRC, "i18n");

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith(".ts")) out.push(p);
    }
    return out;
}

const staticKeys = new Map(); // key → fallback（中文）
const dynamicPrefixes = new Set(); // 如 `act.` —— 键由常量表推导

/**
 * 动态键的来源：`t(\`act.${kind}\`, ACTION_LABEL[kind])` 这类调用，
 * 键名拼不出来，但值全在常量表里 —— 所以直接把常量表读出来补进词表。
 * 这样常量表加一条，词表跟着多一条，不会漏。
 */
const DYNAMIC_SOURCES = [
    ["src/core/renderer.ts", "LAYOUT_LABEL", "layout"],
    ["src/core/renderer.ts", "EDGE_LABEL", "edge"],
    ["src/core/renderer.ts", "GHOST_LABEL", "ghost"],
    ["src/core/renderer.ts", "BATCH_DONE_LABEL", "batchDone"],
    ["src/core/scanner.ts", "ACTION_LABEL", "act"],
    ["src/core/scanner.ts", "ACTION_FAIL", "actionFail"],
    ["src/types.ts", "FILTER_LABEL", "filter"],
    ["src/core/theme.ts", "THEME_LIST", "theme", "idName"],
];

/**
 * 键名**直接写在数据里**的常量表：`[["shortcut.nav", "中文"], …]`。
 * 与上面那批的区别是不用拼前缀 —— 键就是数据的第一项，读出来直接用。
 */
const KEYED_PAIRS = [["src/index.ts", "SHORTCUT_HELP"]];

/** 取 `const NAME = { key: "值" }` 形式的常量表 */
function readRecord(file, name) {
    const sf = ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true);
    const out = {};
    sf.forEachChild(function find(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(sf) === name && ts.isObjectLiteralExpression(node.initializer)) {
            for (const p of node.initializer.properties) {
                if (!ts.isPropertyAssignment(p)) continue;
                const k = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(sf);
                const v = ts.isStringLiteral(p.initializer) ? p.initializer.text : p.initializer.getText(sf);
                out[k] = v;
            }
        }
        ts.forEachChild(node, find);
    });
    return out;
}

/** 取 `const NAME = [{ id: "x", name: "中文" }]` 形式的常量表 */
function readArrayOfIdName(file, name) {
    const sf = ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true);
    const out = {};
    sf.forEachChild(function find(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(sf) === name && ts.isArrayLiteralExpression(node.initializer)) {
            for (const el of node.initializer.elements) {
                if (!ts.isObjectLiteralExpression(el)) continue;
                let id = null;
                let label = null;
                for (const p of el.properties) {
                    if (!ts.isPropertyAssignment(p)) continue;
                    const k = p.name.getText(sf);
                    const v = ts.isStringLiteral(p.initializer) ? p.initializer.text : null;
                    if (k === "id") id = v;
                    if (k === "name") label = v;
                }
                if (id && label) out[id] = label;
            }
        }
        ts.forEachChild(node, find);
    });
    return out;
}

/** 取 `const NAME = [["键", "中文"], …]` —— 空键（`["", ""]` 占位行）跳过 */
function readKeyedPairs(file, name) {
    const sf = ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true);
    const out = {};
    sf.forEachChild(function find(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(sf) === name && ts.isArrayLiteralExpression(node.initializer)) {
            for (const el of node.initializer.elements) {
                if (!ts.isArrayLiteralExpression(el) || el.elements.length < 2) continue;
                const [k, v] = el.elements;
                if (!ts.isStringLiteral(k) || !k.text) continue;
                out[k.text] = ts.isStringLiteral(v) ? v.text : "";
            }
        }
        ts.forEachChild(node, find);
    });
    return out;
}

const dynamicKeys = new Map(); // key → fallback
for (const [file, name, prefix, form] of DYNAMIC_SOURCES) {
    const map = form === "idName" ? readArrayOfIdName(file, name) : readRecord(file, name);
    for (const [k, v] of Object.entries(map)) dynamicKeys.set(`${prefix}.${k}`, v);
}
for (const [file, name] of KEYED_PAIRS) {
    for (const [k, v] of Object.entries(readKeyedPairs(file, name))) dynamicKeys.set(k, v);
}
// `tip.filter.<值>` 由 FILTER_LABEL 推导（只给 todo / done 两档，`all` 走 tip.filterAll）
for (const k of ["todo", "done"]) {
    const label = readRecord("src/types.ts", "FILTER_LABEL")[k];
    dynamicKeys.set(`tip.filter.${k}`, `只看${label}的待办`);
}

for (const file of walk(SRC).sort()) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    function visit(node) {
        // 只认 `this.t(...)` / `X.t(...)` 这种两参调用
        if (ts.isCallExpression(node) && /(^|\.)t$/.test(node.expression.getText(sf)) && node.arguments.length >= 2) {
            const [keyArg, fbArg] = node.arguments;
            if (ts.isStringLiteral(keyArg)) {
                const fb = ts.isStringLiteral(fbArg) || ts.isNoSubstitutionTemplateLiteral(fbArg) ? fbArg.text : fbArg.getText(sf);
                const prev = staticKeys.get(keyArg.text);
                if (prev !== undefined && prev !== fb) {
                    console.error(`⚠️ 键 ${keyArg.text} 的 fallback 不一致：${JSON.stringify(prev)} vs ${JSON.stringify(fb)}`);
                }
                staticKeys.set(keyArg.text, fb);
            } else if (ts.isTemplateExpression(keyArg)) {
                // `layout.${key}` → 前缀 layout.
                const head = keyArg.head.text;
                dynamicPrefixes.add(head);
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sf);
}

const mode = process.argv[2] || "--extract";

/**
 * 这几个键**不出现在 `t()` 调用里** —— 它们是思源命令的 `langKey`，
 * 由思源自己按名字查词表（见 plugin.json 的 addCommand 调用）。
 * 所以它们必须手工列在这里，否则 `--write` 会把它们洗掉、命令名变成键名本身。
 */
const LANG_KEY_ONLY = {
    migrateLegacy: "迁移【自定义块样式】标记",
    toggleMindMap: "把光标所在的列表切换为导图 / 大纲",
    toggleSidePanel: "并排面板打开导图",
};

if (mode === "--extract") {
    const sorted = Object.fromEntries([...staticKeys.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    const dyn = Object.fromEntries([...dynamicKeys.entries()].sort((a, b) => a[0].localeCompare(b[0])));
    console.log(JSON.stringify({ keys: sorted, dynamicKeys: dyn, dynamicPrefixes: [...dynamicPrefixes].sort() }, null, 2));
} else if (mode === "--write") {
    // 静态键优先（代码里的 fallback 是权威），动态键补上，最后是只做 langKey 的键
    // ⚠️ staticKeys / dynamicKeys 是 Map，必须 fromEntries —— `{...map}` 会展开成空对象
    const merged = { ...Object.fromEntries(dynamicKeys), ...LANG_KEY_ONLY, ...Object.fromEntries(staticKeys) };
    const sorted = Object.fromEntries([...Object.entries(merged)].sort((a, b) => a[0].localeCompare(b[0])));
    fs.writeFileSync(path.join(I18N, "zh_CN.json"), JSON.stringify(sorted, null, 2) + "\n");
    // 打印**真源**路径（不是根目录那份产物）—— 日志里写错路径，就会有人去改产物，
    // 然后下一次 build 把它覆盖掉，现象是「文案改了死活不变」。
    console.log(`✔ src/i18n/zh_CN.json 已写入 ${Object.keys(sorted).length} 个键`);
    console.log(`  静态 ${staticKeys.size} · 动态 ${dynamicKeys.size} · langKey ${Object.keys(LANG_KEY_ONLY).length}`);
} else if (mode === "--verify") {
    const zh = JSON.parse(fs.readFileSync(path.join(I18N, "zh_CN.json"), "utf8"));
    const en = JSON.parse(fs.readFileSync(path.join(I18N, "en_US.json"), "utf8"));
    const problems = [];

    // ① 代码里用到的静态键必须都在词表里（拼写错误在这里现形）
    for (const k of staticKeys.keys()) if (!(k in zh)) problems.push(`代码用到但 zh_CN 缺键：${k}`);
    // ①' 由常量表推导的动态键同理 —— 少查这一道，常量表里加了条目却忘了重跑
    //     `--write` 时，界面会静默退回中文兜底，中文环境下完全看不出来。
    for (const k of dynamicKeys.keys()) if (!(k in zh)) problems.push(`常量表推出但 zh_CN 缺键：${k}（跑一次 node scripts/i18n-keys.mjs --write）`);
    // ② 两份词表键集合必须一致
    for (const k of Object.keys(zh)) if (!(k in en)) problems.push(`zh_CN 有、en_US 缺：${k}`);
    for (const k of Object.keys(en)) if (!(k in zh)) problems.push(`en_US 有、zh_CN 缺：${k}`);
    // ③ 英文词表里不该残留中文
    for (const [k, v] of Object.entries(en)) if (/[\u4e00-\u9fa5]/.test(v)) problems.push(`en_US.${k} 里还有中文：${v}`);

    if (problems.length) {
        console.log(`✘ ${problems.length} 项问题：`);
        for (const p of problems) console.log("   · " + p);
        process.exitCode = 1;
    } else {
        console.log(`✔ 词表一致：zh_CN ${Object.keys(zh).length} 键 / en_US ${Object.keys(en).length} 键`);
        console.log(`  代码静态键 ${staticKeys.size} 个，全部命中`);
        console.log(`  动态键前缀 ${[...dynamicPrefixes].join(" ")}`);
    }
} else if (mode === "--built") {
    /**
     * 构建产物 `i18n/` 必须跟上真源 `src/i18n/` —— 否则「代码改了生效了、文案改了死活不变」。
     *
     * ⚠️ 这道校验**只能在 `build` 之后跑**。排在 build 前面的话，刚改完真源、
     * 还没构建时它必然报红，而那是**假红**；假红会训练人忽略这道门，
     * 比没有门更糟 —— 当初真源 / 产物这个坑就是「门装错了地方」。
     * 所以它从 `--verify` 里拆出来，单独挂在 `check` 的 build 之后。
     *
     * 比的是**键 + 值**，不只是键集合：这个坑的失败形态就是「键还在、值过期」。
     */
    const problems = [];
    for (const name of ["zh_CN", "en_US"]) {
        const builtPath = path.join(ROOT, "i18n", `${name}.json`);
        if (!fs.existsSync(builtPath)) {
            problems.push(`根目录 i18n/${name}.json 不存在 —— 跑一次 npm run build`);
            continue;
        }
        const src = JSON.parse(fs.readFileSync(path.join(I18N, `${name}.json`), "utf8"));
        const built = JSON.parse(fs.readFileSync(builtPath, "utf8"));
        const miss = Object.keys(src).filter((k) => !(k in built));
        const extra = Object.keys(built).filter((k) => !(k in src));
        const diff = Object.keys(src).filter((k) => k in built && built[k] !== src[k]);
        if (!miss.length && !extra.length && !diff.length) continue;
        const bits = [];
        if (miss.length) bits.push(`产物缺 ${miss.length} 键（如 ${miss[0]}）`);
        if (extra.length) bits.push(`产物多 ${extra.length} 键（如 ${extra[0]}）`);
        if (diff.length) bits.push(`${diff.length} 键的值与真源不一致（如 ${diff[0]}）`);
        problems.push(`根目录 i18n/${name}.json 是构建产物且已过期：${bits.join(" · ")} —— 跑一次 npm run build`);
    }
    if (problems.length) {
        console.log(`✘ ${problems.length} 项问题：`);
        for (const p of problems) console.log("   · " + p);
        process.exitCode = 1;
    } else {
        console.log("✔ 构建产物 i18n/ 与真源 src/i18n/ 一致（键与值都比过）");
    }
}
