/**
 * 设置面板「改 → 存盘 → 重启读回 → 取消」的端到端验收。
 *
 * ## 为什么单独一支
 *
 * 覆盖审计里这条挂了三轮（7.8 → 8.7 → 9.6 → 10.6）：
 * 已有的断言只验过「改**内存** config → 行为变了」（`diag-settings.mjs`），
 * 从没验过「点设置面板 → 写进磁盘 → 重启还在」。而这条链路上每一环都可能单独坏，
 * 且**坏了也不报错**：`saveData` 名字写错、`confirmCallback` 没接上、
 * 面板开关是草稿还是直接写内存 —— 全都能在「所有断言都绿」的情况下出错。
 *
 * 本脚本钉住五件事：
 *
 *   A. 走**真路**能打开设置面板（顶栏图标 → 菜单「设置」），面板结构完整
 *   B. 面板底部是「取消 / 保存」两个按钮
 *   C. **草稿语义**：面板里改开关**不能**污染真实配置；点「保存」才落
 *   D. **取消**：丢弃草稿、不写磁盘、重开面板显示的是真实配置
 *   E. **重启读回**：重载页面后 `config` 等于磁盘上的值
 *
 * ## ⚠️ 这支脚本会碰用户工作空间里的插件配置文件
 *
 * 所以：开头备份 → 全程在 try/finally 里 → 结尾严格还原成原样
 * （原本不存在就把文件与空目录都删掉），并且**把「还原成功」也写成一条断言**。
 * 测试自己留垃圾，和功能有 bug 一样糟。
 *
 * ## 三个实测踩出来的坑（省得下次再踩）
 *
 * 1. **落点没有 `.json` 后缀**：`saveData("config")` 写出来就是
 *    `<ws>/data/storage/petal/<插件名>/config`。
 *    按同目录下别的插件的 `script.json` 类推会得到假红。
 * 2. **标题在 `.config-name`**，`.b3-label__text` 里装的是**描述**。
 * 3. **保存按钮文案是「保存」不是「确定」**（`b3-button--text`），取消是 `b3-button--cancel`。
 *
 * 用法：node tests/kernel/diag-settings-persist.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "../cdp.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const PLUGIN = "siyuan-plugin-mindmap";

const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
void conf;

const CONF_FILE = path.join(WORKSPACE, "data", "storage", "petal", PLUGIN, "config");
const CONF_DIR = path.dirname(CONF_FILE);

/** 拿它当探针 —— 纯视觉选项，翻错不影响任何数据 */
const TOGGLE = "小地图";

/* ---------------------------------------------------------------- 备份 */

const backup = fs.existsSync(CONF_FILE) ? fs.readFileSync(CONF_FILE, "utf8") : null;
const restoreDisk = () => {
    if (backup === null) {
        if (fs.existsSync(CONF_FILE)) fs.unlinkSync(CONF_FILE);
        if (fs.existsSync(CONF_DIR) && fs.readdirSync(CONF_DIR).length === 0) fs.rmdirSync(CONF_DIR);
    } else {
        fs.writeFileSync(CONF_FILE, backup, "utf8");
    }
};

/* ---------------------------------------------------------------- 判据 */

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = "") => {
    if (cond) {
        pass++;
        console.log(`  ✓ ${label}${extra ? `  ${extra}` : ""}`);
    } else {
        fail++;
        console.log(`  ✗ ${label}${extra ? `  ${extra}` : ""}`);
    }
};

const PLUGIN_EXPR = `((window.siyuan && window.siyuan.ws && window.siyuan.ws.app && window.siyuan.ws.app.plugins) || []).find((p) => p.name === '${PLUGIN}')`;
const LABEL = `[...document.querySelector('.b3-dialog--open').querySelectorAll('.b3-label')]
    .find((x) => ((x.querySelector('.config-name') || {}).textContent || '').trim() === ${JSON.stringify(TOGGLE)})`;

const chrome = await launch({ headless: true, port: 9393, width: 1680, height: 1050, dpr: 1 });
let crashed = null;
try {
    const page = await chrome.newPage(`${KERNEL}/stage/build/desktop/`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2500);

    const memMinimap = () => page.eval(`(() => { const p = ${PLUGIN_EXPR}; return p ? p.config.minimap : null; })()`);
    const diskMinimap = () => (fs.existsSync(CONF_FILE) ? JSON.parse(fs.readFileSync(CONF_FILE, "utf8")).minimap : null);
    const boxChecked = () => page.eval(`(() => { const b = (${LABEL})?.querySelector('input.b3-switch'); return b ? b.checked : null; })()`);
    const openPanel = async () => {
        await page.eval(`(() => {
            const el = document.querySelector('.toolbar [id^="plugin_${PLUGIN}"]')
                || [...document.querySelectorAll('.toolbar *')].find((e) => (e.getAttribute('title') || '') === '大纲导图');
            if (el) el.click();
            return 'ok';
        })()`);
        await sleep(800);
        const hit = await page.eval(`(() => {
            const it = [...document.querySelectorAll('.b3-menu .b3-menu__item')].find((x) => (x.textContent || '').trim() === '设置');
            if (!it) return 'no-item';
            it.click();
            return 'clicked';
        })()`);
        await sleep(1400);
        return hit;
    };
    const clickAction = (re) =>
        page.eval(`(() => {
            const d = document.querySelector('.b3-dialog--open');
            if (!d) return 'no-dialog';
            const acts = d.querySelector('.b3-dialog__action');
            const b = [...(acts ? acts.querySelectorAll('button') : [])].find((x) => ${re}.test((x.textContent || '').trim()));
            if (!b) return 'no-button';
            const t = (b.textContent || '').trim();
            b.click();
            return 'clicked:' + t;
        })()`);
    const flip = () =>
        page.eval(`(() => {
            const b = (${LABEL})?.querySelector('input.b3-switch');
            if (!b) return 'no-switch';
            b.click();
            return 'clicked→' + b.checked;
        })()`);

    /* ============================================================ A. 真路打开面板 */
    console.log("\n[A] 走真路打开设置面板");
    const p0 = await page.eval(`(() => {
        const p = ${PLUGIN_EXPR};
        return { found: !!p, minimap: p ? p.config.minimap : null };
    })()`);
    ok(p0.found, "插件实例在页面上找得到", `minimap = ${p0.minimap}`);
    ok((await openPanel()) === "clicked", "顶栏图标 → 菜单「设置」能打开面板（菜单项真的接上了）");

    const panel = await page.eval(`(() => {
        const d = document.querySelector('.b3-dialog--open');
        if (!d) return { on: false };
        const actions = d.querySelector('.b3-dialog__action');
        return {
            on: true,
            labels: d.querySelectorAll('.b3-label').length,
            toggles: d.querySelectorAll('input.b3-switch').length,
            selects: d.querySelectorAll('select').length,
            buttons: [...(actions ? actions.querySelectorAll('button') : [])].map((b) => (b.textContent || '').trim()),
            hasToggle: [...d.querySelectorAll('.config-name')].some((x) => (x.textContent || '').trim() === ${JSON.stringify(TOGGLE)}),
        };
    })()`);
    ok(panel.on && panel.labels >= 20, "面板渲染出了完整条目", `${panel.labels} 项`);
    ok(panel.toggles >= 12 && panel.selects >= 3, "开关与下拉都在", `${panel.toggles} 开关 / ${panel.selects} 下拉`);
    ok(panel.hasToggle, `面板里找得到「${TOGGLE}」这一项（标题在 .config-name）`);

    /* ============================================================ B. 底部按钮 */
    console.log("\n[B] 面板底部按钮");
    ok(panel.buttons.includes("取消") && panel.buttons.includes("保存"),
        "底部是「取消 / 保存」两个按钮（不是「确定」）", JSON.stringify(panel.buttons));

    /* ============================================================ C. 草稿语义 */
    console.log("\n[C] 草稿语义：面板改 → 真实配置不动；保存 → 才落");
    const baseMem = await memMinimap();
    const baseBox = await boxChecked();
    ok(baseBox === baseMem, "面板上显示的初值 = 真实配置里的值", `面板 ${baseBox}｜内存 ${baseMem}`);

    const flipC = await flip();
    await sleep(400);
    const draftValue = await boxChecked();        // ← 草稿里现在是什么
    const memMid = await memMinimap();
    ok(memMid === baseMem, "★ 在面板上改开关**不会**污染真实配置（改动只落在草稿里）",
        `${flipC}｜内存仍是 ${memMid}`);
    ok(draftValue !== baseMem, "草稿确实和真实配置不同（否则下面两条会假绿）",
        `草稿 ${draftValue}｜配置 ${baseMem}`);

    const saved = await clickAction("/保存/");
    await sleep(1400);
    const memAfterSave = await memMinimap();
    ok(saved === "clicked:保存", "点得到「保存」按钮", saved);
    // ⚠️ 期望值是**草稿里那个值**，不是「面板刚打开时的初值」——
    //    第一版写成 baseBox，于是必然红（保存后是翻转值）。断言自己写错。
    ok(memAfterSave === draftValue, "★ 点「保存」才把草稿落到真实配置",
        `${baseMem} → ${memAfterSave}（草稿 ${draftValue}）`);
    ok(diskMinimap() === draftValue, "保存同时把值写进了磁盘", `磁盘 ${diskMinimap()}`);

    /* ============================================================ D. 取消 */
    console.log("\n[D] 取消：丢弃草稿、不写磁盘、重开显示真实配置");
    const diskBeforeCancel = diskMinimap();
    ok((await openPanel()) === "clicked", "再打开一次面板");
    const flipD = await flip();
    await sleep(400);
    ok((await memMinimap()) === memAfterSave, "改一下开关，真实配置仍然不动", flipD);
    const cancelled = await clickAction("/取消/");
    await sleep(1200);
    const memAfterCancel = await memMinimap();
    ok(cancelled === "clicked:取消", "点得到「取消」按钮", cancelled);
    ok(memAfterCancel === memAfterSave, "★ 取消之后真实配置仍是原值（草稿被丢弃）",
        `${memAfterSave} → ${memAfterCancel}`);
    ok(diskMinimap() === diskBeforeCancel, "取消没有误写磁盘", `磁盘 ${diskMinimap()}`);

    ok((await openPanel()) === "clicked", "第三次打开面板");
    const reopenBox = await boxChecked();
    ok(reopenBox === memAfterCancel, "重开面板显示的是真实配置，不是上一次的草稿残留",
        `面板 ${reopenBox}｜配置 ${memAfterCancel}`);

    /* ============================================================ E. 重启读回 */
    console.log("\n[E] 重启读回：把配置写成非当前值 → 重载页面 → 有没有读回来");
    // ⚠️ 目标值要相对**当前内存值**取反，不能相对「脚本开头那个值」——
    //    前面几段已经把内存改过了，用旧基线可能写成同一个值，那样「读回」是假绿。
    const memNow = await memMinimap();
    const target = !memNow;
    // ⚠️ 必须**通过面板**拨到 target，不能直写 p.config：
    //    草稿模型下点「保存」会用草稿整体覆盖 config，直写会被冲掉（实测踩过）。
    const boxNow = await boxChecked();
    if (boxNow !== target) {
        await flip();
        await sleep(300);
    }
    const boxWant = await boxChecked();
    ok(boxWant === target, "通过面板把开关拨到目标值", `面板 ${boxWant}`);
    await clickAction("/保存/");
    await sleep(1400);
    const disk2 = diskMinimap();
    ok(disk2 === target, "磁盘上确实写进了非当前值", `${memNow} → 磁盘 ${disk2}`);

    await page.send("Page.reload", { ignoreCache: true });
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "重载后编辑器出现" });
    await sleep(3000);
    const afterReload = await memMinimap();
    ok(afterReload === disk2, "★ 重载页面后 config 等于磁盘上的值（loadData 读回来了）",
        `重载后 ${afterReload}｜磁盘 ${disk2}`);

} catch (err) {
    crashed = err;
} finally {
    await chrome.close();
    console.log("\n=== 总计 ===");
    // 先还原磁盘，再断言「还原成功」——测试自己不能留垃圾。
    // ⚠️ 判据要和**探针前的备份**比，不能和「还原前那一刻」比（那样恒等，是假绿）。
    restoreDisk();
    const restoredOk =
        backup === null
            ? !fs.existsSync(CONF_FILE)
            : fs.existsSync(CONF_FILE) && fs.readFileSync(CONF_FILE, "utf8") === backup;
    console.log(
        `  ${restoredOk ? "✓" : "✗"} 配置文件已还原成探针前的状态（${backup === null ? "原本不存在 → 已删除" : "原本存在 → 已写回"})`,
    );
    if (restoredOk) pass++;
    else fail++;
}

if (crashed) {
    console.log(`\n✗ 脚本异常中断：${crashed.message}`);
    process.exit(1);
}
console.log(fail === 0 ? `设置存盘验收通过 ✓  共 ${pass} 项断言` : `${fail} 项失败，${pass} 项通过`);
process.exit(fail === 0 ? 0 : 1);
