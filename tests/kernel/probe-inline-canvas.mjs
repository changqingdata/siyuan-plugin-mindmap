/**
 * 画布行内能力 · 真机验收。
 *
 * ## 这份探针在守什么
 *
 * 用户报的原始问题：「导图模式下不能插图片 / 超链接 / `[[` 双链，只能编辑纯文本」。
 * 本探针逐条走真机，而且**每条都量到内核**（kramdown）或**磁盘**（`.sy`），
 * 不看界面上的 DOM 就算过 —— 这个项目吃过「界面绿、数据坏」的亏。
 *
 * ## 八条判据
 *
 *   A 双击**含格式**的节点不再退出导图，且编辑框里带着双链 / 加粗
 *     （旧行为是「含格式 → 弹回源列表改」，代价是整个导图退出）
 *   B 进编辑态什么都不改、点外面提交 → **内核一字不变**（不能有假提交）
 *   C 只改文字 → 内核里 `**` 与 `((` 都还在（格式不被静默抹掉，这是最重要的一条）
 *   D 选中文字 → 浮动工具条出现 → 点「B」→ 内核里出现 `**`
 *   E 打 `/` → 斜杠菜单出现 → 选「超链接」→ 填地址 → 内核里出现 `](http`
 *   F 打 `[[` → 块引用搜索出现 → 搜到候选 → 挑一条 → 内核里出现 `((`；
 *     插入后接着敲字，字要落在双链**外面**（`caretAfterNode` 的回归）
 *   I 编辑着 A 时点 A 的悬停 `+` 加子节点 → 焦点要跟到新节点（`revealAndEdit` 的回归）
 *   H 每个场景结束后浮层都要收干净（不能留下没人管的浮层）
 *   G 红线：跑完全程，磁盘 `.sy` 里 `contenteditable=` 计数必须是 **0**
 *     （自绘 UI 的事件冒泡到 Protyle 会让宿主从 DOM 重序列化该块，
 *      把正文换成插件渲染结果 —— 而界面上一切正常、测试全绿）
 *
 * ## 三个「探针自己踩过的坑」（别改回去）
 *
 *  1. **`/` 只在词首触发**，这是照着思源的行为做的：`前缀/` 不会弹菜单，
 *     `前缀 /` 才会。所以场景 E 打的是 `" /"`，不是 `"/"`。
 *     第一版直接打 `"/"`，得到「菜单不出现」的假红。
 *  2. **`Ctrl+A` 不能靠 CDP 派发**：`page.press("a", {ctrl:true})` 送出去的
 *     `windowsVirtualKeyCode` 是 97（`"a".charCodeAt(0)`），Chrome 不认它是全选。
 *     改用**真拖拽**选字 —— 顺带把「拖选之后工具条出不出来」这条真实路径也覆盖了。
 *  3. **判据要绑到具体节点**：早先版本用「整份 kramdown 里有没有 `((`」当断言，
 *     结果场景 F 什么都没插进去、却被注入在别处的双链蒙成绿的。
 *     现在一律读**那个节点自己**的 kramdown。
 *  4. **`enterEdit` 里不能无脑补一次 `→`**：纯文本节点进编辑态是全选，需要 `→` 收成一点；
 *     但含格式的节点插件已经把光标落在所有子节点之后了，再按 `→` 会被 Chrome
 *     **归一化到最后一个行内元素的文本节点内部** —— 接着敲的字变成那个双链的锚文本。
 *     所以 `→` 只在「选区非 collapsed」时才补。同一条也解释了场景 C 曾经的假红。
 *  5. **只断言「浮层出现了」是不够的，还要断言「它摆在哪儿」**：场景 E / F 一开始只查
 *     `pops > 0` 和「焦点在不在浮层输入框」，于是「块引用搜索框跑到画布左上角」
 *     一路绿着发到了用户手里。现在用 `anchorCheck` 把「浮层必须被显式定位过 +
 *     横向贴着正在编辑的节点 + **四边都在画布内**」钉住。
 *     ⚠️ 这条断言补了两轮才齐：第二轮只查了**上**边界，于是「浮层长高之后被
 *     `.mm-root` 的 `overflow: hidden` 裁掉底部」又漏了（`anchorCheck` 的注释里
 *     有完整记录）。教训：「在画布内」必须查**四条边**；而且**合法的钳制不能算红** ——
 *     浮层贴着画布右边缘是正确的，用「左边缘落在某个窗口里」当判据会误伤。
 *
 * 用法：node tests/kernel/probe-inline-canvas.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";

async function api(p, payload) {
    const res = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    return res.json();
}
const children = async (id) => {
    const j = await api("/api/block/getChildBlocks", { id });
    return j.code === 0 ? j.data : [];
};

const OUT = "tests/.build";
fs.mkdirSync(OUT, { recursive: true });

/* ---------------------------------------------------------------- 造数据 */
const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-画布行内-${Date.now()}`,
    markdown: [
        "- 画布行内能力 · 大纲导图",
        "  - 场景甲 · 编辑面保格式",
        "    - 甲一 · 粗体与双链并存",
        "  - 场景乙 · 选中工具条",
        "    - 乙一 · 这是一段普通文字",
        "  - 场景丙 · 斜杠菜单",
        "    - 丙一 · 前缀",
        "  - 场景丁 · 块引用搜索",
        "    - 丁一 · 前缀",
        "  - 场景戊 · 编辑态里新建子节点",
        "    - 戊一 · 先被编辑的节点",
        "",
    ].join("\n"),
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
await sleep(800);
const listId = (await children(docId)).find((k) => k.type === "l").id;

const allItems = async (id, out = []) => {
    for (const k of await children(id)) {
        if (k.type === "i") out.push(k);
        await allItems(k.id, out);
    }
    return out;
};
const pOf = async (itemId) => (await children(itemId)).find((c) => c.type === "p");
/** 按段落文字找列表项 —— 别用下标，下标会随文档结构变化而错位 */
const findItem = async (needle) => {
    for (const it of await allItems(listId)) {
        const p = await pOf(it.id);
        if ((p?.content ?? "").includes(needle)) return { item: it, para: p };
    }
    return null;
};

/**
 * 往「甲一」里塞一个**真双链** —— 用 DOM 通道写，绕开 markdown 导入器对 `((id "x"))` 的处理差异。
 * 外壳**故意**按源块开标签拼（就是插件里 `shellOf` 的那套），顺便验证这套拼法在真机上保得住块类型。
 */
const jiaYi = await findItem("甲一");
if (!jiaYi) throw new Error("没造出「甲一」节点");
{
    const dom = (await api("/api/block/getBlockDOM", { id: jiaYi.para.id })).data?.dom ?? "";
    const head = dom.slice(0, dom.indexOf(">"));
    const tag = head.match(/^<([a-zA-Z0-9-]+)/)?.[1] ?? "div";
    const attrs = [...head.matchAll(/\s([a-zA-Z0-9_:.-]+)="([^"]*)"/g)]
        .filter((m) => m[1] !== "updated" && m[1] !== "data-node-index")
        .map((m) => `${m[1]}="${m[2]}"`)
        .join(" ");
    // ⚠️ 开头那截原文（「甲一 · 」）必须自己带上 —— DOM 通道是**整块替换**，
    //    漏掉它就等于把段落文字删了，后面按文字找节点会找不到（踩过一次）
    const inner =
        `甲一 · <span data-type="strong">粗体</span>与双链并存` +
        `<span data-type="block-ref" data-id="${docId}" data-subtype="s">锚文本</span>`;
    const r = await api("/api/block/updateBlock", {
        id: jiaYi.para.id,
        dataType: "dom",
        data: `<${tag} ${attrs}><div contenteditable="true" spellcheck="false">${inner}</div><div class="protyle-attr" contenteditable="false">\u200b</div></${tag}>`,
    });
    if (r.code !== 0) throw new Error("注入双链失败: " + JSON.stringify(r));
}
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });
await sleep(500);

/** 某个列表项自己的 kramdown —— 本探针唯一的「真值」来源 */
const kdOf = async (itemId) => (await api("/api/block/getBlockKramdown", { id: itemId })).data?.kramdown ?? "";
const kdJiaYiBefore = await kdOf(jiaYi.item.id);
console.log(`文档 ${docId} · 列表 ${listId}`);
console.log(`甲一 初始 kramdown: ${JSON.stringify(kdJiaYiBefore)}\n`);

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
};

/* ---------------------------------------------------------------- 页面探针 */
const ROOT = "document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)')";

const NODE_POS = (needle) => `(() => {
    const root = ${ROOT};
    if (!root) return null;
    root.scrollIntoView({ block: 'center' });
    const el = [...root.querySelectorAll('.mm-node')].find((e) =>
        e.style.visibility !== 'hidden' && ((e.querySelector('.mm-txt') || {}).textContent || '').includes(${JSON.stringify(needle)}));
    if (!el) return null;
    const t = el.querySelector('.mm-txt');
    const r = t.getBoundingClientRect();
    return {
        tx: Math.round(r.left + r.width / 2), ty: Math.round(r.top + r.height / 2),
        // 拖选要用的两个端点：文字框左右各收 3px，纵向取中线
        x1: Math.round(r.left + 3), x2: Math.round(Math.max(r.left + 6, r.right - 3)), my: Math.round(r.top + r.height / 2),
        text: t.textContent.trim().slice(0, 24),
    };
})()`;

/** 编辑态快照 —— 一次回一个 JSON 串（`page.eval` 回对象时属性会莫名少一个） */
const SNAP = `JSON.stringify((() => {
    const root = ${ROOT};
    const ed = root && root.querySelector('.mm-node[data-mm-editing]');
    const txt = ed && ed.querySelector('.mm-txt');
    const pop = root && root.querySelector('.mm-inline-pop');
    const R = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
        root: !!root,
        editing: !!ed,
        // 同时有**几个**节点挂着编辑态标记 —— 「插入即编辑」必须保证只剩一个
        editingCount: root ? root.querySelectorAll('.mm-node[data-mm-editing]').length : -1,
        html: txt ? txt.innerHTML : null,
        text: txt ? (txt.textContent || '').trim().slice(0, 48) : null,
        refs: txt ? txt.querySelectorAll('[data-type="block-ref"]').length : -1,
        strong: txt ? txt.querySelectorAll('[data-type="strong"]').length : -1,
        links: txt ? txt.querySelectorAll('[data-type="a"]').length : -1,
        pops: root ? root.querySelectorAll('.mm-inline-pop').length : -1,
        slash: root ? root.querySelectorAll('.mm-inline-pop.mm-slash .mm-slash-item:not([style*="display: none"])').length : -1,
        refItems: root ? root.querySelectorAll('.mm-inline-pop.mm-ref .mm-ref-item').length : -1,
        refEmpty: root ? (root.querySelector('.mm-inline-pop.mm-ref .mm-ref-empty') || {}).textContent : null,
        barBtns: root ? root.querySelectorAll('.mm-inline-pop.mm-inline-bar .mm-bar-btn').length : -1,
        formInputs: root ? root.querySelectorAll('.mm-inline-pop.mm-form .mm-form-input').length : -1,
        active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName).toString().slice(0, 40) : null,
        sel: (window.getSelection && window.getSelection().toString() || '').slice(0, 30),
        // ---- 几何：浮层定位的回归判据（第一版整支探针只看「有没有浮层」，漏掉了「摆在哪」）----
        rootRect: R(root),
        txtRect: R(txt),
        popRect: R(pop),
        popStyle: pop ? (pop.style.left || "(空)") + " / " + (pop.style.top || "(空)") : null,
        // 编辑态下的光标是否已收成一点（「全选」= false）。非编辑态给 null，免得蒙成绿的
        caretCollapsed: ed ? (() => {
            const s = window.getSelection();
            return !!(s && s.rangeCount && s.getRangeAt(0).collapsed);
        })() : null,
        // 诊断用：光标到底落在哪（元素名 + 偏移），失败时一眼看出是「落开头」还是「钻进最后一个元素」
        caret: ed ? (() => {
            const s = window.getSelection();
            if (!s || !s.rangeCount) return "none";
            const n = s.anchorNode;
            if (!n) return "none";
            const name = n.nodeType === 3 ? "text" : (n.className || n.tagName || "?").toString().slice(0, 24);
            return name + "@" + s.anchorOffset;
        })() : null,
    };
})())`;
const snap = async (page) => JSON.parse(await page.eval(SNAP));

const chrome = await launch({ headless: true, port: 9361, width: 1680, height: 1050, dpr: 1 });

const tap = async (page, x, y, clickCount = 1) => {
    await page.mouse("mouseMoved", x, y, { buttons: 0 });
    await page.mouse("mousePressed", x, y, { button: "left", clickCount });
    await page.mouse("mouseReleased", x, y, { button: "left", clickCount });
};
const dbl = async (page, x, y) => {
    await page.mouse("mouseMoved", x, y, { buttons: 0 });
    for (const cc of [1, 2]) await tap(page, x, y, cc);
};
/** 真拖拽选字（CDP 派发的 Ctrl+A 不被 Chrome 认作全选，见文件头第 2 条） */
const dragSelect = async (page, pos) => {
    await page.mouse("mouseMoved", pos.x1, pos.my, { buttons: 0 });
    await page.mouse("mousePressed", pos.x1, pos.my, { button: "left", clickCount: 1 });
    await page.mouse("mouseMoved", Math.round((pos.x1 + pos.x2) / 2), pos.my, { buttons: 1 });
    await page.mouse("mouseMoved", pos.x2, pos.my, { buttons: 1 });
    await page.mouse("mouseReleased", pos.x2, pos.my, { button: "left", clickCount: 1 });
};
/** 点节点外的空白处（视口右下角）→ 触发「失焦提交」 */
const outsidePoint = (page) =>
    page.eval(`(() => {
        const root = ${ROOT};
        const vp = root.querySelector('.mm-viewport');
        const r = vp.getBoundingClientRect();
        return { x: Math.round(r.right - 14), y: Math.round(r.bottom - 14) };
    })()`);

/**
 * 浮层是不是「贴着光标」。
 *
 * ⚠️ **这条断言是补出来的，而且补了两次。**
 *
 * 第一版只断言了「浮层有没有出现」（`pops > 0`）和「焦点在不在浮层输入框里」，
 * **完全没看它摆在哪儿** —— 于是「块引用搜索框跑到画布左上角」这个 bug
 * 一路绿着发到了用户手里。
 *
 * 第二版加了「横向位置要落在节点的跨度里」，又把「浮层长高之后越出 `.mm-root`
 * 被 `overflow: hidden` 裁掉一块」放了过去 —— 因为那条只查了**上边界**，
 * 而裁掉的是**下边界**。修完之后探针自己反而红了：浮层被右边界钳到 1166px，
 * 而「左边缘必须落在 1168px 之后」这个窗口太紧 —— 钳制是**正确行为**，不是 bug。
 *
 * 所以现在四条一起查（缺哪条都漏过过真 bug）：
 *   ① 必须被**显式定位**过（`style.left` / `style.top` 不能空）——
 *      绝对定位元素不设偏移时会停在「静态位置」，也就是包含块内容盒的左上角；
 *   ② **四边**都要在画布内 —— 只查上边界会漏掉「底部被裁」；
 *   ③ 横向要和正在编辑的节点**有交集**（被左右边界钳制也算锚定）；
 *   ④ 双保险：不能整块缩在画布左上角（那正是「静态位置」的样子）。
 *
 * ③ 用「有交集」而不是「左边缘落在窗口里」，就是为了让合法的钳制不算红。
 */
const anchorCheck = (s) => {
    const p = s.popRect;
    const t = s.txtRect;
    const r = s.rootRect;
    if (!p || !t || !r) return { ok: false, why: `缺几何 pop=${!!p} txt=${!!t} root=${!!r}` };
    const positioned = !!s.popStyle && !s.popStyle.includes("(空)");
    // 浮层比画布还高时，底部越界是**物理上不可避免**的（钳制只能保上边界），
    // 这时不查下边界 —— 免得以后把画布改矮了、探针反而给出假红
    const tooTall = p.h > r.h - 16;
    const inside =
        p.l >= r.l - 1 &&
        p.t >= r.t - 1 &&
        p.l + p.w <= r.l + r.w + 1 &&
        (tooTall || p.t + p.h <= r.t + r.h + 1);
    const overlapX = p.l < t.l + t.w + 40 && p.l + p.w > t.l - 24;
    const notCorner = !(p.l <= r.l + 12 && p.t <= r.t + 12);
    return {
        ok: positioned && inside && overlapX && notCorner,
        why:
            `定位=${s.popStyle} 在画布内=${inside} 横向有交集=${overlapX} 不在左上角=${notCorner}` +
            ` 锚点=${JSON.stringify(t)} 浮层=${JSON.stringify(p)} 根=${JSON.stringify(r)}`,
    };
};

/**
 * 双击进入编辑态，并把光标落到文字末尾。
 *
 * ⚠️ **只在「全选」时才补一次 `→`。** 纯文本节点进编辑态是全选，不collapse 的话
 * 后面打 `/` 或 `[[` 会把原文整个替换掉；而含行内格式的节点，插件**已经**把光标
 * 落在所有子节点之后（collapsed）了 —— 这时再按一次 `→`，Chrome 会把那个位置
 * **归一化到最后一个行内元素的文本节点内部**，接着敲的字就成了那个双链的锚文本。
 * （2026-10-02 实测：按了 `→` 之后「锚文本」变成「锚文本补充」。）
 */
const enterEdit = async (page, needle) => {
    const pos = await page.eval(NODE_POS(needle));
    if (!pos) throw new Error(`找不到节点「${needle}」`);
    await dbl(page, pos.tx, pos.ty);
    await sleep(520);
    const collapsed = await page.eval(
        `(() => { const s = window.getSelection(); return !!(s && s.rangeCount && s.getRangeAt(0).collapsed); })()`,
    );
    if (!collapsed) {
        await page.press("ArrowRight");
        await sleep(160);
    }
    return pos;
};

try {
    const page = await chrome.newPage(`${KERNEL}/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图" });
    await sleep(1800);

    /* ============================================================ A */
    await enterEdit(page, "甲一");
    let s = await snap(page);
    check("A 双击含格式节点：留在导图里且进入编辑态", s.root && s.editing, `root=${s.root} editing=${s.editing} active=${s.active}`);
    check(
        "A 编辑框里带着原格式（双链 + 加粗各 1）",
        s.refs === 1 && s.strong === 1,
        `refs=${s.refs} strong=${s.strong} html=${(s.html || "").slice(0, 100)}`,
    );
    check(
        "A 含格式节点进编辑态是「光标落末尾」而不是全选",
        s.caretCollapsed === true,
        `collapsed=${s.caretCollapsed} caret=${s.caret}（全选的话随手一个字就把双链和图片替换掉了）`,
    );

    /* ============================================================ B 不改动 → 不能有假提交 */
    const kdBeforeB = await kdOf(jiaYi.item.id);
    const away = await outsidePoint(page);
    await tap(page, away.x, away.y);
    await sleep(1300);
    s = await snap(page);
    const kdAfterB = await kdOf(jiaYi.item.id);
    check("B 点外面退出编辑态", !s.editing && s.root, `editing=${s.editing} root=${s.root}`);
    check("B 没改动就不写内核（无假提交）", kdAfterB === kdBeforeB, kdAfterB === kdBeforeB ? "" : `\n  前: ${JSON.stringify(kdBeforeB)}\n  后: ${JSON.stringify(kdAfterB)}`);
    check("B 浮层收干净", s.pops === 0, `pops=${s.pops}`);

    /* ============================================================ C 只改文字 → 格式保住 */
    await enterEdit(page, "甲一");
    await page.type("补充");
    await sleep(200);
    await page.press("Enter");
    await sleep(1600);
    let kd = await kdOf(jiaYi.item.id);
    const hasBold = kd.includes("**");
    const hasRef = kd.includes("((");
    check(
        "C 只改文字后，加粗与双链都还在",
        hasBold && hasRef && kd.includes("补充"),
        `加粗=${hasBold} 双链=${hasRef} 含新文字=${kd.includes("补充")} kramdown=${JSON.stringify(kd.split("\n")[0])}`,
    );
    check(
        "C 追加的字落在节点末尾，没有跑进双链的锚文本里",
        kd.includes('"锚文本"'),
        `锚文本应仍是「锚文本」→ ${JSON.stringify(kd.split("\n")[0])}`,
    );

    /* ============================================================ D 选中 → 工具条 → 加粗 */
    const posB = await enterEdit(page, "乙一");
    await dragSelect(page, posB);
    await sleep(600);
    s = await snap(page);
    check("D 拖选文字后浮动工具条出现", s.barBtns > 0, `按钮数=${s.barBtns} pops=${s.pops} sel=「${s.sel}」`);
    if (s.barBtns > 0) {
        const pt = await page.eval(`(() => {
            const b = ${ROOT}.querySelector('.mm-inline-pop.mm-inline-bar .mm-bar-btn');
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), glyph: b.textContent };
        })()`);
        await tap(page, pt.x, pt.y);
        await sleep(450);
        s = await snap(page);
        check("D 点「加粗」后编辑框里出现 strong", s.strong > 0, `glyph=${pt.glyph} strong=${s.strong}`);
    }
    await page.press("Enter");
    await sleep(1600);
    const yiYi = await findItem("乙一");
    kd = await kdOf(yiYi.item.id);
    check("D 提交后内核里出现 **", kd.includes("**"), `kramdown=${JSON.stringify(kd.split("\n")[0])}`);

    /* ============================================================ E `/` → 斜杠菜单 → 超链接 */
    await enterEdit(page, "丙一");
    // ⚠️ 前面那个空格不能省：`/` 只在词首触发（照思源的行为），`前缀/` 不弹菜单
    await page.type(" /");
    await sleep(700);
    s = await snap(page);
    check("E 打「空格 + /」后斜杠菜单出现", s.slash > 0, `可见候选数=${s.slash} pops=${s.pops}`);
    {
        const g = anchorCheck(s);
        check("E 斜杠菜单贴在光标处（没有被丢到画布左上角）", g.ok, g.why);
    }
    await page.type("链接");
    await sleep(600);
    s = await snap(page);
    check("E 关键词过滤到「超链接」一条", s.slash === 1, `可见候选数=${s.slash}`);
    await page.press("Enter");
    await sleep(700);
    s = await snap(page);
    check("E 选中后弹出参数表单（2 个输入框）", s.formInputs >= 2, `输入框数=${s.formInputs} active=${s.active}`);
    if (s.formInputs >= 2) {
        // 第一个输入框（地址）已自动聚焦并全选，直接打字覆盖
        await page.type("https://b3log.org/");
        await sleep(300);
        await page.press("Enter");
        await sleep(700);
        s = await snap(page);
        check("E 插入后编辑框里出现链接", s.links === 1, `links=${s.links} html=${(s.html || "").slice(0, 130)}`);
        check("E 触发串「/链接」已被替换掉（没有残留）", !(s.text || "").includes("/链接"), `text=「${s.text}」`);
        check("E 焦点已回到编辑框（能接着敲字）", /mm-txt/.test(s.active || ""), `active=${s.active}`);
    }
    await page.press("Enter");
    await sleep(1600);
    const bingYi = await findItem("丙一");
    kd = await kdOf(bingYi.item.id);
    check("E 提交后内核里出现 markdown 链接", kd.includes("](http"), `kramdown=${JSON.stringify(kd.split("\n")[0])}`);

    /* ============================================================ F `[[` → 块引用搜索 */
    await enterEdit(page, "丁一");
    await page.type("[[");
    await sleep(900);
    s = await snap(page);
    check("F 打 [[ 后块引用搜索浮层出现", s.pops > 0 && /mm-ref-input/.test(s.active || ""), `pops=${s.pops} active=${s.active}`);
    {
        const g = anchorCheck(s);
        check("F 块引用搜索浮层贴在光标处（这是「跑到画布左上角」的回归）", g.ok, g.why);
    }
    await page.type("画布");
    await sleep(1600);
    s = await snap(page);
    check("F 搜到候选", s.refItems > 0, `候选数=${s.refItems} 空提示=${JSON.stringify(s.refEmpty)}`);
    if (s.refItems > 0) {
        await page.press("ArrowDown");
        await sleep(220);
        await page.press("Enter");
        await sleep(800);
        s = await snap(page);
        check("F 插入后编辑框里出现双链", s.refs === 1, `refs=${s.refs} html=${(s.html || "").slice(0, 150)}`);
        check("F 触发串 [[ 已被替换掉（没有残留）", !(s.text || "").includes("[["), `text=「${s.text}」`);
        check("F 焦点已回到编辑框（能接着敲字）", /mm-txt/.test(s.active || ""), `active=${s.active}`);
        // 双链插在节点**末尾**，接着敲的字必须落在它**外面**。
        // 这是 `caretAfterNode` 的回归：只 `setStartAfter` 的话，Blink 会把边界
        // 归一化进 block-ref 内部，字就变成那个双链的锚文本（见 utils/caret.ts）。
        await page.type("尾");
        await sleep(300);
        s = await snap(page);
        check(
            "F 双链之后接着敲的字落在双链外面（没有变成它的锚文本）",
            // DOM 里双链与「尾」之间还夹着那个零宽垫片（`\u200B`），它是光标落点用的，写回前会被剥掉
            /<\/span>\u200B?尾\s*$/.test(s.html || ""),
            `html=${(s.html || "").slice(-90)}`,
        );
    }
    await page.press("Enter");
    await sleep(1600);
    const dingYi = await findItem("丁一");
    kd = await kdOf(dingYi.item.id);
    check("F 提交后内核里出现 (( 引用", kd.includes("(("), `kramdown=${JSON.stringify(kd.split("\n")[0])}`);
    check(
        "F 追加的字留在引用外面",
        /\)\)\s*尾|\)\)尾/.test(kd.split("\n")[0]),
        `kramdown=${JSON.stringify(kd.split("\n")[0])}`,
    );

    /* ============================================================ I 编辑态里新建子节点 → 焦点要跟过去 */
    //
    // 用户的场景：正在编辑 A，点 A 的悬停 `+` 加子节点（那一下刻意不让 `.mm-txt` 失焦），
    // 新节点建出来了，**光标却还留在 A 里** —— 只有退出编辑才看得见新节点。
    //
    // 根因：`render()` 在编辑态下只记一笔 `pendingRender` 就返回，新节点进不了 `byId`，
    // 于是 `revealAndEdit` 直接返回 false。修法见 `revealAndEdit`（先收掉旧编辑 + 同步重建）。
    await enterEdit(page, "戊一");
    s = await snap(page);
    check("I 准备态：已进入「戊一」的编辑态", s.editing && (s.text || "").includes("戊一"), `text=「${s.text}」`);

    const plus = await page.eval(`(() => {
        const ed = document.querySelector('.mm-root .mm-node[data-mm-editing]');
        const b = ed && ed.querySelector('.mm-acts button');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    check("I 编辑态的节点上能拿到悬停「+」按钮", !!plus, `按钮位置=${JSON.stringify(plus)}`);
    if (plus) {
        await tap(page, plus.x, plus.y);
        // 内核写回 → Protyle 重建 DOM → 重挂视图 → 兑现 pendingEdit，整条链是异步的
        await sleep(3000);
        s = await snap(page);
        check(
            "I 新建子节点后焦点跟到新节点（不再留在被编辑的旧节点里）",
            s.editing && (s.text || "").includes("新节点"),
            `editing=${s.editing} text=「${s.text}」 active=${s.active}`,
        );
        check("I 同一时刻只有一个节点处于编辑态", s.editingCount === 1, `editingCount=${s.editingCount}`);
        check("I 焦点确实在编辑框里（能直接开始打字）", /mm-txt/.test(s.active || ""), `active=${s.active}`);

        // 直接打字就该是给新节点命名 —— 这是「插入即编辑」的全部意义
        await page.type("戊二");
        await sleep(300);
        await page.press("Enter");
        await sleep(1600);
        const wuEr = await findItem("戊二");
        check("I 直接打字就写进了新节点", !!wuEr, wuEr ? "" : "内核里找不到「戊二」");
    }

    /* ============================================================ H 浮层收干净 */
    s = await snap(page);
    check("H 全程结束后没有浮层残留", s.pops === 0, `pops=${s.pops}`);

    await page.screenshot(`${OUT}/probe-inline-canvas.png`);

    /* ============================================================ G 红线：磁盘 .sy */
    await sleep(2200); // 给内核落盘留时间
    const info = await api("/api/filetree/getPathByID", { id: docId });
    const nb = info?.data?.notebook;
    const rel = info?.data?.path; // ⚠️ 这个字段**已经带 `.sy` 后缀**，别再拼一次
    const sy = path.join(WORKSPACE, "data", String(nb), String(rel).replace(/^\/+/, ""));
    let syText = "";
    try {
        syText = fs.readFileSync(sy, "utf8");
    } catch (err) {
        console.log(`  ⚠️ 读不到 .sy（${sy}）：${err.message}`);
    }
    const ceCount = (syText.match(/contenteditable=/g) || []).length;
    check("G 红线：.sy 里 contenteditable= 计数为 0（正文没被插件渲染结果覆盖）", syText.length > 0 && ceCount === 0, `计数=${ceCount} 字节=${syText.length} 文件=${sy}`);
} catch (err) {
    console.log(`✘ 探针异常：${err?.stack ?? err}`);
    results.push({ name: "探针未跑完", ok: false });
} finally {
    const ok = await removeDoc(api, docId);
    console.log(`\n清理测试文档: ${ok ? "✓" : "✗ 请手动删 " + docId}`);
    const bad = results.filter((r) => !r.ok);
    console.log(`\n[probe-inline-canvas] ${results.length - bad.length}/${results.length} 项断言通过`);
    if (bad.length) {
        for (const b of bad) console.log(`   ✗ ${b.name}`);
        process.exitCode = 1;
    }
}
