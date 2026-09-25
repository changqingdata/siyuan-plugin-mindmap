/**
 * 测试与构建脚本的静态体检 —— 只做三件「几毫秒、但能拦住真事故」的事。
 *
 * 三件都是本项目的实账，不是假想：
 *
 * ① **语法解析**（`node --check`）
 *    拦的是「在 `page.eval` 的模板字符串里用反引号写注释」——
 *    那会把外层模板提前截断，报 `SyntaxError: missing ) after argument list`，
 *    而报错行号指向模板开头，跟真正的问题（某行注释里的反引号）差着几十行。
 *    **这个坑技能里明确写着，本轮仍然踩了三次。**
 *    靠自觉不行，靠解析器一行就现形。
 *
 * ② **相对 import 是否存在**
 *    拦的是 `focus-timeline.mjs` 里那种 `./cdp.mjs`（正确是 `../cdp.mjs`）——
 *    它一跑就是 `ERR_MODULE_NOT_FOUND`，连第一行都执行不到。
 *    因为这支脚本既不在 `ux:all` 也不在 `check:all` 里，**坏了很久没人发现**。
 *
 * ③ **脚本要有「家」**
 *    拦的是「无人知道其存在的脚本」。判据（满足其一即可）：
 *      a. 被 `package.json` 引用 —— 有名字，`npm run xxx` 跑得起来；
 *      b. 被别的文件 import —— 是共享助手（`cdp.mjs` / `_doc-cleanup.mjs`），本就不该单独跑。
 *    两条都不满足 = 孤儿：没人知道它在、也没人会跑它，只会慢慢腐烂。
 *    2026-09 实测有 **19 支**处于这个状态（`probe-*` 15 支 + `diag-*` 4 支）。
 *
 * ⚠️ 注意 `node --check` 只解析、不执行，所以「跑起来才知道」的错误它拦不住 ——
 *    它的定位是「语法级的最低防线」，不是替代真跑。
 *
 * 用法：node scripts/lint-tests.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** 要体检的目录（相对仓库根） */
const DIRS = ["tests", "scripts"];
/** 参与 import 解析检查的扩展名（`.d.ts` 只是声明，没有运行时 import） */
const SCRIPT_EXT = /\.(mjs|ts)$/;

const files = [];
const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        // `.build` 是 esbuild 的产物目录，不体检
        if (e.isDirectory()) {
            if (e.name === ".build" || e.name === "node_modules") continue;
            walk(p);
        } else if (SCRIPT_EXT.test(e.name)) {
            files.push(p);
        }
    }
};
for (const d of DIRS) {
    const abs = path.join(root, d);
    if (fs.existsSync(abs)) walk(abs);
}

const problems = [];

/* ------------------------------------------------- ① 语法解析 */

/**
 * 跑 `node --check`，把 stderr 收进**临时文件**（不是管道）。
 *
 * ## ⚠️⚠️ 为什么不能用 `encoding: "utf8"`（= 管道 stdio）
 *
 * 本环境实测：`spawnSync` **带管道 stdio 时恒失败**，`r.error.code === "EBUSY"` ——
 * 连 `spawnSync("cmd.exe", ["/c","echo hi"], {encoding:"utf8"})` 都起不来。
 * 而同一时刻 `spawn()`（异步）+ 管道正常、`spawnSync` + `stdio: "ignore"` 也正常。
 * ⇒ 卡的是「同步 + 管道」这个组合，不是被调用的那个程序。
 *
 * 原实现直接 `encoding: "utf8"`，于是：
 *   · `r.status` 是 `null`（进程压根没起来），被当成「非 0 = 语法错误」；
 *   · `r.stderr` 是 `null`，报错文本取出来是**空字符串**；
 *   ⇒ **82 个文件被误报成「语法错误」，报错文本全空** —— 一个看起来像
 *     「整个仓库都坏了」的假警报，而真因是环境问题。
 *
 * 修法两层：
 *   1. stderr 走**文件描述符**（不受那条限制），拿到真实的错误文本；
 *   2. `r.error` 存在时**单独归类**为「起不来」，绝不再冒充语法错误。
 */
const checkSyntax = (f) => {
    /* 固定文件名（不是 `<pid>`）—— 体检是串行的，用固定名就不会一次跑攒一个残留文件。
       `.build/` 已被 gitignore，所以就算删不掉也不会进仓库。 */
    const tmp = path.join(root, "tests", ".build", "_syntax-check.log");
    let fd;
    try {
        fs.mkdirSync(path.dirname(tmp), { recursive: true });
        fd = fs.openSync(tmp, "w");
    } catch {
        /* 开不了临时文件就退回 ignore —— 至少拿到正确的退出码 */
        const r = spawnSync(process.execPath, ["--check", f], { stdio: "ignore" });
        if (r.error) return { spawnFailed: r.error.code || String(r.error) };
        return { status: r.status, stderr: "" };
    }
    const r = spawnSync(process.execPath, ["--check", f], { stdio: ["ignore", "ignore", fd] });
    fs.closeSync(fd);
    const stderr = (() => {
        try {
            return fs.readFileSync(tmp, "utf8");
        } catch {
            return "";
        }
    })();
    try {
        fs.unlinkSync(tmp);
    } catch {
        /* 删不掉就留给下次覆盖 */
    }
    if (r.error) return { spawnFailed: r.error.code || String(r.error) };
    return { status: r.status, stderr };
};

let spawnFailures = 0;
for (const f of files) {
    // `--check` 对 `.mjs` 按 ESM 解析，对 `.ts` 会因类型标注报错，所以只查 .mjs
    if (!f.endsWith(".mjs")) continue;
    const r = checkSyntax(f);
    if (r.spawnFailed) {
        /* ⚠️ 这**不是**语法错误。混在一起报会让「环境起不了进程」看起来像
           「代码全坏了」—— 本项目真的这么误报过 82 个文件。 */
        spawnFailures++;
        problems.push({ file: f, kind: "起不来", detail: `spawnSync 失败：${r.spawnFailed}（环境问题，不是语法错误）` });
        continue;
    }
    if (r.status !== 0) {
        const first =
            (r.stderr || "")
                .split("\n")
                .find((l) => l.trim() && !/^\s*at /.test(l)) ?? "";
        problems.push({ file: f, kind: "语法", detail: first.trim() });
    }
}

/* ------------------------------------------------- ② 相对 import 是否存在 */

/**
 * 把 `from "./x"` 解析到磁盘上的真实文件。
 *
 * ⚠️ 不能只看 `spec` 本身 —— `.ts` 里写 `from "../src/types"` 是不带扩展名的，
 *    要按 `spec`、`spec.ts`、`spec.mjs`、`spec/index.*` 依次试。
 */
const resolveImport = (fromFile, spec) => {
    const base = path.resolve(path.dirname(fromFile), spec);
    return [base, `${base}.mjs`, `${base}.ts`, `${base}.js`, path.join(base, "index.mjs")].some((c) =>
        fs.existsSync(c),
    );
};

/**
 * 把源码里「不可能是代码」的部分去掉，再扫 import。
 *
 * 为什么需要这一步：本文件自己的文档注释里就写了 `from "./x"` 这种**示例**，
 * 不剥注释的话，体检脚本会把自己报成 4 处坏 import（实测如此）。
 * 任何脚本的注释里都可能出现示例路径，所以剥注释是必需的，不是洁癖。
 *
 * ⚠️ 只剥「块注释」和「整行注释」，**不剥行尾的 `//`** ——
 *    因为代码里有 `"http://127.0.0.1:6806"` 这种字符串，
 *    粗暴地按 `//` 截断会把正常代码切坏，反而漏掉真正的坏 import。
 */
const stripComments = (src) =>
    src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");

for (const f of files) {
    const src = stripComments(fs.readFileSync(f, "utf8"));
    // 只查相对路径（`from "./x"` / `from "../x"`）；裸模块名交给 node 自己解析
    for (const m of src.matchAll(/\bfrom\s+"(\.[^"]*)"/g)) {
        if (!resolveImport(f, m[1])) problems.push({ file: f, kind: "import", detail: m[1] });
    }
    // 动态 import("...") 也一并查
    for (const m of src.matchAll(/\bimport\(\s*"(\.[^"]*)"\s*\)/g)) {
        if (!resolveImport(f, m[1])) problems.push({ file: f, kind: "import()", detail: m[1] });
    }
}

/* ------------------------------------------------- ③ 脚本要有「家」 */

/**
 * 判据是「两条满足其一」，不是「必须进套件」—— 这一点第十九节已经修正过：
 *
 *   · 该长期有效的**断言**不进套件 = 必然腐烂（`focus-timeline` 就是活例）；
 *   · **一次性探针**不进套件没问题（给它加门反而是造一扇永远红的门），
 *     但它**至少得有个名字** —— 否则下次想重跑都找不到它。
 *
 * 所以这道门只问「有没有名字 / 是不是助手」，不问「在不在套件里」。
 * 进不进套件是人在写脚本那一刻的判断题，脚本替不了。
 */
const pkgText = fs.readFileSync(path.join(root, "package.json"), "utf8");
const relPath = (p) => path.relative(root, p).replace(/\\/g, "/");

/** 各文件的「去注释」正文，用于判断 import（注释里的示例路径不算数） */
const sourceTexts = files.map((f) => ({ f, txt: stripComments(fs.readFileSync(f, "utf8")) }));

/** 这个文件是否被别的文件 import 过 */
const isImportedBy = (file) => {
    const esc = path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\bfrom\\s+"[^"]*${esc}"|\\bimport\\(\\s*"[^"]*${esc}"\\s*\\)`);
    const self = relPath(file);
    return sourceTexts.some(({ f, txt }) => relPath(f) !== self && re.test(txt));
};

for (const f of files) {
    // `.ts` 是类型层的东西（`entry.ts` / `siyuan-stub.ts`），本来就不直接跑
    if (!/\.(mjs|cjs)$/.test(f)) continue;
    if (pkgText.includes(relPath(f))) continue; // a. 有名字
    if (isImportedBy(f)) continue; // b. 是共享助手
    problems.push({ file: f, kind: "孤儿脚本", detail: "既没进 package.json，也没被任何文件 import" });
}

/* ------------------------------------------------- 汇总 */

const rel = (p) => path.relative(root, p).replace(/\\/g, "/");

console.log(`[lint] 体检 ${files.length} 个文件（${DIRS.join(" / ")}）`);

if (problems.length === 0) {
    console.log("[lint] 语法、相对 import、脚本归属全部通过 ✓");
    process.exit(0);
}

console.error(`\n[lint] ✗ ${problems.length} 处问题：`);
for (const p of problems) {
    console.error(`  ${rel(p.file)}  [${p.kind}]  ${p.detail}`);
}

if (spawnFailures > 0) {
    /* ⚠️ 这类问题**不是代码问题**，报出来时必须说清楚，
       否则「82 个文件语法错误」会被当成「整个仓库坏了」去瞎改代码。 */
    console.error(
        `\n  ⚠️ 其中 ${spawnFailures} 处是「起不来」（spawnSync 失败），**不是语法错误** ——\n` +
            `     那是环境问题（本环境实测：同步 spawn 带管道 stdio 会 EBUSY）。\n` +
            `     先确认环境，再判断代码。别照着这个去改源文件。`,
    );
}

if (problems.some((p) => p.kind === "孤儿脚本")) {
    console.error(
        `\n  孤儿脚本的两种处置（挑一个，别留着）：\n` +
            `    · 给它在 package.json 里起个名字（沿用 probe:* / ux:* 惯例）—— 它还有重跑的价值；\n` +
            `    · 删掉它 —— 问题已经回答完了，留着只会腐烂。`,
    );
}

process.exit(1);
