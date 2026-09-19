#!/usr/bin/env node
/**
 * 验证思源是否已经加载了本插件。
 *
 * 原理：调用内核的 /api/petal/loadPetals，它返回的是**当前已加载**的 petal 列表
 * （每个条目都带插件源码），因此能直接确认插件有没有被思源认到。
 *
 * 用法：
 *   node scripts/verify-install.mjs
 *   node scripts/verify-install.mjs --port 6806
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const argv = process.argv.slice(2);
const portArg = (() => {
    const i = argv.indexOf("--port");
    return i >= 0 ? Number(argv[i + 1]) : null;
})();

/* ---------------------------------------------------------------- 路径 */

function detectWorkspace() {
    const cfg = path.join(os.homedir(), ".config", "siyuan", "workspace.json");
    if (!fs.existsSync(cfg)) return null;
    try {
        const list = JSON.parse(fs.readFileSync(cfg, "utf8"));
        if (Array.isArray(list) && list.length > 0) return list[0];
        if (typeof list === "string") return list;
    } catch {
        /* 忽略 */
    }
    return null;
}

/** 从 netstat 里找内核进程监听的本地端口 */
function detectPort() {
    try {
        const tl = execSync('tasklist /FI "IMAGENAME eq SiYuan-Kernel.exe" /FO CSV /NH', { encoding: "utf8" });
        const m = tl.match(/"SiYuan-Kernel\.exe","(\d+)"/);
        if (!m) return null;
        const pid = m[1];

        const ns = execSync("netstat -ano", { encoding: "utf8" });
        const ports = [];
        for (const line of ns.split(/\r?\n/)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 5 || parts[0] !== "TCP") continue;
            if (parts[parts.length - 2] !== "LISTENING") continue;
            if (parts[parts.length - 1] !== pid) continue;
            if (!parts[1].startsWith("127.0.0.1:")) continue;
            ports.push(Number(parts[1].split(":").pop()));
        }
        if (ports.includes(6806)) return 6806;
        return ports[0] ?? null;
    } catch {
        return null;
    }
}

const workspace = detectWorkspace();
if (!workspace) {
    console.error("找不到思源工作空间，无法验证。");
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
const pluginDir = path.join(workspace, "data", "plugins", manifest.name);

console.log("工作空间 :", workspace);
console.log("插件目录 :", pluginDir);
console.log("目录存在 :", fs.existsSync(pluginDir) ? "是" : "否 —— 请先跑 npm run deploy");
console.log("");

const port = portArg ?? detectPort();
if (!port) {
    console.error("没找到思源内核端口，说明思源可能没在运行。");
    console.error("启动思源后再跑一次，或用 --port 指定端口。");
    process.exit(1);
}
console.log("内核端口 :", port);

const confPath = path.join(workspace, "conf", "conf.json");
const token = JSON.parse(fs.readFileSync(confPath, "utf8")).api?.token;
if (!token) {
    console.error("读不到 API token（conf/conf.json 的 api.token）。");
    process.exit(1);
}

/* ---------------------------------------------------------------- 查询 */

const res = await fetch(`http://127.0.0.1:${port}/api/petal/loadPetals`, {
    method: "POST",
    headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ frontend: "desktop" }),
}).then((r) => r.json());

if (res.code !== 0) {
    console.error("内核返回错误：", res.msg);
    process.exit(1);
}

const petals = Array.isArray(res.data) ? res.data : [];
const mine = petals.find((p) => p.name === manifest.name);

console.log("已加载插件数 :", petals.length);
console.log("");

if (mine) {
    console.log("✓ 思源已加载本插件");
    console.log("  name    :", mine.name);
    console.log("  version :", mine.version);
    console.log("  enabled :", mine.enabled);
    console.log("  代码长度:", (mine.js || "").length, "字节");
    console.log("");
    console.log("可以开始测试了：在任意列表块上点块标 → 插件 → 大纲导图。");
} else {
    console.log("✗ 思源还没加载本插件。");
    console.log("");
    console.log("可能的原因与处理：");
    console.log("  1. 思源是在部署之前启动的 —— 重启思源，或按 Ctrl+Shift+R 重载界面。");
    console.log("  2. 插件没被启用 —— 打开 设置 → 集市 → 已下载，找到「大纲导图」打开开关。");
    console.log("  3. plugin.json 有问题 —— 检查它的 name 是否等于目录名。");
}
