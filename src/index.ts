import { Dialog, Menu, Plugin, Setting, openTab, showMessage } from "siyuan";
import type { IMenu, subMenu } from "siyuan";

import { ATTR_LEGACY_VIEW, ATTR_VIEW, DEFAULT_CONFIG } from "./types";
import type { MMConfig, MMLayout, MMThemeId, MMEdgeStyle } from "./types";
import { Scanner } from "./core/scanner";
import { MindMapView } from "./core/renderer";
import { copyText, getKernelVersion, searchDocOutline, setBlockAttrs } from "./utils/api";
import { isMacPlatform, readableHotkey } from "./utils/hotkey";
import { formatNotes, installDiagnostics, stamp } from "./core/diagnostics";
import { THEME_LIST } from "./core/theme";

/**
 * 两条全局命令的默认键位，用**思源自己的表示法**（macOS 字形，与 `conf.json` 一致）。
 *
 * ⚠️ 声明（`addCommand` 的 `hotkey`）与说明文字（快捷键速查）必须**共用这两个常量**。
 * 分开写迟早会漂移：改了绑定忘了改说明，用户按文档去按、按不动。
 */
const HOTKEY_TOGGLE = "⌥⌘D";
const HOTKEY_SIDE = "⌥⌘V";

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

/**
 * 设置面板里的快捷键速查。
 *
 * 每行配一个**语义键**，而不是 `shortcut.0`…`shortcut.13` 这样的下标键 ——
 * 下标键在中间插一行时，后面所有译文会整体错位，而且错得很安静：
 * 界面上依旧是一句通顺的英文，只是内容和行对不上了，中英文都不报错。
 *
 * 第一项是键名，第二项是内置中文（词表取不到时的兜底）。
 * 空行用 `["", ""]` 占位 —— 它分隔「图内」与「全局」两组，本身没有文案。
 */
const SHORTCUT_HELP: Array<[string, string]> = [
    ["shortcut.nav", "导航：↑↓ 同级 · ← 父节点 · → 第一个子节点 · Home/End 首尾 · 空格 折叠"],
    ["shortcut.edit", "编辑：Tab 子节点 · Shift+Tab 降级 · Enter 同级 · F2 改名 · Delete/Backspace 删除 · Alt+←/→ 升降级 · Ctrl+↑/↓ 上下移"],
    ["shortcut.todo", "待办：X 勾选 / 取消勾选选中的待办节点（也可以直接点节点上的复选框）"],
    ["shortcut.mark", "标记：右键节点 →「添加标记」，可挂图标 / 标签 / 自定义色；存在块属性里，复制块、导出、换设备都跟着走"],
    ["shortcut.clip", "剪贴：Ctrl+C 复制子树 · Ctrl+V 粘贴为子节点 · Ctrl+X 剪切 · Ctrl+D 快速复制"],
    ["shortcut.view", "视图：Ctrl+= / Ctrl+- 缩放 · Ctrl+0 适应画布 · Ctrl+1 回到 100% · Ctrl+F 搜索 · F 全屏 · Esc 退出"],
    ["shortcut.search", "搜索：Ctrl+F 打开搜索框；框里的「本图 / 全文档」切换范围 —— 全文档会在本文档所有导图里找，结果点一下就跳过去"],
    ["shortcut.filter", "过滤：工具条上的「全部 / 未完成 / 已完成」只看某一类待办（图里没有待办时这一组会自动收起）"],
    ["shortcut.focus", "聚焦：Ctrl/⌘ + 双击节点（或右键菜单「聚焦此分支」）只看这一个分支，Esc 逐层返回"],
    ["shortcut.multi", "多选：Shift + 拖动框选 · Ctrl + 单击加选 · Ctrl+A 全选同级（再按一次选中整棵树）；选中 2 个以上会浮出批量操作条（升级 / 降级 / 折叠 / 待办完成 / 导出 / 删除）"],
    ["shortcut.present", "演示：工具条上的 ▶ 进入演示模式，→ / 空格 / PageDown 推进、← / PageUp 回退、Esc 退出（不修改文档内容）"],
    ["", ""],
    ["shortcut.globalTitle", "全局（在文档任意位置都生效，可在「设置 → 快捷键」里改）："],
    // 键位用占位符，由 `shortcutHelp()` 按平台填入 —— 写死 `⌥⌘D` 的话，
    // Windows 用户看到的是一套在自己「设置 → 快捷键」里找不到的符号
    //（思源自己的菜单在 Windows 上显示的是 `Ctrl+Alt+D`）。
    ["shortcut.global", "{toggle} 把光标所在的列表切换为导图 / 大纲 · {side} 并排面板打开导图"],
];

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

export default class MindMapPlugin extends Plugin {
    private config: MMConfig = { ...DEFAULT_CONFIG };
    private scanner!: Scanner;
    private dialog: Dialog | null = null;
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
     * 快捷键速查的正文。
     *
     * 键与中文都写在模块级常量里，所以取值只能在类内做 —— 这里是唯一的消费点。
     * 空行（`["", ""]`）原样保留，不查词表。
     *
     * 全局那两条的键位走占位符：思源的表示法是 macOS 字形，得按平台换算
     *（思源自己的菜单在 Windows 上显示的是 `Ctrl+Alt+D`）。
     */
    private shortcutHelp(): string {
        const vars = {
            toggle: readableHotkey(HOTKEY_TOGGLE, isMacPlatform()),
            side: readableHotkey(HOTKEY_SIDE, isMacPlatform()),
        };
        return SHORTCUT_HELP.map(([key, zh]) => (zh ? this.t(key, zh, vars) : "")).join("\n");
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

    private buildBlockMenu(menu: subMenu, list: HTMLElement | null) {
        const current = list?.getAttribute(ATTR_VIEW) ?? null;
        const disabled = !list;

        const items: IMenu[] = [
            {
                label: this.t("menuOutline", "大纲视图（关闭导图）"),
                checked: current === null,
                disabled,
                click: () => {
                    if (list) void this.applyView(list, null);
                },
            },
            { type: "separator" },
        ];

        for (const [key, fallback] of Object.entries(LAYOUT_OPTIONS) as Array<[MMLayout, string]>) {
            // 布局名走 i18n（键名约定：layout.<值>，如 logic → layout.logic）
            const label = this.t(`layout.${key}`, fallback);
            items.push({
                label,
                checked: current === key,
                disabled,
                click: () => {
                    if (list) void this.applyView(list, key);
                },
            });
        }

        items.push({ type: "separator" });
        items.push({
            label: this.t("ui.sideBySide", "并排查看（大纲 + 导图）"),
            checked: this.scanner.sideListId !== "" && this.scanner.sideListId === list?.dataset.nodeId,
            disabled,
            click: () => {
                if (!list) return;
                // 点的是同一个块就关掉，否则换到这块
                if (this.scanner.sideListId === list.dataset.nodeId) this.closeSide();
                else this.openSide(list);
            },
        });

        menu.addItem({
            icon: "iconList",
            label: this.t("menuRoot", "大纲导图"),
            type: "submenu",
            submenu: items,
        });
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
            confirmCallback: () => {
                this.config = { ...draft };
                void this.saveConfig();
                this.scanner.refreshAll();
            },
        });

        const addSelect = (
            title: string,
            description: string,
            options: Record<string, string>,
            value: string,
            changed: (v: string) => void,
        ) => {
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

        const addToggle = (title: string, description: string, value: boolean, changed: (v: boolean) => void) => {
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
        const addHint = (title: string, description: string) => {
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
            title: string,
            description: string,
            value: number,
            min: number,
            max: number,
            changed: (v: number) => void,
        ) => {
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

        const addText = (title: string, description: string, value: string, changed: (v: string) => void) => {
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

        addSelect(this.t("set.defaultLayout", "默认布局"), this.t("set.defaultLayoutDesc", "在块菜单中启用导图时使用的默认结构"), this.localize(LAYOUT_OPTIONS, "layout"), this.config.layout, (v) => {
            draft.layout = v as MMLayout;
        });

        addSelect(this.t("ui.edgeStyle", "连线样式"), this.t("set.edgeStyleDesc", "节点之间的连接线形态"), this.localize(EDGE_OPTIONS, "edge"), this.config.edge, (v) => {
            draft.edge = v as MMEdgeStyle;
        });

        addSelect(
            this.t("ui.theme", "主题"),
            this.t("set.themeDesc", "「跟随思源」会使用思源当前配色，其余为内置独立配色"),
            Object.fromEntries(THEME_LIST.map((th) => [th.id, this.t(`theme.${th.id}`, th.name)])),
            this.config.theme,
            (v) => {
                draft.theme = v as MMThemeId;
            },
        );

        addToggle(this.t("set.showLevel", "显示层级编号"), this.t("set.showLevelDesc", "有序列表显示 1.2.1 形式的层级编号"), this.config.showOrder, (v) => {
            draft.showOrder = v;
        });

        addToggle(this.t("ui.branchColor", "分支配色"), this.t("set.branchColorDesc", "每个一级分支使用不同色系，子节点继承"), this.config.branchColor, (v) => {
            draft.branchColor = v;
        });

        addToggle(this.t("set.compact", "紧凑模式"), this.t("set.compactDesc", "缩小节点间距，适合节点较多的导图"), this.config.compact, (v) => {
            draft.compact = v;
        });

        addToggle(this.t("set.ctrlWheel", "Ctrl + 滚轮缩放"), this.t("set.ctrlWheelDesc", "按住 Ctrl（macOS 为 ⌘）滚动鼠标可缩放导图"), this.config.ctrlWheelZoom, (v) => {
            draft.ctrlWheelZoom = v;
        });

        addToggle(this.t("set.wheelPan", "滚轮平移导图"), this.t("set.wheelPanDesc", "开启后滚轮直接平移导图；关闭时滚轮用于滚动页面"), this.config.wheelPan, (v) => {
            draft.wheelPan = v;
        });

        addHint(
            this.t("set.foldSync", "折叠状态与大纲同步"),
            this.t("set.foldSyncDesc", "导图的折叠状态就是思源原生的列表折叠：在大纲里折一个节点，导图立刻跟着折；在导图上折一个节点，大纲也会跟着折。它随文档一起保存，所以离开时什么状态、下次进来就是什么状态。"),
        );

        addToggle(this.t("set.autoFit", "自动适应画布"), this.t("set.autoFitDesc", "渲染完成后自动缩放到刚好铺满可视区"), this.config.autoFit, (v) => {
            draft.autoFit = v;
        });

        addToggle(
            this.t("set.autoColumns", "逻辑图自动分列"),
            this.t("set.autoColumnsDesc", "逻辑结构图的层级是纵向排列的，节点一多画布会变成细长条、横向空间全部闲置。开启后单列过高时自动把一级分支摊成多列。"),
            this.config.columnLayout,
            (v) => {
                draft.columnLayout = v;
            },
        );

        addToggle(this.t("set.dblclickEdit", "双击编辑节点"), this.t("set.dblclickEditDesc", "双击节点直接改名，回车提交、Esc 取消，改动会写回思源"), this.config.editable, (v) => {
            draft.editable = v;
        });

        addToggle(this.t("set.dragNode", "拖拽调整节点"), this.t("set.dragNodeDesc", "按住节点拖动可调整顺序与层级：落在节点上下缘成为同级，落在中间成为子节点"), this.config.draggable, (v) => {
            draft.draggable = v;
        });

        addToggle(this.t("set.lazyRender", "懒渲染"), this.t("set.lazyRenderDesc", "列表块进入视口附近才渲染，长文档滚动更流畅"), this.config.lazyRender, (v) => {
            draft.lazyRender = v;
        });

        addToggle(
            this.t("set.keyboard", "导图内快捷键"),
            this.t("set.keyboardDesc", "导图获得焦点时接管键盘（方向键导航、Tab 加子节点、Enter 加同级、F2 改名等）。如果和思源的快捷键冲突，可以关掉它。"),
            this.config.keyboard,
            (v) => {
                draft.keyboard = v;
            },
        );

        addToggle(this.t("set.flipAnimation", "布局动效"), this.t("set.flipAnimationDesc", "结构变化时节点滑动到新位置，而不是瞬间跳过去"), this.config.flipAnimation, (v) => {
            draft.flipAnimation = v;
        });

        addToggle(this.t("ui.minimap", "小地图"), this.t("set.minimapDesc", "节点较多时在右下角显示缩略图，可点击跳转"), this.config.minimap, (v) => {
            draft.minimap = v;
        });

        addToggle(
            this.t("set.viewPerDoc", "视图偏好跟文档走"),
            this.t("set.viewPerDocDesc", "在这个列表里改过的布局 / 主题 / 连线会记进块属性（custom-mindmap-view），下次打开这个列表就恢复成你调好的样子；没改过的项继续跟随上面的全局默认。"),
            this.config.viewPerDoc,
            (v) => {
                draft.viewPerDoc = v;
            },
        );

        addToggle(
            this.t("set.hoverPreview", "悬停预览折叠节点"),
            this.t("set.hoverPreviewDesc", "鼠标在折叠的节点上停一下，浮出一张卡片列出里面的前几个子节点。"),
            this.config.hoverPreview,
            (v) => {
                draft.hoverPreview = v;
            },
        );

        addText(
            this.t("set.customColors", "自定义一级分支配色"),
            this.t("set.customColorsDesc", "逗号分隔的十六进制颜色，按顺序分配给一级分支，超出部分循环取用。留空表示用主题自带色板。"),
            this.config.customPalette,
            (v) => {
                draft.customPalette = v;
            },
        );

        setting.addItem({
            title: this.t("set.shortcutBtn", "查看快捷键"),
            description: this.t("set.shortcutHint", "在导图内单击任意节点即可用键盘操作"),
            createActionElement: () => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "b3-button b3-button--outline fn__size200";
                btn.textContent = this.t("ui.view", "查看");
                btn.onclick = () => showMessage(this.shortcutHelp(), 12000);
                return btn;
            },
        });

        setting.addItem({
            title: this.t("copyDiagnostics", "复制诊断信息"),
            description: this.t("set.diagDesc", "版本 / 配置 / 各视图状态 / 最近警告。只复制到剪贴板，不联网、不上报。"),
            createActionElement: () => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "b3-button b3-button--outline fn__size200";
                btn.textContent = this.t("ui.copy", "复制");
                btn.onclick = () => void this.copyDiagnostics(btn);
                return btn;
            },
        });

        addNumber(
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
            this.t("set.hardLimit", "渲染上限"),
            this.t("set.hardLimitDesc", "节点数超过该值时暂停渲染并给出提示，避免拖慢编辑器"),
            this.config.hardLimit,
            100,
            50000,
            (v) => {
                draft.hardLimit = v;
            },
        );

        setting.addItem({
            title: this.t("set.migrate", "迁移【自定义块样式】标记"),
            description: this.t("set.migrateDesc", "把该插件标记的列表导图（custom-block-list-view = map）迁移为大纲导图"),
            createActionElement: () => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "b3-button b3-button--outline fn__size200";
                btn.textContent = this.t("set.migrateStart", "开始迁移");
                btn.onclick = () => void this.runMigration();
                return btn;
            },
        });

        setting.open(this.name);
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
