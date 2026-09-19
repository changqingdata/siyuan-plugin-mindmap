import { PLUGIN_CSS } from "../generated/style";
import { readResolvedVars, THEME_VARS } from "./theme";

/**
 * 导出：把当前导图视图序列化为独立 SVG / PNG。
 *
 * 做法：连线层直接复制 <path>（坐标系一致），节点层用 <foreignObject> 包住，
 * 并把插件样式表内联进 <svg>，同时把 --mm-* 变量解析成具体值，
 * 这样导出的文件脱离思源环境也能完整还原外观。
 */

function worldParts(rootEl: HTMLElement) {
    const world = rootEl.querySelector<HTMLElement>(".mm-world");
    const edges = rootEl.querySelector<SVGSVGElement>(".mm-edges");
    const nodes = rootEl.querySelector<HTMLElement>(".mm-nodes");
    if (!world || !edges || !nodes) throw new Error("导图尚未渲染完成");
    return { world, edges, nodes };
}

/** 把 var(--x) 递归解析为具体值，作为 getComputedStyle 的兜底 */
function resolveCssValue(value: string, depth = 0): string {
    if (depth > 6 || !value.includes("var(")) return value;
    const next = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_m, name: string, fallback: string) => {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback || "";
    });
    return next === value ? value : resolveCssValue(next, depth + 1);
}

function escapeAttr(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export function buildSvg(rootEl: HTMLElement): string {
    const { world, edges, nodes } = worldParts(rootEl);

    const W = Math.ceil(parseFloat(world.style.width) || world.offsetWidth);
    const H = Math.ceil(parseFloat(world.style.height) || world.offsetHeight);

    // 解析主题变量
    const vars = readResolvedVars(rootEl);
    const styleVars = THEME_VARS.filter((v) => v !== "--mm-font" && vars[v])
        .map((v) => `${v}:${resolveCssValue(vars[v])}`)
        .join(";");

    const bg = resolveCssValue(vars["--mm-canvas-solid"] ?? "#ffffff");
    const font = resolveCssValue(vars["--mm-font"] ?? "sans-serif");

    const nodeHtml = nodes.innerHTML;

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
        `<style><![CDATA[`,
        PLUGIN_CSS,
        `.mm-root.mm-export{display:block;position:relative;width:${W}px;height:${H}px;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;background:transparent;}`,
        `.mm-root.mm-export .mm-nodes{position:absolute;left:0;top:0;}`,
        `.mm-root.mm-export .mm-toolbar,.mm-root.mm-export .mm-viewport{display:none;}`,
        `]]></style>`,
        `<rect x="0" y="0" width="${W}" height="${H}" fill="${escapeAttr(bg)}"/>`,
        `<g class="mm-edges">${edges.innerHTML}</g>`,
        `<foreignObject x="0" y="0" width="${W}" height="${H}">`,
        `<div xmlns="http://www.w3.org/1999/xhtml" class="mm-root mm-export" style="${escapeAttr(styleVars)};--mm-font:${escapeAttr(font)}">`,
        `<div class="mm-nodes">${nodeHtml}</div>`,
        `</div>`,
        `</foreignObject>`,
        `</svg>`,
    ].join("");
}

function safeName(title: string): string {
    const base = (title || "mindmap").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
    return base || "mindmap";
}

function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportSvg(rootEl: HTMLElement, title: string): Promise<void> {
    const svg = buildSvg(rootEl);
    download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeName(title)}.svg`);
}

export async function exportPng(rootEl: HTMLElement, title: string, scale = 2): Promise<void> {
    const svg = buildSvg(rootEl);
    const { world } = worldParts(rootEl);
    const W = Math.ceil(parseFloat(world.style.width) || world.offsetWidth);
    const H = Math.ceil(parseFloat(world.style.height) || world.offsetHeight);

    // 限制画布总像素，避免超出浏览器上限
    const maxSide = 8192;
    const s = Math.min(scale, maxSide / Math.max(W, H), 1);

    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
        const img = await loadImage(url);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(W * s));
        canvas.height = Math.max(1, Math.round(H * s));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("无法创建 canvas 上下文");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("PNG 编码失败");
        download(blob, `${safeName(title)}.png`);
    } finally {
        URL.revokeObjectURL(url);
    }
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("SVG 光栅化失败"));
        img.src = src;
    });
}
