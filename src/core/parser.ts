import type { MMNode, MMNodeKind } from "../types";

/**
 * Protyle DOM → 导图树模型
 *
 * 思源的列表结构：
 *   div.list[data-subtype="u|o|t"][data-node-id]
 *     └── div.li[data-node-id][data-type="NodeListItem"]
 *           ├── div.protyle-action          （项目符号 / 序号 / 复选框）
 *           ├── div[data-node-id]           （内容块：段落、标题……）
 *           └── div.list                    （嵌套的子列表）
 */
/**
 * 零宽字符。
 *
 * Protyle 会往块内容里塞 U+200B（零宽空格）。它**不在** ECMAScript 的
 * WhiteSpace 集合里，所以 `trim()` 去不掉 —— 实测每个节点的 textContent
 * 末尾都挂着一个，肉眼和普通字符串比较都看不出来。
 *
 * 留着它的代价：node.text 会带着它进 serializeSubtree，于是「复制节点」
 * 和「降级副本路径」会把不可见字符写回内核；搜索匹配、导出文本、
 * 重命名时的等值比较也都会被它干扰。所以在解析这一层就清掉。
 */
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

/**
 * 「这段 HTML 里有标签吗」。
 * `<br>` 不算 —— 只含换行的列表项仍然是空项。
 */
const HAS_TAG = /<(?!br\s*\/?>)[a-z!/][^>]*>/i;

function cleanText(s: string): string {
    return s.replace(ZERO_WIDTH, "").trim();
}

export function parseList(listEl: HTMLElement, path = ""): MMNode[] {
    const subtype = listEl.dataset.subtype ?? "u";
    const numbered = subtype === "o";
    const kind: MMNodeKind = subtype === "t" ? "task" : numbered ? "ordered" : "bullet";
    /** 本层列表块的块 ID，节点归属它 */
    const ownerListId = listEl.dataset.nodeId ?? "";

    const items: MMNode[] = [];

    for (const child of Array.from(listEl.children)) {
        if (!(child instanceof HTMLElement)) continue;

        // 异常形态：列表块直接嵌在列表块里，中间没有 .li。
        //
        // 内核里这是不可能的（NodeList 只能装 NodeListItem），但**用块 API 往列表里
        // 插 markdown** 时会撞上：内核返回的事务是「插入一个 NodeList」，前端照着
        // 原样插进 DOM，于是结构变成 .list > [.li, .li, .list]；而内核那边其实已经
        // 把新列表项摊平成同级兄弟了（`/api/block/getBlockDOM` 是干净的三个 .li）。
        //
        // 结果就是：内核数据正确、前端 DOM 畸形、导图按 DOM 解析 → 新节点凭空消失。
        // 这里跟着内核的语义把嵌套列表摊平，两种形态都能读对。
        if (child.classList.contains("list")) {
            items.push(...parseList(child, path ? `${path}.${items.length + 1}` : `${items.length + 1}`));
            continue;
        }

        if (!child.classList.contains("li")) continue;

        const li = child;
        const contentEl = findContentEl(li);
        const subList = findSubListEl(li);

        const order = path ? `${path}.${items.length + 1}` : `${items.length + 1}`;
        const children = subList ? parseList(subList, order) : [];

        const html = contentEl ? sanitizeInline(contentEl.innerHTML) : "";
        const text = cleanText(contentEl?.textContent ?? "");

        /*
         * 既没文字、也没非文字内容、也没子节点的空列表项才丢弃。
         *
         * 这里踩过一个坑：判据原先只看 `text`，而「有没有文字」并不能代表「有没有内容」——
         * `<img>` 的 textContent 是空的，KaTeX 公式的 textContent 只是公式源码，
         * 于是**纯图片项和纯公式项会被当成空行整个丢掉**（实测 3 项进去只剩 2 个节点）。
         *
         * 判据用「清洗后的 HTML 里还有没有标签」来判断，而不是 querySelector：
         * parser 在 Node 单测里跑的是极简 DOM 模拟，没有 querySelector。
         * 纯文本项的 html 是 escapeHtml(text)，不含标签；图片 / 公式 / 任何行内格式都含标签。
         * `<br>` 不算内容（只含换行的项仍然算空）。
         */
        const hasRich = HAS_TAG.test(html);
        if (!text && !hasRich && children.length === 0) continue;

        items.push({
            id: li.dataset.nodeId ?? "",
            contentId: contentEl?.dataset.nodeId ?? "",
            listId: ownerListId,
            subListId: subList?.dataset.nodeId ?? "",
            html: html || escapeHtml(text),
            text,
            kind,
            checked: li.classList.contains("protyle-task--done") ? true : undefined,
            folded: false,
            numbered,
            order,
            children,

            depth: 0,
            branch: -1,
            color: null,

            w: 0,
            h: 0,
            x: 0,
            y: 0,
            kids: [],
            parent: null,
            dir: 1,
            cross: 0,
            slot: 0,
            cy: 0,
            d0: 0,
            d1: 0,
        });
    }

    return items;
}

/** 取 .li 下第一个内容块（排除 protyle-action 与嵌套列表） */
function findContentEl(li: HTMLElement): HTMLElement | null {
    for (const el of Array.from(li.children)) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.classList.contains("list")) continue;
        if (el.classList.contains("protyle-action")) continue;
        if (el.hasAttribute("data-node-id")) return el;
    }
    return null;
}

/** 取 .li 下直接子级的嵌套列表 */
function findSubListEl(li: HTMLElement): HTMLElement | null {
    for (const el of Array.from(li.children)) {
        if (el instanceof HTMLElement && el.classList.contains("list")) return el;
    }
    return null;
}

/**
 * 编辑器塞进来的 UI 外壳。它们长在内容块里，但**不是正文**：
 * 实测被带进节点的垃圾有
 *   <div class="protyle-attr"></div>                     块属性标记
 *   <span class="protyle-action protyle-icons">…</span>  悬停时出现的那排操作按钮
 *     └ <svg><use xlink:href="#iconMore"></use></svg>    「更多」图标
 *   <span class="protyle-action__drag"></span>           图片左上角那个拖拽手柄
 *   <span> </span>                                       图片周围的空白占位
 *
 * ⚠️ 必须用 `[class*="protyle-"]` 这种前缀匹配，不能只写 `.protyle-action` ——
 * BEM 修饰符（`protyle-action__drag`）是**另一个类名**，`.protyle-action` 选择器
 * 匹配不到它。实测就漏了这个拖拽手柄，一路带进了节点。
 *
 * `.img__net` 是图片加载失败时 Protyle 插进来的那个「网络图标」占位（不在 protyle- 前缀下，
 * 得单独列）。它是纯粹的加载状态提示，不属于正文。
 */
const DROP_SELECTOR = '[class*="protyle-"], .img__net';

/**
 * 清理行内 HTML：删掉编辑器的 UI 外壳与残留属性，保留语义标签
 * （strong / em / code / mark / 行内公式 / 双链 / 颜色……）。
 *
 * 两步走：
 *  1. **正则**兜底 —— Node 单测跑的是极简 DOM 模拟，没有 template / querySelector；
 *  2. **DOM 级白名单** —— 结构层面的垃圾（嵌套的 protyle-* 外壳）只有按元素删才删得干净，
 *     字符串正则做不到。
 *
 * ⚠️ 第 2 步**必须先在副本上做**。这里传进来的是一段字符串（`innerHTML` 的快照），
 * 天然就是副本，所以安全；但任何「拿到 contentEl 元素直接改」的写法都是在动
 * 思源自己的编辑器 DOM —— 用户没编辑却改了笔记，绝对不能那么干。
 */
function sanitizeInline(html: string): string {
    const basic = sanitizeByRegex(html);
    if (!basic) return "";
    if (typeof document === "undefined" || typeof document.createElement !== "function") return basic;
    try {
        return sanitizeByDom(basic) || basic;
    } catch {
        return basic;
    }
}

/** 正则层：删残留属性、去零宽字符 */
function sanitizeByRegex(html: string): string {
    return html
        .replace(ZERO_WIDTH, "")
        .replace(/\scontenteditable="(?!false)[^"]*"/g, "")
        .replace(/\sspellcheck="[^"]*"/g, "")
        .replace(/\sdata-render="[^"]*"/g, "")
        .replace(/\sclass="protyle-wysiwyg--select"/g, "")
        .trim();
}

/** DOM 层：按元素删掉编辑器 UI 外壳，并把图片的懒加载地址搬到 src */
function sanitizeByDom(html: string): string {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const frag = tpl.content as unknown as HTMLElement | null;
    if (!frag) return html;

    frag.querySelectorAll(DROP_SELECTOR).forEach((el) => el.remove());

    /*
     * 图片：Protyle 用 data-src + loading="lazy" 做懒加载。
     * 导图模式下源列表是 display:none（index.css 的 .mm-source-hidden），
     * 隐藏容器里的 lazy 图**永远不会触发加载**（实测 naturalWidth 恒为 0）。
     * 导图里那份是我们自己写进可见区域的，必须带上真实地址。
     */
    frag.querySelectorAll("img").forEach((img) => {
        const real = img.getAttribute("data-src") || img.getAttribute("src") || "";
        if (real) img.setAttribute("src", real);
        img.removeAttribute("loading");
        img.removeAttribute("data-src");
    });

    frag.querySelectorAll("*").forEach((el) => {
        // contenteditable="false" 是 KaTeX 渲染节点与图片的保护属性，留着；
        // 其它值（编辑器给自己加的可编辑标记）删掉。
        const ce = el.getAttribute("contenteditable");
        if (ce !== null && ce !== "false") el.removeAttribute("contenteditable");
        el.removeAttribute("spellcheck");
        el.removeAttribute("data-render");
        // class 不能无差别删 —— KaTeX 的 .katex / .katex-html 靠它上样式。
        if (el.classList?.contains("protyle-wysiwyg--select")) el.classList.remove("protyle-wysiwyg--select");
    });

    // 纯空白、无属性、无子元素的占位 span（图片周围那种）
    frag.querySelectorAll("span").forEach((el) => {
        if (el.attributes.length === 0 && el.children.length === 0 && !(el.textContent ?? "").trim()) el.remove();
    });

    const box = document.createElement("div");
    box.appendChild(frag);
    return box.innerHTML.trim();
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/**
 * 装饰：补齐 depth / branch / order / color
 * @returns 节点总数与最大深度
 */
export function decorate(root: MMNode, palette: string[], useBranchColor: boolean) {
    let count = 0;
    let maxDepth = 0;

    root.depth = 0;
    root.branch = -1;
    root.order = "1";
    root.parent = null;

    const walk = (node: MMNode) => {
        count++;
        if (node.depth > maxDepth) maxDepth = node.depth;
        node.children.forEach((c, i) => {
            c.depth = node.depth + 1;
            c.branch = node.depth === 0 ? i : node.branch;
            c.order = `${node.order}.${i + 1}`;
            c.parent = node;
            walk(c);
        });
    };
    walk(root);

    const paint = (n: MMNode) => {
        n.color = n.depth === 0 ? null : useBranchColor && n.branch >= 0 ? palette[n.branch % palette.length] : palette[0];
        n.children.forEach(paint);
    };
    paint(root);

    return { count, maxDepth };
}

/** 把多个顶层节点包成一个虚拟根 */
export function wrapRoot(items: MMNode[], title: string): MMNode {
    if (items.length === 1) return items[0];
    return {
        id: "",
        contentId: "",
        listId: items[0]?.listId ?? "",
        subListId: "",
        html: escapeHtml(title),
        text: title,
        kind: "heading",
        folded: false,
        numbered: false,
        order: "1",
        children: items,
        depth: 0,
        branch: -1,
        color: null,
        w: 0,
        h: 0,
        x: 0,
        y: 0,
        kids: [],
        parent: null,
        dir: 1,
        cross: 0,
        slot: 0,
        cy: 0,
        d0: 0,
        d1: 0,
    };
}

/** 收集所有节点 */
export function flatten(root: MMNode): MMNode[] {
    const out: MMNode[] = [];
    const walk = (n: MMNode) => {
        out.push(n);
        n.children.forEach(walk);
    };
    walk(root);
    return out;
}

/** 按块 ID 建立索引 */
export function indexById(root: MMNode): Map<string, MMNode> {
    const map = new Map<string, MMNode>();
    for (const n of flatten(root)) {
        if (n.id) map.set(n.id, n);
    }
    return map;
}
