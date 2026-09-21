/**
 * 产物冒烟测试。
 *
 * 用桩模块加载打包后的 index.js，确认默认导出是继承 Plugin 的构造函数、
 * 生命周期与业务方法齐全 —— 能在装机前拦掉「加载即崩」这类问题。
 *
 * 用法：node tests/smoke.cjs
 */
const path = require("node:path");
const Module = require("node:module");

/* ---------------------------------------------------------- 用桩替换 siyuan */

const stub = {
    Plugin: class Plugin {},
    Dialog: class Dialog {},
    Menu: class Menu {},
    Setting: class Setting {},
    showMessage: () => {},
    fetchSyncPost: async () => ({ code: 0, data: {} }),
    getFrontend: () => "desktop",
    getBackend: () => "windows",
};

const originalLoad = Module._load;
Module._load = function (request) {
    if (request === "siyuan") return stub;
    return originalLoad.apply(this, arguments);
};

/* ------------------------------------------------------------------ 断言 */

let passed = 0;
const failures = [];
const ok = (cond, msg) => {
    if (cond) passed++;
    else {
        failures.push(msg);
        console.error(`  ✗ ${msg}`);
    }
};

/* ------------------------------------------------------------------ 执行 */

const entry = path.resolve(__dirname, "..", "index.js");
const mod = require(entry);

const PluginClass = mod.default;
ok(typeof PluginClass === "function", "默认导出是构造函数");
ok(PluginClass.prototype instanceof stub.Plugin, "继承自 Plugin");

const EXPECTED = [
    "onload",
    "onLayoutReady",
    "onunload",
    "registerBlockMenu",
    "registerCommands",
    "buildBlockMenu",
    "applyView",
    "persistLayout",
    "openFullscreen",
    "openSetting",
    "saveConfig",
    "migrateLegacy",
    "runMigration",
];
for (const name of EXPECTED) {
    ok(typeof PluginClass.prototype[name] === "function", `原型方法 ${name} 存在`);
}

/* -------------------------------------------------- 视图类（渲染内核） */

const ViewClass = mod.MindMapView;
ok(typeof ViewClass === "function", "导出了 MindMapView");

const VIEW_METHODS = [
    "mount",
    "destroy",
    "setOptions",
    "render",
    "select",
    "toggleMulti",
    "selectAllSiblings",
    "clearSelection",
    "refreshSelection",
    "navigate",
    "onKeyDown",
    "beginEdit",
    "openNodeMenu",
    "armDrag",
    "updateDropTarget",
    "drawEdges",
    "edgeColor",
    "runFlip",
    "snapshot",
    "toggleSearch",
    "runSearch",
    "stepSearch",
    "gotoHit",
    "applySearchMarks",
    "refreshMinimap",
    "onMinimapDown",
    "startMarquee",
    "showTip",
    "hideTip",
    "fit",
    "setScale",
    "zoomAt",
    "updateTransform",
    "placeToggle",
    "createNodeEl",
    "bindEvents",
    // 第十六轮：画布与工具交互增强
    "applyViewPrefs",
    "runAction",
    "runBatchAction",
    "showGhost",
    "dropGhost",
    "flashError",
    "addFresh",
    "refreshBatchBar",
    "buildBatchBar",
    "hideBatchBar",
    "batchFold",
    "selectedInDocOrder",
    "armPreview",
    "disarmPreview",
    "showPreview",
    "hidePreview",
    "markHoverExpand",
    "togglePresent",
    "presentGo",
    "refreshPresentBar",
    "hidePresentBar",
    "bindOutlineCursor",
    "setCursorBlock",
    "markOutlineCursor",
    "openZoomMenu",
    "openViewMenu",
    "fitToNodes",
    "toggleRememberScale",
    "detachVanishing",
    "runCollapse",
    "selectionBounds",
    "selectionIds",
    "outlineMarkdown",
    "copyImage",
    "prepareExport",
    "doExport",
    "openExportMenu",
    // 第十六轮补：重渲染后重绑选择、小地图标记层、插件自己的菜单登记
    "remapSelection",
    "updateMinimapMarks",
    "minimapMarkSvg",
    "makeMenu",
    "popMenu",
];
for (const name of VIEW_METHODS) {
    ok(typeof ViewClass.prototype[name] === "function", `视图方法 ${name} 存在`);
}

/* -------------------------------------------------- 实例化 */

let inst = null;
try {
    inst = new PluginClass();
} catch (err) {
    console.error(`  ✗ 实例化抛错：${err && err.message}`);
}
ok(inst !== null, "可以实例化");
ok(
    inst && typeof inst.onload === "function" && typeof inst.onLayoutReady === "function" && typeof inst.onunload === "function",
    "实例上生命周期钩子可用",
);

console.log("");
if (failures.length === 0) {
    console.log(`产物冒烟测试通过 ✓  共 ${passed} 项断言`);
} else {
    console.error(`${failures.length} 项失败，${passed} 项通过`);
    process.exitCode = 1;
}
