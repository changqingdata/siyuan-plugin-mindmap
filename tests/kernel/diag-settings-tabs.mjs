/**
 * 设置面板「外壳」验收：**侧边选项卡** + **快捷键速查对话框**。
 *
 * ## 为什么单独一支，而不是并进 `diag-settings.mjs`
 *
 * `diag-settings.mjs` 测的是设置项的**效果**（改一个开关，画布上有没有变化），
 * 它靠「关 / 开 两次测量结果不同」自证。而这一支测的是**外壳**：
 * 分组怎么排、点选项卡切不切、快捷键怎么显示。两者的失败原因完全不同，
 * 混在一起会让「面板白屏」和「开关没接线」看起来是同一类问题。
 *
 * ## 为什么只能真机验
 *
 * 分组不是思源给的 —— 思源的 `Setting` 只渲染一个扁平列表，插件是在
 * `open()` 之后把 `.b3-dialog__content` 的子元素**搬**进各个 pane 的
 * （见 `core/settings-tabs.ts`）。`tests/run.mjs` 的极简 DOM 模拟没有
 * `querySelectorAll` / `closest` / `dataset`，跑出来是**假绿**。
 *
 * 更要紧的是：这次搬运**有可能丢项**。所以本支最重要的一条断言不是
 * 「有 5 个选项卡」，而是 `orphan === 0` + 「各 pane 条目数之和 == 总数」——
 * 它们合起来才能证明「没有设置项在搬运中掉在外面」。
 *
 * ## 快捷键那部分守两件事
 *
 * **① 全局键位要按平台换算。** 思源的键位表示法是 macOS 字形（`⇧⌘D`），
 * 而思源自己的菜单在 Windows 上显示成 `Ctrl+Shift+D`。说明文字写死字形，
 * Windows 用户看到的就是一套在自己「设置 → 快捷键」里找不到的符号。
 *
 * **② 空格仍然必须看得见。** 思源的键位表示法里**空格是一个字面空格字符**
 * （`KEYCODELIST[32] = " "`），所以不换算就渲染成看不见的 `Ctrl+ `，
 * 用户完全读不出该按什么。
 *
 * ⚠️ 默认键位换过三轮：`⌘空格` / `⌥空格`（死在 OS/IME 层）→ `⇧⌘D` / `⇧⌘S`
 * （`⇧⌘S` 死在 Protyle 的 `stopPropagation`）→ 现在是 `⇧⌘D` / `⇧⌘B`
 * （完整结论见 `probe-keymap-dump.mjs` 的文件头）。
 * **但空格那条断言不能跟着删** —— 速查里仍有走 `{space}` 占位符的行
 * （`sc.nav.fold` 折叠 / 展开、`sc.present.next` 演示推进）。
 * 第一版把它挂在「全局那两行」上，换键位后会变成**真空断言**；
 * 现在钉在**含「空格」二字的那些行**上，并加了一条全表兜底：
 * 任何一行都不许以空白收尾。
 *
 * 这两条都只有真机能验（要读 `isMac` 才能确定换算结果）。
 *
 * 用法：node tests/kernel/diag-settings-tabs.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";

const OUT = "tests/.build";

/**
 * 数据源里声明的分组数 / 行数。
 *
 * 用它而不是写死「40+」这类数字：写死的阈值会在加行时变成噪音（我第一版就是这么
 * 写的，把 37 行判成了失败），而这里真正要抓的是**「声明了却没渲染」**——
 * 那正是分组数据搬家时最容易出的事故（某一组的 `rows` 写错形状 → 整组静默消失）。
 */
const SC_SRC = fs.readFileSync(new URL("../../src/core/shortcuts.ts", import.meta.url), "utf8");
const DECLARED_ROWS = [...SC_SRC.matchAll(/\{\s*k:\s*"/g)].length;
const DECLARED_GROUPS = [...SC_SRC.matchAll(/t:\s*"sc\./g)].length;

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = "") => {
    if (cond) {
        pass++;
        console.log(`  ✓ ${label}${extra ? `　${extra}` : ""}`);
    } else {
        fail++;
        console.error(`  ✗ ${label}${extra ? `　${extra}` : ""}`);
    }
};

/* ⚠️ 端口原先写的是 9368 —— 和 `diag-diagnostics.mjs` **撞了**。
   串跑时两者是先后关系所以没炸，但这是颗哑弹（并行跑 / 换顺序就会踩）。
   换到 9369（本仓库未占用的号）。
   顺带说明：`launch()` 现在遇到 Windows 保留端口段会自己往后找端口，
   所以撞号不再致命 —— 但「一个号两处用」本身就是该修的。 */
const chrome = await launch({ headless: true, port: 9369, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage("http://127.0.0.1:6806/stage/build/desktop/");
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2500);

    /**
     * 控制台钩子。**必须在打开面板之前装** —— 改造失败时插件只留一句
     * `console.warn("[mindmap] 设置面板：…")`，不抓的话「退回了扁平列表」
     * 与「本来就没做分组」看起来一模一样。
     */
    await page.eval(`(() => {
        window.__mmWarns = [];
        const orig = console.warn;
        console.warn = (...a) => { window.__mmWarns.push(a.map(String).join(' ')); orig.apply(console, a); };
        window.__mmErrors = [];
        window.addEventListener('error', (e) => window.__mmErrors.push(String(e.message)));
        return true;
    })()`);

    /* ------------------------------------------------------------ 打开设置面板 */

    console.log("\n=== 1. 打开设置面板 ===");
    const opened = await page.eval(`(() => {
        const el = document.querySelector('.toolbar [id^="plugin_siyuan-plugin-mindmap"]')
            || [...document.querySelectorAll('.toolbar *')].find((e) => (e.getAttribute('title') || '') === '大纲导图');
        if (!el) return 'no-toolbar';
        el.click();
        return 'clicked';
    })()`);
    ok(opened === "clicked", "（前置）顶栏上有「大纲导图」图标", opened);
    await sleep(900);

    const setItem = await page.eval(`(() => {
        const it = [...document.querySelectorAll('.b3-menu .b3-menu__item')].find((x) => (x.textContent || '').trim() === '设置');
        if (!it) return 'no-item';
        it.click();
        return 'clicked';
    })()`);
    ok(setItem === "clicked", "（前置）顶栏菜单里有「设置」", setItem);
    await sleep(1800);

    /* ------------------------------------------------------------ 选项卡结构 */

    console.log("\n=== 2. 侧边选项卡 ===");
    const layout = await page.eval(`(() => {
        const dlg = document.querySelector('.b3-dialog--open');
        if (!dlg) return { err: 'no-dialog' };
        const tabs = [...dlg.querySelectorAll('.mm-set__tab')];
        const panes = [...dlg.querySelectorAll('.mm-set__pane')];
        const content = dlg.querySelector('.b3-dialog__content');
        const byTab = {};
        for (const p of panes) {
            const t = tabs.find((x) => x.dataset.group === p.dataset.group);
            const label = ((t && t.textContent) || p.dataset.group || '?').trim();
            byTab[label] = [...p.querySelectorAll(':scope > .config-item .config-name')].map((e) => (e.textContent || '').trim());
        }
        return {
            tabs: tabs.map((t) => (t.textContent || '').trim()),
            groups: tabs.map((t) => t.dataset.group),
            byTab,
            activePanes: dlg.querySelectorAll('.mm-set__pane--on').length,
            activeTabs: dlg.querySelectorAll('.mm-set__tab--on').length,
            // 没被搬走的设置项：改造失败（退回扁平列表）时这里会是全部
            orphan: content ? content.querySelectorAll(':scope > .config-item').length : -1,
            allNames: [...dlg.querySelectorAll('.config-name')].length,
            // 视觉：内容区必须真的能滚，否则长分组会被裁掉
            panesOverflow: (() => {
                const p = dlg.querySelector('.mm-set__panes');
                return p ? getComputedStyle(p).overflowY : '(无 .mm-set__panes)';
            })(),
            navWidth: (() => {
                const n = dlg.querySelector('.mm-set__nav');
                return n ? Math.round(n.getBoundingClientRect().width) : -1;
            })(),
        };
    })()`);
    console.log(JSON.stringify(layout, null, 1).slice(0, 1800));

    ok(!layout.err, "设置面板渲染出了侧边选项卡结构（.mm-set__tab / .mm-set__pane）", layout.err ?? "ok");
    ok(
        (layout.tabs ?? []).join(" / ") === "外观 / 画布 / 交互 / 性能 / 帮助",
        "左侧导航是 5 个分区，且顺序固定",
        (layout.tabs ?? []).join(" / "),
    );
    ok(layout.orphan === 0, "★ 没有设置项被留在内容区外面（搬运不会丢项）", `content 直接子项 ${layout.orphan} 个`);
    const paneTotal = Object.values(layout.byTab ?? {}).reduce((a, b) => a + b.length, 0);
    ok(
        paneTotal > 0 && paneTotal === layout.allNames,
        "★ 各 pane 的条目数之和 == 面板条目总数（没有重复、也没有遗漏）",
        `${Object.entries(layout.byTab ?? {}).map(([k, v]) => `${k} ${v.length}`).join(" · ")} ＝ ${paneTotal} / 共 ${layout.allNames}`,
    );
    ok(layout.activePanes === 1 && layout.activeTabs === 1, "默认只显示一个 pane、只高亮一个 tab", `pane ${layout.activePanes} / tab ${layout.activeTabs}`);
    ok(layout.panesOverflow === "auto", "内容区自己滚动（不是把整页撑长）", `overflow-y: ${layout.panesOverflow}`);
    ok(layout.navWidth > 80 && layout.navWidth < 260, "左侧导航有合理宽度", `${layout.navWidth}px`);

    // 抽查：几个有代表性的设置项必须落在对的分区里
    const inTab = (tab, name) => (layout.byTab?.[tab] ?? []).some((t) => t === name);
    const spots = [
        ["外观", "主题"],
        ["外观", "布局动效"],
        ["画布", "小地图"],
        ["画布", "画布高度（px）"],
        ["交互", "双击编辑节点"],
        ["交互", "折叠状态与大纲同步"],
        ["性能", "渲染上限"],
        ["帮助", "查看快捷键"],
    ];
    const wrong = spots.filter(([tab, name]) => !inTab(tab, name));
    ok(wrong.length === 0, "抽查 8 个设置项都落在对的分区里", wrong.length ? `错位：${wrong.map((x) => x.join("→")).join(" / ")}` : `${spots.length}/${spots.length}`);

    await page.screenshot(`${OUT}/diag-settings-tabs-1-appearance.png`);

    /* ------------------------------------------------------------ 切分区 */

    console.log("\n=== 3. 点选项卡切换 ===");
    const switchRes = await page.eval(`(() => {
        const dlg = document.querySelector('.b3-dialog--open');
        const tabs = [...dlg.querySelectorAll('.mm-set__tab')];
        const t = tabs.find((x) => (x.textContent || '').trim() === '画布');
        if (!t) return { err: 'no-tab' };
        t.click();
        const onTab = dlg.querySelector('.mm-set__tab--on');
        const onPane = dlg.querySelector('.mm-set__pane--on');
        return {
            group: t.dataset.group,
            onGroup: onTab && onTab.dataset.group,
            paneGroup: onPane && onPane.dataset.group,
            visible: onPane ? getComputedStyle(onPane).display !== 'none' : false,
            // 被切走的那个 pane 必须真的藏起来，否则会叠在一起
            hiddenOthers: [...dlg.querySelectorAll('.mm-set__pane')].filter((p) => p !== onPane && getComputedStyle(p).display !== 'none').length,
            firstRow: (onPane && (onPane.querySelector('.config-name') || {}).textContent || '').trim(),
        };
    })()`);
    ok(
        !switchRes.err && switchRes.onGroup === switchRes.group && switchRes.paneGroup === switchRes.group && switchRes.visible,
        "点「画布」：高亮与内容区同步切过去，且内容真的可见",
        JSON.stringify(switchRes),
    );
    ok(switchRes.hiddenOthers === 0, "切走的分区真的藏起来了（不会两个分区叠着显示）", `可见的其他 pane ${switchRes.hiddenOthers} 个`);
    ok(switchRes.firstRow === "画布高度", "切过去的确实是「画布」分区（首项是画布高度）", `首项「${switchRes.firstRow}」`);
    await page.screenshot(`${OUT}/diag-settings-tabs-2-canvas.png`);

    /* ------------------------------------------------------------ 快捷键对话框 */

    console.log("\n=== 4. 「查看快捷键」= 分组表格对话框 ===");
    await page.eval(`(() => {
        const t = [...document.querySelectorAll('.b3-dialog--open .mm-set__tab')].find((x) => (x.textContent || '').trim() === '帮助');
        if (t) t.click();
        return true;
    })()`);
    await sleep(300);

    const helpClicked = await page.eval(`(() => {
        const row = [...document.querySelectorAll('.b3-dialog--open .config-name')].find((e) => (e.textContent || '').includes('查看快捷键'));
        if (!row) return 'no-row';
        const item = row.closest('.config-item') || row.closest('.b3-label') || row.parentElement;
        const b = item && item.querySelector('button');
        if (!b) return 'no-button';
        b.click();
        return 'clicked';
    })()`);
    await sleep(1100);

    const sc = await page.eval(`(() => {
        const dlg = [...document.querySelectorAll('.b3-dialog--open')].find((d) => d.querySelector('.mm-sc'));
        if (!dlg) return { err: 'no-sc-dialog' };
        const rows = [...dlg.querySelectorAll('.mm-sc__row')].map((r) => ({
            k: ((r.querySelector('.mm-sc__key') || {}).textContent || '').trim(),
            d: ((r.querySelector('.mm-sc__what') || {}).textContent || '').trim(),
        }));
        return {
            title: (dlg.querySelector('.b3-dialog__header') || {}).textContent || '',
            groups: [...dlg.querySelectorAll('.mm-sc__head')].map((e) => (e.textContent || '').trim()),
            legend: [...dlg.querySelectorAll('.mm-sc__legend span')].map((e) => (e.textContent || '').trim()),
            hint: ((dlg.querySelector('.mm-sc__hint') || {}).textContent || '').trim(),
            rows,
            kbdCount: dlg.querySelectorAll('kbd.mm-sc__key').length,
            noneCount: dlg.querySelectorAll('.mm-sc__key--none').length,
            snackbar: document.querySelectorAll('.b3-snackbar').length,
        };
    })()`);

    ok(helpClicked === "clicked", "「查看快捷键」的按钮点得动", helpClicked);
    ok(!sc.err, "弹出的是**对话框**（.mm-sc），不再是一条会自己消失的通知", sc.err ?? "ok");
    ok(sc.snackbar === 0, "★ 不再走 snackbar 通知（老实现是 showMessage + 12 秒自动消失）", `页面上 snackbar ${sc.snackbar} 个`);
    ok(/快捷键速查/.test(sc.title), "对话框标题写明「快捷键速查」", JSON.stringify(sc.title));
    ok(
        sc.groups.length === DECLARED_GROUPS,
        "★ 数据源里声明的每一组都渲染出来了（没有整组静默消失）",
        `渲染 ${sc.groups.length} / 声明 ${DECLARED_GROUPS}`,
    );
    ok(
        sc.rows.length === DECLARED_ROWS,
        "★ 数据源里声明的每一行都渲染出来了",
        `渲染 ${sc.rows.length} / 声明 ${DECLARED_ROWS}`,
    );
    ok(sc.legend.join(" / ") === "键位 / 作用", "有表头「键位 / 作用」", sc.legend.join(" / "));
    ok(sc.kbdCount === sc.rows.length, "每一行都有独立的键位元素（不是把键位混进句子里）", `${sc.kbdCount} / ${sc.rows.length}`);
    const noWhat = sc.rows.filter((r) => !r.d).length;
    ok(noWhat === 0, "每一行都写了「作用」（没有只给键位、不说干什么的）", `缺作用 ${noWhat} 行`);
    ok(sc.noneCount > 0, "没有键位的行显式写「菜单操作」，不是留空", `${sc.noneCount} 行`);

    const groupNames = sc.groups.join(" ");
    ok(/导航/.test(groupNames) && /编辑/.test(groupNames) && /剪贴/.test(groupNames), "分组覆盖 导航 / 编辑 / 剪贴", sc.groups.slice(0, 4).join(" / "));

    /* ------------------------------------------------------------ 空格 / 平台 */

    console.log("\n=== 5. ★ 键位：按平台换算，空格必须看得见 ===");
    const isMac = await page.eval(
        `!!(window.siyuan && window.siyuan.config && window.siyuan.config.system && window.siyuan.config.system.os === 'darwin')`,
    );
    const toggleRow = sc.rows.find((r) => /把光标所在的列表切换为导图/.test(r.d));
    const sideRow = sc.rows.find((r) => /并排面板打开导图/.test(r.d));
    ok(!!toggleRow && !!sideRow, "速查里有两条**全局**快捷键", JSON.stringify([toggleRow?.k, sideRow?.k]));

    ok(
        isMac
            ? toggleRow?.k === "⇧⌘D" && sideRow?.k === "⇧⌘B"
            : toggleRow?.k === "Ctrl+Shift+D" && sideRow?.k === "Ctrl+Shift+B",
        "★ 全局键位按平台换算（Windows：Ctrl+Shift+D / Ctrl+Shift+B；macOS：⇧⌘D / ⇧⌘B）",
        `os=${isMac ? "darwin" : "win/linux"}｜${JSON.stringify(toggleRow?.k)} / ${JSON.stringify(sideRow?.k)}`,
    );

    /* ---- ★ 空格仍然必须**看得见** ----
       默认键位曾经是 `⌘空格` / `⌥空格`（后来因为 OS/IME 拦截换掉了，见
       `probe-keymap-dump.mjs` 的文件头）。但**速查里仍然有带空格的行** ——
       它们是 `{space}` 占位符渲染出来的：`sc.nav.fold`（折叠 / 展开）
       与 `sc.present.next`（演示推进）。

       所以这条断言必须**钉在那些行上**，不能跟着默认键位一起删掉：
       思源的键位串里空格是**字面空格**（`KEYCODELIST[32] = " "`），
       不换算就渲染成看不见的 `Ctrl+ `，用户完全读不出该按什么。 */
    const spaceRows = sc.rows.filter((r) => /空格/.test(r.k));
    ok(spaceRows.length >= 2, "★ 速查里仍有走 `{space}` 占位符的行（折叠 / 演示推进）", spaceRows.map((r) => r.k).join(" / "));
    const badSpace = spaceRows.filter((r) => /\s$/.test(r.k) || /[\u00a0\u2000-\u200a\u3000]$/.test(r.k));
    ok(badSpace.length === 0, "★ 那些行的空格渲染成可见的「空格」二字，没有尾随空白（否则用户看到的是 `Ctrl+ `）", badSpace.map((r) => JSON.stringify(r.k)).join(" ") || "(无)");
    // 全表兜底：任何一行都不该以空白收尾
    const trailing = sc.rows.filter((r) => /\s$/.test(r.k));
    ok(trailing.length === 0, "★ 整份速查没有任何一行以空白结尾", trailing.map((r) => JSON.stringify(r.k)).join(" ") || "(无)");

    // Windows 上不该出现 ⌥：它在思源「设置 → 快捷键」里根本没有对应的写法。
    // `⌘` 例外 —— `Ctrl / ⌘ + 双击` 是**故意的跨平台写法**（两种都给出）。
    const optGlyph = sc.rows.filter((r) => r.k.includes("⌥")).map((r) => r.k);
    ok(isMac || optGlyph.length === 0, "★ Windows 上整份速查不出现 ⌥（那是 macOS 字形）", `含 ⌥ 的 ${optGlyph.length} 行：${optGlyph.join(" / ") || "(无)"}`);

    await page.screenshot(`${OUT}/diag-settings-tabs-3-shortcuts.png`);

    /* ------------------------------------------------------------ 没有静默退回 */

    console.log("\n=== 6. 改造过程没有静默失败 ===");
    const warns = await page.eval("window.__mmWarns || []");
    const errs = await page.eval("window.__mmErrors || []");
    const panelWarns = warns.filter((w) => /\[mindmap\]/.test(w));
    ok(panelWarns.length === 0, "★ 插件没有因为「结构不符 / 等不到设置项」退回扁平列表", panelWarns.join(" ⏎ ") || "(无警告)");
    ok(errs.length === 0, "过程中页面没有抛错", errs.join(" ⏎ ") || "(无)");

    console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
} finally {
    await chrome.close();
}

process.exit(fail === 0 ? 0 : 1);
