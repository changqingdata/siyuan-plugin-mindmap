import type { MMEdgeStyle, MMLayout } from "../types";

/**
 * 连线几何生成。
 *
 * 设计要点：
 * 1. **主干汇聚** —— 父节点先引出一条粗主干，再沿一条"脊"分叉成若干细支线，
 *    同级子节点的连线在视觉上聚成一把梳子，而不是各画各的曲线。
 * 2. **渐细** —— 主干最粗、脊次之、支线最细，用粗细而非透明度表达层级。
 * 3. 三条线的颜色由调用方分别给出。因为导出/绘制用的是**不透明色**
 *    （调用方已把分支色与画布底色混合好），所以主干与支线的重叠段不会叠深，
 *    圆角处的重复绘制也就无害了。
 *
 * 纯函数，不碰 DOM，可以直接在 Node 里单测。
 */

export interface EdgeRect {
    x: number;
    y: number;
    w: number;
    h: number;
    /** 思维导图模式下所在侧 */
    dir: 1 | -1;
}

export type ConnectorKind = "trunk" | "spine" | "stub";

export interface Connector {
    /** SVG path 的 d 属性 */
    d: string;
    /** 线宽 */
    width: number;
    /** 用途：主干 / 脊 / 支线。调用方据此上色 */
    kind: ConnectorKind;
    /** 该线段属于第几个子节点（主干与脊为 null）。用下标而不是引用，方便调用方反查节点 */
    childIndex: number | null;
}

export interface ConnectorInput {
    parent: EdgeRect;
    kids: EdgeRect[];
    mode: MMLayout;
    style: MMEdgeStyle;
    /** 深度轴上的层间距，决定主干长度 */
    gap: number;
    /** 基础线宽（父节点处） */
    base: number;
}

/** 主干长度范围，避免太短看不出汇聚、太长显得松散 */
const MIN_TRUNK = 13;
const MAX_TRUNK = 42;
/** 圆角半径上限 */
const MAX_RADIUS = 9;

const r = (n: number) => Math.round(n * 100) / 100;

export function buildConnectors(input: ConnectorInput): Connector[] {
    const { parent, kids, mode, style, gap, base } = input;
    if (kids.length === 0) return [];

    const trunk = Math.max(MIN_TRUNK, Math.min(gap * 0.44, MAX_TRUNK));
    const spineW = Math.max(1, base * 0.75);
    const stubW = Math.max(1, base * 0.5);
    const radius = Math.max(3, Math.min(trunk * 0.5, MAX_RADIUS));

    return mode === "tree"
        ? vertical(parent, kids, style, trunk, base, spineW, stubW, radius)
        : horizontal(parent, kids, style, trunk, base, spineW, stubW, radius);
}

/* ------------------------------------------------------------------ 纵向（树状图） */

function vertical(
    parent: EdgeRect,
    kids: EdgeRect[],
    style: MMEdgeStyle,
    trunk: number,
    base: number,
    spineW: number,
    stubW: number,
    radius: number,
): Connector[] {
    const px = parent.x + parent.w / 2;
    const py = parent.y + parent.h;
    const out: Connector[] = [];

    if (style === "straight") {
        kids.forEach((k, i) => {
            out.push({ d: `M${r(px)},${r(py)} L${r(k.x + k.w / 2)},${r(k.y)}`, width: stubW, kind: "stub", childIndex: i });
        });
        return out;
    }

    const sy = py + trunk;
    const xs = kids.map((k) => k.x + k.w / 2);

    out.push({ d: `M${r(px)},${r(py)} L${r(px)},${r(sy)}`, width: base, kind: "trunk", childIndex: null });
    out.push({
        d: `M${r(Math.min(px, ...xs))},${r(sy)} L${r(Math.max(px, ...xs))},${r(sy)}`,
        width: spineW,
        kind: "spine",
        childIndex: null,
    });

    kids.forEach((k, i) => {
        const kx = k.x + k.w / 2;
        const ky = k.y;
        const dx = Math.sign(kx - px);
        if (style === "elbow" || dx === 0 || Math.abs(kx - px) < radius * 1.2) {
            out.push({ d: `M${r(kx)},${r(sy)} L${r(kx)},${r(ky)}`, width: stubW, kind: "stub", childIndex: i });
        } else {
            const x0 = kx - dx * radius;
            out.push({
                d: `M${r(x0)},${r(sy)} Q${r(kx)},${r(sy)} ${r(kx)},${r(sy + radius)} L${r(kx)},${r(ky)}`,
                width: stubW,
                kind: "stub",
                childIndex: i,
            });
        }
    });
    return out;
}

/* ------------------------------------------------- 横向（逻辑结构图 / 思维导图） */

function horizontal(
    parent: EdgeRect,
    kids: EdgeRect[],
    style: MMEdgeStyle,
    trunk: number,
    base: number,
    spineW: number,
    stubW: number,
    radius: number,
): Connector[] {
    const out: Connector[] = [];

    // 思维导图模式下根节点两侧都有子节点，必须按方向分组，各自有自己的主干与脊
    const groups = new Map<1 | -1, EdgeRect[]>();
    for (const k of kids) {
        const list = groups.get(k.dir);
        if (list) list.push(k);
        else groups.set(k.dir, [k]);
    }

    for (const [dir, group] of groups) {
        const px = dir === 1 ? parent.x + parent.w : parent.x;
        const py = parent.y + parent.h / 2;

        if (style === "straight") {
            group.forEach((k, i) => {
                const kx = dir === 1 ? k.x : k.x + k.w;
                out.push({
                    d: `M${r(px)},${r(py)} L${r(kx)},${r(k.y + k.h / 2)}`,
                    width: stubW,
                    kind: "stub",
                    childIndex: i,
                });
            });
            continue;
        }

        const sx = px + dir * trunk;
        const cys = group.map((k) => k.y + k.h / 2);

        out.push({ d: `M${r(px)},${r(py)} L${r(sx)},${r(py)}`, width: base, kind: "trunk", childIndex: null });
        out.push({
            d: `M${r(sx)},${r(Math.min(py, ...cys))} L${r(sx)},${r(Math.max(py, ...cys))}`,
            width: spineW,
            kind: "spine",
            childIndex: null,
        });

        group.forEach((k, i) => {
            const kx = dir === 1 ? k.x : k.x + k.w;
            const ky = k.y + k.h / 2;
            const dy = Math.sign(ky - py);
            if (style === "elbow" || dy === 0 || Math.abs(ky - py) < radius * 1.2) {
                out.push({ d: `M${r(sx)},${r(ky)} L${r(kx)},${r(ky)}`, width: stubW, kind: "stub", childIndex: i });
            } else {
                const y0 = ky - dy * radius;
                out.push({
                    d: `M${r(sx)},${r(y0)} Q${r(sx)},${r(ky)} ${r(sx + dir * radius)},${r(ky)} L${r(kx)},${r(ky)}`,
                    width: stubW,
                    kind: "stub",
                    childIndex: i,
                });
            }
        });
    }

    return out;
}
