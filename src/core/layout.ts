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
    /**
     * 交叉轴（逻辑图里就是高度）的单列上限，超过就摊成多列。
     * 传 0 或不传表示不分列。
     */
    maxCross?: number;
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
    const maxCross = opt.maxCross ?? 0;
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

    /* ---------- 3b. 逻辑图分列 ---------- */

    /**
     * 把根的一级分支摊成若干列。
     *
     * 调用前提：`measure(root)` 已经跑过 —— `root.kids` 与每棵子树的 `cross` 都是最新的，
     * 且 `root.cross` 正好等于「单列总高」。
     *
     * 分列只改一级分支的**列归属**，每列内部仍是完整的 tidy-tree 子树，
     * 所以列内兄弟顺序、父子对齐关系与单列时一模一样，只是换了个原点。
     * 根节点留在最左侧、垂直居中，与所有列相望。
     */
    function layoutColumns(r: MMNode, colGapX: number, colGapY: number, limit: number) {
        const kids = r.kids;
        const total = r.cross;
        const want = Math.max(2, Math.ceil(total / limit));
        const cap = total / want;

        // 贪心装箱：按原顺序切段，尽量贴近 cap。
        // 保留最后一列的「兜底」身份（只有 groups.length < want - 1 才允许开新列），
        // 免得最后剩一个孤零零的节点自己占一列。
        const groups: MMNode[][] = [];
        let cur: MMNode[] = [];
        let curH = 0;
        for (const k of kids) {
            const add = cur.length === 0 ? k.cross : k.cross + colGapY;
            if (cur.length > 0 && curH + add > cap && groups.length < want - 1) {
                groups.push(cur);
                cur = [k];
                curH = k.cross;
            } else {
                cur.push(k);
                curH += add;
            }
        }
        if (cur.length > 0) groups.push(cur);

        const colH: number[] = [];
        const colW: number[] = [];
        for (const g of groups) {
            let h = 0;
            g.forEach((k, i) => {
                h += k.cross + (i > 0 ? colGapY : 0);
            });
            colH.push(h);

            let y = 0;
            for (const k of g) {
                placeCross(k, y);
                y += k.cross + colGapY;
            }
            for (const k of g) placeDepth(k, 0);

            let w = 0;
            const depthEnd = (n: MMNode) => {
                w = Math.max(w, n.d1);
                n.kids.forEach(depthEnd);
            };
            g.forEach(depthEnd);
            colW.push(w);
        }

        const maxH = Math.max(...colH);
        const colX: number[] = [];
        let x = r.w + colGapX;
        for (let i = 0; i < groups.length; i++) {
            colX.push(x);
            x += colW[i] + colGapX * 2;
        }

        groups.forEach((g, i) => {
            // 各列垂直居中：高度不齐时整体看起来是一块，而不是参差的锯齿
            const yOff = (maxH - colH[i]) / 2;
            const place = (n: MMNode) => {
                n.x = n.d0 + colX[i];
                n.y = n.cy - n.h / 2 + yOff;
                n.dir = 1;
                n.kids.forEach(place);
            };
            g.forEach(place);
        });

        r.kids = r.children;
        r.dir = 1;
        r.x = 0;
        r.y = maxH / 2 - r.h / 2;
        r.cy = r.y + r.h / 2;
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

        // 逻辑图分列：逻辑图的交叉轴是纵向的，节点一多画布就变成 700×3400 这种
        // 细长条 —— 横向空间全空着，而视口恰恰是横的。`measure` 之后 root.cross
        // 就是「单列总高」，超过阈值就摊成多列（见 layoutColumns）。
        if (mode === "logic" && maxCross > 0 && root.children.length > 1 && root.cross > maxCross) {
            layoutColumns(root, gapX, gapY, maxCross);
        } else {
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
