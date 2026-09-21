import { Dialog, Plugin, Setting, openTab, showMessage } from "siyuan";
import type { IMenu, subMenu } from "siyuan";

import { ATTR_LEGACY_VIEW, ATTR_VIEW, DEFAULT_CONFIG } from "./types";
import type { MMConfig, MMLayout, MMThemeId, MMEdgeStyle } from "./types";
import { Scanner } from "./core/scanner";
import { MindMapView } from "./core/renderer";
import { setBlockAttrs } from "./utils/api";
import { THEME_LIST } from "./core/theme";

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

/** 设置面板里的快捷键速查 */
const SHORTCUT_HELP = [
    "导航：↑↓ 同级 · ← 父节点 · → 第一个子节点 · Home/End 首尾 · 空格 折叠",
    "编辑：Tab 子节点 · Shift+Tab 降级 · Enter 同级 · F2 改名 · Delete 删除 · Alt+←/→ 升降级 · Ctrl+↑/↓ 上下移",
    "剪贴：Ctrl+C 复制子树 · Ctrl+V 粘贴为子节点 · Ctrl+X 剪切 · Ctrl+D 快速复制",
    "视图：Ctrl+= / Ctrl+- 缩放 · Ctrl+0 适应画布 · Ctrl+1 回到 100% · Ctrl+F 搜索 · F 全屏 · Esc 退出",
    "聚焦：Ctrl/⌘ + 双击节点（或右键菜单「聚焦此分支」）只看这一个分支，Esc 逐层返回",
    "多选：Shift + 拖动框选 · Ctrl + 单击加选；选中 2 个以上会浮出批量操作条（升级 / 降级 / 折叠 / 导出 / 删除）",
    "演示：工具条上的 ▶ 进入演示模式，→ / 空格 推进、← 回退、Esc 退出（不修改文档内容）",
].join("\n");

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
        });

        this.registerBlockMenu();
        this.registerCommands();
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
            hotkey: "",
            callback: () => void this.runMigration(),
        });
        // 入口之二：命令面板。列表块图标是「我知道有这个功能」之后才好用的入口，
        // 而命令面板（Ctrl+P）是「我想做这件事」时的入口 —— 而且可以绑快捷键。
        this.addCommand({
            langKey: "toggleMindMap",
            hotkey: "",
            callback: () => void this.toggleMindMap(),
        });
        this.addCommand({
            langKey: "toggleSidePanel",
            hotkey: "",
            callback: () => this.toggleSide(),
        });
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
            showMessage("没找到列表块：把光标放进列表里，或先打开一个含列表的文档", 4000);
            return;
        }
        const on = !!list.getAttribute(ATTR_VIEW);
        await this.applyView(list, on ? null : this.config.layout);
        showMessage(on ? "已切回大纲视图" : "已转为导图");
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
            showMessage(`已迁移 ${count} 个列表块`);
            window.setTimeout(() => this.scanner.scanAll(), 150);
        } else {
            showMessage("没有找到来自【自定义块样式】的导图列表");
        }
    }

    private buildBlockMenu(menu: subMenu, list: HTMLElement | null) {
        const current = list?.getAttribute(ATTR_VIEW) ?? null;
        const disabled = !list;

        const items: IMenu[] = [
            {
                label: "大纲视图（关闭导图）",
                checked: current === null,
                disabled,
                click: () => {
                    if (list) void this.applyView(list, null);
                },
            },
            { type: "separator" },
        ];

        for (const [key, label] of Object.entries(LAYOUT_OPTIONS) as Array<[MMLayout, string]>) {
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
            label: "并排查看（大纲 + 导图）",
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
            label: "大纲导图",
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
            showMessage("打开失败，块可能已被删除", 3000, "error");
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
            showMessage("没找到列表块：把光标放进列表里，或先打开一个含列表的文档", 4000);
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
            showMessage("这个列表已经在导图模式了，并排面板是给大纲视图用的", 3500);
            return;
        }

        this.closeSide();

        const panel = document.createElement("div");
        panel.className = "mm-side";
        panel.setAttribute("contenteditable", "false");

        const grip = document.createElement("div");
        grip.className = "mm-side-grip";
        grip.dataset.mmTip = "拖动调整宽度";

        const head = document.createElement("div");
        head.className = "mm-side-head";
        const titleEl = document.createElement("span");
        titleEl.className = "mm-side-title";
        titleEl.textContent = "大纲导图 · 并排";
        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "mm-side-close";
        closeBtn.textContent = "✕";
        closeBtn.title = "关闭并排面板";
        closeBtn.onclick = () => this.closeSide();
        head.append(titleEl, closeBtn);

        const body = document.createElement("div");
        body.className = "mm-side-body";

        panel.append(grip, head, body);
        document.body.appendChild(panel);

        const title = document.querySelector<HTMLElement>(".protyle-title")?.textContent?.trim() || "导图";
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
        const setting = new Setting({
            confirmCallback: () => {
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
                    box.textContent = "已同步";
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
                    input.placeholder = "例如 #4c8dff,#ff7a45,#52c41a";
                    input.onchange = () => changed(input.value.trim());
                    return input;
                },
            });
        };

        addSelect("默认布局", "在块菜单中启用导图时使用的默认结构", LAYOUT_OPTIONS, this.config.layout, (v) => {
            this.config.layout = v as MMLayout;
        });

        addSelect("连线样式", "节点之间的连接线形态", EDGE_OPTIONS, this.config.edge, (v) => {
            this.config.edge = v as MMEdgeStyle;
        });

        addSelect(
            "主题",
            "「跟随思源」会使用思源当前配色，其余为内置独立配色",
            Object.fromEntries(THEME_LIST.map((t) => [t.id, t.name])),
            this.config.theme,
            (v) => {
                this.config.theme = v as MMThemeId;
            },
        );

        addToggle("显示层级编号", "有序列表显示 1.2.1 形式的层级编号", this.config.showOrder, (v) => {
            this.config.showOrder = v;
        });

        addToggle("分支配色", "每个一级分支使用不同色系，子节点继承", this.config.branchColor, (v) => {
            this.config.branchColor = v;
        });

        addToggle("紧凑模式", "缩小节点间距，适合节点较多的导图", this.config.compact, (v) => {
            this.config.compact = v;
        });

        addToggle("Ctrl + 滚轮缩放", "按住 Ctrl（macOS 为 ⌘）滚动鼠标可缩放导图", this.config.ctrlWheelZoom, (v) => {
            this.config.ctrlWheelZoom = v;
        });

        addToggle("滚轮平移导图", "开启后滚轮直接平移导图；关闭时滚轮用于滚动页面", this.config.wheelPan, (v) => {
            this.config.wheelPan = v;
        });

        addHint(
            "折叠状态与大纲同步",
            "导图的折叠状态就是思源原生的列表折叠：在大纲里折一个节点，导图立刻跟着折；在导图上折一个节点，大纲也会跟着折。它随文档一起保存，所以离开时什么状态、下次进来就是什么状态。",
        );

        addToggle("自动适应画布", "渲染完成后自动缩放到刚好铺满可视区", this.config.autoFit, (v) => {
            this.config.autoFit = v;
        });

        addToggle(
            "逻辑图自动分列",
            "逻辑结构图的层级是纵向排列的，节点一多画布会变成细长条、横向空间全部闲置。开启后单列过高时自动把一级分支摊成多列。",
            this.config.columnLayout,
            (v) => {
                this.config.columnLayout = v;
            },
        );

        addToggle("双击编辑节点", "双击节点直接改名，回车提交、Esc 取消，改动会写回思源", this.config.editable, (v) => {
            this.config.editable = v;
        });

        addToggle("拖拽调整节点", "按住节点拖动可调整顺序与层级：落在节点上下缘成为同级，落在中间成为子节点", this.config.draggable, (v) => {
            this.config.draggable = v;
        });

        addToggle("懒渲染", "列表块进入视口附近才渲染，长文档滚动更流畅", this.config.lazyRender, (v) => {
            this.config.lazyRender = v;
        });

        addToggle(
            "导图内快捷键",
            "导图获得焦点时接管键盘（方向键导航、Tab 加子节点、Enter 加同级、F2 改名等）。如果和思源的快捷键冲突，可以关掉它。",
            this.config.keyboard,
            (v) => {
                this.config.keyboard = v;
            },
        );

        addToggle("布局动效", "结构变化时节点滑动到新位置，而不是瞬间跳过去", this.config.flipAnimation, (v) => {
            this.config.flipAnimation = v;
        });

        addToggle("小地图", "节点较多时在右下角显示缩略图，可点击跳转", this.config.minimap, (v) => {
            this.config.minimap = v;
        });

        addToggle(
            "视图偏好跟文档走",
            "在这个列表里改过的布局 / 主题 / 连线会记进块属性（custom-mindmap-view），下次打开这个列表就恢复成你调好的样子；没改过的项继续跟随上面的全局默认。",
            this.config.viewPerDoc,
            (v) => {
                this.config.viewPerDoc = v;
            },
        );

        addToggle(
            "悬停预览折叠节点",
            "鼠标在折叠的节点上停一下，浮出一张卡片列出里面的前几个子节点。",
            this.config.hoverPreview,
            (v) => {
                this.config.hoverPreview = v;
            },
        );

        addText(
            "自定义一级分支配色",
            "逗号分隔的十六进制颜色，按顺序分配给一级分支，超出部分循环取用。留空表示用主题自带色板。",
            this.config.customPalette,
            (v) => {
                this.config.customPalette = v;
            },
        );

        setting.addItem({
            title: "查看快捷键",
            description: "在导图内单击任意节点即可用键盘操作",
            createActionElement: () => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "b3-button b3-button--outline fn__size200";
                btn.textContent = "查看";
                btn.onclick = () => showMessage(SHORTCUT_HELP, 12000);
                return btn;
            },
        });

        addNumber(
            "紧凑模式阈值",
            "节点数超过该值时自动收紧节点间距",
            this.config.compactThreshold,
            50,
            10000,
            (v) => {
                this.config.compactThreshold = v;
            },
        );

        addNumber(
            "渲染上限",
            "节点数超过该值时暂停渲染并给出提示，避免拖慢编辑器",
            this.config.hardLimit,
            100,
            50000,
            (v) => {
                this.config.hardLimit = v;
            },
        );

        setting.addItem({
            title: "迁移【自定义块样式】标记",
            description: "把该插件标记的列表导图（custom-block-list-view = map）迁移为大纲导图",
            createActionElement: () => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "b3-button b3-button--outline fn__size200";
                btn.textContent = "开始迁移";
                btn.onclick = () => void this.runMigration();
                return btn;
            },
        });

        setting.open(this.name);
    }

    private async saveConfig() {
        await this.saveData("config", this.config);
    }
}

/**
 * 额外导出视图类，仅供产物冒烟测试校验原型方法是否齐全。
 * 思源只会读取 `exports.default` 作为插件入口，多一个命名导出没有副作用。
 */
export { MindMapView };
