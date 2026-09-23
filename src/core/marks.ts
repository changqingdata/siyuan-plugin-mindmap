/**
 * 节点标记（P1-2）：给节点挂「图标 / 标签 / 自定义色」。
 *
 * 为什么是**纯函数模块**：编解码要能在 Node 单测里直接跑（`tests/run.mjs`），
 * 而解析层（parser.ts）本来就是纯 DOM 逻辑、不碰内核。把格式定义单独拎出来，
 * 三个地方（解析、渲染、写回）就不会各自解释一遍这个字符串。
 *
 * 存储选**块属性** `custom-mindmap-mark`，不是插件私有数据库 ——
 * 这样「块是唯一真相源」这条不变量继续成立：
 * 复制块、反链、导出、同步、换设备打开，标记都跟着走；
 * 插件卸载了，数据也还在，不会变成一堆谁都不认识的孤儿。
 */
import type { MMNodeMark } from "../types";

/** 块属性名 */
export const ATTR_MARK = "custom-mindmap-mark";

/**
 * 可选的图标。
 *
 * 用 emoji 而不是思源内置图标字体：图标字体的字形要靠 `icon-*` 类名 + 字体文件，
 * 而导出 PNG / SVG 是**把 DOM 序列化出去**的 —— 字体没跟着走，导出的图上图标会变成方框。
 * emoji 是文本，走哪儿都在。
 */
export const MARK_ICONS = ["⭐", "🔥", "❗", "✅", "📌", "💡", "🐞", "🚧"];

/**
 * 可选的自定义色。
 *
 * 刻意避开纯红/纯绿：这两个色在思源里已经被「块引用红、双链绿」占用了，
 * 混进来会让人误以为节点有某种链接语义。
 */
export const MARK_COLORS = ["#e5534b", "#e08a2e", "#d4a72c", "#4caf7d", "#3b9ae1", "#8b5cf6", "#e2569a", "#8a8f98"];

/** 标签最长几个字 —— 导图节点本来就窄，标签是提示不是正文 */
export const MARK_LABEL_MAX = 8;

/**
 * 解析块属性里的标记。
 *
 * 宽容到底：属性可能是用户手改的、旧版本写的、别的插件写的。
 * 任何解析不出来 / 类型不对 / 全空的输入都当作「没有标记」，
 * 而不是抛异常 —— 一个坏属性不该让整张导图渲染不出来。
 */
export function decodeMark(raw: string | null | undefined): MMNodeMark | undefined {
    if (!raw) return undefined;
    let obj: unknown;
    try {
        obj = JSON.parse(raw);
    } catch {
        // 也接受最朴素的写法：属性值直接就是图标（手写属性时最省事）
        const bare = raw.trim();
        return bare && !bare.startsWith("{") ? { icon: bare.slice(0, 4) } : undefined;
    }
    if (!obj || typeof obj !== "object") return undefined;

    const src = obj as Record<string, unknown>;
    const mark: MMNodeMark = {};
    if (typeof src.icon === "string" && src.icon.trim()) mark.icon = src.icon.trim().slice(0, 4);
    if (typeof src.label === "string" && src.label.trim()) mark.label = src.label.trim().slice(0, MARK_LABEL_MAX);
    if (typeof src.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(src.color.trim())) mark.color = src.color.trim();
    return hasMark(mark) ? mark : undefined;
}

/** 编码成块属性值；没有任何内容时返回 `null`（写 `null` = 删掉这个属性） */
export function encodeMark(mark: MMNodeMark | null | undefined): string | null {
    if (!mark) return null;
    const out: MMNodeMark = {};
    if (mark.icon) out.icon = mark.icon.slice(0, 4);
    if (mark.label) out.label = mark.label.slice(0, MARK_LABEL_MAX);
    if (mark.color) out.color = mark.color;
    return hasMark(out) ? JSON.stringify(out) : null;
}

/** 这个标记里有东西吗 */
export function hasMark(mark: MMNodeMark | null | undefined): boolean {
    return !!mark && !!(mark.icon || mark.label || mark.color);
}

/** 两个标记是不是一样（用来判断「用户其实没改」，避免白写一次内核 + 白记一条撤销） */
export function sameMark(a: MMNodeMark | undefined, b: MMNodeMark | undefined): boolean {
    const na = hasMark(a) ? encodeMark(a) : null;
    const nb = hasMark(b) ? encodeMark(b) : null;
    return na === nb;
}
