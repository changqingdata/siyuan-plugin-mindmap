/**
 * 行内格式覆盖度盘点：思源原生支持的排版，进到导图里还剩多少？
 *
 * 做法：造一个列表，每一项演示一种行内功能；挂上 custom-mindmap 后开无头浏览器，
 * 把「源列表 DOM」和「导图 .mm-txt 的 DOM」并排 dump 出来对比。
 * 逐项看三件事：
 *   1. 标签/属性有没有被解析层留下
 *   2. 有没有对应的 CSS（拿 getComputedStyle 实测，而不是看样式表里写没写）
 *   3. 节点尺寸算得对不对（图片 / 公式这类非文字内容最容易把测量搞崩）
 *
 * 用法：node tests/kernel/inline-coverage.mjs      MM_KEEP=1 保留文档
 */

import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

const conf = JSON.parse(fs.readFileSync(path.join(WORKSPACE, "conf", "conf.json"), "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";
// 阶段：b（默认，覆盖度盘点）/ edit（进编辑态改名，验证格式是否被抹）
// 两种写法都支持：MM_PHASE=edit node …  或  node … edit
const PHASE = process.env.MM_PHASE || process.argv[2] || "";

/**
 * 失败收集器 —— 本支原先**只有判定、没有门**：
 * 三处判定（改名后格式是否保住 / Ctrl+D 是否插出新块 / Ctrl+单击是否打开链接）
 * 都只打印 ✔/✘，红绿传不出去。于是它红着也能让 `kernel:inline:all` 返回 0，
 * 进套件等于没进。判据：这三条都是「产品应该做到的事」——
 * 红了就说明产品坏了（不是「我搞错了」），所以配当门。
 *
 * ⚠️ 注意区分：同目录的 `copy-fidelity.mjs` 也打印一堆 ✘，但那是**探针结论**
 * （「这种格式复制后会丢」就是要记录的事实），给它加门会造出一扇永远红的门。
 */
const problems = [];
const fail = (msg) => {
    problems.push(msg);
    console.log(`  ✘ [记入失败] ${msg}`);
};

async function api(p, payload) {
    const res = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    return res.json();
}

async function children(id) {
    const j = await api("/api/block/getChildBlocks", { id });
    return j.code === 0 ? j.data : [];
}

/* 一行演示一种功能。markdown 语法走的是思源自己的导入器，产物就是插件看到的 DOM */
const MD = [
    "- 行内格式覆盖度盘点",
    "  - 加粗 **粗体** 斜体 *斜体*",
    "  - 下划线 <u>下划线</u> 删除线 ~~删除线~~",
    "  - 行内代码 `const a = 1` 高亮 ==高亮==",
    "  - 上标 ^上标^ 下标 ~下标~",
    "  - 行内公式 $E = mc^2$",
    "  - 双链 [[行内格式覆盖度盘点]] 块引用 ((" + "20221230192740-wpnntiv" + "))",
    "  - 超链接 [思源官网](https://b3log.org/siyuan/)",
    "  - 标签 #测试标签#",
    "  - 红字 <span style=\"color: #ff5c5c\">红色文字</span> 黄底 <span style=\"background-color: #ffe066\">黄色底</span>",
    "  - 大字 <span style=\"font-size: 22px\">22px 文字</span>",
    "  - 表情 😀🎉 全角 Ｆｕｌｌ 混合 mixed 文字",
    "",
].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-行内覆盖度-${Date.now()}`,
    markdown: MD,
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
const listId = (await children(docId)).find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "mind" } });
console.log("文档:", docId, "列表:", listId);

/*
 * markdown 导入器表达不了「高亮 / 颜色 / 字号 / 标签 / 真双链」这些 ——
 * 它会把 `==高亮==` 和 `[[x]]` 原样当纯文本，把 `<span style=…>` 转义掉。
 * 所以再走一轮「按思源真实的行内 HTML 直接写块」，这才等于用户在编辑器里用工具栏做出来的东西。
 * 用 dataType: "dom" 直接喂 DOM，绕开 markdown 这一层。
 */
const PX = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAAA1BMVEX/AAAAJ4XwAAAADUlEQVQI12P4//8/AwAI/AL+XJ/PAAAAAElFTkSuQmCC";
const DOM_ITEMS = [
    `<span data-type="strong">粗体</span> 普通 <span data-type="em">斜体</span> <span data-type="u">下划线</span>`,
    `<span data-type="mark">高亮</span> <span data-type="code">code</span> <span data-type="s">删除线</span>`,
    `<span data-type="text" style="color: var(--b3-font-color1)">红字</span> <span data-type="text" style="background-color: var(--b3-font-background5)">黄底</span>`,
    `<span data-type="text" style="font-size: 22px">大字22px</span> 普通14px`,
    `<span data-type="a" data-href="https://b3log.org/siyuan/">链接</span> <span data-type="tag">标签</span>`,
    `<span data-type="block-ref" data-id="${docId}" data-subtype="s">块引用</span>`,
    `<span data-type="sup">上标</span> <span data-type="sub">下标</span> <span data-type="inline-math" data-subtype="math" data-content="E=mc^2"></span>`,
    `<span data-type="img"><img src="data:image/png;base64,${PX}" alt=""></span>`,
];

async function allItems(id, out = []) {
    for (const k of await children(id)) {
        if (k.type === "i") {
            out.push(k);
            await allItems(k.id, out);
        } else {
            await allItems(k.id, out);
        }
    }
    return out;
}

if (!PHASE || PHASE === "b" || PHASE === "copy" || PHASE === "links") {
    const liList = await allItems(listId);
    // [0] 是根节点「行内格式覆盖度盘点」，从 [1] 开始才是各项演示
    for (let i = 0; i < DOM_ITEMS.length; i++) {
        const li = liList[i + 1];
        if (!li) break;
        const p = (await children(li.id)).find((c) => c.type === "p");
        if (!p) continue;
        const r = await api("/api/block/updateBlock", { id: p.id, dataType: "dom", data: DOM_ITEMS[i] });
        console.log(`  注入[${i}] code=${r.code} ${r.code !== 0 ? r.msg : ""}`);
    }
    await new Promise((r) => setTimeout(r, 500));
}

const chrome = await launch({ headless: true, port: 9337, width: 1600, height: 1000, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "protyle" });
    const ok = await page
        .waitFor("!!document.querySelector('.mm-root')", { timeout: 30000, label: "导图" })
        .then(() => true)
        .catch(() => false);
    if (!ok) throw new Error("导图没挂载");
    await sleep(1200);

    /* 源列表里每一项的内容 HTML —— 这是「思源原生能表达什么」的基准。
       用后代选择器取全部 .li：文档顺序就是深度优先，和导图节点的排列顺序一致 */
    const src = await page.eval(`(() => {
        const items = Array.from(document.querySelectorAll('.list[data-node-id="${listId}"] .li'));
        return items.map(li => {
            const c = Array.from(li.children).find(e => e.hasAttribute && e.hasAttribute('data-node-id') && !e.classList.contains('list'));
            return c ? c.innerHTML : '';
        });
    })()`);

    /* 导图里每个节点的内容 HTML + 实测尺寸 —— 这是「用户实际看到什么」 */
    const got = await page.eval(`(() => {
        return Array.from(document.querySelectorAll('.mm-root:not(.mm-root--dialog) .mm-node')).map(el => {
            const txt = el.querySelector('.mm-txt');
            const r = el.getBoundingClientRect();
            return { html: txt ? txt.innerHTML : '', text: txt ? txt.textContent : '', w: Math.round(r.width), h: Math.round(r.height) };
        });
    })()`);

    /* 关键元素实测计算样式：样式表里写了规则 ≠ 真的生效（可能被更高优先级覆盖） */
    const styles = await page.eval(`(() => {
            const out = {};
            const probe = (sel) => {
                const el = document.querySelector('.mm-root:not(.mm-root--dialog) .mm-txt ' + sel);
                if (!el) return null;
                const cs = getComputedStyle(el);
                return { fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, textDecoration: cs.textDecorationLine,
                         color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize };
            };
            out['strong']   = probe('strong') || probe('[data-type="strong"]');
            out['em']       = probe('em') || probe('[data-type="em"]');
            out['u']        = probe('u') || probe('[data-type="u"]');
            out['s']        = probe('s') || probe('[data-type="s"]');
            out['code']     = probe('code') || probe('[data-type="code"]');
            out['mark']     = probe('mark') || probe('[data-type="mark"]');
            out['sup']      = probe('sup') || probe('[data-type="sup"]');
            out['sub']      = probe('sub') || probe('[data-type="sub"]');
            out['blockref'] = probe('[data-type="block-ref"]');
            out['a']        = probe('a');
            out['img']      = probe('img');
            out['math']     = probe('[data-type="inline-math"]');
            out['tag']      = probe('[data-type="tag"]');
            out['span']     = probe('span');
            return out;
        })()`);

    console.log("\n================ 逐项对比（源列表 → 导图）================\n");
    for (let i = 0; i < Math.max(src.length, got.length); i++) {
        const g = got[i] ?? {};
        const label = (g.text || "").replace(/\s+/g, " ").slice(0, 40);
        console.log(`[${i}] ${label}`);
        console.log(`    源列表 : ${(src[i] || "(无)").slice(0, 300)}`);
        console.log(`    导图   : ${(g.html || "(无)").slice(0, 300)}`);
        console.log(`    节点尺寸: ${g.w} × ${g.h}`);
        console.log("");
    }

    /* 图片：源列表里到底长什么样（不截断），以及它为什么没进导图 */
    const imgHtml = await page.eval(`(() => {
        const li = Array.from(document.querySelectorAll('.list[data-node-id="${listId}"] .li')).find(l => l.querySelector('[data-type="img"]'));
        if (!li) return '(源列表里没有图片项)';
        const c = Array.from(li.children).find(e => e.hasAttribute && e.hasAttribute('data-node-id') && !e.classList.contains('list'));
        return c ? c.outerHTML : '';
    })()`);
    console.log("\n================ 图片项在源列表里的真实形态 ================");
    console.log(imgHtml.replace(/></g, ">\n  <"));
    const imgInView = await page.eval(`document.querySelectorAll('.mm-root:not(.mm-root--dialog) .mm-txt [data-type="img"]').length`);
    console.log(`  导图里图片元素个数: ${imgInView}（0 = 整个节点被丢了）`);
    const imgSrc = await page.eval(`(() => {
        const i = document.querySelector('.list[data-node-id="${listId}"] img');
        return i ? { src: i.getAttribute('src'), dataSrc: i.getAttribute('data-src'), loading: i.getAttribute('loading') } : null;
    })()`);
    console.log(`  源列表里那个 img 的属性: ${JSON.stringify(imgSrc)}`);

    console.log("\n================ 关键元素实测计算样式 ================");
    for (const [k, v] of Object.entries(styles)) {
        console.log(`  ${k.padEnd(9)} ${v ? JSON.stringify(v) : "❌ 导图里根本没这个元素"}`);
    }

    /* ---- 编辑器 UI 外壳有没有被带进节点 ---- */
    const junk = await page.eval(`(() => {
        const root = document.querySelector('.mm-root:not(.mm-root--dialog)');
        if (!root) return null;
        return {
            protyle: root.querySelectorAll('[class*="protyle-"]').length,
            emptySpan: Array.from(root.querySelectorAll('.mm-txt span'))
                .filter(s => !s.attributes.length && !s.children.length && !(s.textContent || '').trim()).length,
            nodes: root.querySelectorAll('.mm-node').length,
        };
    })()`);
    if (junk) {
        console.log("\n================ 节点里有没有混进编辑器的 UI 外壳 ================");
        console.log(`  带 protyle- 类的元素: ${junk.protyle}   ← 应为 0`);
        console.log(`  纯空白占位 span:      ${junk.emptySpan}   ← 应为 0`);
        console.log(`  导图节点数:           ${junk.nodes}   ← 源列表 ${src.length} 项，少了就是被当空节点丢了`);
    }

    /* ---- 双击含格式的节点会怎样？ ---- */
    if (PHASE === "edit") {
        console.log("\n================ 双击含格式的节点 ================");
        console.log("  预期：不再进入就地编辑（那条路写回纯文本、会抹掉格式），");
        console.log("        而是退出导图、把光标送回源列表段落，内容零改动");

        const before = (await api("/api/block/getBlockKramdown", { id: listId })).data.kramdown;
        const target = await page.eval(`(() => {
            const el = document.querySelectorAll('.mm-root:not(.mm-root--dialog) .mm-node')[1];
            if (!el) return null;
            const r = el.getBoundingClientRect();
            // ⚠️ 属性名是 data-mm-id（dataset.mmId），不是 data-node-id。
            //    原因见 src/core/renderer.ts 的长注释：思源前端按
            //    [data-node-id="…"] 在全文档里查元素，导图长在 .protyle-wysiwyg
            //    里面，用同名属性会和真大纲块撞车。这里原先写成 dataset.nodeId，
            //    读到的是 undefined —— copy 阶段因此
            //    getBlockDOM({id: undefined}) 返回 data=null，直接 TypeError 崩掉。
            //    （本段在 page.eval 的模板字符串里，注释里不能出现反引号。）
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: el.dataset.mmId };
        })()`);
        console.log("  目标节点:", JSON.stringify(target));
        if (target) {
            await page.mouse("mouseMoved", target.x, target.y, { buttons: 0 });
            for (const n of [1, 2]) {
                await page.mouse("mousePressed", target.x, target.y, { clickCount: n });
                await page.mouse("mouseReleased", target.x, target.y, { clickCount: n });
            }
            await sleep(900);

            const editing = await page.eval(`!!document.querySelector('.mm-node[data-mm-editing]')`);
            const mmRoot = await page.eval(`!!document.querySelector('.mm-root:not(.mm-root--dialog)')`);
            const focusWhere = await page.eval(`(() => {
                const a = document.activeElement;
                if (!a) return 'none';
                if (a.closest && a.closest('.protyle-wysiwyg')) return 'protyle';
                return a.tagName;
            })()`);

            console.log(`  进入了就地编辑态: ${editing}    ← 应为 false`);
            console.log(`  导图还挂在页面上: ${mmRoot}     ← 应为 false（已退出，源列表重新可见）`);
            console.log(`  焦点落在: ${focusWhere}         ← 应为 protyle`);

            /*
             * 真的在源段落里改字，看格式还在不在。
             *
             * ⚠️ 判据不能用 `data-type="strong"` —— kramdown 是**语义**表示：
             * 加粗是 `**x**`、双链是 `((id "锚"))`、公式是 `$x$`，
             * 直接搜 `data-type` 会得出「格式全没了」的假结论。
             * 另外 kramdown 里带 `{: id="…" updated="…" }` 属性行，
             * 退出导图会清掉列表块上的自定义属性，属性行会变 —— 比对前要剥掉。
             */
            const strip = (s) => s.replace(/\{:[^}]*\}/g, "").replace(/\s+/g, " ").trim();
            const count = (s, re) => (s.match(re) ?? []).length;

            const marks = [
                ["加粗 **", /\*\*/g],
                ["双链 ((", /\(\(/g],
                ["公式 $", /\$/g],
                ["下划线 <u>", /<u>/g],
            ];
            const beforeCounts = marks.map(([, re]) => count(before, re));
            console.log("  改字前的格式计数:", marks.map(([l], i) => `${l}=${beforeCounts[i]}`).join(" "));

            // 光标已经被插件放在源段落末尾（不是全选），直接输入就是**追加**，
            // 这正是「改个错别字」的形态 —— 原有格式必须原样留着
            await page.type("改过");
            await sleep(2400);

            const after = (await api("/api/block/getBlockKramdown", { id: listId })).data.kramdown;
            console.log("  改字后的格式计数:", marks.map(([l, re]) => `${l}=${count(after, re)}`).join(" "));
            for (let i = 0; i < marks.length; i++) {
                const [label, re] = marks[i];
                const now = count(after, re);
                const kept = now >= beforeCounts[i];
                console.log(`    ${label.padEnd(12)} ${beforeCounts[i]} → ${now}  ${kept ? "✔ 保住了" : "✘ 丢了"}`);
                if (!kept) fail(`改名后 ${label} 格式丢了（${beforeCounts[i]} → ${now}）`);
            }
            console.log(`  文字是否真的改了: ${after.includes("改过") ? "✔ 改了" : "✘ 没改（可能没聚焦成功）"}`);
            console.log(`  改字前后（剥掉块属性后）一致: ${strip(before) === strip(after) ? "是（说明字没改成功）" : "否（字已改）"}`);
        }
    }

    /*
     * ---- 副本路径保不保格式？ ----
     *
     * 「快速复制」（Ctrl+D）、「边界位置的降级/升级」都会走 `serializeSubtree` →
     * `insertBlock`。修之前那里用的是 `escapeMd(node.text)` —— 纯文本，
     * 副本会把双链、公式、加粗静默重建成纯文本。修之后应该原样带过去。
     */
    if (PHASE === "copy") {
        console.log("\n================ 快速复制含格式的节点 ================");
        const FEATS = ["strong", "em", "u", "s", "mark", "code", "block-ref", "inline-math", "tag"];
        const featsOf = (dom) => FEATS.filter((t) => dom.includes(`data-type="${t}"`));

        const itemsBefore = (await allItems(listId)).map((i) => i.id);
        const target = await page.eval(`(() => {
            const el = document.querySelectorAll('.mm-root:not(.mm-root--dialog) .mm-node')[1];
            if (!el) return null;
            const r = el.getBoundingClientRect();
            // ⚠️ 属性名是 data-mm-id（dataset.mmId），不是 data-node-id。
            //    原因见 src/core/renderer.ts 的长注释：思源前端按
            //    [data-node-id="…"] 在全文档里查元素，导图长在 .protyle-wysiwyg
            //    里面，用同名属性会和真大纲块撞车。这里原先写成 dataset.nodeId，
            //    读到的是 undefined —— copy 阶段因此
            //    getBlockDOM({id: undefined}) 返回 data=null，直接 TypeError 崩掉。
            //    （本段在 page.eval 的模板字符串里，注释里不能出现反引号。）
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: el.dataset.mmId };
        })()`);
        console.log("  目标节点:", JSON.stringify(target));

        if (target) {
            const srcDom = (await api("/api/block/getBlockDOM", { id: target.id })).data.dom;
            console.log(`  源节点格式: ${featsOf(srcDom).join(" ") || "（无）"}`);

            await page.mouse("mouseMoved", target.x, target.y, { buttons: 0 });
            await page.mouse("mousePressed", target.x, target.y, { clickCount: 1 });
            await page.mouse("mouseReleased", target.x, target.y, { clickCount: 1 });
            await sleep(350);
            await page.press("d", { ctrl: true });
            await sleep(2600);

            const fresh = (await allItems(listId)).filter((i) => !itemsBefore.includes(i.id));
            console.log(`  新增块数: ${fresh.length}`);
            if (fresh.length === 0) {
                fail("Ctrl+D 没有插出新块 —— 可能没被导图接管（焦点丢了？）");
            }
            for (const f of fresh) {
                const dom = (await api("/api/block/getBlockDOM", { id: f.id })).data.dom;
                const got = featsOf(dom);
                console.log(`    新块 ${f.id.slice(-7)}  格式: ${got.join(" ") || "（无格式）"}`);
            }
        }
    }

    /*
     * ---- Ctrl + 单击能不能打开链接 / 双链？ ----
     *
     * 之前这两个元素在导图里**完全点不动**：mousedown 上为了保焦点做了 preventDefault，
     * 裸单击又是「选中节点」，没有任何入口能打开它们。
     * 这里 hook 掉 window.open，用真实鼠标事件（带 Ctrl 修饰键）验证一下。
     */
    if (PHASE === "links") {
        console.log("\n================ Ctrl + 单击打开链接 ================");
        await page.eval(`(() => { window.__mmOpened = []; window.open = (u) => { window.__mmOpened.push(String(u)); return null; }; })()`);

        const box = await page.eval(`(() => {
            const el = document.querySelector('.mm-root:not(.mm-root--dialog) .mm-txt [data-type="a"]');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), href: el.dataset.href };
        })()`);
        console.log("  链接元素:", JSON.stringify(box));

        if (box) {
            const CTRL = 2;
            // 裸单击：应该只是选中节点，不能打开
            await page.mouse("mouseMoved", box.x, box.y, { buttons: 0 });
            await page.mouse("mousePressed", box.x, box.y, { clickCount: 1 });
            await page.mouse("mouseReleased", box.x, box.y, { clickCount: 1 });
            await sleep(250);
            console.log(`  裸单击后 window.open 调用次数: ${(await page.eval("window.__mmOpened")).length}  ← 应为 0`);

            // Ctrl + 单击：应该打开
            await page.mouse("mousePressed", box.x, box.y, { clickCount: 1, modifiers: CTRL });
            await page.mouse("mouseReleased", box.x, box.y, { clickCount: 1, modifiers: CTRL });
            await sleep(350);
            const opened = await page.eval("window.__mmOpened");
            console.log(`  Ctrl+单击后 window.open: ${JSON.stringify(opened)}`);
            const didOpen = opened.includes(box.href);
            console.log(`  结论: ${didOpen ? "✔ 打开了链接" : "✘ 没打开"}`);
            if (!didOpen) fail("Ctrl+单击没有打开链接");
        }
    }

    console.log("\n================ 各条链路现在走的是什么 ================");
    console.log("  显示      node.html → 渲染层 `txt.innerHTML = n.html` 原样写入");
    console.log("  改名      纯文本节点就地改（escapeMd 写回，无损）");
    console.log("            含格式节点跳回源列表改（零格式损失）");
    console.log("  副本/粘贴 serializeSubtree 带上 node.html（格式随行）");
    console.log("  导出      --b3-* 颜色解析成具体值、图片转 data URI、内联 KaTeX 样式");

    /* 留一张截图，方便肉眼过一遍行内格式的呈现 */
    if (!PHASE || PHASE === "b") {
        const shot = "tests/.build/inline-coverage.png";
        await page.screenshot(shot);
        console.log(`\n截图 → ${shot}`);
    }

    /* ---- 汇总：判定要能传出去（退出码） ---- */
    console.log("\n" + "=".repeat(60));
    if (problems.length) {
        console.log(`✘ ${PHASE || "b"} 阶段失败 ${problems.length} 项：`);
        for (const p of problems) console.log("   · " + p);
        process.exitCode = 1;
    } else {
        console.log(`✔ ${PHASE || "b"} 阶段全部通过`);
    }

} finally {
    await chrome.close();
    /* ⚠️ 清理放 finally —— 放 try 末尾的话，中间任何一步抛异常都会跳过清理。
       本支就崩过（在 .mm-node 上读 dataset.nodeId → getBlockDOM({id: undefined})
       → data 为 null → TypeError），一崩就在用户笔记本里留下
       「临时-行内覆盖度-时间戳」。实测本轮正是它漏了 1 个。
       删文档走 _doc-cleanup 的两步法（getPathByID → removeDoc），
       直接传 {id} 会报「Field [notebook] is required」而被静默吞掉。 */
    if (docId && !process.env.MM_KEEP) {
        const ok = await removeDoc(api, docId);
        console.log(ok ? "\n已清理临时文档" : "\n⚠️ 临时文档未能清理: " + docId);
    } else if (docId) {
        console.log("\nMM_KEEP=1，保留文档:", docId);
    }
}
