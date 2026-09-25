import { Dialog, Menu, Plugin, Setting, openTab, showMessage } from "siyuan";
import type { IMenu, subMenu } from "siyuan";

import { ATTR_LEGACY_VIEW, ATTR_VIEW, DEFAULT_CONFIG } from "./types";
import type { MMConfig, MMLayout, MMThemeId, MMEdgeStyle, MMCanvasHeightMode } from "./types";
import { Scanner } from "./core/scanner";
import { MindMapView } from "./core/renderer";
import { copyText, getKernelVersion, searchDocOutline, setBlockAttrs } from "./utils/api";
import { isMacPlatform, readableHotkey } from "./utils/hotkey";
import { formatNotes, installDiagnostics, stamp } from "./core/diagnostics";
import { THEME_LIST } from "./core/theme";
import { SHORTCUT_FALLBACK, SHORTCUT_GROUPS } from "./core/shortcuts";
import { layoutSettingTabs } from "./core/settings-tabs";
import type { SetGroupId, SetTabMeta } from "./core/settings-tabs";

/**
 * 两条全局命令的默认键位，用**思源自己的表示法**（macOS 字形，与 `conf.json` 一致）。
 *
 * ⚠️ 声明（`addCommand` 的 `hotkey`）与说明文字（快捷键速查）必须**共用这两个常量**。
 * 分开写迟早会漂移：改了绑定忘了改说明，用户按文档去按、按不动。
 *
 * ## ★★ 一个按键从手指到插件，要过**五道关**，任何一道都能静默吃掉它
 *
 *   ① **Windows / 输入法**（`ChsIME.exe`、微软拼音、搜狗…）
 *   ② **Chromium / Electron**（`hotKey2Electron` 注册的全局快捷键）
 *   ③ **思源编辑器 Protyle**（它自己的 `Ctrl+S/P/W/R` 一族处理）
 *   ④ **思源前端 keymap 匹配器**（`matchHotKey`，挂在 `document` **冒泡**阶段）
 *   ⑤ **插件命令执行**（本插件的 `addCommand` 回调）
 *
 * 「按了没反应」必须**逐层量**，不能猜 —— 两支现成的探针：
 *  · `npm run probe:keymapdump`   → 量 ④（键位有没有被思源别的功能占用）
 *  · `npm run probe:hotkeydelivery` → 量 ③（事件到底有没有活着走到 `document` 冒泡）
 *
 * ## ★★ 键位改过三轮，两次都死在「看不见的层」
 *
 * | 版本 | 键位 | 死在哪一层 | 症状 |
 * |---|---|---|---|
 * | 1 | `⌥⌘D` / `⌥⌘V` | —— 可用 | 但 `⌥⌘X` 命名空间被别的插件挤，容易撞 |
 * | 2 | `⌘空格` / `⌥空格` | **① OS / IME** | 设置里显示绑上了，真机按不动 |
 * | 3 | `⇧⌘D` / `⇧⌘S` | **③ Protyle**（只 `S`） | `⇧⌘S` 设置里显示 ✓ 空闲，真机按不动 |
 * | 4 | `⇧⌘D` / `⇧⌘B` | 当前 | —— |
 *
 * **第 ② 轮的死因**：`Ctrl + 空格` 是**中文输入法切换中英文**的默认热键（微软拼音 / 搜狗），
 * 输入法在系统层就把它截走了；`Alt + 空格` 是 **Windows 的窗口系统菜单**快捷键。
 * 两者都在「设置 → 快捷键」里可改，但那已经是**让用户替你擦屁股**了，不适合当默认值。
 *
 * **第 ③ 轮的死因（更隐蔽）**：思源的全局匹配器挂在 `document` 的**冒泡**阶段，
 * 而 `Ctrl+S` / `P` / `W` / `R` 这一族是 **Protyle（编辑器）自己的处理范围** ——
 * 它在事件上浮的路上直接 `stopPropagation()`，匹配器**根本收不到**。
 * 实测对照（同一次派发，只换主键）：
 *
 * | 按键 | 到 document 捕获 | 到 document 冒泡 | 结果 |
 * |---|---|---|---|
 * | `⇧⌘D` | ✓ | **✓** | 导图正常切换 |
 * | `⇧⌘S` | ✓ | **✗** | 毫无反应 |
 *
 * ⚠️ **只在光标位于编辑器内时失效**（焦点在文档树 / 标签栏等别处时又能用）
 * —— 又一个「有时灵、有时不灵」，所以只靠手动试是试不出来的。
 *
 * ## ★★ 两道门都要过：「空闲」≠「能用」
 *
 * `⇧⌘S` 在 `keymap` 里查出来是 **✓ 空闲**（没人占用，第 ④ 道门通过），
 * 却真机按不动（第 ③ 道门不通过）。
 * ⇒ **别把「设置 → 快捷键 里没冲突」当成「这个键能用」的证据。**
 *
 * ## 为什么是 `⇧⌘B`
 *
 * `B` = **B**eside（并排）。`⇧⌘<A–Z>` 里除 `S` 外的安全候选
 * （`A B C E H I J K L M O V X Z`）经普查**全部**能活着走到 `document` 冒泡。
 * 挑 `B` 是兼顾「好记」与「不撞系统快捷键」。
 *
 * ⚠️ **别盲扫 A–Z**：`⇧⌘W`（关标签页）/ `⇧⌘N`（新建窗口）/ `⇧⌘R`（重载）
 * 会把这一页搞没，抛 `Session with given id not found`。
 *
 * ⚠️ **键位合法性**：思源会过滤插件声明的键位（`ignoredHotkeys`），
 * 判据是含 `⌃`/`⌥`/`⌘` 前缀的**一律放行**，不含修饰键的裸单字符（如 `D`）才会被清空。
 *
 * ⚠️ **导图有焦点时按 `⇧⌘D` 不能变成「复制节点」** —— 见 `renderer.ts` 的
 * `modLetter` 判据（字母类快捷键额外排除 Shift）。这是第 1 轮 `⌥⌘D` 就踩过的坑。
 */
const HOTKEY_TOGGLE = "⇧⌘D";
const HOTKEY_SIDE = "⇧⌘B";

const LAYOUT_OPTIONS: Record<MMLayout, string> = {
    logic: "逻辑结构图",
    mind: "思维导图",
    tree: "树状图",
};

const EDGE_OPTIONS: Record<MMEdgeStyle, string> = {
    curve: "曲线（圆角汇聚）",
    elbow: "直角折线",
    straight: "直线",
};

/*
 * 快捷键速查的**数据**搬去了 `core/shortcuts.ts`。
 *
 * 老实现是这里的 `SHORTCUT_HELP`：12 条长句，每句把一组键位用 ` · ` 串起来，
 * 再拿 `showMessage` 弹一条 12 秒的通知。那条通知有三个毛病叠在一起 ——
 * 会自己消失、一条长句读不出「哪个键对应哪个作用」、换行位置取决于窗口宽度。
 * 现在改成「分组 + 行」的数据结构，由 `openShortcutHelp()` 渲染成表格对话框。
 */

/** 从块菜单点击到的元素反推出所属的列表块 */
function resolveListBlock(el: HTMLElement | undefined): HTMLElement | null {
    if (!el) return null;
    if (el.classList.contains("list")) return el;
    const li = el.closest<HTMLElement>(".li");
    if (li) {
        const list = li.closest<HTMLElement>(".list");
        if (list) return list;
    }
    // 段落等内部元素：往上找最近的列表块
    return el.closest<HTMLElement>(".list");
}

/**
 * 从内层子列表一路往上找到最外层的那个 `.list`。
 *
 * 嵌套子列表（`.list > .li > .list`）在内层也有 `data-node-id`，
 * 但扫描器明确跳过了嵌套列表（它随父列表一起渲染），命令面板如果拿到内层，
 * 就会给一个永远不会被渲染的块打上标记。
 */
function outermostList(start: HTMLElement | null): HTMLElement | null {
    let list = start?.closest?.(".list") as HTMLElement | null;
    if (!list) return null;
    for (;;) {
        const up = list.parentElement?.parentElement?.closest?.(".list") as HTMLElement | null;
        if (!up || up === list) break;
        list = up;
    }
    return list;
}

/**
 * 转义要拼进 `innerHTML` 的文本。
 *
 * 现在只有「快捷键速查」对话框在拼 HTML（思源 `Dialog` 的 `content` 只收字符串）。
 * 内容全部来自我们自己的词表，理论上没有注入面 —— 但词表是可以被**翻译者**
 * 改的，而 `&` `<` `>` 在译文里完全合法（比如「上一级 < 下一级」）。
 * 不转义的话，一句译文就能把对话框结构拆掉。
 */
function escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 下一帧再执行。用于「等思源把设置面板渲染出来」这类**必须重试**的场合。
 *
 * 包一层而不是直接写 `requestAnimationFrame`：单测跑在 `tests/run.mjs` 的
 * 极简 DOM 模拟里，那里没有 `window` / `requestAnimationFrame`。虽然测试不会
 * 走到 `openSetting()`，但**引用一个不存在的全局**在打包后是运行时才炸的坑，
 * 留个兜底比事后排查便宜。
 */
function nextFrame(fn: () => void): void {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => fn());
    else setTimeout(fn, 16);
}

export default class MindMapPlugin extends Plugin {
    private config: MMConfig = { ...DEFAULT_CONFIG };
    private scanner!: Scanner;
    private dialog: Dialog | null = null;
    /** 「查看快捷键」的对话框。它是只读的，但同样要在卸载时销毁 */
    private helpDialog: Dialog | null = null;
    private sidePanel: HTMLElement | null = null;
    private sideView: MindMapView | null = null;

    /* ================================================================ 生命周期 */

    async onload() {
        // 最早装：这样「插件启动过程中出的问题」也能被记下来。
        // 它只是给 console.warn / error 套一层转发，不拦截、不改写。
        installDiagnostics();

        const saved = await this.loadData("config");
        if (saved && typeof saved === "object") {
            this.config = { ...DEFAULT_CONFIG, ...saved };
        }

        this.scanner = new Scanner({
            getOptions: () => this.config,
            onLayoutChange: (listId, layout) => this.persistLayout(listId, layout),
            onFullscreen: (listId, _root, _theme, title) => this.openFullscreen(listId, title),
            openBlock: (id) => this.openBlockTab(id),
            onSideLost: () => this.closeSide(),
            // 把词表交给扫描器，由它透传给每个视图（视图内的布局名 / 导出菜单用它）
            i18n: this.i18n,
        });

        this.registerBlockMenu();
        this.registerCommands();
        this.registerTopBar();
    }

    onLayoutReady() {
        this.scanner.start();
    }

    onunload() {
        this.scanner?.stop();
        this.closeSide();
        this.dialog?.destroy();
        this.dialog = null;
        this.helpDialog?.destroy();
        this.helpDialog = null;
    }

    /* ================================================================ 块菜单 */

    private registerBlockMenu() {
        this.eventBus.on("click-blockicon", ({ detail }) => {
            const list = resolveListBlock(detail.blockElements?.[0]);
            this.buildBlockMenu(detail.menu, list);
        });
    }

    /* ================================================================ 命令 */

    private registerCommands() {
        this.addCommand({
            langKey: "migrateLegacy",
            // 一次性维护命令，故意**不绑默认键** —— 一辈子用一次的东西占一个全局组合
            // 只会让别人误触，它在设置面板里也有按钮。
            hotkey: "",
            callback: () => void this.runMigration(),
        });
        // 入口之二：命令面板。列表块图标是「我知道有这个功能」之后才好用的入口，
        // 而命令面板（Ctrl+P）是「我想做这件事」时的入口 —— 而且可以绑快捷键。
        //
        // 默认键挑的是实测**没被占用**的 `⌥⌘` 组合（对照工作空间 conf.json 的 keymap
        // 全表筛过：⌥⌘M 被「插入备注」占了、⌥⌘L / ⌥⌘P / ⌥⌘N / ⌥⌘O 分别被 flowmind、
        // 魔法排版、插件索引占了）。用户在「设置 → 快捷键」里随时能改。
        //
        // ⚠️ 键位值取的是上面的常量 —— 快捷键速查里那段说明也读同一份，
        // 改了绑定说明文字跟着变，不会出现「文档写一个、实际绑另一个」。
        this.addCommand({
            langKey: "toggleMindMap",
            hotkey: HOTKEY_TOGGLE,
            callback: () => void this.toggleMindMap(),
        });
        this.addCommand({
            langKey: "toggleSidePanel",
            hotkey: HOTKEY_SIDE,
            callback: () => this.toggleSide(),
        });
    }

    /**
     * i18n 取值入口。取不到就回退到内置中文 —— 缺词表时行为与以前**完全一致**。
     *
     * 与 `renderer.ts` 里的同名方法同源，存在理由也一样：把取值收成一个入口，
     * 而不是让 `this.i18n.x || "中文"` 散落到几十处 —— 散着写迟早会出现
     * 「词表里有键、代码里读错名字」，而中文环境下这种错误**看不出来**
     * （fallback 和词表值同值，界面照样是中文）。
     */
    private t(key: string, fallback: string, vars?: Record<string, string | number>): string {
        const v = this.i18n?.[key];
        let s = typeof v === "string" && v ? v : fallback;
        if (vars) for (const [k, val] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(val));
        return s;
    }

    /**
     * 把「值 → 内置中文」的常量表翻成「值 → 当前语言」。
     * 设置面板的下拉框要的是 `Record<value, label>`，直接传中文表会让英文界面露出中文。
     */
    private localize(map: Record<string, string>, prefix: string): Record<string, string> {
        return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, this.t(`${prefix}.${k}`, v)]));
    }

    /**
     * 「查看快捷键」—— 弹一个**分组表格**对话框。
     *
     * ## 为什么不再用通知
     *
     * 老实现是 `showMessage(shortcutHelp(), 12000)`：一条 12 秒后自己消失的通知，
     * 四十多个键位挤在 12 条长句里。三个问题叠在一起：
     *
     *  1. **会自己消失** —— 用户想对着按的时候通知已经没了；
     *  2. **一条长句读不出「哪个键对应哪个作用」** ——
     *     `↑↓ 同级 · ← 父节点 · → 第一个子节点` 里分隔符和键位混在一起；
     *  3. **换行位置取决于窗口宽度** —— 折在哪跟语义无关。
     *
     * 现在渲染成「分组标题 + 每行『键位 | 作用』两列」。键位单独成列、等宽字体，
     * 扫一眼就能定位。
     *
     * ⚠️ 键位里的空格走 `{space}` 占位符：思源表示法里它就是**一个字面空格**
     * （`KEYCODELIST[32] = " "`），直接拼出来会变成看不见的 `Ctrl+ `。
     * 详见 `utils/hotkey.ts` 的 `readableHotkey`。
     */
    private openShortcutHelp() {
        const isMac = isMacPlatform();
        const space = this.t("key.space", "空格");
        const vars: Record<string, string> = {
            space,
            toggle: readableHotkey(HOTKEY_TOGGLE, isMac, space),
            side: readableHotkey(HOTKEY_SIDE, isMac, space),
        };
        const fill = (s: string) => {
            let out = s;
            for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
            return out;
        };
        /** 取词：词表优先，取不到退回 `SHORTCUT_KEYS` 里的中文兜底 */
        const tr = (key: string) => this.t(key, SHORTCUT_FALLBACK[key] ?? key);

        const groups = SHORTCUT_GROUPS.map((g) => {
            const rows = g.rows
                .map((r) => {
                    const label = fill(r.k);
                    // 没有键位的行（点复选框 / 工具条按钮 / 右键菜单）——
                    // 留空会让人以为「这里漏了」，所以显式写「菜单操作」并置灰。
                    const keyCell = label
                        ? `<kbd class="mm-sc__key">${escHtml(label)}</kbd>`
                        : `<kbd class="mm-sc__key mm-sc__key--none">${escHtml(tr("sc.none"))}</kbd>`;
                    return `<div class="mm-sc__row">${keyCell}<div class="mm-sc__what">${escHtml(tr(r.d))}</div></div>`;
                })
                .join("");
            const note = g.note ? `<span class="mm-sc__note">${escHtml(tr(g.note))}</span>` : "";
            return `<section class="mm-sc__group">
    <div class="mm-sc__head">${escHtml(tr(g.t))}${note}</div>
    <div class="mm-sc__rows">${rows}</div>
</section>`;
        }).join("");

        const dialog = new Dialog({
            // ⚠️ 这里**故意不用模板串**：`i18n-audit.mjs` 是按 TS AST 扫的，一个
            // TemplateExpression 只要整体含汉字就整条报「没接 i18n」—— 哪怕汉字
            // 只是 `t()` 的兜底值（`${t("k", "中文")}` 这种写法照样报）。
            // 用 `+` 拼就没有这个假阳性，`t()` 里的兜底值也仍会被归到 dev 类。
            title: this.t("pluginName", "大纲导图") + " · " + tr("sc.dlgTitle"),
            content: `<div class="b3-dialog__content mm-sc">
    <div class="mm-sc__hint">${escHtml(tr("sc.dlgHint"))}</div>
    <div class="mm-sc__legend"><span>${escHtml(tr("sc.colKey"))}</span><span>${escHtml(tr("sc.colWhat"))}</span></div>
    ${groups}
</div>`,
            width: "680px",
            height: "80vh",
        });
        // 快捷键速查是**只读**的：没有确认/取消语义，关掉就是关掉。
        // 这里只是把它记下来，便于 `onunload` 时统一销毁（否则卸载后对话框会留在页面上）。
        this.helpDialog?.destroy();
        this.helpDialog = dialog;
    }

    /* ================================================================ 顶栏入口 */

    /**
     * 顶栏图标 —— 第三个入口。
     *
     * 前两个入口各有「够不着」的时候：块图标要先把鼠标移到块标上，命令面板要记得
     * 有这条命令。顶栏是常驻的，点开又是一个菜单，正好补上「我想对当前这页做点什么、
     * 但还没想好具体做哪一件」这个空档 —— 尤其是「本页列表全部转成导图」这种
     * 一次作用一大片的操作，塞进块菜单反而别扭。
     */
    private registerTopBar() {
        let anchor: HTMLElement | null = null;
        anchor = this.addTopBar({
            icon: "iconListTree",
            title: this.t("pluginName", "大纲导图"),
            position: "right",
            callback: () => {
                if (anchor) this.openTopBarMenu(anchor);
            },
        });
    }

    private openTopBarMenu(anchor: HTMLElement) {
        const menu = new Menu("mm-topbar-menu");
        const list = this.targetList();
        const on = !!list?.getAttribute(ATTR_VIEW);
        const docLists = this.docLists();
        const pending = docLists.filter((el) => !el.getAttribute(ATTR_VIEW));
        const active = docLists.filter((el) => !!el.getAttribute(ATTR_VIEW));

        menu.addItem({
            icon: "iconList",
            label: on ? this.t("menu.currentToOutline", "当前列表：切回大纲视图") : this.t("menu.currentToMap", "当前列表：转为导图"),
            disabled: !list,
            click: () => void this.toggleMindMap(),
        });
        menu.addItem({
            icon: "iconLayoutRight",
            label: this.t("ui.sideBySide", "并排查看（大纲 + 导图）"),
            disabled: !list,
            click: () => this.toggleSide(),
        });

        menu.addItem({ type: "separator" });

        menu.addItem({
            icon: "iconListTree",
            label: pending.length > 0 ? this.t("menu.pageToMapN", "本页列表：全部转为导图（{n} 个）", { n: pending.length }) : this.t("menu.pageToMap", "本页列表：全部转为导图"),
            disabled: pending.length === 0,
            click: () => void this.convertDocLists(pending, true),
        });
        menu.addItem({
            icon: "iconList",
            label: active.length > 0 ? this.t("menu.pageToOutlineN", "本页列表：全部切回大纲（{n} 个）", { n: active.length }) : this.t("menu.pageToOutline", "本页列表：全部切回大纲"),
            disabled: active.length === 0,
            click: () => void this.convertDocLists(active, false),
        });

        menu.addItem({ type: "separator" });

        menu.addItem({
            icon: "iconSettings",
            label: this.t("ui.settings", "设置"),
            click: () => this.openSetting(),
        });

        menu.open({ x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom });
    }

    /**
     * 当前文档里「适合转成导图」的顶层列表块。
     *
     * 两条过滤都是刻意的：
     *  - **只要顶层** —— 嵌在别的列表项里的子列表本来就已经是父图的一部分，
     *    单独再给它们各挂一张图，同一批内容会在一页里出现两次。
     *  - **至少 3 个列表项** —— 两项的列表转成导图没有任何信息增益，
     *    只会把文档搞花。「本页全部转」这种批量操作更需要这条底线。
     */
    private docLists(): HTMLElement[] {
        const protyle = (this.cursorEl()?.closest?.(".protyle") as HTMLElement | null) ?? document.querySelector<HTMLElement>(".protyle");
        if (!protyle) return [];
        return Array.from(protyle.querySelectorAll<HTMLElement>(".protyle-wysiwyg .list")).filter(
            (el) => !!el.dataset.nodeId && outermostList(el) === el && el.querySelectorAll(":scope > .li").length >= 3,
        );
    }

    /** 批量切换视图。会改一批块属性，所以先确认一次 */
    private async convertDocLists(lists: HTMLElement[], toMap: boolean) {
        if (lists.length === 0) return;
        const what = toMap ? this.t("ui.toMap", "转为导图") : this.t("ui.switchToOutline", "切回大纲视图");
        if (!window.confirm(this.t("dlg.confirmPageLists", "确定把本页这 {n} 个列表{what}？\n（可以随时再切回来）", { n: lists.length, what }))) return;
        for (const el of lists) {
            await this.applyView(el, toMap ? this.config.layout : null);
        }
        showMessage(this.t("msg.pageListsDone", "已把 {n} 个列表{what}", { n: lists.length, what }), 2600);
    }

    /** 光标当前落在哪个元素上（拿不到就退回 activeElement） */
    private cursorEl(): HTMLElement | null {
        const node = window.getSelection()?.anchorNode ?? null;
        const fromSel = node ? (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement) : null;
        if (fromSel) return fromSel;
        const active = document.activeElement;
        return active instanceof HTMLElement ? active : null;
    }

    /**
     * 找出这次操作该作用在哪个列表块。
     *
     * 优先用光标所在的列表块；光标不在列表里（比如刚打开文档）就回退到
     * 当前文档的第一个列表块 —— 命令面板的场景下，「什么都不做只弹一句提示」
     * 比「就近取一个」更让人困惑。
     */
    private targetList(): HTMLElement | null {
        const el = this.cursorEl();
        const fromCursor = outermostList(el);
        if (fromCursor?.dataset.nodeId) return fromCursor;
        const protyle = (el?.closest?.(".protyle") as HTMLElement | null) ?? document.querySelector<HTMLElement>(".protyle");
        return outermostList(protyle?.querySelector<HTMLElement>(".protyle-wysiwyg .list") ?? null);
    }

    /** 命令：把当前列表块转为导图 / 切回大纲视图 */
    private async toggleMindMap() {
        const list = this.targetList();
        const id = list?.dataset.nodeId;
        if (!list || !id) {
            showMessage(this.t("msg.noListBlock", "没找到列表块：把光标放进列表里，或先打开一个含列表的文档"), 4000);
            return;
        }
        const on = !!list.getAttribute(ATTR_VIEW);
        await this.applyView(list, on ? null : this.config.layout);
        showMessage(on ? this.t("msg.switchedToOutline", "已切回大纲视图") : this.t("msg.switchedToMap", "已转为导图"));
    }

    /**
     * 把【自定义块样式】插件的列表导图标记迁移过来。
     * 该插件用 custom-block-list-view="map" 标记列表块，迁移后换成我们的 custom-mindmap。
     */
    private async migrateLegacy(): Promise<number> {
        const lists = Array.from(document.querySelectorAll<HTMLElement>(`.list[${ATTR_LEGACY_VIEW}]`));
        let count = 0;

        for (const list of lists) {
            // 只迁移导图视图，表格 / 看板保持原样
            if (list.getAttribute(ATTR_LEGACY_VIEW) !== "map") continue;
            const id = list.dataset.nodeId;
            if (!id) continue;

            list.setAttribute(ATTR_VIEW, this.config.layout);
            list.removeAttribute(ATTR_LEGACY_VIEW);
            await setBlockAttrs(id, {
                [ATTR_VIEW]: this.config.layout,
                [ATTR_LEGACY_VIEW]: null,
            });
            count++;
        }

        return count;
    }

    private async runMigration() {
        const count = await this.migrateLegacy();
        if (count > 0) {
            showMessage(this.t("msg.migratedN", "已迁移 {n} 个列表块", { n: count }));
            window.setTimeout(() => this.scanner.scanAll(), 150);
        } else {
            showMessage(this.t("msg.migrateNotFound", "没有找到来自【自定义块样式】的导图列表"));
        }
    }

    /**
     * 块图标菜单里的「大纲导图」子菜单 —— **三种模式**，不是「一个大纲 + 三个布局」。
     *
     * ## 为什么把三个布局项从菜单里撤掉
     *
     * 老菜单是「大纲视图 / 逻辑结构图 / 思维导图 / 树状图 / 并排查看」五项平铺 ——
     * 五个选项**不是同一个层级的东西**：第一个是「要不要导图」，后三个是
     * 「导图长什么样」。平铺在一起，用户要先想清楚「我现在是想关掉导图，
     * 还是想换个布局」，而这两件事的入口本该在不同地方。
     *
     * 现在：菜单只回答「要不要导图、要不要并排」；**布局在导图自己的工具条上切换**
     *（`renderer.ts` 的 `buildToolbar()`，`.mm-seg` 那三个按钮）——
     * 那儿才是「导图长什么样」该待的地方，改完立刻看得到效果。
     *
     * ## ⚠️ 「导图模式」在已处于导图模式时**不重设布局**
     *
     * 否则会把手动切到「思维导图 / 树状图」的用户，按一下菜单就被打回默认布局 ——
     * 一个看起来无害、实际会吃掉用户选择的动作。菜单项的 `checked` 已经表达了
     *「你现在就在导图模式」，所以这一项此时只是个状态指示。
     */
    private buildBlockMenu(menu: subMenu, list: HTMLElement | null) {
        const current = list?.getAttribute(ATTR_VIEW) ?? null;
        const disabled = !list;
        const sideOn = !!list && this.scanner.sideListId !== "" && this.scanner.sideListId === list.dataset.nodeId;

        const items: IMenu[] = [
            {
                label: this.t("mode.outline", "大纲模式（关闭导图）"),
                checked: current === null,
                disabled,
                click: () => {
                    if (list) void this.applyView(list, null);
                },
            },
            {
                label: this.t("mode.map", "导图模式"),
                checked: current !== null,
                disabled,
                click: () => {
                    if (list) void this.enterMapMode(list, current);
                },
            },
            {
                label: this.t("mode.side", "并排模式（大纲 + 导图）"),
                checked: sideOn,
                disabled,
                click: () => {
                    if (!list) return;
                    // 点的是同一个块就关掉，否则换到这块
                    if (this.scanner.sideListId === list.dataset.nodeId) this.closeSide();
                    else this.openSide(list);
                },
            },
        ];

        menu.addItem({
            icon: "iconList",
            label: this.t("menuRoot", "大纲导图"),
            type: "submenu",
            submenu: items,
        });
    }

    /**
     * 进入导图模式。
     *
     * 已经在大纲模式（`current === null`）时才落默认布局 ——
     * 默认布局取 `config.layout`（出厂值 `logic`，也就是「逻辑结构图」）。
     * 已在导图模式则**原样返回**，理由见 `buildBlockMenu` 的注释。
     */
    private async enterMapMode(list: HTMLElement, current: string | null) {
        if (current !== null) return;
        await this.applyView(list, this.config.layout);
    }

    private async applyView(list: HTMLElement, layout: MMLayout | null) {
        const id = list.dataset.nodeId;
        if (!id) return;

        if (layout === null) {
            this.scanner.unmount(id);
            list.removeAttribute(ATTR_VIEW);
            await setBlockAttrs(id, { [ATTR_VIEW]: null });
        } else {
            list.setAttribute(ATTR_VIEW, layout);
            await setBlockAttrs(id, { [ATTR_VIEW]: layout });
            window.setTimeout(() => this.scanner.scanAll(), 60);
        }
    }

    private persistLayout(listId: string, layout: MMLayout) {
        const el = document.querySelector<HTMLElement>(`.list[data-node-id="${listId}"]`);
        el?.setAttribute(ATTR_VIEW, layout);
        void setBlockAttrs(listId, { [ATTR_VIEW]: layout });
    }

    /**
     * 打开一个块的页签（导图里 Ctrl+单击双链时用）。
     * 交给思源自己的 openTab，复用它的缩放、光标定位等行为。
     */
    private openBlockTab(id: string) {
        if (!id) return;
        void openTab({ app: this.app, doc: { id, zoomIn: false } }).catch((err) => {
            console.warn("[mindmap] 打开块失败", id, err);
            showMessage(this.t("msg.openFailed", "打开失败，块可能已被删除"), 3000, "error");
        });
    }

    /* ================================================================ 并排面板 */

    private toggleSide() {
        if (this.sidePanel) {
            this.closeSide();
            return;
        }
        const list = this.targetList();
        if (!list) {
            showMessage(this.t("msg.noListBlock", "没找到列表块：把光标放进列表里，或先打开一个含列表的文档"), 4000);
            return;
        }
        this.openSide(list);
    }

    /**
     * 并排面板：左边保留大纲原文，右边浮一块导图，实时联动。
     *
     * 它顺带解决了「双击跳走」的断裂感 —— 想改文字就直接在左边改，
     * 右边立刻跟着变，不用再退出导图、改完、手动回来。
     *
     * 与全屏弹层的两点不同：
     *   1. **不隐藏源列表**（视图以 detached 模式挂到面板里）；
     *   2. **不写 `custom-mindmap` 块属性** —— 它是伴生视图，不该改变这个块的显示模式，
     *      关掉面板之后这个块该是什么还是什么。
     */
    private openSide(list: HTMLElement) {
        const id = list.dataset.nodeId;
        if (!id) return;

        if (list.hasAttribute(ATTR_VIEW)) {
            showMessage(this.t("msg.alreadyInMapMode", "这个列表已经在导图模式了，并排面板是给大纲视图用的"), 3500);
            return;
        }

        this.closeSide();

        const panel = document.createElement("div");
        panel.className = "mm-side";
        panel.setAttribute("contenteditable", "false");

        const grip = document.createElement("div");
        grip.className = "mm-side-grip";
        grip.dataset.mmTip = this.t("ui.dragResize", "拖动调整宽度");

        const head = document.createElement("div");
        head.className = "mm-side-head";
        const titleEl = document.createElement("span");
        titleEl.className = "mm-side-title";
        titleEl.textContent = this.t("ui.sideTitle", "大纲导图 · 并排");
        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "mm-side-close";
        closeBtn.textContent = "✕";
        closeBtn.title = this.t("ui.closeSidePanel", "关闭并排面板");
        closeBtn.onclick = () => this.closeSide();
        head.append(titleEl, closeBtn);

        const body = document.createElement("div");
        body.className = "mm-side-body";

        panel.append(grip, head, body);
        document.body.appendChild(panel);

        const title = document.querySelector<HTMLElement>(".protyle-title")?.textContent?.trim() || this.t("ui.mindMap", "导图");
        const view = new MindMapView(
            list,
            this.config,
            () => this.scanner.foldOverlay(id),
            {
                onFoldChange: (nodeId, folded) => this.scanner.setFold(id, nodeId, folded),
                onLocate: (nodeId) => {
                    const el = document.querySelector<HTMLElement>(`.protyle-wysiwyg [data-node-id="${nodeId}"]`);
                    el?.scrollIntoView({ block: "center", behavior: "smooth" });
                },
                onEditInSource: (node) => this.scanner.editInSource(id, node),
                onOpenBlock: (nodeId) => this.openBlockTab(nodeId),
                onExit: () => this.closeSide(),
                // ⚠️ 并排面板**不写 `custom-mindmap`**（它是伴生视图，不该改变这个块的显示模式）。
                // 所以这里不能挂 persistLayout —— 那会把列表变成导图模式，
                // 于是行内视图也一起挂上来，屏幕上出现两份导图。
                // 布局改到哪儿去了？走 onViewPrefs 存进文档级视图偏好。
                onLayoutChange: () => undefined,
                onFullscreen: () => undefined,
                onRename: (node, text) => void this.scanner.applyRename(node, text, id),
                onNodeAction: (kind, node, extra) => this.scanner.applyAction(kind, node, extra, id),
                onBatchAction: (kind, nodes) => this.scanner.applyBatch(kind, nodes, id),
                onViewPrefs: (prefs) => this.scanner.savePrefs(id, prefs),
                onHistory: (redo) => this.scanner.undo(redo),
                onSearchDoc: (q) => searchDocOutline(id, q),
                onMarkChange: (node, mark) => void this.scanner.applyMark(node, mark, id),
                i18n: this.i18n,
            },
            title,
            "side",
        );
        view.mount(body);
        // 视图偏好是异步读的，挂载那一刻还拿不到；到了之后补一次渲染
        void this.scanner.loadPrefs(id).then((prefs) => {
            view.applyViewPrefs(prefs);
            view.render(true);
        });
        this.scanner.attachSide(id, view);

        this.sidePanel = panel;
        this.sideView = view;

        /* 左边缘拖拽改宽 */
        grip.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startW = panel.getBoundingClientRect().width;
            const move = (ev: MouseEvent) => {
                const next = Math.min(Math.max(startW + (startX - ev.clientX), 320), window.innerWidth - 360);
                panel.style.width = `${next}px`;
            };
            const up = () => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", up);
            };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
        });
    }

    private closeSide() {
        const view = this.sideView;
        if (view) {
            this.scanner.detachSide(view);
            view.destroy();
        }
        this.sideView = null;
        this.sidePanel?.remove();
        this.sidePanel = null;
    }

    /* ================================================================ 全屏查看 */

    private openFullscreen(listId: string, title: string) {
        const listEl = document.querySelector<HTMLElement>(`.list[data-node-id="${listId}"]`);
        if (!listEl) return;

        this.dialog?.destroy();

        let view: MindMapView | null = null;
        const dialog = new Dialog({
            title,
            width: "92vw",
            height: "88vh",
            content: '<div class="mm-dialog-body"></div>',
            destroyCallback: () => {
                if (view) this.scanner.detachFullscreen(view);
                view?.destroy();
                view = null;
                if (this.dialog === dialog) this.dialog = null;
            },
        });

        const body = dialog.element.querySelector<HTMLElement>(".mm-dialog-body");
        if (!body) return;

        view = new MindMapView(
            listEl,
            this.config,
            () => this.scanner.foldOverlay(listId),
            {
                onFoldChange: (nodeId, folded) => this.scanner.setFold(listId, nodeId, folded),
                onLocate: () => undefined,
                // 全屏里没法就地改含格式的节点：先关掉弹层，再把光标送回源列表
                onEditInSource: (node) => {
                    dialog.destroy();
                    this.scanner.editInSource(listId, node);
                },
                onOpenBlock: (nodeId) => this.openBlockTab(nodeId),
                onExit: () => dialog.destroy(),
                onLayoutChange: (layout) => this.persistLayout(listId, layout),
                onFullscreen: () => undefined,
                onRename: (node, text) => void this.scanner.applyRename(node, text, listId),
                onNodeAction: (kind, node, extra) => this.scanner.applyAction(kind, node, extra, listId),
                onBatchAction: (kind, nodes) => this.scanner.applyBatch(kind, nodes, listId),
                onViewPrefs: (prefs) => this.scanner.savePrefs(listId, prefs),
                onHistory: (redo) => this.scanner.undo(redo),
                onSearchDoc: (q) => searchDocOutline(listId, q),
                onMarkChange: (node, mark) => void this.scanner.applyMark(node, mark, listId),
                i18n: this.i18n,
            },
            title,
            "dialog",
        );
        view.mount(body);
        // 全屏看的是同一个列表，视图偏好也共享：全屏里调好的布局 / 缩放
        // 回到行内视图应当保持一致
        void this.scanner.loadPrefs(listId).then((prefs) => {
            view!.applyViewPrefs(prefs);
            view!.render(true);
        });
        // 交给扫描器一起照看：弹层视图不在 .protyle-wysiwyg 里，
        // 不登记的话结构操作后内核变了它也不会重渲染。
        this.scanner.attachFullscreen(listId, view);
        this.dialog = dialog;
    }

    /* ================================================================ 设置面板 */

    openSetting() {
        /**
         * 面板编辑的是一份**草稿**，点「保存」才落到 `this.config`。
         *
         * ## ⚠️ 为什么不能直接写 `this.config`
         *
         * 原来是 `changed: (v) => { this.config.minimap = v; }` —— 直接改真实配置，
         * 而落盘只发生在 `confirmCallback`。实测（`probe-settings-persist.mjs`）后果是：
         *
         * | 操作 | 内存 | 磁盘 | 当前会话行为 | 重启后 |
         * | --- | --- | --- | --- | --- |
         * | 改开关 | 变了 | 没动 | 下次重渲染就生效 | —— |
         * | 点「保存」 | 变了 | 写上了 | 生效 | 保持 ✓ |
         * | 点「取消」 | **还是变的** | 没动 | **下次重渲染仍然生效** | 回退 |
         *
         * 也就是「取消」只取消了**落盘**，没取消**内存改动** ——
         * 用户点了取消，以为没改；过一会儿编辑一下文档，那个开关就悄悄生效了；
         * 再重启又回去。**一个只说了一半真话的按钮。**
         *
         * SiYuan 的 `Setting` 只有 `confirmCallback` / `destroyCallback`，**没有
         * `cancelCallback`**，所以「在取消时回滚」这条路走不通。
         * 改成草稿模型之后，「取消」不需要任何钩子就天然正确：
         * 草稿被丢掉，`this.config` 从头到尾没被碰过。
         *
         * （顺带的好处：面板里的改动不再「半生效」，语义变得干净 ——
         * 要么点保存整体生效，要么点取消整体不生效。）
         */
        const draft: MMConfig = { ...this.config };
        const setting = new Setting({
            // 侧边选项卡要的是「左边一列 + 右边一列」，窄了会把设置项挤成两行。
            // 高度给 vh 而不是固定 px：小屏笔记本上固定 700px 会顶出屏幕。
            height: "70vh",
            width: "760px",
            confirmCallback: () => {
                this.config = { ...draft };
                void this.saveConfig();
                this.scanner.refreshAll();
            },
        });

        /**
         * 每条设置项属于哪一组。**顺序与 `addItem` 的调用顺序严格一一对应** ——
         * `layoutSettingTabs()` 就是靠这个下标把行搬进对应 pane 的。
         *
         * ⚠️ 所以分组是**每个 add* 的第一个参数**、由这里 `push` 进去，而不是
         * 在某个地方写一句 `curGroup = "xxx"` 的隐式状态：漏传参数 TypeScript
         * 当场报错，而漏改状态只会在运行时静默归错组。
         */
        const groupOf: SetGroupId[] = [];

        const addSelect = (
            group: SetGroupId,
            title: string,
            description: string,
            options: Record<string, string>,
            value: string,
            changed: (v: string) => void,
        ) => {
            groupOf.push(group);
            setting.addItem({
                title,
                description,
                createActionElement: () => {
                    const sel = document.createElement("select");
                    sel.className = "b3-select fn__flex-inline";
                    for (const [k, label] of Object.entries(options)) {
                        const opt = document.createElement("option");
                        opt.value = k;
                        opt.textContent = label;
                        sel.appendChild(opt);
                    }
                    sel.value = value;
                    sel.onchange = () => changed(sel.value);
                    return sel;
                },
            });
        };

        const addToggle = (
            group: SetGroupId,
            title: string,
            description: string,
            value: boolean,
            changed: (v: boolean) => void,
        ) => {
            groupOf.push(group);
            setting.addItem({
                title,
                description,
                createActionElement: () => {
                    const box = document.createElement("input");
                    box.type = "checkbox";
                    box.className = "b3-switch fn__flex-inline";
                    box.checked = value;
                    box.onchange = () => changed(box.checked);
                    return box;
                },
            });
        };

        /** 纯说明条目（没有可操作的控件）—— 用于交代「这个行为已经由内核保证，不需要你选」 */
        const addHint = (group: SetGroupId, title: string, description: string) => {
            groupOf.push(group);
            setting.addItem({
                title,
                description,
                createActionElement: () => {
                    const box = document.createElement("span");
                    box.className = "b3-label__text fn__size200";
                    box.textContent = this.t("msg.synced", "已同步");
                    return box;
                },
            });
        };

        const addNumber = (
            group: SetGroupId,
            title: string,
            description: string,
            value: number,
            min: number,
            max: number,
            changed: (v: number) => void,
        ) => {
            groupOf.push(group);
            setting.addItem({
                title,
                description,
                createActionElement: () => {
                    const input = document.createElement("input");
                    input.type = "number";
                    input.className = "b3-text-field fn__size200";
                    input.min = String(min);
                    input.max = String(max);
                    input.step = "1";
                    input.value = String(value);
                    input.onchange = () => {
                        const n = Number.parseInt(input.value, 10);
                        if (Number.isFinite(n)) {
                            const clamped = Math.min(Math.max(n, min), max);
                            input.value = String(clamped);
                            changed(clamped);
                        }
                    };
                    return input;
                },
            });
        };

        const addText = (
            group: SetGroupId,
            title: string,
            description: string,
            value: string,
            changed: (v: string) => void,
        ) => {
            groupOf.push(group);
            setting.addItem({
                title,
                description,
                createActionElement: () => {
                    const input = document.createElement("input");
                    input.type = "text";
                    input.className = "b3-text-field fn__size200";
                    input.value = value;
                    input.placeholder = this.t("set.colorExample", "例如 #4c8dff,#ff7a45,#52c41a");
                    input.onchange = () => changed(input.value.trim());
                    return input;
                },
            });
        };

        /**
         * 右侧是按钮的设置项。
         *
         * 原来「查看快捷键」「复制诊断信息」「迁移」三处各写一遍同样的
         * `addItem({ …, createActionElement: () => { const btn = … } })` ——
         * 三份逐字重复的样板，只有文案和回调不同。收成一个之后，分组参数
         * 也只需要在一处维护。
         */
        const addButton = (
            group: SetGroupId,
            title: string,
            description: string,
            label: string,
            onclick: (btn: HTMLButtonElement) => void,
        ) => {
            groupOf.push(group);
            setting.addItem({
                title,
                description,
                createActionElement: () => {
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "b3-button b3-button--outline fn__size200";
                    btn.textContent = label;
                    btn.onclick = () => onclick(btn);
                    return btn;
                },
            });
        };

        /**
         * 选项卡定义。文案在这里用 `this.t()` 就地取 —— 不放进常量表，
         * 是因为 `scripts/i18n-keys.mjs` 扫的是**代码里的 `t()` 调用**，
         * 放进表里就得再加一套读取器，而这里只有 5 条。
         */
        const tabs: SetTabMeta[] = [
            {
                id: "appearance",
                title: this.t("set.tabAppearance", "外观"),
                desc: this.t("set.tabAppearanceDesc", "主题、配色、连线与布局 —— 决定导图长什么样。"),
            },
            {
                id: "canvas",
                title: this.t("set.tabCanvas", "画布"),
                desc: this.t("set.tabCanvasDesc", "画布多高、要不要自适应、小地图怎么显示。"),
            },
            {
                id: "interact",
                title: this.t("set.tabInteract", "交互"),
                desc: this.t("set.tabInteractDesc", "鼠标与键盘怎么操作导图，以及视图偏好记在哪。"),
            },
            {
                id: "perf",
                title: this.t("set.tabPerf", "性能"),
                desc: this.t("set.tabPerfDesc", "节点很多时的渲染策略与上限。"),
            },
            {
                id: "help",
                title: this.t("set.tabHelp", "帮助"),
                desc: this.t("set.tabHelpDesc", "快捷键速查、诊断信息与迁移工具。"),
            },
        ];

        /* ════════════════════════════════════════════════ 外观
         *
         * 这一组回答「导图长什么样」：配色、连线、布局、编号。
         * 顺序即选项卡里的顺序 —— 由「最常改的」排到「偶尔才动的」。 */

        addSelect(
            "appearance",
            this.t("ui.theme", "主题"),
            this.t("set.themeDesc", "「跟随思源」会使用思源当前配色，其余为内置独立配色"),
            Object.fromEntries(THEME_LIST.map((th) => [th.id, this.t(`theme.${th.id}`, th.name)])),
            this.config.theme,
            (v) => {
                draft.theme = v as MMThemeId;
            },
        );

        addSelect(
            "appearance",
            this.t("set.defaultLayout", "默认布局"),
            this.t("set.defaultLayoutDesc", "在块菜单中启用导图时使用的默认结构"),
            this.localize(LAYOUT_OPTIONS, "layout"),
            this.config.layout,
            (v) => {
                draft.layout = v as MMLayout;
            },
        );

        addSelect(
            "appearance",
            this.t("ui.edgeStyle", "连线样式"),
            this.t("set.edgeStyleDesc", "节点之间的连接线形态"),
            this.localize(EDGE_OPTIONS, "edge"),
            this.config.edge,
            (v) => {
                draft.edge = v as MMEdgeStyle;
            },
        );

        addToggle(
            "appearance",
            this.t("ui.branchColor", "分支配色"),
            this.t("set.branchColorDesc", "每个一级分支使用不同色系，子节点继承"),
            this.config.branchColor,
            (v) => {
                draft.branchColor = v;
            },
        );

        addText(
            "appearance",
            this.t("set.customColors", "自定义一级分支配色"),
            this.t("set.customColorsDesc", "逗号分隔的十六进制颜色，按顺序分配给一级分支，超出部分循环取用。留空表示用主题自带色板。"),
            this.config.customPalette,
            (v) => {
                draft.customPalette = v;
            },
        );

        addToggle(
            "appearance",
            this.t("set.showLevel", "显示层级编号"),
            this.t("set.showLevelDesc", "有序列表显示 1.2.1 形式的层级编号"),
            this.config.showOrder,
            (v) => {
                draft.showOrder = v;
            },
        );

        addToggle(
            "appearance",
            this.t("set.compact", "紧凑模式"),
            this.t("set.compactDesc", "缩小节点间距，适合节点较多的导图"),
            this.config.compact,
            (v) => {
                draft.compact = v;
            },
        );

        addToggle(
            "appearance",
            this.t("set.flipAnimation", "布局动效"),
            this.t("set.flipAnimationDesc", "结构变化时节点滑动到新位置，而不是瞬间跳过去"),
            this.config.flipAnimation,
            (v) => {
                draft.flipAnimation = v;
            },
        );

        /* ════════════════════════════════════════════════ 画布
         *
         * 这一组回答「画布多大、看得见多少」。
         * 「画布高度」与「画布高度（px）」必须挨着：后者是前者的参数，
         * 中间插别的东西会让人读不出两者的关系。 */

        addSelect(
            "canvas",
            this.t("set.canvasHeightMode", "画布高度"),
            this.t("set.canvasHeightModeDesc", "行内导图的高度同时决定「看得见多少」和「这篇文档要多滚几屏」，所以给了三种取法：自适应内容会跟着节点多少长高；固定高度始终一样；铺满可用高度用满编辑器可视区。"),
            {
                auto: this.t("set.canvasHeightAuto", "自适应内容（推荐）"),
                fixed: this.t("set.canvasHeightFixed", "固定高度"),
                fill: this.t("set.canvasHeightFill", "铺满可用高度"),
            },
            this.config.canvasHeightMode,
            (v) => {
                draft.canvasHeightMode = v as MMCanvasHeightMode;
            },
        );

        addNumber(
            "canvas",
            this.t("set.canvasHeight", "画布高度（px）"),
            this.t("set.canvasHeightDesc", "「自适应内容」下这是最小高度（节点少时也留这么高），「固定高度」下就是它本身的高度；「铺满可用高度」忽略此项。"),
            this.config.canvasHeight,
            240,
            1200,
            (v) => {
                draft.canvasHeight = v;
            },
        );

        addToggle(
            "canvas",
            this.t("set.autoFit", "自动适应画布"),
            this.t("set.autoFitDesc", "渲染完成后自动缩放到刚好铺满可视区"),
            this.config.autoFit,
            (v) => {
                draft.autoFit = v;
            },
        );

        addToggle(
            "canvas",
            this.t("set.autoColumns", "逻辑图自动分列"),
            this.t("set.autoColumnsDesc", "逻辑结构图的层级是纵向排列的，节点一多画布会变成细长条、横向空间全部闲置。开启后单列过高时自动把一级分支摊成多列。"),
            this.config.columnLayout,
            (v) => {
                draft.columnLayout = v;
            },
        );

        addToggle(
            "canvas",
            this.t("ui.minimap", "小地图"),
            this.t("set.minimapDesc", "在右下角显示缩略图，可点击跳转"),
            this.config.minimap,
            (v) => {
                draft.minimap = v;
            },
        );

        // 「小地图」下面紧跟这一条：它只是上一条的补充。
        // 单独列出来是因为「节点少时自动隐藏」那条线用户看不见 ——
        // 开关开着却没有东西，只会被当成插件坏了。
        addToggle(
            "canvas",
            this.t("set.minimapAlways", "小地图始终显示"),
            this.t("set.minimapAlwaysDesc", "打开后，节点较少时也显示缩略图。默认只在节点较多（30 个以上）时显示 —— 小图一眼能看完，缩略图是多余的。"),
            this.config.minimapAlways,
            (v) => {
                draft.minimapAlways = v;
            },
        );

        /* ════════════════════════════════════════════════ 交互
         *
         * 这一组回答「我怎么操作它」。鼠标在前、键盘在后 ——
         * 新用户先摸到的是鼠标。 */

        addToggle(
            "interact",
            this.t("set.dblclickEdit", "双击编辑节点"),
            this.t("set.dblclickEditDesc", "双击节点直接改名，回车提交、Esc 取消，改动会写回思源"),
            this.config.editable,
            (v) => {
                draft.editable = v;
            },
        );

        addToggle(
            "interact",
            this.t("set.dragNode", "拖拽调整节点"),
            this.t("set.dragNodeDesc", "按住节点拖动可调整顺序与层级：落在节点上下缘成为同级，落在中间成为子节点"),
            this.config.draggable,
            (v) => {
                draft.draggable = v;
            },
        );

        addToggle(
            "interact",
            this.t("set.hoverPreview", "悬停预览折叠节点"),
            this.t("set.hoverPreviewDesc", "鼠标在折叠的节点上停一下，浮出一张卡片列出里面的前几个子节点。"),
            this.config.hoverPreview,
            (v) => {
                draft.hoverPreview = v;
            },
        );

        addToggle(
            "interact",
            this.t("set.keyboard", "导图内快捷键"),
            this.t("set.keyboardDesc", "导图获得焦点时接管键盘（方向键导航、Tab 加子节点、Enter 加同级、F2 改名等）。如果和思源的快捷键冲突，可以关掉它。"),
            this.config.keyboard,
            (v) => {
                draft.keyboard = v;
            },
        );

        addToggle(
            "interact",
            this.t("set.ctrlWheel", "Ctrl + 滚轮缩放"),
            this.t("set.ctrlWheelDesc", "按住 Ctrl（macOS 为 ⌘）滚动鼠标可缩放导图"),
            this.config.ctrlWheelZoom,
            (v) => {
                draft.ctrlWheelZoom = v;
            },
        );

        addToggle(
            "interact",
            this.t("set.wheelPan", "滚轮平移导图"),
            this.t("set.wheelPanDesc", "开启后滚轮直接平移导图；关闭时滚轮用于滚动页面"),
            this.config.wheelPan,
            (v) => {
                draft.wheelPan = v;
            },
        );

        addToggle(
            "interact",
            this.t("set.viewPerDoc", "视图偏好跟文档走"),
            this.t("set.viewPerDocDesc", "在这个列表里改过的布局 / 主题 / 连线会记进块属性（custom-mindmap-view），下次打开这个列表就恢复成你调好的样子；没改过的项继续跟随上面的全局默认。"),
            this.config.viewPerDoc,
            (v) => {
                draft.viewPerDoc = v;
            },
        );

        // 这条是**说明**而不是开关：折叠状态本来就存在思源的列表结构里，
        // 插件只是复用，没有任何可选的行为。
        addHint(
            "interact",
            this.t("set.foldSync", "折叠状态与大纲同步"),
            this.t("set.foldSyncDesc", "导图的折叠状态就是思源原生的列表折叠：在大纲里折一个节点，导图立刻跟着折；在导图上折一个节点，大纲也会跟着折。它随文档一起保存，所以离开时什么状态、下次进来就是什么状态。"),
        );

        /* ════════════════════════════════════════════════ 性能
         *
         * 这一组默认值都够用，只有「文档大到卡了」才需要进来调。 */

        addToggle(
            "perf",
            this.t("set.lazyRender", "懒渲染"),
            this.t("set.lazyRenderDesc", "列表块进入视口附近才渲染，长文档滚动更流畅"),
            this.config.lazyRender,
            (v) => {
                draft.lazyRender = v;
            },
        );

        addNumber(
            "perf",
            this.t("set.compactThreshold", "紧凑模式阈值"),
            this.t("set.compactThresholdDesc", "节点数超过该值时自动收紧节点间距"),
            this.config.compactThreshold,
            50,
            10000,
            (v) => {
                draft.compactThreshold = v;
            },
        );

        addNumber(
            "perf",
            this.t("set.hardLimit", "渲染上限"),
            this.t("set.hardLimitDesc", "节点数超过该值时暂停渲染并给出提示，避免拖慢编辑器"),
            this.config.hardLimit,
            100,
            50000,
            (v) => {
                draft.hardLimit = v;
            },
        );

        /* ════════════════════════════════════════════════ 帮助
         *
         * 三个入口都是「按钮」，都不是设置项 —— 点完就走，面板本身不用保存。 */

        addButton(
            "help",
            this.t("set.shortcutBtn", "查看快捷键"),
            this.t("set.shortcutHint", "在导图内单击任意节点即可用键盘操作"),
            this.t("ui.view", "查看"),
            () => this.openShortcutHelp(),
        );

        addButton(
            "help",
            this.t("copyDiagnostics", "复制诊断信息"),
            this.t("set.diagDesc", "版本 / 配置 / 各视图状态 / 最近警告。只复制到剪贴板，不联网、不上报。"),
            this.t("ui.copy", "复制"),
            (btn) => void this.copyDiagnostics(btn),
        );

        addButton(
            "help",
            this.t("set.migrate", "迁移【自定义块样式】标记"),
            this.t("set.migrateDesc", "把该插件标记的列表导图（custom-block-list-view = map）迁移为大纲导图"),
            this.t("set.migrateStart", "开始迁移"),
            () => void this.runMigration(),
        );

        /* ════════════════════════════════════════════════ 开面板 + 改造成选项卡 */

        /**
         * ⚠️ 快照必须在 `open()` **之前** 取：`open()` 是同步的，
         * 返回时对话框已经在 DOM 里了，事后再取就分不出哪个是新的。
         */
        const before = new Set<Element>(Array.from(document.querySelectorAll(".b3-dialog--open")));
        setting.open(this.name);

        /**
         * 等思源把设置项渲染进 `.b3-dialog__content`，再把它改造成侧边选项卡。
         *
         * 为什么要**重试**而不是 `open()` 之后直接改：`open()` 目前是同步的
         * （实测 3.8.5），但这是思源的内部实现、没有任何契约保证。写死「同步」
         * 的话，哪天它改成异步渲染，插件会安静地退回扁平列表 —— 不崩、但功能
         * 悄悄没了。重试的代价只有几十毫秒。
         *
         * 重试的判据是「行数正好等于我们 `addItem` 的次数」，所以也顺带把
         * 「思源多渲染/少渲染了东西」这种情况挡在了 `layoutSettingTabs` 的
         * 契约校验之外。
         */
        let tries = 0;
        const attempt = () => {
            tries++;
            const dlg = Array.from(document.querySelectorAll(".b3-dialog--open")).find((d) => !before.has(d));
            const content = dlg?.querySelector<HTMLElement>(".b3-dialog__content") ?? null;

            if (content && content.children.length === groupOf.length) {
                if (!layoutSettingTabs(content, groupOf, tabs)) {
                    console.warn(
                        `[mindmap] 设置面板：DOM 结构与预期不符（${groupOf.length} 条设置项已就位但类名/分组对不上），` +
                            "已退回思源的扁平列表。功能不受影响，只是没有分组。",
                    );
                }
                return;
            }

            if (tries < 40) {
                nextFrame(attempt);
                return;
            }
            // 40 帧（约 0.7 秒）还等不到：退回扁平列表，但**留一条警告** ——
            // 这种失败是静默的，不写日志的话只能靠用户抱怨「设置面板怎么没分组」才发现。
            console.warn(
                `[mindmap] 设置面板：等待 ${groupOf.length} 条设置项超时` +
                    `（对话框${dlg ? "已出现" : "未出现"}，实际 ${content ? content.children.length : "-"} 条），已退回扁平列表。`,
            );
        };
        nextFrame(attempt);
    }

    private async saveConfig() {
        await this.saveData("config", this.config);
    }

    /**
     * 拼一份诊断信息并复制到剪贴板（P1-5）。
     *
     * 原则：**只复制，不外发**。整条路径里没有任何 HTTP 请求 ——
     * 这里的信息带着用户的文档 ID、节点数量、配置，那是用户自己的东西，
     * 要不要给别人看应该由用户决定（所以他拿到的是剪贴板里的一段文本）。
     *
     * 顺带把结果反馈做扎实一点：复制失败要说清楚，不然用户会以为
     * 「点了没反应」，然后把一份空的报告发给别人。
     */
    private async copyDiagnostics(btn: HTMLButtonElement) {
        // i18n-audit-ignore-start
        // 这份报告是**复制出去给开发者排障**的，读者是能看懂中文的维护者。
        // 翻成英文只会让 issue 里的报告中英混杂，所以整段保持中文（界面上的
        // 按钮与说明照抽，只有这份「复制出去的报告正文」例外）。
        const version = typeof __MM_VERSION__ === "string" ? __MM_VERSION__ : "未知";
        const kernel = (await getKernelVersion()) || "未知";
        const views = this.scanner.viewSummaries();
        const c = this.config;

        const lines: string[] = [
            "===== 大纲导图 诊断信息 =====",
            `时间: ${stamp()}`,
            `插件版本: ${version}`,
            `内核版本: ${kernel}`,
            `已挂载视图: ${views.length}`,
            `撤销栈深度: ${this.scanner.historyDepth}`,
            "",
            "--- 配置 ---",
            `布局 ${c.layout} · 主题 ${c.theme} · 连线 ${c.edge} · 分支配色 ${c.branchColor ? "开" : "关"}`,
            `自动适应 ${c.autoFit ? "开" : "关"} · 动效 ${c.flipAnimation ? "开" : "关"} · 小地图 ${c.minimap ? "开" : "关"}`,
            `紧凑阈值 ${c.compactThreshold} · 懒渲染 ${c.lazyRender ? "开" : "关"}（硬上限 ${c.hardLimit}）`,
            `可编辑 ${c.editable ? "开" : "关"} · 键盘 ${c.keyboard ? "开" : "关"} · 视图偏好跟文档走 ${c.viewPerDoc ? "开" : "关"}`,
            "",
            "--- 视图 ---",
        ];
        if (views.length === 0) {
            lines.push("（当前没有挂载任何导图）");
        } else {
            for (const v of views) {
                const i = v.info;
                lines.push(
                    `${v.where}  节点 ${i.nodes} · 布局 ${i.layout} · 主题 ${i.theme} · 连线 ${i.edge} · 缩放 ${i.scale}%` +
                        ` · 过滤 ${i.filter} · 选中 ${i.selected} · 下钻 ${i.drill}`,
                );
            }
        }
        lines.push("", "--- 最近的警告 / 错误 ---", formatNotes());
        lines.push("", "（以上信息仅供排障，插件不会自动发送任何数据）");
        // i18n-audit-ignore-end

        const text = lines.join("\n");
        const ok = await copyText(text);
        if (ok) {
            const old = btn.textContent;
            btn.textContent = this.t("msg.copied", "已复制");
            window.setTimeout(() => {
                btn.textContent = old || this.t("ui.copy", "复制");
            }, 1600);
            showMessage(this.t("msg.diagCopied", "诊断信息已复制到剪贴板"), 2600);
        } else {
            // 复制失败时把内容打进控制台 —— 用户至少还能手动抄走
            console.warn("[mindmap] 复制诊断信息失败，内容如下\n" + text);
            showMessage(this.t("msg.diagCopyFailed", "复制失败，诊断信息已打印到控制台"), 5000, "error");
        }
    }
}

/**
 * 额外导出视图类，仅供产物冒烟测试校验原型方法是否齐全。
 * 思源只会读取 `exports.default` 作为插件入口，多一个命名导出没有副作用。
 */
export { MindMapView };
