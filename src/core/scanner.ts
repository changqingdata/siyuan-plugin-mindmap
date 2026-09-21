import { showMessage } from "siyuan";
import { ATTR_LEGACY_FOLD, ATTR_VIEW, ATTR_VIEW_PREFS, LAZY_FLAG, MOUNT_FLAG } from "../types";
import type {
    MMActionExtra,
    MMActionKind,
    MMActionResult,
    MMBatchKind,
    MMConfig,
    MMLayout,
    MMNode,
    MMTheme,
    MMViewPrefs,
} from "../types";
import { MindMapView } from "./renderer";
import { History } from "./history";
import { decodeViewPrefs, encodeViewPrefs } from "./prefs";
import {
    getBlockAttrs,
    getBlockKramdown,
    getDocTitle,
    restoreBlock,
    scrollToBlock,
    setBlockAttrs,
    setOutlineFold,
} from "../utils/api";
import {
    deleteNode,
    deleteNodes,
    duplicateNode,
    indentNode,
    indentNodesInto,
    insertChildNode,
    insertSiblingNode,
    moveDownNode,
    moveNodeTo,
    moveUpNode,
    outdentNode,
    outdentNodes,
    pasteNode,
    renameNode,
} from "./actions";
import { topLevelOf } from "./tree";

export interface ScannerHooks {
    getOptions: () => MMConfig;
    /** 布局切换后写回块属性 */
    onLayoutChange: (listId: string, layout: MMLayout) => void;
    /** 打开全屏查看 */
    onFullscreen: (listId: string, root: MMNode, theme: MMTheme, title: string) => void;
    /** 打开一个块（双链的目标）—— 由插件层用 openTab 实现 */
    openBlock: (id: string) => void;
    /** 并排面板的源块没了（被删掉 / 换了文档）—— 插件层据此关掉面板 */
    onSideLost?: () => void;
}

const SELECTOR = `.list[${ATTR_VIEW}]`;

/**
 * 「辅助视图」槽位：全屏弹层与并排面板共用。
 *
 * `sig` 是它自己那份内容签名 —— 不能和行内视图共用 signatures，
 * 它们盯着的是同一个源列表，行内视图先比对并写回签名后，
 * 辅助视图再比就永远等于「没变」。
 */
interface AuxView {
    listId: string;
    view: MindMapView;
    sig: string;
}

/** 撤销记录里显示的操作名 */
const ACTION_LABEL: Record<string, string> = {
    insertChild: "加子节点",
    insertSiblingBefore: "插入同级节点",
    insertSiblingAfter: "插入同级节点",
    delete: "删除节点",
    indent: "降级",
    outdent: "升级",
    moveUp: "上移",
    moveDown: "下移",
    move: "移动节点",
    duplicate: "复制节点",
    paste: "粘贴节点",
};

/**
 * 失败原因（人话，直接显示在节点上）。
 *
 * 原来所有失败都只弹一句「操作未生效，请重试」—— 用户既不知道是哪个节点出的问题，
 * 也不知道为什么。这些文案会跟着红色抖动一起打在**出问题的那个节点**上。
 */
const ACTION_FAIL: Record<string, string> = {
    insertChild: "插入子节点失败，请重试",
    insertSiblingBefore: "插入同级节点失败，请重试",
    insertSiblingAfter: "插入同级节点失败，请重试",
    delete: "删除失败，这个块可能已经被移除了",
    indent: "降级失败：前面没有可用的同级节点",
    outdent: "升级失败：这已经是顶层了",
    moveUp: "上移失败：已经是第一个了",
    moveDown: "下移失败：已经是最后一个了",
    move: "移动失败：目标位置无法放置",
    duplicate: "复制失败，请重试",
    paste: "粘贴失败，请重试",
};

/** 观察选项：内容变化 + 我们关心的那个属性变化 */
const OBSERVE_OPTS: MutationObserverInit = {
    childList: true,
    subtree: true,
    attributes: true,
    // 除了自己的挂载标记，还要盯 `fold` —— 用户在大纲里折叠一个列表项时，
    // 文字一个都没变，只有 `.li` 上的 fold 属性变了。不监听它，
    // 导图就永远跟不上大纲的折叠（双向同步的大纲 → 导图 这一半）。
    attributeFilter: [ATTR_VIEW, "fold"],
};

/** 懒渲染提前量：元素进入视口外 320px 就开始渲染 */
const LAZY_MARGIN = "320px 0px";

/** 覆盖表为空时的共享常量，省得每次 render 都新建一个 Map */
const NO_OVERLAY: ReadonlyMap<string, boolean> = new Map();

/**
 * 折叠写入内核之后，隔多久去核对一次 DOM。
 *
 * 折叠走的是 HTTP → 内核事务 → 前端重绘这条链，是**异步**的：
 * 调完 `foldBlock` 的当下，`.li[fold]` 还没变。这段时间里任何一次重渲染
 * （编辑器打字、别的窗口改了文档）都会按旧 DOM 解析出旧折叠态 ——
 * 用户看到的是一折就又弹回去。覆盖表就是用来盖住这段空窗期的。
 */
const FOLD_SETTLE_MS = 700;

/** 覆盖表最多重试几次写回，之后放弃（避免网络不通时无限重试） */
const FOLD_MAX_TRIES = 3;

/**
 * 变更侦测与视图挂载。
 *
 * 策略：导图容器挂在被标记的 .list 元素内部，原大纲通过 CSS 隐藏但保留在 DOM 中。
 * 这样 Protyle 重建块时导图会随之销毁，下一轮扫描再重新挂载，天然不会错位。
 */
export class Scanner {
    private views = new Map<string, MindMapView>();
    /**
     * 折叠覆盖表：`listId → (blockId → 期望的折叠态)`。
     *
     * 折叠状态**没有**插件私有副本 —— 真相源是思源原生的 `fold` 属性
     * （解析侧直接读 `.li[fold="1"]`，写入侧调 `/api/block/foldBlock`，
     * 思源自己会把 kramdown 里那份存进 `.sy`）。这张表只是补一个时序空窗：
     * 用户在导图上折一个节点之后、内核把 DOM 更新完之前，任何一次重渲染都会
     * 按旧 DOM 解析出旧状态，视觉上「折了又弹回来」。表里的条目在内核追上之后
     * 由 {@link reconcileFold} 自动清掉，所以它不会长成一个影子真相源。
     */
    private pendingFold = new Map<string, Map<string, boolean>>();
    /** 每个列表的折叠核对定时器（只存 id，重试次数随递归传参） */
    private foldTimers = new Map<string, number>();
    /** 已经做过旧属性迁移的列表（一个列表只迁一次） */
    private migrated = new Set<string>();
    /** 已主动卸载的块，短时间内抑制重新挂载 */
    private suppressed = new Map<string, number>();
    /** 源列表的文本签名，用于判断内容是否真的变了 */
    private signatures = new Map<string, string>();
    /** 正在挂载中的块，避免异步等待期间重复挂载 */
    private mounting = new Set<string>();
    /** 已进入过视口的块（懒渲染用，进入后不再卸载） */
    private visible = new Set<string>();
    /** 用户确认强制渲染的超大列表 */
    private forced = new Set<string>();
    /** 「节点过多」提示元素 */
    private notices = new Map<string, HTMLElement>();
    /**
     * 等着「插入即编辑」的新块 ID。
     *
     * 结构操作 → 内核写回 → Protyle 重建 DOM → 我们的扫描重挂视图，这一串是异步的，
     * 而新节点的块 ID 在插入那一刻就拿到了。先记在这里，等视图重建完再去选中它并进入编辑态。
     */
    private pendingEdit = new Map<string, string>();
    /** 「回到导图」浮动条 */
    private backBar: HTMLElement | null = null;
    private backBarTimer = 0;
    /**
     * 撤销 / 重做栈。
     *
     * 思源的 Ctrl+Z 管不到块 API 写出来的内容（详见 history.ts），
     * 所以插件得自己兜住「误删不可逆」这件事。
     */
    private history = new History();
    /**
     * 最近一次写回的时刻。
     *
     * 用来判断「这次重挂要不要把焦点收回导图」。不能靠 activeElement ——
     * 结构操作会重建 DOM，等扫描跑到时 Protyle 已经把焦点抢进 wysiwyg 了。
     */
    private lastUserActionAt = 0;
    /**
     * 全屏弹层里的那份视图。
     *
     * 它不在 `.protyle-wysiwyg` 里，scanAll 的常规流程遍历不到，必须单独登记 ——
     * 否则会出现「全屏里按 Tab 加了子节点，内核改了、行内视图也刷新了，
     * 唯独弹层里毫无反应」，用户看起来就像全屏下不能编辑。
     *
     * 记 listId 而不是直接记元素：结构操作之后 Protyle 会把 `.list` 重建，
     * 每次扫描都得重新找一遍当前那个（详见 scan 里对它的处理）。
     */
    private fullscreen: AuxView | null = null;
    /**
     * 并排面板里的那份视图。
     *
     * 与全屏的区别：**不隐藏源列表**，左边大纲右边导图同时可见，靠 MutationObserver
     * 实时联动（编辑器里改一个字，右边立刻跟着变）。所以它既不写块属性、
     * 也不走 `mm-source-hidden`，纯粹是一个「伴生面板」。
     */
    private side: AuxView | null = null;

    /**
     * 文档级视图偏好缓存：`listId → 用户显式改过的项`。
     *
     * 缓存是必要的 —— 挂载要同步拿到偏好才能决定首次渲染用什么布局 / 主题，
     * 而读块属性是异步的。块 ID 全局唯一，所以缓存不会串文档。
     */
    private prefsCache = new Map<string, MMViewPrefs>();
    /** 视图偏好的防抖写入定时器（拖缩放条会连着改很多次） */
    private prefsTimers = new Map<string, number>();

    private observer: MutationObserver | null = null;
    private io: IntersectionObserver | null = null;
    private pending = new Set<HTMLElement>();
    private timer: number | null = null;
    private paused = 0;

    constructor(private hooks: ScannerHooks) {}

    /* ================================================================ 生命周期 */

    start() {
        this.observer = new MutationObserver((records) => this.onMutations(records));
        this.observer.observe(document.body, OBSERVE_OPTS);

        if (typeof IntersectionObserver !== "undefined") {
            this.io = new IntersectionObserver((entries) => this.onIntersect(entries), {
                root: null,
                rootMargin: LAZY_MARGIN,
                threshold: 0,
            });
        }

        this.scanAll();
    }

    stop() {
        this.observer?.disconnect();
        this.observer = null;
        this.io?.disconnect();
        this.io = null;
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = null;
        this.pending.clear();
        for (const t of this.foldTimers.values()) window.clearTimeout(t);
        this.foldTimers.clear();
        for (const view of this.views.values()) view.destroy();
        this.views.clear();
        this.pendingFold.clear();
        this.migrated.clear();
        this.suppressed.clear();        this.signatures.clear();
        this.mounting.clear();
        this.visible.clear();
        this.forced.clear();
        for (const box of this.notices.values()) box.remove();
        this.notices.clear();
        this.fullscreen = null;
        this.side = null;
        this.pendingEdit.clear();
        this.hideBackBar();
        this.history.clear();
    }

    /** 设置变化后刷新全部视图 */
    refreshAll() {
        const opts = this.hooks.getOptions();
        for (const view of this.views.values()) view.setOptions(opts);
        this.fullscreen?.view.setOptions(opts);
        this.side?.view.setOptions(opts);
    }

    /** 登记全屏弹层里的视图，让它和行内视图一样跟着源列表刷新 */
    attachFullscreen(listId: string, view: MindMapView) {
        this.fullscreen = { listId, view, sig: this.signature(view.source) };
    }

    detachFullscreen(view: MindMapView) {
        if (this.fullscreen?.view === view) this.fullscreen = null;
    }

    /** 登记并排面板里的视图 */
    attachSide(listId: string, view: MindMapView) {
        this.side = { listId, view, sig: this.signature(view.source) };
    }

    detachSide(view: MindMapView) {
        if (this.side?.view === view) this.side = null;
    }

    get sideListId(): string {
        return this.side?.listId ?? "";
    }

    /**
     * 卸载某个列表块的导图。
     *
     * @param suppress 是否抑制重新挂载。默认 true —— 用于「用户主动关掉导图」的场景：
     *   块属性是异步写回 DOM 的，不抑制的话紧接着的那次扫描会看到标记还在、又把它挂回去。
     *   **源元素被 Protyle 重建时必须传 false**：那种情况下标记一直都在，
     *   抑制会让导图白白消失一段时间（详见 scan 里对 replaced 的处理）。
     */
    unmount(listId: string, suppress = true) {
        const view = this.views.get(listId);
        if (view) {
            this.pauseObserver(() => view.destroy());
            this.views.delete(listId);
        }
        // 覆盖表**不在这里清**：unmount 常发生在「源元素被 Protyle 重建」的场合，
        // 紧接着就会重挂，清掉就把用户刚折的那一下丢了。交给 reconcileFold 收尾
        // （它核对完发现列表真的没了，会自行丢弃）。
        this.signatures.delete(listId);
        if (suppress) this.suppressed.set(listId, Date.now());
    }

    /* ================================================================ 扫描 */

    scanAll() {
        document.querySelectorAll<HTMLElement>(".protyle-wysiwyg").forEach((w) => this.scan(w));
    }

    scan(wysiwyg: HTMLElement) {
        this.prune();

        // 过期抑制项（正常情况内核属性更新后 DOM 上的标记会消失）
        const now = Date.now();
        for (const [id, ts] of Array.from(this.suppressed)) {
            if (now - ts > 3000) this.suppressed.delete(id);
        }

        const opts = this.hooks.getOptions();

        /* 1. 找出新标记的列表块 */
        const lists = Array.from(wysiwyg.querySelectorAll<HTMLElement>(SELECTOR));
        for (const list of lists) {
            const id = list.dataset.nodeId;
            if (!id) continue;
            if (this.suppressed.has(id)) continue;
            if (list.hasAttribute(MOUNT_FLAG)) continue;
            if (this.views.has(id)) continue;
            // 嵌套在另一个已标记列表内部的子列表不单独渲染
            if (list.parentElement?.closest(SELECTOR)) continue;

            // 懒渲染：没进过视口就先不挂载
            if (opts.lazyRender && !this.visible.has(id)) {
                this.observeLazy(list);
                continue;
            }
            void this.mount(list, id, opts);
        }

        /* 2. 维护已挂载的视图 */
        const replaced: string[] = [];
        for (const [id, view] of Array.from(this.views)) {
            const src = view.source;
            if (!src.isConnected) {
                // 源元素被 Protyle 重建了 —— 结构操作（尤其 moveBlock / deleteBlock）之后
                // 它会把整个 `.list` 元素换掉，旧元素变成游离节点。
                //
                // ⚠️ 这里**不能**直接 unmount：unmount 会连带 3 秒的「抑制重挂」，
                // 而抑制项只在「下一次扫描」时才会被清掉 —— 如果那之后没有新的 DOM 变动，
                // 扫描就不会再发生，导图会**一直消失**。实测删除一个节点后
                // `document.querySelector('.mm-root')` 直接返回 null，就是这个原因。
                //
                // 正确做法是就地重挂到新元素上。
                if (src.hasAttribute(ATTR_VIEW)) replaced.push(id);
                else this.unmount(id);
                continue;
            }
            if (!src.hasAttribute(ATTR_VIEW)) {
                this.unmount(id);
                continue;
            }
            // 源列表内容变了就重新渲染（在编辑器里改字、或结构操作后内核回推 DOM）
            const sig = this.signature(src);
            if (sig !== this.signatures.get(id)) {
                this.signatures.set(id, sig);
                view.render();
                this.applyPendingEdit(id);
            }
        }

        // 重挂：卸载时**不抑制**，同一轮扫描里立刻在新元素上重建。
        // 重建出来的是全新的 DOM，焦点会掉到 body（或被 Protyle 抢进 wysiwyg）——
        // 如果这次改动本来就是用户用键盘在导图上操作的，得把焦点接回来，
        // 否则「删除之后按 Ctrl+Z / 方向键都没反应」。
        //
        // 判断「原来有没有焦点」不能只看 activeElement：等我们扫描时（140ms 后）
        // Protyle 早就把焦点抢进 wysiwyg 了。所以改看「最近是不是有导图交互」。
        const recent = Date.now() - this.lastUserActionAt < 1200;
        for (const id of replaced) {
            const wantFocus = recent || (this.views.get(id)?.element.contains(document.activeElement) ?? false);
            this.unmount(id, false);
            const next = document.querySelector<HTMLElement>(`.list[data-node-id="${id}"]`);
            if (!next?.hasAttribute(ATTR_VIEW)) continue;
            void this.mount(next, id, opts).then(() => {
                if (wantFocus) this.focusSoon(id);
            });
        }

        /* 2b. 全屏弹层 / 并排面板里的视图不在 .protyle-wysiwyg 里，得单独照看 */
        if (this.fullscreen && !this.syncAux(this.fullscreen)) this.fullscreen = null;
        if (this.side && !this.syncAux(this.side)) {
            this.side = null;
            this.hooks.onSideLost?.();
        }

        /* 3. 清理已消失的「节点过多」提示 */
        for (const [id, box] of Array.from(this.notices)) {
            if (!box.isConnected) {
                this.notices.delete(id);
                this.forced.delete(id);
            }
        }
    }

    /**
     * 照看一个「不在 .protyle-wysiwyg 里」的辅助视图（全屏弹层 / 并排面板）。
     *
     * 每次都重新查当前的源列表元素。结构操作（尤其 moveBlock）之后 Protyle 会把
     * 整个 `.list` 重建，视图握着的旧引用会变成游离节点 —— 那样 signature 永远读到
     * 旧内容，于是永远判成「没变」、永远不重渲染。
     * 实测就是这个原因导致「全屏里 Shift+Tab 之后画面一动不动」。
     *
     * @returns 视图是否还活着（false 表示该丢掉这个槽位）
     */
    private syncAux(slot: AuxView): boolean {
        const src = document.querySelector<HTMLElement>(`.list[data-node-id="${slot.listId}"]`);
        if (!src || !slot.view.element.isConnected) return false;
        slot.view.setSource(src);
        const sig = this.signature(src);
        if (sig !== slot.sig) {
            slot.sig = sig;
            slot.view.render();
            this.applyPendingEdit(slot.listId);
        }
        return true;
    }

    private prune() {
        for (const [id, view] of Array.from(this.views)) {
            if (!view.element.isConnected) {
                this.views.delete(id);
                this.signatures.delete(id);
            }
        }
    }

    /**
     * 源列表的内容签名，忽略导图自身 DOM。
     *
     * ⚠️ 必须把**折叠态**也算进去：用户在大纲里折一个节点，文字一个都没变，
     * 只靠文本的话扫描会判成「没变化」→ 导图永远不跟着折。
     * 折叠是导图与大纲共用的状态，它变了就是内容变了。
     */
    private signature(el: HTMLElement): string {
        let s = "";
        const walk = (node: Node) => {
            if (node.nodeType === 1) {
                const he = node as HTMLElement;
                if (he.classList && he.classList.contains("mm-root")) return;
            }
            if (node.nodeType === 3) s += node.nodeValue ?? "";
            node.childNodes.forEach(walk);
        };
        walk(el);
        // 文档顺序稳定，所以拼出来的串是确定的
        el.querySelectorAll('.li[fold="1"]').forEach((li) => {
            s += `\u0001${li.getAttribute("data-node-id") ?? ""}`;
        });
        return s;
    }

    /* ================================================================ 懒渲染 */

    private onIntersect(entries: IntersectionObserverEntry[]) {
        let dirty = false;
        for (const e of entries) {
            if (!e.isIntersecting) continue;
            const el = e.target as HTMLElement;
            const id = el.dataset.nodeId;
            if (!id || this.visible.has(id)) continue;
            this.visible.add(id);
            dirty = true;
        }
        if (dirty) this.scanAll();
    }

    private observeLazy(list: HTMLElement) {
        if (!this.io || list.hasAttribute(LAZY_FLAG)) return;
        list.setAttribute(LAZY_FLAG, "1");
        this.io.observe(list);
    }

    /* ================================================================ 挂载 */

    private async mount(list: HTMLElement, id: string, opts: MMConfig) {
        if (this.mounting.has(id)) return;
        this.mounting.add(id);
        try {
            // 节点数超过硬上限时默认不渲染，避免编辑器被拖死
            const count = list.querySelectorAll(".li").length;
            if (count > opts.hardLimit && !this.forced.has(id)) {
                this.showNotice(list, id, count, opts.hardLimit);
                return;
            }

            // 折叠状态不在这里读了 —— 它就在 DOM 上（`.li[fold="1"]`），
            // parseList 每次都直接读，视图重建天然拿到最新状态，跨会话也一致。
            // 覆盖表只负责补「刚点完、内核还没回推」的那段空窗。
            void this.migrateLegacyFold(id);

            // 异步等待期间块可能已经被替换
            if (!list.isConnected || this.views.has(id)) return;

            // 文档级视图偏好要在挂载**之前**注入 —— 首次渲染就得用对布局 / 主题，
            // 否则用户会先看到一张默认样式的图、再「跳」成他自己调好的样子。
            const prefs = await this.loadPrefs(id);

            const title = getDocTitle(list);
            const view = new MindMapView(
                list,
                opts,
                () => this.foldOverlay(id),
                {
                    onFoldChange: (nodeId, folded) => this.setFold(id, nodeId, folded),
                    onLocate: (nodeId) => this.locate(id, nodeId),
                    onEditInSource: (node) => this.editInSource(id, node),
                    onOpenBlock: (nodeId) => this.hooks.openBlock(nodeId),
                    onExit: () => this.exitView(id),
                    onLayoutChange: (layout) => this.hooks.onLayoutChange(id, layout),
                    onFullscreen: (root, theme) => this.hooks.onFullscreen(id, root, theme, title),
                    onRename: (node, text) => void this.applyRename(node, text, id),
                    onNodeAction: (kind, node, extra) => this.applyAction(kind, node, extra, id),
                    onBatchAction: (kind, nodes) => this.applyBatch(kind, nodes, id),
                    onViewPrefs: (next) => this.savePrefs(id, next),
                    onHistory: (redo) => this.undo(redo),
                },
                title,
                "inline",
            );
            view.applyViewPrefs(prefs);

            this.pauseObserver(() => {
                view.mount();
                list.setAttribute(MOUNT_FLAG, "1");
            });
            this.views.set(id, view);
            this.signatures.set(id, this.signature(list));
            this.clearNotice(id);
            this.applyPendingEdit(id);
        } finally {
            this.mounting.delete(id);
        }
    }

    /* ================================================================ 节点过多提示 */

    private showNotice(list: HTMLElement, id: string, count: number, limit: number) {
        if (this.notices.has(id)) return;

        const box = document.createElement("div");
        box.className = "mm-notice";
        box.setAttribute("contenteditable", "false");

        const text = document.createElement("span");
        text.textContent = `该列表含 ${count} 个节点，超过渲染上限 ${limit}，已暂停渲染以免拖慢编辑器。`;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "b3-button b3-button--outline fn__size200";
        btn.textContent = "仍然渲染";
        btn.onclick = (e) => {
            e.stopPropagation();
            this.forced.add(id);
            this.clearNotice(id);
            this.scanAll();
        };

        box.append(text, btn);
        this.pauseObserver(() => {
            list.appendChild(box);
            list.classList.add("mm-notice-mode");
        });
        this.notices.set(id, box);
    }

    private clearNotice(id: string) {
        const box = this.notices.get(id);
        if (!box) return;
        const list = box.parentElement;
        box.remove();
        this.notices.delete(id);
        list?.classList.remove("mm-notice-mode");
    }

    /* ================================================================ 写回动作 */

    private rescanSoon() {
        window.setTimeout(() => this.scanAll(), 140);
    }

    /* ---- 撤销快照 ----
       每个写回动作前后各取一次列表块的 kramdown，做成一条撤销记录。
       代价是每次动作多两次内核调用；写回是用户手动触发的，不在热路径上，
       换来的是「误删可恢复」，很值 —— 详见 history.ts 里的说明。 */

    private snapshot(listId: string): Promise<string | null> {
        return listId ? getBlockKramdown(listId) : Promise.resolve(null);
    }

    private record(listId: string, label: string, before: string | null, after: string | null) {
        if (!listId || before === null || after === null) return;
        this.history.push({ listId, label, before, after });
    }

    /** 改名回写（全屏视图也会调用） */
    async applyRename(node: MMNode, text: string, listId = "") {
        const changed = text.replace(/\s+/g, " ").trim() !== node.text;
        if (!changed) return;
        this.lastUserActionAt = Date.now();

        const before = await this.snapshot(listId);
        const ok = await renameNode(node, text);
        if (!ok) {
            showMessage("改名失败", 4000, "error");
            return;
        }
        this.record(listId, "改名", before, await this.snapshot(listId));
        this.rescanSoon();
        this.focusSoon(listId);
    }

    /* ================================================================ 视图偏好 */

    /**
     * 读这个列表块的文档级视图偏好。
     *
     * 关闭 `viewPerDoc` 时直接返回空 —— 空偏好等于「全部跟随全局默认」，
     * 视图那边不需要知道开关的存在。
     */
    async loadPrefs(listId: string): Promise<MMViewPrefs> {
        if (!this.hooks.getOptions().viewPerDoc || !listId) return {};
        const cached = this.prefsCache.get(listId);
        if (cached) return cached;
        let prefs: MMViewPrefs = {};
        try {
            const attrs = await getBlockAttrs(listId);
            prefs = decodeViewPrefs(attrs[ATTR_VIEW_PREFS]);
        } catch (err) {
            console.warn("[mindmap] 读取视图偏好失败，按默认处理", listId, err);
        }
        this.prefsCache.set(listId, prefs);
        return prefs;
    }

    /**
     * 写回视图偏好（防抖）。
     *
     * 拖缩放条、连点主题会连着触发很多次，每次都打一次内核太浪费；
     * 而且写块属性本身会引来 Protyle 的属性刷新，密集写会看着抖。
     */
    savePrefs(listId: string, prefs: MMViewPrefs) {
        if (!this.hooks.getOptions().viewPerDoc || !listId) return;
        this.prefsCache.set(listId, { ...prefs });
        const prev = this.prefsTimers.get(listId);
        if (prev) window.clearTimeout(prev);
        this.prefsTimers.set(
            listId,
            window.setTimeout(() => {
                this.prefsTimers.delete(listId);
                const cur = this.prefsCache.get(listId) ?? {};
                // 编码为空串说明用户把偏好全清了，这时要把属性整个删掉，
                // 而不是留一个空值 —— 留空值会让「没设过」和「设成空」两种情况混在一起
                void setBlockAttrs(listId, { [ATTR_VIEW_PREFS]: encodeViewPrefs(cur) || null });
            }, 420),
        );
    }

    /** 结构操作（全屏视图也会调用） */
    async applyAction(
        kind: MMActionKind,
        node: MMNode,
        extra?: MMActionExtra,
        listId = "",
    ): Promise<MMActionResult> {
        this.lastUserActionAt = Date.now();
        const before = await this.snapshot(listId);
        let ok = false;
        /** 新建出来的块 ID —— 用来「插入即编辑」，让用户直接打字就是命名 */
        let newId = "";
        switch (kind) {
            case "insertChild": {
                const id = await insertChildNode(node);
                ok = id !== null;
                newId = id ?? "";
                break;
            }
            case "insertSiblingBefore": {
                const id = await insertSiblingNode(node, "before");
                ok = id !== null;
                newId = id ?? "";
                break;
            }
            case "insertSiblingAfter": {
                const id = await insertSiblingNode(node, "after");
                ok = id !== null;
                newId = id ?? "";
                break;
            }
            case "delete":
                ok = await deleteNode(node);
                break;
            case "indent":
                ok = await indentNode(node);
                break;
            case "outdent":
                ok = await outdentNode(node);
                break;
            case "moveUp":
                ok = await moveUpNode(node);
                break;
            case "moveDown":
                ok = await moveDownNode(node);
                break;
            case "move":
                if (extra?.target && extra.position) ok = await moveNodeTo(node, extra.target, extra.position);
                break;
            case "duplicate": {
                const id = await duplicateNode(node);
                ok = id !== null;
                newId = id ?? "";
                break;
            }
            case "paste":
                if (extra?.data) ok = await pasteNode(node, extra.data);
                break;
            default:
                return { ok: false, message: "不支持的操作" };
        }

        if (!ok) {
            // 失败反馈交给视图去做（在原节点上打红边 + 抖动），这里只把原因带回去。
            // 视图手里有节点元素，能指出「是哪一个」；这里只有一个 ID。
            return { ok: false, message: ACTION_FAIL[kind] ?? "操作未生效，请重试" };
        }
        this.record(listId, ACTION_LABEL[kind] ?? "操作", before, await this.snapshot(listId));

        // 插入即编辑：新节点建出来之后自动选中并进入编辑态。
        // 内核写回 → Protyle 重建 DOM → 我们重挂视图，这一串是异步的，
        // 所以先记下 ID，等视图重建完再兑现（见 applyPendingEdit）。
        if (newId && listId) {
            this.pendingEdit.set(listId, newId);
            // 兜底：万一视图一直没重建（比如扫描被别的动作打断），
            // 别让这条记录留到几分钟后突然跳进编辑态
            window.setTimeout(() => {
                if (this.pendingEdit.get(listId) === newId) this.pendingEdit.delete(listId);
            }, 4000);
        }

        this.rescanSoon();
        // 结构操作必然重建 `.list`，焦点一定会掉；接回来用户才能接着用键盘
        // （尤其「删除 → Ctrl+Z」这条链路，第二步靠的就是焦点还在导图上）
        this.focusSoon(listId);
        return { ok: true };
    }

    /**
     * 批量结构操作。
     *
     * **整体成功或整体回滚** —— 内核没有批量接口，只能逐条调用，
     * 中途失败如果不回滚，用户的数据就留在「删了一半」的状态里，
     * 比整个操作失败糟糕得多。回滚靠的是操作前取的那份 kramdown 快照
     * （和撤销栈用的是同一份东西）。
     */
    async applyBatch(kind: MMBatchKind, nodes: MMNode[], listId = ""): Promise<MMActionResult> {
        this.lastUserActionAt = Date.now();

        // 祖先也被选中的节点先剔掉：移动一个节点和它的后代是自相矛盾的
        const targets = topLevelOf(nodes);
        if (targets.length === 0) return { ok: true };

        const before = await this.snapshot(listId);
        let failed: MMNode[] = [];

        switch (kind) {
            case "indent": {
                // 语义取「多行缩进」的通用约定：全部变成**第一项上面那个节点**的子节点。
                // 一条条单独降级会串成 A→B→C 的阶梯，那不是用户要的。
                const first = targets[0];
                const sibs = first.parent?.children ?? [];
                const idx = sibs.indexOf(first);
                const anchor = idx > 0 ? sibs[idx - 1] : null;
                if (!anchor) {
                    return { ok: false, message: "降级失败：选中的第一项上面没有同级节点" };
                }
                failed = await indentNodesInto(targets, anchor);
                break;
            }
            case "outdent":
                failed = await outdentNodes(targets);
                break;
            case "delete":
                failed = await deleteNodes(targets);
                break;
            default:
                return { ok: false, message: "不支持的批量操作" };
        }

        if (failed.length > 0) {
            if (!before) {
                return { ok: false, message: "批量操作失败，请重试" };
            }
            const restored = await restoreBlock(listId, before);
            if (!restored) {
                showMessage("批量操作失败，自动还原也没成功，请手动按 Ctrl+Z", 5000, "error");
                return { ok: false, message: "操作失败，请重试" };
            }
            this.rescanSoon();
            this.focusSoon(listId);
            return { ok: false, message: `批量${ACTION_LABEL[kind] ?? "操作"}失败，已还原到操作前` };
        }

        this.record(listId, `批量${ACTION_LABEL[kind] ?? "操作"}`, before, await this.snapshot(listId));
        this.rescanSoon();
        this.focusSoon(listId);
        return { ok: true };
    }

    /**
     * 兑现「插入即编辑」：等视图重挂完之后，选中新节点并进入编辑态。
     *
     * 取不到就留着记录等下一次扫描 —— 视图可能比内核晚一拍。
     */
    private applyPendingEdit(listId: string) {
        const id = this.pendingEdit.get(listId);
        if (!id) return;
        const view = this.fullscreen?.listId === listId ? this.fullscreen.view : this.views.get(listId);
        if (!view) return;
        if (!view.revealAndEdit(id)) return;
        this.pendingEdit.delete(listId);
    }

    /* ================================================================ 撤销 / 重做 */

    get canUndo(): boolean {
        return this.history.canUndo;
    }

    get canRedo(): boolean {
        return this.history.canRedo;
    }

    /**
     * 撤销 / 重做。返回「插件是否接管了这个键」。
     *
     * 栈空时返回 false，调用方据此让 Ctrl+Z 继续冒泡给思源自己的撤销栈 ——
     * 用户刚在编辑器里打过字，撤销的应该是那次输入，不能让我们吞掉。
     */
    undo(redo = false): boolean {
        if (redo ? !this.history.canRedo : !this.history.canUndo) return false;
        void this.runHistory(redo);
        return true;
    }

    private async runHistory(redo: boolean) {
        const entry = redo ? this.history.popRedo() : this.history.popUndo();
        if (!entry) return;
        this.lastUserActionAt = Date.now();

        const ok = await restoreBlock(entry.listId, redo ? entry.after : entry.before);
        if (!ok) {
            // 还原失败就把记录放回去，别让它凭空消失
            this.history.rollback(redo ? "redo" : "undo");
            showMessage(`${redo ? "重做" : "撤销"}失败，请重试`, 3000, "error");
            return;
        }
        showMessage(`已${redo ? "重做" : "撤销"}：${entry.label}`, 2000);
        this.rescanSoon();
        // 还原同样是整块写回，Protyle 一样会把 `.list` 换掉、焦点一样会掉进编辑器，
        // 所以必须把焦点接回来 —— 否则「连按两次 Ctrl+Z」第二次根本没人接。
        this.focusSoon(entry.listId);
    }

    /**
     * 把焦点抢回导图，并**坚持一小段时间**。
     *
     * 为什么要「坚持」而不是 focus 一次，有两段时间窗要覆盖：
     *   1. 按 Delete 之后 +2ms，思源编辑器就把焦点抓回了 `.protyle-wysiwyg`
     *      （给 `HTMLElement.prototype.focus` 打桩抓到的调用栈，见 tests/probe-focus.mjs）；
     *   2. 结构操作之后 Protyle 会重建 `.list`，我们要把视图重挂到新元素上，
     *      而挂载本身是异步的，头几十毫秒新元素还没进 DOM。
     * 于是按 70ms 一轮重试几轮。
     *
     * 传 `listId` 而不是视图对象：重挂之后视图是**全新的实例**，
     * 抓着旧引用会扑空（而且旧实例的 `element` 已经不在 DOM 里了）。
     *
     * 只在焦点掉到 body / 被编辑器抢走时才出手；焦点已经在导图上
     * （或用户自己点去了别处）就停手，免得跟用户较劲。
     */
    private focusSoon(listId: string, tries = 6) {
        if (!listId) return;
        const attempt = () => {
            // 用户已经转去干别的了就别再抢
            if (Date.now() - this.lastUserActionAt > 1200) return;
            const view = this.fullscreen?.listId === listId ? this.fullscreen.view : this.views.get(listId);
            if (view) {
                const el = view.element;
                if (el.isConnected && !el.contains(document.activeElement)) {
                    const active = document.activeElement;
                    const stolen =
                        active === null ||
                        active === document.body ||
                        (active instanceof HTMLElement && !!active.closest(".protyle-wysiwyg"));
                    if (stolen) view.focusRoot();
                }
            }
            if (tries-- > 0) window.setTimeout(attempt, 70);
        };
        window.setTimeout(attempt, 50);
    }

    /* ================================================================ 其他动作 */

    private exitView(listId: string) {
        this.hideBackBar();
        this.unmount(listId);
        void setBlockAttrs(listId, { [ATTR_VIEW]: null });
    }

    private locate(listId: string, nodeId: string) {
        // 目标块在导图模式下被隐藏，先退出视图再滚动定位
        this.exitView(listId);
        window.setTimeout(() => scrollToBlock(nodeId), 80);
    }

    /**
     * 回到源列表里编辑这个节点 —— 含行内格式的节点只能这么改。
     *
     * 为什么不让它在导图里就地编辑：就地编辑提交时只能拿到 `textContent`，
     * 写回内核的也是纯文本，于是该节点的**双链、公式、加粗会被静默抹掉**
     * （实测 `加粗 **粗体** 斜体 *斜体*` 改名后只剩 `改过`）。
     * 视觉上因为当场还原了 HTML，用户根本看不出来，等发现时笔记已经坏了。
     *
     * 代价是要退出导图视图（源列表在导图模式下是 display:none，没法同时看两边），
     * 改完再点列表块的图标进来即可。换来的是零格式损失，值。
     */
    editInSource(listId: string, node: MMNode) {
        const contentId = node.contentId;
        if (!contentId) return;
        // 退出视图会把 ATTR_VIEW 从 DOM 上摘掉，所以先记下当前布局，
        // 「回到导图」按钮要靠它把视图原样恢复
        const layout = this.currentLayout(listId);
        this.exitView(listId);

        window.setTimeout(() => {
            const block = document.querySelector<HTMLElement>(`.protyle-wysiwyg [data-node-id="${contentId}"]`);
            if (!block) {
                showMessage("没找到对应的段落，内容可能已被改动", 3000, "error");
                return;
            }
            block.scrollIntoView({ block: "center", behavior: "smooth" });

            // Protyle 的段落外壳本身不可编辑，可编辑的是里面那个 [contenteditable="true"]
            const editable = block.querySelector<HTMLElement>('[contenteditable="true"]') ?? block;
            editable.focus();
            try {
                const range = document.createRange();
                range.selectNodeContents(editable);
                // 光标落在**末尾**，不做全选。
                // 全选看着方便（可以直接改写），但用户一打字就替换掉整段内容 ——
                // 连带把双链、公式、加粗一起清掉，正好是我们想避免的。
                // 最常见的诉求是「改个错别字」，光标落末尾最安全；要全选用户自己 Ctrl+A。
                range.collapse(false);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            } catch {
                /* 选区失败不影响编辑 */
            }

            block.classList.add("mm-flash");
            window.setTimeout(() => block.classList.remove("mm-flash"), 1400);
            this.showBackBar(listId, layout);
        }, 120);
    }

    /** 读当前列表块的导图布局（没有则回退到设置里的默认布局） */
    private currentLayout(listId: string): MMLayout {
        const el = document.querySelector<HTMLElement>(`.list[data-node-id="${listId}"]`);
        const v = el?.getAttribute(ATTR_VIEW);
        return (v as MMLayout | null) ?? this.hooks.getOptions().layout;
    }

    /* ================================================================ 「回到导图」浮动条 */

    /**
     * 跳回原文编辑之后，在屏幕底部留一个轻提示 + 一键返回。
     *
     * 原来的链路是单向的：双击含格式的节点 → 退出导图 → 光标落到原文，
     * 想回导图得自己再去点列表块的图标。改一个错别字要「离开-改-手动回来」，
     * 来回三次就没人愿意用了。这条浮动条把回程补上。
     */
    private showBackBar(listId: string, layout: MMLayout) {
        this.hideBackBar();

        const bar = document.createElement("div");
        bar.className = "mm-backbar";
        bar.setAttribute("contenteditable", "false");

        const text = document.createElement("span");
        text.className = "mm-backbar-text";
        text.textContent = "已回到原文编辑（格式不会丢）";

        const back = document.createElement("button");
        back.type = "button";
        back.className = "mm-backbar-btn";
        back.textContent = "回到导图";
        back.onclick = (e) => {
            e.stopPropagation();
            this.hideBackBar();
            void this.remount(listId, layout);
        };

        const close = document.createElement("button");
        close.type = "button";
        close.className = "mm-backbar-x";
        close.textContent = "✕";
        close.onclick = (e) => {
            e.stopPropagation();
            this.hideBackBar();
        };

        bar.append(text, back, close);
        document.body.appendChild(bar);
        this.backBar = bar;
        // 15 秒自动收起：它只是个回程引导，不该长期占着屏幕
        this.backBarTimer = window.setTimeout(() => this.hideBackBar(), 15000);
    }

    private hideBackBar() {
        if (this.backBarTimer) {
            window.clearTimeout(this.backBarTimer);
            this.backBarTimer = 0;
        }
        this.backBar?.remove();
        this.backBar = null;
    }

    /** 把某个列表块重新挂成导图视图 */
    private async remount(listId: string, layout: MMLayout) {
        const el = document.querySelector<HTMLElement>(`.list[data-node-id="${listId}"]`);
        if (!el) {
            showMessage("没找到原来的列表块", 3000, "error");
            return;
        }
        this.suppressed.delete(listId);
        el.setAttribute(ATTR_VIEW, layout);
        await setBlockAttrs(listId, { [ATTR_VIEW]: layout });
        window.setTimeout(() => this.scanAll(), 60);
    }

    /* ================================================================ 折叠同步 */

    /**
     * 把老版本存在 `custom-mindmap-fold` 里的折叠状态迁到思源原生 `fold` 上。
     *
     * 只在**这个列表还没有任何原生折叠**时迁移 —— 否则会把用户后来在大纲里
     * 亲手折的那几个覆盖掉。迁完就删掉老属性，所以这是纯粹的一次性动作，
     * 不会在用户的笔记里留下第二套状态。
     *
     * 不迁移的后果是实打实的：老用户精心折好的那十几个节点会突然全展开。
     * 而迁移只是**复原用户自己的选择**，不算插件替用户做决定。
     */
    private async migrateLegacyFold(listId: string) {
        if (this.migrated.has(listId)) return;
        this.migrated.add(listId);
        try {
            const list = document.querySelector<HTMLElement>(`.list[data-node-id="${listId}"]`);
            if (!list) return;
            // 已经有原生折叠了 —— 说明这个列表用的是新机制，老属性直接无视
            if (list.querySelector('.li[fold="1"]')) return;

            const attrs = await getBlockAttrs(listId);
            const raw = attrs[ATTR_LEGACY_FOLD];
            if (!raw) return;

            const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
            let n = 0;
            for (const id of ids) {
                if (!list.querySelector(`.li[data-node-id="${id}"]`)) continue;
                if (await setOutlineFold(id, true)) n++;
            }
            await setBlockAttrs(listId, { [ATTR_LEGACY_FOLD]: null });
            if (n > 0) showMessage(`已把 ${n} 个折叠状态迁移为思源原生折叠`, 4000);
        } catch (err) {
            console.warn("[mindmap] 迁移旧折叠状态失败", listId, err);
        }
    }

    /**
     * 取某个列表的折叠覆盖表（**活的引用**，视图每次 render 都现读）。
     *
     * 正常情况返回空表 —— 那时折叠态完全由 DOM 上的 `fold` 决定。
     */
    foldOverlay(listId: string): ReadonlyMap<string, boolean> {
        return this.pendingFold.get(listId) ?? NO_OVERLAY;
    }

    /**
     * 把折叠状态写回大纲（导图 → 大纲 这一半）。
     *
     * 只做两件事：记进覆盖表、调思源原生的 `foldBlock` / `unfoldBlock`。
     * 插件**不**再自己存一份折叠状态 —— 内核会把 `fold="1"` 写进 kramdown，
     * 思源自己就把它持久化进 `.sy`，所以「用户离开时什么状态，下次进来就是什么状态」
     * 是内核保证的，插件不替用户做决定。
     *
     * @param nodeId 节点自身的块 ID（NodeListItem），不是 listId
     */
    setFold(listId: string, nodeId: string, folded: boolean) {
        if (!nodeId) return;
        let m = this.pendingFold.get(listId);
        if (!m) {
            m = new Map();
            this.pendingFold.set(listId, m);
        }
        m.set(nodeId, folded);
        void this.writeFold(listId, nodeId, folded);
    }

    /** 写一次内核，并安排核对（核对失败会重试） */
    private async writeFold(listId: string, nodeId: string, folded: boolean) {
        const ok = await setOutlineFold(nodeId, folded);
        if (!ok) console.warn("[mindmap] 折叠写回失败", listId, nodeId, folded);
        this.scheduleFoldReconcile(listId);
    }

    /**
     * 等内核把 DOM 更新完，再比对覆盖表，把**已经兑现**的条目删掉。
     *
     * 核对的意义在于：覆盖表只该活在「写入在途」的那几百毫秒里。如果一直留着，
     * 它就从「补空窗」变成了「第二个真相源」—— 用户之后在大纲里折同一个节点，
     * 导图会因为表里那条旧记录而无动于衷。
     */
    private scheduleFoldReconcile(listId: string, tries = 0) {
        const prev = this.foldTimers.get(listId);
        if (prev) window.clearTimeout(prev);
        const timer = window.setTimeout(() => {
            this.foldTimers.delete(listId);
            this.reconcileFold(listId, tries);
        }, FOLD_SETTLE_MS);
        this.foldTimers.set(listId, timer);
    }

    /** 覆盖表的收尾：兑现的删掉、没兑现的再写一次、实在写不进去就认输 */
    private reconcileFold(listId: string, tries: number) {
        const m = this.pendingFold.get(listId);
        if (!m || m.size === 0) {
            this.pendingFold.delete(listId);
            return;
        }

        const list = document.querySelector<HTMLElement>(`.list[data-node-id="${listId}"]`);
        if (!list) {
            // 列表已经不在了（用户关掉导图 / 块被删）—— 覆盖表没有意义了
            this.pendingFold.delete(listId);
            return;
        }

        const retry: Array<[string, boolean]> = [];
        for (const [id, want] of Array.from(m)) {
            const li = list.querySelector<HTMLElement>(`.li[data-node-id="${id}"]`);
            if (!li) {
                m.delete(id); // 块没了（被删 / 被移出这个列表）
                continue;
            }
            if ((li.getAttribute("fold") === "1") === want) {
                m.delete(id); // 内核追上了，覆盖表可以退场
            } else {
                retry.push([id, want]);
            }
        }
        if (m.size === 0) {
            this.pendingFold.delete(listId);
            return;
        }

        if (tries >= FOLD_MAX_TRIES) {
            // 写不进去就别硬撑了 —— 松开覆盖表，让画面回到大纲的真实状态，
            // 免得导图显示一个连大纲都没有的折叠态，那才是真的骗人。
            console.warn("[mindmap] 折叠状态写入内核失败，已放弃", listId, Array.from(m));
            this.pendingFold.delete(listId);
            return;
        }

        for (const [id, want] of retry) void setOutlineFold(id, want);
        this.scheduleFoldReconcile(listId, tries + 1);
    }

    /* ================================================================ 变更侦测 */

    private onMutations(records: MutationRecord[]) {
        if (this.paused > 0) return;

        let dirty = false;
        for (const r of records) {
            const target = r.target as HTMLElement | null;
            if (!target || typeof target.closest !== "function") continue;
            // 忽略由导图自身 DOM 造成的变更
            if (target.closest(".mm-root")) continue;
            const wysiwyg = target.closest<HTMLElement>(".protyle-wysiwyg");
            if (!wysiwyg) continue;
            this.pending.add(wysiwyg);
            dirty = true;
        }
        if (!dirty) return;

        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
            this.timer = null;
            const targets = Array.from(this.pending);
            this.pending.clear();
            for (const w of targets) {
                if (w.isConnected) this.scan(w);
            }
        }, 160);
    }

    /** 暂停观察器，避免自己的 DOM 写入触发回环 */
    private pauseObserver(fn: () => void) {
        this.paused++;
        this.observer?.disconnect();
        try {
            fn();
        } finally {
            this.paused--;
            if (this.observer) {
                this.observer.takeRecords();
                this.observer.observe(document.body, OBSERVE_OPTS);
            }
        }
    }
}
