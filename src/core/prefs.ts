import type { MMEdgeStyle, MMLayout, MMThemeId, MMViewPrefs } from "../types";

/**
 * 文档级视图偏好的序列化。
 *
 * 存在列表块的 `custom-mindmap-view` 属性上，形如
 *
 *     layout=logic;theme=deep;scale=1.25
 *
 * 为什么用 `key=value;` 而不是文档里最初设想的 `logic|deep|1.25`：
 * 位置编码一旦要加字段就得动老数据的解析规则，而且缺项时无法区分
 * 「没设过」和「设成了空」。带键的写法天然可扩展，坏掉一段也不影响其它段。
 *
 * ⚠️ 这里只存**用户显式改过**的项。没改过的项不能写进去 ——
 * 否则用户改了全局主题，所有文档都被旧值钉死、不跟着变，反而更别扭。
 */

const LAYOUTS: MMLayout[] = ["logic", "mind", "tree"];
const EDGES: MMEdgeStyle[] = ["curve", "elbow", "straight"];

/** 缩放的安全区间，与 renderer 里的 MIN_SCALE / MAX_SCALE 对齐 */
const MIN_SCALE = 0.15;
const MAX_SCALE = 6;

export function encodeViewPrefs(p: MMViewPrefs): string {
    const parts: string[] = [];
    if (p.layout) parts.push(`layout=${p.layout}`);
    if (p.theme) parts.push(`theme=${p.theme}`);
    if (p.edge) parts.push(`edge=${p.edge}`);
    if (p.scale !== undefined && Number.isFinite(p.scale)) parts.push(`scale=${p.scale.toFixed(4)}`);
    return parts.join(";");
}

export function decodeViewPrefs(raw: string | null | undefined): MMViewPrefs {
    const out: MMViewPrefs = {};
    if (!raw) return out;
    for (const seg of raw.split(";")) {
        const i = seg.indexOf("=");
        if (i <= 0) continue;
        const key = seg.slice(0, i).trim();
        const val = seg.slice(i + 1).trim();
        if (!val) continue;
        if (key === "layout" && LAYOUTS.includes(val as MMLayout)) {
            out.layout = val as MMLayout;
        } else if (key === "theme") {
            // 主题名不加白名单：主题列表是会增长的，老代码不该把新主题判成非法值。
            // 真正不存在的 id 由 resolveTheme 兜底成「跟随思源」，不会崩。
            out.theme = val as MMThemeId;
        } else if (key === "edge" && EDGES.includes(val as MMEdgeStyle)) {
            out.edge = val as MMEdgeStyle;
        } else if (key === "scale") {
            const n = Number.parseFloat(val);
            if (Number.isFinite(n) && n > 0) out.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));
        }
    }
    return out;
}
