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
 *
 * ## ⚠️ 空格是**一个字面空格**，不是某个符号
 *
 * 思源的键位表里 `KEYCODELIST[32] = " "`（实测：`common.*.js` 的
 * `n.KEYCODELIST=Object.assign(M(),{…,32:" ",…})`）—— 也就是说
 * **Ctrl+空格在 `conf.json` 里存的就是 `"⌘ "`（⌘ 后跟一个空格字符）**。
 * `electron/main.js` 的 `hotKey2Electron` 也印证了这点：
 * 它最后一步正是 `.replace(" ", "Space")`。
 *
 * 直接把它拼进显示串会得到 `"Ctrl+ "` —— **一个看不见的尾随空格**，
 * 看着像坏了。（思源自己的设置页就是这么显示的，是个 wart。）
 * 所以这里换成可读标签：中文「空格」、英文「Space」。
 *
 * `spaceLabel` 是**必传**的，故意不给默认值：这是个纯工具模块，读不到插件的词表。
 * 一旦给它一个中文默认值，将来某个调用点忘了传，英文用户就会在界面上看到
 * 「空格」—— 而且不报错、不崩溃，只是看着别扭（最难查的那类 bug）。
 * 必传把它从「静默的界面 bug」变成「编译不过」。
 * 生产调用点只有一处：`index.ts` 的 `openShortcutHelp()`，传的是 `this.t("key.space")`。
 */
export function readableHotkey(hotkey: string, isMac: boolean, spaceLabel: string): string {
    if (!hotkey) return "";
    // 先换掉字面空格。macOS 分支也要换 —— 那边同样会显示成 `⌘ `（不可见）。
    const readable = hotkey.includes(" ") ? hotkey.replace(/ /g, spaceLabel) : hotkey;
    if (isMac) return readable;
    const parts: string[] = [];
    // 顺序照抄思源的规范顺序：**Ctrl → Shift → Alt → 主键**。
    // 这不是随便排的，是从思源自己的显示反推出来的（实测，Windows）：
    //   `⌥⌘P` → `Ctrl+Alt+P`     ⇒ Ctrl 在 Alt 前
    //   `⇧⌘F` → `Ctrl+Shift+F`   ⇒ Ctrl 在 Shift 前
    //   `⌥⇧P` → `Shift+Alt+P`    ⇒ **Shift 在 Alt 前**
    // 顺序排错不会崩，但会造出第二套写法 —— 用户在自己的设置页里看到的是
    // `Shift+Alt+P`，插件里写着 `Alt+Shift+P`，等于又对不上。
    //
    // 同一套顺序也在思源前端的显示换算里（`common.*.js` 的 `te()`：
    // 先 Ctrl（⌘ 或 ⌃）→ 再 Shift → 再 Alt → 最后主键），两边对得上。
    if (/[⌘⌃]/.test(readable)) parts.push("Ctrl");
    if (readable.includes("⇧")) parts.push("Shift");
    if (readable.includes("⌥")) parts.push("Alt");
    const key = readable.replace(/[⌘⌥⇧⌃]/g, "");
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
