/**
 * 插件自己的撤销 / 重做栈。
 *
 * ## 为什么必须自己实现
 *
 * 思源前端的撤销栈只在事务**带 `undoOperations`** 时才入栈 —— `common.js` 里那一句是
 * `if (undoOperations && ...) protyle.undo.add(doOperations, undoOperations, protyle)`。
 * 而块 API 返回的事务里 `undoOperations` **恒为空数组**。实测四种块操作：
 *
 *   insertBlock  事务字段 timestamp, doOperations, undoOperations   undoOperations 条数: 0
 *   deleteBlock  事务字段 timestamp, doOperations, undoOperations   undoOperations 条数: 0
 *   moveBlock    返回的 data 是 null（根本不返回事务）
 *   updateBlock  返回的 data 是 null
 *
 * 也就是说：**通过块 API 写出去的内容天生不进思源的 Ctrl+Z**。
 * 用户删错一个节点，按 Ctrl+Z 是没用的，那是不可逆的丢失。所以撤销只能由插件自己提供。
 *
 * ## 为什么用「整块快照」而不是「逐操作求逆」
 *
 * 结构操作有一堆边界：降级在「前一个兄弟还没有子列表」时会走副本路径、块 ID 会变；
 * 内核没有 `nextID`，「插到最前」表达不了……逐操作求逆要维护一大堆特例，
 * 而**撤销本身写错就等于再来一次数据丢失**，风险反而更高。
 *
 * 快照只有一条路径：把列表块的 kramdown 原样写回去。结构必然正确，
 * 而且实测还原时**还活着的子块 ID 全部保留**，列表块自己的 ID 也不变。
 *
 * ## 代价（明确写下来，别让它变成隐藏行为）
 *
 * 「被删掉再还原」的块会拿到**新块 ID** —— 内核不认 `{: id="…" }`，不会还原已删除块的旧 ID。
 * 因此指向这些块的引用（`((id))`）会失效，折叠状态也会丢。
 * 这个取舍是值得的：不可逆的丢失比失效的引用严重得多。
 */

export interface HistoryEntry {
    /** 操作发生在哪个列表块上 —— 撤销时要还原的是它 */
    listId: string;
    /** 操作名，用于提示文案 */
    label: string;
    /** 操作前的整块快照 */
    before: string;
    /** 操作后的整块快照（重做用） */
    after: string;
    /**
     * 块属性改动（目前只有「设置 / 清除标记」会用到）。
     *
     * 为什么不能只靠 kramdown 快照：实测（`tests/kernel/probe-kramdown-ial.mjs`）
     * `updateBlock(dataType:"markdown")` **保留块 ID，但会把自定义块属性丢掉** ——
     * 而 kramdown 的 IAL 里明明是有这个属性的（读得到、写不回）。
     * 所以属性类的改动必须在快照之外**单独带一份值**，还原时补写一次。
     */
    attrs?: { id: string; before: string | null; after: string | null };
}

export class History {
    private undoStack: HistoryEntry[] = [];
    private redoStack: HistoryEntry[] = [];
    private readonly limit: number;

    constructor(limit = 40) {
        this.limit = limit;
    }

    /** 记一次操作。before 与 after 相同（空操作）时不入栈 */
    push(entry: HistoryEntry) {
        if (entry.before === entry.after) return;
        this.undoStack.push(entry);
        if (this.undoStack.length > this.limit) this.undoStack.shift();
        // 新的操作让原来的重做链失效 —— 和所有编辑器的行为一致
        this.redoStack.length = 0;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /** 撤销栈深度（诊断面板用：Ctrl+Z「没反应」十有八九是栈空了） */
    get depth(): number {
        return this.undoStack.length;
    }

    /** 取出一条待撤销的记录，并把它挪到重做栈 */
    popUndo(): HistoryEntry | null {
        const e = this.undoStack.pop();
        if (!e) return null;
        this.redoStack.push(e);
        return e;
    }

    /** 取出一条待重做的记录，并把它挪回撤销栈 */
    popRedo(): HistoryEntry | null {
        const e = this.redoStack.pop();
        if (!e) return null;
        this.undoStack.push(e);
        return e;
    }

    /** 还原失败时把记录放回去，别让它凭空消失 */
    rollback(kind: "undo" | "redo") {
        const from = kind === "undo" ? this.redoStack : this.undoStack;
        const to = kind === "undo" ? this.undoStack : this.redoStack;
        const e = from.pop();
        if (e) to.push(e);
    }

    clear() {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }
}
