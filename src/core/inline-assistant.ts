import type { MMNode } from "../types";
import { searchRefBlocks, uploadAsset } from "../utils/api";
import type { MMRefHit } from "../utils/api";
import { caretAfterNode, isBlankText, stripZeroWidth } from "../utils/caret";

/**
 * 画布内的行内输入辅助 —— 让导图节点上也能做大纲里那些事。
 *
 * ## 为什么是自建，而不是复用思源自己的 hint / toolbar
 *
 * 实测（思源 3.8.5，详见 siyuan-plugin-dev skill 的对应章节）：
 *
 *   · `protyle.toolbar.render(protyle, range)` **能**在自绘编辑框上把原生工具条画出来；
 *   · 但点它上面的按钮**只改 DOM、不落内核** —— 因为宿主把写回交给了 Protyle 的
 *     input 链路，而那条链路被本插件刻意掐断了（防「正文被渲染结果覆盖」的红线）；
 *   · 点「链接」按钮更严重：**页面直接冻死**（页内 50ms 心跳计时器 30 秒一次没推进）。
 *
 * 所以结论是「宿主 UI 能借、写回必须自己接管」，而既然写回要自己写，
 * 那 UI 也一并自建更可控（不跟宿主私有结构耦合，思源升级不会碎）。
 *
 * ## 四条纪律（都是项目里踩过的）
 *
 * 1. **浮层挂在 `.mm-root` 里，且必须是 `position: absolute` 的浮层。**
 *    挂 `.mm-root` 是为了继承 `--mm-*` / `--c-*` 主题变量；
 *    不进流是为了不推动画布 —— 项目里「批量操作条一出现就把画布推下去 40px、
 *    导致 Ctrl+双击下钻整条链路失效」就是进流造成的。
 * 2. **浮层里的输入框，其 `input` 事件靠 `.mm-root` 那道冒泡拦截挡住**（见 renderer 的守卫），
 *    但 `keydown` **必须自己拦**（那道守卫刻意不拦 keydown，否则思源全局快捷键会失效）——
 *    所以这里只对自己处理的键 `stopPropagation`，其它键放行。
 * 3. **工具条按钮的 `mousedown` 要 `preventDefault()`**，否则焦点离开 `.mm-txt`
 *    会触发失焦提交，编辑态当场结束（实测点宿主工具条就是这个下场）。
 * 4. **需要弹系统对话框的动作（选图片）必须做成浮层里的表单**，不能用一个隐藏的
 *    `input[type=file]` 挂在 body 上直接 `click()` —— 那样焦点会离开编辑上下文，
 *    而系统对话框还没关，编辑态就先被失焦提交结束了（用户选完图回来发现节点已经退出编辑）。
 */

/** 行内标记：`data-type` → 按钮字形 → 取词键 */
const MARKS: Array<{ type: string; glyph: string; key: string; fallback: string }> = [
    { type: "strong", glyph: "B", key: "mark.strong", fallback: "加粗" },
    { type: "em", glyph: "I", key: "mark.em", fallback: "斜体" },
    { type: "u", glyph: "U", key: "mark.u", fallback: "下划线" },
    { type: "s", glyph: "S", key: "mark.s", fallback: "删除线" },
    { type: "mark", glyph: "◐", key: "mark.mark", fallback: "高亮" },
    { type: "code", glyph: "‹›", key: "mark.code", fallback: "行内代码" },
];

type SlashKind = "image" | "link" | "ref" | "tag" | "math" | "mark" | "code" | "clear";

const SLASH_ITEMS: Array<{ kind: SlashKind; label: string; fallback: string; hint: string }> = [
    { kind: "image", label: "slash.image", fallback: "图片", hint: "PNG / JPG / GIF / SVG" },
    { kind: "link", label: "slash.link", fallback: "超链接", hint: "https://" },
    { kind: "ref", label: "slash.ref", fallback: "块引用（双链）", hint: "[[" },
    { kind: "tag", label: "slash.tag", fallback: "标签", hint: "#标签#" },
    { kind: "math", label: "slash.math", fallback: "行内公式", hint: "$…$" },
    { kind: "mark", label: "slash.highlight", fallback: "高亮", hint: "==" },
    { kind: "code", label: "slash.inlineCode", fallback: "行内代码", hint: "``" },
    { kind: "clear", label: "slash.clear", fallback: "清除格式", hint: "" },
];

/** 逐键搜会把内核打满、结果也会闪，所以防抖一下 */
const SEARCH_DEBOUNCE = 180;
/** 最多显示多少条候选 */
const REF_LIMIT = 30;

export interface InlineAssistantOptions {
    /** 正在编辑的 `.mm-txt` */
    txt: HTMLElement;
    /** 浮层容器（`.mm-root`，`position: relative`） */
    layer: HTMLElement;
    /** 当前节点 */
    node: MMNode;
    /** 文档根块 ID（块引用搜索的 `rootID`） */
    rootId: () => string;
    /** 取词 */
    t: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
    /** 提示（复用宿主的消息条） */
    notify: (text: string) => void;
    /** 内容变化（外部据此同步节点尺寸） */
    onInput?: () => void;
}

/* ---------------------------------------------------------------- 纯函数工具 */

/**
 * 选区所在的文本节点里，光标之前的纯文本。
 *
 * ⚠️ **必须先剥掉零宽字符**：`caretToEnd()` 会往末尾补一个零宽空格当光标垫片
 * （原因见 `utils/caret.ts`），于是「节点末尾」这个位置的 `before` 会以
 * `\u200B` 开头 —— 而 `/` 的触发判据是「行首，或前一字符是空白」，
 * 零宽空格既不是空白也不是行首，会让**含格式节点的斜杠菜单整个失灵**。
 *
 * 剥掉之后长度也仍然对得上：触发串（`/词`、`[[词`）永远在节点**末尾**，
 * 倒着数回去时那个垫片不在计数范围内。
 */
function textBeforeCaret(range: Range): string {
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return "";
    return stripZeroWidth((node.textContent ?? "").slice(0, range.startOffset));
}

/** 把选区内容包成一个 `data-type` span；跨节点选区也能处理 */
function wrapRange(range: Range, type: string): HTMLElement | null {
    const span = document.createElement("span");
    span.setAttribute("data-type", type);
    try {
        range.surroundContents(span);
    } catch {
        // 选区跨了多个节点时 surroundContents 会抛，改用 extract + append
        try {
            const frag = range.extractContents();
            span.appendChild(frag);
            range.insertNode(span);
        } catch {
            return null;
        }
    }
    return span;
}

/** 拆掉一个行内标记 span，保留里面的内容 */
function unwrapEl(el: HTMLElement) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
}

/** 从某个节点往上找最近的、且不越过 boundary 的指定 `data-type` 元素 */
function closestMark(start: Node | null, type: string, boundary: HTMLElement): HTMLElement | null {
    let el: Node | null = start;
    while (el && el !== boundary) {
        if (el instanceof HTMLElement && el.dataset.type === type) return el;
        el = el.parentNode;
    }
    return null;
}

function escAttr(s: string): string {
    return s.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

function escText(s: string): string {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

/* ---------------------------------------------------------------- 主体 */

export class InlineAssistant {
    private readonly o: InlineAssistantOptions;
    private readonly txt: HTMLElement;
    private readonly layer: HTMLElement;

    /** 当前打开的浮层（同时只允许一个） */
    private pop: HTMLElement | null = null;
    private popKind: "slash" | "ref" | "toolbar" | "form" | null = null;
    /** 浮层里可键盘选择的项（**只含当前可见的**，见 filterSlash） */
    private popItems: HTMLElement[] = [];
    private popIndex = 0;
    /**
     * 这一次定位用的锚点（**视口坐标**，不是 `.mm-root` 坐标）。
     *
     * 留着它是为了「尺寸变了能重算」：浮层是**先矮后高**的 ——
     * 刚建出来只有一个输入框，等候选填进来会长到三百多像素。
     * 只记锚点、不记算完的 `left/top`，是因为钳制要用**当前**尺寸，
     * 而当前尺寸在尺寸变化前根本算不出来。
     */
    private anchor: { x: number; top: number; bottom: number; preferAbove: boolean } | null = null;
    /**
     * 斜杠菜单的全部候选项（含被关键词过滤掉的）。
     *
     * 与 `popItems` 分开是**必须的**：`popItems` 是「键盘能选到的那些」，
     * 过滤之后必须只剩可见项。曾经两者是同一个数组，于是「打 `/链接` 过滤出一条、
     * 回车」会点到**隐藏着的第一个候选（图片）** —— 弹出图片选择框，而且看起来
     * 像「菜单认错了关键词」。可见性与可选性必须是同一个集合。
     */
    private slashRows: HTMLElement[] = [];

    /**
     * 触发串（`/` 或 `[[`）在编辑框里的范围。
     *
     * ⚠️ 它的生命周期必须**跨过 `closePop()`** —— 从斜杠菜单切到块引用搜索时，
     * 就是「先关旧浮层、再开新浮层」，而插入那一刻要删掉的仍然是这一段。
     * 第一版把赋值写在 `closePop()` 之前，于是每次都被清成 null，
     * 结果是「插入的内容追加在 `/图片` 后面」而不是替换它。
     */
    private triggerRange: Range | null = null;

    private searchTimer = 0;
    /** 最近一次搜索的序号，用来丢弃过期响应 */
    private searchSeq = 0;
    /**
     * 从工具条按 `[[` 时，用户**选中的那段文字** —— 它要当锚文本用。
     *
     * 没有它的话，「选中一段字 → 点块引用 → 挑目标块」会得到锚文本是目标块文字的引用，
     * 用户选的那段字则被丢掉（或更糟：留在原地，和引用并排）。
     * 思源自己的行为就是「用选中的文字当锚文本」。
     */
    private refAnchorText = "";
    private destroyed = false;

    constructor(opts: InlineAssistantOptions) {
        this.o = opts;
        this.txt = opts.txt;
        this.layer = opts.layer;
    }

    /* ------------------------------------------------------------ 生命周期 */

    destroy() {
        this.destroyed = true;
        if (this.searchTimer) window.clearTimeout(this.searchTimer);
        this.searchTimer = 0;
        this.closePop();
    }

    /**
     * 浮层里有没有焦点。
     *
     * 编辑态的失焦守卫要问这个 —— 打开块引用搜索时焦点会移到浮层的输入框，
     * 若守卫只看「焦点在不在节点里」，编辑态会当场结束（实测点宿主双链按钮就是这个下场）。
     */
    ownsFocus(el: Element | null): boolean {
        return !!el && !!this.pop && this.pop.contains(el);
    }

    /** 当前有没有打开浮层（Esc 要逐级退出） */
    get hasPop(): boolean {
        return !!this.pop;
    }

    /* ------------------------------------------------------------ 键盘 */

    /**
     * 先于编辑态处理按键。返回 true 表示已消费。
     *
     * ⚠️ 只对自己处理的键 `stopPropagation`：那道「不许冒泡给宿主」的守卫**刻意不拦
     * keydown**（拦了会让 Ctrl+S 这类思源全局快捷键在导图有焦点时失效），
     * 所以这里必须自己挑着拦 —— 无差别拦掉整个 keydown 是另一个极端。
     */
    handleKey(e: KeyboardEvent): boolean {
        if (!this.pop) return false;

        // Esc 逐级退出：先关浮层，再（下一次）才轮到退出编辑态
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            this.closePop();
            return true;
        }
        // 工具条上没有可选项，按键一律放行给编辑态
        if (this.popKind === "toolbar") return false;

        const n = this.popItems.length;
        if (n > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            e.stopPropagation();
            this.popIndex = (this.popIndex + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
            this.paintItems();
            return true;
        }
        if (e.key === "Enter") {
            const item = this.popItems[this.popIndex];
            if (item) {
                e.preventDefault();
                e.stopPropagation();
                item.click();
                return true;
            }
        }
        return false;
    }

    /* ------------------------------------------------------------ 输入 / 选区 */

    /**
     * 编辑框内容变了。
     *
     * 两个触发串：
     *   `/`   —— 词首或行首，开斜杠菜单（后面的字是过滤词）
     *   `[[`  —— 开块引用搜索（后面的字是关键词）
     *
     * ⚠️ 判「词首」不能只看前一个字符是不是空白 —— 中文输入法下用户往往
     * 直接敲 `/`，前面什么都没有。所以「行首 或 前一字符是空白」都算。
     */
    onInput() {
        if (this.destroyed) return;
        this.o.onInput?.();

        const range = this.caretRange();
        if (!range) {
            this.closePop();
            return;
        }
        const before = textBeforeCaret(range);

        // `[[` 优先：它以 `[` 开头，与 `/` 不冲突，但两者都在时取更靠后的那个
        const refIdx = before.lastIndexOf("[[");
        const slashIdx = before.lastIndexOf("/");

        if (refIdx >= 0 && refIdx > slashIdx) {
            const query = before.slice(refIdx + 2);
            // 关键词里出现空白或 `]` 就说明用户不是在建双链了
            if (!/[\s\]]/.test(query)) {
                this.openRefPop(before.length - refIdx, query);
                return;
            }
        }
        if (slashIdx >= 0) {
            const query = before.slice(slashIdx + 1);
            const atWordStart = slashIdx === 0 || /\s/.test(before[slashIdx - 1]);
            if (atWordStart && !/\s/.test(query)) {
                this.openSlashPop(before.length - slashIdx, query);
                return;
            }
        }
        this.closePop();
    }

    /** 选区变了 —— 只在「选中了真字符」时给工具条 */
    onSelection() {
        if (this.destroyed) return;
        // 菜单 / 搜索 / 表单开着的时候不要去抢，否则一选词就把浮层换掉了
        if (this.popKind === "slash" || this.popKind === "ref" || this.popKind === "form") return;

        const range = this.caretRange();
        // 只选中了光标垫片（零宽空格）不算「选中了真字符」，否则末尾一点就弹工具条
        if (!range || range.collapsed || isBlankText(range.toString())) {
            if (this.popKind === "toolbar") this.closePop();
            return;
        }
        this.openToolbar(range);
    }

    /**
     * 粘贴。
     *
     * 图片走上传（返回 true 表示已消费）；其它一律**降级成纯文本** ——
     * 从网页粘过来的富文本结构（表格 / 嵌套 div / 内联样式）进了节点只有破坏性，
     * 而且会被清洗层脱壳得七零八落，不如一开始就说清楚「这里只收文字」。
     */
    onPaste(e: ClipboardEvent): boolean {
        const image = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
        if (!image) return false;
        e.preventDefault();
        void this.insertImage(image);
        return true;
    }

    /* ------------------------------------------------------------ 斜杠菜单 */

    private openSlashPop(backChars: number, query: string) {
        const caret = this.caretRange();
        if (!caret) return;

        if (this.popKind !== "slash") {
            this.closePop();
            this.popKind = "slash";
            this.buildSlashPop();
        }
        // ⚠️ 赋值必须在 `closePop()` 之后（见 triggerRange 的注释）
        this.triggerRange = this.makeRange(caret, backChars);
        this.filterSlash(query);
        this.placeAtCaret(caret);
    }

    private buildSlashPop() {
        const pop = this.mkPop("mm-slash");
        this.pop = pop;

        const cap = document.createElement("div");
        cap.className = "mm-slash-cap";
        cap.textContent = this.o.t("slash.caption", "插入");
        pop.appendChild(cap);

        const list = document.createElement("div");
        list.className = "mm-slash-list";
        pop.appendChild(list);

        for (const item of SLASH_ITEMS) {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "mm-slash-item";
            row.dataset.label = this.o.t(item.label, item.fallback).toLowerCase();
            row.dataset.fallback = item.fallback.toLowerCase();

            const name = document.createElement("span");
            name.className = "mm-slash-name";
            name.textContent = this.o.t(item.label, item.fallback);
            row.appendChild(name);

            if (item.hint) {
                const hint = document.createElement("span");
                hint.className = "mm-slash-hint";
                hint.textContent = item.hint;
                row.appendChild(hint);
            }
            row.onmousedown = (ev) => ev.preventDefault();
            row.onclick = (ev) => {
                ev.stopPropagation();
                this.runSlash(item.kind);
            };
            list.appendChild(row);
        }

        this.slashRows = Array.from(list.children) as HTMLElement[];
        this.popItems = this.slashRows.slice();
        this.popIndex = 0;
    }

    /**
     * 按关键词过滤（英文名与中文 fallback 都参与匹配）。
     *
     * ⚠️ 过滤之后必须把 `popItems` 同步成**只剩可见的那些** ——
     * 否则键盘的 ↑↓ / Enter 会落到隐藏项上（见 `slashRows` 的注释）。
     */
    private filterSlash(query: string) {
        const q = query.trim().toLowerCase();
        const visible = this.slashRows.filter(
            (row) => !q || (row.dataset.label ?? "").includes(q) || (row.dataset.fallback ?? "").includes(q),
        );
        const shown = new Set(visible);
        for (const row of this.slashRows) row.style.display = shown.has(row) ? "" : "none";
        this.popItems = visible;
        this.popIndex = visible.length > 0 ? 0 : -1;
        this.paintItems();
        if (visible.length === 0) this.closePop();
    }

    private runSlash(kind: SlashKind) {
        switch (kind) {
            case "image":
                this.openImageForm();
                return;
            case "ref": {
                // 把 `/词` 换成 `[[`，再走同一条搜索链路 —— 两个入口一套实现
                this.replaceTriggerText("[[");
                this.openRefPop(2, "");
                return;
            }
            case "link":
                this.openForm("link", this.o.t("form.linkTitle", "超链接"), [
                    { key: "href", label: this.o.t("form.linkHref", "地址"), placeholder: "https://", value: "" },
                    { key: "text", label: this.o.t("form.linkText", "文字"), placeholder: this.o.t("form.optional", "留空则显示地址"), value: this.selectedText() },
                ]);
                return;
            case "tag":
                this.openForm("tag", this.o.t("form.tagTitle", "标签"), [
                    // placeholder 复用 `form.tagTitle` —— 它要显示的就是「标签」这两个字，
                    // 另起一个键只会多一份需要同步维护的同义文案
                    { key: "tag", label: this.o.t("form.tagName", "标签名"), placeholder: this.o.t("form.tagTitle", "标签"), value: this.selectedText() },
                ]);
                return;
            case "math":
                this.openForm("math", this.o.t("form.mathTitle", "行内公式"), [
                    { key: "tex", label: this.o.t("form.mathSrc", "公式"), placeholder: "E = mc^2", value: "" },
                ]);
                return;
            case "mark":
                this.applyMarkAtCaret("mark");
                this.closePop();
                return;
            case "code":
                this.applyMarkAtCaret("code");
                this.closePop();
                return;
            case "clear":
                this.clearFormatAtCaret();
                return;
        }
    }

    /* ------------------------------------------------------------ 块引用搜索 */

    /**
     * 打开块引用搜索。
     *
     * @param backChars 触发串长度（`[[` 是 2）。从工具条进来时给 0 —— 那时没有触发串
     * @param query 初始关键词
     * @param presetRange 直接用这个范围当「插入点」，不按光标重算。
     *   工具条路径要在**选中文字**上插入（选中那段字当锚文本），所以不能按光标算
     */
    private openRefPop(backChars: number, query: string, presetRange?: Range | null) {
        const caret = this.caretRange();
        if (!caret && !presetRange) return;

        if (this.popKind !== "ref") {
            this.closePop();
            this.popKind = "ref";
            this.buildRefPop(query);
        }
        // 从**当前光标**重算范围是默认路径，所以不需要让旧触发串跨过 closePop：
        // 「斜杠菜单切块引用」那条路径已经先把 `/词` 换成了 `[[`，光标就在 `[[` 之后。
        this.triggerRange = presetRange ?? (caret ? this.makeRange(caret, backChars) : null);

        /**
         * ⚠️ 定位必须在这里做，而且要用**进函数时抓到的那个 `caret`**。
         *
         * 两个坑叠在一起，第一版整个漏了这一步，浮层于是停在「静态位置」——
         * 绝对定位元素不设 `left`/`top` 时，浏览器把它摆在**包含块内容盒的左上角**，
         * 也就是 `.mm-root` 的左上角（用户看到的就是「搜索框跑到画布左上角了」）。
         *
         *   1. `buildRefPop` 收尾会把焦点移进浮层的输入框，**之后**
         *      `this.caretRange()` 一律返回 `null`（选区已经不在 `.mm-txt` 里了）；
         *   2. 而 `openRefPop` 在浮层建好之后会被**再次**调用（继续打关键词时），
         *      那一次 `caret` 就是 `null`，会直接 `return` —— 指望后面某次调用补上定位
         *      是等不到的。
         *
         * `presetRange`（工具条路径）也是有效锚点：它就是用户选中的那段文字。
         */
        this.placeAtCaret(caret ?? presetRange ?? this.triggerRange);
        this.scheduleSearch(query);
    }

    private buildRefPop(query: string) {
        const pop = this.mkPop("mm-ref");
        this.pop = pop;

        const input = document.createElement("input");
        input.className = "mm-ref-input";
        input.type = "text";
        input.setAttribute("spellcheck", "false");
        input.placeholder = this.o.t("ref.placeholder", "搜索块…");
        input.value = query;
        input.oninput = () => this.scheduleSearch(input.value);
        /**
         * ⚠️ 方向键 / Enter / Esc 必须在这里自己接。
         *
         * 编辑态那套按键处理挂在 `.mm-txt` 上，而**焦点此时在浮层的输入框里** ——
         * 事件根本到不了 `.mm-txt`。第一版就是这么漏的：列表能搜出来，
         * 但按 ↓ 不动、按 Enter 没反应，只能拿鼠标点。
         */
        input.onkeydown = (ev) => {
            if (ev.key === "Escape") {
                ev.preventDefault();
                ev.stopPropagation();
                this.closePop();
                this.focusBack();
                return;
            }
            const n = this.popItems.length;
            if (n > 0 && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
                ev.preventDefault();
                ev.stopPropagation();
                this.popIndex = (this.popIndex + (ev.key === "ArrowDown" ? 1 : n - 1)) % n;
                this.paintItems();
                return;
            }
            if (ev.key === "Enter") {
                const item = this.popItems[this.popIndex];
                if (item) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    item.click();
                }
            }
        };
        pop.appendChild(input);

        const list = document.createElement("div");
        list.className = "mm-ref-list";
        pop.appendChild(list);

        const foot = document.createElement("div");
        foot.className = "mm-ref-foot";
        foot.textContent = this.o.t("ref.foot", "↑↓ 选择 · Enter 插入 · Esc 关闭");
        pop.appendChild(foot);

        // 输入框聚焦会让 .mm-txt 失焦 —— 编辑态的失焦守卫认得这个浮层（见 ownsFocus）
        input.focus();
        input.setSelectionRange(query.length, query.length);
    }

    private scheduleSearch(query: string) {
        if (this.searchTimer) window.clearTimeout(this.searchTimer);
        const seq = ++this.searchSeq;
        const list = this.pop?.querySelector<HTMLElement>(".mm-ref-list");
        if (list) {
            list.innerHTML = "";
            const loading = document.createElement("div");
            loading.className = "mm-ref-empty";
            loading.textContent = this.o.t("ref.searching", "搜索中…");
            list.appendChild(loading);
        }
        // 「搜索中…」占位同样会改高度（30 条候选 → 1 行），得跟着重算
        this.reposition();
        this.searchTimer = window.setTimeout(() => {
            this.searchTimer = 0;
            void this.runSearch(query, seq);
        }, SEARCH_DEBOUNCE);
    }

    private async runSearch(query: string, seq: number) {
        const hits = await searchRefBlocks(query, this.o.rootId(), 0);
        // 丢弃过期响应：用户可能已经又敲了两个字
        if (seq !== this.searchSeq || this.destroyed || this.popKind !== "ref") return;
        const list = this.pop?.querySelector<HTMLElement>(".mm-ref-list");
        if (!list) return;

        list.innerHTML = "";
        if (hits.length === 0) {
            const empty = document.createElement("div");
            empty.className = "mm-ref-empty";
            empty.textContent = this.o.t("ref.empty", "没有匹配的块");
            list.appendChild(empty);
            this.popItems = [];
            this.popIndex = -1;
            // 空态比候选态矮得多：不重算的话，浮层会「悬在」一个旧位置上
            this.reposition();
            return;
        }

        for (const hit of hits.slice(0, REF_LIMIT)) {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "mm-ref-item";

            const text = document.createElement("span");
            text.className = "mm-ref-text";
            text.textContent = hit.refText || hit.id;
            row.appendChild(text);

            if (hit.docTitle) {
                const doc = document.createElement("span");
                doc.className = "mm-ref-doc";
                doc.textContent = hit.docTitle;
                row.appendChild(doc);
            }
            row.onmousedown = (ev) => ev.preventDefault();
            row.onclick = (ev) => {
                ev.stopPropagation();
                this.insertRef(hit);
            };
            list.appendChild(row);
        }
        this.popItems = Array.from(list.children) as HTMLElement[];
        this.popIndex = 0;
        this.paintItems();
    }

    private insertRef(hit: MMRefHit) {
        // 锚文本优先用「用户选中的那段字」（从工具条进来的路径），否则用目标块的文字
        const anchor = this.refAnchorText || hit.refText || hit.id;
        const html = `<span data-type="block-ref" data-id="${escAttr(hit.id)}" data-subtype="s">${escText(anchor)}</span>`;
        const range = this.takeTrigger();
        this.closePop();
        this.focusBack();
        if (range) this.replaceRange(range, html);
        else this.insertAtCaret(html);
        this.o.onInput?.();
    }

    /* ------------------------------------------------------------ 表单浮层 */

    private openForm(kind: "link" | "tag" | "math", title: string, fields: Array<{ key: string; label: string; placeholder: string; value: string }>) {
        // 从工具条进来的没有触发串 —— 那就以当前选区为插入点
        const fallback = this.triggerRange?.cloneRange() ?? this.caretRange()?.cloneRange() ?? null;
        this.closePop();
        this.popKind = "form";
        this.triggerRange = fallback;

        const pop = this.mkPop("mm-form");
        this.pop = pop;

        const cap = document.createElement("div");
        cap.className = "mm-slash-cap";
        cap.textContent = title;
        pop.appendChild(cap);

        const inputs: Record<string, HTMLInputElement> = {};
        for (const f of fields) {
            const row = document.createElement("div");
            row.className = "mm-form-row";
            const label = document.createElement("span");
            label.className = "mm-form-cap";
            label.textContent = f.label;
            const input = document.createElement("input");
            input.className = "mm-form-input";
            input.type = "text";
            input.setAttribute("spellcheck", "false");
            input.placeholder = f.placeholder;
            input.value = f.value;
            row.append(label, input);
            pop.appendChild(row);
            inputs[f.key] = input;
        }

        const actions = document.createElement("div");
        actions.className = "mm-form-actions";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "mm-form-ok";
        ok.textContent = this.o.t("form.confirm", "插入");
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "mm-form-cancel";
        cancel.textContent = this.o.t("form.cancel", "取消");
        actions.append(ok, cancel);
        pop.appendChild(actions);

        const submit = () => {
            const v = (k: string) => inputs[k]?.value.trim() ?? "";
            let html = "";
            if (kind === "link") {
                const href = v("href");
                if (!href) return;
                html = `<span data-type="a" data-href="${escAttr(href)}">${escText(v("text") || href)}</span>`;
            } else if (kind === "tag") {
                const tag = v("tag").replace(/^#+|#+$/g, "");
                if (!tag) return;
                // ⚠️ 里面**不能**带井号。实测（思源 3.8.6）：写 `<span data-type="tag">#甲#</span>`
                // 会落成 kramdown `##甲##`（多一对井号）；写不带井号的则落成 `#甲#`。
                // 用户笔记里真实标签的 DOM 也正是 `<span data-type="tag">概念/交易成本</span>` ——
                // 那对 `#` 是 lute 序列化时补的，不是内容的一部分。
                html = `<span data-type="tag">${escText(tag)}</span>`;
            } else {
                const tex = v("tex");
                if (!tex) return;
                html = `<span data-type="inline-math" data-subtype="math" data-content="${escAttr(tex)}"></span>`;
            }
            const range = this.takeTrigger();
            this.closePop();
            this.focusBack();
            if (range) this.replaceRange(range, html);
            else this.insertAtCaret(html);
            this.o.onInput?.();
        };

        ok.onmousedown = (ev) => ev.preventDefault();
        ok.onclick = (ev) => {
            ev.stopPropagation();
            submit();
        };
        cancel.onmousedown = (ev) => ev.preventDefault();
        cancel.onclick = (ev) => {
            ev.stopPropagation();
            this.closePop();
            this.focusBack();
        };
        for (const input of Object.values(inputs)) {
            input.onkeydown = (ev) => {
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    submit();
                } else if (ev.key === "Escape") {
                    // ⚠️ 浮层里的 Esc 必须自己接：`.mm-txt` 的 keydown 处理器收不到
                    // 焦点在浮层输入框里的按键，而全局守卫**刻意不拦 keydown**，
                    // 不接的话这一下会冒泡出去、被宿主的全局快捷键吃掉。
                    ev.preventDefault();
                    ev.stopPropagation();
                    this.closePop();
                    this.focusBack();
                }
            };
        }

        const first = Object.values(inputs)[0];
        this.placeAtCaret(this.caretRange());
        first?.focus();
        first?.select();
    }

    /**
     * 图片：做成浮层里的表单，**不用隐藏的 `input[type=file]`**。
     *
     * 隐藏 input 挂在 body 上直接 `click()` 会让焦点离开编辑上下文 ——
     * 而系统文件对话框还没关，编辑态就先被失焦提交结束了。
     * 放进浮层里则焦点始终在 `this.pop` 内，`ownsFocus` 认得，编辑态不会被踢掉。
     */
    private openImageForm() {
        const fallback = this.triggerRange?.cloneRange() ?? null;
        this.closePop();
        this.popKind = "form";
        this.triggerRange = fallback;

        const pop = this.mkPop("mm-form");
        this.pop = pop;

        const cap = document.createElement("div");
        cap.className = "mm-slash-cap";
        cap.textContent = this.o.t("form.imageTitle", "插入图片");
        pop.appendChild(cap);

        const row = document.createElement("div");
        row.className = "mm-form-row";
        const picker = document.createElement("input");
        picker.type = "file";
        picker.accept = "image/*";
        picker.className = "mm-form-file";
        row.appendChild(picker);
        pop.appendChild(row);

        const actions = document.createElement("div");
        actions.className = "mm-form-actions";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "mm-form-ok";
        ok.textContent = this.o.t("form.confirm", "插入");
        ok.disabled = true;
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "mm-form-cancel";
        cancel.textContent = this.o.t("form.cancel", "取消");
        actions.append(ok, cancel);
        pop.appendChild(actions);

        picker.onchange = () => {
            ok.disabled = !picker.files?.length;
        };
        ok.onmousedown = (ev) => ev.preventDefault();
        ok.onclick = (ev) => {
            ev.stopPropagation();
            const file = picker.files?.[0];
            if (!file) return;
            /**
             * ⚠️ 触发串范围必须在 `closePop()` **之前**取出来 —— `closePop()` 会把它清掉，
             * 晚一步就变成「图片插进去了、`/图片` 三个字还留在节点里」。
             */
            const anchor = this.takeTrigger();
            this.closePop();
            void this.insertImage(file, anchor);
        };
        cancel.onmousedown = (ev) => ev.preventDefault();
        cancel.onclick = (ev) => {
            ev.stopPropagation();
            this.closePop();
            this.focusBack();
        };

        this.placeAtCaret(this.caretRange());
        picker.focus();
    }

    /* ------------------------------------------------------------ 选中浮动工具条 */

    private openToolbar(range: Range) {
        if (this.popKind === "toolbar" && this.pop) {
            this.placeAt(range);
            return;
        }
        this.closePop();
        this.popKind = "toolbar";

        const pop = this.mkPop("mm-inline-bar");
        this.pop = pop;

        const btn = (glyph: string, tip: string, run: () => void, extra = "") => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = `mm-bar-btn${extra}`;
            b.textContent = glyph;
            b.dataset.mmTip = tip;
            // ⚠️ mousedown 必须 preventDefault：不拦的话焦点会离开 .mm-txt，
            //    触发失焦提交，编辑态当场结束（点宿主工具条就是这个下场）
            b.onmousedown = (ev) => ev.preventDefault();
            b.onclick = (ev) => {
                ev.stopPropagation();
                run();
            };
            pop.appendChild(b);
            return b;
        };

        for (const m of MARKS) {
            btn(m.glyph, this.o.t(m.key, m.fallback), () => this.toggleMark(m.type), ` mm-bar-btn--${m.type}`);
        }

        const sep = document.createElement("span");
        sep.className = "mm-bar-sep";
        pop.appendChild(sep);

        btn("🔗", this.o.t("mark.link", "超链接"), () =>
            this.openForm("link", this.o.t("form.linkTitle", "超链接"), [
                { key: "href", label: this.o.t("form.linkHref", "地址"), placeholder: "https://", value: "" },
                { key: "text", label: this.o.t("form.linkText", "文字"), placeholder: "", value: this.selectedText() },
            ]),
        );
        btn("[[", this.o.t("mark.ref", "块引用"), () => {
            /**
             * 选中文字时点「块引用」：**不要**把选中的字替换成 `[[` ——
             * 那样用户选的内容当场就没了，而他还什么都没挑。
             * 正确做法是留着选中、把选中范围本身当插入点，
             * 等挑完目标块再把「选中那段字」换成引用（用它当锚文本）。
             */
            const sel = this.caretRange();
            if (sel && !sel.collapsed && sel.toString().trim()) {
                this.refAnchorText = sel.toString().replace(/\s+/g, " ").trim();
                this.openRefPop(0, "", sel.cloneRange());
            } else {
                this.replaceTriggerText("[[");
                this.openRefPop(2, "");
            }
        });
        btn("⌫", this.o.t("mark.clear", "清除格式"), () => this.clearFormatAtCaret());

        this.placeAt(range);
    }

    /* ------------------------------------------------------------ 标记操作 */

    /** 当前编辑框里的折叠或非折叠选区（不跨出编辑框） */
    private caretRange(): Range | null {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const r = sel.getRangeAt(0);
        if (!this.txt.contains(r.startContainer) || !this.txt.contains(r.endContainer)) return null;
        return r;
    }

    private selectedText(): string {
        return stripZeroWidth(this.caretRange()?.toString() ?? "").replace(/\s+/g, " ").trim();
    }

    /**
     * 折叠选区时把范围扩到光标所在的词（中文没有空格，所以按「非空白连续段」扩）。
     *
     * ⚠️ 零宽字符也要当成边界：光标垫片（`\u200B`）就贴在末尾，不当边界的话
     * 「没选字、直接点工具条的加粗」会把那个不可见垫片包进 `<strong>` 里 ——
     * 落库前垫片被剥掉，就留下一个空的 `****`。
     */
    private rangeOrWord(): Range | null {
        const r = this.caretRange();
        if (!r) return null;
        if (!r.collapsed) return r;
        const node = r.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) return null;
        const text = node.textContent ?? "";
        const at = r.startOffset;
        const isBreak = (ch: string) => /[\s\u200B-\u200D\u2060\uFEFF]/.test(ch);
        let a = at;
        let b = at;
        while (a > 0 && !isBreak(text[a - 1])) a--;
        while (b < text.length && !isBreak(text[b])) b++;
        if (a === b) return null;
        const out = document.createRange();
        out.setStart(node, a);
        out.setEnd(node, b);
        return out;
    }

    /** 加粗 / 斜体……的开关：已经在这个标记里就拆掉，否则包上 */
    private toggleMark(type: string) {
        this.applyMarkAtCaret(type);
        this.onSelection();
    }

    private applyMarkAtCaret(type: string) {
        const range = this.caretRange();
        if (!range) return;
        const existing = closestMark(range.startContainer, type, this.txt);
        if (existing) {
            // 已经在标记里 → 再点一次就是「取消」
            unwrapEl(existing);
        } else {
            // 折叠选区时按「光标所在的词」处理 —— 否则用户在词中间点「加粗」什么都不会发生
            const el = range.collapsed ? this.wrapWord(type) : wrapRange(range, type);
            if (el) this.selectEl(el);
        }
        this.o.onInput?.();
    }

    private wrapWord(type: string): HTMLElement | null {
        const r = this.rangeOrWord();
        return r ? wrapRange(r, type) : null;
    }

    private clearFormatAtCaret() {
        const range = this.caretRange();
        if (!range) return;
        // 先把触发串（`/清除格式`）删掉，再拆标记
        if (this.popKind === "slash" && this.triggerRange) this.triggerRange.cloneRange().deleteContents();
        for (const m of MARKS) {
            let guard = 0;
            while (guard++ < 40) {
                const el = closestMark(range.startContainer, m.type, this.txt);
                if (!el) break;
                unwrapEl(el);
            }
        }
        this.o.onInput?.();
        this.closePop();
    }

    /** 把选区设成某个元素的内容之后（插入后让用户能接着敲字） */
    private selectEl(el: HTMLElement) {
        try {
            const r = document.createRange();
            r.selectNodeContents(el);
            r.collapse(false);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(r);
        } catch {
            /* 选区失败不影响写入本身 */
        }
    }

    /* ------------------------------------------------------------ 图片 */

    /**
     * 上传并插入一张图片。
     *
     * ⚠️ **插入点必须在 `await` 之前钉住**：上传要几百毫秒到几秒，这期间用户
     * 完全可能点一下别处、把光标挪走（甚至挪到另一个节点里）。等上传回来再按
     * 「当前光标」插，图片就会跑到别的地方去 —— 而且看起来像是随机发生的。
     *
     * @param preset 已经取好的插入点（图片表单那条路径传进来）；不传则现取
     */
    private async insertImage(file: File, preset?: Range | null) {
        const anchor = preset ?? this.takeTrigger()?.cloneRange() ?? this.caretRange()?.cloneRange() ?? null;
        const path = await uploadAsset(file);
        if (!path) {
            this.o.notify(this.o.t("msg.uploadFailed", "图片上传失败"));
            return;
        }
        const html = `<span data-type="img"><img src="${escAttr(path)}" alt=""></span>`;
        this.focusBack();
        if (anchor) this.replaceRange(anchor, html);
        else this.insertAtCaret(html);
        this.o.onInput?.();
    }

    /* ------------------------------------------------------------ 范围与浮层工具 */

    /**
     * 从光标往前数 `backChars` 个字符，做成一个范围。
     *
     * 用「往前数几个字符」而不是「绝对下标」：触发串的起点是相对光标算的，
     * 传绝对值的话调用方得自己知道文本节点里的偏移量，很容易在
     * 「斜杠菜单切块引用」这种中途换入口的路径上算错（第一版就是这么错的）。
     */
    private makeRange(caret: Range, backChars: number): Range | null {
        const node = caret.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) return null;
        const start = Math.max(0, caret.startOffset - Math.max(0, backChars));
        try {
            const r = document.createRange();
            r.setStart(node, start);
            r.setEnd(node, caret.startOffset);
            return r;
        } catch {
            return null;
        }
    }

    /** 取出触发串范围并清空引用（调用方负责用它替换内容） */
    private takeTrigger(): Range | null {
        const r = this.triggerRange;
        this.triggerRange = null;
        return r;
    }

    /**
     * 把焦点与光标还给编辑框。
     *
     * 从浮层里插完东西**必须**做这一步：焦点此刻在浮层的输入框 / 按钮上，
     * 不还回去的话用户接着敲字会打进浮层（而浮层已经被关掉，字就丢了）。
     * 而且必须在 `replaceRange` **之前**调 —— 未聚焦的元素上设的选区不生效。
     */
    private focusBack() {
        try {
            this.txt.focus({ preventScroll: true });
        } catch {
            this.txt.focus();
        }
    }

    private replaceRange(range: Range, html: string) {
        try {
            const frag = range.createContextualFragment(html);
            const last = frag.lastChild;
            range.deleteContents();
            range.insertNode(frag);
            // 收尾落光标要过 `caretAfterNode`：插进来的东西正好落在节点末尾时，
            // `setStartAfter` 得到的是会被 Blink 归一化进元素内部的边界（见 `utils/caret.ts`）
            if (last) caretAfterNode(last);
        } catch (err) {
            console.warn("[mindmap] 插入行内内容失败", err);
        }
    }

    private insertAtCaret(html: string) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        this.replaceRange(sel.getRangeAt(0), html);
    }

    /** 用一段 HTML 替换触发串（`/词` 或 `[[词`） */
    private replaceTrigger(html: string) {
        const range = this.takeTrigger();
        if (range) this.replaceRange(range, html);
        else this.insertAtCaret(html);
    }

    /**
     * 用一段**纯文本**替换触发串，并把光标放进这个文本节点里。
     *
     * 与 `replaceTrigger` 的区别只在光标落点，但这一处差别很要命：
     * `replaceRange` 收尾时把光标设在「元素 + 偏移」上（`setStartAfter`），
     * 而触发串识别（`textBeforeCaret` / `makeRange`）都要求
     * `startContainer` 是**文本节点** —— 光标落在元素上时它们一律返回空/null。
     *
     * 后果实测过一次：`/块引用` 把 `/块引用` 换成 `[[` 之后，紧接着的
     * 「挑完目标块要删掉那两个 `[`」这一步拿不到范围，于是 `[[` 永远留在节点里。
     * 所以这条路径必须让光标待在**刚插进去的那个文本节点内部**。
     */
    private replaceTriggerText(text: string) {
        const range = this.takeTrigger();
        if (!range) {
            this.insertAtCaret(text);
            return;
        }
        try {
            const node = document.createTextNode(text);
            range.deleteContents();
            range.insertNode(node);
            const after = document.createRange();
            after.setStart(node, text.length);
            after.collapse(true);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(after);
        } catch (err) {
            console.warn("[mindmap] 替换触发串失败", err);
        }
    }

    private mkPop(cls: string): HTMLElement {
        const pop = document.createElement("div");
        pop.className = `mm-inline-pop ${cls}`;
        // 浮层住在 .mm-root 里（继承 --mm-* 主题变量），但绝不能是 contenteditable ——
        // 否则浏览器会把它当成可编辑区，光标能跑到浮层里
        pop.setAttribute("contenteditable", "false");
        // 浮层自己的按键不外泄：keydown 那道全局守卫**刻意不拦**，
        // 所以这里显式拦掉，免得在浮层里按 Esc / 方向键被宿主的全局快捷键接走
        pop.addEventListener("keydown", (e) => e.stopPropagation());
        this.layer.appendChild(pop);
        return pop;
    }

    private closePop() {
        if (this.pop) this.pop.remove();
        this.pop = null;
        this.popKind = null;
        this.popItems = [];
        this.slashRows = [];
        this.popIndex = 0;
        // 锚点属于「这一次弹出的浮层」：留着它，下一次 open 会先记新锚点，
        // 但 destroy() / Esc 之后再有人手滑调 reposition() 就会摆到旧位置上去
        this.anchor = null;
        if (this.searchTimer) {
            window.clearTimeout(this.searchTimer);
            this.searchTimer = 0;
        }
        // ⚠️ 必须连触发串一起清掉：否则「打 `/abc` → Esc → 选中一段字 → 点链接」时，
        // 表单会拿着那个早就过期的 `/abc` 范围去替换，把节点里那段文字删掉。
        // 所有需要它跨过关闭的路径（斜杠菜单切块引用）都是**关完之后从光标重算**的。
        this.triggerRange = null;
        // 锚文本同理：它属于「这一次块引用插入」，浮层关了就不该再影响下一次
        this.refAnchorText = "";
    }

    private paintItems() {
        // ⚠️ 高亮行不改变尺寸，但**滚动**会：`paintItems` 走的是「方向键换选中项」，
        // 选中项滚出可视区时 `.mm-ref-list` 会自己滚（列表有 overflow-y），
        // 而浮层高度不变、位置也不该变 —— 所以这里只需要保证「尺寸已经定下来了」。
        // 放在这里是为了让「填完候选 → 高亮」这条路径不可能漏掉重定位。
        this.reposition();
        this.popItems.forEach((el, i) => el.classList.toggle("mm-on", i === this.popIndex));
    }

    /**
     * 把浮层放在光标下方。
     *
     * 坐标系是 `.mm-root`（`position: relative`）而不是视口 ——
     * 浮层挂在 `.mm-root` 里，而画布的缩放写在 `.mm-world` 的 `style.zoom` 上，
     * `.mm-root` 本身不受缩放影响，所以用「两者 rect 相减」即可，**不需要乘 scale**。
     * 这比挂到 `document.body` 再乘缩放比稳得多（缩放是 `zoom` 不是 `transform`，
     * 混用两套坐标最容易在某个缩放档位上飘）。
     *
     * ⚠️ 这里只**记锚点**，真正的摆放交给 `reposition()` —— 因为「摆一次」不够。
     */
    private placeAtCaret(range: Range | null) {
        if (!this.pop) return;
        let rect: DOMRect | null = null;
        if (range) {
            try {
                const r = range.getBoundingClientRect();
                if (r.width > 0 || r.height > 0) rect = r;
            } catch {
                rect = null;
            }
        }
        if (!rect) {
            const n = this.txt.getBoundingClientRect();
            rect = new DOMRect(n.left, n.bottom, 0, 0);
        }
        this.place(rect.left, rect.top, rect.bottom, false);
    }

    private placeAt(range: Range) {
        let rect: DOMRect | null = null;
        try {
            rect = range.getBoundingClientRect();
        } catch {
            rect = null;
        }
        if (!rect) return this.placeAtCaret(null);
        this.place(rect.left, rect.top, rect.bottom, true);
    }

    /** 记下锚点后立刻摆一次；之后**尺寸一变就得再调 `reposition()`** */
    private place(viewportX: number, viewportTop: number, viewportBottom: number, preferAbove: boolean) {
        this.anchor = { x: viewportX, top: viewportTop, bottom: viewportBottom, preferAbove };
        this.reposition();
    }

    /**
     * 按**记下来的锚点**重算浮层位置。尺寸变了（候选填进来 / 换关键词 / 出空态）必须调一次。
     *
     * ⚠️ 这条是「定位只做一次」的第二层坑，和「浮层跑到画布左上角」是两回事：
     *
     *   1. 建浮层时它只有**一个输入框**（矮），`maxTop` 是按这个高度算的；
     *   2. 30 条候选填进来后它长到 300+ 高（`.mm-ref-list` 自己有 `max-height: 240px`），
     *      于是底部越出 `.mm-root` —— 而 `.mm-root` 是 `overflow: hidden`，
     *      多出来的那截被**裁掉**（症状不是「看不见」，是「少一块」，很容易漏诊）；
     *   3. 所以「只在开浮层时定位」必然漏掉长列表这一半。
     *
     * 顺带做了**翻面**：下方摆不下就挪到锚点上方。锚点上方也摆不下时才退回
     * 「下方 + 钳制」—— 那种情况说明画布本身就很矮，至少让输入框那一段可见。
     */
    private reposition() {
        const pop = this.pop;
        const a = this.anchor;
        if (!pop || !a) return;

        const layerRect = this.layer.getBoundingClientRect();
        const pr = pop.getBoundingClientRect();
        const layerW = this.layer.clientWidth;
        const layerH = this.layer.clientHeight;
        const PAD = 8;

        // 锚点在视口里 → 换算到 .mm-root 的坐标系
        let top = (a.preferAbove ? a.top - 8 - pr.height : a.bottom + 4) - layerRect.top;

        // 摆不下就翻面。两侧都摆不下时才退回「原侧 + 钳制」——
        // 那种情况说明画布本身就很矮，至少保证浮层完整可见（钳制会盖住光标，但不会缺一块）
        if (!a.preferAbove) {
            if (top + pr.height > layerH - PAD) {
                const flipped = a.top - 8 - pr.height - layerRect.top;
                if (flipped >= PAD) top = flipped;
            }
        } else if (top < PAD) {
            const flipped = a.bottom + 4 - layerRect.top;
            if (flipped + pr.height <= layerH - PAD) top = flipped;
        }

        let left = a.x - layerRect.left;
        const maxLeft = layerW - pr.width - PAD;
        const maxTop = layerH - pr.height - PAD;
        left = Math.min(Math.max(left, PAD), Math.max(PAD, maxLeft));
        top = Math.min(Math.max(top, PAD), Math.max(PAD, maxTop));
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
    }
}
