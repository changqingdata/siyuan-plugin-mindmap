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
 * ## ★★ 为什么会有这个探针：默认快捷键「不触发」的完整结论
 *
 * 起因：默认键位从 `⌥⌘D` / `⌥⌘V` 改成 `⌘空格` / `⌥空格` 之后，用户报「按了没反应」。
 *
 * 四层逐层排查的结论（每一层都有实测证据，不是推断）：
 *
 * | 层 | 结论 | 证据 |
 * | --- | --- | --- |
 * | ① Windows / 输入法 | **两个键都被吃掉** | `ChsIME.exe`（微软拼音）在跑；`Ctrl+空格` 是它「中/英文模式切换」的默认键；`Alt+空格` 是 Windows 窗口系统菜单，由系统窗口过程消费 |
 * | ② Chromium 分发 | —— | 活过①的键才到这儿 |
 * | ③ 思源 keymap | **两个键都空闲** | 本探针 dump：30 条内置 + 22 条插件键位，无一条占用 |
 * | ④ 插件命令 | **接线正常** | 前端源码 `E()` 的判据是「带 `⌃`/`⌥`/`⌘` 就放行」，两个键都被接受；`diag-commands.mjs` 合成按键能触发 |
 *
 * ⇒ **冲突不在思源、也不在插件，在最外层的 OS/IME。**
 *
 * ### ⚠️ 为什么之前 71 条断言全绿却没抓到
 *
 * `diag-commands.mjs` 用 CDP 的 `Input.dispatchKeyEvent` 派发**合成**按键，
 * 它从渲染层注入，**绕过输入法与系统窗口过程**。所以这类测试
 * **在原理上就抓不到 OS/IME 层的拦截** —— 不是断言写少了，是测量手段够不着那一层。
 * （同族：无头浏览器复现不了 GPU 合成问题。）
 *
 * ### ⚠️ 还有一个「有时灵、有时不灵」的陷阱
 *
 * `Ctrl+空格` 只在**输入法处于活动状态**时被吞。纯英文输入状态 / 没装中文输入法时，
 * 它可能反而能触发。所以这类 bug 很容易被误判成「偶发」或「插件不稳」。
 *
 * ### ✅ 选默认键位时的检查清单（本项目踩过之后总结）
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
 * | `Ctrl+Alt+字母` | 某些欧洲键盘布局上 AltGr = Ctrl+Alt，会打出字符（中文美式布局不受影响） |
 * | `⌥字母` | 思源自己用了 `⌥M`（切窗口）/ `⌥P`（设置）/ `⌥1`~`⌥9`（各停靠栏） |
 *
 * 当前默认值 **`⇧⌘D`（切换导图 / 大纲）+ `⇧⌘B`（并排打开）**：
 * 实测思源侧空闲、不在任何系统保留族里、不含 Ctrl 所以不撞 AltGr。
 * 唯一的残余风险是「松开 `Ctrl+Shift` 的瞬间可能被 IME 判成切换语言」——
 * 换绑定或改输入法的语言切换键即可。
 *
 * ### ⚠️⚠️ 但「思源侧空闲」只是**两道关里的一道**
 *
 * 这个探针只回答第③层。第①层（OS/IME）它看不到 —— 那层的结论在下面。
 * 而**第②层的「思源编辑器」也有一票否决权**，本探针同样看不到：
 *
 * 思源的全局快捷键匹配器挂在 `document` **冒泡阶段**，而 `Ctrl+S` 那一族是
 * **Protyle（编辑器）自己的处理范围**，它在路上 `stopPropagation()` ——
 * 事件到得了捕获、到不了冒泡，匹配器根本收不到。
 *
 * 实测：`⇧⌘S` 在**思源 keymap 里是空闲的**（本探针显示 ✓），但真机按下去毫无反应。
 * 所以**「本探针显示空闲」≠「这个键能用」** —— 还得过 `probe-hotkey-delivery.mjs`
 * 那道投递层检查（它扫过 14 个安全候选，`⇧⌘S` 是唯一到不了冒泡的）。
 *
 * **两道关都过，才算能用的候选。**
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
       差一点被误读成「插件根本没注册热键」。
       所以这里等到「插件条目数稳定」为止，并且下面会**显式报告本插件在不在**。 */
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
        for (const [scope, val] of Object.entries(km)) {
            if (scope === 'plugin') continue;
            if (!val || typeof val !== 'object') continue;
            for (const [id, v] of Object.entries(val)) {
                const k = eff(v);
                if (k) rows.push({ scope, id, key: k });
            }
        }
        const plugins = [];
        for (const [name, cmds] of Object.entries(km.plugin || {})) {
            for (const [id, v] of Object.entries(cmds || {})) {
                const k = eff(v);
                if (k) plugins.push({ plugin: name, id, key: k });
            }
        }
        return { rows, plugins };
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

    /* ★ 自证：本插件**自己**的键位必须在里面。
       没有这条，上面那张表看起来一切正常，但可能压根没包含被测对象 ——
       「探针不会红，只会给出过时的结论」。 */
    const ours = dump.plugins.filter((p) => p.plugin === "siyuan-plugin-mindmap");
    console.log(`\n=== ★ 本插件（siyuan-plugin-mindmap）注册到的键位：${ours.length} 条 ===`);
    for (const p of ours) console.log(`  ${norm(p.key).padEnd(12)}  ${p.id}`);
    if (ours.length === 0) {
        console.error("\n✘ 本插件在 keymap.plugin 里一条都没有 —— 热键根本没注册上，");
        console.error("  这本身就是「按了没反应」的原因之一（与 OS/IME 拦截是两回事）。");
        process.exitCode = 1;
    }

    /* 与本插件候选键位的冲突检查 —— 判据是「思源侧有没有人占」。
       ⚠️ 这只过了一半：`⇧⌘S` 在这里显示 ✓ 空闲，但**真机按不动**
       （被 Protyle 截断传播，见文件头）。要判「能不能用」得再跑
       `probe-hotkey-delivery.mjs` 看投递层。 */
    const CANDIDATES = [
        /* 曾经的默认值：被 Windows / 输入法层吃掉（见文件头注释） */
        "⌘ ", "⌥ ",
        /* 更早的默认值 */
        "⌥⌘D", "⌥⌘V",
        /* 当前默认值 */
        "⇧⌘D", "⇧⌘B",
        /* ★ 反面样本：这里显示空闲，但投递层到不了冒泡 —— 真机不触发 */
        "⇧⌘S",
        /* 备选 */
        "⌥⇧D", "⌥⇧B", "⌥⇧M",
        "⌥D", "⌥S", "⌥M",
        "⌘D", "⌘S", "⌥1", "⌥2",
    ];
    console.log("\n=== 候选键位在思源侧是否已被占用 ===\n");
    for (const c of CANDIDATES) {
        const hit = byKey.get(norm(c)) || [];
        const taken = hit.length > 0;
        console.log(`  ${norm(c).padEnd(10)}  ${taken ? "✗ 已被占用  " + hit.join(", ") : "✓ 空闲"}`);
    }
    console.log();
} finally {
    await chrome.close();
}
