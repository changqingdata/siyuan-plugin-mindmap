/**
 * 解析 + 布局的自动化测试
 *
 * 在 Node 里用一套极简 DOM 模拟还原思源的列表结构，
 * 校验 parseList / decorate / layout 的输出是否符合预期。
 * 由 tests/run.mjs 打包后执行。
 */
import { parseList, decorate, wrapRoot, flatten } from "../src/core/parser";
import { layout } from "../src/core/layout";
import { buildConnectors } from "../src/core/edge";
import { mixHex } from "../src/core/theme";
import { decodeViewPrefs, encodeViewPrefs } from "../src/core/prefs";
import { ATTR_MARK, decodeMark, encodeMark, hasMark, sameMark } from "../src/core/marks";
import { clearNotes, formatNotes, installDiagnostics, recentNotes, stamp } from "../src/core/diagnostics";
import { readableHotkey } from "../src/utils/hotkey";
import {
    canDelete,
    canEdit,
    canIndent,
    canMoveDown,
    canMoveUp,
    canOutdent,
    escapeMd,
    hasInlineFormat,
    indexInParent,
    isAncestor,
    markerOf,
    newItemMarkdown,
    serializeSubtree,
    topLevelOf,
} from "../src/core/tree";
import type { MMNode } from "../src/types";

const g = globalThis as any;

/* ------------------------------------------------------------------ 断言 */

let passed = 0;
const failures: string[] = [];

/**
 * ⚠️ 第三个参数是**诊断信息**，不是可有可无的装饰。
 *
 * 早先这个签名只有两个参数，而调用点有 9 处传了第三个 —— 多出来的实际值
 * 被 JavaScript 静默丢掉，于是断言红的时候只看到一句「对象参数走 JSON」，
 * 看不到真实内容是什么，还得回去改代码才能查。
 * 这正是「断言消息要自带诊断」那条教训：消息里没有数字，红的时候等于没红。
 *
 * 之所以一直没暴露，是因为 `tsconfig.json` 的 include 只有 `src/**`，
 * 本文件根本不在类型检查范围内（现已由 `tsconfig.tests.json` 覆盖）。
 */
function ok(cond: boolean, msg: string, detail?: unknown) {
    if (cond) {
        passed++;
    } else {
        const line = detail === undefined ? msg : `${msg} —— ${String(detail)}`;
        failures.push(line);
        console.error(`  ✗ ${line}`);
    }
}

function eq(actual: unknown, expected: unknown, msg: string) {
    ok(
        actual === expected,
        `${msg} —— 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`,
    );
}

/* ------------------------------------------------------------- 构造测试 DOM */

type Spec = {
    id?: string;
    cls?: string[];
    subtype?: string;
    html?: string;
    text?: string;
    /** 额外属性 —— 块的自定义属性（`custom-*`）在思源里就是块元素上的属性 */
    attrs?: Record<string, string>;
    children?: Spec[];
};

function el(spec: Spec): any {
    const node = new g.HTMLElement();
    if (spec.id) node.dataset.nodeId = spec.id;
    if (spec.subtype) node.dataset.subtype = spec.subtype;
    for (const c of spec.cls ?? []) node.classList.add(c);
    for (const [k, v] of Object.entries(spec.attrs ?? {})) node.setAttribute(k, v);
    node.innerHTML = spec.html ?? "";
    node.textContent = spec.text ?? "";
    for (const child of spec.children ?? []) node.appendChild(el(child));
    return node;
}

/** 内容块（段落） */
const p = (id: string, text: string, html?: string): Spec => ({
    id,
    cls: ["p"],
    text,
    html: html ?? text,
});

/** 列表项 */
const li = (id: string, content: Spec, sub?: Spec, cls: string[] = [], attrs?: Record<string, string>): Spec => ({
    id,
    cls: ["li", ...cls],
    attrs,
    children: sub ? [content, sub] : [content],
});

/** 列表 */
const list = (subtype: "u" | "o" | "t", id: string, items: Spec[]): Spec => ({
    id,
    cls: ["list"],
    subtype,
    children: items,
});

/**
 * 还原这样的结构：
 *   无序列表
 *     ├── 根节点
 *     │     ├── 有序列表
 *     │     │     ├── 第一项
 *     │     │     │     └── 无序列表 → 叶子
 *     │     │     └── 第二项
 *     └── 任务列表
 *           ├── 已完成任务   [x]
 *           └── 未完成任务
 */
const tree = list("u", "L0", [
    li("L1", p("P1", "根节点"), list("o", "L1sub", [
        li("L11", p("P11", "第一项"), list("u", "L11sub", [li("L111", p("P111", "叶子"))])),
        li("L12", p("P12", "第二项")),
    ])),
    li("L2", p("P2", "任务组"), list("t", "L2sub", [
        li("L21", p("P21", "已完成任务"), undefined, ["protyle-task--done"]),
        li("L22", p("P22", "未完成任务"), undefined, ["protyle-task--undone"]),
    ])),
]);

/* -------------------------------------------------------------- 1. 解析结果 */

console.log("\n[1] 解析 Protyle DOM");
const domTree = el(tree);
const items = parseList(domTree);
eq(items.length, 2, "顶层列表项数量");
eq(items[0].id, "L1", "第一个顶层项的块 ID");
eq(items[0].text, "根节点", "第一个顶层项的文本");
eq(items[0].children.length, 2, "L1 的子项数量");
eq(items[0].children[0].order, "1.1", "L1 第一个子项的层级编号");
eq(items[0].children[1].order, "1.2", "L1 第二个子项的层级编号");
eq(items[0].children[0].children[0].order, "1.1.1", "三级节点的层级编号");
eq(items[0].children[0].children[0].text, "叶子", "三级节点的文本");
eq(items[1].order, "2", "第二个顶层项的层级编号");

// 有序 / 无序 / 任务三种语义
eq(items[0].kind, "bullet", "无序列表节点 kind");
eq(items[0].numbered, false, "无序列表不显示编号");
eq(items[0].children[0].kind, "ordered", "有序列表节点 kind");
eq(items[0].children[0].numbered, true, "有序列表显示编号");
eq(items[1].children[0].kind, "task", "任务列表节点 kind");
eq(items[1].children[0].checked, true, "已完成任务被识别");
eq(items[1].children[1].checked, undefined, "未完成任务 checked 为 undefined");

// 空节点应被丢弃
const withEmpty = list("u", "LE", [li("E1", p("PE1", "   ")), li("E2", p("PE2", "有内容"))]);
eq(parseList(el(withEmpty)).length, 1, "空列表项被过滤");

// Protyle 会往块内容里塞零宽空格（U+200B）。它不属于 ECMAScript 的 WhiteSpace，
// trim() 去不掉，会顺着 node.text 渗进序列化 markdown、导出文本和搜索匹配。
const withZwsp = list("u", "LZ", [
    li("Z1", p("PZ1", "零宽\u200B节点\uFEFF", "零宽\u200B节点\uFEFF")),
    li("Z2", p("PZ2", "\u200B")),
]);
const zwItems = parseList(el(withZwsp));
eq(zwItems.length, 1, "只含零宽字符的列表项按空节点丢弃");
eq(zwItems[0].text, "零宽节点", "文本里的零宽字符被清掉");
eq(zwItems[0].html, "零宽节点", "HTML 里的零宽字符也被清掉");
eq(serializeSubtree(zwItems[0]), "- 零宽节点", "序列化结果不含零宽字符");

/*
 * 「有没有文字」不能代表「有没有内容」。
 * <img> 的 textContent 是空的，KaTeX 公式的 textContent 只是公式源码，
 * 判据只看 text 的话，纯图片项和纯公式项会被当成空行整个丢掉。
 */
const withRich = list("u", "LR", [
    li("R1", p("PR1", "", '<span data-type="img"><img src="assets/a.png" alt=""></span>')),
    li("R2", p("PR2", "", '<span data-type="inline-math" data-subtype="math" data-content="E=mc^2"></span>')),
    li("R3", p("PR3", "   ")),
]);
const richItems = parseList(el(withRich));
eq(richItems.length, 2, "纯图片项与纯公式项保留，只有真空项被丢");
eq(richItems[0].text, "", "纯图片项确实没有文字");
eq(richItems[1].text, "", "纯公式项确实没有文字");

// 只含 <br> 的项仍然算空
const onlyBr = list("u", "LB", [li("B1", p("PB1", "", "<br>")), li("B2", p("PB2", "有内容"))]);
eq(parseList(el(onlyBr)).length, 1, "只含 <br> 的项按空节点丢弃");

/* -------------------------------------------------------------- 2. 装饰结果 */

console.log("[2] 装饰（深度 / 分支色 / 编号）");
const PALETTE = ["#111111", "#222222", "#333333"];
const root: MMNode = wrapRoot(items, "导图");
const meta = decorate(root, PALETTE, true);

eq(root.depth, 0, "根节点深度");
eq(root.children[0].depth, 1, "一级节点深度");
eq(root.children[0].children[0].depth, 2, "二级节点深度");
eq(root.children[0].children[0].children[0].depth, 3, "三级节点深度");
eq(meta.maxDepth, 3, "最大深度");
eq(meta.count, flatten(root).length, "节点总数与 flatten 一致");

eq(root.children[0].color, PALETTE[0], "第一个一级分支取到色板第 0 色");
eq(root.children[1].color, PALETTE[1], "第二个一级分支取到色板第 1 色");
eq(root.children[0].children[0].color, PALETTE[0], "子节点继承一级分支色");
eq(root.color, null, "根节点不带分支色");

const noColor = wrapRoot(parseList(domTree), "导图");
decorate(noColor, PALETTE, false);
eq(noColor.children[0].children[0].color, PALETTE[0], "关闭分支配色时全部使用首色");

/* -------------------------------------------------------------- 3. 布局结果 */

console.log("[3] 布局（逻辑图 / 思维导图 / 树状图）");

function collect(n: MMNode): MMNode[] {
    const out: MMNode[] = [];
    const walk = (x: MMNode) => {
        out.push(x);
        x.kids.forEach(walk);
    };
    walk(n);
    return out;
}

function checkLayout(mode: "logic" | "mind" | "tree") {
    const r = wrapRoot(parseList(domTree), "导图");
    decorate(r, PALETTE, true);
    // 模拟真实测量：宽度按文本长度估算
    for (const n of flatten(r)) {
        n.w = Math.min(240, 40 + n.text.length * 14);
        n.h = 34;
    }
    const box = layout(r, { mode, gapX: 58, gapY: 16, padX: 72, padY: 64 });
    const nodes = collect(r);
    const horiz = mode !== "tree";

    ok(box.w > 0 && box.h > 0, `${mode}: 画布尺寸有效`);
    ok(nodes.length === flatten(r).length, `${mode}: 布局覆盖全部节点`);

    for (const n of nodes) {
        ok(n.x >= -0.01 && n.y >= -0.01, `${mode}: 节点 ${n.text} 坐标为负`);
        ok(n.x + n.w <= box.w + 1 && n.y + n.h <= box.h + 1, `${mode}: 节点 ${n.text} 越界`);
    }

    // 任意两节点不重叠
    let overlap = 0;
    for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
            const x = nodes[a];
            const y = nodes[b];
            if (x.x < y.x + y.w - 0.01 && y.x < x.x + x.w - 0.01 && x.y < y.y + y.h - 0.01 && y.y < x.y + x.h - 0.01) {
                overlap++;
            }
        }
    }
    eq(overlap, 0, `${mode}: 不存在节点重叠`);

    // 父节点在交叉轴上居中于首尾子节点
    for (const n of nodes) {
        if (n.kids.length === 0) continue;
        if (mode === "mind" && n.depth === 0) continue; // 根节点按设计固定在两侧中心
        const first = n.kids[0];
        const last = n.kids[n.kids.length - 1];
        const pc = horiz ? n.y + n.h / 2 : n.x + n.w / 2;
        const mid = horiz
            ? (first.y + first.h / 2 + last.y + last.h / 2) / 2
            : (first.x + first.w / 2 + last.x + last.w / 2) / 2;
        ok(Math.abs(pc - mid) < 0.6, `${mode}: 父节点 ${n.text} 未对齐子树中点（偏差 ${(pc - mid).toFixed(2)}）`);
    }

    // 深度轴单调递增
    const depthOk = (n: MMNode) => {
        for (const k of n.kids) {
            const parentEnd = horiz ? n.x + n.w : n.y + n.h;
            const childStart = horiz ? k.x : k.y;
            if (k.x >= n.x) {
                ok(childStart >= parentEnd - 0.01, `${mode}: 深度轴错误 ${n.text} → ${k.text}`);
            }
            depthOk(k);
        }
    };
    depthOk(r);

    // 思维导图应左右分布
    if (mode === "mind") {
        const side = collect(r).filter((n) => n.depth === 1);
        ok(side.some((n) => n.dir === 1) && side.some((n) => n.dir === -1), "mind: 一级分支分布在左右两侧");
    }
}

checkLayout("logic");
checkLayout("mind");
checkLayout("tree");

/* -------------------------------------------------------------- 4. 折叠 */

console.log("[4] 折叠");
{
    const r = wrapRoot(parseList(domTree), "导图");
    decorate(r, PALETTE, true);
    for (const n of flatten(r)) {
        n.w = 100;
        n.h = 34;
    }
    const before = layout(r, { mode: "logic", gapX: 58, gapY: 16, padX: 72, padY: 64 });

    const first = r.children[0];
    first.folded = true;
    const after = layout(r, { mode: "logic", gapX: 58, gapY: 16, padX: 72, padY: 64 });

    eq(first.kids.length, 0, "折叠后不参与布局的子节点为空");
    ok(after.w < before.w, "折叠后画布变窄");
    ok(after.h <= before.h, "折叠后画布不变高");
}

/* ------------------------------------------------- 5. 结构操作（纯逻辑） */

console.log("[5] 结构操作（块 ID / 祖先 / 可执行性 / 序列化）");

/** 只关心个别字段时用，避免构造完整节点 */
const mk = (o: Partial<MMNode>) => o as unknown as MMNode;

// 5.1 解析时记录的三种块 ID
{
    const r = wrapRoot(parseList(domTree), "导图");
    const l1 = r.children[0];
    eq(l1.id, "L1", "节点记录列表项块 ID");
    eq(l1.contentId, "P1", "节点记录内容块 ID（改名要用它）");
    eq(l1.listId, "L0", "顶层节点归属根列表块");
    eq(l1.subListId, "L1sub", "节点记录子列表块 ID（降级要用它）");

    const l11 = l1.children[0];
    eq(l11.listId, "L1sub", "二级节点归属其所在列表块");
    eq(l11.subListId, "L11sub", "二级节点记录子列表块 ID");
    eq(l11.children[0].subListId, "", "叶子节点没有子列表 ID");
}

// 5.2 祖先判断（拖拽时用来阻止拖进自己的子树）
{
    const r = wrapRoot(parseList(domTree), "导图");
    decorate(r, PALETTE, true); // parent 指针由 decorate 建立
    const a = r.children[0];
    const b = a.children[0].children[0];
    ok(isAncestor(a, b), "跨两级仍能识别祖先关系");
    ok(!isAncestor(b, a), "反向不成立");
    ok(!isAncestor(a, a), "自身不算自己的祖先");
    ok(!isAncestor(a, null), "空节点返回 false");
}

// 5.3 下标与菜单可执行性
{
    const r = wrapRoot(parseList(domTree), "导图");
    decorate(r, PALETTE, true);
    const first = r.children[0];
    const second = r.children[1];
    eq(indexInParent(first), 0, "第一个子节点下标为 0");
    eq(indexInParent(second), 1, "第二个子节点下标为 1");
    eq(indexInParent(r), -1, "虚拟根无父节点");

    ok(!canMoveUp(first), "首个节点不能上移");
    ok(canMoveDown(first), "首个节点可以下移");
    ok(!canMoveDown(second), "末个节点不能下移");
    ok(!canIndent(first), "首个节点不能降级");
    ok(canIndent(second), "第二个节点可以降级");
    ok(!canOutdent(first), "顶层节点不能升级");
    ok(canOutdent(first.children[0]), "二级节点可以升级");
    ok(canDelete(first) && canEdit(first), "真实节点可删除、可编辑");
    ok(!canDelete(r) && !canEdit(r), "虚拟根不可删除、不可编辑");
}

// 5.4 子树序列化（moveBlock 表达不了的位置走副本路径时用）
{
    eq(markerOf(mk({ kind: "bullet" })), "-", "无序项标记");
    eq(markerOf(mk({ kind: "ordered", numbered: true })), "1.", "有序项标记");
    eq(markerOf(mk({ kind: "task" })), "- [ ]", "任务项标记");

    eq(newItemMarkdown(mk({ kind: "bullet" })), "- 新节点", "新建无序节点");
    eq(newItemMarkdown(mk({ kind: "task" })), "- [ ] 新节点", "新建任务节点");

    const r = wrapRoot(parseList(domTree), "导图");
    const lines = serializeSubtree(r.children[0]).split("\n");
    eq(lines.length, 4, "序列化行数");
    eq(lines[0], "- 根节点", "首行是根节点");
    eq(lines[1], "  1. 第一项", "子层级缩进两格且跟随有序列表类型");
    eq(lines[2], "    - 叶子", "孙层级继续缩进且跟随无序列表类型");
    eq(lines[3], "  1. 第二项", "同级子项缩进一致");
}

// 5.4b 副本序列化必须带上行内格式
//
// 原先用的是 escapeMd(node.text) —— 纯文本，于是「边界位置的降级/升级」「快速复制」
// 「Ctrl+C 再 Ctrl+V」会把整棵子树的双链、公式、加粗**静默重建成纯文本**，
// 而且块 ID 也会重建。实测依据见 tests/kernel/copy-fidelity.mjs。
{
    const rich = parseList(
        el(
            list("u", "LS", [
                li("S1", p("PS1", "粗体 普通", '<span data-type="strong">粗体</span> 普通')),
                li("S2", p("PS2", "1. 看起来像列表")),
                li("S3", p("PS3", "", '<span data-type="img"><img src="assets/pic.png" alt="照片"></span>')),
                li("S4", p("PS4", "上下", '<span data-type="strong">上</span>\n<span data-type="em">下</span>')),
                li(
                    "S5",
                    p("PS5", "红字", '<span data-type="text" style="color: var(--b3-font-color1)">红字</span>'),
                ),
            ]),
        ),
    );
    eq(serializeSubtree(rich[0]), '- <span data-type="strong">粗体</span> 普通', "含格式的节点保留 HTML");
    eq(serializeSubtree(rich[1]), "- 1\\. 看起来像列表", "纯文本节点仍然转义 markdown 元字符");
    eq(serializeSubtree(rich[2]), "- ![照片](assets/pic.png)", "图片转成 markdown 语法");
    eq(
        serializeSubtree(rich[3]),
        '- <span data-type="strong">上</span> <span data-type="em">下</span>',
        "内容里的换行压成空格，不破坏列表结构",
    );
    eq(
        serializeSubtree(rich[4]),
        '- <span data-type="text" style="color: var(--b3-font-color1)">红字</span>',
        "颜色内联样式原样保留",
    );

    // 子树要跟着一起走，且每层都保格式
    // 注意 wrapRoot 对「只有一个顶层项」会直接返回该项本身，所以这里从 nested 起算
    const nested = wrapRoot(
        parseList(
            el(
                list("u", "LT", [
                    li(
                        "T1",
                        p("PT1", "父 子", '<span data-type="strong">父</span>'),
                        list("u", "LT2", [li("T2", p("PT2", "子", '<span data-type="em">子</span>'))]),
                    ),
                ]),
            ),
        ),
        "导图",
    );
    const out = serializeSubtree(nested).split("\n");
    eq(out.length, 2, "子树一起序列化");
    eq(out[0], '- <span data-type="strong">父</span>', "父节点保格式");
    eq(out[1], '  - <span data-type="em">子</span>', "子节点保格式且缩进");

    // 改名走哪条路由这个判据决定：
    // 含格式 → 回到源列表改（就地改会把格式抹掉）；纯文本 → 就地改（轻快且无损）
    eq(hasInlineFormat(rich[0]), true, "含格式的节点必须回到原文编辑");
    eq(hasInlineFormat(rich[2]), true, "纯图片节点也必须回到原文编辑");
    eq(hasInlineFormat(rich[1]), false, "纯文本节点可以就地改名");
}

// 5.5 markdown 转义（改名是纯文本语义，不能被解析成结构）
{
    eq(escapeMd("- 看起来像列表"), "\\- 看起来像列表", "行首短横被转义");
    eq(escapeMd("1. 看起来像有序列表"), "1\\. 看起来像有序列表", "行首数字加点被转义");
    eq(escapeMd("# 标题"), "\\# 标题", "行首井号被转义");
    eq(escapeMd("正文里的 * 星号"), "正文里的 \\* 星号", "行内星号被转义");
    eq(escapeMd("a_b_c"), "a\\_b\\_c", "行内下划线被转义");
    eq(escapeMd("普通文本"), "普通文本", "普通文本保持不变");
}

/* ------------------------------------------------------ 6. 连线几何（主干汇聚） */

/** 从 SVG path 的 d 里抠出全部数字 */
const nums = (d: string): number[] => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

console.log("[6] 连线几何（主干汇聚 / 渐细 / 圆角）");

// 6.1 逻辑结构图：主干 + 脊 + 支线
{
    const parent = { x: 0, y: 100, w: 80, h: 40, dir: 1 as const };
    const kids = [
        { x: 200, y: 0, w: 60, h: 30, dir: 1 as const },
        { x: 200, y: 100, w: 60, h: 30, dir: 1 as const },
        { x: 200, y: 200, w: 60, h: 30, dir: 1 as const },
    ];
    const cons = buildConnectors({ parent, kids, mode: "logic", style: "elbow", gap: 58, base: 2.8 });

    const trunk = cons.find((c) => c.kind === "trunk");
    const spine = cons.find((c) => c.kind === "spine");
    const stubs = cons.filter((c) => c.kind === "stub");

    ok(!!trunk && !!spine, "逻辑图同时产出主干与脊");
    eq(stubs.length, 3, "每个子节点各有一条支线");

    const tp = nums(trunk!.d);
    eq(tp[0], 80, "主干从父节点右边缘出发");
    eq(tp[1], 120, "主干起点落在父节点垂直中心");
    ok(tp[2] > 80, "主干向右延伸");
    ok(tp[2] - tp[0] <= 42, "主干长度不超过上限");

    const sp = nums(spine!.d);
    eq(sp[0], sp[2], "脊是垂直的");
    eq(sp[0], tp[2], "脊的 x 与主干终点对齐");
    ok(sp[1] <= 115, "脊的上端覆盖最上方子节点");
    ok(sp[3] >= 215, "脊的下端覆盖最下方子节点");

    for (const s of stubs) {
        const p = nums(s.d);
        eq(p[0], tp[2], "支线从脊上出发");
        eq(p[p.length - 2], 200, "支线终点落在子节点左边缘");
    }

    ok(trunk!.width > spine!.width, "主干比脊粗（渐细）");
    ok(spine!.width > stubs[0].width, "脊比支线粗（渐细）");
    eq(stubs[0].childIndex, 0, "支线记录子节点下标");
    eq(trunk!.childIndex, null, "主干不归属任何子节点");
}

// 6.2 直线模式不产生主干与脊
{
    const parent = { x: 0, y: 0, w: 80, h: 40, dir: 1 as const };
    const kids = [{ x: 200, y: 0, w: 60, h: 30, dir: 1 as const }];
    const cons = buildConnectors({ parent, kids, mode: "logic", style: "straight", gap: 58, base: 2.8 });
    eq(cons.length, 1, "直线模式只画一条线");
    eq(cons[0].kind, "stub", "直线模式没有主干与脊");
}

// 6.3 圆角只在距离足够时使用，贴近父节点的支线退化为直线
{
    const parent = { x: 0, y: 100, w: 80, h: 40, dir: 1 as const };
    const kids = [
        { x: 200, y: 0, w: 60, h: 30, dir: 1 as const },
        { x: 200, y: 100, w: 60, h: 30, dir: 1 as const },
    ];
    const cons = buildConnectors({ parent, kids, mode: "logic", style: "curve", gap: 58, base: 2.8 });
    const stubs = cons.filter((c) => c.kind === "stub");
    ok(stubs[0].d.includes("Q"), "远离父节点的支线带圆角");
    ok(!stubs[1].d.includes("Q"), "贴近父节点的支线退化为直线，避免圆角互相打架");
}

// 6.4 树状图：主轴换成纵向
{
    const parent = { x: 0, y: 0, w: 80, h: 40, dir: 1 as const };
    const kids = [
        { x: -40, y: 150, w: 60, h: 30, dir: 1 as const },
        { x: 120, y: 150, w: 60, h: 30, dir: 1 as const },
    ];
    const cons = buildConnectors({ parent, kids, mode: "tree", style: "elbow", gap: 58, base: 2.8 });
    const trunk = cons.find((c) => c.kind === "trunk")!;
    const spine = cons.find((c) => c.kind === "spine")!;

    const tp = nums(trunk.d);
    eq(tp[0], 40, "树状图主干从父节点水平中心出发");
    eq(tp[1], 40, "主干起点落在父节点下边缘");
    eq(tp[2], 40, "主干垂直向下");
    ok(tp[3] > 40, "主干向下延伸");

    const sp = nums(spine.d);
    eq(sp[1], sp[3], "树状图的脊是水平的");
    eq(sp[1], tp[3], "脊的 y 与主干终点对齐");
    ok(sp[0] < 40 && sp[2] > 40, "脊横跨所有子节点");
}

// 6.5 思维导图：根节点左右两侧各成一组，各有自己的主干
{
    const parent = { x: 0, y: 0, w: 80, h: 40, dir: 1 as const };
    const kids = [
        { x: 200, y: 0, w: 60, h: 30, dir: 1 as const },
        { x: -200, y: 0, w: 60, h: 30, dir: -1 as const },
    ];
    const cons = buildConnectors({ parent, kids, mode: "mind", style: "elbow", gap: 58, base: 2.8 });
    const trunks = cons.filter((c) => c.kind === "trunk");
    const stubs = cons.filter((c) => c.kind === "stub");

    eq(trunks.length, 2, "左右两侧各有一条主干");
    const right = nums(trunks[0].d);
    const left = nums(trunks[1].d);
    eq(right[0], 80, "右侧主干从父节点右边缘出发");
    ok(right[2] > 80, "右侧主干向右");
    eq(left[0], 0, "左侧主干从父节点左边缘出发");
    ok(left[2] < 0, "左侧主干向左");

    eq(stubs.length, 2, "两侧各有一条支线");
    eq(nums(stubs[1].d).slice(-2)[0], -140, "左侧支线终点落在子节点右边缘");
}

/* ------------------------------------------------------------ 7. 连线配色 */

console.log("[7] 连线配色（实色混合）");

{
    eq(mixHex("#ffffff", [0, 0, 0], 1), "rgb(255,255,255)", "alpha=1 时保留原色");
    eq(mixHex("#ffffff", [0, 0, 0], 0), "rgb(0,0,0)", "alpha=0 时完全变成底色");
    eq(mixHex("#000000", [255, 255, 255], 0.5), "rgb(128,128,128)", "半透明混色取中间值");
    eq(mixHex("不是颜色", [0, 0, 0], 1), "不是颜色", "非十六进制输入原样返回");
    ok(mixHex("#4c8dff", [11, 13, 18], 0.9).startsWith("rgb("), "混出的颜色不透明，重叠段不会叠深");
}

/* ------------------------------------------------- 8. 连线语义化（虚线 / 下标） */

console.log("[8] 连线语义化（虚线 / 子节点下标）");
{
    const parent = { x: 0, y: 0, w: 80, h: 40, dir: 1 as const };
    const kids = [
        { x: 200, y: 0, w: 60, h: 30, dir: 1 as const },
        { x: 200, y: 60, w: 60, h: 30, dir: 1 as const },
    ];
    const cons = buildConnectors({
        parent,
        kids,
        mode: "logic",
        style: "elbow",
        gap: 58,
        base: 2.8,
        kidDash: [undefined, "5 4"],
    });
    const stubs = cons.filter((c) => c.kind === "stub");
    eq(stubs[0].dash, undefined, "普通支线是实线");
    eq(stubs[1].dash, "5 4", "已完成任务的支线是虚线");
    eq(cons.find((c) => c.kind === "trunk")!.dash, undefined, "主干始终实线（同级共享，按子节点区分不了）");
    eq(cons.find((c) => c.kind === "spine")!.dash, undefined, "脊也始终实线");

    /*
     * 思维导图模式下根节点两侧的子节点会被分成两组分别生成连线。
     * 分组下标一旦漏出去，调用方拿它反查 `n.kids[i]` 就会取到另一侧的节点 ——
     * 支线颜色会互相串。所以 childIndex 必须是 kids 数组里的**原始下标**。
     */
    const mixed = buildConnectors({
        parent,
        kids: [
            { x: -200, y: 0, w: 60, h: 30, dir: -1 as const },
            { x: 200, y: 0, w: 60, h: 30, dir: 1 as const },
            { x: -200, y: 80, w: 60, h: 30, dir: -1 as const },
        ],
        mode: "mind",
        style: "elbow",
        gap: 58,
        base: 2.8,
    });
    const idx = mixed
        .filter((c) => c.kind === "stub")
        .map((c) => c.childIndex)
        .sort();
    eq(JSON.stringify(idx), "[0,1,2]", "左右分组后子节点下标仍是原始下标");

    // 虚线也要按原始下标取 —— 分组之后不能错位到另一侧的节点上
    const dashed = buildConnectors({
        parent,
        kids: [
            { x: -200, y: 0, w: 60, h: 30, dir: -1 as const },
            { x: 200, y: 0, w: 60, h: 30, dir: 1 as const },
        ],
        mode: "mind",
        style: "elbow",
        gap: 58,
        base: 2.8,
        kidDash: ["5 4", undefined],
    });
    const dashByIdx = new Map(dashed.filter((c) => c.kind === "stub").map((c) => [c.childIndex, c.dash]));
    eq(dashByIdx.get(0), "5 4", "左侧（原始下标 0）的支线取到虚线");
    eq(dashByIdx.get(1), undefined, "右侧（原始下标 1）的支线仍是实线");
}

/* ---------------------------------------------------- 9. 视图偏好编解码（P0-3） */

console.log("[9] 视图偏好编解码");
{
    eq(encodeViewPrefs({}), "", "空偏好编码为空串");
    eq(encodeViewPrefs({ layout: "logic" }), "layout=logic", "只编码用户改过的项");
    const full = encodeViewPrefs({ layout: "mind", theme: "deep", edge: "elbow", scale: 1.25 });
    eq(full, "layout=mind;theme=deep;edge=elbow;scale=1.2500", "四项一起编码");

    const back = decodeViewPrefs(full);
    eq(back.layout, "mind", "解出布局");
    eq(back.theme, "deep", "解出主题");
    eq(back.edge, "elbow", "解出连线");
    eq(back.scale, 1.25, "解出缩放");

    // 往返一致：读出来再写回去必须得到同一个串，否则每次开关文档都会「变一次」
    eq(encodeViewPrefs(decodeViewPrefs(full)), full, "编解码往返一致");

    eq(JSON.stringify(decodeViewPrefs(null)), "{}", "空属性解出空偏好");
    eq(JSON.stringify(decodeViewPrefs("")), "{}", "空串解出空偏好");
    eq(decodeViewPrefs("垃圾数据").layout, undefined, "无法解析的内容被忽略");
    eq(decodeViewPrefs("layout=不存在的布局").layout, undefined, "非法布局被忽略");
    eq(decodeViewPrefs("edge=不存在的连线").edge, undefined, "非法连线被忽略");
    // 主题不做白名单：主题列表会增长，老代码不该把新主题判成非法值
    eq(decodeViewPrefs("theme=未来的新主题").theme, "未来的新主题", "主题名不做白名单校验");

    // 缩放必须夹进安全区间 —— 一个手改过的属性值不该把画布缩没
    eq(decodeViewPrefs("scale=0.0001").scale, 0.15, "过小的缩放被夹到下限");
    eq(decodeViewPrefs("scale=999").scale, 6, "过大的缩放被夹到上限");
    eq(decodeViewPrefs("scale=abc").scale, undefined, "非数字缩放被忽略");
    eq(decodeViewPrefs("scale=0").scale, undefined, "0 缩放被忽略（会让画布整个消失）");

    // 坏掉一段不能连累其它段
    const mixed = decodeViewPrefs("layout=tree;theme=;edge=straight;scale=1");
    eq(mixed.layout, "tree", "空值段之前的项仍然解出");
    eq(mixed.theme, undefined, "空值段被跳过");
    eq(mixed.edge, "straight", "空值段之后的项仍然解出");
    eq(mixed.scale, 1, "整数缩放也能解出");
}

/* ------------------------------------------------------ 10. 批量操作的输入整理 */

console.log("[10] 批量操作（选中项整理）");
{
    const r = wrapRoot(parseList(domTree), "导图");
    decorate(r, PALETTE, true);

    const a = r.children[0];
    const b = a.children[0];
    eq(topLevelOf([a, b]).length, 1, "祖先也被选中时只保留最外层");
    ok(topLevelOf([a, b])[0] === a, "保留的是祖先那一项");
    eq(topLevelOf([r.children[0], r.children[1]]).length, 2, "互不包含的选中项都保留");
    eq(topLevelOf([]).length, 0, "空选择返回空");
    eq(topLevelOf([b]).length, 1, "只选了子节点时原样保留");
}

/* ------------------------------------------------------------ 11. 节点标记（P1-2） */

console.log("[11] 节点标记的编解码与解析");
{
    /* ---- 编解码 ---- */
    eq(encodeMark(null), null, "空标记编码成 null（写回时表示删掉属性，而不是写空串）");
    eq(encodeMark({}), null, "全是空字段也当作没有标记");
    eq(decodeMark(null), undefined, "没有属性 → 没有标记");
    eq(decodeMark(""), undefined, "空属性 → 没有标记");
    eq(decodeMark("   "), undefined, "全空白属性 → 没有标记");

    // 手写属性的场景：属性值直接就是图标，最省事
    eq(decodeMark("⭐")?.icon, "⭐", "裸字符串按图标解析（用户手写属性也能用）");
    eq(decodeMark("{坏 JSON"), undefined, "以 { 开头但解析不了 → 当作没有标记，不抛异常");
    eq(decodeMark("null"), undefined, "JSON null → 没有标记");
    eq(decodeMark('"字符串"'), undefined, "JSON 字符串 → 没有标记");
    eq(decodeMark("[1,2]"), undefined, "JSON 数组 → 没有标记");

    /* ---- 往返 ---- */
    const full = { icon: "⭐", label: "重要", color: "#e5534b" };
    const back = decodeMark(encodeMark(full));
    eq(back?.icon, "⭐", "往返保住图标");
    eq(back?.label, "重要", "往返保住标签");
    eq(back?.color, "#e5534b", "往返保住颜色");

    /* ---- 越界与脏值 ---- */
    eq(decodeMark('{"label":"一二三四五六七八九十"}')?.label, "一二三四五六七八", "标签超长截断到 8 个字");
    eq(decodeMark('{"color":"red"}'), undefined, "非法颜色被丢弃（只剩空标记 = 没有标记）");
    eq(decodeMark('{"color":"#GGG"}'), undefined, "非十六进制颜色被丢弃");
    eq(decodeMark('{"icon":123}'), undefined, "图标不是字符串 → 丢弃");
    eq(hasMark({ color: "#fff" }), true, "只有颜色也算有标记");
    eq(hasMark({}), false, "空对象不算标记");

    /* ---- 变更判定（避免白写一次内核 + 白记一条撤销） ---- */
    eq(sameMark(undefined, undefined), true, "都没标记 → 相同");
    eq(sameMark(undefined, {}), true, "没有标记 vs 空标记 → 相同");
    eq(sameMark({ icon: "⭐" }, { icon: "⭐" }), true, "同一套标记 → 相同");
    eq(sameMark({ icon: "⭐" }, { icon: "🔥" }), false, "换了图标 → 不同");
    eq(sameMark({ icon: "⭐" }, { icon: "⭐", color: "#e5534b" }), false, "多了一个颜色 → 不同");

    /* ---- 解析层：从块属性读出来 ---- */
    const marked = list("u", "LM", [
        li("M1", p("MP1", "带标记"), undefined, [], { [ATTR_MARK]: '{"icon":"⭐","label":"重要"}' }),
        li("M2", p("MP2", "没标记")),
        li("M3", p("MP3", "坏属性"), undefined, [], { [ATTR_MARK]: "{坏" }),
    ]);
    const nodes = parseList(el(marked));
    eq(nodes[0].mark?.icon, "⭐", "parseList 从块属性读出图标");
    eq(nodes[0].mark?.label, "重要", "parseList 从块属性读出标签");
    eq(nodes[1].mark, undefined, "没有属性的节点没有标记");
    eq(nodes[2].mark, undefined, "属性坏掉的节点按「没有标记」处理，不影响其它节点");

    // 标记不进文字：它不参与改名 / 复制 / 导出，只在渲染时挂上去
    eq(nodes[0].text, "带标记", "标记不会混进节点文字");
}

/* ------------------------------------------------------ 12. 诊断信息收集（P1-5） */

console.log("[12] 诊断信息的收集与格式化");
{
    /* 先把 console 换成探针，再装诊断 —— 顺序不能反：
       诊断模块在安装那一刻就把「当时的 console」抓成原函数，
       想验证「原日志有没有被吞掉」，探针必须站在这条链的下游。 */
    const realWarn = console.warn;
    const realErr = console.error;
    const forwarded: string[] = [];
    console.warn = (...a: unknown[]) => {
        forwarded.push(a.map(String).join(" "));
    };
    console.error = (...a: unknown[]) => {
        forwarded.push(a.map(String).join(" "));
    };

    installDiagnostics();
    clearNotes();

    /* ---- 收什么：只收 [mindmap] 的 ---- */
    console.warn("[mindmap] 甲：写内核失败");
    eq(recentNotes().length, 1, "带 [mindmap] 的警告被记下来了");
    eq(forwarded.length, 1, "原日志照常往下传（没有被「记录」吞掉）");
    eq(forwarded[0], "[mindmap] 甲：写内核失败", "传下去的还是原文");

    console.warn("这是思源本体或别的插件写的，不该收");
    eq(recentNotes().length, 1, "不带 [mindmap] 的日志不会挤进来");
    eq(forwarded.length, 2, "但它在控制台里照旧可见");

    console.error("[mindmap] 乙：内核拒绝了");
    eq(recentNotes().length, 2, "error 也收");
    eq(recentNotes()[1].level, "error", "级别记对了");

    /* ---- 参数怎么压成一行 ---- */
    console.warn("[mindmap] 丙", { a: 1 }, new Error("炸了"));
    const note = recentNotes()[2].text;
    ok(note.includes('{"a":1}'), "对象参数走 JSON", note);
    ok(note.includes("Error: 炸了"), "异常参数带上 message", note);
    ok(!note.includes("\n"), "压成了一行（诊断信息是给人看的，多行会散架）");

    /* ---- 环形上限 ---- */
    clearNotes();
    for (let i = 0; i < 30; i++) console.warn(`[mindmap] 第 ${i} 条`);
    eq(recentNotes().length, 24, "最多留 24 条（排障看的是最近发生了什么，不是完整日志）");
    eq(recentNotes()[0].text, "[mindmap] 第 6 条", "挤掉的是最老的，留下的是最近的");
    eq(recentNotes()[23].text, "[mindmap] 第 29 条", "最后一条在");

    /* ---- 格式化 ---- */
    const fmt = formatNotes();
    ok(/^\s+\d{2}:\d{2}:\d{2} \[warn\] \[mindmap\] 第 6 条/.test(fmt), "每条前面挂上时间与级别", fmt.split("\n")[0]);
    eq(fmt.split("\n").length, 24, "一行一条");

    clearNotes();
    eq(formatNotes(), "（本次会话没有 [mindmap] 警告或错误）", "没有记录时说清楚「没有」，而不是留一片空白");

    /* ---- 抬头时间戳 ---- */
    const fixed = new Date(2026, 8, 19, 10, 4, 9).getTime();
    eq(stamp(fixed), "2026-09-19 10:04:09", "时间戳补零到秒（一眼能看出是哪一次会话）");
    eq(stamp(new Date(2026, 0, 2, 3, 4, 5).getTime()), "2026-01-02 03:04:05", "个位数月份 / 日期也补零");

    /* ---- 幂等 ---- */
    installDiagnostics();
    clearNotes();
    console.warn("[mindmap] 丁");
    eq(recentNotes().length, 1, "重复安装只生效一次（热重载不会套娃记两遍）");

    console.warn = realWarn;
    console.error = realErr;
}

/* ------------------------------------------------- 13. 键位换算（跨平台显示） */
{
    console.log("\n[13] 键位换算：思源表示法 → 平台可读写法");
    // 起因：快捷键速查里写死了 `⌥⌘D`，而本机是 Windows —— 用户在自己
    //「设置 → 快捷键」里看到的是 `Ctrl+Alt+D`（实测：思源主菜单里「魔法排版」
    // 显示 `Ctrl+Alt+P`，其 keymap 存值正是 `⌥⌘P`）。两套符号对不上。

    /**
     * 测试用的简写。
     *
     * `readableHotkey` 的第三个参数（空格标签）是**必传**的 —— 见
     * `utils/hotkey.ts` 的说明：不给默认值，是为了让「调用点忘了传翻译」
     * 变成编译错误，而不是让英文用户在界面上看到「空格」。
     * 下面绝大多数用例的键位里没有空格，标签用不上；统一给个中文字面量，
     * 免得每行都写一遍。**空格那条路径单独在下面显式验**。
     */
    const hk = (hotkey: string, isMac: boolean) => readableHotkey(hotkey, isMac, "空格");

    /* ---- macOS：原样保留思源表示法 ---- */
    eq(hk("⌥⌘D", true), "⌥⌘D", "macOS 上原样保留（思源自己的表示法就是这个）");
    eq(hk("⌘Z", true), "⌘Z", "macOS 上单修饰键也不动");

    /* ---- Windows / Linux：换算成 Ctrl / Alt / Shift ---- */
    eq(hk("⌥⌘D", false), "Ctrl+Alt+D", "★ Windows 上 ⌥⌘D → Ctrl+Alt+D（与思源菜单的写法一致）");
    eq(hk("⌥⌘V", false), "Ctrl+Alt+V", "★ 另一条同理");
    eq(hk("⌘Z", false), "Ctrl+Z", "单 ⌘ → Ctrl");
    eq(hk("⌥P", false), "Alt+P", "单 ⌥ → Alt（思源菜单里「设置」就是这么显示的）");

    /* ---- 顺序：Ctrl → Shift → Alt → 主键（照抄思源的规范顺序） ---- */
    // 顺序排错不会崩，但会造出第二套写法 —— 用户在思源设置页看到
    // `Shift+Alt+P`，插件里写着 `Alt+Shift+P`，等于又对不上。
    // 下面三条是从思源**实测显示**反推出来的：
    //   `⌥⌘P` → `Ctrl+Alt+P`    ⇒ Ctrl 在 Alt 前
    //   `⇧⌘F` → `Ctrl+Shift+F`  ⇒ Ctrl 在 Shift 前
    //   `⌥⇧P` → `Shift+Alt+P`   ⇒ Shift 在 Alt 前
    eq(hk("⌥⌘P", false), "Ctrl+Alt+P", "★ 顺序 Ctrl 在 Alt 前（对齐思源菜单里的「魔法排版 Ctrl+Alt+P」）");
    eq(hk("⇧⌘F", false), "Ctrl+Shift+F", "★ 顺序 Ctrl 在 Shift 前（对齐思源「固定搜索 Ctrl+Shift+F」）");
    eq(hk("⌥⇧P", false), "Shift+Alt+P", "★★ 顺序 Shift 在 Alt 前（对齐思源「命令面板 Shift+Alt+P」）");
    eq(hk("⌥⇧↓", false), "Shift+Alt+↓", "带方向键主键的组合同样成立");

    /* ---- 主键不被吞掉 ---- */
    eq(hk("F2", false), "F2", "没有修饰键时原样返回（不能被换算吃掉）");
    eq(hk("⌘\\", false), "Ctrl+\\", "反斜杠这类主键也要留下来");
    eq(hk("", false), "", "空串返回空串（迁移命令故意不绑键，不能变成 Ctrl+）");

    /* ---- 幂等：换算过的串再换算不该变样 ---- */
    // 防的是「已经显示成 Ctrl+Alt+D 了又被换算一遍」这类重复加工。
    eq(hk(hk("⌥⌘D", false), false), "Ctrl+Alt+D", "换算过的串再算一次结果不变");

    /* ---- ★ 空格：思源表示法里它是一个**字面空格**，不是符号 ---- */
    // `KEYCODELIST[32] = " "` ⇒ `Ctrl+空格` 在 conf.json 里存的就是 `"⌘ "`。
    // 直接拼出来是 `Ctrl+ ` —— 一个看不见的尾随空格，用户读不出该按什么。
    // 所以第三个参数（标签）必须真的被用上，且**两个平台都要换**（macOS 那边
    // 同样显示成 `⌘ `，一样不可见）。
    eq(readableHotkey("⌘ ", false, "空格"), "Ctrl+空格", "★ Windows：⌘␣ → Ctrl+空格（不是 Ctrl+␣）");
    eq(readableHotkey("⌘ ", true, "空格"), "⌘空格", "★ macOS：⌘␣ 里的空格同样要换成可见标签");
    eq(readableHotkey("⌘ ", false, "Space"), "Ctrl+Space", "★ 标签来自调用方（英文界面传 Space）");
    eq(readableHotkey("⌥ ", false, "空格"), "Alt+空格", "★ 另一条全局快捷键（Alt+空格）同理");
    eq(readableHotkey("⌘ ", false, "空格").trim(), readableHotkey("⌘ ", false, "空格"), "★ 换算后**没有尾随空白**（这正是要修的那个毛病）");
}

/* ------------------------------------------------------------------ 汇总 */
console.log("");
if (failures.length === 0) {
    console.log(`全部通过 ✓  共 ${passed} 项断言`);
} else {
    console.error(`${failures.length} 项失败，${passed} 项通过`);
    process.exitCode = 1;
}
