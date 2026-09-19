import type { MMNode, MMLayout } from "../types";

export interface LayoutOptions {
    mode: MMLayout;
    /** 层间距（深度轴） */
    gapX: number;
    /** 兄弟间距（交叉轴） */
    gapY: number;
    /** 画布内边距 */
    padX: number;
    padY: number;
}

export interface LayoutResult {
    /** 画布宽 */
    w: number;
    /** 画布高 */
    h: number;
}

/**
 * tidy-tree 布局引擎
 *
 * 为了用一套代码支持"从左到右""从右到左""从上到下"，把坐标抽象成两个正交轴：
 *   深度轴 —— 层级递进方向（逻辑图是 x，树状图是 y）
 *   交叉轴 —— 兄弟排列方向（逻辑图是 y，树状图是 x）
 *
 * 四步：measure → placeCross → placeDepth → normalize
 */
export function layout(root: MMNode, opt: LayoutOptions): LayoutResult {
    const { mode, gapX, gapY, padX, padY } = opt;
    const isTree = mode === "tree";

    const crossSelf = (n: MMNode) => (isTree ? n.w : n.h);
    const depthSelf = (n: MMNode) => (isTree ? n.h : n.w);

    /* ---------- 1. 自底向上计算每棵子树的交叉轴占位 ---------- */
    function measure(n: MMNode): number {
        n.kids = n.folded ? [] : n.children;
        const self = crossSelf(n);
        if (n.kids.length === 0) {
            n.cross = self;
            return self;
        }
        let total = 0;
        n.kids.forEach((k, i) => {
            total += measure(k);
            if (i > 0) total += gapY;
        });
        n.cross = Math.max(total, self);
        return n.cross;
    }

    /* ---------- 2. 交叉轴装箱 + 父节点对齐首尾子节点中点 ---------- */
    function placeCross(n: MMNode, start: number) {
        n.slot = start;
        const kids = n.kids;
        const self = crossSelf(n);

        if (kids.length === 0) {
            n.cy = start + self / 2;
            return;
        }

        let total = 0;
        kids.forEach((k, i) => {
            total += k.cross;
            if (i > 0) total += gapY;
        });

        let cur = start + (n.cross - total) / 2;
        for (const k of kids) {
            placeCross(k, cur);
            cur += k.cross + gapY;
        }

        // 对齐到首尾子节点的中点，并把父节点钳制在自己的占位槽内，
        // 否则子树明显不对称时父节点会溢出到兄弟节点的位置。
        const mid = (kids[0].cy + kids[kids.length - 1].cy) / 2;
        const half = self / 2;
        n.cy = Math.min(Math.max(mid, start + half), start + n.cross - half);
    }

    /* ---------- 3. 深度轴分配 ---------- */
    function placeDepth(n: MMNode, d: number) {
        n.d0 = d;
        n.d1 = d + depthSelf(n);
        for (const k of n.kids) placeDepth(k, n.d1 + gapX);
    }

    /* ---------- 4. 映射到 x / y ---------- */
    if (mode === "mind") {
        // 思维导图：根的一级分支左右均分，两侧各自独立布局后镜像
        const all = root.folded ? [] : root.children;
        const mid = Math.ceil(all.length / 2);
        const sides: Array<{ kids: MMNode[]; dir: 1 | -1 }> = [
            { kids: all.slice(0, mid), dir: 1 },
            { kids: all.slice(mid), dir: -1 },
        ];

        root.kids = [];
        root.cross = crossSelf(root);
        root.slot = 0;

        const collected: MMNode[] = [];
        for (const { kids, dir } of sides) {
            if (kids.length === 0) continue;
            kids.forEach(measure);

            let total = 0;
            kids.forEach((k, i) => {
                total += k.cross;
                if (i > 0) total += gapY;
            });

            let cur = -total / 2;
            for (const k of kids) {
                placeCross(k, cur);
                cur += k.cross + gapY;
            }
            for (const k of kids) placeDepth(k, dir === 1 ? root.w + gapX : gapX);

            const collect = (n: MMNode) => {
                n.dir = dir;
                collected.push(n);
                n.kids.forEach(collect);
            };
            kids.forEach(collect);
        }

        root.kids = sides[0].kids.concat(sides[1].kids);
        root.dir = 1;
        root.d0 = 0;
        root.d1 = root.w;

        for (const n of collected) {
            n.y = n.cy - crossSelf(n) / 2;
            n.x = n.dir === 1 ? n.d0 : -n.d1;
        }
        root.x = 0;
        root.y = -root.h / 2;
    } else {
        measure(root);
        placeCross(root, 0);
        placeDepth(root, 0);

        const toXY = (n: MMNode) => {
            if (isTree) {
                n.x = n.cy - n.w / 2;
                n.y = n.d0;
            } else {
                n.y = n.cy - n.h / 2;
                n.x = n.d0;
            }
            n.dir = 1;
            n.kids.forEach(toXY);
        };
        toXY(root);
    }

    /* ---------- 归一化到正坐标 ---------- */
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const scan = (n: MMNode) => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.w);
        maxY = Math.max(maxY, n.y + n.h);
        n.kids.forEach(scan);
    };
    scan(root);

    const ox = padX - minX;
    const oy = padY - minY;
    const shift = (n: MMNode) => {
        n.x += ox;
        n.y += oy;
        n.kids.forEach(shift);
    };
    shift(root);

    return { w: maxX - minX + padX * 2, h: maxY - minY + padY * 2 };
}
