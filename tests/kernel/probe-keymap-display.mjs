/**
 * 只读探针：思源**自己的**「设置 → 快捷键」在 Windows 上把键位显示成什么样？
 *
 * 起因：插件的快捷键速查里当时写死了 `⌥⌘D` / `⌥⌘V`（macOS 字形），而本机是 Windows。
 * 改文案之前得先回答一个问题：
 *
 *   思源自己的快捷键设置页，是**原样显示** `⌘Z`，还是**换算成** `Ctrl+Z`？
 *
 * 如果思源自己也显示 `⌘Z`，那插件的写法与思源**一致** —— 顶多是「思源的约定
 * 与操作系统约定不同」，跟插件没关系；如果思源显示 `Ctrl+Z`，那插件就是在
 * 用一套用户在自己设置页里看不到的符号，属于真错。
 *
 * 为什么不能靠猜：SiYuan 的 `conf.json` 里存的确实是 `⌘Z`（已核对），
 * 但「存什么」和「显示什么」是两层，中间隔着一个前端换算函数。
 *
 * ## 结论（本探针已跑过，留档）
 *
 * 思源**会换算** —— Windows 上显示 `Ctrl+Z`。所以插件照搬 macOS 字形是真错。
 * 后续处理：速查改成走 `utils/hotkey.ts` 的 `readableHotkey()` 按平台换算，
 * 默认键位也从 `⌥⌘D` / `⌥⌘V` 换成了 `Ctrl+空格` / `Alt+空格`。
 * 本探针保留，用于以后再验证「思源的显示约定有没有变」。
 *
 * 用法：node tests/kernel/probe-keymap-display.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
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

const mk = await api("/api/filetree/createDocWithMd", {
    notebook: "20221230192740-wpnntiv",
    path: `/临时-键位显示-${Date.now()}`,
    markdown: "- 只读探针\n",
});
const docId = mk.data;

const chrome = await launch({ headless: true, width: 1400, height: 1000 });
const page = await chrome.newPage("about:blank");

try {
    await page.send("Page.navigate", { url: `${KERNEL}/stage/build/desktop/?id=${docId}` });
    await sleep(4000);
    await page.waitFor(`!!(window.siyuan && window.siyuan.ws && window.siyuan.ws.app)`, { timeout: 30000, label: "前端就绪" });

    // ① 先看看能不能直接拿到思源内部的换算函数（有的话最省事，但名字可能被压缩）
    const util = await page.eval(`(() => {
        const cands = Object.keys(window).filter((k) => /hotkey|keymap/i.test(k));
        return { globalCands: cands, hasIsMac: typeof window.isMac };
    })()`);
    console.log("[0] 全局可用的换算函数候选：", JSON.stringify(util));

    // ② 打开思源设置（主菜单 → 设置）
    const opened = await page.eval(`(() => {
        // 顶栏左上角的工作空间按钮就是主菜单入口
        const ws = document.querySelector('#barWorkspace');
        if (ws) { ws.click(); return 'barWorkspace'; }
        const alt = [...document.querySelectorAll('.toolbar .b3-tooltips')].find((e) => (e.getAttribute('aria-label') || '').includes('设置'));
        if (alt) { alt.click(); return 'toolbar-gear'; }
        return 'not-found';
    })()`);
    await sleep(900);
    console.log("[1] 打开主菜单：", opened);

    const menuItems = await page.eval(`[...document.querySelectorAll('.b3-menu .b3-menu__item')].map((e) => (e.textContent || '').trim()).filter(Boolean)`);
    console.log("[2] 菜单项：", JSON.stringify(menuItems));

    const clicked = await page.eval(`(() => {
        // ⚠️ 菜单项的 textContent 里**连着键位**（实际是「设置Alt+P」），
        // 所以不能用严格相等去匹配「设置」—— 第一版就是这么卡住的。
        // （这段是模板字符串，注释里不能出现反引号，会截断字符串。）
        const it = [...document.querySelectorAll('.b3-menu .b3-menu__item')].find((x) => (x.textContent || '').trim().startsWith('设置'));
        if (!it) return 'no-设置';
        const r = it.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        it.dispatchEvent(new MouseEvent('mousedown', o));
        it.dispatchEvent(new MouseEvent('mouseup', o));
        it.click();
        return 'clicked';
    })()`);
    await sleep(2000);
    console.log("[3] 点「设置」：", clicked);

    // ③ 切到「快捷键」页。
    // 页签的容器类名不稳（`.b3-tab-bar` 在本版没匹配上），所以直接在弹层里
    // 按文本找 —— 找不到也不算失败：设置页会记住上次停留的页，可能本来就在快捷键页。
    const tabClicked = await page.eval(`(() => {
        const dialog = document.querySelector('.b3-dialog--open');
        if (!dialog) return 'no-dialog';
        const it = [...dialog.querySelectorAll('.b3-list-item')].find((x) => (x.textContent || '').trim() === '快捷键');
        if (!it) return 'no-快捷键';
        it.click();
        return 'clicked';
    })()`);
    await sleep(1600);
    console.log("[5] 切到「快捷键」：", tabClicked);

    // ④ ★ 关键：读「功能名 → 键位显示」。滚一滚，让懒加载的行也出来。
    await page.eval(`(() => {
        const d = document.querySelector('.b3-dialog--open .b3-tab-bar ~ * .fn__flex-1') || document.querySelector('.b3-dialog--open .b3-list--background');
        if (d) d.scrollTop = 0;
        return true;
    })()`);
    const rows = await page.eval(`(() => {
        const dialog = document.querySelector('.b3-dialog--open');
        if (!dialog) return [{ err: 'no dialog' }];
        const out = [];
        for (const row of dialog.querySelectorAll('.b3-list-item, .b3-label, .fn__flex')) {
            const txt = (row.textContent || '').trim();
            if (!txt || txt.length > 60) continue;
            if (!/[⌘⌥⇧⌃]|Ctrl|Alt|Shift/.test(txt)) continue;
            out.push(txt);
        }
        return [...new Set(out)].slice(0, 40);
    })()`);
    console.log("\n[6] ★ 快捷键页里带修饰键的行（原样显示 / 换算，看这里）：");
    for (const r of rows) console.log("    " + r);

    // ⑤ 再确认一次：我们自己那两条命令在这页里显示成什么
    const ours = await page.eval(`(() => {
        const dialog = document.querySelector('.b3-dialog--open');
        if (!dialog) return [];
        return [...dialog.querySelectorAll('.b3-list-item, .fn__flex')]
            .map((e) => (e.textContent || '').trim())
            .filter((s) => s && s.length < 80 && /导图/.test(s));
    })()`);
    console.log("\n[7] ★ 与「导图」相关的行（我们那两条命令）：");
    for (const r of ours) console.log("    " + r);
    if (!ours.length) console.log("    （没找到：设置页可能停在上次那一页，或行在懒加载容器里还没渲染 —— 不影响 [2]/[6] 的结论）");
} finally {
    await chrome.close();
    const info = await api("/api/filetree/getPathByID", { id: docId }).catch(() => null);
    if (info?.data?.notebook) {
        await api("/api/filetree/removeDoc", { notebook: info.data.notebook, path: info.data.path }).catch(() => {});
    }
}
