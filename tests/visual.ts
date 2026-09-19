/**
 * 浏览器可视化验证：用真实的 Protyle 列表结构挂载导图视图，
 * 用来在装机前肉眼确认节点宽度、连线汇聚、工具条与悬停按钮的实际观感。
 *
 * 由 tests/visual.mjs 打包成单个 js，再由同目录的 visual.html 加载。
 */
import { MindMapView } from "../src/core/renderer";
import type { MMConfig } from "../src/types";
import { DEFAULT_CONFIG } from "../src/types";

interface Spec {
    text: string;
    task?: boolean;
    done?: boolean;
    children?: Spec[];
}

let seq = 0;
const nid = () => `20260919${String(++seq).padStart(10, "0")}`;

function buildList(specs: Spec[], subtype: "u" | "o" | "t"): HTMLElement {
    const list = document.createElement("div");
    list.className = "list";
    list.dataset.nodeId = nid();
    list.dataset.subtype = subtype;

    for (const spec of specs) {
        const li = document.createElement("div");
        li.className = "li";
        li.dataset.nodeId = nid();
        if (spec.done) li.classList.add("protyle-task--done");
        if (spec.task) li.classList.add("protyle-task--undone");

        const action = document.createElement("div");
        action.className = "protyle-action";
        li.appendChild(action);

        const content = document.createElement("div");
        content.className = "p";
        content.dataset.nodeId = nid();
        content.textContent = spec.text;
        li.appendChild(content);

        if (spec.children?.length) li.appendChild(buildList(spec.children, subtype));
        list.appendChild(li);
    }
    return list;
}

const CONTENT: Spec[] = [
    {
        text: "大纲导图插件",
        children: [
            {
                text: "渲染内核",
                children: [
                    { text: "tidy-tree 布局引擎，支持三种结构" },
                    { text: "SVG 画连线 + HTML 画节点" },
                    {
                        text: "主干汇聚的连线形态",
                        children: [{ text: "父节点引出粗主干" }, { text: "沿脊分叉成细支线" }],
                    },
                ],
            },
            {
                text: "交互",
                children: [
                    { text: "方向键在节点间导航" },
                    { text: "Tab 加子节点、Enter 加同级" },
                    { text: "F2 改名并写回思源块" },
                ],
            },
            {
                text: "视觉",
                children: [
                    { text: "四层节点层级体系" },
                    { text: "六套主题，含高对比度" },
                ],
            },
        ],
    },
];

const ORDERED: Spec[] = [
    {
        text: "验收清单",
        children: [
            { text: "节点文字不再逐字竖排", children: [{ text: "中文按内容自适应宽度" }] },
            { text: "导图铺满画布", children: [{ text: "不再缩在中央一小块" }] },
            { text: "折叠按钮稳定贴在主干上" },
        ],
    },
];

const TASKS: Spec[] = [
    {
        text: "待办",
        task: true,
        children: [
            { text: "修复节点宽度坍缩", task: true, done: true },
            { text: "接入键盘快捷键", task: true, done: true },
            { text: "真机验收", task: true },
        ],
    },
];

/** 把回调收到的调用记下来，键盘探针靠它判断按键是否真的触发了结构操作 */
interface Recorder {
    actions: Array<{ kind: string; text: string }>;
    folds: Array<{ id: string; folded: boolean }>;
    renames: Array<{ id: string; text: string }>;
    layouts: string[];
    locateIds: string[];
    fullscreen: number;
    exits: number;
    /** Ctrl+Z / Ctrl+Y 被问到的时候，插件是怎么答的（"undo" / "redo"） */
    history: string[];
}

function newRecorder(): Recorder {
    return { actions: [], folds: [], renames: [], layouts: [], locateIds: [], fullscreen: 0, exits: 0, history: [] };
}

/**
 * 假的「插件撤销栈里有没有货」开关。
 *
 * 真机上它由 `Scanner.history` 决定：栈里有货插件才接管 Ctrl+Z，栈空就放行给思源。
 * 两条分支都要测，所以这里做成可切换的。
 */
let historyHandled = false;

function mount(
    host: HTMLElement,
    specs: Spec[],
    subtype: "u" | "o" | "t",
    title: string,
    patch: Partial<MMConfig>,
    mode: "inline" | "dialog" = "inline",
): { view: MindMapView; rec: Recorder } {
    const wrap = document.createElement("div");
    wrap.className = "protyle-wysiwyg";
    const list = buildList(specs, subtype);
    wrap.appendChild(list);
    host.appendChild(wrap);

    const rec = newRecorder();
    const config: MMConfig = { ...DEFAULT_CONFIG, ...patch };
    const view = new MindMapView(
        list,
        config,
        new Set<string>(),
        {
            onFoldChange: (id, folded) => void rec.folds.push({ id, folded }),
            onLocate: (id) => void rec.locateIds.push(id),
            onExit: () => void (rec.exits += 1),
            onLayoutChange: (k) => void rec.layouts.push(k),
            onFullscreen: () => void (rec.fullscreen += 1),
            onRename: (node, text) => void rec.renames.push({ id: node.id ?? "", text }),
            onNodeAction: (kind, node) => void rec.actions.push({ kind, text: node.text }),
            onHistory: (redo) => {
                rec.history.push(redo ? "redo" : "undo");
                return historyHandled;
            },
        },
        title,
        mode,
    );

    if (mode === "dialog") {
        // 全屏视图挂在弹层里，而不是编辑器内部 —— 这个差异会改变很多东西
        const layer = document.createElement("div");
        layer.className = "mm-test-dialog";
        wrap.appendChild(layer);
        view.mount(layer);
    } else {
        view.mount();
    }
    return { view, rec };
}

const host = document.getElementById("app")!;
const views: MindMapView[] = [];
const recs: Recorder[] = [];

const push = (m: ReturnType<typeof mount>) => {
    views.push(m.view);
    recs.push(m.rec);
};

push(mount(host, CONTENT, "u", "大纲导图插件", { theme: "deep", layout: "logic", edge: "curve" }));
push(mount(host, ORDERED, "o", "验收清单", { theme: "paper", layout: "mind", edge: "curve" }));
push(mount(host, TASKS, "t", "待办", { theme: "contrast", layout: "tree", edge: "elbow" }));

/* -------------------------------------------------------------- 键盘探针 */

interface Probe {
    name: string;
    ok: boolean;
    detail: string;
}

/**
 * 在无头浏览器里真实派发键盘事件，驱动渲染器的按键分发逻辑。
 *
 * 这里刻意走「派发事件」而不是直接调私有方法：需要验证的正是
 * 「谁拦住了按键、有没有漏给思源」这类跨模块行为，直接调方法就绕过了。
 * `leaked` 表示事件是否冒泡到了 document —— 即思源侧会不会也收到这个按键。
 */
function keyboardProbe(): Probe[] {
    const view = views[0];
    const rec = recs[0];
    const root = view.element;
    const out: Probe[] = [];

    const check = (name: string, ok: boolean, detail = "") => void out.push({ name, ok, detail });

    const selTexts = () =>
        Array.from(root.querySelectorAll<HTMLElement>(".mm-node.mm-sel")).map(
            (e) => e.querySelector(".mm-txt")?.textContent ?? "",
        );
    const selCount = () => root.querySelectorAll(".mm-node.mm-sel, .mm-node.mm-multi").length;
    const nodeByDepth0 = () => root.querySelector<HTMLElement>(".mm-node.mm-d0");

    /** 派发一次 keydown，返回「有没有被拦下」和「有没有漏到 document」 */
    function pressOn(target: HTMLElement, key: string, opts: KeyboardEventInit = {}) {
        let leaked = false;
        const spy = () => void (leaked = true);
        document.addEventListener("keydown", spy);
        const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
        target.dispatchEvent(ev);
        document.removeEventListener("keydown", spy);
        return { prevented: ev.defaultPrevented, leaked };
    }

    const press = (key: string, opts: KeyboardEventInit = {}) => pressOn(root, key, opts);

    const clearSel = () => void press("Escape");
    const focusRoot = () => {
        clearSel();
        press("ArrowRight"); // 无选中时方向键把焦点送到根节点
    };

    /* --- 1. 点击选中 --- */
    clearSel();
    nodeByDepth0()?.click();
    check("单击节点进入选中态", selTexts().join() === "大纲导图插件", `选中=${JSON.stringify(selTexts())}`);

    /* --- 2. 方向键导航 --- */
    press("ArrowRight");
    check("→ 走到第一个子节点", selTexts().join() === "渲染内核", `选中=${JSON.stringify(selTexts())}`);
    press("ArrowDown");
    check("↓ 走到下一个同级", selTexts().join() === "交互", `选中=${JSON.stringify(selTexts())}`);
    press("ArrowLeft");
    check("← 回到父节点", selTexts().join() === "大纲导图插件", `选中=${JSON.stringify(selTexts())}`);

    /* --- 3. 结构编辑键 --- */
    rec.actions.length = 0;
    const rTab = press("Tab");
    check(
        "Tab 加子节点且不回漏给思源",
        rTab.prevented && !rTab.leaked && rec.actions[0]?.kind === "insertChild",
        `prevented=${rTab.prevented} leaked=${rTab.leaked} action=${rec.actions[0]?.kind}`,
    );

    rec.actions.length = 0;
    press("Enter");
    check("Enter 加同级", rec.actions[0]?.kind === "insertSiblingAfter", `action=${rec.actions[0]?.kind}`);

    rec.actions.length = 0;
    const rSoft = press("Enter", { shiftKey: true });
    check(
        "Shift+Enter 不误加同级、也不外泄",
        rec.actions.length === 0 && rSoft.prevented && !rSoft.leaked,
        `action 数=${rec.actions.length} prevented=${rSoft.prevented} leaked=${rSoft.leaked}`,
    );

    rec.actions.length = 0;
    press("Tab", { shiftKey: true });
    check("Shift+Tab 降级", rec.actions[0]?.kind === "outdent", `action=${rec.actions[0]?.kind}`);

    rec.actions.length = 0;
    press("ArrowRight", { altKey: true });
    check("Alt+→ 升级", rec.actions[0]?.kind === "indent", `action=${rec.actions[0]?.kind}`);

    rec.actions.length = 0;
    const rMove = press("ArrowUp", { ctrlKey: true });
    check(
        "Ctrl+↑ 上移同级",
        rec.actions[0]?.kind === "moveUp" && rMove.prevented,
        `action=${rec.actions[0]?.kind}`,
    );

    /* --- 4. 折叠 --- */
    rec.folds.length = 0;
    press(" ");
    const foldedOnce = rec.folds[0]?.folded === true;
    press(" ");
    check(
        "空格切换折叠",
        foldedOnce && rec.folds[1]?.folded === false,
        `序列=${JSON.stringify(rec.folds.map((f) => f.folded))}`,
    );

    /* --- 5. 多选与退出 --- */
    focusRoot();
    press("ArrowRight");
    press("a", { ctrlKey: true });
    check("Ctrl+A 选中同级", selCount() === 3, `选中数=${selCount()}`);
    press("Escape");
    check("Esc 逐级清空选中", selCount() === 0 && selTexts().length === 0, `选中数=${selCount()}`);

    /* --- 6. 白名单必须放行给思源 --- */
    const passthrough: Array<[string, string, KeyboardEventInit]> = [
        ["Ctrl+S", "s", { ctrlKey: true }],
        ["Ctrl+P", "p", { ctrlKey: true }],
        ["F5", "F5", {}],
        ["F12", "F12", {}],
    ];
    for (const [label, key, init] of passthrough) {
        const r = press(key, init);
        check(`${label} 放行给思源`, !r.prevented && r.leaked, `prevented=${r.prevented} leaked=${r.leaked}`);
    }

    /* --- 6b. Ctrl+Z / Ctrl+Y：栈空放行，栈里有货才接管 ---
     *
     * 思源自己的撤销栈**收不到块 API 写出来的内容**（事务里 undoOperations 恒为空数组），
     * 所以导图上的删除/加节点只能由插件自己撤销。但用户刚在正文里打过字时，
     * 撤销的应该是那次输入 —— 插件栈空必须让路。
     */
    focusRoot();
    historyHandled = false;
    for (const [label, key] of [
        ["Ctrl+Z", "z"],
        ["Ctrl+Y", "y"],
    ] as Array<[string, string]>) {
        const r = press(key, { ctrlKey: true });
        check(`${label} 插件栈空时放行给思源`, !r.prevented && r.leaked, `prevented=${r.prevented} leaked=${r.leaked}`);
    }

    historyHandled = true;
    const rUndo = press("z", { ctrlKey: true });
    check("Ctrl+Z 插件有可撤销操作时被接管", rUndo.prevented && !rUndo.leaked, `prevented=${rUndo.prevented} leaked=${rUndo.leaked}`);
    check("Ctrl+Z 把 redo=false 交给扫描器", rec.history.at(-1) === "undo", JSON.stringify(rec.history));
    const rRedo = press("y", { ctrlKey: true });
    check("Ctrl+Y 插件有可重做操作时被接管", rRedo.prevented && !rRedo.leaked, `prevented=${rRedo.prevented} leaked=${rRedo.leaked}`);
    check("Ctrl+Y 把 redo=true 交给扫描器", rec.history.at(-1) === "redo", JSON.stringify(rec.history));
    const rShiftZ = press("z", { ctrlKey: true, shiftKey: true });
    check("Ctrl+Shift+Z 按重做处理", rShiftZ.prevented && rec.history.at(-1) === "redo", JSON.stringify(rec.history));
    historyHandled = false;

    /* --- 7. 搜索 --- */
    focusRoot();
    const rFind = press("f", { ctrlKey: true });
    const searchOn = root.querySelector(".mm-search")?.classList.contains("mm-search--on") ?? false;
    check("Ctrl+F 打开搜索且拦下按键", rFind.prevented && searchOn, `prevented=${rFind.prevented} open=${searchOn}`);
    press("Escape");
    check(
        "Esc 关闭搜索",
        !(root.querySelector(".mm-search")?.classList.contains("mm-search--on") ?? true),
        "搜索框已收起",
    );

    /* --- 8. 缩放 --- */
    press("1", { ctrlKey: true });
    const zoomTxt = root.querySelector(".mm-zoombar")?.textContent ?? "";
    check("Ctrl+1 回到 100%", zoomTxt.includes("100%"), `缩放标签=${zoomTxt}`);

    /* --- 9. 编辑态抢键盘 --- */
    focusRoot();
    press("F2");
    const editTxt = root.querySelector<HTMLElement>('.mm-txt[contenteditable="true"]');
    check("F2 进入改名编辑态", !!editTxt, `contenteditable 数=${root.querySelectorAll('[contenteditable="true"]').length}`);

    if (editTxt) {
        // 编辑态下方向键必须留给光标，不能被导图当成节点导航
        const selBefore = selTexts().join();
        const rArrow = pressOn(editTxt, "ArrowLeft");
        check(
            "编辑态下方向键不抢",
            !rArrow.prevented && selTexts().join() === selBefore,
            `prevented=${rArrow.prevented} 选中未变=${selTexts().join() === selBefore}`,
        );

        const rEsc = pressOn(editTxt, "Escape");
        check(
            "Esc 退出编辑态且不外泄",
            rEsc.prevented && !rEsc.leaked && !root.querySelector('[contenteditable="true"]'),
            `prevented=${rEsc.prevented} leaked=${rEsc.leaked}`,
        );
    } else {
        check("编辑态下方向键不抢", false, "未进入编辑态，跳过");
        check("Esc 退出编辑态且不外泄", false, "未进入编辑态，跳过");
    }

    /* --- 10. 无选中时方向键找回焦点 --- */
    clearSel();
    press("ArrowRight");
    check("无选中时 → 把焦点送到根节点", selTexts().join() === "大纲导图插件", `选中=${JSON.stringify(selTexts())}`);

    /* --- 11. 工具栏与悬停按钮的键盘可达性 --- */
    const btns = Array.from(root.querySelectorAll<HTMLElement>(".mm-toolbar button"));
    check(
        "工具栏按钮全部可 Tab 到达",
        btns.length > 0 && btns.every((b) => b.tabIndex >= 0 || b.tagName === "BUTTON"),
        `按钮数=${btns.length}`,
    );
    check(
        "工具栏按钮都有 tooltip 与快捷键标注",
        btns.every((b) => !!b.dataset.mmTip),
        `缺 tooltip 的按钮数=${btns.filter((b) => !b.dataset.mmTip).length}`,
    );

    /* 收尾留一个三级深的节点处于选中态：截图时能同时看到
       「祖先路径高亮」与「无关节点淡出」两种视觉状态。 */
    focusRoot();
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowRight");
    check("收尾保留选中态供截图", selTexts().length === 1, `选中=${JSON.stringify(selTexts())}`);

    return out;
}

/* ------------------------------------------------------------------ 自检报告 */

/**
 * 把渲染结果量化后写进 DOM，配合 chrome --dump-dom 就能在无头环境里
 * 断言「节点没有坍缩成一个字宽」「连线确实形成了主干汇聚」这类视觉约束。
 */
function report(): Record<string, unknown> {
    const out: Array<Record<string, unknown>> = [];
    views.forEach((view, i) => {
        const root = view.element;
        const nodes = Array.from(root.querySelectorAll<HTMLElement>(".mm-node"));
        const widths = nodes.map((n) => Math.round(n.getBoundingClientRect().width));
        const heights = nodes.map((n) => Math.round(n.getBoundingClientRect().height));

        const edges = Array.from(root.querySelectorAll<SVGPathElement>(".mm-edges path"));
        const dAttrs = edges.map((p) => p.getAttribute("d") ?? "");
        const widths2 = edges.map((p) => Number(p.getAttribute("stroke-width")));
        const strokes = edges.map((p) => p.getAttribute("stroke") ?? "");

        const scroll = root.querySelector<HTMLElement>(".mm-viewport");
        const world = root.querySelector<HTMLElement>(".mm-world");

        // 思维导图模式下左侧分支的连线应当朝左（x2 < x1）
        const leftward = dAttrs.filter((d) => {
            const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
            return n.length >= 3 && n[2] < n[0];
        }).length;

        out.push({
            view: i,
            nodes: nodes.length,
            minNodeWidth: Math.min(...widths),
            maxNodeWidth: Math.max(...widths),
            minNodeHeight: Math.min(...heights),
            tallestNode: Math.max(...heights),
            // 逐字竖排的典型特征：宽度很小但高度很高
            collapsed: nodes.filter((n) => n.getBoundingClientRect().width < 30).length,
            edges: edges.length,
            leftward,
            maxStroke: Math.max(...widths2),
            minStroke: Math.min(...widths2),
            opaque: strokes.every((s) => s.startsWith("rgb(")),
            world: world ? `${world.style.width} x ${world.style.height}` : "",
            viewportH: scroll?.clientHeight ?? 0,
            toolbarBtns: root.querySelectorAll(".mm-toolbar button").length,
            zoomBtns: root.querySelectorAll(".mm-zoombar button").length,
            hoverActions: root.querySelectorAll(".mm-acts").length,
            toggles: root.querySelectorAll(".mm-toggle").length,
            tabIndex: root.tabIndex,
            // 折叠按钮：文字、尺寸、算出来的颜色都得对，否则会退化成一个空圈
            toggleInfo: Array.from(root.querySelectorAll<HTMLElement>(".mm-toggle")).map((t) => {
                const cs = getComputedStyle(t);
                const r = t.getBoundingClientRect();
                const host = t.parentElement as HTMLElement | null;
                const hr = host?.getBoundingClientRect();
                return {
                    text: t.textContent ?? "",
                    size: `${Math.round(r.width)}x${Math.round(r.height)}`,
                    color: cs.color,
                    bg: cs.backgroundColor,
                    border: cs.borderTopColor,
                    fs: cs.fontSize,
                    nodeCls: (host?.className ?? "").replace(/mm-node\s*/, ""),
                    solid: host ? getComputedStyle(host).getPropertyValue("--c-solid").trim() : "",
                    // 用来验证「贴在主干上、不压节点边」
                    rect: [r.left, r.top, r.right, r.bottom].map(Math.round),
                    hostRect: hr ? [hr.left, hr.top, hr.right, hr.bottom].map(Math.round) : null,
                };
            }),
            canvasSolid: getComputedStyle(root).getPropertyValue("--mm-canvas-solid").trim(),
            // 排查折叠按钮配色被谁覆盖
            toggleColorRules: colorRules(
                Array.from(root.querySelectorAll<HTMLElement>(".mm-toggle")).find(
                    (t) => !t.parentElement?.classList.contains("mm-d0"),
                ) ?? null,
            ),
            // 节点内允许出现的子元素：.mm-inner / .mm-toggle / .mm-acts。
            // 出现别的东西就说明有元素画错地方了。
            strayInNodes: (() => {
                const allowed = new Set(["mm-inner", "mm-toggle", "mm-acts"]);
                const stray: string[] = [];
                for (const n of nodes) {
                    for (const c of Array.from(n.children)) {
                        const cls = (c as HTMLElement).className || "";
                        if (!String(cls).split(/\s+/).some((x) => allowed.has(x))) stray.push(cls);
                    }
                }
                return stray;
            })(),
            // 悬停按钮默认必须完全不可见，否则会在每个节点边上留一堆小图标
            actsHidden: Array.from(root.querySelectorAll<HTMLElement>(".mm-acts")).every((a) => {
                const cs = getComputedStyle(a);
                return cs.visibility === "hidden" || Number(cs.opacity) === 0;
            }),
        });
    });
    return { views: out, keyboard: keyboardProbe() };
}

/**
 * 列出所有命中该元素、且声明了 color 的 CSS 规则。
 * 排查「同一个规则里的 border 生效了、color 没生效」这类诡异问题时，
 * 靠肉眼读 CSS 会漏掉优先级更高的规则，直接问浏览器最快。
 */
function colorRules(el: HTMLElement | null): string[] {
    if (!el) return [];
    const out: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        for (const rule of Array.from(rules)) {
            const r = rule as CSSStyleRule;
            if (!r.selectorText || !r.style) continue;
            if (!r.style.getPropertyValue("color")) continue;
            try {
                if (el.matches(r.selectorText)) out.push(`${r.selectorText} → ${r.style.getPropertyValue("color")}`);
            } catch {
                /* 选择器语法不支持就跳过 */
            }
        }
    }
    return out;
}

const pre = document.createElement("pre");
pre.id = "report";
pre.style.cssText = "display:none";
pre.textContent = JSON.stringify(report());
document.body.appendChild(pre);

// 给页面上的按钮用
(window as unknown as Record<string, unknown>).__mm = {
    views,
    set(i: number, patch: Partial<MMConfig>) {
        views[i].setOptions(patch);
    },
    /** 直接设缩放，用来验证高倍放大时文字是否还清晰 */
    zoom(i: number, s: number) {
        (views[i] as unknown as { setScale(v: number): void }).setScale(s);
    },
};

/* 地址栏 hash：`#zoomto=3.75&view=0` 直接把某个视图缩放到指定倍数 */
{
    const p = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (p.has("zoomto")) {
        const s = Number(p.get("zoomto"));
        const i = Number(p.get("view") ?? 0);
        const apply = () => {
            if (!views[i]) return;
            (views[i] as unknown as { setScale(v: number): void }).setScale(s);
        };
        apply();
        window.addEventListener("load", () => window.setTimeout(apply, 60));
    }
}
