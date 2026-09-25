import { fetchPost, fetchSyncPost } from "siyuan";
import type { IWebSocketData } from "siyuan";
import type { MMSearchHit } from "../types";

/** 读取单个块的属性 */
export async function getBlockAttrs(id: string): Promise<Record<string, string>> {
    try {
        const res = await fetchSyncPost("/api/attr/getBlockAttrs", { id });
        return (res?.data ?? {}) as Record<string, string>;
    } catch (err) {
        console.warn("[mindmap] 读取块属性失败", id, err);
        return {};
    }
}

/** 批量读取块属性 */
export async function batchGetBlockAttrs(ids: string[]): Promise<Record<string, Record<string, string>>> {
    if (ids.length === 0) return {};
    try {
        const res = await fetchSyncPost("/api/attr/batchGetBlockAttrs", { ids });
        return (res?.data ?? {}) as Record<string, Record<string, string>>;
    } catch (err) {
        console.warn("[mindmap] 批量读取块属性失败", err);
        return {};
    }
}

/** 写入块属性，值为 null 表示删除该属性 */
export async function setBlockAttrs(id: string, attrs: Record<string, string | null>): Promise<void> {
    try {
        await fetchSyncPost("/api/attr/setBlockAttrs", { id, attrs });
    } catch (err) {
        console.warn("[mindmap] 写入块属性失败", id, err);
    }
}

/** 让编辑器滚动并高亮到指定块 */
export function scrollToBlock(id: string) {
    const el = document.querySelector<HTMLElement>(`.protyle-wysiwyg [data-node-id="${id}"]`);
    if (!el) return;

    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("mm-flash");
    window.setTimeout(() => el.classList.remove("mm-flash"), 1400);
}

/* ==================================================================== 块操作 */

/**
 * 用 markdown 更新块内容。
 * 注意：会重建该块的内部结构，行内格式（加粗、行内代码等）按传入的 markdown 重新解析。
 */
export async function updateBlock(id: string, markdown: string): Promise<boolean> {
    try {
        const res = await fetchSyncPost("/api/block/updateBlock", {
            dataType: "markdown",
            data: markdown,
            id,
        });
        return res?.code === 0;
    } catch (err) {
        console.warn("[mindmap] 更新块失败", id, err);
        return false;
    }
}

/* ==================================================================== 折叠 */

/**
 * 折叠 / 展开大纲里的一个列表项（思源**原生**折叠）。
 *
 * 这是「导图 ↔ 大纲 折叠状态双向同步」的写入侧。实测（思源 3.8.4）：
 * `foldBlock` 会把 `fold="1"` 同时写进三处 ——
 *
 *   DOM      `<div class="li" … fold="1">`
 *   块属性    `{ fold: "1", id: …, updated: … }`
 *   kramdown  `- {: id="…" fold="1"}内容`
 *
 * kramdown 里那一份会随文档存进 `.sy`，**思源自己就把它持久化了**。
 * 所以不需要我们再往 `custom-*` 里存一份，也就天然满足
 * 「用户离开时什么状态，下次进来就是什么状态」——
 * 而且这个状态是大纲与导图共用的同一个，不会各说各话。
 *
 * 注意内核**没有批量接口**（`batchFoldBlock` 不存在），折叠全部要逐个调。
 *
 * ## ⚠️⚠️ 这里必须用**异步**的 `fetchPost`，不能跟本文件其它地方一样用 `fetchSyncPost`
 *
 * 同步 XHR 会把**渲染进程的主线程**整个卡住 —— 实测 `/api/block/foldBlock`
 * 在内核同时重渲染那个块时要 **~490ms** 才返回。
 *
 * 而折叠是**批量**的：一次「折叠全部」就是 9 次写回，加上核对重试最多 18 次。
 * 同步发就是 **18 × 490ms ≈ 9 秒界面完全冻死**。后果不止是卡：
 *   · 导图是渲染在 Protyle 的可编辑块里的，写回会让 Protyle 换掉整个 `.list`，
 *     旧元素连同 `.mm-root`、**连同搜索输入框**一起脱离文档；
 *   · 而重挂要靠一次扫描 —— 主线程被同步 XHR 占满时，**扫描根本排不上队**，
 *     于是导图消失 8–15 秒（实测），期间敲的字全部落空。
 *
 * 改成异步之后这些请求并发在途，主线程一毫秒都不占。
 * 调用方（`scanner.writeFold`）本来就是 `await` + 700ms 后再核对，
 * 换成异步不影响任何时序保证。
 *
 * ## ⚠️⚠️ 但 `fetchPost` 是**回调式**的，不能直接 `await`
 *
 * `siyuan.d.ts` 里的签名：
 *
 *     export function fetchPost(
 *         url: string, data?: any,
 *         cb?: (response: IWebSocketData) => void,
 *         headers?: IObject,
 *         failCallback?: (response: IWebSocketData) => void,
 *     ): void;
 *
 * 它**返回 `void`**、结果走第三个参数的回调。`await fetchPost(...)` 拿到的是
 * `undefined`，于是 `res?.code === 0` 恒为 `false` —— 每一次折叠都被判成失败，
 * 上层（`scheduleFoldReconcile`）就会重试，等于把同步那 9 秒的冻结原样搬了回来，
 * 还额外刷了 9 条「折叠写回失败」的警告。踩过一次，记在这儿。
 *
 * 所以下面手工把它包成 Promise（`settled` 保证只结算一次：
 * 内核既可能走 `cb` 也可能走 `failCallback`，还有可能两个都不来）。
 */
function postAsync(url: string, data: Record<string, unknown>): Promise<IWebSocketData | undefined> {
    return new Promise((resolve) => {
        let settled = false;
        const done = (res: IWebSocketData | undefined) => {
            if (settled) return;
            settled = true;
            resolve(res);
        };
        try {
            fetchPost(url, data, done, undefined, () => done(undefined));
        } catch (err) {
            console.warn("[mindmap] 异步请求发送失败", url, err);
            done(undefined);
        }
    });
}

export async function setOutlineFold(id: string, folded: boolean): Promise<boolean> {
    const url = folded ? "/api/block/foldBlock" : "/api/block/unfoldBlock";
    try {
        const res = await postAsync(url, { id });
        if (res?.code !== 0) {
            console.warn("[mindmap] 写入大纲折叠状态被内核拒绝", id, folded, res?.code, res?.msg);
            return false;
        }
        return true;
    } catch (err) {
        console.warn("[mindmap] 写入大纲折叠状态失败", id, folded, err);
        return false;
    }
}

/* ==================================================================== 快照 */

/**
 * 取块的 kramdown 原文（含 `{: id="…" }` 之类的块属性）。
 *
 * 实测：把这段原文再喂回 `/api/block/updateBlock`（`dataType: "markdown"`）能还原结构，
 * 列表块自己的 ID 不变，**还活着的子块 ID 也全部保留**，只有「删掉又还原」的块会拿到新 ID
 * （内核不认 `{: id=… }`，不会还原已删除块的旧 ID）。
 *
 * 所以它适合当撤销的快照。但**一次写回并不保证成功**，见 restoreBlock。
 * 注意 `dataType: "kramdown"` 在 3.8.4 上是**不支持的**（报 `unsupported block data type`），
 * 必须走 markdown。
 */
export async function getBlockKramdown(id: string): Promise<string | null> {
    try {
        const res = await fetchSyncPost("/api/block/getBlockKramdown", { id });
        if (res?.code !== 0) return null;
        const kramdown = (res?.data as { kramdown?: unknown })?.kramdown;
        return typeof kramdown === "string" && kramdown ? kramdown : null;
    } catch (err) {
        console.warn("[mindmap] 读取块 kramdown 失败", id, err);
        return null;
    }
}

/**
 * 用快照原文还原一个块。
 *
 * ⚠️ **必须写两次。一次不够。**
 *
 * 实测（`tests/probe-restore.mjs`，形态：带子列表的列表项后面又跟同级项）：
 * 一次 `updateBlock(listId, kramdown)` 之后，**最后一个列表项的段落子块会脱开**，
 * 落成一个「有内容、没有段落」的坏列表项 —— `/api/block/getChildBlocks` 读它
 * 读不出文字，导图里就等于凭空少一个节点。
 *
 * 真机验收里「Ctrl+Z 撤销删除节点」就是这么失败的：写回载荷 7 个节点一个不少、
 * `code` 也是 0，落库后却只有 6 个。第二次喂同样的内容就能完全还原。
 *
 * 顺带记下几条排查时验证过、**不成立**的路子，免得以后重复踩：
 *   - 不是「快照里含已删块 ID」导致的：把 `{: id=… }` 全剥掉再喂，一样坏；
 *   - kramdown 层面**看不出**这个缺陷：坏状态读回来的 kramdown 和目标的
 *     `{: … }` 块属性行数一模一样（11 行），比对字符串完全无从下手；
 *   - 只有「有子列表的项后面还跟同级项」这种形态会中招，扁平列表一次就够。
 *
 * 所以这里不做什么「读回来比对再重试」——没有可用的判据，直接写两次。
 * 第二次是幂等的：此时各块的归属已经一致，再喂一遍不会产生新的错位。
 */
export async function restoreBlock(id: string, kramdown: string, times = 2): Promise<boolean> {
    for (let i = 0; i < times; i++) {
        if (!(await updateBlock(id, kramdown))) return false;
    }
    return true;
}

export interface InsertBlockOptions {
    /** markdown 内容 */
    data: string;
    /** 目标父块：单独指定时追加到末尾 */
    parentID?: string;
    /** 插入到该块之后 */
    previousID?: string;
    /** 插入到该块之前 */
    nextID?: string;
}

/**
 * 从块操作接口的响应里取出新块的 ID。
 *
 * ⚠️ 这里踩过一个坑：`data` 在不同思源版本里**既可能是数组、也可能是
 * `{ transactions: [...] }`**。实测 3.8.4 返回的是数组，早期按
 * `data.transactions[0]` 取值永远拿不到东西 —— 插入明明成功（code === 0），
 * 却因为返回 null 被上层判定为失败，界面一直弹「操作未生效，请重试」。
 *
 * 另外，插入列表时 `op.id` 可能是**外层的 NodeList**，而导图要的是里面的
 * **NodeListItem**（列表项才是导图里的一个节点），所以优先从 op.data 的
 * HTML 里把 NodeListItem 的 ID 抠出来。
 */
function extractInsertedId(res: unknown): string | null {
    const data = (res as { data?: unknown })?.data;
    const txns = Array.isArray(data)
        ? data
        : ((data as { transactions?: unknown[] })?.transactions ?? []);

    for (const txn of txns) {
        for (const op of (txn as { doOperations?: unknown[] })?.doOperations ?? []) {
            const html = (op as { data?: unknown })?.data;
            if (typeof html === "string") {
                const li = html.match(/data-node-id="([^"]+)"[^>]*data-type="NodeListItem"/);
                if (li) return li[1];
            }
            const id = (op as { id?: unknown })?.id;
            if (typeof id === "string" && id) return id;
        }
    }
    return null;
}

/**
 * 插入块。成功返回新块 ID（**取不到 ID 时返回空串**，空串仍然代表成功），失败返回 null。
 *
 * 调用方判断成败请一律用 `!== null`，不要用真假值 —— 否则「插进去了但没拿到 ID」
 * 会被误判成失败。
 */
export async function insertBlock(opts: InsertBlockOptions): Promise<string | null> {
    const payload: Record<string, string> = { dataType: "markdown", data: opts.data };
    if (opts.previousID) payload.previousID = opts.previousID;
    else if (opts.nextID) payload.nextID = opts.nextID;
    if (opts.parentID) payload.parentID = opts.parentID;

    try {
        const res = await fetchSyncPost("/api/block/insertBlock", payload);
        if (res?.code !== 0) {
            console.warn("[mindmap] 插入块被内核拒绝", res?.code, res?.msg, payload);
            return null;
        }
        // code === 0 就代表插入成功；ID 只是尽力而为的附加信息
        return extractInsertedId(res) ?? "";
    } catch (err) {
        console.warn("[mindmap] 插入块失败", err);
        return null;
    }
}

/** 删除块（连同其子块） */
export async function deleteBlock(id: string): Promise<boolean> {
    try {
        const res = await fetchSyncPost("/api/block/deleteBlock", { id });
        return res?.code === 0;
    } catch (err) {
        console.warn("[mindmap] 删除块失败", id, err);
        return false;
    }
}

export interface MoveBlockOptions {
    /** 要移动的块 */
    id: string;
    /** 新的父块：单独指定时移动到其子节点末尾 */
    parentID?: string;
    /** 移动到该块之后 */
    previousID?: string;
}

/**
 * 移动块。
 * 注意内核只提供「移动到某块之后」与「移动到某父块末尾」两种定位方式，
 * 没有「移动到某块之前」——需要「上移」这类语义时，改为移动它的邻居。
 */
export async function moveBlock(opts: MoveBlockOptions): Promise<boolean> {
    const payload: Record<string, string> = { id: opts.id };
    if (opts.parentID) payload.parentID = opts.parentID;
    if (opts.previousID) payload.previousID = opts.previousID;

    try {
        const res = await fetchSyncPost("/api/block/moveBlock", payload);
        return res?.code === 0;
    } catch (err) {
        console.warn("[mindmap] 移动块失败", opts, err);
        return false;
    }
}

/* ==================================================================== 待办勾选 */

/**
 * 切换一个任务列表项的勾选态。
 *
 * ⚠️ **必须走这个专用接口**，两条看起来更直觉的路都是错的，实测记录：
 *
 * 1. `/api/block/updateBlock` + `dataType: "markdown"` 往**列表项**写 `- [x] 文字`
 *    —— 勾选态确实变了，但该列表项的**子列表被整段冲掉**。
 *    实测「有子项的任务」勾一下，它下面的「它的子条目」直接消失。
 * 2. `setBlockAttrs` 写 `data-task` —— 内核直接拒绝：
 *
 *        setting or removing [data-task] attribute is not allowed via this interface.
 *        Please use "/api/block/updateTaskListItemMarker" ...
 *
 *    这条报错反倒把正确接口报了出来。
 *
 * `marker` 用 `" "` 表示未勾选，其它字符表示已勾选（实测传 `"x"` 会落成 kramdown 里的 `[X]`）。
 * 子列表不受影响，块 ID 也不变 —— 引用与反链都安全。
 */
export async function setTaskMarker(id: string, checked: boolean): Promise<boolean> {
    try {
        const res = await fetchSyncPost("/api/block/updateTaskListItemMarker", {
            id,
            marker: checked ? "x" : " ",
        });
        return res?.code === 0;
    } catch (err) {
        console.warn("[mindmap] 写入待办勾选态失败", id, checked, err);
        return false;
    }
}

/**
 * 批量勾选 / 取消勾选。
 *
 * 内核有专门的批量接口（`items: [{ id, marker }]`），一次往返搞定，
 * 不必像折叠那样逐条打 —— 这也是「批量操作整体成功或整体回滚」最好实现的形态：
 * 内核自己就是一次事务，不存在「改了一半」的中间态。
 *
 * **形状只有 `items` 一种**（`tests/kernel/probe-batch-marker-shape.mjs` 实测）：
 *   ✔ `{ items: [{ id, marker }, …] }`
 *   ✘ `{ ids: [...], marker }`   → `code:-1 Field [items] is required`
 *   ✘ `{ id, marker }`           → 同上（这里没有单条简写）
 *   ✘ `{ items: ["id1", …] }`    → `cannot unmarshal string into … map[string]json.RawMessage`
 * 传错形状**不会抛异常**，只是静默不生效 —— 所以别改这个形状。
 */
export async function setTaskMarkers(ids: string[], checked: boolean): Promise<boolean> {
    if (ids.length === 0) return true;
    try {
        const res = await fetchSyncPost("/api/block/batchUpdateTaskListItemMarker", {
            items: ids.map((id) => ({ id, marker: checked ? "x" : " " })),
        });
        return res?.code === 0;
    } catch (err) {
        console.warn("[mindmap] 批量写入待办勾选态失败", ids.length, checked, err);
        return false;
    }
}

/* ==================================================================== 文档 */

/**
 * 跨图搜索：在这篇文档的**所有导图列表**里找节点。
 *
 * 为什么走 SQL 而不是逐张图 `getBlockKramdown` + 解析：
 * 文档里可能有十几张导图、上百个节点，逐张拉 kramdown 就是十几个往返，
 * 而且还得在插件里再写一遍 kramdown 解析（`parseList` 要 DOM，那些列表块
 * 并不在页面上，用不了）。一次 SQL 把 `l` / `i` 两种块连同 `parent_id` 一起拿回来，
 * 在内存里拼出父子关系即可 —— 一个往返，零解析。
 *
 * 只认 `custom-mindmap` 属性标记过的列表（值是什么无所谓，logic / mind / tree 都算），
 * 所以「文档里没被转成导图的列表」不会混进结果里 —— 用户在这个框里搜的
 * 是「我的导图」，不是「我的文档」。
 *
 * ★ 取文字用的是 **`fcontent`，不是 `content` / `markdown`**。
 *   `tests/kernel/probe-sql-item-content.mjs` 实测：对列表项（type='i'），
 *   `content` 与 `markdown` 都把**整棵子树**拼在一起 ——
 *   一个内容只有「第二章」的父项，`content` 是 `" 第二章 跨图目标节点"`。
 *   拿它匹配关键词的话，搜任何子节点都会把沿途所有祖先一起搜出来，
 *   结果列表里全是「父节点」这种假命中。`fcontent` 才是该项自己的文字。
 *
 * @param listId 当前列表块 ID —— 文档靠它反查（`root_id`），调用方不用自己去查文档
 * @param q      关键词（大小写不敏感）
 */
export async function searchDocOutline(listId: string, q: string): Promise<MMSearchHit[]> {
    const needle = q.trim().toLowerCase();
    if (!listId || !needle) return [];

    let rows: Array<Record<string, string>> = [];
    try {
        // 一次拿全：列表块（判是不是导图）+ 列表项块（判内容 + 拼路径）。
        // 文档靠子查询反查 `root_id`，省掉一次往返。
        // 文档规模上限就是几千个块，`limit` 给足；再大的文档也不该拿来做导图。
        const res = await fetchSyncPost("/api/query/sql", {
            stmt:
                `select id, parent_id, type, fcontent, ial from blocks ` +
                `where root_id = (select root_id from blocks where id = '${listId.replace(/'/g, "''")}') ` +
                `and type in ('l', 'i') limit 5000`,
        });
        rows = (res?.data ?? []) as Array<Record<string, string>>;
    } catch (err) {
        console.warn("[mindmap] 跨图搜索失败", err);
        return [];
    }

    const listOf = new Map<string, string>();
    const itemOf = new Map<string, { parent: string; text: string }>();
    const isMapList = new Set<string>();
    for (const r of rows) {
        if (r.type === "l") {
            listOf.set(r.id, r.parent_id ?? "");
            if ((r.ial ?? "").includes("custom-mindmap")) isMapList.add(r.id);
        } else if (r.type === "i") {
            itemOf.set(r.id, { parent: r.parent_id ?? "", text: (r.fcontent ?? "").trim() });
        }
    }

    const out: MMSearchHit[] = [];
    for (const [id, item] of itemOf) {
        if (!item.text.toLowerCase().includes(needle)) continue;

        // 从列表项往上走，一边攒路径一边找「归属的那张导图」。
        // 走到顶层（parent 不在 blocks 里，即文档块）还没碰到导图列表，就说明
        // 这个节点属于一个没被转成导图的列表 —— 直接丢弃。
        const chain = [item.text];
        let cur = item.parent;
        let owner = "";
        for (let guard = 0; guard < 64 && cur; guard++) {
            const list = listOf.get(cur);
            if (list === undefined) break; // 不是列表块，说明已经走出去了
            if (isMapList.has(cur)) {
                owner = cur;
                break;
            }
            // 走到上一层的列表项，继续往上
            const up = itemOf.get(list);
            if (!up) break;
            chain.unshift(up.text);
            cur = up.parent;
        }
        if (!owner) continue;

        out.push({ id, text: item.text, listId: owner, path: chain.join(" › ") });
    }

    // 命中多的场合，短的（更靠近根）排前面 —— 用户多半在找「那一大类」
    out.sort((a, b) => a.path.length - b.path.length);
    return out.slice(0, 50);
}

/**
 * 内核版本（诊断信息用）。
 *
 * 缓存住：诊断面板可能被反复点，版本号在一次会话里不会变。
 * 拿不到就返回空串 —— 诊断信息缺一行，总比整个「复制诊断」按钮报错强。
 */
let cachedVersion = "";
export async function getKernelVersion(): Promise<string> {
    if (cachedVersion) return cachedVersion;
    try {
        const res = await fetchSyncPost("/api/system/version", {});
        cachedVersion = String(res?.data ?? "");
    } catch (err) {
        console.warn("[mindmap] 读取内核版本失败", err);
    }
    return cachedVersion;
}

/** 取编辑器文档标题 */
// i18n-audit-ignore-start
/**
 * 取编辑器文档标题。
 *
 * `fallback` 由调用方传入 i18n 化后的值（默认值是「没有标题时兜底」，
 * 只有调用方忘了传才会用上，所以留中文即可）。
 */
export function getDocTitle(scope: HTMLElement | null, fallback = "导图"): string {
    const protyle = scope?.closest(".protyle") ?? document.querySelector(".protyle");
    const title = protyle?.querySelector<HTMLElement>(".protyle-title");
    const text = title?.textContent?.trim();
    return text || fallback;
}
// i18n-audit-ignore-end

/** 把文本写入剪贴板，带 execCommand 兜底（非安全上下文下 navigator.clipboard 不可用） */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        /* 落到兜底分支 */
    }

    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
    } catch {
        return false;
    }
}
