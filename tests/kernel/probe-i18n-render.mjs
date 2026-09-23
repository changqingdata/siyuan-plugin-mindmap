/**
 * 定向探针：界面文案**真的来自词表**吗？
 *
 * 为什么必须做「能红对照」：中文环境下词表值与代码里的 fallback **同值**，
 * 「界面显示中文」既可能是 i18n 生效、也可能只是走了 fallback —— 两者外观完全一样。
 * 所以要把词表里的值临时改成「只可能来自词表」的串（带 `【i18n探针】` 标记），
 * 部署后再看界面跟不跟着变。跟了，才证明取值路径是通的。
 *
 * 用法：
 *   1. 临时改 **真源** `src/i18n/zh_CN.json` 里若干键的值，加 `【i18n探针】` 标记
 *      （⚠️ 不是根目录的 `i18n/` —— 那是构建产物，改了会被下一次 build 覆盖）
 *   2. npm run deploy && node tests/kernel/probe-i18n-render.mjs
 *   3. 改回真源并重新部署
 *
 * 覆盖的**四条注入通路**（按注入点枚举，不按「实现一样」合并）：
 *   ① 工具条 tip —— renderer 的 `t()`，读 `cb.i18n`
 *   ② 布局分段控件 / ③ 过滤 chip —— 动态键 `layout.*` / `filter.*`
 *   ④ 全页面 title / aria-label —— index.ts 的 `t()`，读 `this.i18n`
 *   ⑤ 设置面板的快捷键弹层 —— 常量表 map + join + `showMessage`
 * ⑤ 是后加的：它虽然也读 `this.i18n`，但**渲染路径完全不同**，
 * 键在词表里却没人读时，①~④ 全都照不到。
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";

const api = async (p, b) =>
    (
        await fetch(KERNEL + p, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
            body: JSON.stringify(b ?? {}),
        })
    ).json();

const MARK = "【i18n探针】";
const MD = ["- 探针根", "  - 甲", "    - 甲.1", "  - 乙", ""].join("\n");
const doc = (await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-i18n-${Date.now()}`, markdown: MD })).data;
const list = (await api("/api/block/getChildBlocks", { id: doc })).data.find((k) => k.type === "l").id;
await api("/api/attr/setBlockAttrs", { id: list, attrs: { "custom-mindmap": "logic" } });
console.log(`文档 ${doc}\n`);

const ROOT = `document.querySelector('.mm-root:not(.mm-root--dialog):not(.mm-root--side)')`;

const chrome = await launch({ headless: true, width: 1500, height: 1000 });
const page = await chrome.newPage("about:blank");

try {
    await page.send("Page.navigate", { url: `${KERNEL}/stage/build/desktop/?id=${doc}` });
    await sleep(3600);
    await page.waitFor(`${ROOT} !== null`, { timeout: 30000, label: "挂载" });
    await sleep(600);

    // ① 工具条：tip 走 renderer 的 t()（`tip.foldAll` / `tip.search` / `tip.exportImage` …）
    const toolbar = await page.eval(`[...${ROOT}.querySelectorAll('.mm-toolbar button')].map((b) => (b.dataset.mmTip || b.textContent || '').trim()).filter(Boolean)`);
    console.log("[1] 工具条按钮文案");
    for (const t of toolbar) console.log(`    ${t}`);

    // ② 布局分段控件：走 `layout.<值>`（动态键）
    const segs = await page.eval(`[...${ROOT}.querySelectorAll('.mm-seg button')].map((b) => b.textContent.trim())`);
    console.log("\n[2] 布局分段控件");
    for (const t of segs) console.log(`    ${t}`);

    // ③ 过滤 chip：走 `filter.<值>`（动态键）
    const chips = await page.eval(`[...${ROOT}.querySelectorAll('.mm-filters button')].map((b) => b.textContent.trim())`);
    console.log("\n[3] 过滤 chip");
    for (const t of chips) console.log(`    ${t}`);

    // ④ 全页面扫 title / aria-label：抓挂在图标上的文案。
    // 顶栏图标走的是 index.ts 的 `t("pluginName")` —— 与视图层是**两条不同的注入通路**
    //（`this.i18n` vs `cb.i18n`），必须分别验证，不能因为「反正实现一样」就跳过。
    const titled = await page.eval(`[...document.querySelectorAll('[title], [aria-label]')].map((e) => e.getAttribute('title') || e.getAttribute('aria-label') || '').filter((s) => s.includes('${MARK}'))`);
    console.log("\n[4] 页面上带标记的 title / aria-label");
    for (const t of titled) console.log(`    ${t}`);

    // ⑤ 设置面板里的快捷键速查：`SHORTCUT_HELP` 常量表 → `shortcutHelp()` → `showMessage` 弹层。
    // 这是**第三条渲染通路** —— 既不是工具条（renderer 的 `t()`），也不是顶栏图标
    //（index.ts 的 `t()` 挂在 DOM 属性上）。它经的是「模块级常量表 map + join + 弹层」，
    // 取值一旦没接上，静态校验（键都在词表里）和上面三条通路**都照不到** ——
    // 键还在词表里、只是没人读它，正是「绿得毫无意义」的那一类。
    await page.eval(`(() => {
        const el = document.querySelector('.toolbar [id^="plugin_siyuan-plugin-mindmap"]');
        if (el) el.click();
        return !!el;
    })()`);
    await sleep(900);
    await page.eval(`(() => {
        const it = [...document.querySelectorAll('.b3-menu .b3-menu__item')].find((x) => (x.textContent || '').trim().startsWith('设置'));
        if (!it) return false;
        const r = it.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        it.dispatchEvent(new MouseEvent('mousedown', o));
        it.dispatchEvent(new MouseEvent('mouseup', o));
        it.click();
        return true;
    })()`);
    await sleep(1800);
    const helpBtn = await page.eval(`(() => {
        const row = [...document.querySelectorAll('.b3-dialog--open .config-name')].find((e) => (e.textContent || '').includes('查看快捷键'));
        if (!row) return 'no-row';
        const item = row.closest('.b3-label') || row.parentElement;
        const b = item && item.querySelector('button');
        if (!b) return 'no-button';
        b.click();
        return 'clicked';
    })()`);
    await sleep(1000);
    const helpText = await page.eval(`[...document.querySelectorAll('.b3-snackbar__content')].map((e) => e.textContent || '').join('')`);
    const helpLines = helpText.split("\n").filter((s) => s.trim());
    console.log(`\n[5] 设置面板 →「查看快捷键」弹层（按钮 ${helpBtn}｜${helpLines.length} 行）`);
    for (const t of helpLines.slice(0, 3)) console.log(`    ${t}`);
    const helpHit = (helpText.match(new RegExp(MARK, "g")) || []).length;
    console.log(`    带「${MARK}」的行 ${helpHit} 处`);
    // 空行分隔还在吗？`SHORTCUT_HELP` 里有一行 `["", ""]` 用来隔开「图内」与「全局」两组，
    // 取值时走的是 `zh ? t(key, zh) : ""` 这条分支。它一旦被丢掉，两组会粘在一起 ——
    // 排版塌了但不报错，静态校验也照不到（键、值、行数全都对）。
    const gapKept = /\n\s*\n/.test(helpText);
    console.log(`    空行分隔 ${gapKept ? "保留" : "丢失"}`);

    const all = [...toolbar, ...segs, ...chips, ...titled];
    const hit = all.filter((t) => t.includes(MARK));
    console.log(`\n带「${MARK}」标记的文案 ${hit.length} / ${all.length} 条`);
    for (const t of hit) console.log(`    ✔ ${t}`);
    if (hit.length === 0) {
        console.log(`\n✘ 一条都没命中 —— 说明界面没读词表（i18n 取值路径没接上）`);
        process.exitCode = 1;
    } else if (helpHit === 0) {
        console.log(`\n✘ 工具条那条通路通了，但快捷键弹层一条都没命中 —— 它的取值路径是独立的，得单独接`);
        process.exitCode = 1;
    } else if (!gapKept) {
        console.log(`\n✘ 快捷键弹层读到了词表，但空行分隔丢了 —— 「图内」与「全局」两组会粘在一起`);
        process.exitCode = 1;
    } else {
        console.log(`\n✔ 词表值出现在界面上，i18n 取值路径是通的（含快捷键弹层 ${helpHit} 处，空行分隔保留）`);
    }
} finally {
    await chrome.close();
    await removeDoc(api, doc);
}
