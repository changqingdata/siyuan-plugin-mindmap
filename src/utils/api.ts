import { fetchSyncPost } from "siyuan";

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

/* ==================================================================== 文档 */

/** 取编辑器文档标题 */
export function getDocTitle(scope: HTMLElement | null): string {
    const protyle = scope?.closest(".protyle") ?? document.querySelector(".protyle");
    const title = protyle?.querySelector<HTMLElement>(".protyle-title");
    const text = title?.textContent?.trim();
    return text || "导图";
}

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
