import { Dialog, Plugin, Setting, showMessage } from "siyuan";
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

export default class MindMapPlugin extends Plugin {
    private config: MMConfig = { ...DEFAULT_CONFIG };
    private scanner!: Scanner;
    private dialog: Dialog | null = null;

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
        });

        this.registerBlockMenu();
        this.registerCommands();
    }

    onLayoutReady() {
        this.scanner.start();
    }

    onunload() {
        this.scanner?.stop();
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
            this.scanner.getFoldSet(listId),
            {
                onFoldChange: (nodeId, folded) => this.scanner.setFold(listId, nodeId, folded),
                onLocate: () => undefined,
                onExit: () => dialog.destroy(),
                onLayoutChange: (layout) => this.persistLayout(listId, layout),
                onFullscreen: () => undefined,
                onRename: (node, text) => void this.scanner.applyRename(node, text, listId),
                onNodeAction: (kind, node, extra) => void this.scanner.applyAction(kind, node, extra, listId),
                onHistory: (redo) => this.scanner.undo(redo),
            },
            title,
            "dialog",
        );
        view.mount(body);
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

        addToggle("记忆折叠状态", "把折叠状态写入块属性 custom-mindmap-fold，可跨设备同步", this.config.persistFold, (v) => {
            this.config.persistFold = v;
        });

        addToggle("自动适应画布", "渲染完成后自动缩放到刚好铺满可视区", this.config.autoFit, (v) => {
            this.config.autoFit = v;
        });

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
