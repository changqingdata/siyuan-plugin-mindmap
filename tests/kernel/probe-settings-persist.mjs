/**
 * 只读探针：设置面板的「存盘 / 读回 / 取消」三条链路到底通不通。
 *
 * ## 为什么要有这一支
 *
 * 覆盖审计里这条留了很久（7.8 → 8.7 → 9.6 → 10.6 一路挂着）：
 *
 *   已有的断言只验过「改**内存** config → 行为变了」（`diag-settings.mjs`），
 *   从没验过「点设置面板 → 写进磁盘 → 重启还在」。
 *
 * 而实现是这样的（`index.ts`）：
 *
 *   const addToggle = (…, changed) => { … box.onchange = () => changed(box.checked); };
 *   // 每个 changed 都**只写内存**：
 *   addToggle("小地图", …, (v) => { this.config.minimap = v; });
 *   // 落盘只发生在「保存」：
 *   new Setting({ confirmCallback: () => { void this.saveConfig(); … } });
 *
 * 所以这里其实有**三条**独立链路，每条都可能单独坏：
 *
 *   ① 改开关 → 内存变了（已有断言验过 ✓）
 *   ② 点「保存」→ 写进磁盘
 *   ③ 重启 → 从磁盘读回
 *   ④ 点「取消」→ 应该回退，还是什么都不做？
 *
 * ## 本探针踩过的三个坑（都写在这里，省得下次再踩）
 *
 * 1. **落点没有 `.json` 后缀**：`saveData("config")` 写出来就是
 *    `<ws>/data/storage/petal/<插件名>/config`。第一版按同目录下别的插件的
 *    `script.json` 想当然加了后缀，于是明明存盘成功了却报「磁盘上没有 config.json」。
 * 2. **标题在 `.config-name`，不在 `.b3-label__text`** —— 后者装的是**描述**。
 *    按描述找会 `no-label`。
 * 3. **保存按钮的文案是「保存」不是「确定」**（class `b3-button--text`；
 *    取消是 `b3-button--cancel`）。
 *
 * ⚠️ 本探针**会改用户工作空间里的插件配置文件**，所以开头先备份
 * （文件不存在也要记下来），结尾严格还原成原样：原本不存在就把文件与空目录都删掉。
 *
 * 用法：node tests/kernel/probe-settings-persist.mjs
 *      MM_HEADFUL=1 走有头
 */
import fs from "node:fs";
import path from "node:path";
import { launch, sleep } from "../cdp.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const PLUGIN = "siyuan-plugin-mindmap";
const HEADFUL = !!process.env.MM_HEADFUL;

/** 插件配置的磁盘落点（⚠️ 没有 .json 后缀） */
const CONF_FILE = path.join(WORKSPACE, "data", "storage", "petal", PLUGIN, "config");
const CONF_DIR = path.dirname(CONF_FILE);

/** 翻转这个开关 —— 纯视觉选项，翻错也不影响任何数据 */
const TOGGLE_TITLE = "小地图";

/* ---------------------------------------------------------------- 备份 */

const backup = fs.existsSync(CONF_FILE) ? fs.readFileSync(CONF_FILE, "utf8") : null;
console.log(`配置文件 ${CONF_FILE}`);
console.log(`探针前状态：${backup === null ? "（文件不存在）" : backup.slice(0, 120) + "…"}\n`);

const restore = () => {
    if (backup === null) {
        if (fs.existsSync(CONF_FILE)) {
            fs.unlinkSync(CONF_FILE);
            console.log(`已还原：删掉探针新建的 ${CONF_FILE}`);
        }
        if (fs.existsSync(CONF_DIR) && fs.readdirSync(CONF_DIR).length === 0) {
            fs.rmdirSync(CONF_DIR);
            console.log(`已还原：删掉空的 ${CONF_DIR}`);
        }
    } else {
        fs.writeFileSync(CONF_FILE, backup, "utf8");
        console.log("已还原：写回探针前的配置内容");
    }
};

const PLUGIN_EXPR = `((window.siyuan && window.siyuan.ws && window.siyuan.ws.app && window.siyuan.ws.app.plugins) || []).find((p) => p.name === '${PLUGIN}')`;
/** 面板里某个开关所在的 <label>（标题在 .config-name） */
const LABEL = `[...document.querySelector('.b3-dialog--open').querySelectorAll('.b3-label')]
    .find((x) => ((x.querySelector('.config-name') || {}).textContent || '').trim() === ${JSON.stringify(TOGGLE_TITLE)})`;

const chrome = await launch({ headless: !HEADFUL, gpu: HEADFUL, port: 9391, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`${KERNEL}/stage/build/desktop/`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2500);

    /** 走真路打开设置面板：顶栏图标 → 菜单「设置」 */
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
    /** 点面板底部某个按钮（保存 / 取消） */
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
    const memMinimap = () => page.eval(`(() => { const p = ${PLUGIN_EXPR}; return p ? p.config.minimap : null; })()`);
    const diskMinimap = () => (fs.existsSync(CONF_FILE) ? JSON.parse(fs.readFileSync(CONF_FILE, "utf8")).minimap : null);
    /** 把面板上的开关设成 want，再点保存 */
    const setAndSave = async (want) => {
        const r = await page.eval(`(() => {
            const l = ${LABEL};
            const box = l && l.querySelector('input.b3-switch');
            if (!box) return 'no-switch';
            if (box.checked !== ${JSON.stringify(want)}) box.click();
            return 'set:' + box.checked;
        })()`);
        await sleep(300);
        const c = await clickAction("/保存/");
        await sleep(1400);
        return `${r}｜${c}`;
    };

    /* ============================================================ ① 打开面板（走真路） */
    console.log("【① 顶栏图标 → 菜单「设置」】");
    const p0 = await page.eval(`(() => {
        const p = ${PLUGIN_EXPR};
        return { found: !!p, minimap: p ? p.config.minimap : null };
    })()`);
    console.log(`  插件实例：${p0.found ? "✓" : "✗"}｜内存里的 minimap = ${p0.minimap}`);
    console.log(`  打开面板：${await openPanel()}`);

    /* ============================================================ ② 面板结构 */
    console.log("\n【② 面板结构（类名实测，别靠记忆猜）】");
    const panel = await page.eval(`(() => {
        const d = document.querySelector('.b3-dialog--open');
        if (!d) return { on: false, dialogs: document.querySelectorAll('.b3-dialog').length };
        const actions = d.querySelector('.b3-dialog__action');
        return {
            on: true,
            header: (d.querySelector('.b3-dialog__header') || {}).textContent || '',
            labels: d.querySelectorAll('.b3-label').length,
            toggles: d.querySelectorAll('input.b3-switch').length,
            // ⚠️ 这里**不能**用模板字符串拼 —— 外层已经是一个模板字符串了，
            //    内层的反引号会把外层提前截断（本项目踩过两次）。
            buttons: [...(actions ? actions.querySelectorAll('button') : [])].map((b) => (b.textContent || '').trim() + ' . ' + String(b.className)),
            titles: [...d.querySelectorAll('.config-name')].map((x) => (x.textContent || '').trim()),
        };
    })()`);
    console.log(`  标题「${panel.header}」｜${panel.labels} 项（${panel.toggles} 个开关）`);
    console.log(`  底部按钮：${JSON.stringify(panel.buttons)}`);
    console.log(`  全部标题：${JSON.stringify(panel.titles)}`);

    /* ============================================================ ③ 保存 → 磁盘 */
    console.log(`\n【③ 翻转「${TOGGLE_TITLE}」→ 点「保存」→ 看磁盘】`);
    const beforeToggle = await page.eval(`(() => { const b = (${LABEL})?.querySelector('input.b3-switch'); return b ? b.checked : null; })()`);
    const flipped = await page.eval(`(() => {
        const b = (${LABEL})?.querySelector('input.b3-switch');
        if (!b) return 'no-switch';
        b.click();
        return 'clicked→' + b.checked;
    })()`);
    await sleep(400);
    console.log(`  面板 ${beforeToggle} → ${flipped}｜内存 minimap = ${await memMinimap()}｜磁盘 ${fs.existsSync(CONF_FILE) ? "文件存在" : "（还没落盘）"}`);
    console.log(`  点保存：${await clickAction("/保存/")}`);
    await sleep(1200);
    const disk1 = diskMinimap();
    console.log(`  磁盘 minimap = ${disk1}（期望 ${!p0.minimap}）→ ${disk1 === !p0.minimap ? "✓ 存盘生效" : "✗ 没存上"}`);

    /* ============================================================ ④ 草稿语义：改 / 取消 / 保存 */
    // 判据的基线必须是「**点这一下之前**的内存值」，不能是「原始默认值」——
    // 第一版拿 p0.minimap 当基线，可上一步刚好把开关点回了原始值，
    // 于是「取消后 == 原始值」必然成立 → **假绿**，掩盖了当时「取消根本不回退」的事实。
    // 这是本项目第 4 次踩「基线取错导致假绿」。
    console.log("\n【④ 草稿语义：面板改 → 内存不该动；取消 → 丢弃；保存 → 才落】");
    console.log(`  打开面板：${await openPanel()}`);
    const baseMem = await memMinimap();          // ← 基线：点之前的内存值
    const baseBox = await page.eval(`(() => { const b = (${LABEL})?.querySelector('input.b3-switch'); return b ? b.checked : null; })()`);
    const toggled = await page.eval(`(() => {
        const b = (${LABEL})?.querySelector('input.b3-switch');
        if (!b) return 'no-switch';
        b.click();
        return 'clicked→' + b.checked;
    })()`);
    await sleep(400);
    const memMid = await memMinimap();
    console.log(`  点之前：面板 ${baseBox}｜内存 ${baseMem}`);
    console.log(`  面板上点了一下：${toggled}｜此刻内存 ${memMid}`);
    console.log(
        `  → ${
            memMid === baseMem
                ? "✓ 面板改动只落在草稿里，没有污染真实配置"
                : `✗ 面板一改内存就变了（${baseMem} → ${memMid}）—— 草稿模型没生效`
        }`,
    );

    console.log(`  点取消：${await clickAction("/取消/")}`);
    await sleep(1200);
    const memAfterCancel = await memMinimap();
    const diskAfterCancel = diskMinimap();
    console.log(`  取消后：内存 = ${memAfterCancel}｜磁盘 = ${diskAfterCancel}｜点之前的内存 = ${baseMem}`);
    console.log(
        `  → ${
            memAfterCancel === baseMem
                ? "✓ 取消之后内存仍是原值（草稿被丢弃）"
                : `✗ 取消后内存变成了 ${memAfterCancel}`
        }`,
    );
    console.log(`  → ${diskAfterCancel === disk1 ? "✓ 取消没有误写磁盘" : "✗ 取消居然把磁盘也改了"}`);

    // 再打开一次：面板上的开关应该显示 config 的值，而不是草稿残留
    console.log(`  重新打开面板：${await openPanel()}`);
    const reopenBox = await page.eval(`(() => { const b = (${LABEL})?.querySelector('input.b3-switch'); return b ? b.checked : null; })()`);
    console.log(`  面板上显示 ${reopenBox}（config 里是 ${memAfterCancel}）→ ${reopenBox === memAfterCancel ? "✓ 显示的是真实配置" : "✗ 显示的是草稿残留"}`);
    // 这一次改成「保存」，确认内存**才**变
    const saveBox = await page.eval(`(() => {
        const b = (${LABEL})?.querySelector('input.b3-switch');
        if (!b) return 'no-switch';
        b.click();
        return 'clicked→' + b.checked;
    })()`);
    await sleep(300);
    const memBeforeSave = await memMinimap();
    console.log(`  面板再点一下：${saveBox}｜保存前内存 ${memBeforeSave}（应仍等于 ${baseMem}）`);
    console.log(`  点保存：${await clickAction("/保存/")}`);
    await sleep(1200);
    const memAfterSave = await memMinimap();
    console.log(
        `  保存后内存 = ${memAfterSave}｜磁盘 = ${diskMinimap()}` +
            ` → ${memAfterSave !== baseMem ? "✓ 保存才把草稿落到真实配置" : "✗ 保存没生效"}`,
    );
    // 把状态推回基线，别带进下一段
    await page.eval(`(() => { const p = ${PLUGIN_EXPR}; if (p) p.config.minimap = ${JSON.stringify(baseMem)}; return 'ok'; })()`);

    /* ============================================================ ⑤ 重启读回 */
    console.log("\n【⑤ 把 minimap 写成非默认值 → 重载页面 → 有没有读回来】");
    const target = !p0.minimap;
    // 用内存直接写 + 走一次面板保存（保证磁盘上是 target）
    await page.eval(`(() => { const p = ${PLUGIN_EXPR}; if (p) p.config.minimap = ${JSON.stringify(target)}; return 'ok'; })()`);
    console.log(`  打开面板：${await openPanel()}`);
    console.log(`  设成 ${target} 并保存：${await setAndSave(target)}`);
    const disk2 = diskMinimap();
    console.log(`  磁盘 minimap = ${disk2}（期望 ${target}）`);

    await page.send("Page.reload", { ignoreCache: true });
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "重载后编辑器出现" });
    await sleep(3000);
    const afterReload = await memMinimap();
    console.log(`  重载后内存 minimap = ${afterReload}（磁盘上是 ${disk2}）`);
    console.log(`  → ${afterReload === disk2 ? "✓ 重启读回生效" : "✗ 没读回来"}`);

    await page.screenshot(`tests/.build/probe-settings-persist.png`);
    console.log(`\n截图 tests/.build/probe-settings-persist.png`);
} finally {
    await chrome.close();
    restore();
}
