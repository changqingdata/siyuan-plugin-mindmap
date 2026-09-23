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
        const hotkey = /hotkey:\s*"([^"]*)"/.exec(body)?.[1] ?? "";
        const zh = new RegExp(`"${langKey}"\\s*:\\s*"([^"]+)"`).exec(read(path.join(SRC, "i18n", "zh_CN.json")))?.[1] ?? "";
        out.push({ name: langKey, label: zh, hotkey });
    }
    return out;
}

/** 宿主菜单（index.ts）里的 label */
function hostMenuLabels() {
    const out = [];
    for (const m of indexSrc.matchAll(/label:\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/g)) {
        const text = unquote(m[1]);
        if (text) out.push(text);
    }
    return [...new Set(out)];
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
    for (const m of rendererSrc.matchAll(/dataset\.mmTip\s*=\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/g)) add("tooltip", unquote(m[1]));
    // ② 菜单项 item("文案", "快捷键", disabled, fn)
    for (const m of rendererSrc.matchAll(/\bitem\(\s*("(?:[^"\\]|\\.)*"|`[^`]*`)\s*,/g)) add("menu", unquote(m[1]));
    // ③ menu.addItem({ label: "文案" })
    for (const m of rendererSrc.matchAll(/label:\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/g)) add("menu", unquote(m[1]));
    // ④ 按钮 / 行标题 mk("…") btn("…") row("…")
    for (const m of rendererSrc.matchAll(/\b(?:mk|btn|row)\(\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/g)) add("btn", unquote(m[1]));

    const seen = new Set();
    return out.filter((o) => {
        const k = `${o.kind}|${o.text}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/** 设置面板项 */
function settingItems() {
    const out = [];
    const push = (kind, title, configKey) => out.push({ kind, title, configKey: configKey ?? "" });

    for (const m of indexSrc.matchAll(/addToggle\(\s*("(?:[^"\\]|\\.)*")\s*,\s*"(?:[^"\\]|\\.)*"\s*,\s*(this\.config\.\w+)/g)) {
        push("toggle", m[1].slice(1, -1), m[2].replace("this.config.", ""));
    }
    // 跨行的 addToggle("标题",\n "描述",\n this.config.x, ...)
    for (const m of indexSrc.matchAll(/addToggle\(\s*("(?:[^"\\]|\\.)*")\s*,\s*\n?\s*"(?:[^"\\]|\\.)*"\s*,\s*\n?\s*(this\.config\.\w+)/g)) {
        push("toggle", m[1].slice(1, -1), m[2].replace("this.config.", ""));
    }
    for (const m of indexSrc.matchAll(/addSelect\(\s*("(?:[^"\\]|\\.)*")\s*,\s*\n?\s*"(?:[^"\\]|\\.)*"\s*,\s*\n?\s*(\w+)/g)) {
        push("select", m[1].slice(1, -1), m[2]);
    }
    for (const m of indexSrc.matchAll(/addNumber\(\s*("(?:[^"\\]|\\.)*")/g)) push("number", m[1].slice(1, -1));
    for (const m of indexSrc.matchAll(/addText\(\s*("(?:[^"\\]|\\.)*")/g)) push("text", m[1].slice(1, -1));
    for (const m of indexSrc.matchAll(/setting\.addItem\(\{\s*\n?\s*title:\s*("(?:[^"\\]|\\.)*"|this\.i18n\.\w+\s*\|\|\s*"(?:[^"\\]|\\.)*")/g)) {
        const t = m[1].includes("||") ? m[1].split("||")[1].trim().slice(1, -1) : m[1].slice(1, -1);
        push("action", t);
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

/** SHORTCUT_HELP 里对用户承诺的快捷键 */
function shortcutClaims() {
    const m = /const SHORTCUT_HELP = \[([\s\S]*?)\]\.join/.exec(indexSrc);
    if (!m) return [];
    const lines = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).filter((s) => s.trim() !== "");
    return lines.map((line) => {
        const [head, ...rest] = line.split("：");
        return { group: head, detail: rest.join("：") };
    });
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
    { tok: "⌥⌘D", want: /hotkey:\s*"⌥⌘D"/, where: "index" },
    { tok: "⌥⌘V", want: /hotkey:\s*"⌥⌘V"/, where: "index" },
];

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

/* ---- 承诺 × 实现 ---- */
const claimAudit = CLAIM_RULES.map((r) => ({
    tok: r.tok,
    src: r.where === "index" ? indexSrc : KEYS.body,
    ok: r.want.test(r.where === "index" ? indexSrc : KEYS.body),
}));
const claimedTokens = new Set();
for (const c of CLAIMS) for (const p of auditClaim(c).probes) claimedTokens.add(p);
/** 速查清单的原文（反向缺口要查「清单里到底提没提」） */
const HELP_TEXT = (/const SHORTCUT_HELP = \[([\s\S]*?)\]\.join/.exec(indexSrc)?.[1] ?? "").replace(/\s+/g, "");
const undocumented = DOC_ONLY_KEYS.filter((d) => KEYS.keys.includes(d.key) && !HELP_TEXT.includes(d.needle));

/* ---------------------------------------------------------------- 输出 */

if (process.argv.includes("--json")) {
    console.log(
        JSON.stringify(
            {
                rows,
                keys: KEYS,
                claimAudit,
                undocumented,
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
        `自绘UI ${UI.length} · 设置项 ${SETTINGS.length}（面板实测 25）· 快捷键承诺 ${CLAIMS.length} 条`,
);
console.log("");

let lastGroup = "";
for (const r of rows) {
    if (r.group !== lastGroup) {
        console.log(`\n── ${r.group} ${"─".repeat(Math.max(0, 94 - r.group.length * 2))}`);
        lastGroup = r.group;
    }
    const mark = r.manual ? "○ 人工" : r.totalFiles === 0 ? "✗ 零命中" : r.totalFiles < 2 ? "△ 命中少" : "✓";
    const tail = r.manual ? "（抠不出键名，不做机械判定）" : r.deadProbes.length ? `　未出现：${r.deadProbes.join(" / ")}` : "";
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
const zero = rows.filter((r) => !r.manual && r.totalFiles === 0);
const few = rows.filter((r) => !r.manual && r.totalFiles > 0 && r.totalFiles < 2);
const manualRows = rows.filter((r) => r.manual);
console.log(`\n零命中的入口 ${zero.length} 条：`);
for (const r of zero) console.log(`  · [${r.group}] ${r.item}　（探针：${r.probes.join(" / ") || "(没抠出探针)"}）`);
console.log(`\n只命中 1 支的入口 ${few.length} 条：`);
for (const r of few) console.log(`  · [${r.group}] ${r.item}　（命中：${[...new Set(r.hits.flatMap((x) => x.files))].join(" ")}）`);
console.log(`\n人工判定（不做机械 grep）${manualRows.length} 条：`);
for (const r of manualRows) console.log(`  · [${r.group}] ${r.item}`);
console.log("\n注意：静态 grep 只说明「这个字串没在测试里出现过」，不等于「行为没被测」。");
console.log("零命中清单是给人看的排查线索，不是结论。");
