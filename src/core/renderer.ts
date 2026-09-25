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
    MMFilter,
    MMLayout,
    MMNode,
    MMNodeMark,
    MMSearchHit,
    MMTheme,
    MMThemeId,
    MMTransientState,
    MMViewPrefs,
} from "../types";
import { EDIT_FLAG, FILTER_LABEL } from "../types";
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
    shownChildren,
} from "./tree";
import { copyText, scrollToBlock } from "../utils/api";
import { hasMark, MARK_COLORS, MARK_ICONS, MARK_LABEL_MAX, sameMark } from "./marks";

export interface ViewCallbacks {
    /**
     * i18n 词表（可选）。视图里所有「用户可见文案」都从这里取，
     * 取不到就回退到内置中文 —— 缺词表时行为与以前**完全一致**。
     *
     * 为什么挂在 `cb` 上而不是 `options`：`options`（`MMConfig`）是**用户配置**，
     * 会被写进块属性、跟着文档走；词表是**运行时环境**，两者生命周期不同。
     * 挂成可选字段还有个好处：三个构造点只需在字面量里补一行，不影响既有调用。
     */
    i18n?: Record<string, string>;
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
    /**
     * 瞬态状态（搜索框开着没有 / 查询串 / 当前第几条）变了。
     *
     * **可选**，而且只有「挂在 `.list` 里」的行内视图需要接 ——
     * 它会被 Protyle 换掉 `.list` 时连根摘除、随后重建，状态不存就丢。
     * 全屏弹层 / 并排面板挂在 `body` 上，不受影响（见 `MMTransientState` 的注释）。
     */
    onTransient?: (s: MMTransientState) => void;
    /** 打开一个块（双链的目标）—— 一般是打开它所在的页签 */
    onOpenBlock: (id: string) => void;
    /**
     * 撤销 / 重做。返回「插件是否接管了这个键」——
     * 返回 false 表示自己的栈是空的，Ctrl+Z 应该继续冒泡给思源自己的撤销栈。
     */
    onHistory: (redo: boolean) => boolean;
    /**
     * 节点标记变了（P1-2）。
     *
     * 传 `null` 表示**清除标记**（外部应当把块属性删掉，而不是写成空串）。
     * 写回走块属性 `custom-mindmap-mark` —— 视图自己不存，见 `core/marks.ts`。
     */
    onMarkChange: (node: MMNode, mark: MMNodeMark | null) => void;
    /**
     * 跨图搜索（P1-1）：在这篇文档的**所有导图列表**里找节点。
     *
     * 交给外部实现，是因为视图手里只有自己这一个列表块 ——
     * 「文档里还有哪些列表是导图」这件事得靠内核查（见 `searchDocOutline`）。
     * 没实现就退回「只搜本图」。
     */
    onSearchDoc?: (q: string) => Promise<MMSearchHit[]>;
}

/** 拖拽落点：上缘 / 下缘判定为同级插入，中间判定为成为子节点 */
const DROP_BEFORE_RATIO = 0.28;
const DROP_AFTER_RATIO = 0.72;

/** 移动超过该像素才算拖拽，用来区分点击 */
const DRAG_THRESHOLD = 4;

/** 拖拽悬停多久自动展开折叠节点 */
const HOVER_EXPAND_DELAY = 420;
/**
 * 搜索时「跳到命中项」的防抖延迟。
 *
 * ## 为什么必须防抖（不是「手感调优」，是**功能性**的）
 *
 * `gotoHit()` 要展开命中的祖先 → 整树 `render()`。而导图是渲染在
 * **Protyle 的可编辑块内部**的，这一次大改 DOM 会让 Protyle 重建整个 `.list` ——
 * 旧元素连同 `.mm-root`、**连同搜索输入框**一起脱离文档，插件随后再挂回来。
 *
 * 实测（64 节点、命中藏在折叠子树里）：
 *   · 那一轮重建里主线程被**同步占用 1.6 秒**（`longtask` 量到的）；
 *   · 期间敲进去的字符**全部落空** —— 零间隔连打 15 个字符，框里只剩 1 个。
 *
 * 所以「每敲一个字就跳一次」= 每个字都可能把输入框摘走一次。
 * 防抖到停手之后再跳，连续打字就完全不会触发重建。
 * 顺带也是更好的交互：每敲一个字就重新取景，画面会晃得没法看。
 */
const SEARCH_JUMP_DELAY = 400;
/** 拖拽到边缘多少像素内开始自动滚动 */
const AUTO_SCROLL_MARGIN = 34;
const AUTO_SCROLL_SPEED = 9;

/**
 * 画布内边距（世界坐标）：`layout()` 会把它加到内容包围盒的两侧。
 *
 * ⚠️ `fit()` 的取景钳制必须减掉它。`frameAxis` 钳的是**画布**边缘，
 * 而用户看到的是**内容**边缘 —— 两者之间差着这份内边距。
 * 不减的话，内容边缘会白白多让出 `pad × scale` 的空白（实测 72 × 0.55 ≈ 40px），
 * 左右各一份，可读优先模式下可视区被吃掉两成半。
 */
const LAYOUT_PAD_X = 72;
const LAYOUT_PAD_Y = 64;

/**
 * 小地图的最少节点数。低于这个数「一眼能看完」，再挂个缩略图纯属占地方
 * （见 `docs/画布与工具交互增强建议.md` 的 P1-3）。
 *
 * ⚠️ 但这条线**用户看不见** —— 设置里开关明明开着、右下角却什么都没有，
 * 很容易被当成插件坏了（真机上就收到过这样的反馈）。
 * 所以 `config.minimapAlways` 留了个显式出口：想一直看到它，打开那个开关即可。
 * 分工是：**阈值负责「默认清爽」，开关负责「用户说了算」**。
 */
const MINIMAP_MIN_NODES = 30;
/** 小地图最多画多少个矩形，超过就抽样 */
const MINIMAP_MAX_RECTS = 700;

/**
 * 画布高度的绝对下限：比这更矮就不像一块画布了。
 *
 * 和 `MINIMAP_MIN_NODES` 是同一个套路 —— 常量负责兜底，配置负责让用户说了算。
 */
const CANVAS_MIN_H = 240;
/** 配置缺失 / 非法时的画布高度兜底（与 `DEFAULT_CONFIG.canvasHeight` 一致） */
const CANVAS_DEFAULT_H = 480;

/**
 * 「单独按下的修饰键」—— 这些 keydown 导图没有动作可做，但它们会让思源的编辑器
 * 把焦点抢走（见 `handleGlobalKey` 里的长注释）。判定时必须把它们也当成
 * 「要抢回焦点」的情形，否则真实键盘下的 Ctrl+字母 全部收不到。
 */
const MODIFIER_ONLY_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);

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
    toggleCheck: "勾选中…",
    check: "勾选中…",
    uncheck: "取消中…",
};

/** 批量操作成功后的提示 */
const BATCH_DONE_LABEL: Record<string, string> = {
    indent: "已批量降级",
    outdent: "已批量升级",
    delete: "已删除选中节点（Ctrl+Z 可撤销）",
    fold: "已折叠选中节点",
    unfold: "已展开选中节点",
    check: "已勾选选中的待办",
    uncheck: "已取消勾选选中的待办",
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
    /**
     * 全局默认里「可被文档级偏好覆盖」的那三项。
     *
     * `恢复本列表的默认视图` 必须靠它把 `options` 拉回去 —— 光清 `prefs` 是不够的，
     * 原因见 `resetToGlobal()` 的注释。
     */
    private globalDefaults: { layout: MMLayout; theme: MMThemeId; edge: MMEdgeStyle };
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
    /** 打字期间那次「跳到命中项」的防抖定时器 —— 见 `SEARCH_JUMP_DELAY` */
    private gotoHitTimer: number | null = null;

    /* -------------------------------------------------- 过滤器（P1-1） */

    /**
     * 当前状态过滤器。
     *
     * **只活在内存里**，不写进文档偏好 —— 「我瞄一眼还有哪些没做完」是一次浏览行为，
     * 不该变成下次打开这张图的默认样子。要持久的是视图偏好（布局 / 缩放），不是筛选。
     */
    private filter: MMFilter = "all";
    /** 工具条上那组 chip，用来同步高亮 / 显隐 */
    private filterEls: HTMLButtonElement[] = [];
    /** 装了过滤器的那个分组 —— 整张图一个待办都没有时整组藏起来 */
    private filterGroup!: HTMLElement;
    /** 上一轮过滤命中了几项 —— 用来在「筛完是空的」时说一句人话 */
    private filterHits = 0;

    /* -------------------------------------------------- 节点标记（P1-2） */

    /** 打开着的标记浮层。跟着节点走，所以只记 ID，重渲染后按 ID 重新定位 */
    private markPop: HTMLElement | null = null;
    private markPopId = "";
    /**
     * 标记覆盖表（**活引用**，每次 render 现读）。
     *
     * 写块属性到内核把 DOM 推回来之间有几百毫秒。这段空窗里任何一次重渲染
     * 都会按**旧属性**解析，刚设好的标记会「闪一下再回来」。
     * 与折叠同步（`getFoldOverlay`）是同一个套路：先给结果，再等真相。
     * 每项带 3 秒超时 —— 写失败了就让它消失，别留一个永远不会成真的假象。
     */
    private markOverlay = new Map<string, MMNodeMark | null>();

    /* -------------------------------------------------- 跨图搜索（P1-1） */

    /** 搜索范围是不是「本文档所有导图」 */
    private searchAll = false;
    private scopeBtn!: HTMLButtonElement;
    /** 跨图搜索的结果面板 */
    private resultsEl!: HTMLElement;
    /** 最近一次跨图搜索的命中，点结果时按 id 取 */
    private docHits: MMSearchHit[] = [];
    /** 跨图搜索的防抖句柄 —— 每敲一个字都打一次 SQL 太浪费 */
    private docSearchTimer = 0;
    /** 请求序号：只认最后一次的返回，防止慢的请求盖掉快的 */
    private docSearchSeq = 0;

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
    /**
     * 批量条上的「完成 / 取消」按钮。
     *
     * 操作条是**建一次复用**的，但这两个按钮只对「选中里含待办」的场合有意义 ——
     * 全是普通段落时它们必须消失，否则点下去只会得到一句「没有待办项」。
     * 所以存下引用，在每次刷新时按选区内容切换显隐。
     */
    private batchCheckEls: HTMLElement[] = [];

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
        // 构造时传进来的就是全局配置快照 —— 当作「全局默认」的初值
        this.globalDefaults = { layout: options.layout, theme: options.theme, edge: options.edge };
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
        this.emptyEl.innerHTML = this.t("ui.emptyHint", "<strong>这里还没有内容</strong><span>在列表里添加条目，导图会实时同步</span>");

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
        if (this.gotoHitTimer !== null) {
            window.clearTimeout(this.gotoHitTimer);
            this.gotoHitTimer = null;
        }
        this.editing = null;
        this.dragging = null;
        this.pendingDrop = null;
        this.clearIndicator();
        this.hideTip();
        this.hidePreview();
        this.hideBatchBar();
        this.hidePresentBar();
        this.closeMarkPopover();
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

    /**
     * 给「复制诊断信息」用的一行状态摘要（P1-5）。
     *
     * 只报**事实**，不做任何格式化排版 —— 排版归 diagnostics 那边管，
     * 这里多写一个冒号都会变成两处要同步的格式。
     */
    diagLine() {
        return {
            mode: this.mode,
            listId: this.listEl.dataset.nodeId ?? "",
            nodes: this.nodeCount,
            layout: this.options.layout,
            theme: this.options.theme,
            edge: this.options.edge,
            branchColor: this.options.branchColor ? "on" : "off",
            scale: Math.round(this.scale * 100),
            filter: this.filter,
            selected: (this.selected ? 1 : 0) + this.extraSel.size,
            drill: this.drillPath.length,
        };
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

    /**
     * 取一条用户可见文案：优先用外部注入的 i18n 词表，取不到回退到内置中文。
     *
     * 之所以要这个方法、而不是把 `this.cb.i18n?.x || "中文"` 散落到各处：
     * ① 回退逻辑只写一次；② 将来若要做「词表缺键时告警」也只有一处要改。
     *
     * ⚠️ 只覆盖**用户可见**的文案。控制台日志、内核报错回显**不进** i18n ——
     * 那些是给开发者看的，进词表只会徒增翻译负担（见 docs 第二十节的三层分类）。
     */
    private t(key: string, fallback: string, vars?: Record<string, string | number>): string {
        const v = this.cb.i18n?.[key];
        let s = typeof v === "string" && v ? v : fallback;
        // 占位符模板（`{n}` / `{text}`）。**带变量的提示语必须走模板** ——
        // 把「已导出」和「选中的 N 个节点」拼起来，中文下看不出问题，
        // 英文下会得到 "Exported选中的 3 个节点" 这种中英混搭的句子。
        if (vars) for (const [k, val] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(val));
        return s;
    }

    /** 只更新渲染参数，不重建视图 */
    setOptions(options: Partial<MMConfig>) {
        // 顺手把「全局默认」更新一遍 —— `refreshAll()` 传进来的是完整全局配置。
        // 用户在设置面板里改了全局主题之后，`恢复本列表的默认视图` 要回到**新的**全局默认。
        if (options.layout) this.globalDefaults.layout = options.layout;
        if (options.theme) this.globalDefaults.theme = options.theme;
        if (options.edge) this.globalDefaults.edge = options.edge;
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

    /**
     * 清空文档级偏好，并把被偏好覆盖过的三项**显式**拉回全局默认。
     *
     * ## ⚠️ 为什么不能只调 `applyViewPrefs({})`
     *
     * `applyViewPrefs` 的语义是「用偏好**覆盖**全局默认」，所以它是
     * `if (prefs.layout) this.options.layout = prefs.layout;` 这样写的 ——
     * **只覆盖显式给出的项**。传空对象进去，它一项都不覆盖。
     *
     * 于是「恢复本列表的默认视图」原来这么写就废了：
     *
     * ```ts
     * for (const k of Object.keys(this.prefs)) this.forgetPref(k);   // prefs 清空 ✓
     * this.applyViewPrefs({});                                       // options 纹丝不动 ✗
     * this.render(true);                                             // 画出来还是旧布局
     * ```
     *
     * 结果：块属性里的偏好确实被删干净了（下次打开这个列表会回到默认），
     * 但**当前画面一点变化都没有**，而 toast 已经说了「已恢复默认视图」——
     * 一个会说谎的提示，比什么都不做更糟。
     *
     * 这个语义本身没错（`applyViewPrefs` 就该只覆盖显式项），
     * 错在「恢复默认」这个动作少了一半：它既要**清掉覆盖**，也要**把覆盖层撤掉**。
     */
    private resetToGlobal() {
        this.prefs = {};
        this.prefsDirty.clear();
        this.options.layout = this.globalDefaults.layout;
        this.options.theme = this.globalDefaults.theme;
        this.options.edge = this.globalDefaults.edge;
        this.syncToolbar();
        // fitView：记住的缩放也一并作废，重新取景才是「默认视图」该有的样子
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
            // 布局名走 i18n（键名约定：layout + 首字母大写，如 logic → layoutLogic）
            const layoutLabel = this.t(`layout.${key}`, LAYOUT_LABEL[key]);
            b.textContent = layoutLabel;
            b.dataset.mmTip = layoutLabel;
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
            this.mkToolBtn("fold", this.t("tip.foldAll", "折叠全部"), () => this.foldAll(true)),
            this.mkToolBtn("unfold", this.t("tip.unfoldAll", "展开全部"), () => this.foldAll(false)),
        );

        /* ---- 状态过滤（P1-1）----
         * 放在工具条上而不是搜索框里：「只看未完成」是任务列表场景的高频动作，
         * 要求先按 Ctrl+F 打开搜索框再点一下，等于把这个功能藏起来了。
         * 整张图一个待办都没有时，`syncFilterGroup()` 会把这一组整个收掉 ——
         * 不是任务列表的导图不该平白多出三个永远无效的按钮。 */
        this.filterGroup = document.createElement("div");
        this.filterGroup.className = "mm-group mm-filters";
        this.filterEls = (["all", "todo", "done"] as MMFilter[]).map((key) => {
            const b = document.createElement("button");
            b.type = "button";
            b.dataset.filter = key;
            b.textContent = this.t(`filter.${key}`, FILTER_LABEL[key]);
            // 提示单独给键：`只看${FILTER_LABEL[key]}的待办` 是拼接式，英文下会混搭
            b.dataset.mmTip =
                key === "all"
                    ? this.t("tip.filterAll", "显示全部节点")
                    : this.t(`tip.filter.${key}`, `只看${FILTER_LABEL[key]}的待办`);
            b.onclick = (e) => {
                e.stopPropagation();
                this.setFilter(key);
            };
            this.filterGroup.appendChild(b);
            return b;
        });
        this.filterGroup.style.display = "none";

        const actGroup = document.createElement("div");
        actGroup.className = "mm-group";
        actGroup.append(this.mkToolBtn("search", this.t("tip.search", "搜索节点"), () => this.toggleSearch(), "Ctrl F"));
        actGroup.append(this.mkToolBtn("level", this.t("tip.viewOptions", "视图选项（主题 / 连线 / 配色）"), (e) => this.openViewMenu(e)));
        actGroup.append(this.mkToolBtn("present", this.t("tip.present", "演示模式：逐层展开，方向键推进"), () => this.togglePresent(), ""));
        actGroup.append(this.mkToolBtn("download", this.t("tip.exportImage", "导出图片"), (e) => this.openExportMenu(e)));
        if (this.mode === "inline") {
            actGroup.append(
                this.mkToolBtn("expand", this.t("tip.fullscreen", "全屏查看"), () => {
                    if (this.tree) this.cb.onFullscreen(this.tree, resolveTheme(this.options.theme));
                }),
            );
        }
        actGroup.append(
            this.mkToolBtn(
                "close",
                this.mode === "dialog" ? this.t("ui.close", "关闭") : this.t("ui.backToOutline", "回到大纲视图"),
                () => this.cb.onExit(),
            ),
        );

        this.toolbarEl.append(seg, this.mkSep(), foldGroup, this.filterGroup, spacer, actGroup);

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
        label.dataset.mmTip = this.t("tip.zoomOptions", "缩放选项");
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
            mk("−", this.t("ui.zoomOut", "缩小"), () => this.zoomAt(1 / 1.2), "Ctrl -"),
            label,
            mk("+", this.t("ui.zoomIn", "放大"), () => this.zoomAt(1.2), "Ctrl ="),
            mk(this.t("ui.fit", "适应"), this.t("ui.fitCanvas", "适应画布"), () => this.fit(), "Ctrl 0"),
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
        item(this.t("ui.fitCanvas", "适应画布"), "Ctrl 0", false, () => this.fit());
        const sel = this.selNodes;
        item(this.t("ui.fitSelection", "适应选中节点"), "", sel.length === 0, () => this.fitToNodes(sel));
        item(
            this.drillPath.length > 0 ? this.t("ui.onlyThisBranchActive", "只看当前分支（已聚焦）") : this.t("ui.onlyThisBranch", "只看当前分支"),
            this.t("tip.ctrlDblClick", "Ctrl 双击"),
            !this.selected || this.selected.children.length === 0,
            () => {
                if (this.selected) this.drillDown(this.selected);
            },
        );
        menu.addItem({ type: "separator" });
        const remembered = this.prefs.scale !== undefined;
        item(remembered ? this.t("ui.rememberedZoom", "记住这个缩放 ✓") : this.t("ui.rememberZoom", "记住这个缩放"), "", false, () => this.toggleRememberScale());
        this.popMenu(menu, e);
    }

    /** 视图选项菜单：主题 / 连线样式 —— 与布局一样，都记进文档级偏好 */
    private openViewMenu(e: MouseEvent) {
        const menu = this.makeMenu("mm-view-menu");

        const themeItems: IMenu[] = THEME_LIST.map((th) => ({
            label: this.t(`theme.${th.id}`, th.name),
            checked: this.options.theme === th.id,
            click: () => {
                this.options.theme = th.id;
                this.markPref("theme", th.id);
                this.render(true);
            },
        }));
        menu.addItem({ icon: "iconTheme", label: this.t("ui.theme", "主题"), type: "submenu", submenu: themeItems });

        const edgeItems: IMenu[] = (["curve", "elbow", "straight"] as MMEdgeStyle[]).map((k) => ({
            label: this.t(`edge.${k}`, EDGE_LABEL[k]),
            checked: this.options.edge === k,
            click: () => {
                this.options.edge = k;
                this.markPref("edge", k);
                this.drawEdges();
            },
        }));
        menu.addItem({ icon: "iconLine", label: this.t("ui.edgeStyle", "连线样式"), type: "submenu", submenu: edgeItems });

        menu.addItem({ type: "separator" });
        const hasPrefs = Object.keys(this.prefs).length > 0;
        menu.addItem({
            icon: "iconUndo",
            label: this.t("menu.resetView", "恢复本列表的默认视图"),
            disabled: !hasPrefs,
            click: () => {
                // ① 清掉文档级偏好（`forgetPref` 内部会通知外部防抖写回块属性，
                //    全部清空时属性会被整个删掉，而不是留一个空值）
                for (const k of Object.keys(this.prefs) as Array<keyof MMViewPrefs>) this.forgetPref(k);
                // ② ⚠️ 再把被覆盖的三项显式拉回全局默认并重绘。
                //    不能只靠 `applyViewPrefs({})` —— 它只覆盖「显式给出」的项，
                //    空对象什么都不覆盖，画面会纹丝不动（见 `resetToGlobal()` 的注释）。
                this.resetToGlobal();
                showMessage(this.t("msg.viewReset", "已恢复默认视图"), 2000);
            },
        });
        this.popMenu(menu, e);
    }

    /** 缩放到刚好框住这些节点 */
    private fitToNodes(nodes: MMNode[]) {
        if (nodes.length === 0) {
            showMessage(this.t("msg.selectNodeFirst", "先选中一个节点"), 2200);
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
            showMessage(this.t("msg.zoomUnremembered", "已取消记住缩放"), 2000);
            return;
        }
        this.markPref("scale", this.scale);
        showMessage(this.t("msg.zoomRemembered", "已记住这个缩放（{n}%）", { n: Math.round(this.scale * 100) }), 2200);
    }

    private buildSearch() {
        this.searchInput = document.createElement("input");
        this.searchInput.type = "text";
        this.searchInput.placeholder = this.t("ui.searchPlaceholder", "搜索节点…");
        this.searchInput.spellcheck = false;
        this.searchInput.oninput = () => this.runSearch(this.searchInput.value);
        this.searchInput.onkeydown = (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                e.preventDefault();
                // 跨图范围下 Enter 落到结果面板的第一条 —— 那边的「下一条」
                // 是列表里的下一行，用方向键更自然
                if (this.searchAll) this.pickDocHit(0);
                else this.stepSearch(e.shiftKey ? -1 : 1);
            } else if (e.key === "ArrowDown" && this.searchAll && this.docHits.length) {
                e.preventDefault();
                this.pickDocHit(0);
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

        /* 范围开关：本图 / 全文档。
           做成一个会「翻面」的按钮而不是下拉框 —— 只有两个取值，
           下拉要多点一次，而且这个开关的使用频率比想象中高得多。 */
        this.scopeBtn = mk(this.t("search.scopeHere", "本图"), this.t("tip.searchScope", "切换搜索范围：当前导图 / 本文档所有导图"), () => this.setSearchScope(!this.searchAll));
        this.scopeBtn.className = "mm-search-scope";

        /* 结果面板：只有「全文档」范围才用得上。
           本图范围下命中是直接画在画布上的（`.mm-hit`），不需要列一遍。 */
        this.resultsEl = document.createElement("div");
        this.resultsEl.className = "mm-results";

        // 原来 searchEl 自己就是那一行 flex。加结果面板之后必须分成
        // 「一行控件 + 一块面板」，所以这里多包一层 —— 见 index.css 的 .mm-search-row。
        const row = document.createElement("div");
        row.className = "mm-search-row";
        row.append(
            this.searchInput,
            this.searchCount,
            this.scopeBtn,
            mk("‹", this.t("search.prev", "上一个"), () => this.stepSearch(-1)),
            mk("›", this.t("search.next", "下一个"), () => this.stepSearch(1)),
            mk("✕", this.t("search.close", "关闭搜索"), () => this.toggleSearch(false)),
        );
        this.searchEl.append(row, this.resultsEl);
    }

    /** 切换搜索范围，并立刻按新范围重跑一次 */
    private setSearchScope(all: boolean) {
        this.searchAll = all;
        this.scopeBtn.textContent = all ? this.t("search.scopeAll", "全文档") : this.t("search.scopeHere", "本图");
        this.scopeBtn.classList.toggle("mm-on", all);
        this.runSearch(this.searchInput.value);
        if (all) this.searchInput.focus();
    }

    /** 跨图搜索的结果面板 */
    private renderDocResults() {
        if (!this.searchAll || !this.searchInput.value.trim()) {
            this.resultsEl.classList.remove("mm-results--on");
            this.resultsEl.innerHTML = "";
            return;
        }
        this.updateSearchCount();
        this.resultsEl.innerHTML = "";
        this.resultsEl.classList.add("mm-results--on");

        if (this.docHits.length === 0) {
            const none = document.createElement("div");
            none.className = "mm-result mm-result--none";
            none.textContent = this.t("search.noMatchInDoc", "本文档的导图里没有匹配的节点");
            this.resultsEl.appendChild(none);
            return;
        }

        for (const [i, hit] of this.docHits.entries()) {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "mm-result";
            const text = document.createElement("span");
            text.className = "mm-result-text";
            text.textContent = hit.text;
            const path = document.createElement("span");
            path.className = "mm-result-path";
            // 路径去掉最后一段（就是 text 自己），只留祖先
            const anc = hit.path.includes(" › ") ? hit.path.slice(0, hit.path.lastIndexOf(" › ")) : "";
            path.textContent = hit.listId === this.listEl.dataset.nodeId ? this.t("search.scopeHere", "本图") : anc || this.t("search.otherMap", "另一张导图");
            row.append(text, path);
            row.dataset.mmTip = hit.path;
            row.onclick = (e) => {
                e.stopPropagation();
                this.pickDocHit(i);
            };
            this.resultsEl.appendChild(row);
        }
    }

    /**
     * 跳到某条跨图命中。
     *
     * 两种情况分得很清楚：
     *  - 命中就在**当前这张图**里 → 直接聚焦那个节点（还能顺手展开它的祖先）；
     *  - 命中在**别的导图**里 → 把编辑器滚过去并高亮。
     *    不去偷偷切换视图：用户正在这张图上干活，把画面换掉是一种冒犯。
     */
    private pickDocHit(i: number) {
        const hit = this.docHits[i];
        if (!hit) return;
        if (hit.listId === this.listEl.dataset.nodeId && this.byId.has(hit.id)) {
            // 命中可能正好被当前过滤器筛掉了（跨图搜索**不看过滤器** ——
            // 它回答的是「这东西在文档的哪里」，不是「在这张图的可见范围里吗」）。
            // 那就先把过滤器撤掉：用户明确找它，把焦点落到一个看不见的节点上是耍人。
            const node = this.byId.get(hit.id)!;
            if (node.hidden) {
                this.filter = "all";
                this.render(true);
            }
            this.searchHits = [hit.id];
            this.searchIdx = 0;
            this.updateSearchCount();
            this.applySearchMarks();
            this.gotoHit();
        } else {
            scrollToBlock(hit.id);
            showMessage(this.t("msg.locatedInDoc", "已定位到正文里的那个节点"), 2200);
        }
        this.searchInput.focus();
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
            label: this.t("exportPng", "导出 PNG"),
            click: () => void this.doExport("png"),
        });
        menu.addItem({
            icon: "iconFile",
            label: this.t("exportSvg", "导出 SVG"),
            click: () => void this.doExport("svg"),
        });
        menu.addItem({ type: "separator" });
        menu.addItem({
            icon: "iconImage",
            label: sel > 1 ? this.t("export.onlySelectedN", "只导出选中的 {n} 个节点", { n: sel }) : this.t("export.onlySelected", "只导出选中（先选节点）"),
            disabled: sel === 0,
            click: () => void this.doExport("png", this.selectedInDocOrder()),
        });
        menu.addItem({
            icon: "iconCopy",
            label: this.t("export.copyImage", "复制为图片到剪贴板"),
            click: () => void this.copyImage(),
        });
        menu.addItem({
            icon: "iconFile",
            label: this.t("export.markdown", "导出 Markdown 大纲"),
            click: () => {
                const md = this.outlineMarkdown();
                if (!md) {
                    showMessage(this.t("msg.exportEmpty", "导图是空的，没有可导出的内容"), 2400);
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
            showMessage(this.t("msg.exportOffscreen", "选中的节点都不在画面上，无法导出"), 2600, "error");
            return;
        }
        try {
            if (kind === "png") await exportPng(this.rootEl, this.title, 2, crop);
            else await exportSvg(this.rootEl, this.title, crop);
            /* ⚠️ 这里是**拼接**式：`exported` 当「已导出」前缀用。
               中文下与原样一致；英文下会得到 "Exported选中的 N 个节点" 这种混搭 ——
               第二步做完整 i18n 时该把它改成占位符模板（如 `exportedN` = "已导出选中的 {n} 个节点"）。
               现在这么接，是为了先把「声明了却没用」的键接上、且**不改变中文行为**。 */
            if (only) showMessage(this.t("msg.exportedN", "已导出选中的 {n} 个节点", { n: only.length }), 2000);
        } catch (err) {
            console.warn("[mindmap] 导出失败", err);
            // 用户可见的那句走 i18n；上面那行 console.warn 是开发者可见的，保持不动
            showMessage(this.t("exportFailed", "导出失败"), 4000, "error");
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
            this.syncFilterGroup();
            return;
        }
        this.emptyEl.style.display = "none";

        const root0 = wrapRoot(items, this.title);
        // 下钻：把当前聚焦的那个节点当成新的根。必须在 decorate 之前完成 ——
        // decorate 会按新的根重新分配 depth / branch / order / color，
        // 换根之后这些量必须整体重算（否则一级分支会被算成第 3 层，配色和缩进全乱）。
        const root = this.applyDrill(root0);
        decorate(root, palette, this.options.branchColor);
        // 标记里的自定义色盖在分支色之上。
        // 盖在 `n.color` 上而不是只在画 DOM 时改一下 —— 连线、小地图、折叠按钮
        // 全都从 `n.color` 取色，只改 DOM 的话节点变了色、连到它的线还是旧色。
        for (const n of flatten(root)) if (n.mark?.color) n.color = n.mark.color;
        /* 标记覆盖表：写内核到内核回推 DOM 之间的空窗（见 markOverlay 的注释）。
           必须在 decorate 与上面那行配色**之后**盖 —— 它要同时改 mark 和 color。 */
        if (this.markOverlay.size > 0) {
            for (const n of flatten(root)) {
                if (!n.id || !this.markOverlay.has(n.id)) continue;
                const want = this.markOverlay.get(n.id) ?? undefined;
                if (sameMark(n.mark, want)) {
                    // DOM 已经跟上了，覆盖表这一项可以退休了
                    this.markOverlay.delete(n.id);
                    continue;
                }
                n.mark = want;
                if (want?.color) n.color = want.color;
            }
        }

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
        // 过滤器必须在布局之前落定 —— layout 只认 kids，kids 是按 hidden 算的。
        this.applyFilter(root);
        // 选择必须跟着新树重绑一次 —— 见 remapSelection 的注释。
        this.remapSelection();
        // 选中的节点可能刚被筛掉了。不清掉的话，选中框会画在一个看不见的节点上，
        // 接着按 Delete / 方向键操作的是一个「用户以为已经不存在」的东西。
        if (this.selected?.hidden) {
            this.selected = null;
            this.extraSel.clear();
        }
        for (const n of [...this.extraSel]) if (n.hidden) this.extraSel.delete(n);

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
            padX: LAYOUT_PAD_X,
            padY: LAYOUT_PAD_Y,
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
        /* 树重建了 → 命中集合也要跟着重算（见 `refreshSearchOnRender`）。
           这里以前直接 `applySearchMarks()`，等于拿**旧树的 id** 往新树上贴 class ——
           重建之后「计数说 1/1、画面一个高亮都没有」就是这么来的。 */
        this.refreshSearchOnRender();
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
        this.syncFilterGroup();
        // 浮层是贴在某个节点上的，重渲染换了元素就得重新贴一次
        this.positionMarkPop();
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
        this.tx = this.frameAxis(
            (vw - this.worldW * this.scale) / 2,
            this.worldW * this.scale,
            vw,
            LAYOUT_PAD_X * this.scale,
        );
        this.ty = this.frameAxis(
            (vh - this.worldH * this.scale) / 2,
            this.worldH * this.scale,
            vh,
            LAYOUT_PAD_Y * this.scale,
        );
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
                this.flashError(node, this.t("msg.operationFailed", "操作失败，请重试"));
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
                    showMessage(this.t(`batchDone.${kind}`, BATCH_DONE_LABEL[kind] ?? "已完成"), 1800);
                    return;
                }
                // 批量失败是**整体回滚**的，逐个闪红没有信息量，只闪一遍 + 说清原因
                for (const n of nodes) this.flashNode(n, out.message);
                showMessage(out.message ?? this.t("msg.batchRolledBack", "批量操作失败，已全部还原"), 3200, "error");
            })
            .catch((err) => {
                console.warn("[mindmap] 批量操作异常", kind, err);
                tokens.forEach((t) => this.dropGhost(t));
                showMessage(this.t("msg.batchRolledBack", "批量操作失败，已全部还原"), 3200, "error");
            });
    }

    /* ================================================== 待办勾选（P0-1） */

    /**
     * 把勾选态画到某个复选框上（不传就按块 ID 找当前那一个）。
     *
     * 抽出来是因为**同一套画法要用在三处**：初次创建、点击后的乐观翻转、写失败后的回退。
     * 三处各写一遍迟早会漂移（比如某处忘了同步 `mm-done` 或 `aria-checked`）。
     */
    private paintTaskCheck(n: MMNode, checked: boolean, box?: HTMLElement) {
        const el = (n.id ? this.byId.get(n.id)?.el : undefined) ?? n.el;
        el?.classList.toggle("mm-done", checked);
        const b = box ?? el?.querySelector<HTMLElement>(".mm-task");
        if (!b) return;
        b.textContent = checked ? "✓" : "";
        b.classList.toggle("mm-task--done", checked);
        b.setAttribute("aria-checked", checked ? "true" : "false");
        b.setAttribute("aria-label", checked ? this.t("menu.markTodo", "标记为未完成") : this.t("menu.markDone", "标记为已完成"));
        b.dataset.mmTip = checked ? this.t("tip.clickToUncheck", "点击取消勾选") : this.t("tip.clickToCheck", "点击标记为已完成");
    }

    /**
     * 点击复选框：乐观翻转 → 写内核 → 失败则退回。
     *
     * 这里没有走 `runAction`，因为**只有勾选需要「失败后把界面退回去」**：
     * 其它动作失败时内核不会回推 DOM，界面本来就没变，闪个红边就够了；
     * 而勾选是先在本地翻的，写失败时没有任何人会把那个 ✓ 抹掉 ——
     * 不退回去，用户看到的就是一个「勾上了但其实没勾上」的假象。
     */
    private toggleTaskCheck(n: MMNode, box?: HTMLElement) {
        // 正在编辑这个节点的文字时，点复选框的意图更可能是「结束编辑」
        // （编辑态里点别处会提交并退出），所以这里先不抢
        if (this.editing === n) return;
        this.disarmPreview();

        const next = !n.checked;
        const revert = () => {
            n.checked = !next;
            this.paintTaskCheck(n, n.checked);
        };

        n.checked = next;
        this.paintTaskCheck(n, next, box);

        const token = this.showGhost(n, "toggleCheck");
        // 目标态显式带过去。执行侧不能拿 `!node.checked` 反推 ——
        // 上一行已经把 `n.checked` 乐观翻成了 `next`，再取反就写回原值了。
        const res = this.cb.onNodeAction("toggleCheck", n, { checked: next });
        if (!res) {
            this.dropGhost(token);
            return;
        }
        void res
            .then((out) => {
                this.dropGhost(token);
                if (out.ok) return;
                revert();
                this.flashError(n, out.message);
            })
            .catch((err) => {
                console.warn("[mindmap] 勾选异常", err);
                this.dropGhost(token);
                revert();
                this.flashError(n, this.t("err.checkFailed", "勾选失败，请重试"));
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
        el.textContent = this.t(`ghost.${kind}`, GHOST_LABEL[kind] ?? "处理中…");

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
        const msg = message || this.t("msg.operationIneffective", "操作未生效，请重试");
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
        if (this.batchCountEl) this.batchCountEl.textContent = this.t("ui.selectedN", "已选 {n} 个", { n });
        // 「完成 / 取消」只对含待办的选区露面。用 display 而不是重建，
        // 免得每次改选都换一批 DOM 让鼠标下的按钮闪一下。
        const hasTask = this.selectedInDocOrder().some((x) => x.kind === "task");
        for (const el of this.batchCheckEls) el.style.display = hasTask ? "" : "none";
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
        close.dataset.mmTip = this.t("menu.clearSelection", "取消选择");
        close.onclick = (e) => {
            e.stopPropagation();
            this.clearSelection();
        };

        bar.append(
            count,
            sep(),
            btn(this.t("act.outdent", "升级"), this.t("tip.batchOutdent", "把选中的节点整体升级一级"), "", () => this.runBatchAction("outdent", this.selectedInDocOrder())),
            btn(this.t("act.indent", "降级"), this.t("tip.batchIndent", "把选中的节点整体降级为「上一个节点」的子节点"), "", () =>
                this.runBatchAction("indent", this.selectedInDocOrder()),
            ),
            btn(this.t("act.collapse", "折叠"), this.t("tip.batchFold", "折叠选中的节点"), "", () => this.batchFold(true)),
            btn(this.t("act.expand", "展开"), this.t("tip.batchUnfold", "展开选中的节点"), "", () => this.batchFold(false)),
            sep(),
        );

        // 待办专用：混选时也能用（只作用于其中的待办项），全选普通段落时整组隐藏
        const checkDone = btn(this.t("ui.done", "完成"), this.t("tip.batchCheck", "把选中的待办标记为已完成"), "", () =>
            this.runBatchAction("check", this.selectedInDocOrder()),
        );
        const checkUndo = btn(this.t("ui.cancel", "取消"), this.t("tip.batchUncheck", "把选中的待办标记为未完成"), "", () =>
            this.runBatchAction("uncheck", this.selectedInDocOrder()),
        );
        this.batchCheckEls = [checkDone, checkUndo];
        bar.append(checkDone, checkUndo, sep());

        bar.append(
            btn(this.t("menu.exportThese", "导出这些"), this.t("menu.exportSelectedDesc", "只导出选中的子树"), "", () => this.runBatchAction("export", this.selectedInDocOrder())),
            btn(this.t("act.delete", "删除"), this.t("tip.batchDelete", "删除选中的节点及其子树（Ctrl+Z 可撤销）"), " mm-batch-btn--danger", () =>
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
        this.batchCheckEls = [];
    }

    /** 批量折叠：直接改大纲的原生 fold（与单击折叠走同一条写回链路） */
    private batchFold(folded: boolean) {
        const nodes = this.selectedInDocOrder().filter((n) => n.children.length > 0);
        if (nodes.length === 0) {
            showMessage(this.t("msg.noChildren", "选中的节点都没有子节点"), 2200);
            return;
        }
        for (const n of nodes) {
            n.folded = folded;
            if (n.id) this.writeFold(n.id, folded);
        }
        this.render();
        this.reclampView();
        const doneKey = folded ? "fold" : "unfold";
        showMessage(this.t(`batchDone.${doneKey}`, BATCH_DONE_LABEL[doneKey] ?? "已完成"), 1600);
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
        head.textContent = this.t("msg.foldedN", "折叠了 {n} 个子节点", { n: n.children.length });
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
            txt.textContent = kid.text || this.t("ui.empty", "（空）");
            row.append(dot, txt);
            list.appendChild(row);
        }
        if (n.children.length > 5) {
            const more = document.createElement("div");
            more.className = "mm-preview-more";
            more.textContent = this.t("ui.moreN", "还有 {n} 个…", { n: n.children.length - 5 });
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
            prev.dataset.mmTip = this.t("present.prev", "上一个（←）");
            prev.onclick = (e) => {
                e.stopPropagation();
                this.presentGo(this.presentIdx - 1);
            };

            const next = document.createElement("button");
            next.type = "button";
            next.textContent = "›";
            next.dataset.mmTip = this.t("present.next", "下一个（→ / 空格）");
            next.onclick = (e) => {
                e.stopPropagation();
                this.presentGo(this.presentIdx + 1);
            };

            const out = document.createElement("button");
            out.type = "button";
            out.className = "mm-present-exit";
            out.textContent = this.t("ui.exitPresent", "退出演示");
            out.dataset.mmTip = this.t("present.exit", "退出（Esc）");
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
            showMessage(this.t("msg.imageCopied", "已复制图片到剪贴板"), 2000);
        } catch (err) {
            console.warn("[mindmap] 复制图片失败", err);
            showMessage(this.t("msg.copyImageFailed", "复制图片失败，浏览器可能不支持"), 3200, "error");
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
            labels.unshift(cur.text?.trim() || this.t("ui.empty", "（空）"));
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
            b.dataset.mmTip = last ? this.t("ui.currentBranch", "当前聚焦的分支") : this.t("ui.backToLevel", "回到这一层");
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
        out.textContent = this.t("ui.exitFocus", "退出聚焦");
        out.dataset.mmTip = this.t("ui.backToFullMap", "回到全图（Esc）");
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

    /**
     * 画布该多高。
     *
     * ⚠️ 这里的数字同时承担两件事，所以必须分开看：
     *   · **可视区高度** —— 用户能看见多少
     *   · **文档占位高度** —— 这篇文档要滚多久
     *
     * 老实现把两者绑在一个数字上（`clamp(内容高, 260, 可用高)`），于是
     * **「内容少」这一侧被误伤**：实测（窗口 1584×905，编辑器区 768，可用高 688）
     *
     * | 场景 | 画布高 | 占编辑器区 |
     * | --- | --- | --- |
     * | 4 个节点 | 280px | 36% |
     * | 49 个节点 | 688px | 90% |
     *
     * 同一块画布落差 **2.46 倍**，而且完全由内容决定 —— 用户的原话是
     * 「它似乎是根据节点的长度来逐步加大画布的」，字面上完全正确。
     *
     * 现在改成：**下限交给用户（`canvasHeight`），上限仍然守着「别把文档顶下去几屏」**。
     *
     *   · `auto`  —— `clamp(内容高, 下限, 可用高)`：小图也有一块像样的场地，大图仍封顶
     *   · `fixed` —— 始终等于设定值，与内容无关
     *   · `fill`  —— 始终等于可用高，铺满编辑器可视区
     *
     * 注意 `fill` 用的是 `availHeight()`（窗口的 76%）而不是 `clientHeight`：
     * 后者正是本函数上一轮写进去的值，拿它当输入会形成自激。
     */
    private canvasHeightFor(contentH: number, avail: number): number {
        const mode = this.options.canvasHeightMode;
        if (mode === "fill") return avail;
        const raw = Number(this.options.canvasHeight);
        const want = Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : CANVAS_DEFAULT_H, CANVAS_MIN_H), avail);
        if (mode === "fixed") return want;
        return Math.min(Math.max(contentH, want), avail);
    }

    /** 按内容高度调整可视区，返回是否发生了变化 */
    private resizeViewport(contentH: number): boolean {
        // 行内视图要按内容高度自适应，并封顶 —— 否则一个 200 节点的列表块会把
        // 整篇文档顶下去几屏。全屏弹层 / 并排面板里画布就是容器本身，直接铺满。
        const avail = this.availHeight();
        const h = this.canvasHeightFor(contentH, avail);
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
        /*
         * ⚠️ 这里**绝对不能**用 `data-node-id`。
         *
         * 思源前端处理事务时是按 `[data-node-id="<块ID>"]` 在全文档里查元素的
         * （`querySelector` 只看文档顺序，不看可见性）。导图就长在 `.protyle-wysiwyg`
         * 里面，一旦自己的节点也带上这个属性，就会和真的大纲块**同名撞车**：
         * Protyle 想把某个列表项插回去，查到的却是导图里的 `.mm-node`，
         * 于是**把真实的大纲块插进了导图内部** —— 实测（3.8.4）表现为
         * 「点一下待办复选框，导图上那个节点变成了一段大纲 HTML，
         * 内核里 marker 也没改上」，而且块 ID 会被重排。
         *
         * 用 `data-mm-id` 这个带命名空间的名字，谁都撞不到。
         */
        el.dataset.mmId = n.id;
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
            // 用 <button> 而不是 <span>：Tab 能聚焦、空格/回车能触发、读屏会念出状态。
            // 之前的 <span> 只是「看起来能点」，语义上是死的 —— 键盘用户完全够不着。
            const box = document.createElement("button");
            box.type = "button";
            box.className = `mm-task${n.checked ? " mm-task--done" : ""}`;
            box.setAttribute("role", "checkbox");
            this.paintTaskCheck(n, !!n.checked, box);
            box.onclick = (e) => {
                e.stopPropagation();
                this.toggleTaskCheck(n, box);
            };
            inner.appendChild(box);
        }

        const txt = document.createElement("span");
        txt.className = "mm-txt";
        txt.innerHTML = n.html;

        /* ---- 节点标记（P1-2）----
         * 图标在文字**前**、标签在文字**后**：
         * 图标是「一眼扫过去」的信号，得在视线起点；标签是补充说明，压在末尾不抢位置。
         * 两者都不进 `.mm-txt`（那是可编辑区），否则双击改名时会被当成节点文字一起写回内核。
         */
        if (n.mark?.icon) {
            const ic = document.createElement("span");
            ic.className = "mm-mark-icon";
            ic.textContent = n.mark.icon;
            inner.appendChild(ic);
        }
        inner.appendChild(txt);
        if (n.mark?.label) {
            const lb = document.createElement("span");
            lb.className = "mm-mark-label";
            lb.textContent = n.mark.label;
            inner.appendChild(lb);
        }

        el.appendChild(inner);

        if (n.children.length > 0) {
            const tog = document.createElement("div");
            tog.className = `mm-toggle${n.folded ? " mm-toggle--collapsed" : ""}`;
            tog.textContent = n.folded ? String(n.children.length) : "−";
            tog.dataset.mmTip = n.folded ? this.t("tip.expandN", "展开 {n} 个子节点", { n: n.children.length }) : this.t("tip.collapseChildren", "折叠子节点");
            tog.dataset.mmKey = this.t("tip.space", "空格");
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
            add.dataset.mmTip = this.t("menu.insertChild", "插入子节点");
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
                drill.dataset.mmTip = this.t("menu.focusBranch", "聚焦此分支");
                drill.dataset.mmKey = this.t("tip.ctrlDblClick", "Ctrl 双击");
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
                fold.dataset.mmTip = n.folded ? this.t("act.expand", "展开") : this.t("act.collapse", "折叠");
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
        // 同级按「看得见的」算 —— 被过滤器筛掉的兄弟不该被框进来，
        // 否则下一步的批量操作（删除 / 勾选）会作用在用户根本看不到的节点上
        const sibs = shownChildren(n.parent);
        const allSelected = sibs.every((s) => s === this.selected || this.extraSel.has(s));
        if (allSelected) {
            this.selected = this.tree;
            this.extraSel.clear();
            // 整棵树这条分支走 `kids`，已经自带「折叠 + 过滤」两重筛
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

    /**
     * 折叠态写回内核的统一出口。
     *
     * ⚠️ **曾经在这里试过「搜索框开着就只记不写」**，想把那次写回推到搜索结束 ——
     * 目的是别让写内核触发的重建打断用户打字。实测**反效果**，已回退：
     *   · 重建根本不是那次写回引起的，是**插件自己 render 出来的 DOM 变动**
     *     让 Protyle 重建了那个块（所以不写也照样重建，白搭）；
     *   · 而写回一旦延后，「搜索命中自动展开祖先」就**跨不过重建**——
     *     新视图按内核里的旧折叠态解析，展开白做了（`shownCount` 不涨）。
     * 留着这层间接调用只是为了保留上面这段结论，避免下一个人再试一遍。
     */
    private writeFold(nodeId: string, folded: boolean) {
        if (!nodeId) return;
        this.cb.onFoldChange(nodeId, folded);
    }

    private toggleFold(n: MMNode) {
        this.disarmPreview();
        n.folded = !n.folded;
        if (n.id) this.writeFold(n.id, n.folded);
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
                if (n.id) this.writeFold(n.id, folded);
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
     *
     * 同级与子级都按 `shownChildren()` 取 —— 折叠的、被过滤器筛掉的一律跳过。
     * 用 `children` 的话，方向键会停在一个**看不见的节点**上：选中框不出现、
     * 按 Enter 却会去改那个节点，是那种「界面没反应但其实干了事」的故障。
     */
    private navigate(dir: "up" | "down" | "left" | "right" | "home" | "end") {
        const cur = this.selected ?? this.tree;
        if (!cur) return;

        if (dir === "left") {
            if (cur.parent) this.focusNode(cur.parent);
            return;
        }
        if (dir === "right") {
            const kids = shownChildren(cur);
            if (kids.length === 0) return;
            // 折叠着按 → 先展开，不跳进去 —— 与「展开」这个动作本身保持一致
            if (cur.folded) {
                this.toggleFold(cur);
                this.selected = cur;
                this.refreshSelection();
            }
            this.focusNode(kids[0]);
            return;
        }

        const parent = cur.parent;
        if (!parent) return;
        const sibs = shownChildren(parent);
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
        //
        // ★ 但「被我们接管了才抢焦点」有一个致命缺口：**修饰键单独按下的那一下**。
        //
        // 真实键盘按 Ctrl+D 会先产生一个 `key === "Control"` 的 keydown。
        // 这一下导图没有任何动作可做（不会 preventDefault），可思源的编辑器照样
        // 在这个 keydown 里 focus 自己 —— 焦点被抢到 `.protyle-wysiwyg`，
        // 而它**是 `.mm-root` 的祖先**，所以紧接着的 `D` 那一下 target 已经不在导图里，
        // `handleGlobalKey` 开头就 return 了。
        //
        // 后果：导图的整套 Ctrl 快捷键（A / C / V / X / D、以及缩放那几个）
        // 在**真实键盘下全部失灵**，而测试里用「只发字母 + modifiers 位」的合成按键
        // 一直测不出来（单事件发法没有裸修饰键那一下，焦点不会丢）。
        // 实测（tests/kernel/probe-altmod-swallow.mjs）：
        //   真键盘式 Ctrl+D → 焦点 mm-root → protyle-wysiwyg，内核列表项数 3 → 3（没复制）
        //   单事件 Ctrl+D   → 焦点 mm-root → mm-txt，内核列表项数 3 → 4（复制成功）
        // 所以修饰键也要把焦点抢回来，让后续的字母键能落在导图里。
        if (e.defaultPrevented) this.restoreFocus();
        else if (MODIFIER_ONLY_KEYS.has(e.key)) this.restoreFocus(true);
    }

    /**
     * 把焦点抢回导图根元素。
     * 异步做，免得和 trapFocus / 编辑器里同步的 focus() 打架（谁后调用谁赢）。
     *
     * `fromModifier` 为真时再多补两次 —— 修饰键单独按下那一下，思源编辑器抢焦点
     * **有快有慢**（实测同一个动作，有时同步发生、有时晚一个节拍），
     * 只做一次 `setTimeout(0)` 会输给后者，`Ctrl+D` 照样收不到。
     *
     * 补的那两次**必须收窄**：只针对「焦点落在思源编辑器 `.protyle-wysiwyg` 里」
     * 这一种情况。不加这个限制的话，按 ⌥⇧P 时会把焦点从刚打开的命令面板输入框里
     * 抢回导图，用户就打不了字了。
     */
    private restoreFocus(fromModifier = false) {
        const attempt = () => {
            if (this.destroyed || this.editing || this.searchOpen) return;
            if (!this.rootEl.isConnected) return;
            if (this.rootEl.contains(document.activeElement)) return;
            this.rootEl.focus({ preventScroll: true });
        };
        window.setTimeout(attempt, 0);
        if (!fromModifier) return;
        for (const delay of [60, 200]) {
            window.setTimeout(() => {
                const a = document.activeElement as HTMLElement | null;
                if (!a || typeof a.closest !== "function") return;
                // 只抢「被思源编辑器抢走」的焦点，别的一概不动
                if (!a.closest(".protyle-wysiwyg")) return;
                if (this.rootEl.contains(a)) return;
                attempt();
            }, delay);
        }
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
        // 标记浮层里有一个输入框，方向键 / 回车 / 退格都得归它自己
        if ((e.target as HTMLElement)?.closest?.(".mm-mark-pop")) return;
        // 编辑态下键盘归输入框，由 beginEdit 里的处理器负责
        if (this.editing) return;

        const mod = e.ctrlKey || e.metaKey;
        /**
         * 「导图自己的 Ctrl / Cmd 快捷键」的判据 —— 必须**排除按住 Alt 的情况**。
         *
         * `⌥⌘X` 是思源与别的插件共用的命名空间：本工作空间里 flowmind 占了 ⌥⌘K / ⌥⌘L、
         * 魔法排版占了 ⌥⌘P。只判 `mod` 的话，别的插件的 ⌥⌘ 组合会被这里吃掉。
         */
        const modOnly = mod && !e.altKey;
        /**
         * 字母类快捷键还要**再排除 Shift**，理由见下。
         *
         * 本插件自己的两个全局热键是 `⇧⌘D`（切换导图 / 大纲）与 `⇧⌘B`（并排打开），
         * 而下面这批字母快捷键是 `Ctrl+D`（复制）、`Ctrl+V`（粘贴）、`Ctrl+A`（全选同级）…
         *
         * 只判 `modOnly` 的话，导图有焦点时按 `⇧⌘D` 会命中 `Ctrl+D` ——
         * 实测后果很扎眼：**全局切换键没生效，反而把选中节点的子树复制一份写进了内核**
         * （6 个节点变 12 个），而且没有任何提示。同理 `⇧⌘V` 会变成「粘贴」。
         * 历史上 `⌥⌘D` / `⌥⌘V` 当默认键位时踩过一模一样的坑，只是当年靠 `!e.altKey` 挡住的。
         *
         * ⚠️ **符号键（`= - 0 1`）与方向键仍然用 `modOnly`** —— 它们没有 `⇧⌘` 版本，
         * 加 Shift 判据只会白白削弱功能（`⇧⌘=` 放大是个很自然的按法）。
         */
        const modLetter = modOnly && !e.shiftKey;
        const key = e.key;

        // 白名单：系统级 / 浏览器级快捷键一律放行
        if (mod && !e.altKey) {
            const lower = key.toLowerCase();
            // ⚠️ 这里放行的是 `Ctrl+S/P/W/R`（保存 / 打印 / 关标签 / 替换）。
            // **别把插件自己的全局热键绑到这几个字母的 `⇧⌘` 变体上** ——
            // 实测 `⇧⌘S` 会被 Protyle 在中途 `stopPropagation()`，
            // 思源的全局匹配器（挂在 document 冒泡）根本收不到，绑了也不会触发。
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
        if (modOnly && (key === "=" || key === "+")) return take(() => this.zoomAt(1.2));
        if (modOnly && key === "-") return take(() => this.zoomAt(1 / 1.2));
        if (modOnly && key === "0") return take(() => this.fit());
        if (modOnly && key === "1") return take(() => this.setScale(1));
        if (modLetter && key.toLowerCase() === "f") return take(() => this.toggleSearch(true));
        if (!mod && !e.altKey && (key === "f" || key === "F") && this.mode === "inline") {
            if (!this.tree) return;
            return take(() => this.cb.onFullscreen(this.tree!, resolveTheme(this.options.theme)));
        }

        /* ---- 标记浮层开着时，Esc 先关浮层 ---- */
        // 排在菜单之前：它是更浅的一层，浮层关掉之前不该去动选中 / 下钻
        if (key === "Escape" && this.markPop) return take(() => this.closeMarkPopover());

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
            // 勾选待办：`x` 是待办清单里的通用约定（GitHub / 任务管理器都这么用），
            // 比 Enter 更不容易误触 —— Enter 在导图里是「插入同级节点」。
            if ((key === "x" || key === "X") && cur.kind === "task") {
                return take(() => this.toggleTaskCheck(cur));
            }
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
                        if (window.confirm(this.t("dlg.confirmDeleteN", "确定删除选中的 {n} 个节点及其子树？", { n: targets.length }))) {
                            // 走批量：整体成功或整体回滚，不会删一半卡住
                            this.runBatchAction("delete", targets);
                        }
                        return;
                    }
                    const only = targets[0];
                    const kids = only.children.length;
                    if (kids > 0 && !window.confirm(this.t("dlg.confirmDeleteKids", "「{text}」下还有 {n} 个子节点，一并删除？", { text: only.text, n: kids }))) return;
                    void this.runAction("delete", only);
                });
            }
        }

        /* ---- 结构编辑 ---- */
        if (e.shiftKey && key === "Tab") return take(() => void this.runAction("outdent", cur));
        if (modOnly && key === "ArrowUp") return take(() => void this.runAction("moveUp", cur));
        if (modOnly && key === "ArrowDown") return take(() => void this.runAction("moveDown", cur));
        if (modLetter && key.toLowerCase() === "a") return take(() => this.selectAllSiblings());
        if (modLetter && key.toLowerCase() === "d") return take(() => void this.runAction("duplicate", cur));
        if (modLetter && key.toLowerCase() === "c") {
            return take(() => void this.copySubtree(cur));
        }
        if (modLetter && key.toLowerCase() === "v") {
            if (!this.clipboard) return;
            const data = this.clipboard;
            return take(() => void this.runAction("paste", cur, { data }));
        }
        if (modLetter && key.toLowerCase() === "x") {
            return take(() => {
                this.clipboard = serializeSubtree(cur);
                void this.copyNodeText(cur);
                void this.runAction("delete", cur);
            });
        }

        /* ---- 升降级 ---- */
        if (e.altKey && !mod && key === "ArrowLeft") return take(() => void this.runAction("outdent", cur));
        if (e.altKey && !mod && key === "ArrowRight") return take(() => void this.runAction("indent", cur));
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
        const finish = (commit: boolean, refocus = false) => {
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

            /**
             * 把焦点还给导图 —— **只在该「用户用键盘主动退出编辑」时做**。
             *
             * ⚠️ 不能在失焦提交时做：点别处导致的 blur 也会走到这里，
             *    那时去抢焦点会把用户从他**刚点进去的地方**拽回来
             *    （刚点进思源编辑器、刚打开命令面板……）。
             *    这与 `restoreFocus` 里「只抢被思源编辑器抢走的那种焦点」是同一条纪律。
             *
             * 不还的后果实测很重（`tests/kernel/diag-undo-after-insert.mjs`）：
             * 退出编辑后焦点落到布局容器（`fn__flex-column`）上，
             * **导图的键盘整体失效** —— 方向键 / Tab / Enter / 空格 / Ctrl+Z 全都不响应，
             * 用户得再点一下导图才能继续。其中 Ctrl+Z 最刺眼：
             * 按了**完全没反应**（既没被插件接，也没冒泡给思源）。
             */
            if (refocus) this.restoreFocus();
        };
        const onKey = (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                e.preventDefault();
                // 第二个参数 = 键盘主动退出 → 把焦点还给导图（见 finish 里的长注释）
                finish(true, true);
            } else if (e.key === "Escape") {
                e.preventDefault();
                finish(false, true);
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
            else showMessage(this.t("msg.linkNoHref", "这个链接没有地址"), 2000);
            return;
        }
        const id = el.dataset.id;
        if (id) this.cb.onOpenBlock(id);
        else showMessage(this.t("msg.linkNoTarget", "这个双链没有目标块"), 2000);
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

    /* ==================================================================== 节点标记（P1-2） */

    /**
     * 打开「节点标记」浮层。
     *
     * 为什么不是一串 `window.prompt`：图标 / 标签 / 颜色是三个并列的维度，
     * 分三次问不仅烦，而且每次都要走一遍「写内核 → 重渲染」。
     * 一个浮层里一次配完，改一项即时生效（所见即所得），关掉就是最终结果。
     */
    private openMarkPopover(n: MMNode) {
        this.closeMarkPopover();
        const anchor = n.el;
        if (!anchor) return;

        const pop = document.createElement("div");
        pop.className = "mm-mark-pop";
        /** 当前编辑中的标记 —— 点一下改一项，攒着一起提交 */
        let draft: MMNodeMark = { ...(n.mark ?? {}) };

        const sync = () => {
            for (const b of pop.querySelectorAll<HTMLElement>("[data-icon]")) {
                b.classList.toggle("mm-on", b.dataset.icon === draft.icon);
            }
            for (const b of pop.querySelectorAll<HTMLElement>("[data-color]")) {
                b.classList.toggle("mm-on", b.dataset.color === draft.color);
            }
            const clr = pop.querySelector<HTMLElement>(".mm-mark-clear");
            if (clr) clr.classList.toggle("mm-dim", !hasMark(draft));
        };
        const apply = () => {
            this.commitMark(n, draft);
            sync();
        };

        const row = (label: string) => {
            const r = document.createElement("div");
            r.className = "mm-mark-row";
            const t = document.createElement("span");
            t.className = "mm-mark-cap";
            t.textContent = label;
            r.appendChild(t);
            pop.appendChild(r);
            return r;
        };

        /* ---- 图标 ---- */
        const iconRow = row(this.t("mark.icon", "图标"));
        for (const icon of MARK_ICONS) {
            const b = document.createElement("button");
            b.type = "button";
            b.dataset.icon = icon;
            b.dataset.mmTip = icon;
            b.textContent = icon;
            b.onclick = (e) => {
                e.stopPropagation();
                // 再点一次取消 —— 否则选错了只能整条清掉重来
                draft.icon = draft.icon === icon ? undefined : icon;
                apply();
            };
            iconRow.appendChild(b);
        }

        /* ---- 标签 ---- */
        const labelRow = row(this.t("mark.label", "标签"));
        const input = document.createElement("input");
        input.type = "text";
        input.className = "mm-mark-input";
        input.maxLength = MARK_LABEL_MAX;
        input.placeholder = this.t("mark.maxLen", "最多 {n} 个字", { n: MARK_LABEL_MAX });
        input.value = draft.label ?? "";
        input.oninput = () => {
            draft.label = input.value.trim() || undefined;
        };
        // 输入框里按回车 / 失焦即生效；Esc 关掉浮层。
        // 这三个键必须 stopPropagation —— 导图的全局键盘处理挂在捕获阶段，
        // 不拦住的话回车会变成「插入同级节点」、Esc 会去清空选中。
        input.onkeydown = (e) => {
            e.stopPropagation();
            if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                apply();
                if (e.key === "Escape") this.closeMarkPopover();
            }
        };
        input.onblur = () => apply();
        labelRow.appendChild(input);

        /* ---- 颜色 ---- */
        const colorRow = row(this.t("mark.color", "颜色"));
        const def = document.createElement("button");
        def.type = "button";
        def.dataset.color = "";
        def.className = "mm-mark-swatch mm-mark-swatch--def";
        def.dataset.mmTip = this.t("mark.followBranch", "跟随分支色");
        def.onclick = (e) => {
            e.stopPropagation();
            draft.color = undefined;
            apply();
        };
        colorRow.appendChild(def);
        for (const color of MARK_COLORS) {
            const b = document.createElement("button");
            b.type = "button";
            b.dataset.color = color;
            b.className = "mm-mark-swatch";
            b.dataset.mmTip = color;
            b.style.background = color;
            b.onclick = (e) => {
                e.stopPropagation();
                draft.color = draft.color === color ? undefined : color;
                apply();
            };
            colorRow.appendChild(b);
        }

        /* ---- 底部 ---- */
        const foot = document.createElement("div");
        foot.className = "mm-mark-foot";
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "mm-mark-clear";
        clear.textContent = this.t("menu.clearMark", "清除标记");
        clear.onclick = (e) => {
            e.stopPropagation();
            draft = {};
            input.value = "";
            apply();
        };
        const done = document.createElement("button");
        done.type = "button";
        done.className = "mm-mark-done";
        done.textContent = this.t("ui.done", "完成");
        done.onclick = (e) => {
            e.stopPropagation();
            this.closeMarkPopover();
        };
        foot.append(clear, done);
        pop.appendChild(foot);

        // 浮层自身吃掉鼠标事件：点它内部的空白不该顺手把选中换掉
        pop.onmousedown = (e) => e.stopPropagation();
        pop.onclick = (e) => e.stopPropagation();

        this.rootEl.appendChild(pop);
        this.markPop = pop;
        this.markPopId = n.id;
        sync();
        this.positionMarkPop();
        // 标签是这个浮层里唯一需要打字的项，进来就把焦点给它
        input.focus();
        input.select();
    }

    /** 把浮层贴到它那个节点旁边（重渲染之后节点换了元素，要重新贴） */
    private positionMarkPop() {
        const pop = this.markPop;
        if (!pop) return;
        const el = this.markPopId ? this.byId.get(this.markPopId)?.el : null;
        if (!el) {
            this.closeMarkPopover();
            return;
        }
        const r = el.getBoundingClientRect();
        const host = this.rootEl.getBoundingClientRect();
        const pw = pop.offsetWidth;
        const ph = pop.offsetHeight;
        // 默认贴在节点下方；下方放不下就翻到上方，左右再夹进可视区
        let left = r.left - host.left;
        let top = r.bottom - host.top + 6;
        if (top + ph > host.height - 6) top = Math.max(6, r.top - host.top - ph - 6);
        left = Math.max(6, Math.min(left, host.width - pw - 6));
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
    }

    private closeMarkPopover() {
        this.markPop?.remove();
        this.markPop = null;
        this.markPopId = "";
    }

    /**
     * 丢掉所有在途的乐观标记。     *
     * 由外部在**撤销 / 重做之后**调用：那是内容被整体写回的时刻，
     * 覆盖表里的值既已经过时，又永远等不到「DOM 追上来」的对齐
     * （撤销是反方向的改动），只能靠 3 秒超时退休 —— 那 3 秒里画面上
     * 挂着的就是一个已经被撤掉的标记。
     */
    forgetMarkOverlay() {
        if (this.markOverlay.size === 0) return;
        this.markOverlay.clear();
        this.render();
    }

    /**
     * 提交一次标记改动。
     *
     * 分两层：**先改本地**（节点立刻变样，不等内核），**再写内核**。
     * 写回之后内核会回推 DOM、触发一次重渲染，那时 `mark` 会从块属性重新解析出来，
     * 两边自然对齐 —— 所以这里不需要在内存里维护一份「标记真相」。
     */
    private commitMark(n: MMNode, mark: MMNodeMark) {
        /* ⚠️ 必须**克隆**，不能直接用传进来的对象。
         *
         * 浮层里的 `draft` 是**反复复用的同一个对象**（点图标改 `draft.icon`、
         * 输标签改 `draft.label`）。如果这里把它直接挂到 `n.mark` 上，
         * 两者就是同一个引用 —— 下一次改 `draft` 会连 `n.mark` 一起改掉，
         * 于是 `sameMark(n.mark, next)` 变成「自己和自己比」，恒等成立，
         * 后续所有改动都被判成「没变」而直接 return：
         * 表现就是**第一个操作（选图标）生效，之后选颜色、输标签全都没反应**。
         * 实测（tests/kernel/diag-mark.mjs）就是这个症状。
         */
        const next = hasMark(mark) ? { ...mark } : undefined;
        // 上一轮 render() 已经把整棵树重建过了，传进来的 `n` 可能已经是旧对象 ——
        // 按块 ID 取当前那一个，别往一个已经不在树上的节点上写
        const live = (n.id && this.byId.get(n.id)) || n;
        if (sameMark(live.mark, next)) return;
        live.mark = next;
        // 自定义色要同时改 `n.color`，否则连线还是旧色（见 render 里的注释）
        if (next?.color) live.color = next.color;
        if (live.id) {
            const id = live.id;
            this.markOverlay.set(id, next ? { ...next } : null);
            window.setTimeout(() => {
                // 内核已经把 DOM 推回来、覆盖表对齐退休了 —— 那就不用做任何事
                if (!this.markOverlay.has(id)) return;
                // 否则说明写回没成：撤掉覆盖，退回旧样子。
                // 宁可看到「没生效」，也不要让一个永远不会成真的标记留在画面上。
                this.markOverlay.delete(id);
                this.render();
            }, 3000);
        }
        this.cb.onMarkChange(live, next ?? null);
        this.render();
    }

    private openNodeMenu(n: MMNode, event: MouseEvent) {
        const menu = this.makeMenu("mm-node-menu");
        const act = (kind: MMActionKind, opts?: MMActionExtra) => {
            void this.runAction(kind, n, opts);
        };
        const item = (label: string, key: string, disabled: boolean, click: () => void) => {
            menu.addItem({ label: key ? `${label}    ${key}` : label, disabled, click });
        };

        // 待办节点把「勾选」放在最前 —— 对它来说这是最常用的一下，
        // 单独用一条分隔线跟下面的结构操作分开（状态 vs 结构，是两码事）
        if (n.kind === "task") {
            item(n.checked ? this.t("menu.markTodo", "标记为未完成") : this.t("menu.markDone", "标记为已完成"), "X", !n.id, () => this.toggleTaskCheck(n));
            menu.addItem({ type: "separator" });
        }

        // 标记紧挨着文字编辑：它们都是「给这个节点加点信息」，不是结构操作
        item(n.mark ? this.t("menu.editMark", "编辑标记（图标 / 标签 / 颜色）…") : this.t("menu.addMark", "添加标记（图标 / 标签 / 颜色）…"), "", !n.id, () =>
            this.openMarkPopover(n),
        );

        const rich = hasInlineFormat(n);
        item(rich ? this.t("menu.editInSource", "回到原文编辑（保留格式）") : this.t("menu.editText", "编辑文字"), "F2", !this.options.editable || !canEdit(n), () =>
            this.beginEdit(n),
        );
        item(this.t("menu.insertChild", "插入子节点"), "Tab", false, () => act("insertChild"));
        item(this.t("menu.insertBelow", "在下方插入"), "Enter", false, () => act("insertSiblingAfter"));
        if (n.children.length > 0) {
            item(this.t("menu.focusBranchDesc", "聚焦此分支（只看这一支）"), this.t("tip.ctrlDblClick", "Ctrl 双击"), false, () => this.drillDown(n));
        }
        if (this.drillPath.length > 0) {
            item(this.t("menu.exitFocus", "退出聚焦，回到全图"), "Esc", false, () => this.drillTo(0));
        }
        menu.addItem({ type: "separator" });
        item(this.t("act.moveUp", "上移"), "Ctrl ↑", !canMoveUp(n), () => act("moveUp"));
        item(this.t("act.moveDown", "下移"), "Ctrl ↓", !canMoveDown(n), () => act("moveDown"));
        item(this.t("menu.indentDesc", "降级为上一个节点的子节点"), "Alt →", !canIndent(n), () => act("indent"));
        item(this.t("menu.outdentDesc", "升级为父节点的兄弟"), "Alt ←", !canOutdent(n), () => act("outdent"));
        menu.addItem({ type: "separator" });
        if (n.children.length > 0) {
            item(n.folded ? this.t("menu.expandN", "展开（{n} 个子节点）", { n: n.children.length }) : this.t("tip.collapseChildren", "折叠子节点"), this.t("tip.space", "空格"), false, () => this.toggleFold(n));
        }
        item(this.t("menu.copySubtree", "复制子树"), "Ctrl C", false, () => void this.copySubtree(n));
        item(this.t("menu.quickCopy", "快速复制"), "Ctrl D", !n.id, () => act("duplicate"));
        item(this.t("menu.copyText", "复制文字"), "", false, () => void this.copyNodeText(n));
        item(this.t("menu.locateInEditor", "定位到编辑器"), "", !n.id, () => this.cb.onLocate(n.id));
        menu.addItem({ type: "separator" });
        item(
            n.children.length > 0 ? this.t("menu.deleteNodeN", "删除节点（含 {n} 个子节点）", { n: n.children.length }) : this.t("menu.deleteNode", "删除节点"),
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
        const target = hit ? this.byId.get(hit.dataset.mmId ?? "") : null;

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
                    if (target.id) this.writeFold(target.id, false);
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
        if (ok) showMessage(this.t("msg.nodeTextCopied", "已复制节点文字"));
        else showMessage(this.t("msg.copyFailed", "复制失败"), 4000, "error");
    }

    /**
     * 「复制子树」—— 两份剪贴板，各司其职。
     *
     * ① 图内剪贴板（`this.clipboard`）放**整棵子树的 markdown**，供图内 `Ctrl+V`
     *    「粘贴为子节点」用。速查表承诺的就是这一条（「Ctrl+C 复制子树 · Ctrl+V 粘贴为子节点」）。
     * ② 系统剪贴板放**这个节点自己的文字** —— 用户按 Ctrl+C 之后多半还想粘到别处，
     *    往系统剪贴板塞一段带 `-` 缩进的 markdown 反而更碍事；要纯文字用「复制文字」也一样。
     *
     * ⚠️ 提示语必须说清是**子树**。原来这条路径直接复用 `copyNodeText`，
     * 于是用户点了「复制子树」却看到「已复制节点文字」—— 反馈和动作对不上，
     * 会让人以为点错了。行为没变，只把话说准。
     */
    private async copySubtree(n: MMNode) {
        this.clipboard = serializeSubtree(n);
        const ok = await copyText(n.text);
        if (ok) showMessage(this.t("msg.subtreeCopied", "已复制子树 · 在导图里按 Ctrl+V 可粘贴为子节点"), 2600);
        else showMessage(this.t("msg.copyFailed", "复制失败"), 4000, "error");
    }

    /* ==================================================================== 状态过滤（P1-1） */

    /** 切换过滤器并重渲染。视图会整体换形，所以重新取景一次 */
    private setFilter(f: MMFilter) {
        if (this.filter === f) return;
        this.filter = f;
        this.render(true);
        // 筛选结果是空的时候，画面上只剩一个孤零零的根节点，很容易被当成「图坏了」。
        // 明说一句，比让用户去猜好。
        if (f !== "all" && this.filterHits === 0) {
            showMessage(f === "done" ? this.t("msg.noDoneTask", "这张图里没有已完成的待办") : this.t("msg.noTodoTask", "这张图里没有未完成的待办"), 2400);
        }
    }

    /**
     * 把过滤器落到树上：算一遍「该留下谁」，写进每个节点的 `hidden`。
     *
     * 保留规则和主流大纲工具一致：**命中的节点 + 它的全部祖先**。
     * 祖先必须留下，否则树就断了 —— 一个未完成的子任务总得挂在它那个
     * （可能已完成的）父任务下面，不然用户根本看不出它为什么在这儿。
     *
     * 「命中」的判定对**非待办节点**是继承的：一个普通列表项算什么状态，
     * 看它最近的那个待办祖先。理由是实际用法 —— 任务下面挂的说明、备注、子条目
     * 本来就属于那条任务，任务没做完就不该把它们一起藏起来。
     * 上面没有待办祖先的（纯散文节点）不继承任何状态，只在「全部」下出现。
     *
     * 必须在**布局之前**调用：布局只认 `kids`，而 `kids` 是按 `hidden` 算的。
     */
    private applyFilter(root: MMNode) {
        const all = flatten(root);
        const reset = () => {
            for (const n of all) n.hidden = false;
            this.filterHits = all.filter((n) => n.kind === "task").length;
        };

        if (this.filter === "all") return reset();

        const tasks = all.filter((n) => n.kind === "task");
        // 整张图一个待办都没有 —— 过滤器无从下手，索性整体不生效。
        // （工具条上那组 chip 也会被 syncFilterGroup 收掉，所以正常情况下用户点不到。）
        if (tasks.length === 0) return reset();

        const want = this.filter === "done";
        let hits = 0;
        const walk = (n: MMNode, inherited: boolean | null): boolean => {
            const state = n.kind === "task" ? !!n.checked : inherited;
            let keep = state === want;
            if (keep) hits++;
            for (const c of n.children) if (walk(c, state)) keep = true;
            n.hidden = !keep;
            return keep;
        };
        walk(root, null);
        // 根节点永远留着：全筛掉的话画布会变成纯空白，
        // 用户看到的是「图没了」而不是「筛完了」，那是两回事
        root.hidden = false;
        this.filterHits = hits;
    }

    /** 同步过滤 chip 的高亮与整组的显隐 */
    private syncFilterGroup() {
        const hasTask = !!this.tree && flatten(this.tree).some((n) => n.kind === "task");
        this.filterGroup.style.display = hasTask ? "" : "none";
        for (const b of this.filterEls) b.classList.toggle("mm-on", b.dataset.filter === this.filter);
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
            // 跨图结果也要一起清：搜索框都关了，留一块面板挂在右上角
            // 会挡住画布，而且下一次打开时它还是旧内容
            this.docHits = [];
            this.docSearchSeq++;
            window.clearTimeout(this.docSearchTimer);
            this.renderDocResults();
            this.updateSearchCount();
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

    private runSearch(q: string, jump = true) {
        const needle = q.trim().toLowerCase();
        this.searchHits = this.recomputeHits(needle);
        this.searchIdx = this.searchHits.length > 0 ? 0 : -1;
        this.updateSearchCount();
        this.applySearchMarks();
        /* ⚠️ `jump=false` 是**视图重建后恢复**专用的。
           恢复时再 `gotoHit()` 有两个坏处：
             · 用户已经看过那个命中了，视图会再滚一次；
             · `gotoHit()` 会写内核（展开祖先）→ Protyle 再换一次 `.list`
               → 视图再重建 → 再恢复 → **转起来**。
           所以恢复路径必须不跳转。
           ⚠️ 打字路径走**防抖**（`scheduleGotoHit`），不是直接跳 —— 理由见
           `SEARCH_JUMP_DELAY`：直接跳会让每个字符都有机会把输入框一起摘走。 */
        if (jump && this.searchIdx >= 0) this.scheduleGotoHit();

        // 跨图范围：本图的命中照旧画在画布上，另外异步补一份文档级结果
        if (this.searchAll) this.runDocSearch(needle);
        else {
            this.docHits = [];
            this.renderDocResults();
        }
    }

    /** 按**当前的树**重算命中集合。只算，不动 UI、不跳转、不汇报。 */
    private recomputeHits(needle: string): string[] {
        const root = this.tree;
        const hits: string[] = [];
        if (!root || !needle) return hits;
        const walk = (n: MMNode) => {
            // 被过滤器筛掉的节点不参与命中 ——
            // 「只看未完成」+ 搜索的语义是「在我筛出来的范围里搜」，
            // 否则会出现「计数说 3 条，画面上一个高亮都看不见」。
            if (n.hidden) return;
            if (n.id && this.searchHay(n).includes(needle)) hits.push(n.id);
            n.children.forEach(walk);
        };
        walk(root);
        return hits;
    }

    /**
     * 树重建之后刷新搜索：**重算命中集合**再画高亮。
     *
     * 为什么不能只 `applySearchMarks()`：
     * 命中集合是「树 × 查询串」的函数，而树每次 `render()` 都是重建的。
     * 不重算会出现两种都很扎眼的后果 ——
     *   · 计数说「1/1」而画面上一个高亮都没有（`searchHits` 里的 id 已经不是新树里的节点）；
     *   · 更糟的是**恢复搜索状态**时：那一刻 Protyle 可能还没把折叠子树填进 DOM，
     *     按残缺的树算出「无结果」，然后这个空结果被当成结论记住。
     * 位置按**块 ID**保住（不是下标），所以上下条翻到第几条不会因为重建而跳回第一条。
     */
    private refreshSearchOnRender() {
        if (this.searchOpen && this.searchInput.value.trim()) {
            const prev = this.searchHits[this.searchIdx];
            this.searchHits = this.recomputeHits(this.searchInput.value.trim().toLowerCase());
            const i = prev ? this.searchHits.indexOf(prev) : -1;
            this.searchIdx = i >= 0 ? i : this.searchHits.length > 0 ? 0 : -1;
            this.updateSearchCount();
        }
        this.applySearchMarks();
    }

    /**
     * 跨图搜索：防抖 + 只认最后一次的返回。
     *
     * 每敲一个字都打一次 SQL 太浪费；而「慢的请求后到、把新结果盖掉」是
     * 中文输入法连续输入时很容易撞上的真问题，所以用一个自增序号认领结果 ——
     * 回来的不是最新那一次就直接丢掉。
     */
    private runDocSearch(needle: string) {
        window.clearTimeout(this.docSearchTimer);
        const seq = ++this.docSearchSeq;
        if (!needle) {
            this.docHits = [];
            this.renderDocResults();
            return;
        }
        this.docSearchTimer = window.setTimeout(() => {
            const pending = this.cb.onSearchDoc?.(needle) ?? Promise.resolve([]);
            void pending
                .then((hits) => {
                    if (seq !== this.docSearchSeq || this.destroyed) return;
                    this.docHits = hits;
                    this.renderDocResults();
                })
                .catch((err) => {
                    if (seq !== this.docSearchSeq) return;
                    console.warn("[mindmap] 跨图搜索异常", err);
                    this.docHits = [];
                    this.renderDocResults();
                });
        }, 220);
    }

    private stepSearch(delta: number) {
        if (this.searchHits.length === 0) return;
        this.searchIdx = (this.searchIdx + delta + this.searchHits.length) % this.searchHits.length;
        this.updateSearchCount();
        this.applySearchMarks();
        this.gotoHit();
    }

    private updateSearchCount() {
        // 跨图范围下，计数报的是**文档级命中** —— 那才是这一轮搜索的主结果集，
        // 本图的命中只是顺带画在画布上（可能 0 条而文档里有 20 条，
        // 这时候显示「无结果」会让人以为搜错了）
        if (this.searchAll) {
            const n = this.docHits.length;
            this.searchCount.textContent = !this.searchInput.value.trim() ? "" : n === 0 ? this.t("search.noResult", "无结果") : this.t("search.countN", "{n} 条", { n });
            this.reportTransient();
            return;
        }
        const n = this.searchHits.length;
        this.searchCount.textContent = n === 0 ? (this.searchInput.value ? this.t("search.noResult", "无结果") : "") : `${this.searchIdx + 1}/${n}`;
        this.reportTransient();
    }

    /**
     * 汇报瞬态状态（目前只有搜索）。Scanner 按 listId 存一份，供**视图重建后**恢复。
     *
     * 挂在 `updateSearchCount()` 里是**有意的**：搜索状态每一次提交
     * （开 / 关 / 改查询串 / 上下条 / 换范围 / 从跨图结果里挑一条）
     * 都会走到这里，所以这里是唯一一个「一定被调到」的收口点。
     * 散在七八个调用点上的话，漏一个就少一种状态能活过重建。
     */
    private reportTransient() {
        this.cb.onTransient?.({
            searchOpen: this.searchOpen,
            query: this.searchInput?.value ?? "",
            idx: this.searchIdx,
            searchAll: this.searchAll,
        });
    }

    /**
     * 恢复瞬态状态。由 Scanner 在**视图重建之后**调用（见 `MMTransientState` 的注释）。
     *
     * ⚠️ 用 `runSearch(q, false)`（不跳转）—— 理由见 `runSearch` 里那段注释，
     * 简单说：跳转会写内核，写了内核就会再重建，重建了又恢复 —— 无限循环。
     */
    applyTransient(s?: MMTransientState) {
        if (!s || this.destroyed) return;
        // 范围开关先还原：`runSearch` 的跨图分支要读它
        this.searchAll = !!s.searchAll;
        this.scopeBtn.textContent = this.searchAll ? this.t("search.scopeAll", "全文档") : this.t("search.scopeHere", "本图");
        this.scopeBtn.classList.toggle("mm-on", this.searchAll);
        if (!s.searchOpen) return;
        this.searchOpen = true;
        this.searchEl.classList.add("mm-search--on");
        this.searchInput.value = s.query;
        this.runSearch(s.query, false);
        // 位置也要还原：runSearch 会把它重置成第一条
        if (s.idx > 0 && s.idx < this.searchHits.length) {
            this.searchIdx = s.idx;
            this.updateSearchCount();
            this.applySearchMarks();
        }
        /* 焦点还给输入框：重建前用户正在这里打字，重建后焦点不该被
           「谁最后碰过 DOM」决定 —— 否则用户得再点一次才能继续输入。 */
        this.searchInput.focus();
        const end = this.searchInput.value.length;
        try {
            this.searchInput.setSelectionRange(end, end);
        } catch {
            /* 输入框类型不允许选范围就算了，光标位置不值得为它抛异常 */
        }
    }

    /** 命中项可能在折叠的子树里，先展开祖先 */
    /**
     * 安排一次「跳到当前命中」（打字防抖）。**只有打字路径用它** ——
     * 上下条 / 回车是用户明确的动作，走 `gotoHit()` 立即跳。
     * 为什么要防抖见 `SEARCH_JUMP_DELAY` 的注释。
     */
    private scheduleGotoHit() {
        if (this.gotoHitTimer !== null) window.clearTimeout(this.gotoHitTimer);
        this.gotoHitTimer = window.setTimeout(() => {
            this.gotoHitTimer = null;
            this.gotoHit();
        }, SEARCH_JUMP_DELAY);
    }

    private gotoHit() {
        // 手动跳一次就把待办的那次撤掉，免得停手后又跳一下
        if (this.gotoHitTimer !== null) {
            window.clearTimeout(this.gotoHitTimer);
            this.gotoHitTimer = null;
        }
        const id = this.searchHits[this.searchIdx];
        if (!id) return;
        let hit = this.byId.get(id);
        if (!hit) return;
        let unfolded = false;
        let cur = hit.parent;
        while (cur) {
            if (cur.folded) {
                cur.folded = false;
                if (cur.id) this.writeFold(cur.id, false);
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
        // 阈值负责「默认清爽」，`minimapAlways` 负责「用户说了算」——
        // 那条 30 的线用户看不见，所以必须给一个显式出口（见常量上方注释）。
        const on =
            !!this.options.minimap && !!root && (!!this.options.minimapAlways || this.nodeCount >= MINIMAP_MIN_NODES);
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
        // ⚠️ 第四个参数不能省：`frameAxis` 钳的是画布边缘，而这里要的是内容边缘。
        this.tx = this.frameAxis(anchorX - rx, w * this.scale, vw, LAYOUT_PAD_X * this.scale);
        this.ty = this.frameAxis(anchorY - ry, h * this.scale, vh, LAYOUT_PAD_Y * this.scale);
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
     *   装不下 → 把**内容边缘**夹到离视口边 M，保证视口被内容铺满，
     *            不出现「一边空一大片」
     *
     * ⚠️ `c` 是**画布**尺寸，而用户看到的是**内容** —— 画布在内容外侧还裹着一圈
     * `pad` 的内边距（`LAYOUT_PAD_*`）。所以要判断「装不装得下」、要夹到 M 的，
     * 都必须是 `c - pad * 2` 那一段。按画布算的后果实测过：内容宽 1231px、
     * 视口 519px 时，画布左边缘被钉在 28px，可内容左边缘却在 28 + 72×0.55 ≈ 68px 处
     * —— 左右各白空 68px，覆盖率只有 87%（可视区被吃掉两成半）。
     * 换成按内容边缘夹之后，左空 28px、覆盖率 94.6%。
     *
     * @param want 按锚点算出来的期望平移量
     * @param c    该轴上的**画布**尺寸（已乘缩放）
     * @param v    该轴上的视口尺寸
     * @param pad  画布内边距（已乘缩放），即画布边缘到内容边缘的距离
     */
    private frameAxis(want: number, c: number, v: number, pad = 0): number {
        const M = 28;
        const content = c - pad * 2;
        if (content <= v - M * 2) return (v - c) / 2;
        // 内容装不下：把内容左边缘夹到 M（等价于画布左边缘夹到 M - pad），
        // 内容右边缘夹到 v - M（等价于画布右边缘夹到 v - M + pad）。
        return Math.min(M - pad, Math.max(v - c + pad - M, want));
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
        // ⚠️ 「装不装得下」要拿**内容**尺寸判断，不是画布尺寸。
        //    画布在内容外侧还裹着一圈内边距，用画布判断会漏掉一段约
        //    `2 × pad × scale` 宽的窗口（本项目实测 79px）：内容明明装得下，
        //    却因为画布超了而被判成「装不下」，视图不居中 —— 内容偏在一边、
        //    另一侧白白空掉（实测 tx = -100、缩放 1.3856：内容占 0 ~ 384px，
        //    视口 519px，右侧空 135px）。tx 偏得更多时就会把内容裁掉。
        //    ⚠️ 但下面设置 `tx` 用的仍必须是**画布**宽：tx 是画布的平移量，
        //       画布居中 = 内容居中（内边距两侧对称）。
        const innerW = cw - LAYOUT_PAD_X * this.scale * 2;
        const innerH = ch - LAYOUT_PAD_Y * this.scale * 2;
        let moved = false;
        if (innerW <= vw - M * 2) {
            this.tx = (vw - cw) / 2;
            moved = true;
        }
        if (innerH <= vh - M * 2) {
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

        /* ---- ★★ 把「插件 UI 里的事件」挡在这里，不许冒泡给 Protyle ----
         *
         * 这不是洁癖，是**数据安全**。行内模式下整个 `.mm-root` 就住在
         * Protyle 的可编辑块内部（`.list` 里），而源大纲是靠
         * `.mm-source-hidden > :not(.mm-root) { display: none }` 藏起来的。
         *
         * 于是只要有一个事件冒泡到 `.protyle-wysiwyg`，Protyle 就会认为
         * 「这个块的内容被改过了」，然后**从 DOM 重新序列化这个块** ——
         * 而序列化时看不见那些 `display:none` 的源大纲，只看得见导图，
         * 结果就是：**笔记正文被换成导图渲染出来的 HTML**。
         *
         * 实测（`tests/.build/_diag-whyswap.mjs`，磁盘 `.sy` 为证）：
         *   在搜索框里敲字之后，每个列表项的段落都变成了
         *     `NodeHTMLBlock` / `Data = "<div contenteditable="false">…</div>"`
         *   原始段落整个消失 —— 大纲结构被毁，而且**测试全绿**，
         *   因为文字还留在 HTML 块里，导图读出来一模一样。是最难发现的那种损坏。
         *
         * 到底哪一个事件是引信，用对照实验分得很清（同一支探针的几种模式）：
         *   · 只 Ctrl+F 开搜索框、不打字            → 干净
         *   · 只给 `.mm-node` 加 class（poke）      → 干净
         *   · 只改计数文字 `.mm-search-count`（poke2）→ 干净
         *   · 计数文字 + 命中高亮，两样一起（poke4） → 干净
         *   · 只点缩放按钮（zoom）                  → 干净
         *   · **程序化派发一个 `input` 事件**（prog）→ **损坏**
         * ⇒ 引信就是 **`input` 事件本身**（`prog` 与 poke2/poke4 唯一的差别），
         *   不是「插件改了 DOM」，也不是键盘事件、几何变化、gotoHit 写内核。
         *
         * ⚠️ 必须挂在**冒泡阶段**（就是 `on` 的默认行为），**不能挂捕获**：
         * 捕获阶段的 `stopPropagation()` 会让事件**根本到不了输入框自己**，
         * 插件自己的 `searchInput.oninput` 就永远不触发了 —— 搜索框直接变哑巴。
         * 挂在 `.mm-root` 冒泡阶段则刚好：目标元素上的监听器（插件的 `oninput`、
         * 行内编辑器的 `keydown` / `paste`）先跑完，再拦住它继续往上走。
         *
         * ⚠️ **刻意不拦 `keydown` / `keypress`**：思源的全局快捷键匹配器挂在
         * `document` 冒泡阶段，拦掉 `keydown` 会让 `Ctrl+S` 这类系统快捷键
         * 在导图有焦点时失效。`keyup` 拦掉是安全的（匹配器看的是 keydown）。
         */
        for (const type of [
            "input",
            "beforeinput",
            "compositionstart",
            "compositionupdate",
            "compositionend",
            "paste",
            "cut",
            "keyup",
        ]) {
            on(this.rootEl, type, (e: Event) => e.stopPropagation());
        }

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
