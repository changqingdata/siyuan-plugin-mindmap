/**
 * 快捷键速查的**数据**。渲染在 `index.ts`（它才拿得到 `t`）。
 *
 * ## 为什么要从「12 条长句」改成「分组 + 行」
 *
 * 老实现是 12 条长句，每句把一组键位用 ` · ` 串起来，然后用 `showMessage`
 * 弹一条 12 秒的通知。三个问题叠在一起：
 *
 *  1. **通知不是给人读文档的地方** —— 它 12 秒后自己消失，想对着按都来不及；
 *  2. **一条长句读不出「哪个键对应哪个作用」** —— `↑↓ 同级 · ← 父节点 · → 第一个子节点`
 *     里的分隔符和键位混在一起，眼睛得来回找；
 *  3. **换行是通知自己折的** —— 折在哪全看窗口宽度，跟语义无关。
 *
 * 现在拆成「分组 → 行」，每行**键位与作用各占一列**，渲染成表格。
 *
 * ## 键位是字面量，作用才翻译
 *
 * `Tab` / `Ctrl+C` / `F2` 这些**不翻译** —— 它们在所有语言里都这么写，
 * 翻译只会让用户在自己的键盘上找不到。只有两处例外走占位符：
 *  `{space}`（空格 / Space）、`{toggle}` `{side}`（平台相关的全局键位）。
 *
 * ## `SHORTCUT_KEYS` 与 `SHORTCUT_GROUPS` 为什么要分成两份
 *
 * `scripts/i18n-keys.mjs` 的 `KEYED_PAIRS` 读的是 `[键, 中文兜底]` 这种扁平数组
 * （它不认识嵌套结构）。所以把「键 + 兜底」单独放一份给审计读，
 * 结构那份只写**键名**与字面键位 —— 两边靠键名对齐。
 *
 * ⚠️ 加/改行时**两份都要动**：只在 `SHORTCUT_GROUPS` 里加一行而忘了
 * `SHORTCUT_KEYS`，审计就查不到这个键 → 中文界面靠 `SHORTCUT_KEYS` 兜底会退回键名本身，
 * 而英文词表更会直接缺键。`--verify` 只能拦住后者。
 */

/** 一行：`k` 是字面键位（或 `{space}` 这类占位符），`d` 是 i18n 键名 */
export interface ShortcutRow {
    k: string;
    d: string;
}

export interface ShortcutGroup {
    /** 分组标题的 i18n 键名 */
    t: string;
    /** 分组补充说明（可选，也是 i18n 键名） */
    note?: string;
    rows: ShortcutRow[];
}

/**
 * 键名 → 内置中文兜底。给审计脚本读，也给运行时当兜底。
 * 顺序就是界面上的顺序，不要重排。
 */
export const SHORTCUT_KEYS: Array<[string, string]> = [
    ["sc.nav", "导航"],
    ["sc.nav.ud", "同级上 / 下"],
    ["sc.nav.parent", "父节点"],
    ["sc.nav.child", "第一个子节点"],
    ["sc.nav.ends", "跳到首 / 尾"],
    ["sc.nav.fold", "折叠 / 展开"],

    ["sc.edit", "编辑"],
    ["sc.edit.child", "加子节点"],
    ["sc.edit.outdent", "降级为上一个节点的子节点"],
    ["sc.edit.sibling", "加同级"],
    ["sc.edit.rename", "改名"],
    ["sc.edit.delete", "删除节点"],
    ["sc.edit.level", "升级 / 降级"],
    ["sc.edit.move", "上移 / 下移"],

    ["sc.todo", "待办"],
    ["sc.todo.toggle", "勾选 / 取消勾选选中的待办节点"],
    ["sc.todo.click", "也可以直接点节点上的复选框"],

    ["sc.clip", "剪贴"],
    ["sc.clip.copy", "复制子树"],
    ["sc.clip.paste", "粘贴为子节点"],
    ["sc.clip.cut", "剪切"],
    ["sc.clip.dup", "快速复制"],

    ["sc.view", "视图"],
    ["sc.view.zoom", "缩放"],
    ["sc.view.fit", "适应画布"],
    ["sc.view.actual", "回到 100%"],
    ["sc.view.search", "打开搜索框"],
    ["sc.view.full", "全屏"],
    ["sc.view.exit", "退出（关闭全屏 / 结束演示）"],

    ["sc.search", "搜索"],
    ["sc.search.scope", "切换搜索范围：全文档会在本文档所有导图里找，结果点一下就跳过去"],

    ["sc.filter", "过滤"],
    ["sc.filter.kind", "工具条上的「全部 / 未完成 / 已完成」，只看某一类待办"],

    ["sc.focus", "聚焦"],
    ["sc.focus.enter", "只看这一个分支（也可以右键节点 →「聚焦此分支」）"],
    ["sc.focus.exit", "逐层返回上一级"],

    ["sc.multi", "多选"],
    ["sc.multi.box", "拖动框选"],
    ["sc.multi.add", "加选 / 减选"],
    ["sc.multi.all", "全选同级（再按一次选中整棵树）"],
    ["sc.multi.note", "选中 2 个以上会浮出批量操作条：升级 / 降级 / 折叠 / 待办完成 / 导出 / 删除"],

    ["sc.mark", "标记"],
    ["sc.mark.menu", "可挂图标 / 标签 / 自定义色；存在块属性里，复制块、导出、换设备都跟着走"],

    ["sc.present", "演示"],
    ["sc.present.next", "推进"],
    ["sc.present.prev", "回退"],
    ["sc.present.exit", "退出（不修改文档内容）"],

    ["sc.global", "全局"],
    ["sc.global.note", "在文档任意位置都生效，可在「设置 → 快捷键」里改"],
    ["sc.global.toggle", "把光标所在的列表切换为导图 / 大纲"],
    ["sc.global.side", "并排面板打开导图"],

    ["sc.dlgTitle", "快捷键速查"],
    ["sc.dlgHint", "在导图内单击任意节点即可用键盘操作。下面按分组列出，键位与作用一一对应。"],
    ["sc.colKey", "键位"],
    ["sc.colWhat", "作用"],
    ["sc.none", "菜单操作"],
];

/** 运行时兜底表（键名 → 中文）。审计脚本读的是 `SHORTCUT_KEYS` 本身。 */
export const SHORTCUT_FALLBACK: Record<string, string> = Object.fromEntries(SHORTCUT_KEYS);

/**
 * 分组结构。`k` 里的占位符由渲染方替换：
 *  `{space}` 空格 / Space、`{toggle}` 切换导图、`{side}` 并排面板。
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        t: "sc.nav",
        rows: [
            { k: "↑ / ↓", d: "sc.nav.ud" },
            { k: "←", d: "sc.nav.parent" },
            { k: "→", d: "sc.nav.child" },
            { k: "Home / End", d: "sc.nav.ends" },
            { k: "{space}", d: "sc.nav.fold" },
        ],
    },
    {
        t: "sc.edit",
        rows: [
            { k: "Tab", d: "sc.edit.child" },
            { k: "Shift + Tab", d: "sc.edit.outdent" },
            { k: "Enter", d: "sc.edit.sibling" },
            { k: "F2", d: "sc.edit.rename" },
            { k: "Delete / Backspace", d: "sc.edit.delete" },
            { k: "Alt + ← / →", d: "sc.edit.level" },
            { k: "Ctrl + ↑ / ↓", d: "sc.edit.move" },
        ],
    },
    {
        t: "sc.todo",
        rows: [
            { k: "X", d: "sc.todo.toggle" },
            { k: "", d: "sc.todo.click" },
        ],
    },
    {
        t: "sc.clip",
        rows: [
            { k: "Ctrl + C", d: "sc.clip.copy" },
            { k: "Ctrl + V", d: "sc.clip.paste" },
            { k: "Ctrl + X", d: "sc.clip.cut" },
            { k: "Ctrl + D", d: "sc.clip.dup" },
        ],
    },
    {
        t: "sc.view",
        rows: [
            { k: "Ctrl + = / -", d: "sc.view.zoom" },
            { k: "Ctrl + 0", d: "sc.view.fit" },
            { k: "Ctrl + 1", d: "sc.view.actual" },
            { k: "Ctrl + F", d: "sc.view.search" },
            { k: "F", d: "sc.view.full" },
            { k: "Esc", d: "sc.view.exit" },
        ],
    },
    {
        t: "sc.search",
        rows: [{ k: "", d: "sc.search.scope" }],
    },
    {
        t: "sc.filter",
        rows: [{ k: "", d: "sc.filter.kind" }],
    },
    {
        t: "sc.focus",
        rows: [
            { k: "Ctrl / ⌘ + 双击", d: "sc.focus.enter" },
            { k: "Esc", d: "sc.focus.exit" },
        ],
    },
    {
        t: "sc.multi",
        note: "sc.multi.note",
        rows: [
            { k: "Shift + 拖动", d: "sc.multi.box" },
            { k: "Ctrl + 单击", d: "sc.multi.add" },
            { k: "Ctrl + A", d: "sc.multi.all" },
        ],
    },
    {
        t: "sc.mark",
        rows: [{ k: "", d: "sc.mark.menu" }],
    },
    {
        t: "sc.present",
        rows: [
            { k: "→ / {space} / PageDown", d: "sc.present.next" },
            { k: "← / PageUp", d: "sc.present.prev" },
            { k: "Esc", d: "sc.present.exit" },
        ],
    },
    {
        t: "sc.global",
        note: "sc.global.note",
        rows: [
            { k: "{toggle}", d: "sc.global.toggle" },
            { k: "{side}", d: "sc.global.side" },
        ],
    },
];
