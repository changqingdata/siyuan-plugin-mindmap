/**
 * 只读探针：CDP 能不能驱动思源的全局快捷键？
 *
 * 现象：`page.press("p", {ctrl:true})` 连内建的 `⌘P`（命令面板）都唤不起来。
 * 要区分两种可能：
 *   (a) CDP 的按键根本没送到思源的全局快捷键处理器 → 探针问题
 *   (b) 只有我们插件的 ⌥⌘D 不生效 → 插件问题
 *
 * 做法：对比三种发键方式，看哪个能唤起命令面板。
 *   ① 只发 rawKeyDown + modifiers 位（现在 page.press 的做法）
 *   ② 显式补发 ControlLeft 的按下 / 抬起
 *   ③ 用 keyDown 带 text
 *
 * 结论（实测）：① 唤不起，② ③ 唤得起。所以 `diag-commands.mjs` 里的
 * `combo()` 走方式 ②。**「快捷键没反应」先怀疑发键方式，别先怀疑插件。**
 *
 * 另一个容易踩的坑：命令面板是 **⌥⇧P**（`/general/commandPanel`），
 * 而 `⌘P`（`/general/search`）是**文档 / 块搜索** —— 拿 ⌘P 当命令面板，
 * 搜「导图」只会出文档标题，会得出「命令没显示中文」的错误结论。
 *
 * 用法：node tests/.build/probe-keydispatch.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "../kernel/_doc-cleanup.mjs";

const KERNEL = "http://127.0.0.1:6806";
const conf = JSON.parse(fs.readFileSync("D:\\常青Data/conf/conf.json", "utf8"));
const TOKEN = conf.api?.token || "";
async function api(p, payload) {
    const r = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    return r.json();
}

const d = await api("/api/filetree/createDocWithMd", { notebook: "20221230192740-wpnntiv", path: `/临时-发键-${Date.now()}`, markdown: "- 甲\n  - 甲一\n- 乙\n" });
const docId = d.data;

const chrome = await launch({ headless: true, port: 9376, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2200);

    // 装一个观察器：把页面上收到的 keydown 记下来，看看事件到底到没到
    await page.eval(`(() => {
        window.__keys = [];
        window.addEventListener('keydown', (e) => {
            window.__keys.push({ key: e.key, code: e.code, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey, trusted: e.isTrusted, target: (e.target.className || '').toString().slice(0, 30) });
        }, true);
        return true;
    })()`);

    // 真实点一下，让页面拿到焦点
    await page.eval(`document.body.click()`);
    await page.eval(`(() => { const p = document.querySelector('.protyle-wysiwyg p'); if (p) p.click(); return true; })()`);
    await sleep(500);

    const paletteOpen = `!!document.querySelector('.b3-dialog--open')`;
    const resetKeys = `window.__keys.length = 0`;

    /* ① page.press 的老办法 */
    console.log("=== ① rawKeyDown + modifiers 位 ===");
    await page.eval(resetKeys);
    await page.press("p", { ctrl: true });
    await sleep(1200);
    console.log("  收到的 keydown:", JSON.stringify(await page.eval(`window.__keys`)));
    console.log("  命令面板开了吗:", await page.eval(paletteOpen));
    if (await page.eval(paletteOpen)) {
        await page.press("Escape");
        await sleep(600);
    }

    /* ② 显式补发 ControlLeft */
    console.log("\n=== ② 显式补发 ControlLeft 按下 / 抬起 ===");
    await page.eval(resetKeys);
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 2 });
    await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "p", code: "KeyP", windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 2 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "p", code: "KeyP", windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 2 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 0 });
    await sleep(1200);
    console.log("  收到的 keydown:", JSON.stringify(await page.eval(`window.__keys`)));
    console.log("  命令面板开了吗:", await page.eval(paletteOpen));
    if (await page.eval(paletteOpen)) {
        await page.press("Escape");
        await sleep(600);
    }

    /* ③ keyDown 带 text */
    console.log("\n=== ③ keyDown 带 text ===");
    await page.eval(resetKeys);
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "p", code: "KeyP", text: "p", unmodifiedText: "p", windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 2 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "p", code: "KeyP", windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80, modifiers: 2 });
    await sleep(1200);
    console.log("  收到的 keydown:", JSON.stringify(await page.eval(`window.__keys`)));
    console.log("  命令面板开了吗:", await page.eval(paletteOpen));

    console.log("\n=== 对照：插件自己的 Ctrl+Z 能被 page.press 驱动吗 ===");
    await page.eval(resetKeys);
    await page.press("z", { ctrl: true });
    await sleep(600);
    console.log("  mmHistory:", await page.eval(`document.documentElement.dataset.mmHistory || '(没接住)'`));
} finally {
    await chrome.close();
    await removeDoc(api, docId);
}
