import { Menu, showMessage } from "siyuan";
import type { IMenu } from "siyuan";
import type {
    MMActionExtra,
    MMActionKind,
    MMActionResult,
    MMBatchKind,
    MMConfig,
    MMDropPosition,
    MMEdgeStyle,
    MMLayout,
    MMNode,
    MMTheme,
    MMThemeId,
    MMViewPrefs,
} from "../types";
import { EDIT_FLAG } from "../types";
import { applyTheme, hexA, mixHex, readRgb, resolveTheme, THEME_LIST } from "./theme";
import { decorate, flatten, indexById, parseList, wrapRoot } from "./parser";
import { layout } from "./layout";
import { buildConnectors } from "./edge";
import type { Connector } from "./edge";
import { exportOutline, exportPng, exportSvg, renderPngBlob } from "./exporter";
import type { ExportCrop } from "./exporter";
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
    /**
     * 结构操作：增删 / 升降级 / 上下移 / 拖拽 / 复制。
     *
     * 返回 Promise 时，视图会据此撤掉「乐观占位框」并给出失败反馈；
     * 返回 undefined（同步实现）则不做任何反馈处理。
     */
    onNodeAction: (kind: MMActionKind, node: MMNode, opts?: MMActionExtra) => Promise<MMActionResult> | void;
    /**
     * 批量结构操作。
     *
     * 批量**必须整体成功或整体回滚**：内核没有批量接口，只能逐条调用，
     * 中途失败就退回到操作前的快照，别把用户的数据留在半成品状态。
     */
    onBatchAction: (kind: MMBatchKind, nodes: MMNode[]) => Promise<MMActionResult> | void;
    /** 视图偏好（布局 / 主题 / 连线 / 缩放）变了，交给外部决定要不要写进文档 */
    onViewPrefs: (prefs: MMViewPrefs) => void;
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

/** 小地图最少节点数。低于这个数「一眼能看完」，再挂个缩略图纯属占地方 */
const MINIMAP_MIN_NODES = 30;
/** 小地图最多画多少个矩形，超过就抽样 */
const MINIMAP_MAX_RECTS = 700;

const LAYOUT_LABEL: Record<MMLayout, string> = {
    logic: "逻辑结构图",
    mind: "思维导图",
    tree: "树状图",
};

const EDGE_LABEL: Record<MMEdgeStyle, string> = {
    curve: "曲线",
    elbow: "直角折线",
    straight: "直线",
};

/** 乐观占位框上写的字（就一个词，让用户知道「在做什么」） */
const GHOST_LABEL: Record<string, string> = {
    insertChild: "加子节点…",
    insertSiblingBefore: "插入同级…",
    insertSiblingAfter: "插入同级…",
    duplicate: "复制…",
    paste: "粘贴…",
    delete: "删除中…",
    indent: "降级中…",
    outdent: "升级中…",
    move: "移动中…",
    moveUp: "上移中…",
    moveDown: "下移中…",
};

/** 批量操作成功后的提示 */
const BATCH_DONE_LABEL: Record<string, string> = {
    indent: "已批量降级",
    outdent: "已批量升级",
    delete: "已删除选中节点（Ctrl+Z 可撤销）",
    fold: "已折叠选中节点",
    unfold: "已展开选中节点",
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

/** 悬停折叠节点多久浮出预览卡片 */
const PREVIEW_DELAY = 600;

/** 乐观占位框最长挂多久（内核迟迟没回推时兜底撤掉） */
const GHOST_TIMEOUT_MS = 4000;

/** 失败反馈（红边 + 抖动）持续多久 */
const ERROR_FLASH_MS = 900;

/** 新插入节点的高亮描边持续多久 */
const NEW_NODE_HIGHLIGHT_MS = 1500;

/** 批量操作条：选中多少个以上才浮出 */
const BATCH_MIN_SELECTED = 2;

/** 折叠收拢动画时长（子节点向父节点聚拢并淡出） */
const COLLAPSE_MS = 210;

/** 演示模式：每次推进的动画时长 */
const PRESENT_STEP_MS = 260;

/** 演示模式里「已完成的子树」连线虚线样式 */
const DONE_DASH = "5 4";

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
    present: "M6 4.5 19 12 6 19.5z",
    caret: "M7 10l5 5 5-5",
    level: "M5 7h9M5 12h6M5 17h3",
    trash: "M5 7h14M9.5 7V5h5v2M7 7l1 12h8l1-12",
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
    /**
     * 小地图上「可能被标记」的节点及其换算好的坐标。
     *
     * 选中 / 搜索命中会变，但小地图的底图（那些 rect）不用跟着重画。
     * 把它们缓存下来，选择一变只重写标记那一层 —— 跟 `updateMinimapView`
     * 只动视口框是同一个思路。缓存的是**可见**节点的几何，折起来的子树
     * 没参与过布局，坐标是上一轮的残留，标出来会浮在错误的位置。
     */
    private minimapMarks: Array<{ node: MMNode; id: string; cx: string; cy: string }> = [];

    private clipboard = "";
    private tipTarget: HTMLElement | null = null;
    /**
     * 插件自己弹出的菜单里，当前还开着的那一个。
     *
     * 为什么要自己记一笔：导图的键盘处理挂在 document 的**捕获**阶段，
     * 一定比思源 Menu 自己的监听先拿到 Esc。菜单开着时按 Esc，会被我们
     * `take()` 掉（去清选中 / 退下钻），Menu 一个键都收不到 ——
     * 用户看到的是「菜单关不掉，反倒把选中弄丢了」。
     * 记下来，Esc 就先把菜单收掉。
     */
    private activeMenu: Menu | null = null;
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

    /* --- 结构操作的乐观反馈（P0-2） --- */
    /**
     * 在途的乐观占位框：token → 占位元素。
     *
     * 结构操作要等「写内核 → 内核回推 → 扫描重挂」一整圈，中间几百毫秒画面毫无变化，
     * 用户会以为没点上、再点一次（结果插了两个）。所以发起动作的**当下**先放一个
     * 虚线占位框，拿到结果再决定撤掉还是报错。
     *
     * 存的是元素本身而不是节点引用 —— 占位框不属于这棵树，不需要跨渲染存活。
     */
    private ghosts = new Map<number, { el: HTMLElement; timer: number; node: MMNode; inline: boolean }>();
    private ghostSeq = 0;
    /** 刚插入的节点块 ID，用于给真节点补一圈高亮描边（P1-2） */
    private freshIds = new Set<string>();
    private freshTimer = 0;

    /* --- 批量操作条（P0-1） --- */
    private batchEl: HTMLElement | null = null;
    private batchCountEl: HTMLElement | null = null;

    /* --- 悬停预览（P1-1） --- */
    private previewEl: HTMLElement | null = null;
    private previewTimer = 0;
    private previewTarget: HTMLElement | null = null;

    /* --- 演示模式（P2-3） --- */
    private presenting = false;
    private presentIdx = 0;
    private presentOrder: string[] = [];
    /**
     * 演示模式专用的折叠覆盖表（**只活在内存里，退出即清空**）。
     *
     * 为什么它可以存在：演示是「换一个视角讲这张图」，属于**临时的呈现透镜**，
     * 不是内容状态。它从不写回大纲，退出时清空后重新渲染，看到的就又是
     * 大纲里那个折叠状态 —— 真相源始终只有思源原生 `fold` 一个。
     * 这与「给导图独立折叠状态」是两回事，后者会被持久化、会与大纲打架。
     */
    private presentFold = new Map<string, boolean>();
    private presentBarEl: HTMLElement | null = null;
    private presentCountEl: HTMLElement | null = null;

    /* --- 折叠收拢动画（P2-5） --- */
    private collapseHandles: number[] = [];

    /* --- 大纲 ↔ 导图 双向高亮（P2-1） --- */
    /** 大纲光标所在的块 ID */
    private cursorId = "";

    /** 视图偏好（P0-3）—— 由外部注入，改过之后通过 onViewPrefs 回传 */
    private prefs: MMViewPrefs = {};
    /** 哪些项是「用户显式改过」的，只有这些才写进文档 */
    private prefsDirty = new Set<keyof MMViewPrefs>();

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
        this.hidePreview();
        this.hideBatchBar();
        this.hidePresentBar();
        this.clearOutlineCursor();
        this.tipEl?.remove();
        this.tipEl = null;
        if (this.flipHandle) cancelAnimationFrame(this.flipHandle);
        this.flipHandle = 0;
        // 在途的乐观占位框与收拢动画都要清干净：它们挂在 worldEl 上，
        // 不清的话会跟着 rootEl 一起被移除，但定时器仍会活到超时才回收
        for (const g of this.ghosts.values()) {
            window.clearTimeout(g.timer);
            g.el.remove();
        }
        this.ghosts.clear();
        if (this.freshTimer) window.clearTimeout(this.freshTimer);
        this.freshTimer = 0;
        this.freshIds.clear();
        for (const h of this.collapseHandles) cancelAnimationFrame(h);
        this.collapseHandles = [];
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
    setOptions(options: Partial<MMConfig>) {
        Object.assign(this.options, options);
        this.syncToolbar();
        this.render(true);
    }

    /**
     * 注入「文档级视图偏好」，覆盖全局默认。**必须在 `mount()` 之前调用**。
     *
     * 只覆盖用户显式改过的项 —— 没改过的继续跟随全局默认，
     * 否则用户改了全局主题之后所有文档都不跟着变，反而更别扭。
     */
    applyViewPrefs(prefs: MMViewPrefs) {
        this.prefs = { ...prefs };
        this.prefsDirty.clear();
        if (prefs.layout) this.options.layout = prefs.layout;
        if (prefs.theme) this.options.theme = prefs.theme;
        if (prefs.edge) this.options.edge = prefs.edge;
        // 偏好是「异步补挂」的：并排面板 / 全屏弹层挂载完才去读块属性，
        // 那时工具条已经建好了。这里补一次同步，否则分段控件的高亮会停在旧布局上。
        this.syncToolbar();
    }

    /** 当前这份视图偏好（只含「用户显式改过」的项） */
    get viewPrefs(): MMViewPrefs {
        return { ...this.prefs };
    }

    /**
     * 记一项视图偏好，并通知外部（外部负责防抖写入块属性）。
     *
     * 记进 `prefs` 的同时也把 options 改掉 —— 这两份必须同步，
     * 否则下次 `setOptions` 从全局默认推一遍就会把用户的选择冲掉。
     */
    private markPref<K extends keyof MMViewPrefs>(key: K, value: MMViewPrefs[K]) {
        this.prefs[key] = value;
        this.prefsDirty.add(key);
        this.cb.onViewPrefs({ ...this.prefs });
    }

    /** 忘掉一项偏好（下次打开回到全局默认） */
    private forgetPref(key: keyof MMViewPrefs) {
        delete this.prefs[key];
        this.prefsDirty.delete(key);
        this.cb.onViewPrefs({ ...this.prefs });
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
                // 布局是「用户显式改过」的偏好，记进文档 —— 下次打开这个列表就是它
                this.markPref("layout", key);
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
        actGroup.append(this.mkToolBtn("level", "视图选项（主题 / 连线 / 配色）", (e) => this.openViewMenu(e)));
        actGroup.append(this.mkToolBtn("present", "演示模式：逐层展开，方向键推进", () => this.togglePresent(), ""));
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

        // 建完立刻同步一次高亮。以前只在 setOptions / 点布局按钮时同步，
        // 于是「打开文档」这条路径上分段控件永远是三个都不亮的裸按钮 ——
        // 用户看不出当前是哪种布局，也不知道自己上次选的那个还在不在。
        this.syncToolbar();
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
        label.dataset.mmTip = "缩放选项";
        label.dataset.mmKey = "Ctrl 1";
        label.onclick = (e) => {
            e.stopPropagation();
            this.openZoomMenu(e);
        };
        // 数字单独放在一个 span 里 —— `updateTransform` 每次都会改它的文字，
        // 直接写按钮的 textContent 会把右边那个下拉箭头一起擦掉
        const val = document.createElement("span");
        val.className = "mm-zoom-val";
        val.textContent = "100%";
        label.append(val, mkIcon("caret"));
        this.zoomLabel = val;

        this.zoomBarEl.append(
            mk("−", "缩小", () => this.zoomAt(1 / 1.2), "Ctrl -"),
            label,
            mk("+", "放大", () => this.zoomAt(1.2), "Ctrl ="),
            mk("适应", "适应画布", () => this.fit(), "Ctrl 0"),
        );
    }

    /**
     * 建一个插件自己的菜单，并挂上「关闭时自动注销」的回调。
     *
     * 只建不弹 —— 调用方加完菜单项再交给 {@link popMenu}。
     * `closeCB` 在菜单关闭时触发（Esc 关的、点空白关的、点中某一项关的都算），
     * 拿对象同一性判一下再清，免得把后开的那个新菜单一起清掉。
     */
    private makeMenu(id: string): Menu {
        const menu = new Menu(id, () => {
            if (this.activeMenu === menu) this.activeMenu = null;
        });
        return menu;
    }

    /**
     * 弹出菜单，并把它登记为「当前打开的菜单」。
     *
     * 为什么不用 `Menu.isOpen` 判断：实测（思源 3.8.4）`open()` 之后它**仍然是 false**，
     * 拿它当门闸的话 Esc 分支整个不生效 —— 表现出来就是「菜单关不掉，反倒把选中弄丢了」。
     * 自己记一笔最稳。
     */
    private popMenu(menu: Menu, e?: MouseEvent) {
        this.activeMenu = menu;
        menu.open({ x: e?.clientX ?? 0, y: e?.clientY ?? 0 });
    }

    /**
     * 缩放菜单。
     *
     * 原来那个 `100%` 按钮的语义是「回到 1.0」—— 但用户真正想干的事
     * 往往是「缩放到能看清这个分支」。把这几件事收进一个下拉，
     * 顺带把「记住这个缩放」（文档级偏好）也放进来。
     */
    private openZoomMenu(e: MouseEvent) {
        const menu = this.makeMenu("mm-zoom-menu");
        const item = (label: string, key: string, disabled: boolean, click: () => void) =>
            menu.addItem({ label: key ? `${label}    ${key}` : label, disabled, click });

        item("100%", "Ctrl 1", Math.abs(this.scale - 1) < 0.005, () => this.setScale(1));
        item("适应画布", "Ctrl 0", false, () => this.fit());
        const sel = this.selNodes;
        item("适应选中节点", "", sel.length === 0, () => this.fitToNodes(sel));
        item(
            this.drillPath.length > 0 ? "只看当前分支（已聚焦）" : "只看当前分支",
            "Ctrl 双击",
            !this.selected || this.selected.children.length === 0,
            () => {
                if (this.selected) this.drillDown(this.selected);
            },
        );
        menu.addItem({ type: "separator" });
        const remembered = this.prefs.scale !== undefined;
        item(remembered ? "记住这个缩放 ✓" : "记住这个缩放", "", false, () => this.toggleRememberScale());
        this.popMenu(menu, e);
    }

    /** 视图选项菜单：主题 / 连线样式 —— 与布局一样，都记进文档级偏好 */
    private openViewMenu(e: MouseEvent) {
        const menu = this.makeMenu("mm-view-menu");

        const themeItems: IMenu[] = THEME_LIST.map((t) => ({
            label: t.name,
            checked: this.options.theme === t.id,
            click: () => {
                this.options.theme = t.id;
                this.markPref("theme", t.id);
                this.render(true);
            },
        }));
        menu.addItem({ icon: "iconTheme", label: "主题", type: "submenu", submenu: themeItems });

        const edgeItems: IMenu[] = (["curve", "elbow", "straight"] as MMEdgeStyle[]).map((k) => ({
            label: EDGE_LABEL[k],
            checked: this.options.edge === k,
            click: () => {
                this.options.edge = k;
                this.markPref("edge", k);
                this.drawEdges();
            },
        }));
        menu.addItem({ icon: "iconLine", label: "连线样式", type: "submenu", submenu: edgeItems });

        menu.addItem({ type: "separator" });
        const hasPrefs = Object.keys(this.prefs).length > 0;
        menu.addItem({
            icon: "iconUndo",
            label: "恢复本列表的默认视图",
            disabled: !hasPrefs,
            click: () => {
                for (const k of Object.keys(this.prefs) as Array<keyof MMViewPrefs>) this.forgetPref(k);
                this.applyViewPrefs({});
                this.render(true);
                showMessage("已恢复默认视图", 2000);
            },
        });
        this.popMenu(menu, e);
    }

    /** 缩放到刚好框住这些节点 */
    private fitToNodes(nodes: MMNode[]) {
        if (nodes.length === 0) {
            showMessage("先选中一个节点", 2200);
            return;
        }
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        const walk = (n: MMNode) => {
            x0 = Math.min(x0, n.x);
            y0 = Math.min(y0, n.y);
            x1 = Math.max(x1, n.x + n.w);
            y1 = Math.max(y1, n.y + n.h);
            n.kids.forEach(walk);
        };
        nodes.forEach(walk);
        const vw = this.viewportEl.clientWidth;
        const vh = this.viewportEl.clientHeight;
        if (!Number.isFinite(x0) || vw <= 1 || vh <= 1) return;

        const pad = 48;
        const w = x1 - x0 + pad * 2;
        const h = y1 - y0 + pad * 2;
        const k = Math.min(Math.max(Math.min(vw / w, vh / h), MIN_SCALE), MAX_SCALE);
        this.scale = k;
        // 让选中区域的中心落在视口中心：屏幕位置 = tx + 世界坐标 × k
        this.tx = vw / 2 - ((x0 + x1) / 2) * k;
        this.ty = vh / 2 - ((y0 + y1) / 2) * k;
        this.updateTransform();
    }

    /** 记住 / 忘记当前缩放（写进文档级偏好） */
    private toggleRememberScale() {
        if (this.prefs.scale !== undefined) {
            this.forgetPref("scale");
            showMessage("已取消记住缩放", 2000);
            return;
        }
        this.markPref("scale", this.scale);
        showMessage(`已记住这个缩放（${Math.round(this.scale * 100)}%）`, 2200);
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
        const menu = this.makeMenu("mm-export-menu");
        const sel = this.selNodes.length;
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
        menu.addItem({ type: "separator" });
        menu.addItem({
            icon: "iconImage",
            label: sel > 1 ? `只导出选中的 ${sel} 个节点` : "只导出选中（先选节点）",
            disabled: sel === 0,
            click: () => void this.doExport("png", this.selectedInDocOrder()),
        });
        menu.addItem({
            icon: "iconCopy",
            label: "复制为图片到剪贴板",
            click: () => void this.copyImage(),
        });
        menu.addItem({
            icon: "iconFile",
            label: "导出 Markdown 大纲",
            click: () => {
                const md = this.outlineMarkdown();
                if (!md) {
                    showMessage("导图是空的，没有可导出的内容", 2400);
                    return;
                }
                exportOutline(this.title, md);
            },
        });
        this.popMenu(menu, event);
    }

    private async doExport(kind: "png" | "svg", only?: MMNode[]) {
        const restore = this.prepareExport(only);
        const crop = (only ? this.selectionBounds(only) : null) ?? undefined;
        if (only && !crop) {
            restore();
            showMessage("选中的节点都不在画面上，无法导出", 2600, "error");
            return;
        }
        try {
            if (kind === "png") await exportPng(this.rootEl, this.title, 2, crop);
            else await exportSvg(this.rootEl, this.title, crop);
            if (only) showMessage(`已导出选中的 ${only.length} 个节点`, 2000);
        } catch (err) {
            console.warn("[mindmap] 导出失败", err);
            showMessage("导出失败", 4000, "error");
        } finally {
            restore();
        }
    }

    /**
     * 导出前临时清掉选中 / 搜索 / 悬停 / 动效残留，导出后恢复。
     *
     * 传了 `only` 就进入「只导选中」模式：把不相关的节点与连线藏起来，
     * 这样裁剪框里不会混进旁边那些「没被选中但恰好落在框内」的节点。
     */
    private prepareExport(only?: MMNode[]): () => void {
        const root = this.rootEl;
        const prevSel = this.selected;
        const prevExtra = new Set(this.extraSel);
        this.hideTip();
        this.hidePreview();

        let hiddenNodes: HTMLElement[] = [];
        let hiddenEdges: SVGPathElement[] = [];
        if (only && only.length > 0) {
            const keep = this.selectionIds(only);
            hiddenNodes = [];
            const walk = (n: MMNode) => {
                if (n.el && n.id && !keep.has(n.id)) {
                    n.el.classList.add("mm-hidden");
                    hiddenNodes.push(n.el);
                }
                n.children.forEach(walk);
            };
            if (this.tree) walk(this.tree);
            hiddenEdges = Array.from(this.edgesEl.querySelectorAll<SVGPathElement>("path")).filter((p) => {
                const pid = p.dataset.mmParent ?? "";
                const off = !keep.has(pid);
                if (off) p.style.display = "none";
                return off;
            });
        }

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
            for (const el of hiddenNodes) el.classList.remove("mm-hidden");
            for (const p of hiddenEdges) p.style.display = "";
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

        /** 是不是这个视图的第一次渲染 —— 决定取景策略（见函数尾部的注释） */
        const firstRender = this.tree === null;
        /** 上一棵树。折叠收拢动画要拿它里面的旧节点元素去演「往里聚」 */
        const oldTree = this.tree;

        const theme = resolveTheme(this.options.theme);
        const palette = this.paletteOf(theme);
        const font = getComputedStyle(document.body).fontFamily || "sans-serif";
        applyTheme(this.rootEl, theme, font);
        this.rootEl.classList.toggle("mm-hc", theme.id === "contrast");
        this.palette0 = palette[0] ?? theme.palette[0];
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
        decorate(root, palette, this.options.branchColor);

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
        // 演示模式的临时折叠态盖在最上层。它只活在内存里、退出即清空，
        // 所以不会变成「第二个折叠真相源」（见 presentFold 的字段注释）。
        if (this.presentFold.size > 0) {
            for (const n of flatten(root)) {
                if (!n.id) continue;
                const want = this.presentFold.get(n.id);
                if (want !== undefined) n.folded = want;
            }
        }

        this.tree = root;
        this.byId = indexById(root);
        // 选择必须跟着新树重绑一次 —— 见 remapSelection 的注释。
        this.remapSelection();

        /* --- 2. 建 DOM 并测量 --- */
        // 折叠收拢：先把「这一轮即将消失」的节点元素从 DOM 里摘出来，
        // 否则下面一句 innerHTML = "" 会把它们直接销毁，没有东西可动画。
        const vanish = oldTree && this.options.flipAnimation ? this.detachVanishing(oldTree, root) : [];

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
        this.markFresh();

        /* --- 5. 尺寸与视图 --- */
        this.resizeViewport(box.h);
        this.refreshSelection();
        this.applySearchMarks();
        this.refreshBreadcrumb();

        // 首次渲染一定自适应；之后只有用户主动改结构时才重置视图。
        // 都走 readable —— 「重新取景」时没人想看到一张 3px 高的地图；
        // 真正的「适应画布」（Ctrl+0 / 工具条按钮）走的是无参 fit()，不受此限。
        //
        // 例外：用户在这个文档里调过缩放（文档级偏好），首次进入就恢复它 ——
        // 「上次放大到某个分支看细节，切走再回来就没了」是最容易让人放弃的一类体验断层。
        if (firstRender && this.prefs.scale) this.applyRememberedScale();
        else if (this.options.autoFit && (fitView || !prev)) this.fit({ readable: true });
        else this.updateTransform();

        /* --- 6. 动效 --- */
        if (prev) this.runFlip(prev);
        // 收拢动画放在 FLIP 之后：两者作用的是不相交的元素集合
        // （FLIP 管留下的节点、收拢管消失的节点），同时跑不会打架。
        if (vanish.length) this.runCollapse(vanish);
        this.refreshMinimap();
        this.refreshBatchBar();
        this.refreshPresentBar();
    }

    /* ============================================================ 折叠收拢动画（P2-5） */

    /**
     * 把「这一轮会消失的节点元素」从 DOM 里摘出来，并算好各自要飞向哪里。
     *
     * 为什么需要这一步：折叠一个节点时，子节点是**整批消失**的。FLIP 只处理
     * 「还在、但位置变了」的节点，对消失的那批无能为力 —— 它们会在
     * `nodesEl.innerHTML = ""` 那一瞬间凭空蒸发，用户看到的是「啪一下没了」。
     *
     * 目标点取「最近的、新树里仍然可见的祖先」的中心：折叠时子节点朝父节点收，
     * 视觉上就是「被吸进去了」，正好对应折叠这个动作的语义。
     * 找不到可见祖先（整个分支被删掉）就直接丢弃，不做动画 —— 删除是另一回事。
     */
    private detachVanishing(
        oldTree: MMNode,
        newRoot: MMNode,
    ): Array<{ el: HTMLElement; x: number; y: number; w: number; h: number; tx: number; ty: number }> {
        const visible = new Set<string>();
        const walkNew = (n: MMNode) => {
            if (n.id) visible.add(n.id);
            if (!n.folded) n.children.forEach(walkNew);
        };
        walkNew(newRoot);

        const out: Array<{ el: HTMLElement; x: number; y: number; w: number; h: number; tx: number; ty: number }> = [];
        const walkOld = (n: MMNode) => {
            if (n.id && !visible.has(n.id) && n.el) {
                let p = n.parent;
                while (p && !(p.id && visible.has(p.id))) p = p.parent;
                if (!p) return;
                const el = n.el;
                n.el = undefined;
                el.remove();
                out.push({
                    el,
                    x: n.x,
                    y: n.y,
                    w: n.w,
                    h: n.h,
                    tx: p.x + p.w / 2,
                    ty: p.y + p.h / 2,
                });
                return;
            }
            n.children.forEach(walkOld);
        };
        walkOld(oldTree);
        return out;
    }

    /** 让消失的节点朝目标点聚拢并淡出，然后销毁 */
    private runCollapse(items: Array<{ el: HTMLElement; x: number; y: number; w: number; h: number; tx: number; ty: number }>) {
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        // 节点太多时不做：几十个元素各自跑一条 transition，收益远不抵开销
        if (items.length > 120) return;

        for (const it of items) {
            const el = it.el;
            el.classList.add("mm-collapsing");
            el.style.left = `${it.x}px`;
            el.style.top = `${it.y}px`;
            el.style.transform = "translate(0,0) scale(1)";
            this.worldEl.appendChild(el);
        }
        // 双 rAF：第一帧让浏览器认下初始位置，第二帧再改 transform 才有过渡
        const h = window.requestAnimationFrame(() => {
            const h2 = window.requestAnimationFrame(() => {
                for (const it of items) {
                    const dx = it.tx - (it.x + it.w / 2);
                    const dy = it.ty - (it.y + it.h / 2);
                    it.el.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(.55)`;
                    it.el.style.opacity = "0";
                }
            });
            this.collapseHandles.push(h2);
        });
        this.collapseHandles.push(h);
        window.setTimeout(() => {
            for (const it of items) it.el.remove();
        }, COLLAPSE_MS + 60);
    }

    /**
     * 恢复「上次的缩放」，并把内容摆回视口中央。
     *
     * 只恢复缩放，**不恢复平移** —— 平移跟画布尺寸强相关，
     * 换个窗口大小或者折叠几个节点之后，记住的平移量就变成了「把内容推到屏幕外」。
     */
    private applyRememberedScale() {
        const want = this.prefs.scale;
        if (!want) return;
        const vw = this.viewportEl.clientWidth;
        const vh = this.viewportEl.clientHeight;
        if (vw <= 1 || vh <= 1) return;
        this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, want));
        this.tx = this.frameAxis((vw - this.worldW * this.scale) / 2, this.worldW * this.scale, vw);
        this.ty = this.frameAxis((vh - this.worldH * this.scale) / 2, this.worldH * this.scale, vh);
        this.updateTransform();
    }

    /**
     * 实际使用的一级分支配色。
     *
     * 默认用主题自带色板；用户在设置里填了自定义色板就用它 —— 允许只填两三个色，
     * 超出部分循环取用（`decorate` 里就是这么做的）。
     * 非法输入直接忽略，免得把整张图渲染成一片透明。
     */
    private paletteOf(theme: MMTheme): string[] {
        const raw = (this.options.customPalette || "").trim();
        if (!raw) return theme.palette;
        const list = raw
            .split(/[,，\s]+/)
            .map((s) => s.trim())
            .filter((s) => /^#?[0-9a-fA-F]{3,8}$/.test(s))
            .map((s) => (s.startsWith("#") ? s : `#${s}`));
        return list.length >= 2 ? list : theme.palette;
    }

    /* ==================================================== 结构操作的乐观反馈（P0-2） */

    /**
     * 发起一次结构操作，并在途中给出反馈。
     *
     * 结构操作是**异步写内核**的：写回 → 内核回推 DOM → 扫描重挂视图，
     * 中间隔了 140ms 扫描防抖 + 一次内核往返，用户点完「+」之后有 300~500ms
     * 画面毫无变化。于是会出现两种典型误判：① 以为没点上，再点一次（插了两个）；
     * ② 以为插件坏了。
     *
     * 所以：发起动作的**当下**先放一个虚线占位框（或给源节点打上「处理中」标记），
     * 拿到结果再撤掉 —— 成功就悄悄撤走（真节点已经顶上来了），
     * 失败就在**原节点上**打红色描边 + 抖动，并把原因说清楚。
     * 与折叠同步用的「覆盖表」是同一个思路：**先给反馈，再等真相**。
     */
    private runAction(kind: MMActionKind, node: MMNode, opts?: MMActionExtra) {
        const res = this.cb.onNodeAction(kind, node, opts);
        // 同步实现（返回 undefined）没有可等待的结果，保持老行为
        if (!res) return;
        const token = this.showGhost(node, kind);
        void res
            .then((out) => {
                this.dropGhost(token);
                if (!out.ok) this.flashError(node, out.message);
            })
            .catch((err) => {
                console.warn("[mindmap] 结构操作异常", kind, err);
                this.dropGhost(token);
                this.flashError(node, "操作失败，请重试");
            });
    }

    /** 批量版：整体成功或整体回滚，所以只在失败时统一反馈一次 */
    private runBatchAction(kind: MMBatchKind, nodes: MMNode[]) {
        if (nodes.length === 0) return;
        if (kind === "fold" || kind === "unfold") {
            this.batchFold(kind === "fold");
            return;
        }
        if (kind === "export") {
            void this.doExport("png", nodes);
            return;
        }

        const tokens = nodes.map((n) => this.showGhost(n, kind));
        const res = this.cb.onBatchAction(kind, nodes);
        if (!res) {
            tokens.forEach((t) => this.dropGhost(t));
            return;
        }
        void res
            .then((out) => {
                tokens.forEach((t) => this.dropGhost(t));
                if (out.ok) {
                    showMessage(BATCH_DONE_LABEL[kind] ?? "已完成", 1800);
                    return;
                }
                // 批量失败是**整体回滚**的，逐个闪红没有信息量，只闪一遍 + 说清原因
                for (const n of nodes) this.flashNode(n, out.message);
                showMessage(out.message ?? "批量操作失败，已全部还原", 3200, "error");
            })
            .catch((err) => {
                console.warn("[mindmap] 批量操作异常", kind, err);
                tokens.forEach((t) => this.dropGhost(t));
                showMessage("批量操作失败，已全部还原", 3200, "error");
            });
    }

    /**
     * 放一个乐观占位。
     *
     * 分两种形态：
     *  - **新增类**（加子节点 / 插入同级 / 复制 / 粘贴）→ 在预期位置放一个虚线框，
     *    位置按「新节点会落在哪儿」估算（下一列 / 下一行），这样真节点出现时
     *    视觉上是「占位框变成了真节点」，而不是「别处冒出来一个」。
     *  - **移动 / 升降级 / 删除** → 没有新节点可占位，改为在源节点上打一个
     *    「处理中」的呼吸描边。它表达的是「这一下已经收到了，正在等内核」。
     */
    private showGhost(node: MMNode, kind: string): number {
        const token = ++this.ghostSeq;
        const el = document.createElement("div");
        el.className = "mm-ghost";
        el.setAttribute("contenteditable", "false");
        el.textContent = GHOST_LABEL[kind] ?? "处理中…";

        const creating =
            kind === "insertChild" ||
            kind === "insertSiblingBefore" ||
            kind === "insertSiblingAfter" ||
            kind === "duplicate" ||
            kind === "paste";

        let inline = false;
        if (creating) {
            const p = this.ghostPlacement(node, kind);
            el.style.left = `${p.x}px`;
            el.style.top = `${p.y}px`;
            this.worldEl.appendChild(el);
        } else {
            inline = true;
            node.el?.classList.add("mm-pending");
        }

        const timer = window.setTimeout(() => this.dropGhost(token), GHOST_TIMEOUT_MS);
        this.ghosts.set(token, { el, timer, node, inline });
        return token;
    }

    /** 新节点预计会落在哪 —— 只求「方向对、不打架」，不做精确布局预测 */
    private ghostPlacement(node: MMNode, kind: string): { x: number; y: number } {
        const vertical = this.options.layout === "tree";
        const ahead = this.trunkLen + 18;
        if (kind === "insertChild") {
            return vertical ? { x: node.x, y: node.y + node.h + ahead } : { x: node.x + node.w + ahead, y: node.y };
        }
        if (kind === "insertSiblingBefore") return { x: node.x, y: node.y - 32 };
        return { x: node.x, y: node.y + node.h + 10 };
    }

    private dropGhost(token: number) {
        const g = this.ghosts.get(token);
        if (!g) return;
        this.ghosts.delete(token);
        window.clearTimeout(g.timer);
        g.el.remove();
        if (g.inline) g.node.el?.classList.remove("mm-pending");
    }

    /** 在原节点上打红边 + 抖动。不弹提示（提示由调用方决定弹几次） */
    private flashNode(node: MMNode, message?: string) {
        // 重渲染之后旧节点对象已经不在树上，按块 ID 重新取一个再闪，
        // 否则闪的是一个已经脱离文档的元素（看不见任何效果）
        const el = (node.id ? this.byId.get(node.id)?.el : undefined) ?? node.el;
        if (!el || !el.isConnected) return;
        el.classList.add("mm-error");
        if (message) el.dataset.mmTip = message;
        window.setTimeout(() => {
            el.classList.remove("mm-error");
            if (message) delete el.dataset.mmTip;
        }, ERROR_FLASH_MS);
    }

    private flashError(node: MMNode, message?: string) {
        const msg = message || "操作未生效，请重试";
        this.flashNode(node, msg);
        showMessage(msg, 3000, "error");
    }

    /**
     * 给新插入的节点补一圈高亮描边，让用户知道「加在哪了」。
     *
     * 存 ID 而不是元素 —— 插入之后视图会被重建，元素引用会作废。
     * 用一个统一的定时器清理：短时间内连插几个节点时，它们一起亮、一起灭。
     */
    private addFresh(id: string) {
        if (!id) return;
        this.freshIds.add(id);
        this.byId.get(id)?.el?.classList.add("mm-fresh");
        if (this.freshTimer) window.clearTimeout(this.freshTimer);
        this.freshTimer = window.setTimeout(() => {
            this.freshTimer = 0;
            for (const fid of this.freshIds) this.byId.get(fid)?.el?.classList.remove("mm-fresh");
            this.freshIds.clear();
        }, NEW_NODE_HIGHLIGHT_MS);
    }

    /** 每次重渲染后把高亮补到新元素上（DOM 重建会丢掉类名） */
    private markFresh() {
        for (const id of this.freshIds) this.byId.get(id)?.el?.classList.add("mm-fresh");
    }

    /* ====================================================== 批量操作条（P0-1） */

    /** 选中的节点，按**文档顺序**排列。批量操作对顺序敏感，必须有个确定的次序 */
    private selectedInDocOrder(): MMNode[] {
        const root = this.tree;
        if (!root) return [];
        const set = new Set(this.selNodes);
        if (set.size === 0) return [];
        const out: MMNode[] = [];
        const walk = (n: MMNode) => {
            if (set.has(n)) out.push(n);
            n.children.forEach(walk);
        };
        walk(root);
        return out;
    }

    private refreshBatchBar() {
        const n = this.selNodes.length;
        if (n < BATCH_MIN_SELECTED) {
            this.hideBatchBar();
            return;
        }
        if (!this.batchEl) this.buildBatchBar();
        if (this.batchCountEl) this.batchCountEl.textContent = `已选 ${n} 个`;
    }

    /**
     * 批量操作条：多选之后浮在工具条下方。
     *
     * 为什么是「条」而不是弹窗 —— 弹窗会盖住画布，而用户此刻正需要看着画布
     * 确认自己框对了哪些节点。
     */
    private buildBatchBar() {
        const bar = document.createElement("div");
        bar.className = "mm-batch";
        bar.setAttribute("contenteditable", "false");

        const count = document.createElement("span");
        count.className = "mm-batch-count";
        this.batchCountEl = count;

        const sep = () => {
            const d = document.createElement("span");
            d.className = "mm-batch-sep";
            return d;
        };

        const btn = (label: string, tip: string, extra: string, fn: () => void) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = `mm-batch-btn${extra}`;
            b.textContent = label;
            b.dataset.mmTip = tip;
            b.onclick = (e) => {
                e.stopPropagation();
                fn();
            };
            return b;
        };

        const close = document.createElement("button");
        close.type = "button";
        close.className = "mm-batch-x";
        close.textContent = "✕";
        close.dataset.mmTip = "取消选择";
        close.onclick = (e) => {
            e.stopPropagation();
            this.clearSelection();
        };

        bar.append(
            count,
            sep(),
            btn("升级", "把选中的节点整体升级一级", "", () => this.runBatchAction("outdent", this.selectedInDocOrder())),
            btn("降级", "把选中的节点整体降级为「上一个节点」的子节点", "", () =>
                this.runBatchAction("indent", this.selectedInDocOrder()),
            ),
            btn("折叠", "折叠选中的节点", "", () => this.batchFold(true)),
            btn("展开", "展开选中的节点", "", () => this.batchFold(false)),
            sep(),
            btn("导出这些", "只导出选中的子树", "", () => this.runBatchAction("export", this.selectedInDocOrder())),
            btn("删除", "删除选中的节点及其子树（Ctrl+Z 可撤销）", " mm-batch-btn--danger", () =>
                this.runBatchAction("delete", this.selectedInDocOrder()),
            ),
            close,
        );

        this.batchEl = bar;
        // 挂在画布（viewport）里、绝对定位 —— 见样式表里那段注释：
        // 放在流里会让「多选」这个动作本身推动画布，连点两下必偏。
        this.viewportEl.appendChild(bar);
    }

    private hideBatchBar() {
        this.batchEl?.remove();
        this.batchEl = null;
        this.batchCountEl = null;
    }

    /** 批量折叠：直接改大纲的原生 fold（与单击折叠走同一条写回链路） */
    private batchFold(folded: boolean) {
        const nodes = this.selectedInDocOrder().filter((n) => n.children.length > 0);
        if (nodes.length === 0) {
            showMessage("选中的节点都没有子节点", 2200);
            return;
        }
        for (const n of nodes) {
            n.folded = folded;
            if (n.id) this.cb.onFoldChange(n.id, folded);
        }
        this.render();
        this.reclampView();
        showMessage(BATCH_DONE_LABEL[folded ? "fold" : "unfold"] ?? "已完成", 1600);
    }

    /* ========================================================= 悬停预览（P1-1） */

    /** 悬停折叠节点一小会儿之后浮出预览卡片（列出前几个子节点） */
    private armPreview(n: MMNode, anchor: HTMLElement) {
        if (!this.options.hoverPreview) return;
        if (!n.folded || n.children.length === 0) return;
        this.disarmPreview();
        this.previewTimer = window.setTimeout(() => {
            this.previewTimer = 0;
            if (this.destroyed || !anchor.isConnected) return;
            this.showPreview(n, anchor);
        }, PREVIEW_DELAY);
    }

    private disarmPreview() {
        if (this.previewTimer) {
            window.clearTimeout(this.previewTimer);
            this.previewTimer = 0;
        }
        this.hidePreview();
    }

    /**
     * 折叠之后用户其实想知道「里面是什么」，但现在只有珠子上的一个数字。
     * 卡片就补这个信息 —— 只列前 5 个，多了反而看不清。
     */
    private showPreview(n: MMNode, anchor: HTMLElement) {
        const el = document.createElement("div");
        el.className = "mm-preview";
        el.setAttribute("contenteditable", "false");

        const head = document.createElement("div");
        head.className = "mm-preview-head";
        head.textContent = `折叠了 ${n.children.length} 个子节点`;
        el.appendChild(head);

        const list = document.createElement("div");
        list.className = "mm-preview-list";
        for (const kid of n.children.slice(0, 5)) {
            const row = document.createElement("div");
            row.className = "mm-preview-row";
            const dot = document.createElement("span");
            dot.className = "mm-preview-dot";
            dot.style.background = kid.color ?? this.palette0;
            const txt = document.createElement("span");
            txt.className = "mm-preview-txt";
            txt.textContent = kid.text || "（空）";
            row.append(dot, txt);
            list.appendChild(row);
        }
        if (n.children.length > 5) {
            const more = document.createElement("div");
            more.className = "mm-preview-more";
            more.textContent = `还有 ${n.children.length - 5} 个…`;
            list.appendChild(more);
        }
        el.appendChild(list);

        document.body.appendChild(el);
        this.previewEl = el;
        this.previewTarget = anchor;

        const r = anchor.getBoundingClientRect();
        const pr = el.getBoundingClientRect();
        let left = r.right + 10;
        let top = r.top + r.height / 2 - pr.height / 2;
        if (left + pr.width > window.innerWidth - 6) left = r.left - pr.width - 10;
        left = Math.min(Math.max(left, 6), Math.max(6, window.innerWidth - pr.width - 6));
        top = Math.min(Math.max(top, 6), Math.max(6, window.innerHeight - pr.height - 6));
        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(top)}px`;
        el.classList.add("mm-preview--on");
    }

    private hidePreview() {
        this.previewTarget = null;
        this.previewEl?.remove();
        this.previewEl = null;
    }

    /** 拖拽悬停自动展开的环形进度：没有它用户不知道「停一下会展开」 */
    private markHoverExpand(target: MMNode | null) {
        this.rootEl.querySelectorAll(".mm-toggle--loading").forEach((el) => el.classList.remove("mm-toggle--loading"));
        if (!target) return;
        target.toggle?.classList.add("mm-toggle--loading");
        // 动画时长与 HOVER_EXPAND_DELAY 对齐，靠 CSS 变量传进去，
        // 免得两处各写一个数字、改一个忘一个
        target.toggle?.style.setProperty("--mm-hover-delay", `${HOVER_EXPAND_DELAY}ms`);
    }

    /* ========================================================= 演示模式（P2-3） */

    /**
     * 演示模式：把导图当成一页一页讲的讲稿。
     *
     * 进入时整张图**折到只剩根**，然后随着方向键推进逐层展开 ——
     * 观众跟着讲述的节奏看到结构一层层长出来，而不是一上来就被一张
     * 几十个节点的图糊住。
     *
     * ⚠️ 折叠状态只写进 `presentFold`（内存里的临时透镜），**不写回大纲**。
     * 演示是「换个视角看」，不是「改内容」；退出即清空，看到的又是大纲的原状。
     */
    togglePresent(on?: boolean) {
        const next = on ?? !this.presenting;
        if (next === this.presenting) return;
        if (next && !this.tree) return;
        this.presenting = next;

        // 进演示之前把还开着的菜单收掉：菜单会盖住画布，而且 Esc 在演示里
        // 只该有一个语义 —— 退出演示。留一个菜单在那儿，两种 Esc 会互相顶。
        if (next && this.activeMenu) {
            this.activeMenu.close();
            this.activeMenu = null;
        }

        if (!next) {
            this.presentFold.clear();
            this.rootEl.classList.remove("mm-present");
            this.hidePresentBar();
            this.render(true);
            return;
        }

        const root = this.tree!;
        this.presentOrder = [];
        const collect = (n: MMNode) => {
            if (n.id) this.presentOrder.push(n.id);
            n.children.forEach(collect);
        };
        collect(root);

        this.presentFold.clear();
        for (const n of flatten(root)) {
            if (n !== root && n.children.length > 0 && n.id) this.presentFold.set(n.id, true);
        }

        this.rootEl.classList.add("mm-present");
        this.presentIdx = 0;
        this.render(true);
        this.presentGo(0);
        // 进来就把键盘接过来。
        //
        // 用户是**点工具条按钮**进来的，焦点此刻在那个按钮上（Chrome 里点按钮会给它
        // 焦点）。虽然按钮也在 .mm-root 里、按键照样能冒泡上来，但按钮自己会吃掉
        // 空格和回车（触发 click）—— 而空格在演示模式里是「下一页」。
        // 主动把焦点收到画布上，键盘就完完全全归演示用了。
        this.rootEl.focus({ preventScroll: true });
    }

    /** 推进到第 idx 个节点：展开它的祖先链、选中并滚进视野 */
    private presentGo(idx: number) {
        if (!this.presenting) return;
        const total = this.presentOrder.length;
        if (total === 0) return;
        this.presentIdx = Math.min(Math.max(idx, 0), total - 1);

        const id = this.presentOrder[this.presentIdx];
        const first = this.byId.get(id);
        if (!first) return;

        let changed = false;
        let cur = first.parent;
        while (cur) {
            if (cur.id && this.presentFold.get(cur.id) === true) {
                this.presentFold.set(cur.id, false);
                changed = true;
            }
            cur = cur.parent;
        }
        if (changed) this.render();

        const n = this.byId.get(id);
        if (!n) return;
        this.selected = n;
        this.extraSel.clear();
        this.rootEl.classList.add("mm-kbd");
        this.refreshSelection();
        this.ensureVisible(n);
        this.refreshPresentBar();
    }

    private refreshPresentBar() {
        if (!this.presenting) {
            this.hidePresentBar();
            return;
        }
        if (!this.presentBarEl) {
            const bar = document.createElement("div");
            bar.className = "mm-present-bar";
            bar.setAttribute("contenteditable", "false");

            const prev = document.createElement("button");
            prev.type = "button";
            prev.textContent = "‹";
            prev.dataset.mmTip = "上一个（←）";
            prev.onclick = (e) => {
                e.stopPropagation();
                this.presentGo(this.presentIdx - 1);
            };

            const next = document.createElement("button");
            next.type = "button";
            next.textContent = "›";
            next.dataset.mmTip = "下一个（→ / 空格）";
            next.onclick = (e) => {
                e.stopPropagation();
                this.presentGo(this.presentIdx + 1);
            };

            const out = document.createElement("button");
            out.type = "button";
            out.className = "mm-present-exit";
            out.textContent = "退出演示";
            out.dataset.mmTip = "退出（Esc）";
            out.onclick = (e) => {
                e.stopPropagation();
                this.togglePresent(false);
            };

            const progress = document.createElement("span");
            progress.className = "mm-present-count";

            bar.append(prev, progress, next, out);
            this.presentBarEl = bar;
            this.viewportEl.appendChild(bar);
            this.presentCountEl = progress;
        }
        if (this.presentCountEl) {
            this.presentCountEl.textContent = `${this.presentIdx + 1} / ${this.presentOrder.length}`;
        }
    }

    private hidePresentBar() {
        this.presentBarEl?.remove();
        this.presentBarEl = null;
        this.presentCountEl = null;
    }

    /* ==================================================== 大纲 ↔ 导图 双向高亮（P2-1） */

    /**
     * 光标在大纲里移动时，导图对应节点跟着亮。
     *
     * 用 `selectionchange` 而不是 click / keyup —— 方向键移动光标、拖选、
     * 点击定位都会改选区，只有 selectionchange 能全覆盖。
     * rAF 节流：这个事件在拖选时每帧都发。
     */
    private bindOutlineCursor() {
        let raf = 0;
        const sync = () => {
            raf = 0;
            if (this.destroyed) return;
            const sel = window.getSelection();
            const node = sel?.anchorNode ?? null;
            const el = node ? (node.nodeType === 1 ? (node as HTMLElement) : node.parentElement) : null;
            if (!el || !this.listEl.contains(el)) {
                this.setCursorBlock("");
                return;
            }
            this.setCursorBlock(el.closest<HTMLElement>(".li")?.dataset.nodeId ?? "");
        };
        const onChange = () => {
            if (!raf) raf = window.requestAnimationFrame(sync);
        };
        document.addEventListener("selectionchange", onChange);
        this.disposers.push(() => {
            document.removeEventListener("selectionchange", onChange);
            if (raf) cancelAnimationFrame(raf);
        });
    }

    /** 大纲里光标所在块变了 —— 在导图上标出来 */
    setCursorBlock(id: string) {
        if (this.cursorId === id) return;
        this.cursorId = id;
        const root = this.tree;
        if (!root) return;
        const walk = (n: MMNode) => {
            n.el?.classList.toggle("mm-cursor", !!id && n.id === id);
            n.kids.forEach(walk);
        };
        walk(root);
    }

    private clearOutlineCursor() {
        this.cursorId = "";
        this.listEl.querySelectorAll<HTMLElement>(".mm-outline-hit").forEach((el) => el.classList.remove("mm-outline-hit"));
    }

    /** 反过来：导图上选中了哪个节点，就在大纲里把对应的列表项标出来 */
    private markOutlineCursor() {
        this.listEl.querySelectorAll<HTMLElement>(".mm-outline-hit").forEach((el) => el.classList.remove("mm-outline-hit"));
        const id = this.selected?.id;
        if (!id) return;
        this.listEl.querySelector<HTMLElement>(`.li[data-node-id="${id}"]`)?.classList.add("mm-outline-hit");
    }

    /* ======================================================= 导出增强（P2-2） */

    /** 选中子树（含其可见后代）的包围盒，用作「只导选中」的裁剪框 */
    private selectionBounds(nodes: MMNode[]): ExportCrop | null {
        if (nodes.length === 0) return null;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        const walk = (n: MMNode) => {
            if (!n.el) return;
            x0 = Math.min(x0, n.x);
            y0 = Math.min(y0, n.y);
            x1 = Math.max(x1, n.x + n.w);
            y1 = Math.max(y1, n.y + n.h);
            n.kids.forEach(walk);
        };
        nodes.forEach(walk);
        if (!Number.isFinite(x0)) return null;
        const pad = 36;
        return { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    }

    /** 选中子树里所有节点的块 ID（导出时用来隐藏「不相关」的节点与连线） */
    private selectionIds(nodes: MMNode[]): Set<string> {
        const keep = new Set<string>();
        const walk = (n: MMNode) => {
            if (n.id) keep.add(n.id);
            n.children.forEach(walk);
        };
        nodes.forEach(walk);
        return keep;
    }

    /** 导出 Markdown 大纲（把当前树按缩进还原成可粘贴的 markdown） */
    private outlineMarkdown(): string {
        const root = this.tree;
        if (!root) return "";
        const lines: string[] = [];
        const walk = (n: MMNode, depth: number) => {
            const marker = n.kind === "task" ? `- [${n.checked ? "x" : " "}]` : n.kind === "ordered" ? "1." : "-";
            lines.push(`${"    ".repeat(depth)}${marker} ${n.text}`);
            n.children.forEach((c) => walk(c, depth + 1));
        };
        // 虚拟根（多顶层节点时合成的那一个）本身不是内容，不输出
        if (root.id) walk(root, 0);
        else root.children.forEach((c) => walk(c, 0));
        return lines.join("\n");
    }

    private async copyImage() {
        const restore = this.prepareExport();
        try {
            const blob = await renderPngBlob(this.rootEl);
            if (!blob) throw new Error("PNG 编码失败");
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            showMessage("已复制图片到剪贴板", 2000);
        } catch (err) {
            console.warn("[mindmap] 复制图片失败", err);
            showMessage("复制图片失败，浏览器可能不支持", 3200, "error");
        } finally {
            restore();
        }
    }

    /* ==================================================================== 下钻与渐进展开 */

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
        // 新插入的节点补一圈高亮描边 —— 「加在哪了」是插入之后第一个要回答的问题
        this.addFresh(id);
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

        const items: Array<{ c: Connector; stroke: string; parent: string }> = [];

        const walk = (n: MMNode) => {
            if (n.kids.length > 0) {
                const base = Math.max(1.2, 2.8 - n.depth * 0.42);
                // 连线语义化：通往「已完成的任务」的那条支线画成虚线。
                // 大纲里 `- [x]` 是内容状态，导图顺手把它可视化出来，
                // 一眼就能看出哪几支已经做完了。
                const kidDash = n.kids.map((k) => (k.kind === "task" && k.checked ? DONE_DASH : undefined));
                const cons = buildConnectors({
                    parent: rect(n),
                    kids: n.kids.map((k) => rect(k)),
                    mode: this.options.layout,
                    style: this.options.edge,
                    gap: this.gapX,
                    base,
                    kidDash,
                });
                const own = this.edgeColor(n);
                for (const c of cons) {
                    const kid = c.childIndex === null ? null : n.kids[c.childIndex];
                    items.push({ c, stroke: kid ? this.edgeColor(kid, true) : own, parent: n.id ?? "" });
                }
            }
            n.kids.forEach(walk);
        };
        walk(root);

        const signature = items.map((i) => `${i.c.kind}:${i.c.width}:${i.c.dash ?? ""}`).join("|");

        // 结构没变时只改 d，避免每帧重新解析整段 SVG（FLIP 期间会调用几十次）
        if (signature === this.edgeSignature && this.edgePaths.length === items.length) {
            for (let i = 0; i < items.length; i++) {
                this.edgePaths[i].setAttribute("d", items[i].c.d);
            }
            return;
        }

        const parts: string[] = [];
        for (const { c, stroke, parent } of items) {
            // data-mm-parent 是「只导选中」用的：导出时要按父节点把不相关的连线藏起来
            const dash = c.dash ? ` stroke-dasharray="${c.dash}"` : "";
            parts.push(
                `<path d="${c.d}" fill="none" stroke="${stroke}" stroke-width="${c.width}"${dash} stroke-linecap="round" stroke-linejoin="round" data-mm-parent="${parent}"/>`,
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
        // 大纲里的光标位置要跨渲染保持 —— DOM 重建会丢掉类名
        if (this.cursorId && this.cursorId === n.id) el.classList.add("mm-cursor");

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
                this.disarmPreview();
                this.toggleFold(n);
            };
            // 悬停预览：折起来之后用户其实想知道「里面是什么」，
            // 但现在只有珠子上的一个数字。停一下就把前几个子节点透出来。
            tog.onmouseenter = () => this.armPreview(n, tog);
            tog.onmouseleave = () => this.disarmPreview();
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
                void this.runAction("insertChild", n);
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

    /**
     * 把「选中的节点」重新绑到这一轮新树的节点对象上。
     *
     * 为什么非做不可：`render()` 每次都从 DOM 重新解析、**整棵重建** MMNode，
     * 而 `selected` / `extraSel` 里握着的是上一轮的旧对象。旧对象带着正确的
     * `.id`，但跟新树里的任何节点都不是同一个引用 —— 于是所有「按对象找节点」
     * 的地方全部落空：
     *
     *   - `refreshSelection()` 走新树打 `mm-sel` / `mm-multi`，一个都匹配不上
     *     → 选中高亮在做完任何结构操作后凭空消失；
     *   - `selectedInDocOrder()` 遍历新树收集选中项，`set.has(n)` 恒为假
     *     → 返回空数组。批量操作里最先暴露的就是折叠：点一次「折叠」之后
     *     再点「展开」，`batchFold(false)` 拿到空数组、弹一句「选中的节点
     *     都没有子节点」就返回，大纲里的 `fold="1"` 一个都没清掉。
     *
     * 按块 ID 重绑即可 —— ID 是内核给的、跨渲染稳定的唯一标识。
     * 找不到（节点被删了、被移出这个列表了）就把它从选中里摘掉：
     * 留着一个不在树上的幽灵选中项，比清掉更让人困惑。
     */
    private remapSelection() {
        const remap = (n: MMNode | null): MMNode | null => (n && n.id ? (this.byId.get(n.id) ?? null) : null);

        this.selected = remap(this.selected);

        const next = new Set<MMNode>();
        for (const n of this.extraSel) {
            const m = remap(n);
            if (m && m !== this.selected) next.add(m);
        }
        this.extraSel = next;
    }

    private refreshSelection() {
        const root = this.tree;
        if (!root) {
            this.hideBatchBar();
            return;
        }

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

        // 反过来也标一下大纲（P2-1）：并排模式下「导图选了谁」一眼可见
        this.markOutlineCursor();
        // 选中数变了可能要让批量操作条浮出 / 收起
        this.refreshBatchBar();
        // 小地图上也要跟着点出来。选择变化不触发重渲染，所以这里必须自己刷 ——
        // 否则「小地图标出选中节点」只在重渲染的那一瞬间成立。
        this.updateMinimapMarks();
    }

    /** 当前参与批量操作的节点，主选中排在最后（删除时从后往前更安全） */
    private get selNodes(): MMNode[] {
        const list = [...this.extraSel];
        if (this.selected && !this.extraSel.has(this.selected)) list.push(this.selected);
        return list;
    }

    private toggleFold(n: MMNode) {
        this.disarmPreview();
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

        /* ---- 演示模式：键盘完全交给「翻页」 ---- */
        // 排在「关菜单」之前：演示是个更强的状态，此时 Esc 的语义只能是「退出演示」。
        // 进演示时已经把菜单收掉了（见 togglePresent），所以这里不会打架。
        if (this.presenting) {
            if (key === "Escape") return take(() => this.togglePresent(false));
            if (key === "ArrowRight" || key === "ArrowDown" || key === " " || key === "PageDown" || key === "Enter") {
                return take(() => this.presentGo(this.presentIdx + 1));
            }
            if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") {
                return take(() => this.presentGo(this.presentIdx - 1));
            }
            if (key === "Home") return take(() => this.presentGo(0));
            if (key === "End") return take(() => this.presentGo(this.presentOrder.length - 1));
            // 演示中其它键一律吞掉：这是「讲」的状态，误触改到内容最煞风景
            return take(() => undefined);
        }

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

        /* ---- 插件自己的菜单开着时，Esc 先关菜单 ---- */
        // 必须排在下面「退出」之前：键盘处理挂在 document 捕获阶段，
        // 比思源 Menu 自己的监听更早拿到 Esc，不在这里让路的话菜单永远关不掉，
        // 用户按 Esc 得到的是「选中被清空、菜单还杵在那」。
        if (key === "Escape" && this.activeMenu) {
            const menu = this.activeMenu;
            this.activeMenu = null;
            return take(() => menu.close());
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
            if (key === "Enter") return take(() => void this.runAction("insertSiblingAfter", cur));
            if (key === "Tab" && !e.shiftKey) return take(() => void this.runAction("insertChild", cur));
            if (key === "Delete" || key === "Backspace") {
                return take(() => {
                    const targets = this.selectedInDocOrder().filter(canDelete);
                    if (targets.length === 0) return;
                    // 删除连同子树的节点前确认一次。虽然插件现在自带撤销
                    // （见 history.ts —— 思源的 Ctrl+Z 管不到块 API 写出来的内容），
                    // 但撤销栈有长度上限，误删一大片还是先问一句更稳妥。
                    if (targets.length > 1) {
                        if (window.confirm(`确定删除选中的 ${targets.length} 个节点及其子树？`)) {
                            // 走批量：整体成功或整体回滚，不会删一半卡住
                            this.runBatchAction("delete", targets);
                        }
                        return;
                    }
                    const only = targets[0];
                    const kids = only.children.length;
                    if (kids > 0 && !window.confirm(`「${only.text}」下还有 ${kids} 个子节点，一并删除？`)) return;
                    void this.runAction("delete", only);
                });
            }
        }

        /* ---- 结构编辑 ---- */
        if (e.shiftKey && key === "Tab") return take(() => void this.runAction("outdent", cur));
        if (mod && key === "ArrowUp") return take(() => void this.runAction("moveUp", cur));
        if (mod && key === "ArrowDown") return take(() => void this.runAction("moveDown", cur));
        if (mod && key.toLowerCase() === "a") return take(() => this.selectAllSiblings());
        if (mod && key.toLowerCase() === "d") return take(() => void this.runAction("duplicate", cur));
        if (mod && key.toLowerCase() === "c") {
            return take(() => {
                this.clipboard = serializeSubtree(cur);
                void this.copyNodeText(cur);
            });
        }
        if (mod && key.toLowerCase() === "v") {
            if (!this.clipboard) return;
            const data = this.clipboard;
            return take(() => void this.runAction("paste", cur, { data }));
        }
        if (mod && key.toLowerCase() === "x") {
            return take(() => {
                this.clipboard = serializeSubtree(cur);
                void this.copyNodeText(cur);
                void this.runAction("delete", cur);
            });
        }

        /* ---- 升降级 ---- */
        if (e.altKey && key === "ArrowLeft") return take(() => void this.runAction("outdent", cur));
        if (e.altKey && key === "ArrowRight") return take(() => void this.runAction("indent", cur));
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
        const menu = this.makeMenu("mm-node-menu");
        const act = (kind: MMActionKind, opts?: MMActionExtra) => {
            void this.runAction(kind, n, opts);
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

        this.popMenu(menu, event);
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
            this.markHoverExpand(null);
            this.dragging = null;

            if (!active) return;
            // 丢掉拖拽结束后紧跟着的那次 click
            this.suppressClick = true;
            window.setTimeout(() => {
                this.suppressClick = false;
            }, 0);

            const drop = this.pendingDrop;
            this.pendingDrop = null;
            if (drop) void this.runAction("move", n, { target: drop.target, position: drop.position });
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
            this.markHoverExpand(null);
            this.clearIndicator();
            return;
        }

        const rect = hit.getBoundingClientRect();
        const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
        const position: MMDropPosition =
            ratio < DROP_BEFORE_RATIO ? "before" : ratio > DROP_AFTER_RATIO ? "after" : "child";

        this.pendingDrop = { target, position };
        this.showIndicator(hit, position);

        // 悬停在折叠节点上稍作停留就自动展开，方便拖进深层。
        // 顺带给珠子套一圈与等待时长同步的环形进度 —— 否则用户根本不知道
        // 「停一下会展开」这件事存在，只会觉得拖不进去。
        window.clearTimeout(this.hoverExpandTimer);
        if (position === "child" && target.folded && target.children.length > 0) {
            this.markHoverExpand(target);
            this.hoverExpandTimer = window.setTimeout(() => {
                this.markHoverExpand(null);
                if (this.dragging && this.pendingDrop?.target === target) {
                    target.folded = false;
                    if (target.id) this.cb.onFoldChange(target.id, false);
                    this.render();
                }
            }, HOVER_EXPAND_DELAY);
        } else {
            this.markHoverExpand(null);
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
            this.minimapMarks = [];
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
        const marks: Array<{ node: MMNode; id: string; cx: string; cy: string }> = [];
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
            marks.push({
                node: n,
                id: n.id ?? "",
                cx: ((n.x + n.w / 2) * k).toFixed(1),
                cy: ((n.y + n.h / 2) * k).toFixed(1),
            });
            n.kids.forEach(walk);
        };
        walk(root);
        this.minimapMarks = marks;

        const vw = this.viewportEl.clientWidth;
        const vh = this.viewportEl.clientHeight;
        const vx = (-this.tx / this.scale) * k;
        const vy = (-this.ty / this.scale) * k;
        const vw2 = (vw / this.scale) * k;
        const vh2 = (vh / this.scale) * k;

        this.minimapEl.innerHTML = [
            `<svg width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}">`,
            rects.join(""),
            // 标记单独成层：选中一变只重写这一层，底图不动
            `<g class="mm-mm-marks">${this.minimapMarkSvg()}</g>`,
            `<rect class="mm-mm-view" x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw2.toFixed(1)}" height="${vh2.toFixed(1)}" rx="2"/>`,
            `</svg>`,
        ].join("");

        this.minimapK = k;
        this.updateMinimapView();
    }

    /** 搜索命中 / 选中的标记。搜索命中的用暖色、选中的用主色，一眼能分开 */
    private minimapMarkSvg(): string {
        const hitSet = new Set(this.searchHits);
        const selSet = new Set(this.selNodes);
        const out: string[] = [];
        for (const m of this.minimapMarks) {
            if (m.id && hitSet.has(m.id)) out.push(`<circle class="mm-mm-hit" cx="${m.cx}" cy="${m.cy}" r="2.4"/>`);
            if (selSet.has(m.node)) out.push(`<circle class="mm-mm-sel" cx="${m.cx}" cy="${m.cy}" r="2.8"/>`);
        }
        return out.join("");
    }

    /**
     * 只重写标记层。
     *
     * 选择变化（点节点、Ctrl+A、框选）不触发重渲染，所以不会走到 refreshMinimap ——
     * 以前的表现是「小地图上永远看不到自己选了哪儿」，那个增强等于白做。
     */
    private updateMinimapMarks() {
        if (this.minimapEl.style.display === "none") return;
        const g = this.minimapEl.querySelector<SVGGElement>(".mm-mm-marks");
        if (!g) return;
        g.innerHTML = this.minimapMarkSvg();
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
        // 画布一动，悬停预览锚定的位置就失效了，留着只会浮在错误的地方
        this.hidePreview();
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
        on(this.rootEl, "blur", () => {
            this.hideTip();
            this.disarmPreview();
        });

        // 大纲 ↔ 导图 双向高亮（P2-1）
        this.bindOutlineCursor();

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
                    this.disarmPreview();
                    this.tx -= e.deltaX;
                    this.ty -= e.deltaY;
                    this.updateTransform();
                }
            },
            { passive: false },
        );

        /* ---- 拖拽平移 / Shift 框选 ---- */
        on(this.viewportEl, "mousedown", (e: MouseEvent) => {
            this.disarmPreview();
            const t = e.target as HTMLElement;
            if (
                t.closest(".mm-node") ||
                t.closest(".mm-zoombar") ||
                t.closest(".mm-minimap") ||
                t.closest(".mm-search") ||
                t.closest(".mm-present-bar") ||
                // 批量条现在浮在画布里面（见样式表），按住它不能开始拖画布
                t.closest(".mm-batch")
            ) {
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
                if (t?.closest?.(".mm-zoombar, .mm-minimap, .mm-search, .mm-toolbar, .mm-crumb, .mm-lightbox, .mm-present-bar")) {
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
                if (t?.closest?.(".mm-zoombar, .mm-minimap, .mm-search, .mm-toolbar, .mm-crumb, .mm-lightbox, .mm-present-bar")) return;

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
            if (
                t.closest(".mm-node") ||
                t.closest(".mm-zoombar") ||
                t.closest(".mm-minimap") ||
                t.closest(".mm-present-bar") ||
                t.closest(".mm-batch")
            )
                return;
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
