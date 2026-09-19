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
