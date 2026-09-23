/**
 * 只读探针：核实插件命令在「命令面板」里显示的是什么，以及**默认快捷键的真实形态**。
 *
 * 起因一：`i18n/zh_CN.json` 里 `command` 是**嵌套**的（`command.migrateLegacy`），
 * 而思源 frontend 里解析命令显示名的那句是：
 *
 *     a.langText || r.i18n[a.langKey] || a.langKey
 *
 * 是**扁平查表**。嵌套的话 `i18n["migrateLegacy"]` 就是 undefined，
 * 于是命令面板里会直接显示原始 langKey（`migrateLegacy` / `toggleMindMap`）。
 *
 * 起因二：设置面板的快捷键速查里写着 `⌥⌘D` / `⌥⌘V` —— 那是 **macOS 的修饰键字形**。
 * 插件确实声明了 `hotkey: "⌥⌘D"`，但「声明成什么」和「这台机器上按什么」是两回事：
 * 思源会按平台换算。所以这个探针把 `os` / `platform` / 命令的 `hotkey` /
 * 思源 keymap 里实际生效的那条一起 dump 出来对账，**先量再改**。
 *
 * 这个探针只读不写。
 *
 * 用法：node tests/kernel/probe-i18n-command.mjs
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

// 建一个只读用的临时文档（探针要一个已加载插件的页面），跑完删掉
const mk = await api("/api/filetree/createDocWithMd", {
    notebook: "20221230192740-wpnntiv",
    path: `/临时-命令名-${Date.now()}`,
    markdown: "- 只读探针\n  - 子项\n",
});
const docId = mk.data;

const chrome = await launch({ headless: true, width: 1200, height: 800 });
const page = await chrome.newPage("about:blank");

try {
    await page.send("Page.navigate", { url: `${KERNEL}/stage/build/desktop/?id=${docId}` });
    await sleep(4000);
    await page.waitFor(`!!(window.siyuan && window.siyuan.ws && window.siyuan.ws.app)`, {
        timeout: 30000,
        label: "siyuan 前端就绪",
    });

    const out = await page.eval(`(() => {
        const p = ((window.siyuan?.ws?.app?.plugins) || []).find((x) => x.name === 'siyuan-plugin-mindmap');
        if (!p) return { err: 'plugin not loaded' };
        const i18n = p.i18n || {};
        const km = (window.siyuan && window.siyuan.config && window.siyuan.config.keymap) || {};
        const custom = km.custom || {};
        return {
            // ① 平台：插件说明文字里写的是 \`⌥⌘\`（macOS 字形），得先知道这台机器是什么系统
            os: window.siyuan?.config?.system?.os,
            platform: navigator.platform,
            // ② 命令的**原始 hotkey 字段**（插件声明的那份）
            commands: (p.commands || []).map((c) => ({
                langKey: c.langKey,
                langText: c.langText,
                // 思源的解析式：langText || i18n[langKey] || langKey
                resolved: c.langText || i18n[c.langKey] || c.langKey,
                flatHit: Object.prototype.hasOwnProperty.call(i18n, c.langKey),
                // ★ 插件声明的默认键 vs 用户在「设置 → 快捷键」里改过的键
                hotkey: c.hotkey,
                customHotkey: c.customHotkey,
                // ★ 思源 keymap 里实际生效的那条（用户在设置里改过就在这里）
                inKeymap: custom['plugin' + '.' + c.langKey] || custom[c.langKey] || null,
            })),
            // ③ 顺带看看 keymap 里跟我们相关的所有条目（确认默认键有没有被别的插件占）
            keymapHits: Object.entries(custom).filter(([, v]) => typeof v === 'string' && /⌥⌘|⌘⌥/.test(v)),
            i18nKeyCount: Object.keys(i18n).length,
        };
    })()`);

    console.log(JSON.stringify(out, null, 2));
} finally {
    await chrome.close();
    const info = await api("/api/filetree/getPathByID", { id: docId }).catch(() => null);
    if (info?.data?.notebook) {
        await api("/api/filetree/removeDoc", { notebook: info.data.notebook, path: info.data.path }).catch(() => {});
    }
}
