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

/** 把节点及其子树序列化为 markdown（副本路径使用） */
export function serializeSubtree(node: MMNode, depth = 0): string {
    const indent = "  ".repeat(depth);
    const line = `${indent}${markerOf(node)} ${escapeMd(node.text)}`;
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
