/**
 * 设置面板的「侧边选项卡」布局。
 *
 * ## 为什么不能直接用思源的 Setting 做分组
 *
 * 思源给插件的 `Setting` 只有两个方法（`node_modules/siyuan/siyuan.d.ts`）：
 *
 * ```ts
 * addItem(options: { title, description?, actionElement?, createActionElement?, direction? }): void
 * open(name: string): void
 * ```
 *
 * **没有分组、没有选项卡，也不暴露 `dialog` / `element`** —— 构造函数里连
 * `cancelCallback` 都没有（这也是设置面板要走「草稿模型」的原因，见 `index.ts`
 * 的 `openSetting()`）。所以分组只能这么做：
 *
 *  1. 照常 `addItem()`，同时**按调用顺序**记下每条属于哪一组（`groupOf`）；
 *  2. `open()` 之后自己在 DOM 里找到 `.b3-dialog__content`；
 *  3. 把它的子元素按组**搬到**各自的 pane 里（`appendChild` 是移动，不是复制）。
 *
 * ## 失败必须「原样退回」，不能半途而废
 *
 * 第 3 步依赖思源渲染出的 DOM 形状（实测 3.8.5：`.b3-dialog__content` 的每个
 * 直接子元素是 `.fn__flex.b3-label.config-item`，顺序与 `addItem` 一致）。
 * 一旦思源改了实现，**最坏的结果不是「没分组」，而是设置项丢失或错位** ——
 * 用户只会发现某个开关不见了，却完全不知道为什么。
 *
 * 所以 `layoutSettingTabs()` 先做一遍**契约校验**（条数、类名、组名），
 * 任何一条不符就**一个节点都不动**、返回 `false`，让调用方保留思源原生的
 * 扁平列表。宁可丑，不能丢。
 */

/** 设置面板的分组。顺序即左侧导航的顺序 */
export type SetGroupId = "appearance" | "canvas" | "interact" | "perf" | "help";

/** 一个选项卡。文案已本地化，由调用方（`index.ts`）传进来 */
export interface SetTabMeta {
    id: SetGroupId;
    title: string;
    desc: string;
}

/**
 * 按「每条属于哪一组」把行分桶，**保持原有先后顺序**。
 *
 * 单独拆出来是因为它是这段逻辑里唯一**不碰 DOM** 的部分 —— 可以在
 * `tests/run.mjs` 的极简 DOM 模拟里直接测；而布局本身只能靠真机探针
 * （模拟 DOM 没有 `querySelectorAll` / `closest`，测了也是假绿）。
 */
export function bucketByGroup<T>(rows: T[], groupOf: SetGroupId[]): Map<SetGroupId, T[]> {
    const out = new Map<SetGroupId, T[]>();
    for (let i = 0; i < rows.length; i++) {
        const g = groupOf[i];
        if (g === undefined) continue; // 调用方已保证长度一致，这里只是兜底
        const arr = out.get(g);
        if (arr) arr.push(rows[i]);
        else out.set(g, [rows[i]]);
    }
    return out;
}

/**
 * 把思源 `Setting` 渲染出的扁平列表重构成「左侧选项卡 + 右侧内容区」。
 *
 * @param content 思源那个 `.b3-dialog__content`
 * @param groupOf 每条设置项的分组，**顺序必须与 `addItem` 调用顺序一致**
 * @param tabs    选项卡定义（顺序即导航顺序）
 * @returns 是否成功重构。`false` 表示**什么都没动**，调用方应保留扁平列表
 */
export function layoutSettingTabs(content: HTMLElement, groupOf: SetGroupId[], tabs: SetTabMeta[]): boolean {
    const rows = Array.from(content.children) as HTMLElement[];

    /* ─────────────────────────── 契约校验（先全部查完，再动 DOM） */

    // 条数：思源渲染出的行数必须与我们的调用次数一致
    if (rows.length === 0 || rows.length !== groupOf.length) return false;
    // 类名：每条都必须是思源标准的设置项容器。出现别的东西说明结构变了
    if (!rows.every((r) => r.classList?.contains("config-item"))) return false;
    // 组名：每条都要落在一个已知分组里，否则它会**在搬运中丢掉**
    const known = new Set<string>(tabs.map((x) => x.id));
    if (!groupOf.every((g) => known.has(g))) return false;

    /* ─────────────────────────── 校验通过，开始搬运 */

    const buckets = bucketByGroup(rows, groupOf);

    const nav = document.createElement("div");
    nav.className = "mm-set__nav";
    const panes = document.createElement("div");
    panes.className = "mm-set__panes";

    const activate = (id: SetGroupId) => {
        for (const b of Array.from(nav.children) as HTMLElement[]) {
            b.classList.toggle("mm-set__tab--on", b.dataset.group === id);
        }
        for (const p of Array.from(panes.children) as HTMLElement[]) {
            p.classList.toggle("mm-set__pane--on", p.dataset.group === id);
        }
    };

    const wired: Array<{ id: SetGroupId; btn: HTMLElement }> = [];
    let firstId: SetGroupId | null = null;

    for (const tab of tabs) {
        const items = buckets.get(tab.id);
        // 空分组不进导航 —— 点进去是一片空白，比没有这个选项卡更让人困惑
        if (!items || items.length === 0) continue;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mm-set__tab";
        btn.dataset.group = tab.id;
        btn.textContent = tab.title; // 文案可能被翻译者改，一律走 textContent
        nav.appendChild(btn);

        const pane = document.createElement("div");
        pane.className = "mm-set__pane";
        pane.dataset.group = tab.id;

        const head = document.createElement("div");
        head.className = "mm-set__head";
        const h = document.createElement("div");
        h.className = "mm-set__title";
        h.textContent = tab.title;
        const d = document.createElement("div");
        d.className = "mm-set__desc";
        d.textContent = tab.desc;
        head.appendChild(h);
        head.appendChild(d);
        pane.appendChild(head);

        // ⚠️ `appendChild` 是**移动**：这一步同时把行从 `content` 里摘出来。
        // 所有行都在某个 bucket 里（上面查过），所以搬完之后 `content` 必然为空。
        for (const it of items) pane.appendChild(it);
        panes.appendChild(pane);

        wired.push({ id: tab.id, btn });
        if (firstId === null) firstId = tab.id;
    }

    // 一条都没分出去 —— 只可能是 `tabs` 里没有 `groupOf` 用到的组，契约校验漏了这种情况
    if (firstId === null) return false;

    for (const w of wired) w.btn.onclick = () => activate(w.id);

    const wrap = document.createElement("div");
    wrap.className = "mm-set";
    wrap.appendChild(nav);
    wrap.appendChild(panes);
    content.classList.add("mm-set-host");
    content.appendChild(wrap);

    activate(firstId);
    return true;
}
