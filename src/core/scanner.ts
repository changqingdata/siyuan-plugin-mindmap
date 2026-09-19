import { showMessage } from "siyuan";
import { ATTR_FOLD, ATTR_VIEW, LAZY_FLAG, MOUNT_FLAG } from "../types";
import type { MMActionExtra, MMActionKind, MMConfig, MMLayout, MMNode, MMTheme } from "../types";
import { MindMapView } from "./renderer";
import { History } from "./history";
import { getBlockAttrs, getBlockKramdown, getDocTitle, restoreBlock, scrollToBlock, setBlockAttrs } from "../utils/api";
import {
    deleteNode,
    duplicateNode,
    indentNode,
    insertChildNode,
    insertSiblingNode,
    moveDownNode,
    moveNodeTo,
    moveUpNode,
    outdentNode,
    pasteNode,
    renameNode,
} from "./actions";

export interface ScannerHooks {
    getOptions: () => MMConfig;
    /** 布局切换后写回块属性 */
    onLayoutChange: (listId: string, layout: MMLayout) => void;
    /** 打开全屏查看 */
    onFullscreen: (listId: string, root: MMNode, theme: MMTheme, title: string) => void;
}

const SELECTOR = `.list[${ATTR_VIEW}]`;

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

/** 观察选项：内容变化 + 我们关心的那个属性变化 */
const OBSERVE_OPTS: MutationObserverInit = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [ATTR_VIEW],
};

/** 懒渲染提前量：元素进入视口外 320px 就开始渲染 */
const LAZY_MARGIN = "320px 0px";

/**
 * 变更侦测与视图挂载。
 *
 * 策略：导图容器挂在被标记的 .list 元素内部，原大纲通过 CSS 隐藏但保留在 DOM 中。
 * 这样 Protyle 重建块时导图会随之销毁，下一轮扫描再重新挂载，天然不会错位。
 */
export class Scanner {
    private views = new Map<string, MindMapView>();
    private foldSets = new Map<string, Set<string>>();
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
    private fullscreen: { listId: string; view: MindMapView } | null = null;
    /**
     * 全屏视图自己的签名槽位。
     *
     * 不能和行内视图共用 signatures —— 它们盯着的是同一个源列表，
     * 行内视图先比对并写回签名后，全屏这边再比就永远等于「没变」。
     */
    private fsSignature = "";

    private observer: MutationObserver | null = null;
    private io: IntersectionObserver | null = null;
    private pending = new Set<HTMLElement>();
    private timer: number | null = null;
    private persistTimers = new Map<string, number>();
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
        for (const t of this.persistTimers.values()) window.clearTimeout(t);
        this.persistTimers.clear();
        for (const view of this.views.values()) view.destroy();
        this.views.clear();
        this.foldSets.clear();
        this.suppressed.clear();
        this.signatures.clear();
        this.mounting.clear();
        this.visible.clear();
        this.forced.clear();
        for (const box of this.notices.values()) box.remove();
        this.notices.clear();
        this.fullscreen = null;
        this.fsSignature = "";
        this.history.clear();
    }

    /** 设置变化后刷新全部视图 */
    refreshAll() {
        const opts = this.hooks.getOptions();
        for (const view of this.views.values()) view.setOptions(opts);
        this.fullscreen?.view.setOptions(opts);
    }

    /** 登记全屏弹层里的视图，让它和行内视图一样跟着源列表刷新 */
    attachFullscreen(listId: string, view: MindMapView) {
        this.fullscreen = { listId, view };
        this.fsSignature = this.signature(view.source);
    }

    detachFullscreen(view: MindMapView) {
        if (this.fullscreen?.view === view) {
            this.fullscreen = null;
            this.fsSignature = "";
        }
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
        this.foldSets.delete(listId);
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

        /* 2b. 全屏弹层里的视图不在 .protyle-wysiwyg 里，得单独照看 */
        const fs = this.fullscreen;
        if (fs) {
            // 每次都重新查当前的源列表元素。结构操作（尤其 moveBlock）之后
            // Protyle 会把整个 `.list` 重建，视图握着的旧引用会变成游离节点 ——
            // 那样 signature 永远读到旧内容，于是永远判成「没变」、永远不重渲染。
            // 实测就是这个原因导致「全屏里 Shift+Tab 之后画面一动不动」。
            const src = document.querySelector<HTMLElement>(`.list[data-node-id="${fs.listId}"]`);
            if (!src || !fs.view.element.isConnected) {
                this.fullscreen = null;
                this.fsSignature = "";
            } else {
                fs.view.setSource(src);
                const sig = this.signature(src);
                if (sig !== this.fsSignature) {
                    this.fsSignature = sig;
                    fs.view.render();
                }
            }
        }

        /* 3. 清理已消失的「节点过多」提示 */
        for (const [id, box] of Array.from(this.notices)) {
            if (!box.isConnected) {
                this.notices.delete(id);
                this.forced.delete(id);
            }
        }
    }

    private prune() {
        for (const [id, view] of Array.from(this.views)) {
            if (!view.element.isConnected) {
                this.views.delete(id);
                this.foldSets.delete(id);
                this.signatures.delete(id);
            }
        }
    }

    /** 源列表的纯文本签名，忽略导图自身 DOM */
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

            // 折叠状态先读块属性，再创建视图
            const foldSet = new Set<string>();
            if (opts.persistFold) {
                const attrs = await getBlockAttrs(id);
                const raw = attrs[ATTR_FOLD];
                if (raw) raw.split(",").forEach((v) => v && foldSet.add(v));
            }
            this.foldSets.set(id, foldSet);

            // 异步等待期间块可能已经被替换
            if (!list.isConnected || this.views.has(id)) return;

            const title = getDocTitle(list);
            const view = new MindMapView(
                list,
                opts,
                foldSet,
                {
                    onFoldChange: (nodeId, folded) => this.updateFold(id, nodeId, folded),
                    onLocate: (nodeId) => this.locate(id, nodeId),
                    onExit: () => this.exitView(id),
                    onLayoutChange: (layout) => this.hooks.onLayoutChange(id, layout),
                    onFullscreen: (root, theme) => this.hooks.onFullscreen(id, root, theme, title),
                    onRename: (node, text) => void this.applyRename(node, text, id),
                    onNodeAction: (kind, node, extra) => void this.applyAction(kind, node, extra, id),
                    onHistory: (redo) => this.undo(redo),
                },
                title,
            );

            this.pauseObserver(() => {
                view.mount();
                list.setAttribute(MOUNT_FLAG, "1");
            });
            this.views.set(id, view);
            this.signatures.set(id, this.signature(list));
            this.clearNotice(id);
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

    /** 结构操作（全屏视图也会调用） */
    async applyAction(kind: MMActionKind, node: MMNode, extra?: MMActionExtra, listId = "") {
        this.lastUserActionAt = Date.now();
        const before = await this.snapshot(listId);
        let ok = false;
        switch (kind) {
            case "insertChild":
                ok = await insertChildNode(node);
                break;
            case "insertSiblingBefore":
                ok = await insertSiblingNode(node, "before");
                break;
            case "insertSiblingAfter":
                ok = await insertSiblingNode(node, "after");
                break;
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
            case "duplicate":
                ok = await duplicateNode(node);
                break;
            case "paste":
                if (extra?.data) ok = await pasteNode(node, extra.data);
                break;
            default:
                return;
        }

        if (!ok) {
            showMessage("操作未生效，请重试", 3000, "error");
            return;
        }
        this.record(listId, ACTION_LABEL[kind] ?? "操作", before, await this.snapshot(listId));
        this.rescanSoon();
        // 结构操作必然重建 `.list`，焦点一定会掉；接回来用户才能接着用键盘
        // （尤其「删除 → Ctrl+Z」这条链路，第二步靠的就是焦点还在导图上）
        this.focusSoon(listId);
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
        this.unmount(listId);
        void setBlockAttrs(listId, { [ATTR_VIEW]: null });
    }

    private locate(listId: string, nodeId: string) {
        // 目标块在导图模式下被隐藏，先退出视图再滚动定位
        this.exitView(listId);
        window.setTimeout(() => scrollToBlock(nodeId), 80);
    }

    /** 取某个列表块的折叠状态集合（全屏视图复用） */
    getFoldSet(listId: string): Set<string> {
        let set = this.foldSets.get(listId);
        if (!set) {
            set = new Set<string>();
            this.foldSets.set(listId, set);
        }
        return set;
    }

    /** 供外部（全屏视图）更新折叠状态 */
    setFold(listId: string, nodeId: string, folded: boolean) {
        this.updateFold(listId, nodeId, folded);
    }

    private updateFold(listId: string, nodeId: string, folded: boolean) {
        const set = this.foldSets.get(listId);
        if (!set) return;
        if (folded) set.add(nodeId);
        else set.delete(nodeId);

        if (!this.hooks.getOptions().persistFold) return;

        const prev = this.persistTimers.get(listId);
        if (prev) window.clearTimeout(prev);
        const timer = window.setTimeout(() => {
            this.persistTimers.delete(listId);
            const value = Array.from(set).join(",");
            void setBlockAttrs(listId, { [ATTR_FOLD]: value || null });
        }, 600);
        this.persistTimers.set(listId, timer);
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
