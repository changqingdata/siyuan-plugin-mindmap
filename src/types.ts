/**
 * 公共类型定义
 */

/** 导图结构 */
export type MMLayout = "logic" | "mind" | "tree";

/** 连线样式 */
export type MMEdgeStyle = "curve" | "elbow" | "straight";

/**
 * 画布高度策略。
 *
 * 行内视图里「画布高度」同时承担两件事：**可视区高度**（用户看得见多少）
 * 和 **文档占位高度**（这篇文档要滚多久）。老实现把两者绑在一个数字上
 * （`clamp(内容高, 260, 可用高)`），于是「内容少」这一侧被误伤 ——
 * 实测 4 个节点的图画布只有 280px（占编辑器区 36%），而 49 个节点的图能到
 * 688px（90%），同一块画布落差 2.46 倍、完全由内容决定。
 *
 * 拆开之后：**下限交给用户，上限仍然守着「别把文档顶下去几屏」**。
 */
export type MMCanvasHeightMode =
    /** 内容少时保底 `canvasHeight`，内容多了跟着长（不超过可用高）。默认 */
    | "auto"
    /** 始终 `canvasHeight`，与内容无关 */
    | "fixed"
    /** 始终等于可用高，铺满编辑器可视区 */
    | "fill";

/** 节点语义类型 */
export type MMNodeKind = "bullet" | "ordered" | "task" | "heading" | "other";

/** 主题 ID */
export type MMThemeId = "siyuan" | "deep" | "paper" | "morandi" | "neon" | "contrast";

/**
 * 节点上可执行的结构操作。
 * 全部通过思源内核块 API 落地，保留原有块 ID，不会重建块引用。
 */
export type MMActionKind =
    | "insertChild"
    | "insertSiblingBefore"
    | "insertSiblingAfter"
    | "delete"
    | "indent"
    | "outdent"
    | "moveUp"
    | "moveDown"
    | "move"
    | "duplicate"
    | "paste"
    | "fold"
    | "unfold"
    | "locate"
    | "copy"
    /**
     * 勾选 / 取消勾选一个待办节点。
     *
     * 写回走内核的 `/api/block/updateTaskListItemMarker`，**不是**更新段落内容 ——
     * 勾选态在列表项（`NodeListItem`）的 marker 上，不在段落里。
     * 详见 `utils/api.ts` 里 `setTaskMarker` 的注释（另外两条路都是错的，有实测记录）。
     */
    | "toggleCheck";

/** 拖拽落点语义 */
export type MMDropPosition = "before" | "after" | "child";

/** 结构操作的附加参数 */
export interface MMActionExtra {
    /** 拖拽目标 */
    target?: MMNode;
    /** 拖拽落点 */
    position?: MMDropPosition;
    /** paste 动作携带的 markdown 片段 */
    data?: string;
    /**
     * `toggleCheck` 的**目标态**（true = 要勾上）。
     *
     * 必须显式传，不能在执行侧用 `!node.checked` 反推 ——
     * 渲染层为了做乐观 UI，在派发动作**之前**就把 `node.checked` 翻成了目标态，
     * 执行侧再取反一次就正好写回原值：一次原地踏步的空写。
     * 表现出来是「点一下，界面勾上了，内核纹丝不动」。
     */
    checked?: boolean;
}

/**
 * 结构操作的执行结果。
 *
 * 结构操作是异步写内核的（写回 → 内核回推 DOM → 扫描重挂视图），
 * 中间有几百毫秒画面毫无变化。视图层据此在动作发起时先放一个「乐观占位框」，
 * 拿到结果后再决定是撤掉占位（成功）还是红边抖动 + 给出原因（失败）。
 */
export interface MMActionResult {
    ok: boolean;
    /** 失败原因（人话，直接给用户看），成功时省略 */
    message?: string;
}

/**
 * 文档级视图偏好。
 *
 * 只记「用户显式改过的项」—— 没改过的继续跟随全局默认，
 * 否则用户改了全局主题之后所有文档都不跟着变，反而更别扭。
 * 以块属性 `custom-mindmap-view` 的形式存在列表块上。
 */
export interface MMViewPrefs {
    layout?: MMLayout;
    theme?: MMThemeId;
    edge?: MMEdgeStyle;
    /** 缩放。**不记平移** —— 平移跟画布尺寸强相关，记了很容易错位 */
    scale?: number;
}

/**
 * 视图的**瞬态**状态 —— 不落盘，但必须活过一次「视图重建」。
 *
 * ## 为什么需要它
 *
 * 导图里任何**会写内核**的动作（搜索命中自动展开祖先、折叠、改名、增删…）
 * 都会让 Protyle **异步换掉整个 `.list`**。于是：
 *
 *   1. 旧 `.list` 连里面的 `.mm-root` 一起脱离文档；
 *   2. `scanner.prune()` 看到「视图元素不在文档里」→ 把它从 `views` 里删掉；
 *   3. `scan()` 为新元素 `new MindMapView(...)` —— **一个全新的视图**；
 *   4. 新视图的搜索状态是初值：关着、空串、没有命中。
 *
 * 表现就是用户看到的那一幕：**在导图里搜索、跳到命中项的那一瞬间，
 * 搜索框自己关了、高亮也没了** —— 用户会以为「搜索坏了」。
 *
 * 所以把搜索这类「不落盘但也不能丢」的状态存在 Scanner 里，
 * 视图重建后由 `applyTransient()` 取回。
 *
 * ⚠️ 与 `MMViewPrefs` 的区别：那份**落盘**（块属性），跨会话都在；
 * 这份只在内存里，是「这一次浏览的上下文」。
 * 所以用户主动关掉导图（`exitView`）时要清掉它 —— 下次打开该是干净状态。
 */
export interface MMTransientState {
    /** 搜索框开着没有 */
    searchOpen: boolean;
    /** 查询串 */
    query: string;
    /** 当前命中在 `searchHits` 里的下标 */
    idx: number;
    /** 范围开关：false = 本图，true = 全文档 */
    searchAll: boolean;
}

/**
 * 焦点状态。
 * 三态的键盘归属必须严格分开，否则会与 Protyle 编辑器抢按键。
 */
export type MMFocusState = "browse" | "selected" | "editing";


/** 解析后的导图节点 */
export interface MMNode {
    /** 列表项块 ID（NodeListItem），用于移动、增删、折叠持久化 */
    id: string;
    /** 内容块 ID（NodeParagraph 等），用于回写文字；可能为空 */
    contentId: string;
    /** 所属列表块 ID（NodeList） */
    listId: string;
    /**
     * 自身子列表（NodeList）的块 ID，可能为空。
     * 降级 / 成为子节点时内核要求 parentID 必须是 NodeList 而非 NodeListItem，
     * 所以这个 ID 是必须的。
     */
    subListId: string;
    /** 行内 HTML（保留加粗 / 行内代码 / 公式等） */
    html: string;
    /** 纯文本，用于搜索与导出 */
    text: string;
    kind: MMNodeKind;
    checked?: boolean;
    /**
     * 节点标记（图标 / 标签 / 自定义色），来自块属性 `custom-mindmap-mark`。
     *
     * 解析层每次重渲染都从 DOM 属性重新读，所以「改标记」和「改文字」一样，
     * 走的是同一条路：写内核 → 内核回推 DOM → 重渲染。视图侧不缓存它。
     */
    mark?: MMNodeMark;
    /**
     * 折叠态。
     *
     * 直接来自思源原生的列表折叠（`.li[fold="1"]`）—— 没有插件私有副本，
     * 所以「大纲什么状态、导图就是什么状态」是结构上成立的，不需要两边对表。
     */
    folded: boolean;
    /**
     * 被**过滤器**排除（P1-1「只看未完成 / 只看已完成」）。
     *
     * 与 `folded` 分开存，是因为两者语义完全不同：
     *   - `folded` 是**用户对大纲的折叠意图**，会写回内核（`.li[fold="1"]`），是持久状态；
     *   - `hidden` 纯粹是**当前这次浏览的筛选结果**，只活在内存里，退出视图即消失，
     *     绝不写回内核 —— 否则「看了一眼未完成」就会把大纲的折叠态改掉。
     *
     * 两者对布局的效果一样：都不参与布局、不画连线、导航跳过。
     * 判据统一收在 `shownChildren()` 里，别在这里各写各的。
     */
    hidden?: boolean;
    /** 所属列表是否为有序列表 —— 决定是否显示层级编号 */
    numbered: boolean;
    /** 层级编号，如 1.2.1 */
    order: string;

    children: MMNode[];

    // ---- 装饰阶段填充 ----
    depth: number;
    /** 一级分支序号，用于取色 */
    branch: number;
    /** 分支色（十六进制），根节点为 null */
    color: string | null;

    // ---- 布局阶段填充 ----
    /** 节点宽度 */
    w: number;
    /** 节点高度 */
    h: number;
    /** 左上角坐标 */
    x: number;
    y: number;
    /** 折叠过滤后真正参与布局的子节点 */
    kids: MMNode[];
    parent: MMNode | null;
    /** 思维导图模式下所在侧：1 右 / -1 左 */
    dir: 1 | -1;

    // ---- 布局中间量 ----
    /** 子树在交叉轴上的占位尺寸 */
    cross: number;
    /** 自身占位槽起点 */
    slot: number;
    /** 自身在交叉轴上的中心 */
    cy: number;
    /** 深度轴起止 */
    d0: number;
    d1: number;

    // ---- 渲染阶段填充 ----
    el?: HTMLElement;
    toggle?: HTMLElement;
    /** 悬停快捷操作容器 */
    acts?: HTMLElement;
}

/** 视图渲染参数 */
export interface MMRenderOptions {
    layout: MMLayout;
    edge: MMEdgeStyle;
    theme: MMThemeId;
    /** 显示层级编号 */
    showOrder: boolean;
    /** 紧凑间距 */
    compact: boolean;
    /** 分支配色 */
    branchColor: boolean;
}

/** 主题 token */
export interface MMTheme {
    id: MMThemeId;
    name: string;
    dark: boolean;
    /** 画布底色（CSS background-image 允许渐变） */
    canvasBg: string;
    /** 画布纯色兜底 */
    canvasSolid: string;
    /** 网格线颜色，空字符串表示不画网格 */
    canvasGrid: string;
    nodeBg: string;
    nodeBorder: string;
    nodeText: string;
    rootBg: string;
    rootText: string;
    rootShadow: string;
    cardShadow: string;
    hoverShadow: string;
    toggleBg: string;
    /** 强调色，用于工具条选中态等 UI 元素 */
    accent: string;
    /** 焦点环颜色（选中节点的外圈） */
    focusRing: string;
    /** 一级分支浅填充的透明度 */
    tint: number;
    palette: string[];
}

/** 插件配置 */
export interface MMConfig extends MMRenderOptions {
    /** Ctrl/⌘ + 滚轮缩放 */
    ctrlWheelZoom: boolean;
    /** 滚轮直接平移导图（否则交给页面滚动） */
    wheelPan: boolean;
    /** 自动适应画布 */
    autoFit: boolean;
    /** 画布高度策略，见 `MMCanvasHeightMode` */
    canvasHeightMode: MMCanvasHeightMode;
    /**
     * 画布高度（px）。
     * `auto` 模式下这是**下限**（内容少了也不会比它矮）；`fixed` 模式下就是它的高度；
     * `fill` 模式下忽略。
     */
    canvasHeight: number;
    /** 允许在导图内双击改名并回写内核 */
    editable: boolean;
    /** 允许拖拽节点调整位置与层级 */
    draggable: boolean;
    /** 列表块进入视口才渲染 */
    lazyRender: boolean;
    /**
     * 导图获得焦点时接管键盘。
     * 关闭后导图内所有快捷键失效，只保留鼠标操作 —— 用于排查与思源编辑器的快捷键冲突。
     */
    keyboard: boolean;
    /** 布局变化时播放节点位移过渡 */
    flipAnimation: boolean;
    /** 显示右下角小地图 */
    minimap: boolean;
    /**
     * 小地图「始终显示」。
     *
     * 默认关闭 —— 节点少时小地图是冗余的（整张图本来就在视野里），挂上去只占地方，
     * 所以默认只在节点数达标时才出现（见 `renderer.ts` 的 `MINIMAP_MIN_NODES`）。
     *
     * 但那条线**用户看不见**：开关明明开着、右下角却什么都没有，很容易被当成插件坏了。
     * 所以给一个显式出口 —— 想一直看到它，打开这个即可，不必去猜阈值是多少。
     */
    minimapAlways: boolean;
    /** 节点数超过该值时自动降级为紧凑模式 */
    compactThreshold: number;
    /** 节点数超过该值时默认不渲染，需手动确认 */
    hardLimit: number;
    /**
     * 逻辑结构图自动分列。
     *
     * 逻辑图的交叉轴是纵向的，节点一多画布就会变成 700×3400 这种细长条，
     * 横向空间全部闲置。开启后，当单列高度超过可视区的一定倍数时，
     * 把一级分支摊成若干列，画布比例回到接近视口的形状。
     */
    columnLayout: boolean;
    /**
     * 视图偏好跟文档走。
     *
     * 开启后，用户在这个列表里改过的布局 / 主题 / 连线 / 缩放会写进块属性，
     * 下次打开这个列表就恢复成他调好的样子；没改过的项继续跟随全局默认。
     */
    viewPerDoc: boolean;
    /** 悬停折叠节点时浮出预览卡片（列出前几个子节点） */
    hoverPreview: boolean;
    /** 自定义一级分支配色（逗号分隔的十六进制），空串表示用主题自带色板 */
    customPalette: string;
}

export const DEFAULT_CONFIG: MMConfig = {
    layout: "logic",
    edge: "curve",
    theme: "siyuan",
    showOrder: true,
    compact: false,
    branchColor: true,
    ctrlWheelZoom: true,
    wheelPan: false,
    autoFit: true,
    canvasHeightMode: "auto",
    /**
     * 480 是实测挑出来的：编辑器区 768px 时它占 62%，够像一块画布；
     * 而 4 个节点图的天然内容高只有 280px（占 36%）—— 那才是「一条横幅」的由来。
     * 再往上加就要开始权衡文档占位了，所以留给用户自己调。
     */
    canvasHeight: 480,
    editable: true,
    draggable: true,
    lazyRender: true,
    keyboard: true,
    flipAnimation: true,
    minimap: true,
    // 默认 false = 保持原有行为（节点少时自动隐藏）。想一直看到小地图的用户
    // 可以在设置里显式打开，而不是去猜那条看不见的阈值。
    minimapAlways: false,
    compactThreshold: 400,
    hardLimit: 2000,
    columnLayout: true,
    viewPerDoc: true,
    hoverPreview: true,
    customPalette: "",
};

/** 块属性名 */
export const ATTR_VIEW = "custom-mindmap";
/** 【自定义块样式】插件的列表导图标记，用于迁移 */
export const ATTR_LEGACY_VIEW = "custom-block-list-view";
/**
 * 旧版用来存折叠状态的块属性，**已废弃**。
 *
 * 现在折叠态直接用思源原生的 `fold`（随文档存进 `.sy`，也随文档同步）。
 * 保留这个常量只为一件事：挂载时把老用户的折叠选择一次性迁移过去，
 * 迁完就把属性删掉。不读它、也不再写它。
 */
export const ATTR_LEGACY_FOLD = "custom-mindmap-fold";

/**
 * 文档级视图偏好（`MMViewPrefs` 的序列化形式）。
 *
 * 与 `ATTR_VIEW` 分开存：`custom-mindmap` 是「这个列表要显示成导图」的标记，
 * 会被扫描器反复读写；把偏好塞进去会让标记的语义变混，也让「关掉导图」
 * 顺手把偏好一起清掉。
 */
export const ATTR_VIEW_PREFS = "custom-mindmap-view";

/** 批量操作条上支持的批量动作 */
export type MMBatchKind =
    | "indent"
    | "outdent"
    | "fold"
    | "unfold"
    | "delete"
    | "export"
    /** 把选中的待办节点整体标记为已完成 */
    | "check"
    /** 把选中的待办节点整体标记为未完成 */
    | "uncheck";

/* ==================================================================== 过滤 / 跨图搜索 */

/**
 * 状态过滤器。
 *
 * 只覆盖「勾选态」这一个维度 —— 它是任务列表场景里唯一真正高频的筛选需求。
 * 找标签（`#tag`）之类的用搜索框即可，不必再堆一排 chip。
 */
export type MMFilter = "all" | "todo" | "done";

/** 过滤器在搜索框旁显示的名字 */
export const FILTER_LABEL: Record<MMFilter, string> = {
    all: "全部",
    todo: "未完成",
    done: "已完成",
};

/**
 * 跨图搜索的一条命中。
 *
 * 由 `searchDocOutline()` 从内核直接查出来（一次 SQL，不做递归往返），
 * 所以这里只有纯数据，没有 MMNode —— 命中的节点很可能**根本不在当前这张图里**。
 */
export interface MMSearchHit {
    /** 块 ID */
    id: string;
    /** 节点文字 */
    text: string;
    /** 所属列表块 ID —— 用来判断「是不是当前这张图」 */
    listId: string;
    /** 从顶层节点到自身的路径，如 `顶层任务 › 甲任务`，用来给结果定位 */
    path: string;
}

/**
 * 节点标记（P1-2）。
 *
 * 存在块属性 `custom-mindmap-mark` 上（见 `core/marks.ts`），
 * 不破坏「块是唯一真相源」—— 复制块、反查、导出、换设备都跟着走。
 */
export interface MMNodeMark {
    /** 图标（emoji） */
    icon?: string;
    /** 标签文字 */
    label?: string;
    /** 自定义色（十六进制），覆盖分支色 */
    color?: string;
}

/** 在列表块元素上的挂载标记 */
export const MOUNT_FLAG = "data-mm-mounted";
/** 懒渲染占位标记 */
export const LAZY_FLAG = "data-mm-lazy";
/** 编辑态标记 */
export const EDIT_FLAG = "data-mm-editing";
