import type { MMDropPosition, MMNode } from "../types";
import type { InsertBlockOptions } from "../utils/api";
import { deleteBlock, insertBlock, moveBlock, setTaskMarker, setTaskMarkers, updateBlock } from "../utils/api";
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
        // ⚠️ 这里不能给 `parentID: target.id`（列表项 id）——
        // 内核会把新建的子列表插到**段落之前**，列表项的子块顺序变成
        // [子列表, 段落]，大纲里子节点会跑到父节点文字上方。
        // childAnchor 给的是「段落之后」，顺序才对（见文件头的实测记录）。
        const place = childAnchor(target);
        if (!place) return false;
        return relocateByCopy(node, place);
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

/**
 * 把待办节点写成指定的勾选态。
 *
 * 只认 `kind === "task"` —— 普通列表项没有勾选态可言，
 * 菜单那边也会按这个条件禁用，所以这里返回 false 属于「不该发生」，
 * 交给上层的红边反馈即可。
 *
 * **收的是目标态，不是「切换」**：渲染层为了做乐观 UI，在派发动作之前
 * 已经把 `node.checked` 翻成了目标态，这里若再 `!node.checked` 反推，
 * 两次取反就等于把原值写回去 —— 点一下变成一次原地踏步的空写，
 * 界面勾上了、内核纹丝不动（`probe-click-timeline.mjs` 抓到的就是这个）。
 */
export async function toggleTaskCheck(node: MMNode, checked: boolean): Promise<boolean> {
    if (!node.id || node.kind !== "task") return false;
    return setTaskMarker(node.id, checked);
}

/* ==================================================================== 批量 */

/**
 * 批量降级：把 `nodes` 依次移成 `anchor` 的子节点（追加到末尾）。
 *
 * 语义对齐常见大纲软件的「多行缩进」——选中 5 条，全部变成**上一条**的子节点，
 * 而不是串成一条阶梯（一条条单独降级会串成 A→B→C 的链）。
 *
 * 返回失败的节点（空数组表示全部成功）。
 *
 * 两个分支的遍历方向**故意相反**，都是为了最终顺序正确：
 *  - anchor 已有子列表 → 内核按 `parentID` **追加到末尾**，正序执行即为正序结果；
 *  - anchor 还没有子列表 → 只能走「插副本 + 删原块」，而每一份副本都落在
 *    anchor 段落的正后方，**倒序**执行才能得到正序结果。
 */
export async function indentNodesInto(nodes: MMNode[], anchor: MMNode): Promise<MMNode[]> {
    const failed: MMNode[] = [];
    if (nodes.length === 0 || !anchor.id) return nodes;

    if (anchor.subListId) {
        for (const n of nodes) {
            if (!n.id || !(await moveBlock({ id: n.id, parentID: anchor.subListId }))) failed.push(n);
        }
        return failed;
    }

    const place = childAnchor(anchor);
    if (!place) return nodes;
    for (const n of [...nodes].reverse()) {
        if (!(await relocateByCopy(n, place))) failed.push(n);
    }
    return failed;
}

/**
 * 批量升级：把 `nodes` 依次移成「父节点的下一个兄弟」。
 *
 * 必须**倒序**执行：每条都插到父节点正后方，倒着来才能保持原有先后
 * （正序会得到完全颠倒的顺序，实测 [A,B,C] 会变成 [C,B,A]）。
 */
export async function outdentNodes(nodes: MMNode[]): Promise<MMNode[]> {
    const failed: MMNode[] = [];
    for (const n of [...nodes].reverse()) {
        const parent = n.parent;
        if (!parent?.id || !n.id || !(await moveBlock({ id: n.id, previousID: parent.id }))) failed.push(n);
    }
    return failed;
}

/** 批量删除。删除顺序不影响结果（按块 ID 删，互不依赖），但倒序更贴近「从后往前删」的直觉 */
export async function deleteNodes(nodes: MMNode[]): Promise<MMNode[]> {
    const failed: MMNode[] = [];
    for (const n of [...nodes].reverse()) {
        if (!n.id || !(await deleteBlock(n.id))) failed.push(n);
    }
    return failed;
}

/**
 * 批量勾选 / 取消勾选。
 *
 * 与折叠、删除不同，这一条**不用逐条调** —— 内核有 `batchUpdateTaskListItemMarker`，
 * 一次往返就是一次事务，天生满足「整体成功或整体回滚」，不需要上层拿快照兜底。
 *
 * 非任务节点直接跳过、且**不算失败**：选中一堆普通节点和几个待办一起勾，
 * 是很自然的操作，不该报错。
 */
export async function setTaskChecks(nodes: MMNode[], checked: boolean): Promise<MMNode[]> {
    const targets = nodes.filter((n) => n.kind === "task" && n.id);
    if (targets.length === 0) return [];
    const ok = await setTaskMarkers(
        targets.map((n) => n.id),
        checked,
    );
    return ok ? [] : targets;
}
