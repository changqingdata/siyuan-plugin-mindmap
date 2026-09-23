/**
 * `reclampView()` 的「装不装得下」判据 —— 该用画布宽还是内容宽？
 *
 * 背景：画布（world）在内容（节点包围盒）外侧还裹着一圈内边距
 * （`layout({ padX: 72, padY: 64 })`），所以「画布装不下」不等于「内容装不下」：
 *
 *     cw     = worldW × scale          ← 画布宽
 *     innerW = cw - 72 × scale × 2     ← 内容宽
 *
 * 中间有一段 `2 × 72 × scale` 宽的窗口：画布超了、内容没超。判据若用画布，
 * 「内容明明装得下却不居中」，视图就停在偏心位置 —— 偏心那一侧会把内容裁掉。
 *
 * 这支测试把那组数值构造出来，直接对照两种判据的结果。不需要真去折叠一个分支：
 * 判据只看 `worldW × scale`，把 `scale` 设进那个窗口就行。
 *
 * ⚠️ 同一族问题还有一处：`fit()` 里的 `frameAxis` 也是按画布钳制的
 * （见 `ux-v2.mjs` 的「可读优先取景不浪费可视区」）。两处都是「画布边缘 ≠ 内容边缘」。
 *
 * 用法：node tests/kernel/diag-reclamp.mjs
 */
import fs from "node:fs";
import { launch, sleep } from "../cdp.mjs";
import { removeDoc } from "./_doc-cleanup.mjs";

const KERNEL = process.env.SIYUAN_KERNEL || "http://127.0.0.1:6806";
const WORKSPACE = process.env.SIYUAN_WORKSPACE || "D:\\常青Data";
const NOTEBOOK = process.env.MM_NOTEBOOK || "20221230192740-wpnntiv";

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

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${name}  ${detail}`);
};

/* ---------------------------------------------------------------- 造数据 */

// 小图就够：判据只跟 `worldW × scale` 有关，节点多少不影响窗口的存在性
// （只要 worldW > 144，那段窗口就一定非空）。
const md = ["- 取景判据探针根", "  - 子一", "  - 子二", "  - 子三"].join("\n") + "\n";

const docRes = await api("/api/filetree/createDocWithMd", {
    notebook: NOTEBOOK,
    path: `/临时-取景判据-${Date.now()}`,
    markdown: md,
});
if (docRes.code !== 0) throw new Error("建文档失败: " + JSON.stringify(docRes));
const docId = docRes.data;
const kids = await api("/api/block/getChildBlocks", { id: docId });
const listId = (kids.data || []).find((k) => k.type === "l")?.id;
if (listId) await api("/api/attr/setBlockAttrs", { id: listId, attrs: { "custom-mindmap": "logic" } });

const chrome = await launch({ headless: true, port: 9346, width: 1680, height: 1050, dpr: 1 });

try {
    const page = await chrome.newPage(`http://127.0.0.1:6806/stage/build/desktop/?id=${docId}`);
    await page.waitFor("!!document.querySelector('.mm-root .mm-node')", { timeout: 90000, label: "导图" });
    await sleep(1200);

    const out = await page.eval(`(() => {
        const p = ((window.siyuan && window.siyuan.ws && window.siyuan.ws.app && window.siyuan.ws.app.plugins) || [])
            .find((x) => x.name === 'siyuan-plugin-mindmap');
        if (!p) return { err: '插件实例找不到' };
        const view = [...p.scanner.views.values()][0];
        if (!view) return { err: '没有挂载中的导图视图' };

        const M = 28;
        const vw = view.viewportEl.clientWidth;
        const w = view.worldW;
        if (!(vw > 200) || !(w > 200)) return { err: '视口或画布太小：' + vw + '/' + w };

        // 解出「画布超了、内容没超」的缩放区间：
        //   w × s         >  vw - 56      （画布装不下）
        //   (w - 144) × s <= vw - 56      （内容装得下）
        const sLo = (vw - M * 2) / w;
        const sHi = (vw - M * 2) / (w - 144);
        if (!(sHi > sLo)) return { err: '解不出窗口（worldW 太小）：' + w };
        const s = +((sLo + sHi) / 2).toFixed(4);

        const cw = w * s;
        const innerW = cw - 144 * s;
        const centered = +((vw - cw) / 2).toFixed(2);

        view.scale = s;
        view.tx = -100;              // 故意放到一个明显偏心的位置
        const before = view.tx;
        view.reclampView();
        const after = +view.tx.toFixed(2);

        return {
            vw, worldW: w, s,
            cw: +cw.toFixed(1),
            innerW: +innerW.toFixed(1),
            threshold: vw - M * 2,
            oldWouldCenter: cw <= vw - M * 2,
            newShouldCenter: innerW <= vw - M * 2,
            txBefore: before,
            txAfter: after,
            centered,
        };
    })()`);

    if (out.err) throw new Error(out.err);
    console.log(JSON.stringify(out) + "\n");

    check(
        "构造出了「画布装不下、内容装得下」的窗口",
        !out.oldWouldCenter && out.newShouldCenter,
        `画布 ${out.cw}px（> 阈值 ${out.threshold}px）· 内容 ${out.innerW}px（≤ 阈值）· 缩放 ${out.s}`,
    );
    check(
        "★ 判据按内容宽：偏心视图被夹回居中（按画布宽判会保持 -100 不动）",
        out.txAfter === out.centered,
        `tx ${out.txBefore} → ${out.txAfter}（居中值 ${out.centered}）`,
    );
    check(
        "居中之后内容确实完整落在视口里",
        out.centered + 72 * out.s >= -0.5 && out.centered + out.cw - 72 * out.s <= out.vw + 0.5,
        `内容占据 ${(out.centered + 72 * out.s).toFixed(1)} ~ ${(out.centered + out.cw - 72 * out.s).toFixed(1)}px（视口 0 ~ ${out.vw}px）`,
    );

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
    if (failed.length) {
        console.log("未通过：");
        for (const f of failed) console.log(`  - ${f.name}：${f.detail}`);
        process.exitCode = 1;
    }
} finally {
    await chrome.close();
    const info = await api("/api/block/getBlockInfo", { id: docId });
    if (info.code === 0) {
        await removeDoc(api, info.data.id ?? docId);
        console.log("已清理临时文档");
    }
}
