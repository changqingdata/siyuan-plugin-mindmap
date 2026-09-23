/**
 * 只读探针：`flipAnimation`（设置项「布局动效」）到底有没有真的生效？
 *
 * ## 为什么要单独开一支
 *
 * `probe-settings-effects.mjs` 里已经试了两轮，`.mm-collapsing` 的峰值始终是 0：
 *   · 第一版：以为它是 CSS transition（`.mm-node` 的 computed transition 恒为
 *     `opacity 0.18s`）—— 信号找错了。
 *   · 第二版：知道看 `.mm-collapsing` 了，但怀疑 headless 环境的
 *     `prefers-reduced-motion` 是 `reduce`，把 `runCollapse` 短路了。
 *     实测**不是** —— 环境报 `false`，而且显式 `Emulation.setEmulatedMedia`
 *     模拟 `no-preference` 之后仍然是 0。
 *
 * 所以这一支不再猜，直接把 `detachVanishing` / `runCollapse` **包一层计数器**，
 * 看它们到底有没有被调到、拿到几个元素、在哪一步被拦下。
 *
 * 可能的拦截点（按 `render()` 里的执行顺序）：
 *   1. `this.options.flipAnimation` 为假 → `vanish` 直接是 `[]`
 *      （`setOptions` 走的是 `Object.assign`，理论上会同步；但要实测）
 *   2. `oldTree` 为 null → 同理
 *   3. `detachVanishing` 里 `visible` 集合算错 → 没有节点被判为「消失」
 *   4. `n.el` 为空 → 元素已被上一轮销毁
 *   5. `runCollapse` 里的 `prefers-reduced-motion` / `items.length > 120`
 *
 * 用法：node tests/kernel/probe-flip-anim.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";
const OUT = "tests/.build";

const conf = JSON.parse(fs.readFileSync(`${WORKSPACE}/conf/conf.json`, "utf8"));
const TOKEN = process.env.SIYUAN_TOKEN || conf.api?.token || "";

async function api(p, payload) {
    const res = await fetch(KERNEL + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${TOKEN}` },
        body: JSON.stringify(payload ?? {}),
    });
    return res.json();
}
const kids = async (id) => (await api("/api/block/getChildBlocks", { id })).data ?? [];

/* fixture：一个顶层列表，根节点下 3 个孩子，第一个孩子还有 2 个孙子。
   折叠根节点 → 3 个孩子（含其孙子）整批消失 → 正好是收拢动画要处理的那批。 */
const md = [
    "- 动画根",
    "  - 孩子甲",
    "    - 孙子一",
    "    - 孙子二",
    "  - 孩子乙",
    "  - 孩子丙",
    "",
].join("\n");

const docRes = await api("/api/filetree/createDocWithMd", { notebook: NOTEBOOK, path: `/临时-布局动效-${Date.now()}`, markdown: md });
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;

const list = (await kids(docId)).filter((k) => k.type === "l")[0];
if (!list) throw new Error("没找到顶层列表");
await api("/api/attr/setBlockAttrs", { id: list.id, attrs: { "custom-mindmap": "logic" } });
console.log(`临时文档 ${docId} ｜列表 ${list.id}（${(await kids(list.id)).length} 个顶层项）\n`);

const MM_PLUGIN = `((window.siyuan && window.siyuan.ws && window.siyuan.ws.app && window.siyuan.ws.app.plugins) || []).find((p) => p.name === 'siyuan-plugin-mindmap')`;
const R = `.protyle-wysiwyg .list[data-node-id="${list.id}"] .mm-root`;

const chrome = await launch({ headless: true, port: 9387, width: 1680, height: 1050, dpr: 1 });
try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.protyle-wysiwyg')", { timeout: 90000, label: "编辑器出现" });
    await sleep(2600);
    await page.waitFor(`document.querySelectorAll(${JSON.stringify(R)} + ' .mm-node').length > 0`, { timeout: 30000, label: "导图挂载" });
    await sleep(800);

    const nodeCount = await page.eval(`document.querySelectorAll(${JSON.stringify(R)} + ' .mm-node').length`);
    console.log("画布节点数：", nodeCount);

    /** 给 view 的两个私有方法各包一层计数器（TS 的 private 只是编译期约束，运行时就是普通属性） */
    const installHooks = () =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p.scanner.views && p.scanner.views.get(${JSON.stringify(list.id)});
            if (!v) return 'no-view';
            window.__flip = { detach: [], collapse: [] };
            const od = v.detachVanishing.bind(v);
            v.detachVanishing = (oldTree, newRoot) => {
                const out = od(oldTree, newRoot);
                window.__flip.detach.push(out.length);
                return out;
            };
            const oc = v.runCollapse.bind(v);
            v.runCollapse = (items) => {
                window.__flip.collapse.push(items.length);
                return oc(items);
            };
            return 'ok';
        })()`);

    /** 折叠第一个「还能折」的节点，并在 500ms 内以 15ms 粒度抓 `.mm-collapsing` 峰值 */
    const foldAndPeak = async () => {
        const pt = await page.eval(`(() => {
            const root = document.querySelector(${JSON.stringify(R)});
            if (!root) return { err: 'no root' };
            const t = [...root.querySelectorAll('.mm-node .mm-toggle')].find((x) => !x.classList.contains('mm-toggle--collapsed'));
            if (!t) return { err: 'no expandable toggle' };
            const r = t.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
        if (pt.err) return pt;
        await page.mouse("mouseMoved", pt.x, pt.y, { buttons: 0 });
        await page.mouse("mousePressed", pt.x, pt.y, { clickCount: 1 });
        await page.mouse("mouseReleased", pt.x, pt.y, { clickCount: 1 });
        let peak = 0;
        for (let i = 0; i < 34; i++) {
            const n = await page.eval(`document.querySelectorAll('.mm-collapsing').length`);
            if (n > peak) peak = n;
            await sleep(15);
        }
        return { ok: true, peak };
    };

    const state = () =>
        page.eval(`(() => {
            const p = ${MM_PLUGIN};
            const v = p.scanner.views && p.scanner.views.get(${JSON.stringify(list.id)});
            const o = v ? v.options : {};
            return JSON.stringify({
                configFlip: p.config.flipAnimation,
                optionFlip: o.flipAnimation,
                sameObj: v ? v.options === p.config : null,
                treeFolded: v && v.tree ? (() => {
                    const acc = [];
                    const w = (n) => { if (n.folded) acc.push((n.text || '').slice(0, 6)); n.children.forEach(w); };
                    w(v.tree);
                    return acc;
                })() : null,
                hooks: window.__flip || null,
                reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            });
        })()`);

    console.log("环境 prefers-reduced-motion:reduce =", await page.eval(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`));
    console.log("装计数器：", await installHooks(), "\n");

    /* ---- ① flipAnimation 关 ---- */
    await page.eval(`(() => { const p = ${MM_PLUGIN}; p.config.flipAnimation = false; p.scanner.refreshAll(); return 'ok'; })()`);
    await sleep(900);
    let r = await foldAndPeak();
    console.log("【① flipAnimation = 关】");
    console.log("  折叠：", JSON.stringify(r));
    console.log("  内省：", await state());
    console.log("  .mm-collapsing 峰值：", r.peak ?? "(折叠失败)");

    // 展开回去（再点一次同一个珠子）
    await page.eval(`(() => {
        const root = document.querySelector(${JSON.stringify(R)});
        const t = root && root.querySelector('.mm-toggle--collapsed');
        if (!t) return 'none';
        const r = t.getBoundingClientRect();
        const o = { bubbles: true, cancelable: true, clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
        t.dispatchEvent(new MouseEvent('mousedown', o));
        t.dispatchEvent(new MouseEvent('mouseup', o));
        t.click();
        return 'ok';
    })()`);
    await sleep(1600);

    /* ---- ② flipAnimation 开 ---- */
    await page.eval(`(() => { const p = ${MM_PLUGIN}; p.config.flipAnimation = true; p.scanner.refreshAll(); return 'ok'; })()`);
    await sleep(900);
    console.log("\n【② flipAnimation = 开】");
    console.log("  装计数器前内省：", await state());
    await installHooks();
    r = await foldAndPeak();
    console.log("  折叠：", JSON.stringify(r));
    console.log("  内省：", await state());
    console.log("  .mm-collapsing 峰值：", r.peak ?? "(折叠失败)");

    await page.screenshot(`${OUT}/probe-flip-anim.png`);
    console.log(`\n截图 ${OUT}/probe-flip-anim.png`);
} finally {
    await chrome.close();
    await removeDoc(api, docId);
    console.log("已清理临时文档");
}
