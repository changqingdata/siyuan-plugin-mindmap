import type { MMDropPosition, MMNode } from "../types";
import type { InsertBlockOptions } from "../utils/api";
import { deleteBlock, insertBlock, moveBlock, updateBlock } from "../utils/api";
import { escapeMd, indexInParent, isAncestor, newItemMarkdown, serializeSubtree } from "./tree";

/**
 * 节点结构操作 —— 全部落到思源内核块 API。
 *
 * 设计原则：
 *
 * 1. **优先 moveBlock**。它保留块 ID，块引用与反链不受影响，与思源原生拖拽行为一致。
 * 2. **内核 API 表达不了的位置退回「插入副本 + 删除原块」**。
 *    经查内核源码 `kernel/api/block_op.go`，moveBlock 只接受 `previousID`（移到某块之后）
 *    与 `parentID`（追加到某容器末尾），**没有 nextID**，因此「插入到容器最前」无法表达。
 *    这些边界情况只能走副本路径，代价是该子树会重建块 ID。
 *
 * 关于「新增子节点」的锚点，实测踩过的坑（思源 3.8.4，见 childAnchor 的注释）：
 *
 *   - `parentID = 列表块id`      → 内核直接拒绝：NodeList 不能包含 NodeList
 *   - `parentID = 列表项id`      → 能建出子列表，但会被插到**最前面**，
 *                                  列表项的子块顺序变成 [子列表, 段落]，
 *                                  大纲里子节点会跑到父节点文字的上方
 *   - `previousID = 最后一个子节点id` → 正确，插到它之后，仍在同一个子列表里
 *   - `previousID = 自己段落的id`     → 正确，插到段落之后，正好是 [段落, 子列表]
 *
 * 另外 `treenode.CheckListItemNesting` 明确禁止「列表项直接包含列表项」，
 * 所以把已有节点移成子节点时，parentID 必须是 NodeList 而不是 NodeListItem；
 * 若目标还没有子列表，就只能走副本路径（先插副本，让内核建出 NodeList）。
 */

/**
 * 兜底路径：在目标位置插入节点副本，成功后再删除原块。
 * 会重建该子树的块 ID，因此只在 moveBlock 表达不了的位置使用。
 */
async function relocateByCopy(node: MMNode, place: Omit<InsertBlockOptions, "data">): Promise<boolean> {
    if (!node.id) return false;
    const newId = await insertBlock({ ...place, data: serializeSubtree(node) });
    // 用 !== null 判断：取不到新块 ID 时空串仍然代表插入成功，
    // 若按真假值判断就会漏删原块，留下重复内容。
    if (newId === null) return false;
    await deleteBlock(node.id);
    return true;
}

/* ==================================================================== 操作 */

/** 改名。内容未变化或为空时不做任何写入 */
export async function renameNode(node: MMNode, text: string): Promise<boolean> {
    if (!node.contentId) return false;
    const next = text.replace(/\s+/g, " ").trim();
    if (!next || next === node.text) return false;
    return updateBlock(node.contentId, escapeMd(next));
}

/**
 * 求「把新列表项追加为 node 的最后一个子节点」该用的锚点。
 *
 * 内核不允许 NodeList 直接套 NodeList，所以 parentID 不能给列表块；
 * 给列表项 id 虽然能建出子列表，但内核会把它插到**最前面**，
 * 列表项的子块顺序变成 [子列表, 段落]，大纲里子节点会跑到自己文字上方。
 * 段落是列表项的第一个子块，把新列表插到它之后，顺序才是对的。
 */
function childAnchor(node: MMNode): Omit<InsertBlockOptions, "data"> | null {
    const last = node.children[node.children.length - 1];
    if (last?.id) return { previousID: last.id };
    if (node.contentId) return { previousID: node.contentId };
    if (node.id) return { parentID: node.id };
    return null;
}

/**
 * 插入子节点（追加到末尾）。
 *
 * 返回新块的 ID（**取不到 ID 时返回空串**，空串仍然代表成功），失败返回 null。
 * 调用方判断成败请一律用 `!== null` —— 返回类型从 boolean 改成 string 之后，
 * 如果沿用真假值判断，「插进去了但没拿到 ID」会被误判成失败并弹「操作未生效」。
 */
export async function insertChildNode(node: MMNode): Promise<string | null> {
    const place = childAnchor(node);
    if (!place) return null;
    return insertBlock({ data: newItemMarkdown(node), ...place });
}

/** 插入同级节点。返回新块 ID，语义同 insertChildNode */
export async function insertSiblingNode(node: MMNode, where: "before" | "after"): Promise<string | null> {
    if (!node.id) return null;
    const data = newItemMarkdown(node);
    const opts: InsertBlockOptions = where === "after" ? { data, previousID: node.id } : { data, nextID: node.id };
    return insertBlock(opts);
}

/** 删除节点（连同其子树） */
export async function deleteNode(node: MMNode): Promise<boolean> {
    if (!node.id) return false;
    return deleteBlock(node.id);
}

/** 降级：成为前一个兄弟的最后一个子节点 */
export async function indentNode(node: MMNode): Promise<boolean> {
    const idx = indexInParent(node);
    if (idx <= 0 || !node.id) return false;
    const prev = node.parent!.children[idx - 1];
    if (!prev.id) return false;

    // 前一个兄弟已有子列表 —— 直接把本节点移进去（parentID 是 NodeList，合法）
    if (prev.subListId) return moveBlock({ id: node.id, parentID: prev.subListId });

    // 前一个兄弟还没有子列表：先插副本到它的段落之后，由内核建出 NodeList
    const place = childAnchor(prev);
    if (!place) return false;
    return relocateByCopy(node, place);
}

/** 升级：成为父节点的下一个兄弟 */
export async function outdentNode(node: MMNode): Promise<boolean> {
    const parent = node.parent;
    if (!parent?.id || !node.id) return false;
    // previousID 指向父列表项，块落到它之后即自动进入祖父容器
    return moveBlock({ id: node.id, previousID: parent.id });
}

/** 上移一位：把前一个兄弟移到本节点之后 */
export async function moveUpNode(node: MMNode): Promise<boolean> {
    const idx = indexInParent(node);
    if (idx <= 0 || !node.id) return false;
    const prev = node.parent!.children[idx - 1];
    if (!prev.id) return false;
    return moveBlock({ id: prev.id, previousID: node.id });
}

/** 下移一位：把本节点移到后一个兄弟之后 */
export async function moveDownNode(node: MMNode): Promise<boolean> {
    const parent = node.parent;
    if (!parent || !node.id) return false;
    const idx = parent.children.indexOf(node);
    if (idx < 0 || idx >= parent.children.length - 1) return false;
    const next = parent.children[idx + 1];
    if (!next.id) return false;
    return moveBlock({ id: node.id, previousID: next.id });
}

/** 拖拽移动：把 node 放到 target 的指定位置 */
export async function moveNodeTo(node: MMNode, target: MMNode, position: MMDropPosition): Promise<boolean> {
    if (!node.id || !target.id || node === target) return false;
    // 不能把节点拖进自己的子树
    if (isAncestor(node, target)) return false;

    if (position === "after") {
        return moveBlock({ id: node.id, previousID: target.id });
    }

    if (position === "child") {
        if (target.subListId) return moveBlock({ id: node.id, parentID: target.subListId });
        return relocateByCopy(node, { parentID: target.id });
    }

    // before：优先插到目标的前一个兄弟之后
    const idx = indexInParent(target);
    const before = idx > 0 ? target.parent!.children[idx - 1] : null;
    if (before === node) return true; // 已经在该位置
    if (before?.id) return moveBlock({ id: node.id, previousID: before.id });

    // 目标是首个子节点：内核没有「插入到最前」，退回副本路径
    return relocateByCopy(node, { nextID: target.id });
}

/**
 * 快速复制：在节点之后插入一份含子树的副本（副本会拿到新的块 ID）。
 * 返回新块 ID，语义同 insertChildNode。
 */
export async function duplicateNode(node: MMNode): Promise<string | null> {
    if (!node.id) return null;
    return insertBlock({ data: serializeSubtree(node), previousID: node.id });
}

/** 粘贴：把一段 markdown 追加为目标节点的子节点 */
export async function pasteNode(node: MMNode, markdown: string): Promise<boolean> {
    const data = markdown.trim();
    if (!data) return false;

    const place = childAnchor(node);
    if (!place) return false;
    return (await insertBlock({ data, ...place })) !== null;
}
