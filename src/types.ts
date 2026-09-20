/**
 * 公共类型定义
 */

/** 导图结构 */
export type MMLayout = "logic" | "mind" | "tree";

/** 连线样式 */
export type MMEdgeStyle = "curve" | "elbow" | "straight";

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
    | "copy";

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
     * 折叠态。
     *
     * 直接来自思源原生的列表折叠（`.li[fold="1"]`）—— 没有插件私有副本，
     * 所以「大纲什么状态、导图就是什么状态」是结构上成立的，不需要两边对表。
     */
    folded: boolean;
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
    /** 节点较多时显示右下角小地图 */
    minimap: boolean;
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
    editable: true,
    draggable: true,
    lazyRender: true,
    keyboard: true,
    flipAnimation: true,
    minimap: true,
    compactThreshold: 400,
    hardLimit: 2000,
    columnLayout: true,
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

/** 在列表块元素上的挂载标记 */
export const MOUNT_FLAG = "data-mm-mounted";
/** 懒渲染占位标记 */
export const LAZY_FLAG = "data-mm-lazy";
/** 编辑态标记 */
export const EDIT_FLAG = "data-mm-editing";
