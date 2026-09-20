/**
 * 第十三轮强化项的真机验收探针。
 *
 * 一次跑完本轮加的全部能力，每条都给可量化的判据，而不是「看着像对」：
 *
 *   1. 可读优先缩放    —— 大图首次进入的字号不得低于 8px
 *   2. 完全跟随大纲    —— 首次进入不擅自折叠（折叠的读写与双向同步由
 *                        diag-fold-sync.mjs 单独钉，这里只钉「没多折」）
 *   3. 适应画布仍可全貌 —— 用户主动点「适应」时必须真的缩到底（不受可读下限限制）
 *   4. 逻辑图自动分列   —— 展开全部之后画布不能还是细长条
 *   5. 插入即编辑      —— Tab 之后新节点处于编辑态、文字已全选
 *   6. 节点下钻        —— Ctrl+双击后出现面包屑、节点数收敛；退出聚焦可还原
 *   7. 搜索增强        —— 只存在于链接地址里的关键词要能搜到
 *   8. 并排面板        —— 左大纲右导图，改左边的字右边要跟着变
 *
 * 用法：node tests/kernel/ux-v2.mjs
 * 截图：tests/.build/v2-*.png
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";

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

const BRANCHES = 9;
const PER = 6;

function makeMd() {
    const out = ["- 强化验收 · 大纲导图"];
    for (let i = 1; i <= BRANCHES; i++) {
        out.push(`  - 分支 ${i} · 一个有点长的主题标题文字`);
        for (let j = 1; j <= PER; j++) {
            // 3.1 这条挂一个双链式外链：它的地址只存在于行内 HTML 里，
            // 纯文本检索永远搜不到 —— 正好用来验证「搜索扩展到链接地址」
            if (i === 3 && j === 1) {
                out.push(`    - 条目 3.1 见 [官方文档](https://example.com/siyuan-guide-xq) 的说明`);
            } else {
                out.push(`    - 条目 ${i}.${j}：用来观察排版、连线与层级的说明文字`);
            }
        }
    }
    out.push("");
    return out.join("\n");
}

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-强化验收-${Date.now()}`,
    markdown: makeMd(),
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });
console.log(`文档 ${docId} · 列表 ${listId} · 共 ${1 + BRANCHES + BRANCHES * PER} 个节点\n`);

const chrome = await launch({ headless: true, port: 9343, width: 1680, height: 1050, dpr: 1 });

/** 结果收集：每条判据一行 PASS / FAIL */
const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}  ${detail}`);
};

/** 页面里量一次画布状态 */
const METRICS = `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return null;
    const world = root.querySelector('.mm-world');
    const txt = root.querySelector('.mm-node .mm-txt');
    const cs = txt ? getComputedStyle(txt) : null;
    const scale = parseFloat(world.style.zoom) || 1;
    const all = [...root.querySelectorAll('.mm-node')];
    const shown = all.filter((el) => el.style.visibility !== 'hidden');
    const crumb = root.querySelector('.mm-crumb');
    return {
        total: all.length,
        visible: shown.length,
        scale: +scale.toFixed(3),
        fontPx: cs ? +(parseFloat(cs.fontSize) * scale).toFixed(2) : 0,
        worldW: Math.round(parseFloat(world.style.width) || 0),
        worldH: Math.round(parseFloat(world.style.height) || 0),
        crumbOn: !!crumb && crumb.classList.contains('mm-crumb--on'),
        crumbText: crumb ? crumb.textContent.trim() : '',
    };
})()`;

/** 取第 n 个可见节点的屏幕中心 */
const nodeCenter = (n) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return null;
    // ⚠️ 必须先确保整个导图在可视区里：导图高度约 700–900px，而窗口 innerHeight
    // 可能只有 950 左右，贴着文档顶部的导图，它的缩放条会落到屏幕外 ——
    // 那时 elementFromPoint 返回 null，坐标点击静默失效（第一版探针就栽在这）。
    root.scrollIntoView({ block: 'center' });
    const shown = [...root.querySelectorAll('.mm-node')].filter((el) => el.style.visibility !== 'hidden');
    const el = shown[${n}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: el.textContent.trim().slice(0, 18) };
})()`;

/** 坐标点击，并检查落点是否真的能命中元素 */
const clickAt = async (page, pos, extra = {}) => {
    await page.mouse("mouseMoved", pos.x, pos.y, { buttons: 0 });
    await page.mouse("mousePressed", pos.x, pos.y, extra);
    await page.mouse("mouseReleased", pos.x, pos.y, extra);
    const hit = await page.eval(`(() => {
        const el = document.elementFromPoint(${pos.x}, ${pos.y});
        return el ? (el.tagName + '.' + (el.className || '')).slice(0, 60) : null;
    })()`);
    if (!hit) console.log(`  ⚠️ 坐标 (${pos.x},${pos.y}) 命中不到任何元素 —— 可能落在可视区外`);
    return hit;
};

/** 点工具条上的某个按钮（按 data-mm-tip 找） */
const toolButton = (tip) => `(() => {
    const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
    if (!root) return null;
    root.scrollIntoView({ block: 'center' });
    const b = [...root.querySelectorAll('button')].find((x) => (x.dataset.mmTip || '').includes(${JSON.stringify(tip)}));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图" });
    await sleep(1600);

    /* ============================================================ 1 + 2. 默认态 */

    const base = await page.eval(METRICS);
    console.log("默认态:", JSON.stringify(base));
    check("可读优先缩放", base.fontPx >= 8, `实际字号 ${base.fontPx}px（缩放 ${base.scale}）`);
    check(
        "默认完全跟随大纲（不擅自折叠）",
        base.visible === base.total,
        `可见 ${base.visible} / 共 ${base.total}（大纲里没有任何 fold，导图就不该折）`,
    );
    check("面包屑默认隐藏", !base.crumbOn, `crumbOn=${base.crumbOn}`);

    /* ---- 取景：可读优先模式下不能「一边空一大片、另一边被裁掉」 ----
       曾经的 bug：fit() 无条件把根节点放在视口 30% 处，内容宽于视口时
       左侧白空三成、右侧多裁三成（实测左空 228px / 右裁 225px）。
       判据用「内容对可视区的覆盖率」——
       内容比视口大时必须几乎铺满（覆盖率 ≥90%），否则就是在白白浪费可视区；
       内容比视口小时必须左右居中（两侧留白之差 ≤40px）。 */
    const frame = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
        if (!root) return null;
        const vp = root.querySelector('.mm-viewport');
        const vr = vp.getBoundingClientRect();
        const els = [...root.querySelectorAll('.mm-node')].filter((e) => e.style.visibility !== 'hidden');
        if (!els.length) return null;
        const rs = els.map((e) => e.getBoundingClientRect());
        const u = rs.reduce((a, r) => ({
            l: Math.min(a.l, r.left), r: Math.max(a.r, r.right),
        }), { l: Infinity, r: -Infinity });
        const left = u.l - vr.left;
        const right = u.r - vr.left;
        const covered = Math.max(0, Math.min(right, vr.width) - Math.max(left, 0));
        return {
            contentW: Math.round(right - left),
            vpW: Math.round(vr.width),
            coverage: +(covered / vr.width).toFixed(3),
            leftSlack: Math.round(Math.max(left, 0)),
            rightSlack: Math.round(Math.max(vr.width - right, 0)),
        };
    })()`);
    if (frame) {
        if (frame.contentW >= frame.vpW) {
            check(
                "可读优先取景不浪费可视区",
                frame.coverage >= 0.9,
                `内容 ${frame.contentW}px ≥ 视口 ${frame.vpW}px，覆盖率 ${(frame.coverage * 100).toFixed(1)}%（应 ≥90%）`,
            );
        } else {
            const skew = Math.abs(frame.leftSlack - frame.rightSlack);
            check(
                "可读优先取景不浪费可视区",
                skew <= 40,
                `内容 ${frame.contentW}px < 视口 ${frame.vpW}px，左留白 ${frame.leftSlack} / 右留白 ${frame.rightSlack}（差值 ${skew}，应 ≤40）`,
            );
        }
    } else {
        check("可读优先取景不浪费可视区", false, "拿不到节点矩形");
    }
    await page.screenshot(`${OUT}/v2-01-default.png`);

    /* ============================================================ 4. 逻辑图分列 */

    // 分列只在「全部展开、单列确实过高」时才有意义，所以先展开
    const unfoldBtn = await page.eval(toolButton("展开全部"));
    if (unfoldBtn) {
        await clickAt(page, unfoldBtn);
        await sleep(900);
        const full = await page.eval(METRICS);
        const ratio = full.worldW / Math.max(1, full.worldH);
        check(
            "逻辑图自动分列（画布不再是细长条）",
            full.visible === base.total && ratio > 0.35,
            `展开后 ${full.visible} 节点，画布 ${full.worldW}×${full.worldH}（宽高比 ${ratio.toFixed(2)}）`,
        );
        await page.screenshot(`${OUT}/v2-02-expanded-columns.png`);
    } else {
        check("逻辑图自动分列（画布不再是细长条）", false, "没找到「展开全部」按钮");
    }

    /* ============================================================ 3. 适应画布 */

    // 在「全部展开」的大图上测才有意义：小图上适应画布本来就等于 100%
    const fitBtn = await page.eval(toolButton("适应画布"));
    if (fitBtn) {
        await clickAt(page, fitBtn);
        await sleep(700);
        const fitted = await page.eval(METRICS);
        check(
            "适应画布不受可读下限限制",
            fitted.scale < base.scale,
            `缩放 ${base.scale} → ${fitted.scale}，字号 ${fitted.fontPx}px`,
        );
    } else {
        check("适应画布不受可读下限限制", false, "没找到「适应画布」按钮");
    }

    /* ============================================================ 5. 插入即编辑 */

    // 折起所有分支，只留根节点；对着根按 Tab 插一个子节点 —— 它一定可见，
    // 不会因为父节点折叠而藏起来（那会让「编辑态」没法验证）
    const foldBtn = await page.eval(toolButton("折叠全部"));
    if (foldBtn) {
        await clickAt(page, foldBtn);
        await sleep(900);
    }
    const beforeInsert = await page.eval(METRICS);
    console.log("插入前:", JSON.stringify(beforeInsert));

    const rootNode = await page.eval(nodeCenter(0));
    if (rootNode) {
        await clickAt(page, rootNode);
        await sleep(400);
        const selected = await page.eval(`(() => {
            const el = document.querySelector('.mm-root:not(.mm-root--dialog) .mm-node.mm-sel');
            return el ? el.textContent.trim().slice(0, 16) : null;
        })()`);
        await page.press("Tab");
        await sleep(2600); // 内核写回 + 扫描重挂 + pendingEdit 兑现

        const edit = await page.eval(`(() => {
            const root = document.querySelector('.mm-root:not(.mm-root--dialog)');
            const el = root && root.querySelector('.mm-node[data-mm-editing]');
            const txt = el ? el.querySelector('.mm-txt') : null;
            const sel = window.getSelection();
            const all = root ? [...root.querySelectorAll('.mm-node')] : [];
            return {
                editing: !!el,
                text: txt ? txt.textContent : '',
                editable: txt ? txt.getAttribute('contenteditable') : null,
                focused: !!txt && document.activeElement === txt,
                selected: sel ? sel.toString() : '',
                total: all.length,
                visible: all.filter((x) => x.style.visibility !== 'hidden').length,
                active: document.activeElement ? document.activeElement.className : '?',
                texts: all.map((x) => x.textContent.trim().slice(0, 10)).slice(0, 12),
            };
        })()`);
        console.log("插入即编辑:", JSON.stringify(edit));
        console.log("  选中节点:", selected);
        check(
            "插入后自动进入编辑态",
            edit.editing && edit.editable === "true" && edit.focused,
            `editing=${edit.editing} focused=${edit.focused} 文本「${edit.text}」active=${edit.active}`,
        );
        check("新节点文字已全选", edit.selected === "新节点", `选中「${edit.selected}」`);
        await page.screenshot(`${OUT}/v2-03-insert-edit.png`);

        /* ---- 编辑态下再单击一次，必须还在编辑态 ----
           曾经的 bug：节点自己的 click 处理器里调了 `rootEl.focus()`，
           这一下把焦点从 .mm-txt 抢走 → blur → onBlur 提交并结束编辑，
           于是「双击进去、点一下就出来」，根本没法改字。 */
        const editPos = await page.eval(`(() => {
            const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
            const el = root && root.querySelector('.mm-node[data-mm-editing] .mm-txt');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
        if (editPos) {
            await page.mouse("mouseMoved", editPos.x, editPos.y, { buttons: 0 });
            await page.mouse("mousePressed", editPos.x, editPos.y, { button: "left", clickCount: 1 });
            await page.mouse("mouseReleased", editPos.x, editPos.y, { button: "left", clickCount: 1 });
            await sleep(500);
            const afterClick = await page.eval(`(() => {
                const root = document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)');
                const el = root && root.querySelector('.mm-node[data-mm-editing]');
                const txt = el ? el.querySelector('.mm-txt') : null;
                return {
                    editing: !!el,
                    focused: !!txt && document.activeElement === txt,
                    active: document.activeElement ? String(document.activeElement.className || document.activeElement.tagName).slice(0, 30) : '?',
                };
            })()`);
            check(
                "编辑态下单击不退出编辑",
                afterClick.editing && afterClick.focused,
                `editing=${afterClick.editing} focused=${afterClick.focused} active=${afterClick.active}`,
            );
        } else {
            check("编辑态下单击不退出编辑", false, "找不到正在编辑的节点");
        }

        // 收尾：Esc 退出编辑态（不按 Delete —— 焦点可能已经不在导图上，
        // 那一按会删到正文里去）
        await page.press("Escape");
        await sleep(600);
    } else {
        check("插入后自动进入编辑态", false, "找不到根节点");
        check("新节点文字已全选", false, "找不到根节点");
        check("编辑态下单击不退出编辑", false, "找不到根节点");
    }

    /* ============================================================ 6. 节点下钻 */

    // 上一步收尾时正好是「根 + 一级分支 + 新节点」的形态，直接拿来下钻。
    // （别再去点根节点上的折叠珠子 —— 那是 toggle，会把根折起来只剩 1 个节点）
    const drillBase = await page.eval(METRICS);
    console.log("下钻前:", JSON.stringify(drillBase));

    const target = await page.eval(nodeCenter(1));
    if (target) {
        // Ctrl + 双击：两次 press/release，clickCount 递增，浏览器才会派发 dblclick
        await page.mouse("mouseMoved", target.x, target.y, { buttons: 0 });
        for (const n of [1, 2]) {
            await page.mouse("mousePressed", target.x, target.y, { clickCount: n, modifiers: 2 });
            await page.mouse("mouseReleased", target.x, target.y, { clickCount: n, modifiers: 2 });
        }
        await sleep(900);
        const drilled = await page.eval(METRICS);
        console.log("下钻后:", JSON.stringify(drilled));
        check(
            "Ctrl+双击下钻",
            drilled.crumbOn && drilled.visible < drillBase.visible,
            `面包屑「${drilled.crumbText}」，可见 ${drilled.visible}（下钻前 ${drillBase.visible}）`,
        );
        await page.screenshot(`${OUT}/v2-04-drill.png`);

        const outBtn = await page.eval(`(() => {
            const b = document.querySelector('.mm-root:not(.mm-root--dialog) .mm-crumb-out');
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
        if (outBtn) {
            await clickAt(page, outBtn);
            await sleep(900);
            const back = await page.eval(METRICS);
            check(
                "退出聚焦还原全图",
                !back.crumbOn && back.visible === drillBase.visible,
                `可见 ${back.visible}（下钻前 ${drillBase.visible}），crumbOn=${back.crumbOn}`,
            );
        } else {
            check("退出聚焦还原全图", false, "没找到「退出聚焦」按钮");
        }
    } else {
        check("Ctrl+双击下钻", false, "找不到可点的节点");
        check("退出聚焦还原全图", false, "找不到可点的节点");
    }

    /* ============================================================ 7. 搜索增强 */

    // 先折叠回 2 层，让目标藏在折叠的子树里（顺便验证 gotoHit 会自动展开祖先）
    const fold2 = await page.eval(toolButton("折叠全部"));
    if (fold2) {
        await clickAt(page, fold2);
        await sleep(800);
    }
    await page.press("f", { ctrl: true });
    await sleep(400);
    await page.type("siyuan-guide-xq");
    await sleep(1200);
    const hit = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog)');
        const cur = root.querySelector('.mm-node.mm-hit-cur');
        const count = root.querySelector('.mm-search .mm-search-count, .mm-search span');
        const shown = [...root.querySelectorAll('.mm-node')].filter((el) => el.style.visibility !== 'hidden');
        return {
            hit: cur ? cur.textContent.trim().slice(0, 30) : null,
            shownCount: shown.length,
            searchText: root.querySelector('.mm-search') ? root.querySelector('.mm-search').textContent.trim() : '',
        };
    })()`);
    console.log("搜索:", JSON.stringify(hit));
    check("按链接地址搜到节点", !!hit.hit && hit.hit.includes("官方文档"), `命中「${hit.hit}」`);
    check("命中项自动展开祖先", hit.shownCount > drillBase.visible, `可见节点 ${drillBase.visible} → ${hit.shownCount}`);
    await page.screenshot(`${OUT}/v2-05-search-link.png`);
    await page.press("Escape");
    await sleep(300);

    /* ============================================================ 8. 并排面板 */

    // 并排面板是给「大纲视图」用的伴生视图，先把行内导图关掉
    await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": null } });
    await page.eval(`document.querySelector('.protyle-wysiwyg .list').removeAttribute('custom-mindmap')`);
    await sleep(1000);
    const inlineGone = await page.eval(`!document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)')`);
    check("关闭导图后行内视图卸载", !!inlineGone, `inlineGone=${inlineGone}`);

    // 走真实的块图标菜单路径触发并排面板：给 eventBus 发 click-blockicon，
    // 拿一个假的 menu 把菜单项收集起来。顺便探一下 SiYuan 这一版 emit 的载荷形状
    // （有的版本是 {detail:{...}}，有的是 {...} 直接给），两种都试。
    const menuProbe = (shape) => `(() => {
        const app = window.siyuan && window.siyuan.ws && window.siyuan.ws.app;
        if (!app || !app.plugins) return { err: '拿不到 app.plugins' };
        const plug = app.plugins.find((p) => (p.name || '').includes('mindmap')) ||
                     app.plugins.find((p) => p.constructor && /MindMap/.test(p.constructor.name));
        if (!plug) return { err: '找不到插件实例', names: app.plugins.map((p) => p.name) };
        const el = document.querySelector('.protyle-wysiwyg .list');
        const items = [];
        const menu = { addItem: (i) => items.push(i), addSeparator: () => undefined };
        plug.eventBus.emit('click-blockicon', ${
            shape === "detail" ? "{ detail: { menu, blockElements: [el] } }" : "{ menu, blockElements: [el] }"
        });
        window.__mmMenu = items;
        return { shape: ${JSON.stringify(shape)}, labels: ((items[0] && items[0].submenu) || []).map((s) => s.label || s.type) };
    })()`;

    let side = await page.eval(menuProbe("detail"));
    if (!side.labels?.length) side = await page.eval(menuProbe("flat"));
    console.log("块菜单:", JSON.stringify(side));
    check(
        "块菜单出现「并排查看」",
        Array.isArray(side.labels) && side.labels.some((l) => l && l.includes("并排")),
        JSON.stringify(side.labels ?? side.err),
    );

    if (Array.isArray(side.labels)) {
        const clicked = await page.eval(`(() => {
            const sub = ((window.__mmMenu || [])[0] || {}).submenu || [];
            const t = sub.find((s) => s.label && s.label.includes('并排'));
            if (!t) return false;
            t.click();
            return true;
        })()`);
        console.log("点击并排项:", clicked);
        await sleep(1800);
        const panel = await page.eval(`(() => {
            const p = document.querySelector('.mm-side');
            if (!p) return null;
            const root = p.querySelector('.mm-root--side');
            const r = p.getBoundingClientRect();
            return {
                w: Math.round(r.width),
                hasRoot: !!root,
                nodes: root ? [...root.querySelectorAll('.mm-node')].filter((el) => el.style.visibility !== 'hidden').length : 0,
                // 源列表必须还在（并排的意义就在这里）
                sourceVisible: (() => {
                    const l = document.querySelector('.protyle-wysiwyg .list');
                    if (!l) return false;
                    return !l.classList.contains('mm-source-hidden') && getComputedStyle(l).display !== 'none';
                })(),
            };
        })()`);
        console.log("并排面板:", JSON.stringify(panel));
        check("并排面板挂载成功", !!panel?.hasRoot && panel.nodes > 0, JSON.stringify(panel));
        check("并排时源大纲保持可见", !!panel?.sourceVisible, `sourceVisible=${panel?.sourceVisible}`);
        await page.screenshot(`${OUT}/v2-06-side.png`);

        /* 联动：在左边大纲里改一个字，右边应该跟着变 */
        const paraId = await page.eval(`(() => {
            // 思源的段落是 <div data-type="NodeParagraph">，不是 <p>
            const li = document.querySelector('.protyle-wysiwyg .list .li[data-node-id]');
            if (!li) return null;
            const p = [...li.children].find((c) => c.hasAttribute('data-node-id') && !c.classList.contains('list'));
            return p ? p.dataset.nodeId : null;
        })()`);
        if (paraId) {
            const write = await api("/api/block/updateBlock", {
                id: paraId,
                dataType: "markdown",
                data: "联动探针写入的文字",
            });
            await sleep(2400);
            const after = await page.eval(`(() => {
                const root = document.querySelector('.mm-side .mm-root--side');
                return { has: !!root && root.textContent.includes('联动探针') };
            })()`);
            check(
                "并排面板实时联动",
                !!after?.has,
                `写入 code=${write.code}，右侧出现「联动探针」=${after?.has}`,
            );
            await page.screenshot(`${OUT}/v2-07-side-linked.png`);
        } else {
            check("并排面板实时联动", false, "找不到可改的段落");
        }

        /* 关掉面板，源列表不该被改过显示模式 */
        await page.eval(`(() => {
            const b = document.querySelector('.mm-side .mm-side-close');
            if (b) b.click();
            return true;
        })()`);
        await sleep(600);
        const closed = await page.eval(`(() => ({
            panel: !!document.querySelector('.mm-side'),
            attr: (document.querySelector('.protyle-wysiwyg .list') || {}).getAttribute
                ? document.querySelector('.protyle-wysiwyg .list').getAttribute('custom-mindmap')
                : null,
        }))()`);
        check("关闭并排面板后不留痕", !closed.panel, `panel=${closed.panel}`);
    }

    /* ============================================================ 汇总 */

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
    if (failed.length) {
        console.log("未通过：");
        for (const f of failed) console.log(`  - ${f.name}：${f.detail}`);
        process.exitCode = 1;
    }
} finally {
    await chrome.close();
    const info = await api("/api/block/getBlockInfo", { id: docId });
    if (info.code === 0) {
        await api("/api/filetree/removeDoc", { notebook: info.data.box, path: info.data.path });
        console.log("已清理临时文档");
    }
}
