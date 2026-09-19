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

        // 既没文字也没子节点的空列表项直接丢弃
        if (!text && children.length === 0) continue;

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
 * 清理行内 HTML：
 * 去掉编辑器相关属性，保留语义标签（strong / em / code / mark / 行内公式 / 引用……）
 */
function sanitizeInline(html: string): string {
    return html
        .replace(ZERO_WIDTH, "")
        .replace(/\scontenteditable="[^"]*"/g, "")
        .replace(/\sspellcheck="[^"]*"/g, "")
        .replace(/\sdata-render="[^"]*"/g, "")
        .replace(/\sclass="protyle-wysiwyg--select"/g, "")
        .trim();
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
