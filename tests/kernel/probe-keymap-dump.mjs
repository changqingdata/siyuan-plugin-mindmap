/**
 * 只读探针：把**思源当前实际生效的全部键位** dump 出来，找「没被占用的组合」。
 *
 * ## 为什么需要它
 *
 * 选插件默认快捷键不能靠猜。Windows / IME / 思源自己 / 其它插件四层都可能占键，
 * 而「占了」的表现是**静默的** —— 键按下去了、什么都没发生，没有任何报错。
 *
 * 这个探针只回答一件事：**思源侧**已经绑了哪些组合。
 * （OS 与 IME 那一层它看不到 —— 那层的结论写在下面。）
 *
 * ## 数据来源
 *
 * `window.siyuan.config.keymap` 是**默认值 + 用户自定义合并后**的结果：
 *   · `keymap.general` / `keymap.editor` / `keymap.fileTree` … 思源内置命令
 *   · `keymap.plugin[插件名][命令id]` = `{ default, custom }` —— 插件声明的
 *
 * 直接读它比去 bundle 里挖默认表可靠（bundle 里那份还要自己合并 custom）。
 *
 * ## ★★★ 这个探针自己出过一次严重事故：只遍历了一层
 *
 * 第一版是这么写的：
 *
 *     for (const [scope, val] of Object.entries(km)) {
 *         for (const [id, v] of Object.entries(val)) { const k = eff(v); … }
 *     }
 *
 * 而 `keymap` 是**两层**结构：
 *
 *     keymap.general       = { fileTree: {custom, default}, … }   ← 一层，能读到
 *     keymap.editor        = { general: {insertBefore: {…}}, insert: {bold: {…}} }  ← 两层！
 *
 * 于是 `eff(v)` 拿到的是 `{general: {…}, insert: {…}}` 这种**分组对象**，
 * 它既没有 `custom` 也没有 `default` ⇒ 返回 `''` ⇒ **整个 `editor.*` 被静默跳过**。
 *
 * 后果是灾难性的：`⇧⌘B` 明明被 `editor.general.insertBefore`（上方插入块）占着，
 * 探针却报「✓ 空闲」；`⇧⌘S` 被 `editor.insert.strike`（删除线）占着，也报「✓ 空闲」。
 * 两个键位就这么被选成默认值，然后在真机上**静默失灵** ——
 * 一个是「完全没反应」，一个是「死在 Protyle 层」。
 *
 * **教训：探针漏掉一整块数据时不会报错，只会给出过时的结论。**
 * 所以现在改成递归遍历，并且**自证**：把「实际读到的键位条数」和
 * 「各作用域的原始条目数」一起打出来，条数对不上就是遍历又漏了。
 *
 * ## 两道关，缺一不可
 *
 * | 关 | 探针 | 回答 |
 * | --- | --- | --- |
 * | ① 占用 | **本探针** | 思源侧有没有人已经绑了这个组合 |
 * | ② 投递 | `probe-hotkeydelivery.mjs` | 事件到不到得了 `document` 冒泡（匹配器在那儿） |
 *
 * ⚠️ `⇧⌘S` 在①显示 ✓ 空闲，②显示 ✗（被 Protyle 截断传播）⇒ **「空闲」≠「能用」**。
 *
 * ## 顺带记下的：默认快捷键「不触发」的完整结论
 *
 * 起因：默认键位从 `⌥⌘D` / `⌥⌘V` 改成 `⌘空格` / `⌥空格` 之后，用户报「按了没反应」。
 *
 * | 层 | 结论 | 证据 |
 * | --- | --- | --- |
 * | ① Windows / 输入法 | **两个键都被吃掉** | `ChsIME.exe`（微软拼音）在跑；`Ctrl+空格` 是它「中/英文模式切换」的默认键；`Alt+空格` 是 Windows 窗口系统菜单 |
 * | ② Chromium 分发 | —— | 活过①的键才到这儿 |
 * | ③ 思源 keymap | **两个键都空闲** | 本探针 dump 无一条占用 |
 * | ④ 插件命令 | **接线正常** | 前端源码的判据是「带 `⌃`/`⌥`/`⌘` 就放行」 |
 *
 * ### ⚠️ 为什么当时 71 条断言全绿却没抓到
 *
 * `diag-commands.mjs` 用 CDP 的 `Input.dispatchKeyEvent` 派发**合成**按键，
 * 它从渲染层注入，**绕过输入法与系统窗口过程**。所以这类测试
 * **在原理上就抓不到 OS/IME 层的拦截** —— 不是断言写少了，是测量手段够不着那一层。
 *
 * ### ✅ 选默认键位时的检查清单
 *
 * 避开这几族（都是**静默**拦截，没有任何报错）：
 *
 * | 别用 | 原因 |
 * | --- | --- |
 * | `Ctrl+空格` | 中文输入法 中/英文模式切换（微软拼音 / 搜狗 / QQ 拼音） |
 * | `Alt+空格` | Windows 窗口系统菜单 |
 * | `Shift+空格` | 微软拼音 全角/半角切换 |
 * | 单独的 `Ctrl+Shift` / `Alt+Shift` | 切换输入语言（加第三个键就不触发） |
 * | `Win+*`、`Ctrl+Alt+Del`、`Ctrl+Shift+Esc`、`Alt+Tab`、`Alt+F4` | 系统保留 |
 * | `Ctrl+Alt+字母` | 某些欧洲键盘布局上 AltGr = Ctrl+Alt，会打出字符 |
 * | `⌥字母` | 思源自己用了 `⌥M`（切窗口）/ `⌥P`（设置）/ `⌥1`~`⌥9`（各停靠栏） |
 * | **思源 `editor.*` 已绑的 `⇧⌘字母`** | **`insertBefore`(B) / `strike`(S) / `insertAfter`(A) …** —— 编辑器自己会处理，命令根本轮不到 |
 *
 * 用法：node tests/kernel/probe-keymap-dump.mjs
 */
import { launch, sleep } from "../cdp.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";

const chrome = await launch({ headless: true, port: 9371, width: 1400, height: 1000 });
const page = await chrome.newPage("about:blank");

try {
    await page.send("Page.navigate", { url: `${KERNEL}/stage/build/desktop/` });
    await page.waitFor(`!!(window.siyuan && window.siyuan.config && window.siyuan.config.keymap)`, {
        timeout: 40000,
        label: "前端与 keymap 就绪",
    });
    /* ⚠️ 只等 `keymap` 存在是不够的 —— 插件是**异步**加载的，
       `addCommand` 跑完之后才会往 `keymap.plugin` 里写条目。
       第一版就等漏了这一步，dump 出来的 22 条插件键位里**没有本插件自己**，
       差一点被误读成「插件根本没注册热键」。 */
    await page.waitFor(
        `(() => { const p = window.siyuan.config.keymap.plugin || {}; return Object.keys(p).length >= 15 && !!p['siyuan-plugin-mindmap']; })()`,
        { timeout: 40000, label: "本插件的 keymap 条目已注册" },
    );
    await sleep(800);

    const dump = await page.eval(`(() => {
        const km = (window.siyuan && window.siyuan.config && window.siyuan.config.keymap) || null;
        if (!km) return { err: 'no keymap' };
        /** 取「实际生效」的键位：custom 优先，否则 default */
        const eff = (v) => {
            if (!v) return '';
            if (typeof v === 'string') return v;
            const c = typeof v.custom === 'string' && v.custom ? v.custom : '';
            return c || (typeof v.default === 'string' ? v.default : '');
        };
        const rows = [];
        /* ★ 递归遍历。判据：一个对象只要带 custom / default 字段，它就是叶子。
           不带就是**分组作用域**（keymap.editor.general 这种），要往下走。
           只遍历一层会静默漏掉整个 editor.* —— 详见文件头的事故记录。 */
        const walk = (scope, obj, out) => {
            for (const [k, v] of Object.entries(obj || {})) {
                if (!v || typeof v !== 'object') continue;
                if ('custom' in v || 'default' in v) {
                    const key = eff(v);
                    if (key) out.push({ scope, id: k, key });
                } else {
                    walk(scope + '.' + k, v, out);
                }
            }
        };
        const scopes = {};
        for (const [name, val] of Object.entries(km)) {
            if (name === 'plugin') continue;
            const out = [];
            walk(name, val, out);
            scopes[name] = out;
            rows.push(...out);
        }
        const plugins = [];
        for (const [name, cmds] of Object.entries(km.plugin || {})) {
            for (const [id, v] of Object.entries(cmds || {})) {
                const k = eff(v);
                if (k) plugins.push({ plugin: name, id, key: k });
            }
        }
        /* 自证用：各作用域的原始条目数（含空键位），与读到键位的条数对比 */
        const rawCounts = {};
        for (const [name, val] of Object.entries(km)) {
            if (name === 'plugin') continue;
            let n = 0;
            const count = (o) => { for (const [, v] of Object.entries(o || {})) { if (v && typeof v === 'object') { if ('custom' in v || 'default' in v) n++; else count(v); } } };
            count(val);
            rawCounts[name] = n;
        }
        return { rows, plugins, scopes, rawCounts };
    })()`);

    if (dump.err) {
        console.error("读不到 keymap：", dump.err);
        process.exit(1);
    }

    const norm = (s) => String(s || "").replace(/ /g, "␣");
    const byKey = new Map();
    for (const r of dump.rows) {
        const k = norm(r.key);
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(`${r.scope}/${r.id}`);
    }

    /* ---- 自证：遍历有没有漏掉作用域 ---- */
    console.log("\n=== 各作用域读到的键位条数（★ 自证：为 0 说明遍历又漏了一层）===");
    for (const [scope, n] of Object.entries(dump.rawCounts)) {
        const got = dump.scopes[scope].length;
        console.log(`  ${scope.padEnd(12)} 原始条目 ${String(n).padStart(3)}  读到键位 ${String(got).padStart(3)}${got === 0 && n > 0 ? "   ★★ 一条都没读到 —— 遍历漏了！" : ""}`);
    }

    console.log(`\n=== 思源内置命令已绑定 ${dump.rows.length} 条，去重后 ${byKey.size} 个键位 ===\n`);
    const sorted = [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [k, ids] of sorted) {
        const dup = ids.length > 1 ? "  ⚠️ 同键多命令" : "";
        console.log(`  ${k.padEnd(12)}  ${ids.join(", ")}${dup}`);
    }

    console.log(`\n=== 插件声明的键位（${dump.plugins.length} 条）===\n`);
    for (const p of dump.plugins) {
        console.log(`  ${norm(p.key).padEnd(12)}  ${p.plugin} / ${p.id}`);
    }

    /* ★ 自证：本插件**自己**的键位必须在里面。 */
    const ours = dump.plugins.filter((p) => p.plugin === "siyuan-plugin-mindmap");
    console.log(`\n=== ★ 本插件（siyuan-plugin-mindmap）注册到的键位：${ours.length} 条 ===`);
    for (const p of ours) console.log(`  ${norm(p.key).padEnd(12)}  ${p.id}`);
    if (ours.length === 0) {
        console.error("\n✘ 本插件在 keymap.plugin 里一条都没有 —— 热键根本没注册上，");
        console.error("  这本身就是「按了没反应」的原因之一（与 OS/IME 拦截是两回事）。");
        process.exitCode = 1;
    }

    /* ---- 逐个候选查占用（内置 + 其它插件）---- */
    const pluginByKey = new Map();
    for (const p of dump.plugins) {
        const k = norm(p.key);
        if (!pluginByKey.has(k)) pluginByKey.set(k, []);
        pluginByKey.get(k).push(`${p.plugin}/${p.id}`);
    }
    const CANDIDATES = [
        /* 曾经的默认值：被 Windows / 输入法层吃掉（见文件头注释） */
        "⌘ ", "⌥ ",
        /* 更早的默认值（当时判为可用） */
        "⌥⌘D", "⌥⌘V",
        /* 当前默认值 */
        "⇧⌘D", "⇧⌘X",
        /* ★ 反面样本：显示空闲但投递层到不了冒泡 / 被编辑器抢走 */
        "⇧⌘B", "⇧⌘S", "⇧⌘A", "⇧⌘C", "⇧⌘E", "⇧⌘H", "⇧⌘K", "⇧⌘L", "⇧⌘N",
        /* 备选 */
        "⌥⇧D", "⌥⇧B", "⌥⇧M",
        "⌥D", "⌥S", "⌥M",
        "⌘D", "⌘S", "⌥1", "⌥2",
    ];
    console.log("\n=== 候选键位在思源侧是否已被占用（内置 + 其它插件）===\n");
    for (const c of CANDIDATES) {
        const k = norm(c);
        const hit = [...(byKey.get(k) || []), ...(pluginByKey.get(k) || [])];
        console.log(`  ${k.padEnd(10)}  ${hit.length ? "✗ 已被占用  " + hit.join(", ") : "✓ 空闲"}`);
    }

    /* ---- ★ 全表普查：`⇧⌘<A–Z>` 哪些真的空闲 ----
       这才是「选键位」真正要用的那张表。上一版因为遍历漏了 editor.*，
       这张表会把 B / S 这类被编辑器占着的字母报成空闲。 */
    console.log("\n=== ★ 普查：⇧⌘<A–Z> 在思源侧是否空闲 ===\n");
    const free = [];
    const taken = [];
    for (let i = 0; i < 26; i++) {
        const ch = String.fromCharCode(65 + i);
        const k = "⇧⌘" + ch;
        const hit = [...(byKey.get(k) || []), ...(pluginByKey.get(k) || [])];
        if (hit.length) taken.push(`${ch}(${hit.map((h) => h.split("/").pop()).join(",")})`);
        else free.push(ch);
    }
    console.log(`  ✓ 空闲 ${free.length} 个：${free.join(" ")}`);
    console.log(`  ✗ 已占 ${taken.length} 个：${taken.join(" ")}`);
    console.log("\n  注：这只是「占用」这道关。还要过 `probe:hotkeydelivery` 那道投递关");
    console.log("      （事件到不到得了 document 冒泡）—— 两道都过才算能用。\n");
} finally {
    await chrome.close();
}
