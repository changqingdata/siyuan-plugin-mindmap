#!/usr/bin/env node
/**
 * 把构建产物部署到思源工作空间的插件目录，方便本地调试。
 *
 * 用法：
 *   node scripts/deploy.mjs                        # 构建 + 部署（自动探测工作空间）
 *   node scripts/deploy.mjs --no-build             # 跳过构建，只同步现有产物
 *   node scripts/deploy.mjs --workspace "D:\常青Data"
 *   node scripts/deploy.mjs --list                 # 只打印路径，不做任何事
 *
 * 工作空间探测顺序：
 *   1. --workspace 参数
 *   2. 环境变量 SIYUAN_WORKSPACE
 *   3. ~/.config/siyuan/workspace.json 里记录的工作空间
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/**
 * 部署目标是正在运行的思源工作空间，文件随时可能被内核/前端进程占住，
 * Windows 上就表现为 EPERM / EBUSY。这类冲突基本都是瞬时的，重试即可。
 */
function retry(fn, tries = 6) {
    for (let i = 1; ; i++) {
        try {
            return fn();
        } catch (err) {
            if (i >= tries || !["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(err.code)) throw err;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80 * i);
        }
    }
}

/* ---------------------------------------------------------------- 参数 */

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
};

/* ------------------------------------------------------------ 工作空间 */

function detectWorkspace() {
    const explicit = valueOf("--workspace") ?? process.env.SIYUAN_WORKSPACE;
    if (explicit) return explicit;

    const cfg = path.join(os.homedir(), ".config", "siyuan", "workspace.json");
    if (fs.existsSync(cfg)) {
        try {
            const list = JSON.parse(fs.readFileSync(cfg, "utf8"));
            if (Array.isArray(list) && list.length > 0) return list[0];
            if (typeof list === "string") return list;
        } catch {
            /* 落到下面的报错 */
        }
    }
    return null;
}

const workspace = detectWorkspace();
if (!workspace) {
    console.error("无法确定思源工作空间。请显式指定，例如：");
    console.error('  node scripts/deploy.mjs --workspace "D:\\常青Data"');
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
/** 目录名必须与 plugin.json 的 name 一致，否则思源加载不到 */
const target = path.join(workspace, "data", "plugins", manifest.name);

if (has("--list")) {
    console.log("工作空间 :", workspace);
    console.log("插件目录 :", target);
    process.exit(0);
}

/* ---------------------------------------------------------------- 构建 */

if (!has("--no-build")) {
    const r = spawnSync(process.execPath, [path.join(here, "build.mjs")], { stdio: "inherit", cwd: root });
    if (r.status !== 0) process.exit(r.status ?? 1);
}

/* ---------------------------------------------------------------- 部署 */

/** 思源运行时只需要这些，源码 / node_modules / package.zip 不复制 */
const FILES = [
    "index.js",
    "index.css",
    "plugin.json",
    "icon.png",
    "preview.png",
    "README.md",
    "README_zh_CN.md",
    "LICENSE",
];
const DIRS = ["i18n"];

fs.mkdirSync(target, { recursive: true });

const copied = [];
for (const f of FILES) {
    const src = path.join(root, f);
    if (!fs.existsSync(src)) continue;
    retry(() => fs.copyFileSync(src, path.join(target, f)));
    copied.push(f);
}
for (const d of DIRS) {
    const src = path.join(root, d);
    if (!fs.existsSync(src)) continue;
    retry(() => fs.cpSync(src, path.join(target, d), { recursive: true }));
    copied.push(d + "/");
}

console.log("");
console.log(`[mindmap] 已部署 → ${target}`);
console.log(`[mindmap] 同步了 ${copied.length} 项：${copied.join("  ")}`);
console.log("");
console.log("下一步：思源 → 设置 → 集市 → 已下载 → 找到「大纲导图」打开开关。");
console.log("如果列表里没有它，重启一次思源。");
