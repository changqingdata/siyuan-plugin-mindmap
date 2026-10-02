/**
 * 浏览器可视化验证用的 siyuan 桩模块。
 * 只提供 renderer / exporter 真正用到的那几个符号。
 */
export class Menu {
    constructor(public id?: string) {}
    addItem() {}
    open() {}
}

export class Dialog {
    constructor() {}
    destroy() {}
}

export class Setting {
    constructor() {}
    addItem() {}
    open() {}
}

export class Plugin {}

export function showMessage() {}
export function getFrontend() {
    return "desktop";
}
export function getBackend() {
    return "windows";
}
export async function fetchSyncPost() {
    return { code: 0, data: {} };
}

/**
 * `fetchPost` 是**回调式**的（返回 `void`，不是 Promise）—— 桩要照着这个形状写，
 * 不能图省事写成 async 函数：`searchRefBlocks` 里 `await` 不了它，
 * 桩的签名一旦与真货不符，`visual.mjs` 会在 esbuild 那一步就报
 * 「No matching export」，而不是在页面上悄悄失效。
 *
 * 这里直接回调空结果：验证页不连内核，块引用搜索本来就没有候选。
 */
export function fetchPost(_url: string, _data: unknown, callback?: (res: { code: number; data: unknown[] }) => void) {
    callback?.({ code: 0, data: [] });
}
