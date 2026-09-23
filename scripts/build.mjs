/**
 * 构建脚本
 *
 * 产物（与思源插件包规范一致）：
 *   index.js       —— 插件主体（CommonJS，siyuan 由宿主提供）
 *   index.css      —— 插件样式
 *   i18n/*.json    —— 多语言
 *   plugin.json    —— 清单
 *   README*.md / icon.png / preview.png
 *
 * 用法：
 *   node scripts/build.mjs           一次性构建
 *   node scripts/build.mjs --watch   监听重建
 *   node scripts/build.mjs --zip     额外产出 package.zip
 */
import { build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { emitStyleModule } from "./gen-style.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const watch = args.has("--watch");
const zip = args.has("--zip");

const p = (...s) => path.join(root, ...s);
const exists = (f) => fs.existsSync(p(f));

/* ---------------------------------------------------------------- 静态资源 */

/**
 * Windows 上删/写目录偶尔会撞 EPERM / EBUSY —— 杀软扫描、索引器、
 * 或上一轮进程还没完全松手。这类错误几乎都是瞬时的，重试几次就过去了，
 * 不该让它把整条构建链路打断（之前就这么断过一次，还很难看出原因）。
 */
function retry(fn, tries = 5) {
    for (let i = 1; ; i++) {
        try {
            return fn();
        } catch (err) {
            if (i >= tries || !["EPERM", "EBUSY", "ENOTEMPTY", "EACCES"].includes(err.code)) throw err;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60 * i);
        }
    }
}

function copyStatic(css) {
    retry(() => fs.writeFileSync(p("index.css"), css, "utf8"));

    // ⚠️ 根目录的 `i18n/` 是**构建产物**，真源是 `src/i18n/` —— 这里会先删后建。
    // 改文案请改 `src/i18n/*.json`；直接改根目录那份，下一次构建就会被原样覆盖回去，
    // 而且因为 index.js / plugin.json 走的是另一条 copyFileSync 路径、每次都正常更新，
    // 现象会变成「代码改了生效了、文案改了死活不变」，非常难排查。
    // 先删再建只是为了清掉改名后残留的旧文件，本身不是构建的必要条件。
    // Windows 上这个目录偶尔会被外部进程占住，删不掉就退化成覆盖拷贝，
    // 不值得为它把整条构建链路搞挂。
    try {
        retry(() => fs.rmSync(p("i18n"), { recursive: true, force: true }));
    } catch {
        // 忽略：下面会按需覆盖
    }
    retry(() => fs.mkdirSync(p("i18n"), { recursive: true }));
    for (const f of fs.readdirSync(p("src/i18n"))) {
        retry(() => fs.copyFileSync(p("src/i18n", f), p("i18n", f)));
    }
}

/* -------------------------------------------------------------------- zip */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 把 [{name, data}] 打成标准 zip（deflate） */
function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cdBuf, eocd]);
}

function makePackageZip() {
  const entries = [];
  const add = (name, file) => entries.push({ name, data: fs.readFileSync(p(file)) });

  add("index.js", "index.js");
  add("index.css", "index.css");
  add("plugin.json", "plugin.json");
  for (const f of fs.readdirSync(p("i18n"))) add(`i18n/${f}`, `i18n/${f}`);
  for (const f of fs.readdirSync(root)) {
    if (/^README.*\.md$/i.test(f)) add(f, f);
  }
  for (const f of ["icon.png", "preview.png", "LICENSE"]) {
    if (exists(f)) add(f, f);
  }

  const out = makeZip(entries);
  fs.writeFileSync(p("package.zip"), out);
  console.log(`[mindmap] package.zip 已生成（${entries.length} 个文件，${(out.length / 1024).toFixed(1)} KB）`);
}

/* -------------------------------------------------------------------- 主流程 */

/** 从 plugin.json 读版本号（读不到就报 `0.0.0`，构建不该因此失败） */
function readPluginVersion() {
  try {
    return JSON.parse(fs.readFileSync(p("plugin.json"), "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const options = {
  entryPoints: [p("src/index.ts")],
  outfile: p("index.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["siyuan"],
  charset: "utf8",
  legalComments: "none",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  /**
   * 把 plugin.json 的版本号烘进产物。
   *
   * 诊断面板（P1-5）要报版本，而运行时的 `this.data` 在思源不同版本里
   * 装的东西不一样，不能指望。从 plugin.json 读、构建时替换掉，
   * 版本号就只有**一处**真相源 —— 改了 plugin.json 忘了改代码这种事不会发生。
   */
  define: {
    __MM_VERSION__: JSON.stringify(readPluginVersion()),
  },
};

async function run() {
  const css = emitStyleModule();
  copyStatic(css);

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log("[mindmap] 监听中 —— 修改 src/ 下的文件会自动重建");
  } else {
    await build(options);
    console.log("[mindmap] 构建完成 → index.js / index.css");
    if (zip) makePackageZip();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
