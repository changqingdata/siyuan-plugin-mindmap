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

/**
 * 把节点 HTML 里对**宿主变量**（`--b3-*`）的引用解析成具体色值。
 *
 * 文字颜色 / 背景色 / 字号是思源写在行内 style 里的，形如
 *   <span data-type="text" style="color: var(--b3-font-color1)">
 * 在思源页面里这些变量有值，所以看起来正常；**一旦导出到思源之外就全变黑**。
 * 导出发生在思源页面里，此刻 `getComputedStyle(documentElement)` 能读到真实值，
 * 顺手固化下来即可。
 */
function inlineHostVars(html: string): string {
    return html.replace(/style="([^"]*)"/g, (whole, css: string) => {
        if (!css.includes("var(--b3-")) return whole;
        const resolved = css.replace(
            /var\(\s*(--b3-[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
            (_m, name: string, fallback: string) => {
                const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
                // 兜底用 inherit 而不是空串 —— 空串会让整条声明失效
                return v || fallback || "inherit";
            },
        );
        return `style="${escapeAttr(resolved)}"`;
    });
}

/**
 * 把节点里的图片转成 data URI。
 *
 * 两个理由：① SVG 是独立文件，里面的 `assets/xxx.png` 是相对路径，换个地方打开就找不到图；
 * ② PNG 光栅化走的是 `foreignObject → canvas`，canvas 只要被「非同源图片」碰过就会被污染，
 * `toBlob` 直接抛 SecurityError。
 */
async function inlineImages(html: string): Promise<string> {
    const box = document.createElement("div");
    box.innerHTML = html;
    const imgs = Array.from(box.querySelectorAll("img"));
    if (imgs.length === 0) return html;

    await Promise.all(
        imgs.map(async (img) => {
            const src = img.getAttribute("src") ?? "";
            if (!src || src.startsWith("data:")) return;
            try {
                img.setAttribute("src", await toDataUri(src));
            } catch (err) {
                console.warn("[mindmap] 图片转 data URI 失败，导出里会保留原地址", src, err);
            }
        }),
    );
    return box.innerHTML;
}

async function toDataUri(src: string): Promise<string> {
    const abs = new URL(src, location.href).href;
    const res = await fetch(abs);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("FileReader 失败"));
        reader.readAsDataURL(blob);
    });
}

/**
 * 找思源的 KaTeX 样式表并内联。
 *
 * 不内联的话，导出的文件里公式会散成一堆乱字符 —— `.katex` 那一堆规则
 * 全靠宿主 CSS 提供，插件自己的样式表里没有。
 */
async function katexCss(): Promise<string> {
    const link = document.querySelector<HTMLLinkElement>('link[href*="katex"]');
    if (!link) return "";
    try {
        const res = await fetch(link.href);
        return res.ok ? await res.text() : "";
    } catch {
        return "";
    }
}

function escapeAttr(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

export async function buildSvg(rootEl: HTMLElement, crop?: ExportCrop): Promise<string> {
    const { world, edges, nodes } = worldParts(rootEl);

    const full = worldSize(world);
    const size = cropSize(full, crop);
    const W = size.w;
    const H = size.h;
    // 裁剪时把整层内容整体左移 / 上移，让选中的那块落在 (0,0)
    const ox = size.x;
    const oy = size.y;

    // 解析主题变量
    const vars = readResolvedVars(rootEl);
    const styleVars = THEME_VARS.filter((v) => v !== "--mm-font" && vars[v])
        .map((v) => `${v}:${resolveCssValue(vars[v])}`)
        .join(";");

    const bg = resolveCssValue(vars["--mm-canvas-solid"] ?? "#ffffff");
    const font = resolveCssValue(vars["--mm-font"] ?? "sans-serif");

    // 先把图片换成 data URI，再固化宿主颜色变量
    const nodeHtml = inlineHostVars(await inlineImages(nodes.innerHTML));
    const katex = await katexCss();

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
        `<style><![CDATA[`,
        PLUGIN_CSS,
        katex,
        `.mm-root.mm-export{display:block;position:relative;width:${W}px;height:${H}px;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;background:transparent;}`,
        `.mm-root.mm-export .mm-nodes{position:absolute;left:0;top:0;}`,
        `.mm-root.mm-export .mm-toolbar,.mm-root.mm-export .mm-viewport{display:none;}`,
        `]]></style>`,
        `<rect x="0" y="0" width="${W}" height="${H}" fill="${escapeAttr(bg)}"/>`,
        `<g class="mm-edges" transform="translate(${-ox},${-oy})">${edges.innerHTML}</g>`,
        `<foreignObject x="0" y="0" width="${W}" height="${H}">`,
        `<div xmlns="http://www.w3.org/1999/xhtml" class="mm-root mm-export" style="${escapeAttr(styleVars)};--mm-font:${escapeAttr(font)}">`,
        `<div class="mm-nodes" style="position:absolute;left:${-ox}px;top:${-oy}px">${nodeHtml}</div>`,
        `</div>`,
        `</foreignObject>`,
        `</svg>`,
    ].join("");
}

/**
 * 导出裁剪框。
 *
 * 「只导选中」需要一个「把画布裁到选中子树」的能力。做法不是重新排版，
 * 而是把整层内容平移 `-x/-y` 之后只保留 `w×h` 的视口 —— 节点坐标一个都不动，
 * 所以导出的东西跟屏幕上看到的一模一样。
 */
export interface ExportCrop {
    x: number;
    y: number;
    w: number;
    h: number;
}

function worldSize(world: HTMLElement): ExportCrop {
    return {
        x: 0,
        y: 0,
        w: Math.ceil(parseFloat(world.style.width) || world.offsetWidth || 1),
        h: Math.ceil(parseFloat(world.style.height) || world.offsetHeight || 1),
    };
}

function cropSize(full: ExportCrop, crop?: ExportCrop): ExportCrop {
    if (!crop) return full;
    return {
        x: Math.max(0, Math.floor(crop.x)),
        y: Math.max(0, Math.floor(crop.y)),
        w: Math.max(1, Math.ceil(crop.w)),
        h: Math.max(1, Math.ceil(crop.h)),
    };
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

export async function exportSvg(rootEl: HTMLElement, title: string, crop?: ExportCrop): Promise<void> {
    const svg = await buildSvg(rootEl, crop);
    download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeName(title)}.svg`);
}

export async function exportPng(rootEl: HTMLElement, title: string, scale = 2, crop?: ExportCrop): Promise<void> {
    const blob = await renderPngBlob(rootEl, scale, crop);
    if (!blob) throw new Error("PNG 编码失败");
    download(blob, `${safeName(title)}.png`);
}

/**
 * 把当前导图光栅化成 PNG。
 * 导出文件与「复制到剪贴板」共用同一条链路，只是最后的去处不同。
 */
export async function renderPngBlob(rootEl: HTMLElement, scale = 2, crop?: ExportCrop): Promise<Blob | null> {
    const svg = await buildSvg(rootEl, crop);
    const { world } = worldParts(rootEl);
    const size = cropSize(worldSize(world), crop);
    const W = size.w;
    const H = size.h;

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
        return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** 把导图序列化成 Markdown 大纲并下载 —— 方便贴到别处继续用 */
export function exportOutline(title: string, markdown: string): void {
    download(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${safeName(title)}.md`);
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("SVG 光栅化失败"));
        img.src = src;
    });
}
