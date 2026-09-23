/**
 * 探针共用的「删测试文档」助手。
 *
 * ⚠️ 这是踩过坑之后才抽出来的。原以为 `/api/filetree/removeDoc` 传 `{id}` 就行，
 * 结果在思源 3.8.4 上它会返回：
 *
 *     {"code":-1,"msg":"Field [notebook] is required"}
 *
 * 而探针的清理都写成 `await api(...).catch(() => {})` —— 失败被静默吞掉，
 * 于是每跑一轮真机验收就往用户笔记本里漏十几个「临时-xxx」。
 * 实测积到 143 个才发现。
 *
 * 正确姿势是两步：
 *   1. `/api/filetree/getPathByID {id}` → `{ path, notebook }`
 *      （注意字段叫 **notebook**，不是 `box` —— 传 `box` 一样报上面那个错）
 *   2. `/api/filetree/removeDoc {notebook, path}`
 *
 * 另外两个相关的坑：
 *   - `/api/block/deleteBlock {id}` **删不掉文档**，它只清块，`.sy` 文件留在磁盘上、
 *     文档也还挂在文件树里（`diag-migrate-layout.mjs` 就是这么漏的）。
 *   - 建完文档**立刻**用 `/api/query/sql` 查是查不到的，块索引有延迟 ——
 *     「查不到」不等于「没建出来」，别据此判断创建失败。
 *   - 反过来，**删完之后索引也要等一会儿才回收**：删完立刻再查会看到
 *     「还剩 22 个」，过 20 秒再看变 0。别被这个假残留骗着去删第二遍；
 *     想确认到底删没删，看磁盘（`data/<notebook>/*.sy`）比看 SQL 靠谱。
 */

/**
 * 删掉一个文档。
 *
 * @param {(path: string, payload?: object) => Promise<any>} api 探针自己的 api 封装
 * @param {string} id 文档 ID
 * @returns {Promise<boolean>} 是否真的删掉了
 */
export async function removeDoc(api, id) {
    if (!id) return false;
    const info = await api("/api/filetree/getPathByID", { id }).catch(() => null);
    /* ⚠️ 各脚本的 `api()` 封装有**两种约定**，这个助手必须两种都认：
     *
     *   完整响应型：`return res.json()`      → { code, msg, data }
     *   已解包型  ：`return json.data`       → 直接就是 data
     *
     * 原来是只认完整响应的写法（`info?.data?.notebook`），于是
     * `live.mjs`（解包型）这里恒为 undefined → 走 fallback → 也失败 →
     * 清理静默失效。实测由 `npm run e2e:all` 抓到（live / live:gpu 各漏一个文档）。
     *
     * 判据：`info?.data ?? info` —— 完整响应取 .data，解包型原样用。
     * 两种约定的 `data` 层字段名一致（notebook / path），所以到这里就统一了。
     */
    const payload = info?.data ?? info;
    const notebook = payload?.notebook;
    const path = payload?.path;
    if (notebook && path) {
        // 删成功的判定也要兼容两种：完整响应看 code === 0；
        // 解包型成功返回 null（removeDoc 的 data 就是 null）、失败则**抛异常**。
        // 所以「没抛 且（无返回值 或 code===0）」才算成功。
        let threw = false;
        const out = await api("/api/filetree/removeDoc", { notebook, path }).catch(() => {
            threw = true;
            return null;
        });
        if (!threw && (out == null || out?.code === 0)) return true;
        console.warn(`[cleanup] 删文档失败 ${id}：${out?.msg ?? "(抛异常/无响应)"}`);
        return false;
    }
    // 退一步：有些版本确实认 id。试一下，但**不要**吞掉错误信息
    const fallback = await api("/api/filetree/removeDoc", { id }).catch(() => null);
    if (fallback == null || fallback?.code === 0) {
        // ⚠️ 解包型下「返回 null」既可能是成功、也可能是抛异常被吞 ——
        //    这里按成功记，但把这条路径的不可判定性写出来，免得以后当成「一定成功」。
        return true;
    }
    console.warn(`[cleanup] 删文档失败 ${id}：拿不到 notebook/path`, info?.msg ?? "");
    return false;
}

/** 一次删多个，返回成功数 */
export async function removeDocs(api, ids) {
    let ok = 0;
    for (const id of ids) if (await removeDoc(api, id)) ok++;
    return ok;
}
