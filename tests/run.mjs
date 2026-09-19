/**
 * 测试运行器：先装好极简 DOM 模拟，再用 esbuild 打包并执行测试入口。
 * 用法：node tests/run.mjs
 */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/* ------------------------------------------------------------- DOM 模拟 */

class MockClassList {
    constructor() {
        this.set = new Set();
    }
    contains(c) {
        return this.set.has(c);
    }
    add(...cs) {
        cs.forEach((c) => this.set.add(c));
    }
    remove(...cs) {
        cs.forEach((c) => this.set.delete(c));
    }
    toggle(c, force) {
        const on = force === undefined ? !this.set.has(c) : force;
        if (on) this.set.add(c);
        else this.set.delete(c);
        return on;
    }
}

class MockElement {
    constructor() {
        this.tagName = "DIV";
        this.children = [];
        this.parentElement = null;
        this.classList = new MockClassList();
        this.attributes = {};
        this._innerHTML = "";
        this.textContent = "";
    }
    /** 与真实 DOM 一致：dataset 读写映射到 data-* 属性 */
    get dataset() {
        const self = this;
        const toAttr = (prop) => "data-" + prop.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
        return new Proxy(
            {},
            {
                get(_t, prop) {
                    if (typeof prop !== "string") return undefined;
                    return self.attributes[toAttr(prop)];
                },
                set(_t, prop, value) {
                    if (typeof prop === "string") self.attributes[toAttr(prop)] = String(value);
                    return true;
                },
                has(_t, prop) {
                    return typeof prop === "string" && toAttr(prop) in self.attributes;
                },
            },
        );
    }
    appendChild(child) {
        this.children.push(child);
        child.parentElement = this;
        return child;
    }
    hasAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name);
    }
    getAttribute(name) {
        return this.hasAttribute(name) ? this.attributes[name] : null;
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }
    removeAttribute(name) {
        delete this.attributes[name];
    }
    querySelector() {
        return null;
    }
    get innerHTML() {
        return this._innerHTML;
    }
    set innerHTML(v) {
        this._innerHTML = v;
    }
}

globalThis.HTMLElement = MockElement;

/* ---------------------------------------------------------------- 打包执行 */

const outfile = path.join(here, ".build", "entry.mjs");
await build({
    entryPoints: [path.join(here, "entry.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile,
    logLevel: "warning",
});

await import(`file://${outfile.replace(/\\/g, "/")}`);

/* 打包产物就留在 .build/ 里，不删。
   它是 esbuild 每次覆盖生成的中间文件，删掉只是图个干净，却要付一次
   文件系统删除的代价 —— 某些受限环境（比如带批量删除守卫的沙箱）会因此
   直接让整个测试挂掉，得不偿失。整个 .build 目录本身也不该被顺手清空：
   它还住着视觉验证页（visual.html / visual.js / 截图）。 */
