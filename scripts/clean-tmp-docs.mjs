/**
 * 清理探针遗留的临时测试文档。
 *
 * 真机探针都会在 `finally` 里删掉自己建的文档，但**总有漏网的**：
 * ① 中途崩溃 / Ctrl+C，`finally` 没跑到；
 * ② 那些「先写死一个文档再手动跑几次」的一次性探针（`probe-*.mjs`）压根没写清理；
 * ③ `removeDoc` 偶发失败，而调用处是 `.catch(() => {})`，失败被吞掉。
 *
 * 跑一轮开发下来，用户的笔记本里就会积下几十个「临时-xxx-时间戳」。
 * 这个脚本按**严格的命名签名**把它们扫出来删掉。
 *
 * 签名：`临时-<探针名>[-legacy|-native]-<时间戳>`
 * 只删完全符合这个形状的 —— 用户自己建的、名字里带「临时」两个字的文档不会被误伤。
 *
 * ⚠️ `/api/query/sql` 默认只回 **64 行**，写 `LIMIT 500` 也不生效。
 * 所以这里显式翻页；否则「一共就 64 个」会是个静默的错觉（实测真数是 143）。
 *
 *   node scripts/clean-tmp-docs.mjs          # 只列出来，不删（默认）
 *   node scripts/clean-tmp-docs.mjs --yes    # 真的删
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const DRY = !process.argv.includes("--yes");

/* ---------------------------------------------------------------- 找 token */

/** 从思源的进程参数里挖出「当前真正在跑的工作空间」，比硬编码路径靠谱 */
function findWorkspace() {
    if (process.env.SIYUAN_WORKSPACE) return process.env.SIYUAN_WORKSPACE;
    const conf = path.join(os.homedir(), ".config", "siyuan", "workspaces.json");
    // Windows 上桌面版把工作空间列表放在 %USERPROFILE%\.config\siyuan\workspaces.json
    if (!fs.existsSync(conf)) return null;
    const list = JSON.parse(fs.readFileSync(conf, "utf8"));
    const opened = list.filter((w) => w.opened).sort((a, b) => b.opened - a.opened);
    return opened[0]?.path ?? null;
}

const WORKSPACE = findWorkspace();
if (!WORKSPACE) {
    console.error("找不到工作空间。用 SIYUAN_WORKSPACE=... 指定。");
    process.exit(1);
}
const TOKEN = process.env.SIYUAN_TOKEN || JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8")).api?.token || "";

const api = async (p, payload) => {
    const res = await fetch(`${KERNEL}${p}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    return res.json();
};

/* ---------------------------------------------------------------- 扫描 */

// 「临时-」+ 探针名（不含横线）+ 可选状态后缀（legacy / native）+ 时间戳
const SIGNATURE = /^临时-[^-\s]+(?:-(?:legacy|native))?-\d{10,13}$/;

/**
 * 分页把全部命中拉回来。
 *
 * ⚠️ `/api/query/sql` **默认只回 64 行**，且写 `LIMIT 500` 也没用 ——
 * 实测 143 条命中只回前 64 条，剩下 79 条静默消失。
 * 第一次干跑只看到 64 个就以为「一共 64 个」是很容易踩的坑，所以必须显式翻页。
 */
const PAGE = 64;
async function fetchAll() {
    const out = [];
    for (let off = 0; ; off += PAGE) {
        const res = await api("/api/query/sql", {
            stmt: `SELECT id, content, box, path FROM blocks
                   WHERE type = 'd' AND content LIKE '临时-%'
                   ORDER BY created LIMIT ${PAGE} OFFSET ${off}`,
        });
        if (res.code !== 0) {
            console.error("查询失败：", res.msg);
            process.exit(1);
        }
        out.push(...res.data);
        if (res.data.length < PAGE) break;
    }
    return out;
}

const rows = await fetchAll();
const targets = rows.filter((r) => SIGNATURE.test((r.content || "").trim()));

console.log(`工作空间 ${WORKSPACE}`);
console.log(`「临时-」开头的文档 ${rows.length} 个，其中命中签名 ${targets.length} 个`);
if (!targets.length) process.exit(0);

const byProbe = new Map();
for (const r of targets) {
    const probe = r.content.replace(/^临时-/, "").replace(/-(?:legacy|native)?-?\d{10,13}$/, "");
    byProbe.set(probe, (byProbe.get(probe) ?? 0) + 1);
}
console.log("\n按探针分组：");
for (const [probe, n] of [...byProbe].sort((a, b) => b[1] - a[1])) console.log(`  ${probe}  ×${n}`);

if (DRY) {
    console.log("\n（dry-run，什么都没删。加 --yes 真的删）");
    process.exit(0);
}

console.log("\n开始删除…");
let ok = 0;
let bad = 0;
for (const r of targets) {
    // 优先用 notebook + path 删（对「文档已在编辑器里打开」这种情况更稳）
    let out = await api("/api/filetree/removeDoc", { notebook: r.box, path: r.path });
    if (out.code !== 0) out = await api("/api/filetree/removeDoc", { id: r.id });
    if (out.code === 0) ok++;
    else {
        bad++;
        console.error(`  失败 ${r.id} ${r.content} — ${out.msg}`);
    }
}
console.log(`\n删掉 ${ok} 个${bad ? `，${bad} 个失败` : ""}`);
