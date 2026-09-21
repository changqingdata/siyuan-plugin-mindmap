import type { MMNode } from "../types";

/**
 * 纯树操作工具 —— 不触碰内核 API，可在 Node 环境直接测试。
 * 涉及块写入的逻辑见 actions.ts。
 */

/** 新建节点时的默认文字 */
export const NEW_NODE_TEXT = "新节点";

/** a 是否为 b 的祖先（不含自身） */
export function isAncestor(a: MMNode, b: MMNode | null): boolean {
    let cur = b?.parent ?? null;
    while (cur) {
        if (cur === a) return true;
        cur = cur.parent;
    }
    return false;
}

/** 节点在父节点 children 中的下标；无父节点返回 -1 */
export function indexInParent(node: MMNode): number {
    return node.parent ? node.parent.children.indexOf(node) : -1;
}

/**
 * 转义 markdown 元字符。
 * 「改名」是纯文本语义 —— 用户输入 `1. 测试` 不应该把节点变成有序列表。
 * 想在导图里加格式请回到编辑器操作。
 */
export function escapeMd(text: string): string {
    let s = text.replace(/([\\`*_[\]])/g, "\\$1");
    s = s.replace(/^(\s*)([-+>#~|])/, (_m, sp: string, ch: string) => `${sp}\\${ch}`);
    s = s.replace(/^(\s*)(\d+)([.)])/, (_m, sp: string, num: string, dot: string) => `${sp}${num}\\${dot}`);
    return s;
}

/** 「这段 HTML 里有标签吗」—— 有标签就说明带了行内格式或非文字内容 */
const HAS_TAG = /<(?!br\s*\/?>)[a-z!/][^>]*>/i;

/**
 * 节点是否含行内格式（加粗 / 双链 / 公式 / 图片 / 颜色……）。
 *
 * 用来决定「改名」该走哪条路：纯文本节点可以就地改（轻快），
 * 含格式的节点**必须回到源列表改** —— 就地编辑写回的是纯文本，会把格式抹掉。
 */
export function hasInlineFormat(node: MMNode): boolean {
    return HAS_TAG.test(node.html ?? "");
}

const IMG_SPAN_RE = /<span[^>]*data-type="img"[^>]*>\s*<img\b([^>]*?)\/?>\s*<\/span>/gi;
const IMG_RE = /<img\b([^>]*?)\/?>/gi;

/**
 * 把一段行内 HTML 压成能穿过 markdown 通道的形式。
 *
 * 为什么可以**原样**保留 `data-type` 的 span：实测（`tests/kernel/copy-fidelity.mjs`）
 * 走 `/api/block/insertBlock` 的 markdown 通道时，lute 认得这些 span ——
 * `strong / em / u / s / code / mark / sup / sub / tag / a / block-ref / inline-math /
 * text(style 颜色字号)` **一个不丢**，把整段内层 HTML 拼在 `- ` 后面即可。
 *
 * 但有两处必须转换：
 *   - **图片**：`<span data-type="img"><img src>` 过不去（实测丢格式），
 *     得换成 markdown 的 `![alt](src)`；
 *   - **换行**：内容里若含 `\n`，拼进列表项会破坏结构，压成空格。
 */
function inlineOf(node: MMNode): string {
    const html = (node.html ?? "").trim();
    // 纯文本项走转义，避免内容里的 `*` `_` `1.` 被 markdown 解析成格式
    if (!html || !HAS_TAG.test(html)) return escapeMd(node.text);

    const imgMd = (attrs: string): string => {
        const src = attrs.match(/\bsrc="([^"]*)"/i)?.[1] ?? "";
        const alt = (attrs.match(/\balt="([^"]*)"/i)?.[1] ?? "").replace(/[[\]()]/g, "");
        return src ? `![${alt}](${src})` : "";
    };

    return html
        .replace(/\r?\n+/g, " ")
        .replace(IMG_SPAN_RE, (_m, attrs: string) => imgMd(attrs))
        .replace(IMG_RE, (_m, attrs: string) => imgMd(attrs))
        .trim();
}

/** 按节点类型生成列表项标记 */
export function markerOf(node: MMNode): string {
    if (node.kind === "task") return "- [ ]";
    if (node.numbered) return "1.";
    return "-";
}

/** 生成一个新节点的 markdown，类型跟随参考节点 */
export function newItemMarkdown(ref: MMNode): string {
    if (ref.kind === "task") return `- [ ] ${NEW_NODE_TEXT}`;
    if (ref.numbered) return `1. ${NEW_NODE_TEXT}`;
    return `- ${NEW_NODE_TEXT}`;
}

/**
 * 把节点及其子树序列化为 markdown（副本路径 / 剪贴板使用）。
 *
 * ⚠️ 这里**必须带上行内格式**。原先用的是 `escapeMd(node.text)` —— 纯文本，
 * 于是「边界位置的降级/升级」「快速复制」「Ctrl+C 再 Ctrl+V」会把整棵子树的
 * 双链、公式、加粗**静默重建成纯文本**，而且块 ID 也会重建。
 * 实测证据见 `tests/kernel/copy-fidelity.mjs` 的「候选 A：纯文本（现状基线）」。
 */
export function serializeSubtree(node: MMNode, depth = 0): string {
    const indent = "  ".repeat(depth);
    const line = `${indent}${markerOf(node)} ${inlineOf(node)}`;
    if (node.children.length === 0) return line;
    return [line, ...node.children.map((c) => serializeSubtree(c, depth + 1))].join("\n");
}

/* ==================================================================== 可执行性判断（供菜单禁用） */

/** 有前一个兄弟才能降级 */
export function canIndent(node: MMNode): boolean {
    return !!node.id && indexInParent(node) > 0;
}

/** 父节点是真实列表项才能升级（虚拟根不算） */
export function canOutdent(node: MMNode): boolean {
    return !!node.id && !!node.parent?.id;
}

export function canMoveUp(node: MMNode): boolean {
    return !!node.id && indexInParent(node) > 0;
}

export function canMoveDown(node: MMNode): boolean {
    const idx = indexInParent(node);
    return !!node.id && !!node.parent && idx >= 0 && idx < node.parent.children.length - 1;
}

export function canDelete(node: MMNode): boolean {
    return !!node.id;
}

/** 有内容块 ID 才能改名 */
export function canEdit(node: MMNode): boolean {
    return !!node.contentId;
}

/**
 * 批量操作里「祖先也被选中」的节点要去掉，只留最外层。
 *
 * 把 A 和 A 的子节点 B 一起「升级」是自相矛盾的 —— 执行顺序不同会得到
 * 完全不同的树，而且中途 B 可能已经跟着 A 一起被移走了，第二条操作必然失败、
 * 触发整体回滚。结构操作本来就只该作用在最外层的选中项上。
 *
 * 放在 tree.ts 而不是 actions.ts：它是纯树逻辑，不碰内核，
 * 这样也能直接在 Node 单测里覆盖（actions.ts 依赖 siyuan 运行时）。
 */
export function topLevelOf(nodes: MMNode[]): MMNode[] {
    const set = new Set(nodes);
    return nodes.filter((n) => {
        let p = n.parent;
        while (p) {
            if (set.has(p)) return false;
            p = p.parent;
        }
        return true;
    });
}
