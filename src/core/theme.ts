import type { MMTheme, MMThemeId } from "../types";

/** 主题暴露给 CSS 的自定义属性名（导出 SVG 时需要逐个解析为具体值） */
export const THEME_VARS = [
    "--mm-canvas-bg",
    "--mm-canvas-solid",
    "--mm-canvas-grid",
    "--mm-node-bg",
    "--mm-node-border",
    "--mm-node-text",
    "--mm-root-bg",
    "--mm-root-text",
    "--mm-root-shadow",
    "--mm-card-shadow",
    "--mm-hover-shadow",
    "--mm-toggle-bg",
    "--mm-accent",
    "--mm-focus-ring",
    "--mm-tint",
    "--mm-font",
] as const;

const PALETTE_DARK = [
    "#5B9DFF", "#3DD68C", "#FFB454", "#FF7AB6", "#4DD0E1",
    "#B388FF", "#FF6B6B", "#9CCC65", "#FF9F43", "#2DD4BF",
];

const PALETTE_LIGHT = [
    "#2F6FED", "#0F9D58", "#D98200", "#D6336C", "#0B8FA8",
    "#7C4DFF", "#D93025", "#5F9B00", "#E8590C", "#0F766E",
];

/** 高对比主题专用：在纯黑背景上保证足够的亮度与彼此区分度 */
const PALETTE_CONTRAST = [
    "#FFD400", "#00E5FF", "#7CFF6B", "#FF8A65", "#FF6EC7",
    "#B388FF", "#FFFFFF", "#4DD0E1", "#FFAB40", "#AEEA00",
];

/** 判断当前思源是否处于暗色主题 */
export function isDarkMode(): boolean {
    const html = document.documentElement;
    const attr = html.getAttribute("data-theme-mode");
    if (attr === "dark") return true;
    if (attr === "light") return false;

    const body = document.body;
    if (body.classList.contains("b3-theme-dark")) return true;
    if (body.classList.contains("b3-theme-light")) return false;

    // 兜底：按正文背景亮度判断
    const bg = getComputedStyle(body).backgroundColor;
    const m = bg.match(/\d+/g);
    if (m && m.length >= 3) {
        const [r, g, b] = m.map(Number);
        return 0.299 * r + 0.587 * g + 0.114 * b < 128;
    }
    return true;
}

/**
 * 内置主题。
 *
 * 约定：所有颜色只通过 --mm-* 自定义属性注入，CSS 里不直接引用思源的 --b3-* 变量。
 * 这样导出 SVG 时只要把 --mm-* 解析成具体值，外观就能完整还原。
 */
const THEMES: Record<Exclude<MMThemeId, "siyuan">, Omit<MMTheme, "palette">> = {
    deep: {
        id: "deep",
        name: "深空",
        dark: true,
        canvasBg: "radial-gradient(circle at 22% 10%, #171c27 0%, #0b0d12 62%)",
        canvasSolid: "#0b0d12",
        canvasGrid: "rgba(255,255,255,.095)",
        nodeBg: "#171b24",
        nodeBorder: "#2a3142",
        nodeText: "#e2e7f0",
        rootBg: "linear-gradient(135deg,#4c8dff,#7b5cff)",
        rootText: "#ffffff",
        rootShadow: "rgba(76,141,255,.42)",
        cardShadow: "0 2px 10px rgba(0,0,0,.45)",
        hoverShadow: "rgba(0,0,0,.62)",
        toggleBg: "#12151d",
        accent: "#4c8dff",
        focusRing: "rgba(76,141,255,.6)",
        tint: 0.17,
    },
    paper: {
        id: "paper",
        name: "极简白",
        dark: false,
        canvasBg: "radial-gradient(circle at 22% 10%, #ffffff 0%, #eef1f6 72%)",
        canvasSolid: "#eef1f6",
        canvasGrid: "rgba(0,0,0,.09)",
        nodeBg: "#ffffff",
        nodeBorder: "#e2e6ee",
        nodeText: "#1f2430",
        rootBg: "linear-gradient(135deg,#1f2430,#3b4557)",
        rootText: "#ffffff",
        rootShadow: "rgba(31,36,48,.3)",
        cardShadow: "0 1px 3px rgba(23,30,45,.09), 0 6px 18px rgba(23,30,45,.05)",
        hoverShadow: "rgba(23,30,45,.2)",
        toggleBg: "#ffffff",
        accent: "#2f6fed",
        focusRing: "rgba(47,111,237,.45)",
        tint: 0.13,
    },
    morandi: {
        id: "morandi",
        name: "莫兰迪",
        dark: false,
        canvasBg: "linear-gradient(160deg,#f4f1ec 0%,#eae5dd 100%)",
        canvasSolid: "#eae5dd",
        canvasGrid: "rgba(120,105,90,.14)",
        nodeBg: "#fbf9f6",
        nodeBorder: "#e0d9cf",
        nodeText: "#4a443c",
        rootBg: "linear-gradient(135deg,#8c8378,#a89e92)",
        rootText: "#fffdf9",
        rootShadow: "rgba(140,131,120,.36)",
        cardShadow: "0 2px 8px rgba(120,105,90,.13)",
        hoverShadow: "rgba(120,105,90,.26)",
        toggleBg: "#fbf9f6",
        accent: "#8c8378",
        focusRing: "rgba(140,131,120,.5)",
        tint: 0.16,
    },
    neon: {
        id: "neon",
        name: "霓虹",
        dark: true,
        canvasBg: "radial-gradient(circle at 30% 0%, #1a1035 0%, #08060f 66%)",
        canvasSolid: "#08060f",
        canvasGrid: "rgba(140,120,255,.15)",
        nodeBg: "#130f22",
        nodeBorder: "#2e2450",
        nodeText: "#e4dcff",
        rootBg: "linear-gradient(135deg,#ff2d95,#8b5cf6)",
        rootText: "#ffffff",
        rootShadow: "rgba(255,45,149,.45)",
        cardShadow: "0 2px 12px rgba(0,0,0,.55)",
        hoverShadow: "rgba(139,92,246,.5)",
        toggleBg: "#130f22",
        accent: "#ff2d95",
        focusRing: "rgba(255,45,149,.55)",
        tint: 0.18,
    },
    contrast: {
        id: "contrast",
        name: "高对比",
        dark: true,
        canvasBg: "#000000",
        canvasSolid: "#000000",
        canvasGrid: "rgba(255,255,255,.12)",
        nodeBg: "#000000",
        nodeBorder: "#ffffff",
        nodeText: "#ffffff",
        rootBg: "#ffffff",
        rootText: "#000000",
        rootShadow: "rgba(0,0,0,0)",
        cardShadow: "none",
        hoverShadow: "rgba(255,255,255,.4)",
        toggleBg: "#000000",
        accent: "#ffd400",
        focusRing: "rgba(255,212,0,.85)",
        tint: 0.3,
    },
};

export const THEME_LIST: Array<{ id: MMThemeId; name: string }> = [
    { id: "siyuan", name: "跟随思源" },
    { id: "deep", name: "深空" },
    { id: "paper", name: "极简白" },
    { id: "morandi", name: "莫兰迪" },
    { id: "neon", name: "霓虹" },
    { id: "contrast", name: "高对比" },
];

/** 解析主题：把 id 变成一组具体的 CSS 变量值 */
export function resolveTheme(id: MMThemeId, dark = isDarkMode()): MMTheme {
    if (id === "siyuan") {
        return {
            id: "siyuan",
            name: "跟随思源",
            dark,
            canvasBg: "var(--b3-theme-background)",
            canvasSolid: "var(--b3-theme-background)",
            canvasGrid: dark ? "rgba(255,255,255,.075)" : "rgba(0,0,0,.07)",
            nodeBg: "var(--b3-theme-background)",
            nodeBorder: "var(--b3-border-color)",
            nodeText: "var(--b3-theme-on-background)",
            rootBg: "var(--b3-theme-primary)",
            rootText: "var(--b3-theme-on-primary, #ffffff)",
            rootShadow: dark ? "rgba(0,0,0,.5)" : "rgba(0,0,0,.18)",
            cardShadow: dark ? "0 2px 10px rgba(0,0,0,.4)" : "0 1px 3px rgba(0,0,0,.07), 0 4px 14px rgba(0,0,0,.05)",
            hoverShadow: dark ? "rgba(0,0,0,.6)" : "rgba(0,0,0,.16)",
            toggleBg: "var(--b3-theme-background)",
            accent: "var(--b3-theme-primary)",
            focusRing: dark
                ? "color-mix(in srgb, var(--b3-theme-primary) 62%, transparent)"
                : "color-mix(in srgb, var(--b3-theme-primary) 48%, transparent)",
            tint: dark ? 0.2 : 0.12,
            palette: dark ? PALETTE_DARK : PALETTE_LIGHT,
        };
    }
    const t = THEMES[id];
    const palette = id === "contrast" ? PALETTE_CONTRAST : t.dark ? PALETTE_DARK : PALETTE_LIGHT;
    return { ...t, palette };
}

/** 把主题写入一个元素的 CSS 自定义属性 */
export function applyTheme(el: HTMLElement, theme: MMTheme, font: string) {
    const s = el.style;
    s.setProperty("--mm-canvas-bg", theme.canvasBg);
    s.setProperty("--mm-canvas-solid", theme.canvasSolid);
    s.setProperty("--mm-canvas-grid", theme.canvasGrid);
    s.setProperty("--mm-node-bg", theme.nodeBg);
    s.setProperty("--mm-node-border", theme.nodeBorder);
    s.setProperty("--mm-node-text", theme.nodeText);
    s.setProperty("--mm-root-bg", theme.rootBg);
    s.setProperty("--mm-root-text", theme.rootText);
    s.setProperty("--mm-root-shadow", theme.rootShadow);
    s.setProperty("--mm-card-shadow", theme.cardShadow);
    s.setProperty("--mm-hover-shadow", theme.hoverShadow);
    s.setProperty("--mm-toggle-bg", theme.toggleBg);
    s.setProperty("--mm-accent", theme.accent);
    s.setProperty("--mm-focus-ring", theme.focusRing);
    s.setProperty("--mm-tint", String(theme.tint));
    s.setProperty("--mm-font", font);
}

/** 读取元素上已解析的 --mm-* 变量值（导出 SVG 时用） */
export function readResolvedVars(el: HTMLElement): Record<string, string> {
    const cs = getComputedStyle(el);
    const out: Record<string, string> = {};
    for (const name of THEME_VARS) {
        const v = cs.getPropertyValue(name).trim();
        if (v) out[name] = v;
    }
    return out;
}

/** #RRGGBB → rgba(r,g,b,a) */
export function hexA(hex: string, alpha: number): string {
    if (!hex.startsWith("#") || hex.length < 7) return hex;
    const n = parseInt(hex.slice(1, 7), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** 读取元素已解析的背景色（RGB 三元组） */
export function readRgb(el: HTMLElement): [number, number, number] {
    const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
    if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])];
    return [255, 255, 255];
}

/**
 * 把分支色按 alpha 混到画布底色上，得到**不透明**颜色。
 *
 * 为什么不用 rgba：连线的"主干 / 脊 / 支线"在圆角处会互相重叠，
 * 半透明色叠在一起会明显变深。混成实色之后重叠段完全不可见，
 * 绘制顺序也就不再重要了。
 */
export function mixHex(hex: string, bg: [number, number, number], alpha: number): string {
    if (!hex.startsWith("#") || hex.length < 7) return hex;
    const n = parseInt(hex.slice(1, 7), 16);
    const a = Math.min(Math.max(alpha, 0), 1);
    const r = Math.round(((n >> 16) & 255) * a + bg[0] * (1 - a));
    const g = Math.round(((n >> 8) & 255) * a + bg[1] * (1 - a));
    const b = Math.round((n & 255) * a + bg[2] * (1 - a));
    return `rgb(${r},${g},${b})`;
}
