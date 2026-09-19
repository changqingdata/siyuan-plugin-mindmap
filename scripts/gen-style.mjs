/**
 * 把样式表正文注入为一个 TS 模块，供 SVG 导出时内联使用。
 * 单独抽出来是为了让 `npm run typecheck` 在全新克隆上也能直接跑通。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function emitStyleModule() {
    const css = fs.readFileSync(path.join(root, "src/styles/index.css"), "utf8");
    fs.mkdirSync(path.join(root, "src/generated"), { recursive: true });
    fs.writeFileSync(
        path.join(root, "src/generated/style.ts"),
        "// 由 scripts/gen-style.mjs 自动生成，请勿手动修改\n" +
            "export const PLUGIN_CSS = " + JSON.stringify(css) + ";\n",
        "utf8",
    );
    return css;
}

// 直接执行时（node scripts/gen-style.mjs）也产出样式表
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
    const css = emitStyleModule();
    fs.writeFileSync(path.join(root, "index.css"), css, "utf8");
    console.log("[mindmap] 已生成 src/generated/style.ts 与 index.css");
}
