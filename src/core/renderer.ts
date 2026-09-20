import { Menu, showMessage } from "siyuan";
import type {
    MMActionExtra,
    MMActionKind,
    MMConfig,
    MMDropPosition,
    MMLayout,
    MMNode,
    MMTheme,
} from "../types";
import { EDIT_FLAG } from "../types";
import { applyTheme, hexA, mixHex, readRgb, resolveTheme } from "./theme";
import { decorate, flatten, indexById, parseList, wrapRoot } from "./parser";
import { layout } from "./layout";
import { buildConnectors } from "./edge";
import type { Connector } from "./edge";
import { exportPng, exportSvg } from "./exporter";
import {
    canDelete,
    canEdit,
    canIndent,
    canMoveDown,
    canMoveUp,
    canOutdent,
    hasInlineFormat,
    isAncestor,
    NEW_NODE_TEXT,
    serializeSubtree,
} from "./tree";
import { copyText } from "../utils/api";

export interface ViewCallbacks {
    /**
     * 折叠状态变了，交给外部**写回大纲**（思源原生 `fold`）。
     *
     * 视图自己不存折叠态：解析时从 DOM 的 `.li[fold="1"]` 读，改动时往大纲写。
     * 这样「大纲什么状态、导图就什么状态」是结构上成立的，不需要两边对表。
     */
    onFoldChange: (id: string, folded: boolean) => void;
    /** 定位到正文块 */
    onLocate: (id: string) => void;
    /**
     * 回到源列表里编辑这个节点。
     * 含行内格式的节点只能这么改 —— 就地编辑写回的是纯文本，会把格式抹掉。
     */
    onEditInSource: (node: MMNode) => void;
    /** 退出导图视图 */
    onExit: () => void;
    /** 布局发生变化（会写回块属性） */
    onLayoutChange: (layout: MMLayout) => void;
    /** 请求全屏查看 */
    onFullscreen: (root: MMNode, theme: MMTheme) => void;
    /** 改名回写内核 */
    onRename: (node: MMNode, text: string) => void;
    /** 结构操作：增删 / 升降级 / 上下移 / 拖拽 / 复制 */
    onNodeAction: (kind: MMActionKind, node: MMNode, opts?: MMActionExtra) => void;
    /** 打开一个块（双链的目标）—— 一般是打开它所在的页签 */
    onOpenBlock: (id: string) => void;
    /**
     * 撤销 / 重做。返回「插件是否接管了这个键」——
     * 返回 false 表示自己的栈是空的，Ctrl+Z 应该继续冒泡给思源自己的撤销栈。
     */
    onHistory: (redo: boolean) => boolean;
}

/** 拖拽落点：上缘 / 下缘判定为同级插入，中间判定为成为子节点 */
const DROP_BEFORE_RATIO = 0.28;
const DROP_AFTER_RATIO = 0.72;

/** 移动超过该像素才算拖拽，用来区分点击 */
const DRAG_THRESHOLD = 4;

/** 拖拽悬停多久自动展开折叠节点 */
const HOVER_EXPAND_DELAY = 420;
/** 拖拽到边缘多少像素内开始自动滚动 */
const AUTO_SCROLL_MARGIN = 34;
const AUTO_SCROLL_SPEED = 9;

/** 小地图最少节点数 */
const MINIMAP_MIN_NODES = 50;
/** 小地图最多画多少个矩形，超过就抽样 */
const MINIMAP_MAX_RECTS = 700;

const LAYOUT_LABEL: Record<MMLayout, string> = {
    logic: "逻辑结构图",
    mind: "思维导图",
    tree: "树状图",
};

const MIN_SCALE = 0.15;
const MAX_SCALE = 6;

/**
 * 「可读优先」缩放下限。
 *
 * 正文 16px × 0.55 ≈ 8.8px —— 再小就跌破 8px 可读线了。
 * 实测「铺满视口」策略下：31 节点掉到 7.4px、64 节点 3.4px、109 节点 2.4px，
 * 而 30–100 节点恰恰是最常见的规模。所以首次进入大图时按这个下限兜底：
 * 宁可让用户平移，也不把整张图压成一片色块。
 *
 * 「适应画布」按钮不受此限 —— 那是用户主动要全貌，缩到多小都是他自己的选择。
 */
const READABLE_SCALE = 0.55;

/** 长按多少毫秒呼出节点菜单（触屏） */
const LONG_PRESS_MS = 500;

/** FLIP 时长，与 CSS 里的过渡时长无关 —— 位移完全由 JS 驱动 */
const FLIP_DURATION = 230;

/* ==================================================================== 键盘分发 */

/**
 * 全局键盘分发：把 keydown 交给「事件目标所在的那个导图视图」处理。
 *
 * 为什么不直接 `rootEl.addEventListener("keydown", ...)`：
 *
 * 全屏视图挂在思源的 `Dialog` 里，而思源的 Dialog 构造时会执行
 * `document.addEventListener("keydown", this.trapFocus, true)` —— 一个挂在
 * **document 捕获阶段**的焦点陷阱。它的逻辑是：
 *
 *     if (key !== "Tab") return;
 *     r = 弹层里所有可聚焦元素（含 [tabindex]、[contenteditable]），按 tabIndex 排序
 *     if (shiftKey ? activeElement === r[0] : activeElement === r[last]) {
 *         preventDefault(); stopPropagation();
 *         r[shiftKey ? last : 0].focus();
 *     }
 *
 * 我们的 `.mm-root` 带 tabindex=0，而且排在弹层最前面，正好是 `r[0]`。
 * 于是「焦点在导图上按 Shift+Tab」必然命中 `activeElement === r[0]`：
 * 事件被 preventDefault + stopPropagation，压根到不了 `.mm-root`，
 * 降级操作在全屏里永远失效。用户报的「全屏模式下变得不可编辑」就是这个。
 *
 * 捕获阶段是从 document 往目标走的，我们的监听器挂在越深的节点上排得越靠后，
 * 拦不住先跑的 trapFocus。唯一能同时拿到事件的写法是：**自己也挂到 document
 * 的捕获阶段** —— `stopPropagation()` 只阻止事件继续向下传播，不会阻止同一个
 * 节点上其它监听器执行（那要 `stopImmediatePropagation` 才行），
 * 所以我们的监听器照样会被调用。
 *
 * 拿到事件后如果发现 trapFocus 已经把焦点挪走了，我们在处理完动作后把焦点抢回
 * `.mm-root`（见 restoreFocus）。
 */
const liveViews = new Set<{ handleGlobalKey(e: KeyboardEvent): void }>();
let keyDispatchInstalled = false;

function installKeyDispatch() {
    if (keyDispatchInstalled) return;
    keyDispatchInstalled = true;
    document.addEventListener(
        "keydown",
        (e) => {
            const target = e.target as Node | null;
            if (!target) return;
            for (const v of liveViews) v.handleGlobalKey(e);
        },
        true,
    );
}

/* ==================================================================== 图标 */

const ICONS: Record<string, string> = {
    zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20.5 20.5 16 16M11 8.2v5.6M8.2 11h5.6",
    zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20.5 20.5 16 16M8.2 11h5.6",
    fit: "M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5",
    fold: "M8.5 4.5 12 8l3.5-3.5M8.5 19.5 12 16l3.5 3.5M4.5 12h15",
    unfold: "M8.5 8 12 4.5 15.5 8M8.5 16l3.5 3.5L15.5 16M4.5 12h15",
    download: "M12 4v10.5M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15",
    expand: "M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5",
    close: "M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5",
    search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM19.5 19.5 15.4 15.4",
    prev: "M14.5 6 8.5 12l6 6",
    next: "M9.5 6l6 6-6 6",
};

function mkIcon(name: string): SVGSVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", ICONS[name] ?? "");
    svg.appendChild(p);
    return svg;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * 导图视图：负责一棵列表块的解析、布局、绘制与交互。
 * 一个 .list 元素对应一个实例。
 *
 * 焦点三态（键盘归属必须严格分开，否则会和 Protyle 编辑器抢按键）：
 *   浏览态 —— 键盘归思源；单击任意节点进入选中态
 *   选中态 —— 键盘归导图；Esc 或点击空白退出
 *   编辑态 —— 键盘归输入框；Enter 提交 / Esc 取消
 */
export class MindMapView {
    readonly rootEl: HTMLElement;
    private viewportEl: HTMLElement;
    private worldEl: HTMLElement;
    private edgesEl: SVGSVGElement;
    private nodesEl: HTMLElement;
    private toolbarEl: HTMLElement;
    private crumbEl: HTMLElement;
    private zoomBarEl: HTMLElement;
    private minimapEl: HTMLElement;
    private searchEl: HTMLElement;
    private searchInput!: HTMLInputElement;
    private searchCount!: HTMLElement;
    private emptyEl: HTMLElement;
    private tipEl: HTMLElement | null = null;
    private zoomLabel!: HTMLElement;

    private listEl: HTMLElement;
    private options: MMConfig;
    private cb: ViewCallbacks;
    /**
     * 折叠覆盖表（**活引用**，每次 render 现读）。
     *
     * 真相源是 DOM 上的 `fold`；这里只是补「用户刚折完、内核还没把 DOM 更新回来」
     * 那段空窗，否则那次重渲染会把刚折的节点又展开，看着像按钮失灵。
     */
    private getFoldOverlay: () => ReadonlyMap<string, boolean>;

    private tree: MMNode | null = null;
    private byId = new Map<string, MMNode>();

    /** 主选中节点 */
    private selected: MMNode | null = null;
    /** 附加选中（框选 / Ctrl 点选） */
    private extraSel = new Set<MMNode>();

    private scale = 1;
    private tx = 0;
    private ty = 0;
    private worldW = 1;
    private worldH = 1;

    private disposers: Array<() => void> = [];
    private drag: { x: number; y: number; tx: number; ty: number } | null = null;
    private destroyed = false;
    /** 独立容器模式（全屏弹窗）时不接管源列表的显隐 */
    private detached = false;

    /** 正在编辑的节点（编辑期间跳过重渲染，避免打断输入） */
    private editing: MMNode | null = null;

    /** 编辑期间被挡下的渲染请求，退出编辑时补做一次 */
    private pendingRender = false;
    /** 正在拖拽的节点 */
    private dragging: MMNode | null = null;
    /** 当前拖拽落点 */
    private pendingDrop: { target: MMNode; position: MMDropPosition } | null = null;
    /** 拖放指示器 */
    private indicatorEl: HTMLElement | null = null;
    /** 框选矩形 */
    private marqueeEl: HTMLElement | null = null;
    /** 拖拽刚结束，抑制随之而来的 click */
    private suppressClick = false;

    /* --- 新增状态 --- */
    private palette0 = "#4c8dff";
    private canvasRgb: [number, number, number] = [255, 255, 255];
    private gapX = 58;
    private trunkLen = 26;
    private nodeCount = 0;

    private flipHandle = 0;
    private edgePaths: SVGPathElement[] = [];
    private edgeSignature = "";

    /**
     * 搜索命中列表 —— 存的是**块 ID**，不是节点对象。
     *
     * 每次 render() 都会把整棵树重新解析出来，节点对象全是新的；如果这里存对象，
     * 重渲染之后 `hitSet.has(n)` 永远为 false，高亮会**静默全部消失**
     * （实测：搜到 1 条、计数显示 1/1，但画面上一个高亮框都没有）。
     * 存 ID 就能在每次重渲染后按需重新解析。
     */
    private searchHits: string[] = [];
    private searchIdx = -1;
    private searchOpen = false;
    /** 小地图缩放比，更新视口框时复用 */
    private minimapK = 1;

    private clipboard = "";
    private tipTarget: HTMLElement | null = null;
    private hoverExpandTimer = 0;
    private autoScrollTimer = 0;
    private autoScrollDir = { x: 0, y: 0 };

    /**
     * 下钻路径：从「原文根」到「当前聚焦节点」的一串块 ID。
     *
     * 存 ID 而不是节点引用 —— 结构一变（Protyle 重建 DOM、内核回推）旧引用就作废了，
     * 而 ID 每次 render 都能在刚解析出来的树上重新走一遍。
     * 中途某一环被删掉时自动截断到最长的有效前缀，不会让用户卡在空白里。
     */
    private drillPath: string[] = [];

    /** 搜索用的检索串缓存（正文 + 链接地址 + 图片 alt），节点对象重建即失效 */
    private hayCache = new WeakMap<MMNode, string>();

    constructor(
        listEl: HTMLElement,
        options: MMConfig,
        getFoldOverlay: () => ReadonlyMap<string, boolean>,
        cb: ViewCallbacks,
        private title: string,
        private mode: "inline" | "dialog" | "side" = "inline",
    ) {
        this.listEl = listEl;
        this.options = { ...options };
        this.getFoldOverlay = getFoldOverlay;
        this.cb = cb;

        this.rootEl = document.createElement("div");
        this.rootEl.className = "mm-root";
        this.rootEl.dataset.mmFor = listEl.dataset.nodeId ?? "";
        // 导图挂在 contenteditable 的编辑器里，必须显式关掉可编辑，
        // 否则点击节点会落下光标、误改正文。
        this.rootEl.setAttribute("contenteditable", "false");
        this.rootEl.setAttribute("spellcheck", "false");
        // 可聚焦，否则永远收不到 keydown
        this.rootEl.tabIndex = 0;

        this.toolbarEl = document.createElement("div");
        this.toolbarEl.className = "mm-toolbar";

        this.crumbEl = document.createElement("div");
        this.crumbEl.className = "mm-crumb";

        this.viewportEl = document.createElement("div");
        this.viewportEl.className = "mm-viewport";

        this.worldEl = document.createElement("div");
        this.worldEl.className = "mm-world";

        this.edgesEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        this.edgesEl.setAttribute("class", "mm-edges");

        this.nodesEl = document.createElement("div");
        this.nodesEl.className = "mm-nodes";

        this.emptyEl = document.createElement("div");
        this.emptyEl.className = "mm-empty";
        this.emptyEl.innerHTML = "<strong>这里还没有内容</strong><span>在列表里添加条目，导图会实时同步</span>";

        this.zoomBarEl = document.createElement("div");
        this.zoomBarEl.className = "mm-zoombar";

        this.minimapEl = document.createElement("div");
        this.minimapEl.className = "mm-minimap";
        this.minimapEl.style.display = "none";

        this.searchEl = document.createElement("div");
        this.searchEl.className = "mm-search";

        this.worldEl.append(this.edgesEl, this.nodesEl);
        this.viewportEl.append(this.worldEl, this.emptyEl, this.minimapEl, this.zoomBarEl, this.searchEl);
        this.rootEl.append(this.toolbarEl, this.crumbEl, this.viewportEl);
    }

    /* ==================================================================== 挂载 */

    /**
     * 挂载视图。
     * @param container 省略时挂到源列表块内部并隐藏原大纲；传入时作为独立容器使用（全屏弹窗）。
     */
    mount(container?: HTMLElement) {
        this.buildToolbar();
        this.buildZoomBar();
        this.buildSearch();
        if (container) {
            this.detached = true;
            this.rootEl.classList.add(this.mode === "side" ? "mm-root--side" : "mm-root--dialog");
        } else {
            container = this.listEl;
            this.listEl.classList.add("mm-source-hidden");
        }
        container.appendChild(this.rootEl);
        this.bindEvents();
        this.render(true);
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.editing = null;
        this.dragging = null;
        this.pendingDrop = null;
        this.clearIndicator();
        this.hideTip();
        this.tipEl?.remove();
        this.tipEl = null;
        if (this.flipHandle) cancelAnimationFrame(this.flipHandle);
        this.flipHandle = 0;
        window.clearTimeout(this.hoverExpandTimer);
        this.stopAutoScroll();
        this.disposers.forEach((fn) => fn());
        this.disposers = [];
        this.rootEl.remove();
        if (!this.detached) {
            this.listEl.classList.remove("mm-source-hidden");
            this.listEl.removeAttribute("data-mm-mounted");
        }
        this.edgePaths = [];
        this.extraSel.clear();
    }

    get element() {
        return this.rootEl;
    }

    /** 被渲染的源列表元素 */
    get source() {
        return this.listEl;
    }

    /**
     * 换源：指向新的源列表元素。
     *
     * Protyle 在做结构操作（尤其 moveBlock）之后会把整个 `.list` 元素**重建**，
     * 旧元素变成游离节点。行内视图靠「源元素不在文档里就卸载重挂」自然绕过这个问题，
     * 但全屏弹层里的视图活在弹层里、不会跟着源元素一起消失，它会一直握着旧引用 ——
     * 于是 parseList 读到的永远是旧内容，签名永不变化、永不重渲染。
     * 表现出来就是「全屏里做了操作，界面一动不动」，用户会当成不能编辑。
     */
    setSource(el: HTMLElement) {
        if (this.listEl === el) return;
        this.listEl = el;
    }

    /**
     * 把焦点收回导图。
     *
     * 撤销 / 重做会整块重写列表块，Protyle 随之重建 DOM ——
     * 行内视图会被卸载重挂，焦点掉到 body 上，**下一次 Ctrl+Z 就没人接了**。
     * 所以撤销之后要把焦点接回来。
     */
    focusRoot() {
        if (this.destroyed) return;
        this.rootEl.focus({ preventScroll: true });
    }

    /** 只更新渲染参数，不重建视图 */
    setOptions(options: Partial<MMConfig>) {        Object.assign(this.options, options);
        this.syncToolbar();
        this.render(true);
    }

    /* ==================================================================== 工具条 */

    private buildToolbar() {
        // ---- 布局切换 ----
        const seg = document.createElement("div");
        seg.className = "mm-seg";
        for (const key of ["logic", "mind", "tree"] as MMLayout[]) {
            const b = document.createElement("button");
            b.type = "button";
            b.dataset.layout = key;
            b.textContent = LAYOUT_LABEL[key];
            b.dataset.mmTip = LAYOUT_LABEL[key];
            b.onclick = (e) => {
                e.stopPropagation();
                this.options.layout = key;
                this.cb.onLayoutChange(key);
                this.syncToolbar();
                this.render(true);
            };
            seg.appendChild(b);
        }

        const spacer = document.createElement("div");
        spacer.className = "mm-spacer";

        const foldGroup = document.createElement("div");
        foldGroup.className = "mm-group";
        foldGroup.append(
            this.mkToolBtn("fold", "折叠全部", () => this.foldAll(true)),
            this.mkToolBtn("unfold", "展开全部", () => this.foldAll(false)),
        );

        const actGroup = document.createElement("div");
        actGroup.className = "mm-group";
        actGroup.append(this.mkToolBtn("search", "搜索节点", () => this.toggleSearch(), "Ctrl F"));
        actGroup.append(this.mkToolBtn("download", "导出图片", (e) => this.openExportMenu(e)));
        if (this.mode === "inline") {
            actGroup.append(
                this.mkToolBtn("expand", "全屏查看", () => {
                    if (this.tree) this.cb.onFullscreen(this.tree, resolveTheme(this.options.theme));
                }),
            );
        }
        actGroup.append(
            this.mkToolBtn(
                "close",
                this.mode === "dialog" ? "关闭" : "回到大纲视图",
                () => this.cb.onExit(),
            ),
        );

        this.toolbarEl.append(seg, this.mkSep(), foldGroup, spacer, actGroup);
    }

    private mkSep(): HTMLElement {
        const d = document.createElement("div");
        d.className = "mm-sep";
        return d;
    }

    private mkToolBtn(icon: string, tip: string, fn: (e: MouseEvent) => void, key?: string): HTMLButtonElement {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mm-icon";
        b.dataset.mmTip = tip;
        if (key) b.dataset.mmKey = key;
        b.appendChild(mkIcon(icon));
        b.onclick = (e) => {
            e.stopPropagation();
            fn(e);
        };
        return b;
    }

    private buildZoomBar() {
        const mk = (label: string, tip: string, fn: (e: MouseEvent) => void, key?: string) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = label;
            b.dataset.mmTip = tip;
            if (key) b.dataset.mmKey = key;
            b.onclick = (e) => {
                e.stopPropagation();
                fn(e);
            };
            return b;
        };

        const label = document.createElement("button");
        label.type = "button";
        label.className = "mm-zoom-label";
        label.textContent = "100%";
        label.dataset.mmTip = "回到 100%";
        label.dataset.mmKey = "Ctrl 1";
        label.onclick = (e) => {
            e.stopPropagation();
            this.setScale(1);
        };
        this.zoomLabel = label;

        this.zoomBarEl.append(
            mk("−", "缩小", () => this.zoomAt(1 / 1.2), "Ctrl -"),
            label,
            mk("+", "放大", () => this.zoomAt(1.2), "Ctrl ="),
            mk("适应", "适应画布", () => this.fit(), "Ctrl 0"),
        );
    }

    private buildSearch() {
        this.searchInput = document.createElement("input");
        this.searchInput.type = "text";
        this.searchInput.placeholder = "搜索节点…";
        this.searchInput.spellcheck = false;
        this.searchInput.oninput = () => this.runSearch(this.searchInput.value);
        this.searchInput.onkeydown = (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                e.preventDefault();
                this.stepSearch(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
                e.preventDefault();
                this.toggleSearch(false);
            }
        };

        this.searchCount = document.createElement("span");
        this.searchCount.className = "mm-search-count";

        const mk = (text: string, tip: string, fn: () => void) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = text;
            b.dataset.mmTip = tip;
            b.onclick = (e) => {
                e.stopPropagation();
                fn();
            };
            return b;
        };

        this.searchEl.append(
            this.searchInput,
            this.searchCount,
            mk("‹", "上一个", () => this.stepSearch(-1)),
            mk("›", "下一个", () => this.stepSearch(1)),
            mk("✕", "关闭搜索", () => this.toggleSearch(false)),
        );
    }

    private syncToolbar() {
        this.toolbarEl.querySelectorAll<HTMLElement>("[data-layout]").forEach((el) => {
            el.classList.toggle("mm-on", el.dataset.layout === this.options.layout);
        });
    }

    private openExportMenu(event?: MouseEvent) {
        const menu = new Menu("mm-export-menu");
        menu.addItem({
            icon: "iconImage",
            label: "导出 PNG",
            click: () => void this.doExport("png"),
        });
        menu.addItem({
            icon: "iconFile",
            label: "导出 SVG",
            click: () => void this.doExport("svg"),
        });
        if (event) menu.open({ x: event.clientX, y: event.clientY });
        else menu.open({ x: 0, y: 0 });
    }

    private async doExport(kind: "png" | "svg") {
        const restore = this.prepareExport();
        try {
            if (kind === "png") await exportPng(this.rootEl, this.title);
            else await exportSvg(this.rootEl, this.title);
        } catch (err) {
            console.warn("[mindmap] 导出失败", err);
            showMessage("导出失败", 4000, "error");
        } finally {
            restore();
        }
    }

    /** 导出前临时清掉选中 / 搜索 / 悬停 / 动效残留，导出后恢复 */
    private prepareExport(): () => void {
        const root = this.rootEl;
        const prevSel = this.selected;
        const prevExtra = new Set(this.extraSel);
        this.hideTip();
        this.selected = null;
        this.extraSel.clear();
        this.refreshSelection();

        // 动效可能留下 transform / 进场类，导出会把这些状态一起烘进去
        const strip = (n: MMNode) => {
            if (n.el) {
                n.el.style.transform = "";
                n.el.classList.remove("mm-enter");
            }
            n.kids.forEach(strip);
        };
        if (this.tree) strip(this.tree);
        if (this.flipHandle) {
            cancelAnimationFrame(this.flipHandle);
            this.flipHandle = 0;
        }

        root.classList.add("mm-export");
        return () => {
            root.classList.remove("mm-export");
            this.selected = prevSel;
            this.extraSel = prevExtra;
            this.refreshSelection();
        };
    }

    /* ==================================================================== 渲染 */

    /**
     * 重新渲染。
     * @param fitView 是否在渲染后重置视图。只有「用户主动改变结构」时才传 true；
     *                编辑器里打字引起的重渲染必须保持当前平移与缩放，否则画面会一直跳。
     */
    render(fitView = false) {
        if (this.destroyed) return;
        // 编辑期间不重建 DOM，否则会打断正在进行的输入。
        // ⚠️ 但必须记一笔：退出编辑时要补一次渲染，否则「编辑期间发生的内容变化」
        // （点悬停的 + 插入了子节点、别的窗口改了这篇文档）会一直不显示 ——
        // 因为 render() 被挡下之后，没有任何东西会再触发它。
        if (this.editing) {
            this.pendingRender = true;
            return;
        }
        this.pendingRender = false;

        const theme = resolveTheme(this.options.theme);
        const font = getComputedStyle(document.body).fontFamily || "sans-serif";
        applyTheme(this.rootEl, theme, font);
        this.rootEl.classList.toggle("mm-hc", theme.id === "contrast");
        this.palette0 = theme.palette[0];
        this.canvasRgb = readRgb(this.rootEl);

        // FLIP 快照必须在重新布局之前取
        const prev = this.options.flipAnimation && this.tree ? this.snapshot() : null;
        if (this.flipHandle) {
            cancelAnimationFrame(this.flipHandle);
            this.flipHandle = 0;
        }

        /* --- 1. 解析 --- */
        const items = parseList(this.listEl);
        if (items.length === 0) {
            this.tree = null;
            this.byId.clear();
            this.nodesEl.innerHTML = "";
            this.edgesEl.innerHTML = "";
            this.edgePaths = [];
            this.edgeSignature = "";
            this.worldW = 1;
            this.worldH = 1;
            this.worldEl.style.width = "0px";
            this.worldEl.style.height = "0px";
            this.nodeCount = 0;
            this.emptyEl.style.display = "";
            this.refreshSelection();
            this.refreshMinimap();
            return;
        }
        this.emptyEl.style.display = "none";

        const root0 = wrapRoot(items, this.title);
        // 下钻：把当前聚焦的那个节点当成新的根。必须在 decorate 之前完成 ——
        // decorate 会按新的根重新分配 depth / branch / order / color，
        // 换根之后这些量必须整体重算（否则一级分支会被算成第 3 层，配色和缩进全乱）。
        const root = this.applyDrill(root0);
        decorate(root, theme.palette, this.options.branchColor);

        // 折叠态：parseList 已经从 `.li[fold="1"]` 读出来了，这里只把覆盖表盖上。
        //
        // 注意是**双向**的 —— 覆盖表里既可能是 true（刚折）也可能是 false（刚展），
        // 所以不能像以前那样只判 `has()`。
        const overlay = this.getFoldOverlay();
        if (overlay.size > 0) {
            for (const n of flatten(root)) {
                if (!n.id) continue;
                const want = overlay.get(n.id);
                if (want !== undefined) n.folded = want;
            }
        }

        this.tree = root;
        this.byId = indexById(root);

        /* --- 2. 建 DOM 并测量 --- */
        this.nodesEl.innerHTML = "";
        this.edgePaths = [];
        this.edgeSignature = "";

        const all: MMNode[] = [];
        const build = (n: MMNode) => {
            const el = this.createNodeEl(n, theme);
            el.style.visibility = "hidden";
            this.nodesEl.appendChild(el);
            n.el = el;
            all.push(n);
            n.children.forEach(build);
        };
        build(root);
        this.nodeCount = all.length;

        // .mm-node 用 width: max-content，测量结果与容器宽度无关，
        // 所以这里不需要先把 world 撑开。
        //
        // ⚠️ 但必须先把 world 上的 `zoom` 归 1 —— 这是实打实测出来的坑：
        // Chromium 下 `offsetWidth` / `offsetHeight` **会被祖先的 zoom 影响**，
        // 而且不是等比缩放，是「按 zoom 折算成物理像素 → 四舍五入 → 再折回来」。
        // 于是 `zoom: 0.55` 时一个真实 165×57 的节点会量成 167×59
        // （最多多出 1/zoom ≈ 1.8px）。
        //
        // 布局用的正是这些量测值，所以不清 zoom 的话，同一棵树会算出两个画布：
        //   首次渲染（还没缩放过，zoom 为空）→ 1752×2096
        //   之后每次渲染（zoom 已是 0.55）  → 1761×2122
        // 用户看到的就是「刚打开一个样，随便点一下又变成另一个样」——
        // 典型的「布局依赖渲染次序」。实测还发现它会连累分列位置整体偏移 1/3/5/7px。
        const prevZoom = this.worldEl.style.zoom;
        if (prevZoom && prevZoom !== "1") this.worldEl.style.zoom = "1";
        for (const n of all) {
            n.w = n.el!.offsetWidth;
            n.h = n.el!.offsetHeight;
        }
        if (prevZoom && prevZoom !== "1") this.worldEl.style.zoom = prevZoom;

        /* --- 3. 布局 --- */
        const compact = this.options.compact || all.length > this.options.compactThreshold;
        const gapX = compact ? 34 : 58;
        const gapY = compact ? 8 : 16;
        this.gapX = gapX;
        this.trunkLen = Math.max(13, Math.min(gapX * 0.44, 42));

        const box = layout(root, {
            mode: this.options.layout,
            gapX,
            gapY,
            padX: 72,
            padY: 64,
            // 逻辑图分列：单列高度超过可视区的 2.4 倍就摊成多列。
            // 下限 1200 是为了「视口还没量出来」的首次渲染兜底。
            // ⚠️ 这里必须用 availHeight() 而不是 viewportEl.clientHeight —— 后者是
            // 上一轮 resizeViewport 写进去的，会让列数决策依赖渲染次序。
            maxCross: this.options.columnLayout ? Math.max(1200, this.availHeight() * 2.4) : 0,
        });
        this.worldW = box.w;
        this.worldH = box.h;

        this.worldEl.style.width = `${box.w}px`;
        this.worldEl.style.height = `${box.h}px`;
        this.edgesEl.setAttribute("width", String(box.w));
        this.edgesEl.setAttribute("height", String(box.h));
        this.edgesEl.setAttribute("viewBox", `0 0 ${box.w} ${box.h}`);

        /* --- 4. 定位 + 连线 --- */
        const place = (n: MMNode) => {
            const el = n.el!;
            el.style.left = `${n.x}px`;
            el.style.top = `${n.y}px`;
            el.style.visibility = "visible";
            el.classList.toggle("mm-left", n.dir === -1);
            this.applyNodeColors(el, n, theme);
            this.placeToggle(n);
            n.kids.forEach(place);
        };
        place(root);
        this.drawEdges();

        /* --- 5. 尺寸与视图 --- */
        this.resizeViewport(box.h);
        this.refreshSelection();
        this.applySearchMarks();
        this.refreshBreadcrumb();

        // 首次渲染一定自适应；之后只有用户主动改结构时才重置视图。
        // 都走 readable —— 「重新取景」时没人想看到一张 3px 高的地图；
        // 真正的「适应画布」（Ctrl+0 / 工具条按钮）走的是无参 fit()，不受此限。
        if (this.options.autoFit && (fitView || !prev)) this.fit({ readable: true });
        else this.updateTransform();

        /* --- 6. 动效 --- */
        if (prev) this.runFlip(prev);
        this.refreshMinimap();
    }

    /* ================================================================ 下钻与渐进展开 */

    /**
     * 把 drillPath 沿新解析出来的树重走一遍，返回当前该当根的那个节点。
     *
     * 中途某一环没了（被删掉 / 被拖走）就截断到最长的有效前缀 ——
     * 直接整段作废会让用户「莫名其妙回到了全图」，而卡住不返回又会一直显示空白。
     */
    private applyDrill(fallback: MMNode): MMNode {
        if (this.drillPath.length === 0) return fallback;
        let cur: MMNode = fallback;
        const kept: string[] = [];
        for (const id of this.drillPath) {
            const next = cur.children.find((c) => c.id === id);
            if (!next) break;
            cur = next;
            kept.push(id);
        }
        if (kept.length !== this.drillPath.length) this.drillPath = kept;
        return kept.length > 0 ? cur : fallback;
    }

    /**
     * 下钻：只看这一个分支。
     *
     * 交互放在 Ctrl/⌘ + 双击、悬停操作条上的 ⊙、以及右键菜单里 ——
     * 裸双击留给改名（那是更高频的操作，也符合思源/大多数编辑器的习惯）。
     */
    private drillDown(n: MMNode) {
        if (!n.id || n.children.length === 0) return;
        // 从「当前根」走到 n 的这段相对路径，接到 drillPath 后面
        const add: string[] = [];
        let cur: MMNode | null = n;
        while (cur && cur !== this.tree) {
            if (cur.id) add.unshift(cur.id);
            cur = cur.parent;
        }
        this.drillPath = this.drillPath.concat(add);
        this.selected = null;
        this.extraSel.clear();
        this.clipboard = "";
        this.render(true);
    }

    /** 回到第 depth 层（0 = 最外层全图） */
    private drillTo(depth: number) {
        const next = this.drillPath.slice(0, Math.max(0, depth));
        if (next.length === this.drillPath.length) return;
        this.drillPath = next;
        this.selected = null;
        this.extraSel.clear();
        this.render(true);
    }

    private drillUp() {
        if (this.drillPath.length === 0) return;
        this.drillPath.pop();
        this.selected = null;
        this.extraSel.clear();
        this.render(true);
    }

    /* ================================================================ 面包屑 */

    /** 从当前根往上收集各级标题，长度 = drillPath.length + 1 */
    private crumbLabels(): string[] {
        const labels: string[] = [];
        let cur: MMNode | null = this.tree;
        while (cur) {
            labels.unshift(cur.text?.trim() || "（空）");
            cur = cur.parent;
        }
        return labels;
    }

    private refreshBreadcrumb() {
        const on = this.drillPath.length > 0;
        this.crumbEl.classList.toggle("mm-crumb--on", on);
        if (!on) {
            this.crumbEl.textContent = "";
            return;
        }

        const labels = this.crumbLabels();
        this.crumbEl.textContent = "";
        labels.forEach((label, i) => {
            if (i > 0) {
                const sep = document.createElement("span");
                sep.className = "mm-crumb-sep";
                sep.textContent = "›";
                this.crumbEl.appendChild(sep);
            }
            const b = document.createElement("button");
            b.type = "button";
            const last = i === labels.length - 1;
            b.className = `mm-crumb-item${last ? " mm-crumb-cur" : ""}`;
            b.textContent = label;
            b.dataset.mmTip = last ? "当前聚焦的分支" : "回到这一层";
            b.disabled = last;
            b.onclick = (e) => {
                e.stopPropagation();
                this.drillTo(i);
            };
            this.crumbEl.appendChild(b);
        });

        const out = document.createElement("button");
        out.type = "button";
        out.className = "mm-crumb-out";
        out.textContent = "退出聚焦";
        out.dataset.mmTip = "回到全图（Esc）";
        out.onclick = (e) => {
            e.stopPropagation();
            this.drillTo(0);
        };
        this.crumbEl.appendChild(out);
    }

    /** 定位到某个节点并直接进入编辑态（插入新节点后用，见 Scanner 的 pendingEdit） */
    revealAndEdit(id: string): boolean {
        if (this.destroyed) return false;
        const n = this.byId.get(id);
        if (!n) return false;
        this.rootEl.classList.add("mm-kbd");
        this.select(n);
        this.ensureVisible(n);
        // 刚建出来的节点只有占位文字，没有任何用户格式要保护，所以**强制就地编辑**，
        // 不走「含行内格式 → 回源编辑」那条分流 —— 那条分流会退出导图，
        // 用在「插入即编辑」上等于刚加完节点就把人赶走。
        this.beginEdit(n, n.text === NEW_NODE_TEXT);
        return true;
    }

    /** 记录当前每个节点的位置，用于 FLIP */
    private snapshot(): Map<string, { x: number; y: number; w: number; h: number }> {
        const out = new Map<string, { x: number; y: number; w: number; h: number }>();
        const root = this.tree;
        if (!root) return out;
        const walk = (n: MMNode) => {
            if (n.id) out.set(n.id, { x: n.x, y: n.y, w: n.w, h: n.h });
            n.kids.forEach(walk);
        };
        walk(root);
        return out;
    }

    /**
     * FLIP：节点从旧位置滑到新位置，连线同步重绘。
     *
     * 位移完全由 JS 驱动（用 transform 而不是 left/top 过渡），
     * 这样节点与连线的进度可以严格对齐 —— 用 CSS 过渡的话连线会跟不上。
     */
    private runFlip(prev: Map<string, { x: number; y: number; w: number; h: number }>) {
        const root = this.tree;
        if (!root || prev.size === 0) return;
        // 节点太多时关掉动效，避免每帧重算连线
        if (this.nodeCount > 300) return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

        const moving: Array<{ n: MMNode; dx: number; dy: number }> = [];
        const entering: MMNode[] = [];

        const walk = (n: MMNode) => {
            const old = n.id ? prev.get(n.id) : undefined;
            if (old && n.el) {
                const dx = old.x - n.x;
                const dy = old.y - n.y;
                if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moving.push({ n, dx, dy });
            } else if (n.el) {
                entering.push(n);
            }
            n.kids.forEach(walk);
        };
        walk(root);

        if (moving.length === 0 && entering.length === 0) return;

        // 进场节点先置为透明，下一帧去掉标记触发淡入
        for (const n of entering) n.el?.classList.add("mm-enter");
        this.rootEl.classList.add("mm-flip");
        const release = () => {
            this.rootEl.classList.remove("mm-flip");
            for (const n of entering) n.el?.classList.remove("mm-enter");
        };

        if (moving.length === 0) {
            window.requestAnimationFrame(() => window.requestAnimationFrame(release));
            return;
        }

        const rectOf = (n: MMNode, k: number) => {
            const old = n.id ? prev.get(n.id) : undefined;
            if (!old) return { x: n.x, y: n.y, w: n.w, h: n.h, dir: n.dir };
            return {
                x: old.x + (n.x - old.x) * k,
                y: old.y + (n.y - old.y) * k,
                w: old.w + (n.w - old.w) * k,
                h: old.h + (n.h - old.h) * k,
                dir: n.dir,
            };
        };

        const t0 = performance.now();
        const step = (now: number) => {
            if (this.destroyed) return;
            const t = Math.min(1, (now - t0) / FLIP_DURATION);
            const k = easeOut(t);

            for (const m of moving) {
                if (!m.n.el) continue;
                const ox = m.dx * (1 - k);
                const oy = m.dy * (1 - k);
                m.n.el.style.transform = `translate(${ox.toFixed(2)}px,${oy.toFixed(2)}px)`;
            }
            this.drawEdges((n) => rectOf(n, k));

            if (t < 1) {
                this.flipHandle = requestAnimationFrame(step);
            } else {
                for (const m of moving) {
                    if (m.n.el) m.n.el.style.transform = "";
                }
                this.flipHandle = 0;
                this.drawEdges();
                release();
                this.refreshMinimap();
            }
        };
        this.flipHandle = requestAnimationFrame(step);
    }

    /** 按内容高度调整可视区，返回是否发生了变化 */
    private resizeViewport(contentH: number): boolean {
        // 行内视图要按内容高度自适应，并封顶 —— 否则一个 200 节点的列表块会把
        // 整篇文档顶下去几屏。全屏弹层 / 并排面板里画布就是容器本身，直接铺满。
        const avail = this.availHeight();
        const h = Math.min(Math.max(contentH, 260), avail);
        const prev = parseFloat(this.viewportEl.style.height || "0");
        if (Math.abs(prev - h) < 1) return false;
        this.viewportEl.style.height = `${Math.round(h)}px`;
        return true;
    }

    /* ==================================================================== 连线 */

    private drawEdges(getRect?: (n: MMNode) => { x: number; y: number; w: number; h: number; dir: 1 | -1 }) {
        const root = this.tree;
        if (!root) return;
        const rect = getRect ?? ((n: MMNode) => ({ x: n.x, y: n.y, w: n.w, h: n.h, dir: n.dir }));

        const items: Array<{ c: Connector; stroke: string }> = [];

        const walk = (n: MMNode) => {
            if (n.kids.length > 0) {
                const base = Math.max(1.2, 2.8 - n.depth * 0.42);
                const cons = buildConnectors({
                    parent: rect(n),
                    kids: n.kids.map((k) => rect(k)),
                    mode: this.options.layout,
                    style: this.options.edge,
                    gap: this.gapX,
                    base,
                });
                const own = this.edgeColor(n);
                for (const c of cons) {
                    const kid = c.childIndex === null ? null : n.kids[c.childIndex];
                    items.push({ c, stroke: kid ? this.edgeColor(kid, true) : own });
                }
            }
            n.kids.forEach(walk);
        };
        walk(root);

        const signature = items.map((i) => `${i.c.kind}:${i.c.width}`).join("|");

        // 结构没变时只改 d，避免每帧重新解析整段 SVG（FLIP 期间会调用几十次）
        if (signature === this.edgeSignature && this.edgePaths.length === items.length) {
            for (let i = 0; i < items.length; i++) {
                this.edgePaths[i].setAttribute("d", items[i].c.d);
            }
            return;
        }

        const parts: string[] = [];
        for (const { c, stroke } of items) {
            parts.push(
                `<path d="${c.d}" fill="none" stroke="${stroke}" stroke-width="${c.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
            );
        }
        this.edgesEl.innerHTML = parts.join("");
        this.edgeSignature = signature;
        this.edgePaths = Array.from(this.edgesEl.querySelectorAll("path"));
    }

    /** 连线的颜色：分支色与画布底色混成实色，避免主干与支线重叠处叠深 */
    private edgeColor(n: MMNode, isStub = false): string {
        const base = n.color ?? this.palette0;
        const alpha = Math.max(0.46, 0.9 - Math.min(n.depth, 5) * 0.09);
        return mixHex(base, this.canvasRgb, isStub ? alpha : alpha * 0.92);
    }

    private applyNodeColors(el: HTMLElement, n: MMNode, theme: MMTheme) {
        const s = el.style;
        if (n.color) {
            s.setProperty("--c-solid", n.color);
            s.setProperty("--c-bg", hexA(n.color, theme.tint));
            s.setProperty("--c-soft", hexA(n.color, 0.2));
            s.setProperty("--c-border", hexA(n.color, 0.55));
        } else {
            s.setProperty("--c-solid", theme.palette[0]);
            s.setProperty("--c-bg", "transparent");
            s.setProperty("--c-soft", "rgba(255,255,255,.24)");
            s.setProperty("--c-border", "transparent");
        }
    }

    /* ==================================================================== 节点 */

    private createNodeEl(n: MMNode, theme: MMTheme): HTMLElement {
        const el = document.createElement("div");
        const depth = Math.min(n.depth, 4);
        el.className = `mm-node mm-d${depth}`;
        if (n.kind === "task" && n.checked) el.classList.add("mm-done");
        el.dataset.nodeId = n.id;

        // 分支色必须在这里就写好。折叠按钮、复选框、编号都靠 var(--c-solid) 取色，
        // 如果等到后面的 place() 阶段才注入，这些元素第一次计算样式时拿到的是
        // 「未定义」→ 回退成正文色，再靠 150ms 过渡去纠正，视觉上会闪一下。
        this.applyNodeColors(el, n, theme);

        const inner = document.createElement("div");
        inner.className = "mm-inner";

        if (this.options.showOrder && n.numbered && n.depth > 0) {
            const badge = document.createElement("span");
            badge.className = "mm-badge";
            badge.textContent = n.order;
            inner.appendChild(badge);
        }

        if (n.kind === "task") {
            const box = document.createElement("span");
            box.className = `mm-task ${n.checked ? "mm-task--done" : ""}`;
            box.textContent = n.checked ? "✓" : "";
            inner.appendChild(box);
        }

        const txt = document.createElement("span");
        txt.className = "mm-txt";
        txt.innerHTML = n.html;
        inner.appendChild(txt);

        el.appendChild(inner);

        if (n.children.length > 0) {
            const tog = document.createElement("div");
            tog.className = `mm-toggle${n.folded ? " mm-toggle--collapsed" : ""}`;
            tog.textContent = n.folded ? String(n.children.length) : "−";
            tog.dataset.mmTip = n.folded ? `展开 ${n.children.length} 个子节点` : "折叠子节点";
            tog.dataset.mmKey = "空格";
            tog.onclick = (e) => {
                e.stopPropagation();
                this.toggleFold(n);
            };
            el.appendChild(tog);
            n.toggle = tog;
        } else {
            n.toggle = undefined;
        }

        // 悬停快捷操作：把最高频的两个动作从右键菜单里解放出来
        if (n.id) {
            const acts = document.createElement("div");
            acts.className = "mm-acts";

            const add = document.createElement("button");
            add.type = "button";
            add.textContent = "+";
            add.dataset.mmTip = "插入子节点";
            add.dataset.mmKey = "Tab";
            add.onclick = (e) => {
                e.stopPropagation();
                this.cb.onNodeAction("insertChild", n);
            };
            acts.appendChild(add);

            if (n.children.length > 0) {
                const drill = document.createElement("button");
                drill.type = "button";
                drill.textContent = "⊙";
                drill.dataset.mmTip = "聚焦此分支";
                drill.dataset.mmKey = "Ctrl 双击";
                drill.onclick = (e) => {
                    e.stopPropagation();
                    this.drillDown(n);
                };
                acts.appendChild(drill);
            }

            if (n.children.length > 0) {
                const fold = document.createElement("button");
                fold.type = "button";
                fold.textContent = n.folded ? "▸" : "▾";
                fold.dataset.mmTip = n.folded ? "展开" : "折叠";
                fold.onclick = (e) => {
                    e.stopPropagation();
                    this.toggleFold(n);
                };
                acts.appendChild(fold);
            }

            el.appendChild(acts);
            n.acts = acts;
        } else {
            n.acts = undefined;
        }

        el.onclick = (e) => {
            e.stopPropagation();
            // 拖拽刚结束的那次 click 要丢掉
            if (this.suppressClick) return;
            const t = e.target as HTMLElement | null;

            // ⚠️ 编辑态：这一击是用来放 caret / 选词的，绝不能把焦点抢到 rootEl 上。
            // `rootEl.focus()` 会让 .mm-txt 立刻 blur → onBlur 提交并结束编辑，
            // 于是「双击进入编辑后再点一下就被踢出来」，根本没法改字。
            // 编辑的退出路径只有三条：点节点外面、Esc、Enter。
            if (el.hasAttribute(EDIT_FLAG)) return;

            // 图片：单击放大看原图。导图里的图是缩略图，用户点它就是想知道「原图长什么样」，
            // 所以这里直接接管，不再去选中节点。
            const img = t?.closest?.("img") as HTMLImageElement | null;
            if (img) {
                this.zoomImage(img);
                return;
            }

            // 链接 / 双链：Ctrl（macOS 上是 Cmd）或 Alt + 单击打开。
            // 为什么不是裸单击 —— mousedown 上做了 preventDefault（为了不让 Protyle 抢焦点），
            // 裸单击已经是「选中节点」，再占用会打架；而且思源自己的习惯也是 Ctrl+单击开链接。
            const link = t?.closest?.('[data-type="a"], [data-type="block-ref"]') as HTMLElement | null;
            if (link && (e.ctrlKey || e.metaKey || e.altKey)) {
                this.openInlineTarget(link);
                return;
            }

            this.rootEl.focus({ preventScroll: true });
            if (e.shiftKey || e.ctrlKey || e.metaKey) this.toggleMulti(n);
            else this.select(n);
        };
        el.ondblclick = (e) => {
            e.stopPropagation();
            // Ctrl/⌘ + 双击 = 下钻（只看这一支）。
            // 裸双击仍然留给改名 —— 那是更高频的操作，也是思源与大多数编辑器的习惯，
            // 把它换成下钻会让「双击改名」这个肌肉记忆失效。
            if ((e.ctrlKey || e.metaKey) && n.children.length > 0) {
                this.drillDown(n);
                return;
            }
            if (this.options.editable && canEdit(n)) this.beginEdit(n);
            else if (n.id) this.cb.onLocate(n.id);
        };
        el.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.extraSel.has(n) && this.selected !== n) this.select(n);
            this.openNodeMenu(n, e);
        };
        el.onmousedown = (e) => {
            if (e.button !== 0) return;

            if (el.hasAttribute(EDIT_FLAG)) {
                // 编辑态：点在正文里必须放行（要靠浏览器默认行为放 caret / 选词），
                // 点在节点的其它区域（padding、悬停操作条）则拦下 —— 不拦的话
                // 焦点会跑到最近的可聚焦祖先上，.mm-txt 一 blur 编辑就结束了。
                const t = e.target as HTMLElement | null;
                if (!t?.closest?.(".mm-txt")) e.preventDefault();
                return;
            }

            // 别让浏览器把光标放进 Protyle。
            //
            // .mm-root 自己是 contenteditable=false，但它的祖先 .protyle-wysiwyg 是可编辑的，
            // 点节点时浏览器会按默认行为把 caret 放到最近的可编辑祖先上 —— 实测点完节点后
            // document.activeElement 会变成 .protyle-wysiwyg，导图随即失去焦点，
            // 之后按什么键都落到 Protyle 手里，快捷键整套失效。
            // mousedown 上 preventDefault 正是拦这个默认行为的地方。
            e.preventDefault();
            if (!this.options.draggable || !n.id) return;
            this.armDrag(n, e);
        };

        /* ---- 触屏：长按呼出菜单 ----
           移动端既没有 hover（悬停操作条摸不到）也不保证派发 contextmenu
           （iOS Safari 长按是文字选择菜单）。所以自己起一个 500ms 计时器兜住，
           顺带把「选中态常驻操作条」变成触屏上唯一的快捷入口。 */
        let pressTimer = 0;
        const cancelPress = () => {
            if (pressTimer) {
                window.clearTimeout(pressTimer);
                pressTimer = 0;
            }
        };
        el.addEventListener(
            "touchstart",
            (e: TouchEvent) => {
                cancelPress();
                if (e.touches.length !== 1) return;
                const t = e.touches[0];
                pressTimer = window.setTimeout(() => {
                    pressTimer = 0;
                    this.select(n);
                    this.openNodeMenu(n, { clientX: t.clientX, clientY: t.clientY } as MouseEvent);
                }, LONG_PRESS_MS);
            },
            { passive: true },
        );
        el.addEventListener("touchmove", cancelPress, { passive: true });
        el.addEventListener("touchend", cancelPress, { passive: true });
        el.addEventListener("touchcancel", cancelPress, { passive: true });

        return el;
    }

    /** 折叠按钮落在主干中间，像线上的一个珠子 */
    private placeToggle(n: MMNode) {
        const t = n.toggle;
        if (!t) return;
        const size = 15;
        const layoutMode = this.options.layout;

        if (layoutMode === "tree") {
            t.style.left = `${n.w / 2 - size / 2}px`;
            t.style.top = `${n.h + Math.max(4, this.trunkLen / 2 - size / 2)}px`;
            return;
        }

        const left = n.dir === -1 && layoutMode === "mind";
        const offset = Math.max(3, this.trunkLen / 2 - size / 2);
        t.style.left = left ? `${-(size + offset)}px` : `${n.w + offset}px`;
        t.style.top = `${n.h / 2 - size / 2}px`;
    }

    /* ==================================================================== 选中 */

    private select(n: MMNode | null) {
        this.selected = n;
        this.extraSel.clear();
        this.rootEl.classList.remove("mm-kbd");
        this.refreshSelection();
    }

    private toggleMulti(n: MMNode) {
        if (this.selected === n) {
            this.selected = this.extraSel.size ? (this.extraSel.values().next().value as MMNode) : null;
            this.extraSel.delete(n);
        } else if (this.extraSel.has(n)) {
            this.extraSel.delete(n);
        } else {
            if (!this.selected) this.selected = n;
            else this.extraSel.add(n);
        }
        this.refreshSelection();
    }

    /** 全选：第一次同级，第二次整棵树 */
    private selectAllSiblings() {
        const n = this.selected;
        if (!n?.parent) return;
        const sibs = n.parent.children;
        const allSelected = sibs.every((s) => s === this.selected || this.extraSel.has(s));
        if (allSelected) {
            this.selected = this.tree;
            this.extraSel.clear();
            const walk = (x: MMNode) => {
                if (x !== this.tree) this.extraSel.add(x);
                x.kids.forEach(walk);
            };
            if (this.tree) this.tree.kids.forEach(walk);
        } else {
            this.selected = sibs[0];
            this.extraSel = new Set(sibs.slice(1));
        }
        this.refreshSelection();
    }

    private clearSelection() {
        this.selected = null;
        this.extraSel.clear();
        this.refreshSelection();
    }

    private refreshSelection() {
        const root = this.tree;
        if (!root) return;

        const related = new Set<MMNode>();
        const addSubtree = (n: MMNode) => {
            related.add(n);
            n.kids.forEach(addSubtree);
        };
        for (const n of this.extraSel) addSubtree(n);
        if (this.selected) {
            addSubtree(this.selected);
            let cur = this.selected.parent;
            while (cur) {
                related.add(cur);
                cur = cur.parent;
            }
        }

        const hasSel = this.selected !== null || this.extraSel.size > 0;
        const walk = (n: MMNode) => {
            const el = n.el;
            if (el) {
                el.classList.toggle("mm-sel", n === this.selected);
                el.classList.toggle("mm-multi", this.extraSel.has(n));
                el.classList.toggle("mm-dim", hasSel && !related.has(n));
            }
            n.kids.forEach(walk);
        };
        walk(root);
    }

    /** 当前参与批量操作的节点，主选中排在最后（删除时从后往前更安全） */
    private get selNodes(): MMNode[] {
        const list = [...this.extraSel];
        if (this.selected && !this.extraSel.has(this.selected)) list.push(this.selected);
        return list;
    }

    private toggleFold(n: MMNode) {
        n.folded = !n.folded;
        if (n.id) this.cb.onFoldChange(n.id, n.folded);
        this.render();
        // 折叠一个很大的子树之后，画布会明显小于视口 —— 不重新居中的话
        // 整张图会缩在原来那个角落里。
        this.reclampView();
    }

    private foldAll(folded: boolean) {
        const root = this.tree;
        if (!root) return;
        const walk = (n: MMNode) => {
            if (n.children.length > 0 && n !== root) {
                n.folded = folded;
                if (n.id) this.cb.onFoldChange(n.id, folded);
            }
            n.children.forEach(walk);
        };
        walk(root);
        // 「展开全部 / 折叠全部」是全局操作，画布尺寸会成倍变化，
        // 必须重新取景 —— 否则展开之后用户只能看到左上角一小块，
        // 剩下的全靠自己摸索着平移（实测：画布 2437×1552 而缩放还是 1）。
        this.render(true);
    }

    /* ==================================================================== 键盘 */

    /** 让节点进入可视区，必要时平移画布 */
    private ensureVisible(n: MMNode) {
        const vw = this.viewportEl.clientWidth;
        const vh = this.viewportEl.clientHeight;
        const pad = 56;
        const sx = this.tx + n.x * this.scale;
        const sy = this.ty + n.y * this.scale;
        const sw = n.w * this.scale;
        const sh = n.h * this.scale;

        let dx = 0;
        let dy = 0;
        if (sx < pad) dx = pad - sx;
        else if (sx + sw > vw - pad) dx = vw - pad - (sx + sw);
        if (sy < pad) dy = pad - sy;
        else if (sy + sh > vh - pad) dy = vh - pad - (sy + sh);

        if (dx || dy) {
            this.tx += dx;
            this.ty += dy;
            this.updateTransform();
        }
    }

    private focusNode(n: MMNode) {
        this.selected = n;
        this.extraSel.clear();
        this.rootEl.classList.add("mm-kbd");
        this.refreshSelection();
        this.ensureVisible(n);
    }

    /**
     * 方向键导航。
     * ↑↓ 走同级，← 回父节点，→ 进第一个子节点（折叠则先展开）。
     */
    private navigate(dir: "up" | "down" | "left" | "right" | "home" | "end") {
        const cur = this.selected ?? this.tree;
        if (!cur) return;

        if (dir === "left") {
            if (cur.parent) this.focusNode(cur.parent);
            return;
        }
        if (dir === "right") {
            if (cur.children.length === 0) return;
            if (cur.folded) {
                this.toggleFold(cur);
                this.selected = cur;
                this.refreshSelection();
            }
            const first = cur.children[0];
            if (first) this.focusNode(first);
            return;
        }

        const parent = cur.parent;
        if (!parent) return;
        const sibs = parent.children;
        const idx = sibs.indexOf(cur);
        if (idx < 0) return;

        if (dir === "home") {
            this.focusNode(sibs[0]);
            return;
        }
        if (dir === "end") {
            this.focusNode(sibs[sibs.length - 1]);
            return;
        }
        const next = dir === "up" ? idx - 1 : idx + 1;
        if (next < 0 || next >= sibs.length) return;
        this.focusNode(sibs[next]);
    }

    /**
     * 由全局键盘分发器调用（见文件顶部 installKeyDispatch 的注释）。
     * 只有事件目标真的落在本视图里才处理 —— 页面上可能同时存在行内视图与全屏视图，
     * 别互相抢键。
     */
    handleGlobalKey(e: KeyboardEvent) {
        if (this.destroyed) return;
        const t = e.target as Node | null;
        if (!t || !this.rootEl.contains(t)) return;
        this.onKeyDown(e);
        // 只要这一下被我们接管了（preventDefault 就是标记），就把焦点抢回来。
        //
        // 抢的对象有两个，而且都在**同步**阶段发生：
        //   1. 全屏弹层里思源 Dialog 的 trapFocus 会把焦点挪到弹层按钮上；
        //   2. 行内视图里思源的编辑器会在自己的 keydown 监听里
        //      `protyle.wysiwyg.element.focus()` —— 因为 `.mm-root` 就长在
        //      `.protyle-wysiwyg` 里面，按键事件一样会经过它。
        //      实测按 Delete 之后 +2ms 焦点就没了（tests/probe-focus.mjs 里给
        //      HTMLElement.prototype.focus 打桩抓到的调用栈）。
        //
        // 两者都是同步调用，所以一个 setTimeout(0) 就能稳定赢过它们（谁后调用谁赢）。
        if (e.defaultPrevented) this.restoreFocus();
    }

    /**
     * 把焦点抢回导图根元素。
     * 异步做，免得和 trapFocus / 编辑器里同步的 focus() 打架（谁后调用谁赢）。
     */
    private restoreFocus() {
        window.setTimeout(() => {
            if (this.destroyed || this.editing || this.searchOpen) return;
            if (!this.rootEl.isConnected) return;
            if (this.rootEl.contains(document.activeElement)) return;
            this.rootEl.focus({ preventScroll: true });
        }, 0);
    }

    /**
     * 导图内的键盘处理。
     *
     * 与 Protyle 抢按键是本插件最容易翻车的地方：
     * 不拦截的话 Tab 会往正文插制表符、Ctrl+A 会全选整个文档、Delete 会删掉编辑器选区。
     * 所以接管的按键必须 preventDefault + stopPropagation，同时留白名单放行系统级快捷键。
     */
    private onKeyDown(e: KeyboardEvent) {
        if (!this.options.keyboard) return;
        if (this.destroyed) return;
        if (e.isComposing) return;
        // 搜索框自己处理
        if ((e.target as HTMLElement)?.closest?.(".mm-search")) return;
        // 编辑态下键盘归输入框，由 beginEdit 里的处理器负责
        if (this.editing) return;

        const mod = e.ctrlKey || e.metaKey;
        const key = e.key;

        // 白名单：系统级 / 浏览器级快捷键一律放行
        if (mod && !e.altKey) {
            const lower = key.toLowerCase();
            if (lower === "s" || lower === "p" || lower === "w" || lower === "r") return;
            // 撤销 / 重做：思源的 Ctrl+Z **管不到块 API 写出来的内容**
            // （它的事务里 undoOperations 恒为空数组，前端不会把它压进撤销栈），
            // 所以插件得先兜住自己写出去的那些改动。栈空才放行给思源。
            if (lower === "z" || lower === "y") {
                const redo = lower === "y" || e.shiftKey;
                // 这里不能用下面的 take()：它在后面才定义，现在还在 TDZ 里
                const handled = this.cb.onHistory(redo);
                // 反映这次按键插件有没有接住（也方便排查「按了没反应」）。
                // 记在 documentElement 上而不是 rootEl 上：写回会重建列表 DOM、
                // 视图跟着重挂，挂在视图元素上的话，外部刚读到的就是新元素、什么都没有。
                document.documentElement.dataset.mmHistory = handled ? (redo ? "redo" : "undo") : "none";
                if (handled) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                return;
            }
        }
        if (key === "F5" || key === "F11" || key === "F12") return;

        const take = (fn: () => void) => {
            e.preventDefault();
            e.stopPropagation();
            fn();
        };

        const cur = this.selected;

        /* ---- 视图 ---- */
        if (mod && (key === "=" || key === "+")) return take(() => this.zoomAt(1.2));
        if (mod && key === "-") return take(() => this.zoomAt(1 / 1.2));
        if (mod && key === "0") return take(() => this.fit());
        if (mod && key === "1") return take(() => this.setScale(1));
        if (mod && key.toLowerCase() === "f") return take(() => this.toggleSearch(true));
        if (!mod && (key === "f" || key === "F") && this.mode === "inline") {
            if (!this.tree) return;
            return take(() => this.cb.onFullscreen(this.tree!, resolveTheme(this.options.theme)));
        }

        /* ---- 退出 ---- */
        if (key === "Escape") {
            if (this.searchOpen) return take(() => this.toggleSearch(false));
            if (this.extraSel.size) return take(() => this.clearSelection());
            if (this.selected) return take(() => this.clearSelection());
            // 下钻状态下 Esc 逐层退回，比直接 blur 更符合「我在往里面走」的心智
            if (this.drillPath.length > 0) return take(() => this.drillUp());
            return take(() => this.rootEl.blur());
        }

        if (!cur) {
            // 没有选中时，方向键把焦点送到根节点
            if (key.startsWith("Arrow") && this.tree) return take(() => this.focusNode(this.tree!));
            return;
        }

        /* ---- 导航 ---- */
        if (!mod && !e.altKey) {
            if (key === "ArrowUp") return take(() => this.navigate("up"));
            if (key === "ArrowDown") return take(() => this.navigate("down"));
            if (key === "ArrowLeft") return take(() => this.navigate("left"));
            if (key === "ArrowRight") return take(() => this.navigate("right"));
            if (key === "Home") return take(() => this.navigate("home"));
            if (key === "End") return take(() => this.navigate("end"));
            if (key === " ") return take(() => this.toggleFold(cur));
            if (key === "F2") return take(() => this.beginEdit(cur));
            // Shift+Tab 是降级，要留给下面的「结构编辑」分支处理，不能被这里的 Tab 截走。
            // Shift+Enter 在导图里没有对应语义（节点是单行文本，软换行渲染不出来），
            // 吞掉它，避免漏给编辑器在正文里插一个换行。
            if (key === "Enter" && e.shiftKey) return take(() => undefined);
            if (key === "Enter") return take(() => this.cb.onNodeAction("insertSiblingAfter", cur));
            if (key === "Tab" && !e.shiftKey) return take(() => this.cb.onNodeAction("insertChild", cur));
            if (key === "Delete" || key === "Backspace") {
                return take(() => {
                    const targets = this.selNodes.filter(canDelete);
                    if (targets.length === 0) return;
                    // 删除连同子树的节点前确认一次。虽然插件现在自带撤销
                    // （见 history.ts —— 思源的 Ctrl+Z 管不到块 API 写出来的内容），
                    // 但撤销栈有长度上限，误删一大片还是先问一句更稳妥。
                    if (targets.length > 1) {
                        if (window.confirm(`确定删除选中的 ${targets.length} 个节点及其子树？`)) {
                            targets.forEach((t) => this.cb.onNodeAction("delete", t));
                        }
                        return;
                    }
                    const only = targets[0];
                    const kids = only.children.length;
                    if (kids > 0 && !window.confirm(`「${only.text}」下还有 ${kids} 个子节点，一并删除？`)) return;
                    this.cb.onNodeAction("delete", only);
                });
            }
        }

        /* ---- 结构编辑 ---- */
        if (e.shiftKey && key === "Tab") return take(() => this.cb.onNodeAction("outdent", cur));
        if (mod && key === "ArrowUp") return take(() => this.cb.onNodeAction("moveUp", cur));
        if (mod && key === "ArrowDown") return take(() => this.cb.onNodeAction("moveDown", cur));
        if (mod && key.toLowerCase() === "a") return take(() => this.selectAllSiblings());
        if (mod && key.toLowerCase() === "d") return take(() => this.cb.onNodeAction("duplicate", cur));
        if (mod && key.toLowerCase() === "c") {
            return take(() => {
                this.clipboard = serializeSubtree(cur);
                void this.copyNodeText(cur);
            });
        }
        if (mod && key.toLowerCase() === "v") {
            if (!this.clipboard) return;
            const data = this.clipboard;
            return take(() => this.cb.onNodeAction("paste", cur, { data }));
        }
        if (mod && key.toLowerCase() === "x") {
            return take(() => {
                this.clipboard = serializeSubtree(cur);
                void this.copyNodeText(cur);
                this.cb.onNodeAction("delete", cur);
            });
        }

        /* ---- 升降级 ---- */
        if (e.altKey && key === "ArrowLeft") return take(() => this.cb.onNodeAction("outdent", cur));
        if (e.altKey && key === "ArrowRight") return take(() => this.cb.onNodeAction("indent", cur));
    }

    /* ==================================================================== 编辑 */

    /**
     * 进入编辑态。
     *
     * **两条路，按节点内容分流**（这是「改名会抹掉格式」那个数据破坏问题的修法）：
     *
     * - **纯文本节点** → 就地改。写回的是 `escapeMd(textContent)`，不会丢任何东西，
     *   而且不用离开导图，体验最轻快。
     * - **含行内格式的节点**（加粗 / 双链 / 公式 / 图片 / 颜色……）→ **回到源列表改**。
     *   就地编辑提交时只能拿到 `textContent`，双链、公式、加粗会被**静默重建成纯文本**
     *   写进笔记（实测：`加粗 **粗体** 斜体 *斜体*` 改名后只剩 `改过`）。
     *   视觉上因为还原了 `savedHtml` 当场看不出来，所以这条必须堵死。
     *
     * @param force 跳过上面的分流，强制就地编辑。只给「插入即编辑」用 ——
     *   刚建出来的节点只有占位文字，没有任何格式会被写坏，而回源编辑会退出导图。
     */
    private beginEdit(n: MMNode, force = false) {
        if (!this.options.editable || !n.contentId) return;
        const el = n.el;
        if (!el || el.hasAttribute(EDIT_FLAG)) return;

        if (!force && hasInlineFormat(n)) {
            this.cb.onEditInSource(n);
            return;
        }

        const txt = el.querySelector<HTMLElement>(".mm-txt");
        if (!txt) return;

        this.editing = n;
        el.setAttribute(EDIT_FLAG, "1");
        el.classList.add("mm-editing");

        const original = n.text;
        const savedHtml = n.html;
        txt.textContent = original;
        txt.setAttribute("contenteditable", "true");
        txt.setAttribute("spellcheck", "false");

        // 全选，方便直接改写
        try {
            const range = document.createRange();
            range.selectNodeContents(txt);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        } catch {
            /* 选区失败不影响编辑本身 */
        }
        txt.focus();

        let done = false;
        let blurTimer = 0;
        const cleanup = () => {
            txt.removeEventListener("keydown", onKey);
            txt.removeEventListener("blur", onBlur);
            txt.removeEventListener("paste", onPaste);
            if (blurTimer) {
                window.clearTimeout(blurTimer);
                blurTimer = 0;
            }
        };
        const finish = (commit: boolean) => {
            if (done) return;
            done = true;
            cleanup();
            this.editing = null;
            el.removeAttribute(EDIT_FLAG);
            el.classList.remove("mm-editing");
            txt.removeAttribute("contenteditable");

            const next = (txt.textContent ?? "").replace(/\s+/g, " ").trim();
            txt.innerHTML = savedHtml; // 先还原；提交成功后外部会整体重渲染
            if (commit && !this.destroyed && next && next !== original) this.cb.onRename(n, next);

            // 补做编辑期间被挡下的渲染。
            // 延后一拍：此刻还在 blur / keydown 的处理栈里，直接重建 DOM
            // 会和浏览器的焦点处理打架。
            if (this.pendingRender) {
                this.pendingRender = false;
                window.setTimeout(() => {
                    if (!this.destroyed && !this.editing) this.render();
                }, 0);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                e.preventDefault();
                finish(true);
            } else if (e.key === "Escape") {
                e.preventDefault();
                finish(false);
            }
        };
        /**
         * 失焦提交。
         *
         * ⚠️ 必须延后一拍再判断，而且要先确认焦点没落回本节点内部：
         * 点节点 padding、点悬停操作条这类操作都会让 txt 先 blur，
         * 紧接着焦点又回到节点里 —— 直接提交的话，用户会莫名其妙被踢出编辑态。
         */
        const onBlur = () => {
            if (blurTimer) window.clearTimeout(blurTimer);
            blurTimer = window.setTimeout(() => {
                blurTimer = 0;
                if (done || this.destroyed) return;
                const ae = document.activeElement;
                if (ae && el.contains(ae)) return; // 焦点还在本节点里 → 继续编辑
                finish(true);
            }, 0);
        };
        const onPaste = (e: ClipboardEvent) => {
            // 强制纯文本，避免把富文本结构粘进节点
            e.preventDefault();
            const text = e.clipboardData?.getData("text/plain") ?? "";
            document.execCommand("insertText", false, text);
        };

        txt.addEventListener("keydown", onKey);
        txt.addEventListener("blur", onBlur);
        txt.addEventListener("paste", onPaste);
    }

    /* ==================================================================== 行内交互 */

    /**
     * 打开节点里的链接 / 双链。
     *
     * 之前这两个元素在导图里**完全点不动**：`mousedown` 上为了保焦点做了 preventDefault，
     * 裸单击又是「选中节点」，没有任何入口能打开它们。
     */
    private openInlineTarget(el: HTMLElement) {
        const type = el.dataset.type;
        if (type === "a") {
            const href = el.dataset.href || el.getAttribute("href") || "";
            if (href) window.open(href, "_blank", "noopener,noreferrer");
            else showMessage("这个链接没有地址", 2000);
            return;
        }
        const id = el.dataset.id;
        if (id) this.cb.onOpenBlock(id);
        else showMessage("这个双链没有目标块", 2000);
    }

    /** 图片放大：遮罩层里看原图，点任意处或 Esc 关闭 */
    private zoomImage(img: HTMLImageElement) {
        const src = img.currentSrc || img.src;
        if (!src) return;

        const mask = document.createElement("div");
        mask.className = "mm-lightbox";
        mask.setAttribute("contenteditable", "false");

        const big = document.createElement("img");
        big.src = src;
        big.alt = img.alt || "";

        mask.appendChild(big);

        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            close();
        };
        const close = () => {
            document.removeEventListener("keydown", onKey, true);
            mask.remove();
        };

        mask.onclick = (e) => {
            e.stopPropagation();
            close();
        };
        // 捕获阶段监听：思源的 Dialog / Protyle 会抢键盘，Esc 得先到我们手里
        document.addEventListener("keydown", onKey, true);
        document.body.appendChild(mask);
    }

    /* ==================================================================== 菜单 */

    private openNodeMenu(n: MMNode, event: MouseEvent) {
        const menu = new Menu("mm-node-menu");
        const act = (kind: MMActionKind, opts?: MMActionExtra) => {
            this.cb.onNodeAction(kind, n, opts);
        };
        const item = (label: string, key: string, disabled: boolean, click: () => void) => {
            menu.addItem({ label: key ? `${label}    ${key}` : label, disabled, click });
        };

        const rich = hasInlineFormat(n);
        item(rich ? "回到原文编辑（保留格式）" : "编辑文字", "F2", !this.options.editable || !canEdit(n), () =>
            this.beginEdit(n),
        );
        item("插入子节点", "Tab", false, () => act("insertChild"));
        item("在下方插入", "Enter", false, () => act("insertSiblingAfter"));
        if (n.children.length > 0) {
            item("聚焦此分支（只看这一支）", "Ctrl 双击", false, () => this.drillDown(n));
        }
        if (this.drillPath.length > 0) {
            item("退出聚焦，回到全图", "Esc", false, () => this.drillTo(0));
        }
        menu.addItem({ type: "separator" });
        item("上移", "Ctrl ↑", !canMoveUp(n), () => act("moveUp"));
        item("下移", "Ctrl ↓", !canMoveDown(n), () => act("moveDown"));
        item("降级为上一个节点的子节点", "Alt →", !canIndent(n), () => act("indent"));
        item("升级为父节点的兄弟", "Alt ←", !canOutdent(n), () => act("outdent"));
        menu.addItem({ type: "separator" });
        if (n.children.length > 0) {
            item(n.folded ? `展开（${n.children.length} 个子节点）` : "折叠子节点", "空格", false, () => this.toggleFold(n));
        }
        item("复制子树", "Ctrl C", false, () => {
            this.clipboard = serializeSubtree(n);
            void this.copyNodeText(n);
        });
        item("快速复制", "Ctrl D", !n.id, () => act("duplicate"));
        item("复制文字", "", false, () => void this.copyNodeText(n));
        item("定位到编辑器", "", !n.id, () => this.cb.onLocate(n.id));
        menu.addItem({ type: "separator" });
        item(
            n.children.length > 0 ? `删除节点（含 ${n.children.length} 个子节点）` : "删除节点",
            "Delete",
            !canDelete(n),
            () => act("delete"),
        );

        menu.open({ x: event.clientX, y: event.clientY });
    }

    /* ==================================================================== 拖拽 */

    /** 记录按下位置，移动超过阈值才真正进入拖拽，避免与点击冲突 */
    private armDrag(n: MMNode, down: MouseEvent) {
        const startX = down.clientX;
        const startY = down.clientY;
        let active = false;

        const onMove = (e: MouseEvent) => {
            if (!active) {
                if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) {
                    return;
                }
                active = true;
                this.dragging = n;
                this.hideTip();
                this.rootEl.classList.add("mm-drag-active");
                n.el?.classList.add("mm-dragging");
            }
            e.preventDefault();
            this.updateDropTarget(n, e);
            this.autoScroll(e);
        };

        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            this.rootEl.classList.remove("mm-drag-active");
            n.el?.classList.remove("mm-dragging");
            this.clearIndicator();
            this.stopAutoScroll();
            window.clearTimeout(this.hoverExpandTimer);
            this.dragging = null;

            if (!active) return;
            // 丢掉拖拽结束后紧跟着的那次 click
            this.suppressClick = true;
            window.setTimeout(() => {
                this.suppressClick = false;
            }, 0);

            const drop = this.pendingDrop;
            this.pendingDrop = null;
            if (drop) this.cb.onNodeAction("move", n, { target: drop.target, position: drop.position });
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }

    /** 拖到画布边缘时自动平移 */
    private autoScroll(e: MouseEvent) {
        const r = this.viewportEl.getBoundingClientRect();
        const dx = e.clientX - r.left;
        const dy = e.clientY - r.top;
        let sx = 0;
        let sy = 0;
        if (dx < AUTO_SCROLL_MARGIN) sx = -1;
        else if (dx > r.width - AUTO_SCROLL_MARGIN) sx = 1;
        if (dy < AUTO_SCROLL_MARGIN) sy = -1;
        else if (dy > r.height - AUTO_SCROLL_MARGIN) sy = 1;

        if (sx === 0 && sy === 0) {
            this.stopAutoScroll();
            return;
        }
        this.autoScrollDir = { x: sx, y: sy };
        if (this.autoScrollTimer) return;

        const tick = () => {
            if (!this.dragging || this.destroyed) {
                this.stopAutoScroll();
                return;
            }
            this.tx -= this.autoScrollDir.x * AUTO_SCROLL_SPEED;
            this.ty -= this.autoScrollDir.y * AUTO_SCROLL_SPEED;
            this.updateTransform();
            this.autoScrollTimer = window.setTimeout(tick, 16);
        };
        this.autoScrollTimer = window.setTimeout(tick, 16);
    }

    private stopAutoScroll() {
        window.clearTimeout(this.autoScrollTimer);
        this.autoScrollTimer = 0;
        this.autoScrollDir = { x: 0, y: 0 };
    }

    private updateDropTarget(source: MMNode, e: MouseEvent) {
        const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(
            ".mm-node",
        );
        const target = hit ? this.byId.get(hit.dataset.nodeId ?? "") : null;

        // 不能落在自己身上，也不能落进自己的子树
        if (!hit || !target || target === source || isAncestor(source, target)) {
            this.pendingDrop = null;
            window.clearTimeout(this.hoverExpandTimer);
            this.clearIndicator();
            return;
        }

        const rect = hit.getBoundingClientRect();
        const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
        const position: MMDropPosition =
            ratio < DROP_BEFORE_RATIO ? "before" : ratio > DROP_AFTER_RATIO ? "after" : "child";

        this.pendingDrop = { target, position };
        this.showIndicator(hit, position);

        // 悬停在折叠节点上稍作停留就自动展开，方便拖进深层
        window.clearTimeout(this.hoverExpandTimer);
        if (position === "child" && target.folded && target.children.length > 0) {
            this.hoverExpandTimer = window.setTimeout(() => {
                if (this.dragging && this.pendingDrop?.target === target) {
                    target.folded = false;
                    if (target.id) this.cb.onFoldChange(target.id, false);
                    this.render();
                }
            }, HOVER_EXPAND_DELAY);
        }
    }

    /** 指示器画在 world 坐标系内，所以要把屏幕坐标除以当前缩放 */
    private showIndicator(targetEl: HTMLElement, position: MMDropPosition) {
        if (!this.indicatorEl) {
            this.indicatorEl = document.createElement("div");
            this.worldEl.appendChild(this.indicatorEl);
        }
        const ind = this.indicatorEl;
        const k = this.scale || 1;
        const wr = this.worldEl.getBoundingClientRect();
        const tr = targetEl.getBoundingClientRect();
        const left = (tr.left - wr.left) / k;
        const top = (tr.top - wr.top) / k;
        const w = tr.width / k;
        const h = tr.height / k;

        if (position === "child") {
            ind.className = "mm-drop mm-drop--child";
            ind.style.left = `${left - 5}px`;
            ind.style.top = `${top - 5}px`;
            ind.style.width = `${w + 10}px`;
            ind.style.height = `${h + 10}px`;
        } else {
            ind.className = "mm-drop mm-drop--line";
            ind.style.left = `${left - 8}px`;
            ind.style.top = `${position === "before" ? top - 3 : top + h - 1}px`;
            ind.style.width = `${w + 16}px`;
            ind.style.height = "2px";
        }
    }

    private clearIndicator() {
        this.indicatorEl?.remove();
        this.indicatorEl = null;
    }

    private async copyNodeText(n: MMNode) {
        const ok = await copyText(n.text);
        if (ok) showMessage("已复制节点文字");
        else showMessage("复制失败", 4000, "error");
    }

    /* ==================================================================== 搜索 */

    private toggleSearch(open?: boolean) {
        const next = open ?? !this.searchOpen;
        this.searchOpen = next;
        this.searchEl.classList.toggle("mm-search--on", next);
        if (next) {
            this.searchInput.focus();
            this.searchInput.select();
            this.runSearch(this.searchInput.value);
        } else {
            this.searchInput.value = "";
            this.searchHits = [];
            this.searchIdx = -1;
            this.applySearchMarks();
            this.rootEl.focus({ preventScroll: true });
        }
    }

    /**
     * 检索串：正文 + 链接地址 + 图片 alt / title。
     *
     * 之前只搜 `n.text`，于是「按双链目标找节点」「按图片名找节点」都搜不到 ——
     * 而这两样恰好是导图里最常见的两种富内容。链接地址与 alt 只活在行内 HTML 里，
     * 纯文本里一个字都看不到（双链的锚文本在 text 里，但目标块 ID / 标题不在）。
     */
    private searchHay(n: MMNode): string {
        let hay = this.hayCache.get(n);
        if (hay !== undefined) return hay;
        hay = n.text.toLowerCase();
        const html = n.html ?? "";
        if (html) {
            const extra = html.match(/(?:data-href|alt|title)="[^"]*"/g);
            if (extra) hay += " " + extra.join(" ").toLowerCase();
        }
        this.hayCache.set(n, hay);
        return hay;
    }

    private runSearch(q: string) {
        const root = this.tree;
        this.searchHits = [];
        const needle = q.trim().toLowerCase();
        if (root && needle) {
            const walk = (n: MMNode) => {
                if (n.id && this.searchHay(n).includes(needle)) this.searchHits.push(n.id);
                n.children.forEach(walk);
            };
            walk(root);
        }
        this.searchIdx = this.searchHits.length > 0 ? 0 : -1;
        this.updateSearchCount();
        this.applySearchMarks();
        if (this.searchIdx >= 0) this.gotoHit();
    }

    private stepSearch(delta: number) {
        if (this.searchHits.length === 0) return;
        this.searchIdx = (this.searchIdx + delta + this.searchHits.length) % this.searchHits.length;
        this.updateSearchCount();
        this.applySearchMarks();
        this.gotoHit();
    }

    private updateSearchCount() {
        const n = this.searchHits.length;
        this.searchCount.textContent = n === 0 ? (this.searchInput.value ? "无结果" : "") : `${this.searchIdx + 1}/${n}`;
    }

    /** 命中项可能在折叠的子树里，先展开祖先 */
    private gotoHit() {
        const id = this.searchHits[this.searchIdx];
        if (!id) return;
        let hit = this.byId.get(id);
        if (!hit) return;
        let unfolded = false;
        let cur = hit.parent;
        while (cur) {
            if (cur.folded) {
                cur.folded = false;
                if (cur.id) this.cb.onFoldChange(cur.id, false);
                unfolded = true;
            }
            cur = cur.parent;
        }
        if (unfolded) {
            this.render();
            // render() 重建了整棵树，上面那个引用已经作废 —— 按 ID 重新取一次
            hit = this.byId.get(id);
            if (!hit) return;
        }
        this.focusNode(hit);
        // 命中项如果落在「不可读」的缩放下（大图按过 Ctrl+0 之后很常见），
        // 先把视图拉回可读，否则用户看到的只是「一片色块上多了个高亮框」。
        if (this.scale < READABLE_SCALE) {
            this.setScale(READABLE_SCALE);
            this.ensureVisible(hit);
        }
    }

    private applySearchMarks() {
        const root = this.tree;
        if (!root) return;
        const hitSet = new Set(this.searchHits);
        const current = this.searchHits[this.searchIdx];
        const walk = (n: MMNode) => {
            const el = n.el;
            if (el) {
                el.classList.toggle("mm-hit", hitSet.has(n.id));
                el.classList.toggle("mm-hit-cur", n.id === current);
            }
            n.kids.forEach(walk);
        };
        walk(root);
    }

    /* ==================================================================== 小地图 */

    private refreshMinimap() {
        const root = this.tree;
        const on = !!this.options.minimap && !!root && this.nodeCount >= MINIMAP_MIN_NODES;
        if (!on) {
            this.minimapEl.style.display = "none";
            this.minimapEl.innerHTML = "";
            return;
        }

        const MW = 156;
        const MH = 108;
        const k = Math.min(MW / Math.max(this.worldW, 1), MH / Math.max(this.worldH, 1));
        const w = Math.max(1, this.worldW * k);
        const h = Math.max(1, this.worldH * k);

        this.minimapEl.style.display = "";
        this.minimapEl.style.width = `${Math.ceil(w) + 2}px`;
        this.minimapEl.style.height = `${Math.ceil(h) + 2}px`;

        const step = Math.max(1, Math.ceil(this.nodeCount / MINIMAP_MAX_RECTS));
        const rects: string[] = [];
        let i = 0;
        const walk = (n: MMNode) => {
            if (i++ % step === 0) {
                const x = (n.x * k).toFixed(1);
                const y = (n.y * k).toFixed(1);
                const nw = Math.max(1.5, n.w * k).toFixed(1);
                const nh = Math.max(1.2, n.h * k).toFixed(1);
                const fill = n.color ?? this.palette0;
                rects.push(`<rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="1" fill="${fill}" opacity=".72"/>`);
            }
            n.kids.forEach(walk);
        };
        walk(root);

        const vw = this.viewportEl.clientWidth;
        const vh = this.viewportEl.clientHeight;
        const vx = (-this.tx / this.scale) * k;
        const vy = (-this.ty / this.scale) * k;
        const vw2 = (vw / this.scale) * k;
        const vh2 = (vh / this.scale) * k;

        this.minimapEl.innerHTML = [
            `<svg width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}">`,
            rects.join(""),
            `<rect class="mm-mm-view" x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw2.toFixed(1)}" height="${vh2.toFixed(1)}" rx="2"/>`,
            `</svg>`,
        ].join("");

        this.minimapK = k;
        this.updateMinimapView();
    }

    /** 只更新视口框。平移时每帧都会调用，所以不能整块重建 */
    private updateMinimapView() {
        if (this.minimapEl.style.display === "none") return;
        const box = this.minimapEl.querySelector<SVGRectElement>(".mm-mm-view");
        if (!box) return;
        const k = this.minimapK;
        const vw = this.viewportEl.clientWidth;
        const vh = this.viewportEl.clientHeight;
        box.setAttribute("x", ((-this.tx / this.scale) * k).toFixed(1));
        box.setAttribute("y", ((-this.ty / this.scale) * k).toFixed(1));
        box.setAttribute("width", ((vw / this.scale) * k).toFixed(1));
        box.setAttribute("height", ((vh / this.scale) * k).toFixed(1));
    }

    private onMinimapDown(e: MouseEvent) {
        if (!this.tree) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = this.minimapEl.getBoundingClientRect();
        const MW = 156;
        const MH = 108;
        const k = Math.min(MW / Math.max(this.worldW, 1), MH / Math.max(this.worldH, 1));

        const center = (ev: MouseEvent) => {
            const wx = (ev.clientX - rect.left) / k;
            const wy = (ev.clientY - rect.top) / k;
            this.tx = this.viewportEl.clientWidth / 2 - wx * this.scale;
            this.ty = this.viewportEl.clientHeight / 2 - wy * this.scale;
            this.updateTransform();
        };
        center(e);

        const onMove = (ev: MouseEvent) => center(ev);
        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }

    /* ==================================================================== 框选 */

    private startMarquee(down: MouseEvent) {
        const vr = this.viewportEl.getBoundingClientRect();
        const startX = down.clientX - vr.left;
        const startY = down.clientY - vr.top;
        let active = false;

        const onMove = (e: MouseEvent) => {
            const cx = e.clientX - vr.left;
            const cy = e.clientY - vr.top;
            if (!active) {
                if (Math.abs(cx - startX) < DRAG_THRESHOLD && Math.abs(cy - startY) < DRAG_THRESHOLD) return;
                active = true;
                this.marqueeEl = document.createElement("div");
                this.marqueeEl.className = "mm-marquee";
                this.viewportEl.appendChild(this.marqueeEl);
            }
            const x = Math.min(startX, cx);
            const y = Math.min(startY, cy);
            const w = Math.abs(cx - startX);
            const h = Math.abs(cy - startY);
            if (this.marqueeEl) {
                this.marqueeEl.style.left = `${x}px`;
                this.marqueeEl.style.top = `${y}px`;
                this.marqueeEl.style.width = `${w}px`;
                this.marqueeEl.style.height = `${h}px`;
            }
        };

        const onUp = (e: MouseEvent) => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            this.marqueeEl?.remove();
            this.marqueeEl = null;
            if (!active || !this.tree) return;

            const cx = e.clientX - vr.left;
            const cy = e.clientY - vr.top;
            const x0 = Math.min(startX, cx);
            const y0 = Math.min(startY, cy);
            const x1 = Math.max(startX, cx);
            const y1 = Math.max(startY, cy);

            const hits: MMNode[] = [];
            const walk = (n: MMNode) => {
                const sx = this.tx + n.x * this.scale;
                const sy = this.ty + n.y * this.scale;
                const sw = n.w * this.scale;
                const sh = n.h * this.scale;
                if (sx + sw >= x0 && sx <= x1 && sy + sh >= y0 && sy <= y1) hits.push(n);
                n.kids.forEach(walk);
            };
            walk(this.tree);

            if (hits.length === 0) {
                this.clearSelection();
            } else {
                this.selected = hits[0];
                this.extraSel = new Set(hits.slice(1));
                this.refreshSelection();
            }
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }

    /* ==================================================================== 提示 */

    private showTip(el: HTMLElement) {
        const text = el.dataset.mmTip;
        if (!text) return;
        if (!this.tipEl) {
            this.tipEl = document.createElement("div");
            this.tipEl.className = "mm-tip";
            document.body.appendChild(this.tipEl);
        }
        const tip = this.tipEl;
        if (this.tipTarget === el && tip.classList.contains("mm-tip--on")) return;

        this.tipTarget = el;
        tip.textContent = text;
        const key = el.dataset.mmKey;
        if (key) {
            const kbd = document.createElement("kbd");
            kbd.textContent = key;
            tip.appendChild(kbd);
        }

        tip.classList.add("mm-tip--on");
        const r = el.getBoundingClientRect();
        const tr = tip.getBoundingClientRect();
        let left = r.left + r.width / 2 - tr.width / 2;
        let top = r.bottom + 8;
        if (top + tr.height > window.innerHeight - 4) top = r.top - tr.height - 8;
        left = Math.min(Math.max(left, 4), window.innerWidth - tr.width - 4);
        top = Math.min(Math.max(top, 4), window.innerHeight - tr.height - 4);
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
    }

    private hideTip() {
        this.tipTarget = null;
        this.tipEl?.classList.remove("mm-tip--on");
    }

    /* ==================================================================== 变换 */

    /**
     * 适应视口。
     *
     * 两种语义：
     *
     * - **默认（适应画布）**：把整张图缩到刚好铺满，缩到多小都认。
     *   这是用户主动要全貌时的行为（工具条按钮 / Ctrl+0 / 双击空白）。
     * - **readable（可读优先）**：只在**首次进入**时用。缩放不低于 `READABLE_SCALE`，
     *   宁可让用户平移也不把图压成一片色块；并且把视口对齐到**根节点**，
     *   而不是整张画布的中心 —— 大图时画布中心离根节点很远（实测 64 节点画布
     *   742×3406，中心在 y≈1700，那里是第五层的一堆叶子），
     *   按画布中心对齐等于把用户直接丢进一片无关的枝叶里。
     */
    private fit(opts?: { readable?: boolean }) {
        const w = this.worldW;
        const h = this.worldH;
        const vw = this.viewportEl.clientWidth;
        const vh = this.viewportEl.clientHeight;
        if (w <= 1 || h <= 1 || vw <= 1 || vh <= 1) return;

        const exact = Math.min(vw / w, vh / h, 2);
        const readable = opts?.readable === true && exact < READABLE_SCALE;

        if (!readable) {
            // 上限给到 2：小图（两三个节点）「适应画布」时放大到铺满更好看，
            // 1.15 那种保守值在大屏上等于没适应。再大就该用户自己调了。
            this.scale = Math.max(MIN_SCALE, exact);
            this.tx = (vw - w * this.scale) / 2;
            this.ty = (vh - h * this.scale) / 2;
            this.updateTransform();
            return;
        }

        this.scale = READABLE_SCALE;
        const r = this.tree;
        const rx = (r ? r.x + r.w / 2 : w / 2) * this.scale;
        const ry = (r ? r.y + r.h / 2 : h / 2) * this.scale;

        // 每种布局的生长方向不同，锚点也跟着不同：
        // 逻辑图向右长（根靠左），树状图向下长（根靠上），思维导图左右对称（根居中）。
        const layoutMode = this.options.layout;
        const anchorX = layoutMode === "logic" ? vw * 0.3 : vw / 2;
        const anchorY = layoutMode === "tree" ? vh * 0.26 : vh / 2;
        this.tx = this.frameAxis(anchorX - rx, w * this.scale, vw);
        this.ty = this.frameAxis(anchorY - ry, h * this.scale, vh);
        this.updateTransform();
    }

    /**
     * 把一个轴的平移量钳进「不无谓留白、也不无谓裁切」的范围。
     *
     * 可读优先模式下内容常常比视口大，这时「根节点放在 30% 处」会同时造成两个后果：
     * 左边白白空掉三成，右边却被裁掉更多 —— 用户看到的就是「错位」。
     * 实测：内容宽 1017px、视口 942px 时，左空 228px 而右裁 225px。
     *
     * 钳制规则：
     *   装得下 → 居中（此时锚点没有意义，居中最好看）
     *   装不下 → 夹进 [v - c - M, M]，保证视口被内容铺满，不出现「一边空一大片」
     *
     * @param want 按锚点算出来的期望平移量
     * @param c    该轴上的内容尺寸（已乘缩放）
     * @param v    该轴上的视口尺寸
     */
    private frameAxis(want: number, c: number, v: number): number {
        const M = 28;
        if (c <= v - M * 2) return (v - c) / 2;
        return Math.min(M, Math.max(v - c - M, want));
    }

    /**
     * 可视区高度的「稳定值」。
     *
     * ⚠️ 不能直接读 `viewportEl.clientHeight` —— 那个值正是上一轮 `resizeViewport`
     * 写进去的，用它算布局参数（maxCross / 分列阈值）会让**布局依赖渲染次序**：
     * 首轮读到的还是 CSS 默认值，之后读到的是真实值，同一份数据会算出不同列数。
     * 这里只依赖窗口 / 容器尺寸，与渲染历史无关。
     */
    private availHeight(): number {
        if (this.detached) {
            const chrome = this.toolbarEl.offsetHeight + this.crumbEl.offsetHeight;
            const own = this.rootEl.clientHeight - chrome;
            if (own > 40) return own;
        }
        return Math.max(280, window.innerHeight * 0.76);
    }

    /**
     * 内容尺寸变了之后，把视图重新夹回合理范围（保持缩放）。
     *
     * 折叠 / 展开会让画布尺寸剧变，但 `scale / tx / ty` 是原样留着的 ——
     * 于是视口停在原地、内容大范围溢出到屏幕外，看起来就是「节点错位」。
     * 实测：展开全部后画布从 661×688 涨到 2437×1552，而缩放仍是 1，
     * 用户只能看到 38%×47% 的一角。
     *
     * ⚠️ 只在「内容装得下」时居中。内容比视口大时不碰 —— 那多半是用户
     * 特意放大后平移到某个角落看细节，替他把视图挪回去是帮倒忙。
     */
    private reclampView() {
        const vw = this.viewportEl.clientWidth;
        const vh = this.viewportEl.clientHeight;
        if (vw <= 1 || vh <= 1) return;
        const M = 28;
        const cw = this.worldW * this.scale;
        const ch = this.worldH * this.scale;
        let moved = false;
        if (cw <= vw - M * 2) {
            this.tx = (vw - cw) / 2;
            moved = true;
        }
        if (ch <= vh - M * 2) {
            this.ty = (vh - ch) / 2;
            moved = true;
        }
        if (moved) this.updateTransform();
    }

    private setScale(next: number, cx?: number, cy?: number) {
        const vw = this.viewportEl.clientWidth;
        const vh = this.viewportEl.clientHeight;
        const px = cx ?? vw / 2;
        const py = cy ?? vh / 2;
        const clamped = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
        const k = clamped / this.scale;
        this.tx = px - (px - this.tx) * k;
        this.ty = py - (py - this.ty) * k;
        this.scale = clamped;
        this.updateTransform();
    }

    private zoomAt(factor: number, cx?: number, cy?: number) {
        this.setScale(this.scale * factor, cx, cy);
    }

    /**
     * 应用当前缩放与平移。
     *
     * ⚠️ 缩放用 `zoom` 而不是 `transform: scale()`。
     *
     * `transform: scale()` 走的是「先把整棵子树画成一张位图，再交给合成器放大」的路径。
     * 合成器会缓存这张位图，一旦它用的还是旧的低栅格化倍率，放大后整棵子树就会糊
     * —— 而且糊得很均匀：文字、1.5px 描边、SVG 连线一起糊，因为它们是同一张位图。
     * 用户反馈的「放大后变模糊」就是这个现象（实测截图里 1.5px 圆环被拉成了十几像素的软边）。
     *
     * `zoom` 是布局级的缩放：浏览器直接按最终尺寸排版并栅格化，不存在「放大一张位图」这一步，
     * 所以无论放大到多少倍，文字与矢量线条都是按目标分辨率重新绘制的。
     *
     * 代价是 `zoom` 会把元素自身的长度（含 `transform: translate`）一起放大，
     * 所以屏幕位移要除以缩放比再写回去。
     */
    private updateTransform() {
        const s = this.scale || 1;
        this.worldEl.style.zoom = String(s);
        this.worldEl.style.transform = `translate(${this.tx / s}px,${this.ty / s}px)`;
        if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
        this.hideTip();
        this.updateMinimapView();
    }

    /* ==================================================================== 事件 */

    private bindEvents() {
        const on = <K extends keyof HTMLElementEventMap>(
            target: EventTarget,
            type: K | string,
            fn: (e: any) => void,
            opts?: AddEventListenerOptions,
        ) => {
            target.addEventListener(type as string, fn as EventListener, opts);
            this.disposers.push(() => target.removeEventListener(type as string, fn as EventListener, opts));
        };

        /* ---- 键盘 ----
           注意：不挂在本元素上，而是交给 document 捕获阶段的全局分发器，
           否则全屏时会被思源 Dialog 的焦点陷阱截胡。详见 installKeyDispatch。 */
        installKeyDispatch();
        liveViews.add(this);
        this.disposers.push(() => liveViews.delete(this));
        on(this.rootEl, "blur", () => this.hideTip());

        /* ---- 滚轮：Ctrl/⌘ 缩放；可选整图平移；否则放行给页面滚动 ---- */
        on(
            this.viewportEl,
            "wheel",
            (e: WheelEvent) => {
                if (this.options.ctrlWheelZoom && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.stopPropagation();
                    const r = this.viewportEl.getBoundingClientRect();
                    this.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
                    return;
                }
                if (this.options.wheelPan) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.tx -= e.deltaX;
                    this.ty -= e.deltaY;
                    this.updateTransform();
                }
            },
            { passive: false },
        );

        /* ---- 拖拽平移 / Shift 框选 ---- */
        on(this.viewportEl, "mousedown", (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (t.closest(".mm-node") || t.closest(".mm-zoombar") || t.closest(".mm-minimap") || t.closest(".mm-search")) {
                return;
            }
            if (e.button !== 0) return;
            // 同上：别让点击空白处把 caret 放进 Protyle，否则导图立刻失焦
            e.preventDefault();
            this.rootEl.focus({ preventScroll: true });
            if (e.shiftKey) {
                this.startMarquee(e);
                return;
            }
            this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
            this.viewportEl.classList.add("mm-grabbing");
        });
        on(window, "mousemove", (e: MouseEvent) => {
            if (!this.drag) return;
            this.tx = this.drag.tx + (e.clientX - this.drag.x);
            this.ty = this.drag.ty + (e.clientY - this.drag.y);
            this.updateTransform();
        });
        on(window, "mouseup", () => {
            this.drag = null;
            this.viewportEl.classList.remove("mm-grabbing");
        });

        /* ---- 触屏：单指横向平移 + 双指捏合缩放 ----
           `.mm-viewport` 上写了 `touch-action: pan-y`，所以纵向拖动由浏览器
           直接接管（页面照常滚），我们只会收到横向拖动与多指手势的 touchmove。
           这样既保住了「移动端能滚动长文档」，又让导图本身可平移可缩放。 */
        let tAxis: "x" | "y" | null = null;
        let pinch: { d: number; s: number } | null = null;

        on(
            this.viewportEl,
            "touchstart",
            (e: TouchEvent) => {
                const t = e.target as HTMLElement | null;
                if (t?.closest?.(".mm-zoombar, .mm-minimap, .mm-search, .mm-toolbar, .mm-crumb, .mm-lightbox")) {
                    return;
                }
                if (e.touches.length === 2) {
                    const [a, b] = [e.touches[0], e.touches[1]];
                    pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: this.scale };
                    this.drag = null;
                    tAxis = null;
                    return;
                }
                if (e.touches.length === 1 && !pinch) {
                    const one = e.touches[0];
                    this.drag = { x: one.clientX, y: one.clientY, tx: this.tx, ty: this.ty };
                    tAxis = null;
                }
            },
            { passive: true },
        );

        on(
            this.viewportEl,
            "touchmove",
            (e: TouchEvent) => {
                const t = e.target as HTMLElement | null;
                if (t?.closest?.(".mm-zoombar, .mm-minimap, .mm-search, .mm-toolbar, .mm-crumb, .mm-lightbox")) return;

                if (pinch && e.touches.length === 2) {
                    e.preventDefault();
                    const [a, b] = [e.touches[0], e.touches[1]];
                    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                    if (pinch.d > 0 && d > 0) {
                        const r = this.viewportEl.getBoundingClientRect();
                        this.setScale(
                            pinch.s * (d / pinch.d),
                            (a.clientX + b.clientX) / 2 - r.left,
                            (a.clientY + b.clientY) / 2 - r.top,
                        );
                    }
                    return;
                }

                if (!this.drag || e.touches.length !== 1) return;
                const one = e.touches[0];
                const dx = one.clientX - this.drag.x;
                const dy = one.clientY - this.drag.y;
                // 手势方向只判定一次：定了横向就一路平移，定了纵向就交给页面滚动。
                // 不判定的话手指稍微斜一点就会一边滚页面一边平移画布。
                if (!tAxis) {
                    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
                    tAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
                }
                if (tAxis !== "x") return;
                e.preventDefault();
                this.tx = this.drag.tx + dx;
                this.ty = this.drag.ty + dy;
                this.updateTransform();
            },
            { passive: false },
        );

        const endTouch = (e: TouchEvent) => {
            if (e.touches.length === 0) {
                pinch = null;
                tAxis = null;
                this.drag = null;
            } else if (e.touches.length === 1 && pinch) {
                // 双指放开一根：重新以剩下那根为基准，避免画面猛地跳一下
                pinch = null;
                tAxis = null;
                this.drag = null;
            }
        };
        on(this.viewportEl, "touchend", endTouch, { passive: true });
        on(this.viewportEl, "touchcancel", endTouch, { passive: true });

        /* ---- 双击空白 = 适应画布 ---- */
        on(this.viewportEl, "dblclick", (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest(".mm-node")) return;
            this.fit();
        });

        /* ---- 点击空白取消选中 ---- */
        on(this.viewportEl, "click", (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (t.closest(".mm-node") || t.closest(".mm-zoombar") || t.closest(".mm-minimap")) return;
            this.clearSelection();
        });

        /* ---- 小地图 ---- */
        on(this.minimapEl, "mousedown", (e: MouseEvent) => this.onMinimapDown(e));

        /* ---- 自绘 tooltip ---- */
        on(this.rootEl, "mouseover", (e: MouseEvent) => {
            const t = (e.target as HTMLElement)?.closest?.("[data-mm-tip]") as HTMLElement | null;
            if (t) this.showTip(t);
        });
        on(this.rootEl, "mouseout", (e: MouseEvent) => {
            const from = (e.target as HTMLElement)?.closest?.("[data-mm-tip]") as HTMLElement | null;
            if (!from) return;
            const to = (e.relatedTarget as HTMLElement | null)?.closest?.("[data-mm-tip]") as HTMLElement | null;
            if (to !== from) this.hideTip();
        });

        /* ---- 尺寸变化时重新计算可视区高度（带变化判定，避免与自身写入形成回环） ---- */
        if (typeof ResizeObserver !== "undefined") {
            const ro = new ResizeObserver(() => {
                if (!this.tree || this.destroyed) return;
                if (this.resizeViewport(this.worldH) && this.options.autoFit) this.fit({ readable: true });
                else this.refreshMinimap();
            });
            ro.observe(document.body);
            // 并排面板拖宽、全屏弹层改尺寸时 body 不会变，得盯住自己的根元素
            ro.observe(this.rootEl);
            this.disposers.push(() => ro.disconnect());
        }
    }
}
