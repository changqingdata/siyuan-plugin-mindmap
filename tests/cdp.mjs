/**
 * 极简 CDP 客户端 + Chrome 启动器。
 *
 * 为什么不用 puppeteer / playwright：
 * 项目里只想跑「连真思源、点真按钮」的验收，装一整套浏览器框架太重，
 * 而 Node 22 自带全局 WebSocket，直连 DevTools 协议只要一百来行。
 *
 * 用法：
 *   const chrome = await launch({ port, headless });
 *   const page = await chrome.newPage("http://127.0.0.1:6806/...");
 *   await page.eval("document.title");
 *   await page.click(selector);
 *   await page.screenshot("out.png");
 *   await chrome.close();
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ------------------------------------------------------------------ 找 Chrome */

const CANDIDATES = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
];

export function findChrome() {
    for (const p of CANDIDATES) {
        if (p && fs.existsSync(p)) return p;
    }
    throw new Error("找不到 Chrome / Edge，请设置 CHROME_PATH 环境变量");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ CDP 连接 */

class Conn {
    constructor(ws) {
        this.ws = ws;
        this.seq = 0;
        this.pending = new Map();
        this.listeners = new Map();
        ws.addEventListener("message", (ev) => {
            let msg;
            try {
                msg = JSON.parse(ev.data);
            } catch {
                return;
            }
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
                else resolve(msg.result);
                return;
            }
            if (msg.method) {
                for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params, msg.sessionId);
            }
        });
    }

    send(method, params = {}, sessionId) {
        const id = ++this.seq;
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        this.ws.send(JSON.stringify(payload));
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            setTimeout(() => {
                if (this.pending.delete(id)) reject(new Error(`CDP 超时: ${method}`));
            }, 30000);
        });
    }

    on(method, fn) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(fn);
    }

    /** 等一个事件，超时抛错 */
    once(method, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`等待事件超时: ${method}`)), timeout);
            const fn = (params) => {
                clearTimeout(t);
                const arr = this.listeners.get(method);
                arr.splice(arr.indexOf(fn), 1);
                resolve(params);
            };
            this.on(method, fn);
        });
    }
}

/* ------------------------------------------------------------------ 页面封装 */

const KEY_CODES = {
    Tab: 9,
    Enter: 13,
    Escape: 27,
    Delete: 46,
    Backspace: 8,
    ArrowUp: 38,
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    Home: 36,
    End: 35,
    F2: 113,
    Space: 32,
    KeyA: 65,
};

const KEY_TEXT = { Tab: "\t", Enter: "\r", Space: " " };

class Page {
    constructor(conn, sessionId) {
        this.conn = conn;
        this.sid = sessionId;
    }

    send(method, params) {
        return this.conn.send(method, params, this.sid);
    }

    /** 求值；awaitPromise 时表达式应返回 Promise */
    async eval(expression, awaitPromise = false) {
        const r = await this.send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise,
            userGesture: true,
            allowUnsafeEvalBlockedByCSP: true,
        });
        if (r.exceptionDetails) {
            const d = r.exceptionDetails;
            throw new Error(`页面求值失败: ${d.exception?.description ?? d.text}`);
        }
        return r.result.value;
    }

    /** 轮询直到表达式为真，返回它的值 */
    async waitFor(expression, { timeout = 20000, interval = 150, label = expression } = {}) {
        const deadline = Date.now() + timeout;
        let last;
        while (Date.now() < deadline) {
            try {
                last = await this.eval(expression);
                if (last) return last;
            } catch (err) {
                last = `(${err.message})`;
            }
            await sleep(interval);
        }
        throw new Error(`等待超时: ${label}\n最后结果: ${JSON.stringify(last)}`);
    }

    /* --------------------------------------------------------- 输入事件 */

    /** 元素中心点（CSS 像素，相对视口） */
    async center(selector) {
        const r = await this.eval(`(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
        })()`);
        if (!r) throw new Error(`找不到元素: ${selector}`);
        return r;
    }

    async mouse(type, x, y, extra = {}) {
        await this.send("Input.dispatchMouseEvent", {
            type,
            x: Math.round(x),
            y: Math.round(y),
            button: extra.button ?? "left",
            buttons: extra.buttons ?? (type === "mouseReleased" ? 0 : 1),
            clickCount: extra.clickCount ?? 1,
            modifiers: extra.modifiers ?? 0,
        });
    }

    async click(selector, { delay = 0 } = {}) {
        const { x, y } = await this.center(selector);
        await this.mouse("mouseMoved", x, y, { buttons: 0 });
        await this.mouse("mousePressed", x, y);
        await this.mouse("mouseReleased", x, y);
        if (delay) await sleep(delay);
        return { x, y };
    }

    /** 双击：两次 press/release，clickCount 递增，浏览器才会派发 dblclick */
    async dblclick(selector) {
        const { x, y } = await this.center(selector);
        await this.mouse("mouseMoved", x, y, { buttons: 0 });
        for (const n of [1, 2]) {
            await this.mouse("mousePressed", x, y, { clickCount: n });
            await this.mouse("mouseReleased", x, y, { clickCount: n });
        }
        await sleep(120);
        return { x, y };
    }

    async moveMouse(x, y) {
        await this.mouse("mouseMoved", x, y, { buttons: 0 });
    }

    /**
     * 按键。用 dispatchKeyEvent 而不是合成 KeyboardEvent ——
     * 合成事件的 isTrusted 是 false，而且不会触发浏览器的默认行为
     * （比如 Tab 移动焦点、输入框真正插入字符），
     * 我们要验的就是「真实按键会不会被截胡」，所以必须走真通道。
     */
    async press(key, { ctrl = false, shift = false, alt = false, meta = false } = {}) {
        const mods = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
        const code = KEY_CODES[key] ?? key.charCodeAt(0);
        const text = !ctrl && !alt && !meta ? KEY_TEXT[key] : undefined;
        const base = { key, code: KEY_CODES[key] ? key : `Key${key.toUpperCase()}`, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: mods };
        await this.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, text });
        await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
        await sleep(60);
    }

    async type(text) {
        for (const ch of text) {
            await this.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch, unmodifiedText: ch });
            await this.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
        }
        await sleep(60);
    }

    /* --------------------------------------------------------- 截图 */

    async screenshot(file, { fullPage = false } = {}) {
        let clip;
        if (fullPage) {
            const m = await this.send("Page.getLayoutMetrics");
            const cs = m.cssContentSize ?? m.contentSize;
            clip = { x: 0, y: 0, width: cs.width, height: cs.height, scale: 1 };
        }
        const shot = await this.send("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: !!fullPage,
            ...(clip ? { clip } : {}),
        });
        fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
        return file;
    }

    /** 控制台日志（用于抓插件报错） */
    async consoleErrors() {
        return this.eval("window.__mmErrors || []");
    }
}

/* ------------------------------------------------------------------ 启动器 */

export async function launch({ port = 9333, headless = true, gpu = false, width = 1600, height = 1000, dpr = 1 } = {}) {
    const exe = findChrome();
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mm-cdp-"));
    const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`,
        `--force-device-scale-factor=${dpr}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-features=Translate,MediaRouter",
        "--hide-scrollbars",
    ];
    if (headless) args.unshift("--headless=new");
    if (gpu) args.push("--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist");
    else args.push("--disable-gpu");
    args.push("about:blank");

    const proc = spawn(exe, args, { stdio: "ignore", windowsHide: true });

    // 等 DevTools 端口起来
    let version = null;
    for (let i = 0; i < 120; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/version`);
            version = await res.json();
            break;
        } catch {
            await sleep(120);
        }
    }
    if (!version) {
        proc.kill();
        throw new Error("Chrome DevTools 端口未就绪");
    }

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", reject, { once: true });
    });
    const conn = new Conn(ws);

    const launchInfo = { proc, conn, ws, profile, exe, version, port };

    launchInfo.newPage = async (url) => {
        const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
        const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
        const page = new Page(conn, sessionId);
        await page.send("Page.enable");
        await page.send("Runtime.enable");
        await page.send("DOM.enable");
        // 收集页面报错，方便定位插件异常
        await page.send("Log.enable").catch(() => {});
        if (url) {
            const loaded = conn.once("Page.loadEventFired").catch(() => null);
            await page.send("Page.navigate", { url });
            await loaded;
        }
        return page;
    };

    launchInfo.close = async () => {
        try {
            ws.close();
        } catch {
            /* ignore */
        }
        try {
            proc.kill();
        } catch {
            /* ignore */
        }
        await sleep(400);
        try {
            fs.rmSync(profile, { recursive: true, force: true });
        } catch {
            /* 目录被占用就留给系统清 */
        }
    };

    return launchInfo;
}

export { sleep };
