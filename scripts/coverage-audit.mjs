/**
 * 静态覆盖审计：把插件的**全部用户可见入口**枚举出来，逐条对照 `tests/` 里的命中情况。
 *
 * ## 为什么要做这个
 *
 * 这个项目已经因为「有实现、没断言」连续挖出三个真 bug：
 *   · `⌥⌘D` 被导图自己的 Ctrl+D 吞掉 → 静默把选中节点的子树复制进笔记
 *   · `migrateLegacy`（唯一会写数据的命令）动作从没被真机跑过
 *   · 真实键盘下整套 Ctrl 快捷键失灵（焦点被思源编辑器抢走）
 *
 * 三次都是「碰巧想到」才去查的。这一支把它变成**扫一遍**：
 * 入口从源码里枚举，而不是靠记忆。
 *
 * ## 入口从哪来（五类）
 *
 *  · 命令 —— `index.ts` 的 `addCommand({ langKey })`
 *  · 宿主菜单 —— `index.ts` 里 `IMenu[]` 的 `label:`
 *  · **自绘 UI** —— `renderer.ts` 里的 tooltip（`dataset.mmTip`）、
 *    菜单项（`item("…", …)` / `label: "…"`）、按钮（`mk("…")` / `btn("…")` / `row("…")`）
 *  · 设置面板 —— `addToggle / addSelect / addNumber / addText / addItem({ title })`
 *  · 导图内快捷键 —— `SHORTCUT_HELP`（这是插件**对用户公开承诺**的清单，
 *    比从 `onKeyDown` 里正则抠键名可靠得多，而且「承诺了却没实现」本身就是缺陷）
 *
 * ## 判据是「命中」不是「覆盖」
 *
 * 静态 grep 只能回答「这个字串在测试里出现过没有」，**不能**回答「行为被测过没有」。
 * 所以输出分两栏：机械命中（脚本算）+ 人工定性（写在 docs 里）。
 * 脚本的价值在于把「没出现过的字串」挑出来 —— 那才是需要人去看的。
 *
 * 实测的噪音来源（已处理）：
 *   · 「快捷键承诺」那 14 行里有一半是整句中文（「多选：Shift + 拖动框选…」），
 *     拿整句当探针**永远零命中**。现在抠不出键名的行改判 `○ 人工`，
 *     不再计入零命中清单 —— 否则 5 条噪音会把真缺口淹掉。
 *   · 机械枚举会漏：设置面板脚本枚举出 24 项，打开真面板数出来是 **25** 项。
 *     所以面板条数以探针实测为准（`probe-settings-effects.mjs` 的 ⑧ 段）。
 *
 * ## 已知覆盖表（`KNOWN_COVERED`）：把「注定零命中」和「真缺口」分开
 *
 * 零命中里有一批是 tooltip / 说明文字（「展开 {n} 个子节点」「点击取消勾选」……）。
 * 它们零命中是**正常的**：该守的是背后的行为，那句提示语用户看不到也说明不了什么。
 * 不认领掉，真缺口就会被这堆噪音淹掉（实测：28 条零命中里 11 条是这类）。
 *
 * 但白名单会烂 —— 探针被删、行为被改坏，表还在这儿说「已覆盖」，
 * 那就成了**第二道会撒谎的网**。所以每条都写死「文件 + 标记字串」，
 * 脚本每次真去查那个标记还在不在：
 *   · 标记在 → 标 `◍ 已认领`，附上理由
 *   · 标记没了 → 标 `★★ 认领失效`，**退回零命中并让自检失败**，逼人重判
 *   · item 名对不上任何入口 → 也算自检失败（改文案时忘了同步表）
 *
 * ## 附加：承诺 × 实现 对账
 *
 * 最后一节把 `SHORTCUT_HELP` 抠出来的键名，逐条映射到 `onKeyDown` 里的处理判据，
 * 双向报缺口：
 *   · **承诺了没实现** —— 用户在速查里看到、按下去没反应（比没文档更糟）
 *   · **实现了没承诺** —— 功能在、但没人能发现
 *
 * 用法：node scripts/coverage-audit.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const TESTS = path.join(ROOT, "tests");

const read = (p) => fs.readFileSync(p, "utf8");

/* ---------------------------------------------------------------- 读源码 */

const indexSrc = read(path.join(SRC, "index.ts"));
const rendererSrc = read(path.join(SRC, "core", "renderer.ts"));

/* ---------------------------------------------------------------- 读测试 */

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === "node_modules" || e.name === ".build") continue;
            walk(p, out);
        } else if (/\.(mjs|cjs|js|ts)$/.test(e.name)) {
            out.push(p);
        }
    }
    return out;
}
const testFiles = walk(TESTS).map((p) => ({ file: path.relative(ROOT, p).replace(/\\/g, "/"), text: read(p) }));

/** 某个字串在测试里出现在哪些文件 */
function hits(needle) {
    return testFiles.filter((t) => t.text.includes(needle)).map((t) => t.file);
}

/* ---------------------------------------------------------------- 通用工具 */

/** 去掉引号、把模板串里的 `${…}` 换成 `…`、去掉转义反斜杠 */
function unquote(raw) {
    return raw
        .replace(/^[`"]|[`"]$/g, "")
        .replace(/\$\{[^}]*\}/g, "…")
        .replace(/\\(["`\\])/g, "$1")
        .trim();
}

/** 含中日韩字符？—— 用来把「真文案」跟「CSS 类名 / 变量名」分开 */
const hasCJK = (s) => /[\u3400-\u9fff\uf900-\ufaff]/.test(s);

/**
 * 把 `this.t("词表键", "兜底中文")` / `this.t("词表键", "兜底中文", vars)` 折叠成裸字面量。
 *
 * ⚠️⚠️ 这里踩过一个**很贵的坑**，值得写在最前面。
 *
 * i18n 三步走把 394 处文案改成 `this.t("键", "兜底")` 之后，这个脚本里**所有**
 * 「按裸字面量写」的解析器一起失配了 —— 而失配的结果是「解析出 0 条」，
 * 报告照常打印，看上去只是「这类入口本来就少」：
 *
 *     命令 3 · 菜单文案 0 · 自绘UI 1 · 设置项 0（面板实测 25）· 快捷键承诺 0 条
 *                                    ↑ 0              ↑ 0            ↑ 0
 *
 * 于是这道本该抓「有实现、没断言」的网，**静默空转了好几轮**，还反过来给出
 * 6 条假结论（把 `Ctrl+A` 之类判成「没承诺」、把用常量的全局快捷键判成「没实现」）。
 *
 * 折叠（而不是给每个解析器各写一套 i18n 感知正则）是有意的：解析器一个字都不用改，
 * 以后文案写法再变也只改这一处。**配套的自检见文件末尾的 `SELF_CHECK`。**
 */
function foldI18n(src) {
    return src
        .replace(/this\.t\(\s*"(?:[^"\\]|\\.)*"\s*,\s*("(?:[^"\\]|\\.)*"|`[^`]*`)\s*,\s*[^)]*\)/g, "$1")
        .replace(/this\.t\(\s*"(?:[^"\\]|\\.)*"\s*,\s*("(?:[^"\\]|\\.)*"|`[^`]*`)\s*\)/g, "$1")
        .replace(/this\.t\(\s*"(?:[^"\\]|\\.)*"\s*\)/g, '""');
}

/** 文件里「变量 → 字符串字面量」的一层映射 */
function stringVars(src) {
    const vars = new Map();
    for (const m of src.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*("(?:[^"\\]|\\.)*"|`[^`]*`)\s*;/g)) {
        vars.set(m[1], m[2]);
    }
    return vars;
}

/**
 * 一层变量回溯：`dataset.mmTip = tip;` 里的 `tip` 往往来自 `const tip = "…"`。
 * 只回溯一层 —— 够用，而且不会像真正的数据流分析那样自己长出 bug。
 */
function asLiteral(raw, vars) {
    if (!raw) return null;
    if (/^["`]/.test(raw)) return raw;
    return vars.get(raw) ?? null;
}

/**
 * 取出一个表达式里所有字符串字面量（含一层变量回溯）。
 *
 * 为什么不只取第一个：`dataset.mmTip = on ? "展开" : "折叠"` 两个分支**都是**
 * 用户可见文案，只取一个会漏；`item("100%", "Ctrl+0")` 这种则只取第一个实参，
 * 因为第二个是快捷键提示、不是按钮文案。
 */
function literalsOf(expr, vars) {
    const out = [];
    for (const m of expr.matchAll(/"(?:[^"\\]|\\.)*"|`[^`]*`|[A-Za-z_$][\w$]*/g)) {
        const lit = asLiteral(m[0], vars);
        if (lit) out.push(unquote(lit));
    }
    return out;
}

/** 折叠 i18n 之后的源码 —— 所有「枚举用户可见入口」的解析器都跑在这一份上 */
const indexFold = foldI18n(indexSrc);
const rendererFold = foldI18n(rendererSrc);
/** 每个文件里「变量 → 字面量」的一层映射，用于回溯 `dataset.mmTip = tip` 这类写法 */
const indexVars = stringVars(indexFold);
const rendererVars = stringVars(rendererFold);

/* ---------------------------------------------------------------- 枚举入口 */

/** 命令：addCommand({ langKey: "x", ... }) */
function commands() {
    const out = [];
    const re = /addCommand\(\{([\s\S]{0,400}?)\}\)/g;
    let m;
    while ((m = re.exec(indexSrc))) {
        const body = m[1];
        const langKey = /langKey:\s*"([^"]+)"/.exec(body)?.[1];
        if (!langKey) continue;
        // 键位可能写成常量（`hotkey: HOTKEY_TOGGLE`）—— 一层回溯把它还原成字面量，
        // 否则 `hotkey: "…"` 这种判据在源码里根本不存在（源码是故意共用常量的）
        const hkRaw = /hotkey:\s*([^,}]+)/.exec(body)?.[1]?.trim() ?? "";
        const hotkey = (asLiteral(hkRaw, indexVars) ?? "").replace(/^"|"$/g, "");
        const zh = new RegExp(`"${langKey}"\\s*:\\s*"([^"]+)"`).exec(read(path.join(SRC, "i18n", "zh_CN.json")))?.[1] ?? "";
        out.push({ name: langKey, label: zh, hotkey });
    }
    return out;
}

/** 宿主菜单（index.ts）里的 label —— 跑在折叠后的源码上，且支持三元里两个分支 */
function hostMenuLabels() {
    const out = [];
    for (const m of indexFold.matchAll(/label:\s*([^,\n]*)/g)) {
        out.push(...literalsOf(m[1], indexVars));
    }
    return [...new Set(out.filter(Boolean))];
}

/**
 * 自绘 UI 的可见文案（renderer.ts）。
 *
 * 只认四种**构建器调用点**，不去全文件抓字符串 —— 否则 CSS 类名、图标名、
 * `data-mm-key` 之类的内部标识会一起涌进来，清单立刻变成噪音。
 */
function uiEntries() {
    const out = [];
    const add = (kind, text) => {
        const t = text.replace(/…$/, "").trim();
        if (!t) return;
        // 纯 ASCII 的短串大概率是内部标识（类名 / 图标名），只留看起来像按钮的
        if (!hasCJK(t) && !/^[-+−‹›«»×✕▶✓%0-9A-Za-z ]{1,8}$/.test(t)) return;
        // 单字符符号按钮（`−` `+` `‹` `›` `✕`）不单独列 —— 它们的**语义在 tooltip 上**
        // （「缩小」「放大」「上一个」…），tooltip 那一行已经覆盖了，列出来只是重复。
        if ([...t].length === 1 && !hasCJK(t)) return;
        out.push({ kind, text: t });
    };
    // ① tooltip —— 工具条按钮 / 悬浮按钮 / 折叠珠子 / 小地图… 的可见提示
    //    取整个右值（不是只取第一个字面量）：`on ? "展开" : "折叠"` 两个分支都是可见文案
    for (const m of rendererFold.matchAll(/dataset\.mmTip\s*=\s*([^;]*);/g)) {
        for (const t of literalsOf(m[1], rendererVars)) add("tooltip", t);
    }
    // ② 菜单项 item("文案", "快捷键", disabled, fn) —— 只取第一个实参（第二个是快捷键提示）
    for (const m of rendererFold.matchAll(/\bitem\(\s*([^,]*),/g)) {
        for (const t of literalsOf(m[1], rendererVars)) add("menu", t);
    }
    // ③ menu.addItem({ label: "文案" })
    for (const m of rendererFold.matchAll(/label:\s*([^,\n]*)/g)) {
        for (const t of literalsOf(m[1], rendererVars)) add("menu", t);
    }
    // ④ 按钮 / 行标题 mk("…") btn("…") row("…")
    for (const m of rendererFold.matchAll(/\b(?:mk|btn|row)\(\s*([^,)]*)/g)) {
        for (const t of literalsOf(m[1], rendererVars)) add("btn", t);
    }

    const seen = new Set();
    return out.filter((o) => {
        const k = `${o.kind}|${o.text}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/** 设置面板项 —— 跑在折叠后的源码上（`addToggle(this.t("键","标题"), …)` → `addToggle("标题", …)`） */
function settingItems() {
    const out = [];
    const push = (kind, title, configKey) => out.push({ kind, title, configKey: configKey ?? "" });

    for (const m of indexFold.matchAll(/addToggle\(\s*("(?:[^"\\]|\\.)*")\s*,\s*"(?:[^"\\]|\\.)*"\s*,\s*(this\.config\.\w+)/g)) {
        push("toggle", m[1].slice(1, -1), m[2].replace("this.config.", ""));
    }
    // 跨行的 addToggle("标题",\n "描述",\n this.config.x, ...)
    for (const m of indexFold.matchAll(/addToggle\(\s*("(?:[^"\\]|\\.)*")\s*,\s*\n?\s*"(?:[^"\\]|\\.)*"\s*,\s*\n?\s*(this\.config\.\w+)/g)) {
        push("toggle", m[1].slice(1, -1), m[2].replace("this.config.", ""));
    }
    // 第三个参数有两种写法：
    //   · `this.localize(EDGE_OPTIONS, "edge")` / `Object.fromEntries(...)` —— 抓首词当配置键线索
    //   · **内联对象字面量** `{ auto: …, fixed: …, fill: … }` —— 抓不到键，留空
    // ⚠️ 原来只认 `(\w+)`，于是以 `{` 开头的内联对象**整条被静默跳过**：
    //    表现是「设置项 N」比面板实测少 1，不报错、不红，只是少了一行。
    //    这正是「探针不会红，只会给出过时结论」的又一例 —— 靠下面那条
    //    「两个数字必须相等」的自检才逼出来的。
    for (const m of indexFold.matchAll(/addSelect\(\s*("(?:[^"\\]|\\.)*")\s*,\s*\n?\s*"(?:[^"\\]|\\.)*"\s*,\s*\n?\s*([\w{])/g)) {
        push("select", m[1].slice(1, -1), m[2] === "{" ? "" : m[2]);
    }
    for (const m of indexFold.matchAll(/addNumber\(\s*("(?:[^"\\]|\\.)*")/g)) push("number", m[1].slice(1, -1));
    for (const m of indexFold.matchAll(/addText\(\s*("(?:[^"\\]|\\.)*")/g)) push("text", m[1].slice(1, -1));
    // `addHint` 是「纯说明条目」（没有可操作控件），也是 setting.addItem 的一层包装。
    // 漏了它会让「设置项 N」与面板实测的 `.config-name` 数差 1 ——
    // 而报告里那行「设置项 24（面板实测 25）」的括号对比，正是当初发现这个漏项的线索。
    for (const m of indexFold.matchAll(/addHint\(\s*("(?:[^"\\]|\\.)*")/g)) push("hint", m[1].slice(1, -1));
    for (const m of indexFold.matchAll(/setting\.addItem\(\{\s*\n?\s*title:\s*("(?:[^"\\]|\\.)*")/g)) {
        push("action", m[1].slice(1, -1));
    }
    // 去重（跨行正则与单行正则会重复命中）
    const seen = new Set();
    return out.filter((o) => {
        const k = `${o.kind}|${o.title}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/**
 * `SHORTCUT_HELP` 数组的源码片段。
 *
 * ⚠️ 原来这里是 `/const SHORTCUT_HELP = \[([\s\S]*?)\]\.join/` —— 它依赖
 * 「数组直接 `.join(...)`」这个**早已不存在**的写法（现在数组末尾是 `];`，
 * 拼接挪进了 `shortcutHelp()`）。正则失配后不报错，只是静默返回空串，
 * 于是报告里出现「快捷键承诺 0 条」，外加 4 条反向缺口全部误报。
 * 改成「从 `const SHORTCUT_HELP` 找到下一行 `];`」，与拼接口径解耦。
 */
function shortcutBlock() {
    const start = indexSrc.indexOf("const SHORTCUT_HELP");
    if (start < 0) return "";
    const end = indexSrc.indexOf("\n];", start);
    return end < 0 ? "" : indexSrc.slice(start, end);
}

/**
 * SHORTCUT_HELP 里对用户承诺的快捷键。
 *
 * 每行是 `[语义键, 文案]` **一对**，所以取每对的第二个字符串 ——
 * 第一个是 `shortcut.nav` 这类词表键，不是文案。
 */
function shortcutClaims() {
    const block = shortcutBlock();
    if (!block) return [];
    const out = [];
    for (const m of block.matchAll(/\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g)) {
        const text = m[2];
        if (!text.trim()) continue; // 空行占位 `["", ""]`
        const [head, ...rest] = text.split("：");
        out.push({ group: head, detail: rest.join("：") });
    }
    return out;
}

/** 导图内实际处理的按键（从 onKeyDown 抠出来，用于跟 SHORTCUT_HELP 对账） */
function handledKeys() {
    const m = /private onKeyDown\(e: KeyboardEvent\) \{([\s\S]*?)\n    \}\n/.exec(rendererSrc);
    if (!m) return { keys: [], modifiers: [], body: "" };
    const body = m[1];
    const keys = new Set();
    for (const k of body.matchAll(/key(?:\.toLowerCase\(\))?\s*===\s*"([^"]+)"/g)) keys.add(k[1]);
    const modifiers = new Set();
    if (/modOnly\s*&&/.test(body)) modifiers.add("Ctrl/Cmd");
    if (/e\.altKey\s*&&/.test(body)) modifiers.add("Alt");
    if (/e\.shiftKey\s*&&/.test(body)) modifiers.add("Shift");
    return { keys: [...keys].sort(), modifiers: [...modifiers], body };
}

/* ---------------------------------------------------------------- 对账：承诺 × 实现 */

/**
 * 承诺里的键名 → `onKeyDown` 里应当出现的判据。
 *
 * 手写这张表是有意的：通用正则映射不出来（`Ctrl+C` 在源码里是
 * `modOnly && key.toLowerCase() === "c"`，`Alt+←` 是 `e.altKey && !mod && key === "ArrowLeft"`）。
 * 它的价值是**回归护栏** —— 谁把某个分支删了，这里立刻报「承诺了却没实现」。
 */
const CLAIM_RULES = [
    { tok: "Home", want: /key === "Home"/ },
    { tok: "End", want: /key === "End"/ },
    { tok: "↑", want: /key === "ArrowUp"/ },
    { tok: "↓", want: /key === "ArrowDown"/ },
    { tok: "←", want: /key === "ArrowLeft"/ },
    { tok: "→", want: /key === "ArrowRight"/ },
    { tok: "空格", want: /key === " "/ },
    { tok: "Tab", want: /key === "Tab"/ },
    { tok: "Shift+Tab", want: /shiftKey && key === "Tab"/ },
    { tok: "Enter", want: /key === "Enter"/ },
    { tok: "F2", want: /key === "F2"/ },
    { tok: "Delete", want: /key === "Delete"/ },
    { tok: "Esc", want: /key === "Escape"/ },
    { tok: "Ctrl+=/-", want: /modOnly && \(key === "=" \|\| key === "\+"\)/ },
    { tok: "Ctrl+0", want: /modOnly && key === "0"/ },
    { tok: "Ctrl+1", want: /modOnly && key === "1"/ },
    { tok: "Ctrl+F", want: /modOnly && key\.toLowerCase\(\) === "f"/ },
    { tok: "Ctrl+↑", want: /modOnly && key === "ArrowUp"/ },
    { tok: "Ctrl+↓", want: /modOnly && key === "ArrowDown"/ },
    { tok: "Ctrl+C", want: /modOnly && key\.toLowerCase\(\) === "c"/ },
    { tok: "Ctrl+V", want: /modOnly && key\.toLowerCase\(\) === "v"/ },
    { tok: "Ctrl+X", want: /modOnly && key\.toLowerCase\(\) === "x"/ },
    { tok: "Ctrl+D", want: /modOnly && key\.toLowerCase\(\) === "d"/ },
    { tok: "Alt+←", want: /e\.altKey && !mod && key === "ArrowLeft"/ },
    { tok: "Alt+→", want: /e\.altKey && !mod && key === "ArrowRight"/ },
    { tok: "X（勾选）", want: /\(key === "x" \|\| key === "X"\)/ },
    { tok: "F（全屏）", want: /\(key === "f" \|\| key === "F"\)/ },
    // 全局快捷键不在 onKeyDown 里，而是注册到 addCommand 的 hotkey
    globalHotkeyRule("HOTKEY_TOGGLE"),
    globalHotkeyRule("HOTKEY_SIDE"),
];

/**
 * 全局快捷键的判据。
 *
 * ⚠️ 不能写死 `hotkey: "⌥⌘D"` —— 源码**故意**让「命令声明」与「速查文字」共用同一个
 * 常量（见 index.ts 里 `HOTKEY_TOGGLE` 的注释），所以那个字面量在源码里根本不存在。
 * 写死判据会把**「代码做对了」判成「没实现」**，而这类误报会让人开始怀疑整张表。
 * 这里同时接受「常量名」与「常量展开后的字面量」两种写法。
 *
 * 常量解析不出来时 `want` 只认常量名 —— 那也会红，且 `tok` 里写明了原因，
 * 不会像以前那样给出一条看不懂的假红。
 */
function globalHotkeyRule(constName) {
    const val = new RegExp(`const ${constName} = "([^"]+)"`).exec(indexSrc)?.[1] ?? null;
    const alt = val ? `|"${val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"` : "";
    return {
        tok: val ? `${constName} = ${val}` : `${constName}（源码里找不到定义）`,
        want: new RegExp(`hotkey:\\s*(?:${constName}${alt})`),
        where: "index",
    };
}

/**
 * 反向：onKeyDown 里处理了、但插件内速查清单**没提**的键。
 *
 * 这张表是**人工维护**的 —— 反向映射没法自动推：同一个 `ArrowUp` 在源码里
 * 同时是「导航 ↑」（裸按）和「上移 Ctrl+↑」（带修饰键），光看字面量分不出来。
 *
 * 但它不会静默腐烂：每一行都要求「键确实在处理」**且**「速查清单确实没提」，
 * 两个条件有一个不成立这一行就自己消失。所以：
 *   · 有人把 `Ctrl+A` 补进速查 → 这一行消失（好事）
 *   · 有人把 `Ctrl+A` 的处理分支删了 → 这一行也消失（那是另一类问题，由
 *     「承诺 × 实现」那一节兜，因为它本来也没承诺）
 */
const DOC_ONLY_KEYS = [
    { key: "a", label: "Ctrl+A（全选同级，再按一次选中整棵树）", needle: "Ctrl+A" },
    { key: "PageUp", label: "PageUp（演示模式回退）", needle: "PageUp" },
    { key: "PageDown", label: "PageDown（演示模式推进）", needle: "PageDown" },
    { key: "Backspace", label: "Backspace（删除的别名）", needle: "Backspace" },
];

/* ---------------------------------------------------------------- 对账 */

const COMMANDS = commands();
const MENUS = hostMenuLabels();
const UI = uiEntries();
const SETTINGS = settingItems();
const CLAIMS = shortcutClaims();
const KEYS = handledKeys();

/** 一条入口 -> 机械命中 */
function auditCommand(c) {
    return { probes: [c.name, c.label].filter(Boolean), manual: false };
}
function auditMenu(label) {
    // 菜单文案里有动态数字（如「全部转为导图（2 个）」），取静态部分
    const base = label.split("（")[0].replace(/…/g, "").trim();
    return { probes: [base].filter((s) => s.length >= 2), manual: false };
}
function auditUi(e) {
    // tooltip 里带数字的（「展开 3 个子节点」）取静态前缀
    const base = e.text.split(/[（(]/)[0].replace(/…/g, "").trim();
    return { probes: [base].filter((s) => s.length >= 2), manual: false };
}
function auditSetting(s) {
    const probes = [s.title];
    if (s.configKey) probes.push(s.configKey);
    return { probes: probes.filter(Boolean), manual: false };
}
function auditClaim(c) {
    // 从「Ctrl+C 复制子树 · F2 改名」这类描述里抠出键名当探针
    const toks = [];
    for (const m of c.detail.matchAll(/(Ctrl|⌘|⌥|Alt|Shift)\s*\+\s*([A-Za-z0-9=+\-/↑↓←→]+)/g)) {
        toks.push(`${m[1]}+${m[2]}`);
    }
    for (const m of c.detail.matchAll(/\b(F2|F5|F11|F12|Tab|Enter|Delete|Backspace|Home|End|Esc|Space)\b/g)) toks.push(m[1]);
    for (const m of c.detail.matchAll(/[↑↓←→]/g)) toks.push(m[0]);
    if (/空格/.test(c.detail)) toks.push("空格");
    // ★ 抠不出键名的行（「待办：X 勾选…」抠得出，但「过滤：工具条上的…」抠不出）
    //   不能拿整句去 grep —— 那必然零命中，纯噪音。判成「人工」交给文档。
    return { probes: [...new Set(toks)], manual: toks.length === 0 };
}

const rows = [];
for (const c of COMMANDS) rows.push({ group: "命令", item: `${c.label || c.name}（${c.name}）`, ...auditCommand(c) });
for (const l of MENUS) rows.push({ group: "菜单项", item: l, ...auditMenu(l) });
for (const e of UI) rows.push({ group: `自绘UI·${e.kind}`, item: e.text, ...auditUi(e) });
for (const s of SETTINGS) rows.push({ group: `设置·${s.kind}`, item: s.title, ...auditSetting(s) });
for (const c of CLAIMS) rows.push({ group: "快捷键承诺", item: `${c.group}：${c.detail}`, ...auditClaim(c) });

for (const r of rows) {
    const per = r.probes.map((p) => ({ probe: p, files: hits(p) }));
    r.hits = per;
    r.totalFiles = new Set(per.flatMap((x) => x.files)).size;
    r.deadProbes = per.filter((x) => x.files.length === 0).map((x) => x.probe);
}

/* ---------------------------------------------------------------- 已知覆盖 */

/**
 * 一批**注定零命中**的条目：tooltip / 提示语 / 说明文字。
 *
 * 这些话用户看不到就说明不了任何问题 —— 真正要守的是它背后的**行为**。
 * 例如 `tip.expandN`（「展开 {n} 个子节点」）：该守的是「点珠子能把折起来的分支展开」，
 * 而那条在 `diag-node-menu.mjs` / `diag-canvas-v2.mjs` 里点了不知道多少次；
 * tooltip 的字面量没进断言，纯属正常，不是缺口。
 *
 * ⚠️ 但**不能直接加白名单** —— 白名单会烂。探针被删了、行为被改坏了，
 * 白名单还在这儿安安静静地说「已覆盖」，那就成了**第二道会撒谎的网**。
 * 所以每条都必须写清「哪个文件 + 哪个标记字串」，脚本**每次真去查那个标记还在不在**：
 * 标记没了 → 这一条退回「零命中」并在报告里标红，逼人重新判一次。
 *
 * `marker` 挑的是**那条行为断言留下来的痕迹**（选择器 / 文案 / 断言字串），
 * 不是随便一个词 —— 它得能证明「这段测试还在测那件事」。
 */
const KNOWN_COVERED = [
    {
        item: "显示全部节点",
        file: "tests/kernel/diag-filter-search.mjs",
        marker: "mm-filters",
        why: "过滤工具条的 tooltip；行为（点「全部」按钮回到全量）由过滤探针验证",
    },
    {
        item: "只看…的待办",
        file: "tests/kernel/diag-filter-search.mjs",
        marker: "只看未完成",
        why: "同上；「只看未完成 / 已完成」的筛选结果由过滤探针验证",
    },
    {
        item: "缩放选项",
        file: "tests/kernel/diag-canvas-v2.mjs",
        marker: "适应选中节点",
        why: "缩放下拉按钮的 tooltip；下拉里各项与缩放效果由画布探针验证",
    },
    {
        item: "点击取消勾选",
        file: "tests/kernel/diag-node-menu.mjs",
        marker: "标记为未完成",
        why: "复选框 tooltip（已勾选态）；点复选框取消勾选由任务探针验证",
    },
    {
        item: "点击标记为已完成",
        file: "tests/kernel/diag-task-check.mjs",
        marker: "标记为已完成",
        why: "复选框 tooltip（未勾选态）；勾选写回内核由任务探针验证",
    },
    {
        item: "取消选择",
        file: "tests/kernel/diag-canvas-v2.mjs",
        marker: "mm-batch",
        why: "批量操作条 ✕ 的 tooltip；批量条的浮现 / 收起来由画布探针验证",
    },
    {
        item: "当前聚焦的分支",
        file: "tests/kernel/ux-v2.mjs",
        marker: "mm-crumb--on",
        why: "面包屑当前节的 tooltip；下钻后面包屑亮起由下钻探针验证",
    },
    {
        item: "回到这一层",
        file: "tests/kernel/ux-v2.mjs",
        marker: "mm-crumb-out",
        why: "面包屑可点节的 tooltip；点它逐层返回由下钻探针验证（`.mm-crumb-out` 就是那个点击目标）",
    },
    {
        item: "展开 {n} 个子节点",
        file: "tests/kernel/diag-canvas-v2.mjs",
        marker: ".mm-toggle",
        why: "折叠珠子的 tooltip；点珠子展开 / 折叠由画布探针验证",
    },
    {
        item: "记住这个缩放 ✓",
        file: "tests/kernel/diag-canvas-v2.mjs",
        marker: "记住这个缩放",
        why: "缩放菜单项的**已记住**态；写入文档级偏好由画布探针验证",
    },
    {
        item: "折叠状态与大纲同步",
        file: "tests/kernel/diag-fold-sync.mjs",
        marker: "fold",
        why: "设置里的说明文字（不是开关）；折叠态与大纲 fold 的双向同步由折叠探针验证",
    },
];
/** item → 认领记录；命中过（totalFiles > 0）的条目不需要认领，直接跳过 */
const CLAIMED = new Map(KNOWN_COVERED.map((k) => [k.item, k]));
const claimedRows = [];
const rottenClaims = [];
for (const r of rows) {
    const k = CLAIMED.get(r.item);
    if (!k) continue;
    k.matched = true;
    // 有人真的把这句话写进断言了 → 这条认领自动退休，不再需要（报告里提一句）
    if (r.totalFiles > 0) {
        k.superseded = true;
        continue;
    }
    const f = path.join(ROOT, k.file);
    k.live = fs.existsSync(f) && read(f).includes(k.marker);
    if (k.live) {
        r.claimed = k;
        claimedRows.push(r);
    } else {
        k.dead = fs.existsSync(f) ? `标记「${k.marker}」在 ${k.file} 里找不到了` : `${k.file} 不存在`;
        rottenClaims.push(k);
    }
}

/* ---- 承诺 × 实现 ---- */
const claimAudit = CLAIM_RULES.map((r) => ({
    tok: r.tok,
    src: r.where === "index" ? indexSrc : KEYS.body,
    ok: r.want.test(r.where === "index" ? indexSrc : KEYS.body),
}));
const claimedTokens = new Set();
for (const c of CLAIMS) for (const p of auditClaim(c).probes) claimedTokens.add(p);
/** 速查清单的原文（反向缺口要查「清单里到底提没提」） */
const HELP_TEXT = shortcutBlock().replace(/\s+/g, "");
const undocumented = DOC_ONLY_KEYS.filter((d) => KEYS.keys.includes(d.key) && !HELP_TEXT.includes(d.needle));

/**
 * 设置面板的**实测**条目数。
 *
 * 这个数只能在真机上量（面板是运行时用 `setting.addItem` 堆出来的），静态解析不出来。
 * 所以它从 `diag-settings.mjs` 那条断言里读 —— **单一来源**。
 *
 * ⚠️ 以前这里写死过一个数字，加设置项时忘了同步，于是报告里那行
 * 「设置项 26（面板实测 26）」看着挺对，其实是**两份各自维护的数字恰好相等**。
 * 那种「一致性」是巧合，不是保证 —— 和 `KNOWN_COVERED` 要自证是同一个道理。
 */
const measuredSettings = (() => {
    try {
        const m = /titles\.length >= (\d+)/.exec(read(path.join(TESTS, "kernel", "diag-settings.mjs")));
        return m ? Number(m[1]) : null;
    } catch {
        return null;
    }
})();

/* ---------------------------------------------------------------- 自检 */

/**
 * 这个脚本最大的风险不是「报错」，而是**安静地空转**。
 *
 * i18n 三步走之后它的解析器全部失配，输出从「一堆入口」变成「0 条」，
 * 但报告照常打印、看上去只是「这类入口本来就少」，于是连续几轮没人发现 ——
 * 而且它还反过来给出了 6 条假结论。这正是本项目反复总结过的
 * 「探针不会红，只会给出过时的结论」。
 *
 * 所以每一类解析结果都配一条下限断言：**跌破就非 0 退出**，
 * 让「解析器脱节」表现为一次失败，而不是一份自信的报告。
 */
const SELF_CHECK = [];
if (!shortcutBlock()) SELF_CHECK.push("取不到 SHORTCUT_HELP 源码块 —— 解析已与源码脱节");
if (!HELP_TEXT) SELF_CHECK.push("速查清单原文为空 —— 反向缺口判定会全部误报");
if (CLAIMS.length === 0) SELF_CHECK.push("SHORTCUT_HELP 一条承诺都没解析出来 —— 正则脱节，或清单被清空");
if (KEYS.keys.length === 0) SELF_CHECK.push("onKeyDown 一个 key 判据都没解析出来 —— 正则脱节");
if (COMMANDS.length === 0) SELF_CHECK.push("一个 addCommand 都没解析出来 —— 正则脱节");
if (MENUS.length === 0) SELF_CHECK.push("一条宿主菜单文案都没解析出来 —— 正则脱节");
if (UI.length === 0) SELF_CHECK.push("一条自绘 UI 文案都没解析出来 —— 正则脱节");
if (SETTINGS.length === 0) SELF_CHECK.push("一个设置项都没解析出来 —— 正则脱节");
if (measuredSettings === null) SELF_CHECK.push("读不到 diag-settings.mjs 里的面板条目数断言 —— 「设置项 N（面板实测 M）」那一栏会失去意义");
// ★ 两个数字**必须相等**。不等就说明解析器漏了某种写法（面板是唯一事实来源）。
//   以前这行只是「并排打印两个数，等一个细心的人去看」—— 现在它会自己喊疼。
if (measuredSettings !== null && SETTINGS.length !== measuredSettings) {
    SELF_CHECK.push(
        `静态解析出 ${SETTINGS.length} 个设置项，面板实测 ${measuredSettings} 个（差 ${measuredSettings - SETTINGS.length}）` +
            " —— 多半是解析器漏了某种 addItem 写法，别当成「面板多了个东西」",
    );
}
// 已知覆盖表自身也会脱节：入口文案改了、或那段测试被删了，表却还在这儿说「已覆盖」。
const orphanClaims = KNOWN_COVERED.filter((k) => !k.matched);
if (orphanClaims.length) SELF_CHECK.push(`已知覆盖表有 ${orphanClaims.length} 条的 item 名对不上任何入口（改文案时忘了同步）：${orphanClaims.map((k) => k.item).join(" / ")}`);
if (rottenClaims.length) SELF_CHECK.push(`已知覆盖表有 ${rottenClaims.length} 条的标记字串在探针里找不到了（那段测试可能没了）：${rottenClaims.map((k) => k.item).join(" / ")}`);

/* ---------------------------------------------------------------- 输出 */

if (process.argv.includes("--json")) {
    console.log(
        JSON.stringify(
            {
                rows,
                keys: KEYS,
                claimAudit,
                undocumented,
                selfCheck: SELF_CHECK,
                counts: { commands: COMMANDS.length, menus: MENUS.length, ui: UI.length, settings: SETTINGS.length, claims: CLAIMS.length },
            },
            null,
            2,
        ),
    );
    process.exit(0);
}

const pad = (s, n) => {
    // 中文按 2 宽度算，免得表格歪
    const w = [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
    return s + " ".repeat(Math.max(0, n - w));
};

console.log("=".repeat(104));
console.log("大纲导图 · 用户可见入口 × 测试命中 覆盖审计");
console.log("=".repeat(104));
console.log(
    `测试文件 ${testFiles.length} 支 · 命令 ${COMMANDS.length} · 菜单文案 ${MENUS.length} · ` +
        `自绘UI ${UI.length} · 设置项 ${SETTINGS.length}（面板实测 ${measuredSettings ?? "?"}）· 快捷键承诺 ${CLAIMS.length} 条`,
);
console.log("");
if (SELF_CHECK.length) {
    console.log("!".repeat(104));
    console.log("★ 审计脚本自检失败 —— 下面的清单与结论**不可信**，请先修解析器：");
    for (const s of SELF_CHECK) console.log(`  · ${s}`);
    console.log("!".repeat(104));
    console.log("");
}

let lastGroup = "";
for (const r of rows) {
    if (r.group !== lastGroup) {
        console.log(`\n── ${r.group} ${"─".repeat(Math.max(0, 94 - r.group.length * 2))}`);
        lastGroup = r.group;
    }
    const mark = r.manual ? "○ 人工" : r.claimed ? "◍ 已认领" : r.totalFiles === 0 ? "✗ 零命中" : r.totalFiles < 2 ? "△ 命中少" : "✓";
    const tail = r.manual
        ? "（抠不出键名，不做机械判定）"
        : r.claimed
          ? `　→ ${r.claimed.file}`
          : r.deadProbes.length
            ? `　未出现：${r.deadProbes.join(" / ")}`
            : "";
    console.log(`  ${pad(mark, 10)} ${pad(r.item, 46)} 命中 ${String(r.totalFiles).padStart(2)} 支${tail}`);
}

/* ---- 承诺 × 实现 ---- */
console.log("\n" + "=".repeat(104));
console.log("对账：SHORTCUT_HELP 承诺 × onKeyDown / addCommand 实际实现");
console.log("=".repeat(104));
console.log(`onKeyDown 里出现的 key 字面量（${KEYS.keys.length} 个）：${KEYS.keys.join(" ")}`);
console.log(`onKeyDown 里出现的修饰键判据：${KEYS.modifiers.join(" ") || "(无)"}\n`);
const missImpl = claimAudit.filter((c) => !c.ok);
console.log(`承诺 × 实现：${claimAudit.length - missImpl.length}/${claimAudit.length} 条在源码里找得到对应判据`);
for (const c of claimAudit) console.log(`  ${c.ok ? "✓" : "✗"} ${c.tok}`);
if (missImpl.length) {
    console.log(`\n★ 承诺了却没实现（用户在速查里看得到、按下去没反应）：${missImpl.map((c) => c.tok).join(" / ")}`);
} else {
    console.log("\n✓ 速查清单里承诺的每一个键，源码里都有对应的处理分支。");
}
if (undocumented.length) {
    console.log(`\n△ 实现了却没承诺（功能在、但插件内速查里发现不了）：${undocumented.map((d) => d.label).join(" / ")}`);
    console.log("  —— 这些在 README 的快捷键表里有，但插件内「查看快捷键」清单漏了，两边不一致。");
}

/* ---- 零命中 ---- */
const zero = rows.filter((r) => !r.manual && !r.claimed && r.totalFiles === 0);
const few = rows.filter((r) => !r.manual && r.totalFiles > 0 && r.totalFiles < 2);
const manualRows = rows.filter((r) => r.manual);
console.log(`\n零命中的入口 ${zero.length} 条：`);
for (const r of zero) console.log(`  · [${r.group}] ${r.item}　（探针：${r.probes.join(" / ") || "(没抠出探针)"}）`);
console.log(`\n只命中 1 支的入口 ${few.length} 条：`);
for (const r of few) console.log(`  · [${r.group}] ${r.item}　（命中：${[...new Set(r.hits.flatMap((x) => x.files))].join(" ")}）`);
console.log(`\n已认领 ${claimedRows.length} 条（文案不单独断言，行为在别处测）：`);
for (const r of claimedRows) console.log(`  · [${r.group}] ${r.item} → ${r.claimed.file}（标记「${r.claimed.marker}」）｜${r.claimed.why}`);
const superseded = KNOWN_COVERED.filter((k) => k.superseded);
if (superseded.length) {
    console.log(`\n○ 认领条目已退休 ${superseded.length} 条（现在真的有断言了，可以从表里删掉）：${superseded.map((k) => k.item).join(" / ")}`);
}
if (rottenClaims.length) {
    console.log(`\n★★ 认领失效 ${rottenClaims.length} 条 —— 标记没了，说明那段测试已经不在了，这些退回零命中：`);
    for (const k of rottenClaims) console.log(`  · ${k.item}：${k.dead}`);
}
console.log(`\n人工判定（不做机械 grep）${manualRows.length} 条：`);
for (const r of manualRows) console.log(`  · [${r.group}] ${r.item}`);
console.log("\n注意：静态 grep 只说明「这个字串没在测试里出现过」，不等于「行为没被测」。");
console.log("零命中清单是给人看的排查线索，不是结论。");

// 自检失败 → 非 0 退出。放在最后是为了让报告仍然完整打印出来（好看清哪一类塌了）。
if (SELF_CHECK.length) process.exit(1);
