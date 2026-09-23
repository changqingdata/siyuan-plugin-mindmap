/**
 * 思源键位表示法 → 当前平台的可读写法。
 *
 * 背景：思源的 `conf.json` 里存的是 **macOS 字形**（`⌘Z` / `⌥⌘P`），
 * 不管在什么系统上都是这套写法；换算发生在**展示层**。
 *
 * 这不是猜的 —— 实测：本机是 Windows，工作空间菜单里「魔法排版」显示为
 * `Ctrl+Alt+P`，而它在 keymap 里存的值正是 `⌥⌘P`；同一菜单里「设置」显示
 * `Alt+P`，对应 keymap 值 `⌥P`。
 *
 * 插件声明的默认键位（`hotkey: "⌥⌘D"`）用的也是思源这套表示法，所以
 * **说明文字必须过同一个换算** —— 否则 Windows / Linux 用户会看到一套
 * 在自己的「设置 → 快捷键」里根本找不到的符号。
 */

/**
 * 把思源键位串换算成平台可读写法。
 *
 * `isMac` 作为参数传入（而不是在函数里读全局），是为了**能写确定性单测** ——
 * 读全局的话测试就只能在某一台机器上跑，另一个平台的分支永远验不到。
 */
export function readableHotkey(hotkey: string, isMac: boolean): string {
    if (!hotkey) return "";
    if (isMac) return hotkey;
    const parts: string[] = [];
    // 顺序照抄思源的规范顺序：**Ctrl → Shift → Alt → 主键**。
    // 这不是随便排的，是从思源自己的显示反推出来的（实测，Windows）：
    //   `⌥⌘P` → `Ctrl+Alt+P`     ⇒ Ctrl 在 Alt 前
    //   `⇧⌘F` → `Ctrl+Shift+F`   ⇒ Ctrl 在 Shift 前
    //   `⌥⇧P` → `Shift+Alt+P`    ⇒ **Shift 在 Alt 前**
    // 顺序排错不会崩，但会造出第二套写法 —— 用户在自己的设置页里看到的是
    // `Shift+Alt+P`，插件里写着 `Alt+Shift+P`，等于又对不上。
    if (/[⌘⌃]/.test(hotkey)) parts.push("Ctrl");
    if (hotkey.includes("⇧")) parts.push("Shift");
    if (hotkey.includes("⌥")) parts.push("Alt");
    const key = hotkey.replace(/[⌘⌥⇧⌃]/g, "");
    if (key) parts.push(key);
    return parts.join("+");
}

/** 当前平台是不是 macOS。优先用思源自己的 `system.os`，退回 `navigator.platform`。 */
export function isMacPlatform(): boolean {
    const os = (globalThis as { siyuan?: { config?: { system?: { os?: string } } } }).siyuan?.config?.system?.os;
    if (typeof os === "string") return os === "darwin";
    const platform = (globalThis as { navigator?: { platform?: string } }).navigator?.platform;
    return /mac/i.test(platform || "");
}
