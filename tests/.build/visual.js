"use strict";
(() => {
  // tests/siyuan-stub.ts
  var Menu = class {
    constructor(id) {
      this.id = id;
    }
    addItem() {
    }
    open() {
    }
  };
  function showMessage() {
  }

  // src/types.ts
  var DEFAULT_CONFIG = {
    layout: "logic",
    edge: "curve",
    theme: "siyuan",
    showOrder: true,
    compact: false,
    branchColor: true,
    ctrlWheelZoom: true,
    wheelPan: false,
    autoFit: true,
    editable: true,
    draggable: true,
    lazyRender: true,
    keyboard: true,
    flipAnimation: true,
    minimap: true,
    compactThreshold: 400,
    hardLimit: 2e3,
    columnLayout: true,
    viewPerDoc: true,
    hoverPreview: true,
    customPalette: ""
  };
  var FILTER_LABEL = {
    all: "\u5168\u90E8",
    todo: "\u672A\u5B8C\u6210",
    done: "\u5DF2\u5B8C\u6210"
  };
  var EDIT_FLAG = "data-mm-editing";

  // src/core/theme.ts
  var THEME_VARS = [
    "--mm-canvas-bg",
    "--mm-canvas-solid",
    "--mm-canvas-grid",
    "--mm-node-bg",
    "--mm-node-border",
    "--mm-node-text",
    "--mm-root-bg",
    "--mm-root-text",
    "--mm-root-shadow",
    "--mm-card-shadow",
    "--mm-hover-shadow",
    "--mm-toggle-bg",
    "--mm-accent",
    "--mm-focus-ring",
    "--mm-tint",
    "--mm-font"
  ];
  var PALETTE_DARK = [
    "#5B9DFF",
    "#3DD68C",
    "#FFB454",
    "#FF7AB6",
    "#4DD0E1",
    "#B388FF",
    "#FF6B6B",
    "#9CCC65",
    "#FF9F43",
    "#2DD4BF"
  ];
  var PALETTE_LIGHT = [
    "#2F6FED",
    "#0F9D58",
    "#D98200",
    "#D6336C",
    "#0B8FA8",
    "#7C4DFF",
    "#D93025",
    "#5F9B00",
    "#E8590C",
    "#0F766E"
  ];
  var PALETTE_CONTRAST = [
    "#FFD400",
    "#00E5FF",
    "#7CFF6B",
    "#FF8A65",
    "#FF6EC7",
    "#B388FF",
    "#FFFFFF",
    "#4DD0E1",
    "#FFAB40",
    "#AEEA00"
  ];
  function isDarkMode() {
    const html = document.documentElement;
    const attr = html.getAttribute("data-theme-mode");
    if (attr === "dark") return true;
    if (attr === "light") return false;
    const body = document.body;
    if (body.classList.contains("b3-theme-dark")) return true;
    if (body.classList.contains("b3-theme-light")) return false;
    const bg = getComputedStyle(body).backgroundColor;
    const m = bg.match(/\d+/g);
    if (m && m.length >= 3) {
      const [r2, g, b] = m.map(Number);
      return 0.299 * r2 + 0.587 * g + 0.114 * b < 128;
    }
    return true;
  }
  var THEMES = {
    deep: {
      id: "deep",
      name: "\u6DF1\u7A7A",
      dark: true,
      canvasBg: "radial-gradient(circle at 22% 10%, #171c27 0%, #0b0d12 62%)",
      canvasSolid: "#0b0d12",
      canvasGrid: "rgba(255,255,255,.095)",
      nodeBg: "#171b24",
      nodeBorder: "#2a3142",
      nodeText: "#e2e7f0",
      rootBg: "linear-gradient(135deg,#4c8dff,#7b5cff)",
      rootText: "#ffffff",
      rootShadow: "rgba(76,141,255,.42)",
      cardShadow: "0 2px 10px rgba(0,0,0,.45)",
      hoverShadow: "rgba(0,0,0,.62)",
      toggleBg: "#12151d",
      accent: "#4c8dff",
      focusRing: "rgba(76,141,255,.6)",
      tint: 0.17
    },
    paper: {
      id: "paper",
      name: "\u6781\u7B80\u767D",
      dark: false,
      canvasBg: "radial-gradient(circle at 22% 10%, #ffffff 0%, #eef1f6 72%)",
      canvasSolid: "#eef1f6",
      canvasGrid: "rgba(0,0,0,.09)",
      nodeBg: "#ffffff",
      nodeBorder: "#e2e6ee",
      nodeText: "#1f2430",
      rootBg: "linear-gradient(135deg,#1f2430,#3b4557)",
      rootText: "#ffffff",
      rootShadow: "rgba(31,36,48,.3)",
      cardShadow: "0 1px 3px rgba(23,30,45,.09), 0 6px 18px rgba(23,30,45,.05)",
      hoverShadow: "rgba(23,30,45,.2)",
      toggleBg: "#ffffff",
      accent: "#2f6fed",
      focusRing: "rgba(47,111,237,.45)",
      tint: 0.13
    },
    morandi: {
      id: "morandi",
      name: "\u83AB\u5170\u8FEA",
      dark: false,
      canvasBg: "linear-gradient(160deg,#f4f1ec 0%,#eae5dd 100%)",
      canvasSolid: "#eae5dd",
      canvasGrid: "rgba(120,105,90,.14)",
      nodeBg: "#fbf9f6",
      nodeBorder: "#e0d9cf",
      nodeText: "#4a443c",
      rootBg: "linear-gradient(135deg,#8c8378,#a89e92)",
      rootText: "#fffdf9",
      rootShadow: "rgba(140,131,120,.36)",
      cardShadow: "0 2px 8px rgba(120,105,90,.13)",
      hoverShadow: "rgba(120,105,90,.26)",
      toggleBg: "#fbf9f6",
      accent: "#8c8378",
      focusRing: "rgba(140,131,120,.5)",
      tint: 0.16
    },
    neon: {
      id: "neon",
      name: "\u9713\u8679",
      dark: true,
      canvasBg: "radial-gradient(circle at 30% 0%, #1a1035 0%, #08060f 66%)",
      canvasSolid: "#08060f",
      canvasGrid: "rgba(140,120,255,.15)",
      nodeBg: "#130f22",
      nodeBorder: "#2e2450",
      nodeText: "#e4dcff",
      rootBg: "linear-gradient(135deg,#ff2d95,#8b5cf6)",
      rootText: "#ffffff",
      rootShadow: "rgba(255,45,149,.45)",
      cardShadow: "0 2px 12px rgba(0,0,0,.55)",
      hoverShadow: "rgba(139,92,246,.5)",
      toggleBg: "#130f22",
      accent: "#ff2d95",
      focusRing: "rgba(255,45,149,.55)",
      tint: 0.18
    },
    contrast: {
      id: "contrast",
      name: "\u9AD8\u5BF9\u6BD4",
      dark: true,
      canvasBg: "#000000",
      canvasSolid: "#000000",
      canvasGrid: "rgba(255,255,255,.12)",
      nodeBg: "#000000",
      nodeBorder: "#ffffff",
      nodeText: "#ffffff",
      rootBg: "#ffffff",
      rootText: "#000000",
      rootShadow: "rgba(0,0,0,0)",
      cardShadow: "none",
      hoverShadow: "rgba(255,255,255,.4)",
      toggleBg: "#000000",
      accent: "#ffd400",
      focusRing: "rgba(255,212,0,.85)",
      tint: 0.3
    }
  };
  var THEME_LIST = [
    { id: "siyuan", name: "\u8DDF\u968F\u601D\u6E90" },
    { id: "deep", name: "\u6DF1\u7A7A" },
    { id: "paper", name: "\u6781\u7B80\u767D" },
    { id: "morandi", name: "\u83AB\u5170\u8FEA" },
    { id: "neon", name: "\u9713\u8679" },
    { id: "contrast", name: "\u9AD8\u5BF9\u6BD4" }
  ];
  function resolveTheme(id, dark = isDarkMode()) {
    if (id !== "siyuan" && !THEMES[id]) id = "siyuan";
    if (id === "siyuan") {
      return {
        id: "siyuan",
        name: "\u8DDF\u968F\u601D\u6E90",
        dark,
        canvasBg: "var(--b3-theme-background)",
        canvasSolid: "var(--b3-theme-background)",
        canvasGrid: dark ? "rgba(255,255,255,.075)" : "rgba(0,0,0,.07)",
        nodeBg: "var(--b3-theme-background)",
        nodeBorder: "var(--b3-border-color)",
        nodeText: "var(--b3-theme-on-background)",
        rootBg: "var(--b3-theme-primary)",
        rootText: "var(--b3-theme-on-primary, #ffffff)",
        rootShadow: dark ? "rgba(0,0,0,.5)" : "rgba(0,0,0,.18)",
        cardShadow: dark ? "0 2px 10px rgba(0,0,0,.4)" : "0 1px 3px rgba(0,0,0,.07), 0 4px 14px rgba(0,0,0,.05)",
        hoverShadow: dark ? "rgba(0,0,0,.6)" : "rgba(0,0,0,.16)",
        toggleBg: "var(--b3-theme-background)",
        accent: "var(--b3-theme-primary)",
        focusRing: dark ? "color-mix(in srgb, var(--b3-theme-primary) 62%, transparent)" : "color-mix(in srgb, var(--b3-theme-primary) 48%, transparent)",
        tint: dark ? 0.2 : 0.12,
        palette: dark ? PALETTE_DARK : PALETTE_LIGHT
      };
    }
    const t = THEMES[id];
    const palette = id === "contrast" ? PALETTE_CONTRAST : t.dark ? PALETTE_DARK : PALETTE_LIGHT;
    return { ...t, palette };
  }
  function applyTheme(el, theme, font) {
    const s = el.style;
    s.setProperty("--mm-canvas-bg", theme.canvasBg);
    s.setProperty("--mm-canvas-solid", theme.canvasSolid);
    s.setProperty("--mm-canvas-grid", theme.canvasGrid);
    s.setProperty("--mm-node-bg", theme.nodeBg);
    s.setProperty("--mm-node-border", theme.nodeBorder);
    s.setProperty("--mm-node-text", theme.nodeText);
    s.setProperty("--mm-root-bg", theme.rootBg);
    s.setProperty("--mm-root-text", theme.rootText);
    s.setProperty("--mm-root-shadow", theme.rootShadow);
    s.setProperty("--mm-card-shadow", theme.cardShadow);
    s.setProperty("--mm-hover-shadow", theme.hoverShadow);
    s.setProperty("--mm-toggle-bg", theme.toggleBg);
    s.setProperty("--mm-accent", theme.accent);
    s.setProperty("--mm-focus-ring", theme.focusRing);
    s.setProperty("--mm-tint", String(theme.tint));
    s.setProperty("--mm-font", font);
  }
  function readResolvedVars(el) {
    const cs = getComputedStyle(el);
    const out = {};
    for (const name of THEME_VARS) {
      const v = cs.getPropertyValue(name).trim();
      if (v) out[name] = v;
    }
    return out;
  }
  function hexA(hex, alpha) {
    if (!hex.startsWith("#") || hex.length < 7) return hex;
    const n = parseInt(hex.slice(1, 7), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`;
  }
  function readRgb(el) {
    const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
    if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])];
    return [255, 255, 255];
  }
  function mixHex(hex, bg, alpha) {
    if (!hex.startsWith("#") || hex.length < 7) return hex;
    const n = parseInt(hex.slice(1, 7), 16);
    const a = Math.min(Math.max(alpha, 0), 1);
    const r2 = Math.round((n >> 16 & 255) * a + bg[0] * (1 - a));
    const g = Math.round((n >> 8 & 255) * a + bg[1] * (1 - a));
    const b = Math.round((n & 255) * a + bg[2] * (1 - a));
    return `rgb(${r2},${g},${b})`;
  }

  // src/core/marks.ts
  var ATTR_MARK = "custom-mindmap-mark";
  var MARK_ICONS = ["\u2B50", "\u{1F525}", "\u2757", "\u2705", "\u{1F4CC}", "\u{1F4A1}", "\u{1F41E}", "\u{1F6A7}"];
  var MARK_COLORS = ["#e5534b", "#e08a2e", "#d4a72c", "#4caf7d", "#3b9ae1", "#8b5cf6", "#e2569a", "#8a8f98"];
  var MARK_LABEL_MAX = 8;
  function decodeMark(raw) {
    if (!raw) return void 0;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      const bare = raw.trim();
      return bare && !bare.startsWith("{") ? { icon: bare.slice(0, 4) } : void 0;
    }
    if (!obj || typeof obj !== "object") return void 0;
    const src = obj;
    const mark = {};
    if (typeof src.icon === "string" && src.icon.trim()) mark.icon = src.icon.trim().slice(0, 4);
    if (typeof src.label === "string" && src.label.trim()) mark.label = src.label.trim().slice(0, MARK_LABEL_MAX);
    if (typeof src.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(src.color.trim())) mark.color = src.color.trim();
    return hasMark(mark) ? mark : void 0;
  }
  function encodeMark(mark) {
    if (!mark) return null;
    const out = {};
    if (mark.icon) out.icon = mark.icon.slice(0, 4);
    if (mark.label) out.label = mark.label.slice(0, MARK_LABEL_MAX);
    if (mark.color) out.color = mark.color;
    return hasMark(out) ? JSON.stringify(out) : null;
  }
  function hasMark(mark) {
    return !!mark && !!(mark.icon || mark.label || mark.color);
  }
  function sameMark(a, b) {
    const na = hasMark(a) ? encodeMark(a) : null;
    const nb = hasMark(b) ? encodeMark(b) : null;
    return na === nb;
  }

  // src/core/parser.ts
  var ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
  var HAS_TAG = /<(?!br\s*\/?>)[a-z!/][^>]*>/i;
  function cleanText(s) {
    return s.replace(ZERO_WIDTH, "").trim();
  }
  function parseList(listEl, path = "") {
    const subtype = listEl.dataset.subtype ?? "u";
    const numbered = subtype === "o";
    const kind = subtype === "t" ? "task" : numbered ? "ordered" : "bullet";
    const ownerListId = listEl.dataset.nodeId ?? "";
    const items = [];
    for (const child of Array.from(listEl.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.classList.contains("list")) {
        items.push(...parseList(child, path ? `${path}.${items.length + 1}` : `${items.length + 1}`));
        continue;
      }
      if (!child.classList.contains("li")) continue;
      const li = child;
      const contentEl = findContentEl(li);
      const subList = findSubListEl(li);
      const order = path ? `${path}.${items.length + 1}` : `${items.length + 1}`;
      const children = subList ? parseList(subList, order) : [];
      const html = contentEl ? sanitizeInline(contentEl.innerHTML) : "";
      const text = cleanText(contentEl?.textContent ?? "");
      const hasRich = HAS_TAG.test(html);
      if (!text && !hasRich && children.length === 0) continue;
      items.push({
        id: li.dataset.nodeId ?? "",
        contentId: contentEl?.dataset.nodeId ?? "",
        listId: ownerListId,
        subListId: subList?.dataset.nodeId ?? "",
        html: html || escapeHtml(text),
        text,
        kind,
        checked: li.classList.contains("protyle-task--done") ? true : void 0,
        /**
         * 折叠状态**直接读大纲自己**（`.li[fold="1"]`）。
         *
         * 这是「导图 ↔ 大纲 双向同步」的读取侧：思源把列表项的折叠态存在
         * `fold` 属性上（并随文档持久化），所以只要读它，导图就天然
         * 「大纲什么状态、导图就是什么状态」，跨会话也一致 ——
         * 不再需要插件自己维护一份 `custom-mindmap-fold`。
         */
        folded: li.getAttribute("fold") === "1",
        /**
         * 节点标记（图标 / 标签 / 自定义色）。
         *
         * 思源把块的自定义属性**原样渲染成块元素的属性**（`custom-mindmap`
         * 在 `.list` 上就是这么读的），所以这里直接读 `.li` 上的同名属性即可，
         * 不需要额外打一次 `/api/attr/getBlockAttrs`。
         * 读不到 / 读坏了都返回 undefined（见 marks.ts 的宽容解析）。
         */
        mark: decodeMark(li.getAttribute(ATTR_MARK)),
        numbered,
        order,
        children,
        depth: 0,
        branch: -1,
        color: null,
        w: 0,
        h: 0,
        x: 0,
        y: 0,
        kids: [],
        parent: null,
        dir: 1,
        cross: 0,
        slot: 0,
        cy: 0,
        d0: 0,
        d1: 0
      });
    }
    return items;
  }
  function findContentEl(li) {
    for (const el of Array.from(li.children)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.classList.contains("list")) continue;
      if (el.classList.contains("protyle-action")) continue;
      if (el.hasAttribute("data-node-id")) return el;
    }
    return null;
  }
  function findSubListEl(li) {
    for (const el of Array.from(li.children)) {
      if (el instanceof HTMLElement && el.classList.contains("list")) return el;
    }
    return null;
  }
  var DROP_SELECTOR = '[class*="protyle-"], .img__net';
  function sanitizeInline(html) {
    const basic = sanitizeByRegex(html);
    if (!basic) return "";
    if (typeof document === "undefined" || typeof document.createElement !== "function") return basic;
    try {
      return sanitizeByDom(basic) || basic;
    } catch {
      return basic;
    }
  }
  function sanitizeByRegex(html) {
    return html.replace(ZERO_WIDTH, "").replace(/\scontenteditable="(?!false)[^"]*"/g, "").replace(/\sspellcheck="[^"]*"/g, "").replace(/\sdata-render="[^"]*"/g, "").replace(/\sclass="protyle-wysiwyg--select"/g, "").trim();
  }
  var UNWRAP_TAGS = ["div", "p", "section", "article", "blockquote", "figure", "ul", "ol", "li"];
  function sanitizeByDom(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const frag = tpl.content;
    if (!frag) return html;
    frag.querySelectorAll(DROP_SELECTOR).forEach((el) => el.remove());
    for (let round = 0; round < 4; round++) {
      let hit = false;
      for (const tag of UNWRAP_TAGS) {
        frag.querySelectorAll(tag).forEach((el) => {
          const parent = el.parentNode;
          if (!parent) return;
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
          hit = true;
        });
      }
      if (!hit) break;
    }
    frag.querySelectorAll("img").forEach((img) => {
      const real = img.getAttribute("data-src") || img.getAttribute("src") || "";
      if (real) img.setAttribute("src", real);
      img.removeAttribute("loading");
      img.removeAttribute("data-src");
    });
    frag.querySelectorAll("*").forEach((el) => {
      const ce = el.getAttribute("contenteditable");
      if (ce !== null && ce !== "false") el.removeAttribute("contenteditable");
      el.removeAttribute("spellcheck");
      el.removeAttribute("data-render");
      el.removeAttribute("data-node-id");
      if (el.classList?.contains("protyle-wysiwyg--select")) el.classList.remove("protyle-wysiwyg--select");
    });
    frag.querySelectorAll("span").forEach((el) => {
      if (el.attributes.length === 0 && el.children.length === 0 && !(el.textContent ?? "").trim()) el.remove();
    });
    const box = document.createElement("div");
    box.appendChild(frag);
    return box.innerHTML.trim();
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }
  function decorate(root, palette, useBranchColor) {
    let count = 0;
    let maxDepth = 0;
    root.depth = 0;
    root.branch = -1;
    root.order = "1";
    root.parent = null;
    const walk = (node) => {
      count++;
      if (node.depth > maxDepth) maxDepth = node.depth;
      node.children.forEach((c, i) => {
        c.depth = node.depth + 1;
        c.branch = node.depth === 0 ? i : node.branch;
        c.order = `${node.order}.${i + 1}`;
        c.parent = node;
        walk(c);
      });
    };
    walk(root);
    const paint = (n) => {
      n.color = n.depth === 0 ? null : useBranchColor && n.branch >= 0 ? palette[n.branch % palette.length] : palette[0];
      n.children.forEach(paint);
    };
    paint(root);
    return { count, maxDepth };
  }
  function wrapRoot(items, title) {
    if (items.length === 1) return items[0];
    return {
      id: "",
      contentId: "",
      listId: items[0]?.listId ?? "",
      subListId: "",
      html: escapeHtml(title),
      text: title,
      kind: "heading",
      folded: false,
      numbered: false,
      order: "1",
      children: items,
      depth: 0,
      branch: -1,
      color: null,
      w: 0,
      h: 0,
      x: 0,
      y: 0,
      kids: [],
      parent: null,
      dir: 1,
      cross: 0,
      slot: 0,
      cy: 0,
      d0: 0,
      d1: 0
    };
  }
  function flatten(root) {
    const out = [];
    const walk = (n) => {
      out.push(n);
      n.children.forEach(walk);
    };
    walk(root);
    return out;
  }
  function indexById(root) {
    const map = /* @__PURE__ */ new Map();
    for (const n of flatten(root)) {
      if (n.id) map.set(n.id, n);
    }
    return map;
  }

  // src/core/tree.ts
  var NEW_NODE_TEXT = "\u65B0\u8282\u70B9";
  function shownChildren(n) {
    if (n.folded) return [];
    return n.children.some((c) => c.hidden) ? n.children.filter((c) => !c.hidden) : n.children;
  }
  function isAncestor(a, b) {
    let cur = b?.parent ?? null;
    while (cur) {
      if (cur === a) return true;
      cur = cur.parent;
    }
    return false;
  }
  function indexInParent(node) {
    return node.parent ? node.parent.children.indexOf(node) : -1;
  }
  function escapeMd(text) {
    let s = text.replace(/([\\`*_[\]])/g, "\\$1");
    s = s.replace(/^(\s*)([-+>#~|])/, (_m, sp, ch) => `${sp}\\${ch}`);
    s = s.replace(/^(\s*)(\d+)([.)])/, (_m, sp, num, dot) => `${sp}${num}\\${dot}`);
    return s;
  }
  var HAS_TAG2 = /<(?!br\s*\/?>)[a-z!/][^>]*>/i;
  function hasInlineFormat(node) {
    return HAS_TAG2.test(node.html ?? "");
  }
  var IMG_SPAN_RE = /<span[^>]*data-type="img"[^>]*>\s*<img\b([^>]*?)\/?>\s*<\/span>/gi;
  var IMG_RE = /<img\b([^>]*?)\/?>/gi;
  function inlineOf(node) {
    const html = (node.html ?? "").trim();
    if (!html || !HAS_TAG2.test(html)) return escapeMd(node.text);
    const imgMd = (attrs) => {
      const src = attrs.match(/\bsrc="([^"]*)"/i)?.[1] ?? "";
      const alt = (attrs.match(/\balt="([^"]*)"/i)?.[1] ?? "").replace(/[[\]()]/g, "");
      return src ? `![${alt}](${src})` : "";
    };
    return html.replace(/\r?\n+/g, " ").replace(IMG_SPAN_RE, (_m, attrs) => imgMd(attrs)).replace(IMG_RE, (_m, attrs) => imgMd(attrs)).trim();
  }
  function markerOf(node) {
    if (node.kind === "task") return "- [ ]";
    if (node.numbered) return "1.";
    return "-";
  }
  function serializeSubtree(node, depth = 0) {
    const indent = "  ".repeat(depth);
    const line = `${indent}${markerOf(node)} ${inlineOf(node)}`;
    if (node.children.length === 0) return line;
    return [line, ...node.children.map((c) => serializeSubtree(c, depth + 1))].join("\n");
  }
  function canIndent(node) {
    return !!node.id && indexInParent(node) > 0;
  }
  function canOutdent(node) {
    return !!node.id && !!node.parent?.id;
  }
  function canMoveUp(node) {
    return !!node.id && indexInParent(node) > 0;
  }
  function canMoveDown(node) {
    const idx = indexInParent(node);
    return !!node.id && !!node.parent && idx >= 0 && idx < node.parent.children.length - 1;
  }
  function canDelete(node) {
    return !!node.id;
  }
  function canEdit(node) {
    return !!node.contentId;
  }

  // src/core/layout.ts
  function layout(root, opt) {
    const { mode, gapX, gapY, padX, padY } = opt;
    const maxCross = opt.maxCross ?? 0;
    const isTree = mode === "tree";
    const crossSelf = (n) => isTree ? n.w : n.h;
    const depthSelf = (n) => isTree ? n.h : n.w;
    function measure(n) {
      n.kids = shownChildren(n);
      const self = crossSelf(n);
      if (n.kids.length === 0) {
        n.cross = self;
        return self;
      }
      let total = 0;
      n.kids.forEach((k, i) => {
        total += measure(k);
        if (i > 0) total += gapY;
      });
      n.cross = Math.max(total, self);
      return n.cross;
    }
    function placeCross(n, start) {
      n.slot = start;
      const kids = n.kids;
      const self = crossSelf(n);
      if (kids.length === 0) {
        n.cy = start + self / 2;
        return;
      }
      let total = 0;
      kids.forEach((k, i) => {
        total += k.cross;
        if (i > 0) total += gapY;
      });
      let cur = start + (n.cross - total) / 2;
      for (const k of kids) {
        placeCross(k, cur);
        cur += k.cross + gapY;
      }
      const mid = (kids[0].cy + kids[kids.length - 1].cy) / 2;
      const half = self / 2;
      n.cy = Math.min(Math.max(mid, start + half), start + n.cross - half);
    }
    function placeDepth(n, d) {
      n.d0 = d;
      n.d1 = d + depthSelf(n);
      for (const k of n.kids) placeDepth(k, n.d1 + gapX);
    }
    function layoutColumns(r2, colGapX, colGapY, limit) {
      const kids = r2.kids;
      const total = r2.cross;
      const want = Math.max(2, Math.ceil(total / limit));
      const cap = total / want;
      const groups = [];
      let cur = [];
      let curH = 0;
      for (const k of kids) {
        const add = cur.length === 0 ? k.cross : k.cross + colGapY;
        if (cur.length > 0 && curH + add > cap && groups.length < want - 1) {
          groups.push(cur);
          cur = [k];
          curH = k.cross;
        } else {
          cur.push(k);
          curH += add;
        }
      }
      if (cur.length > 0) groups.push(cur);
      const colH = [];
      const colW = [];
      for (const g of groups) {
        let h = 0;
        g.forEach((k, i) => {
          h += k.cross + (i > 0 ? colGapY : 0);
        });
        colH.push(h);
        let y = 0;
        for (const k of g) {
          placeCross(k, y);
          y += k.cross + colGapY;
        }
        for (const k of g) placeDepth(k, 0);
        let w = 0;
        const depthEnd = (n) => {
          w = Math.max(w, n.d1);
          n.kids.forEach(depthEnd);
        };
        g.forEach(depthEnd);
        colW.push(w);
      }
      const maxH = Math.max(...colH);
      const colX = [];
      let x = r2.w + colGapX;
      for (let i = 0; i < groups.length; i++) {
        colX.push(x);
        x += colW[i] + colGapX * 2;
      }
      groups.forEach((g, i) => {
        const yOff = (maxH - colH[i]) / 2;
        const place = (n) => {
          n.x = n.d0 + colX[i];
          n.y = n.cy - n.h / 2 + yOff;
          n.dir = 1;
          n.kids.forEach(place);
        };
        g.forEach(place);
      });
      r2.kids = r2.children;
      r2.dir = 1;
      r2.x = 0;
      r2.y = maxH / 2 - r2.h / 2;
      r2.cy = r2.y + r2.h / 2;
    }
    if (mode === "mind") {
      const all = root.folded ? [] : root.children;
      const mid = Math.ceil(all.length / 2);
      const sides = [
        { kids: all.slice(0, mid), dir: 1 },
        { kids: all.slice(mid), dir: -1 }
      ];
      root.kids = [];
      root.cross = crossSelf(root);
      root.slot = 0;
      const collected = [];
      for (const { kids, dir } of sides) {
        if (kids.length === 0) continue;
        kids.forEach(measure);
        let total = 0;
        kids.forEach((k, i) => {
          total += k.cross;
          if (i > 0) total += gapY;
        });
        let cur = -total / 2;
        for (const k of kids) {
          placeCross(k, cur);
          cur += k.cross + gapY;
        }
        for (const k of kids) placeDepth(k, dir === 1 ? root.w + gapX : gapX);
        const collect = (n) => {
          n.dir = dir;
          collected.push(n);
          n.kids.forEach(collect);
        };
        kids.forEach(collect);
      }
      root.kids = sides[0].kids.concat(sides[1].kids);
      root.dir = 1;
      root.d0 = 0;
      root.d1 = root.w;
      for (const n of collected) {
        n.y = n.cy - crossSelf(n) / 2;
        n.x = n.dir === 1 ? n.d0 : -n.d1;
      }
      root.x = 0;
      root.y = -root.h / 2;
    } else {
      measure(root);
      if (mode === "logic" && maxCross > 0 && root.children.length > 1 && root.cross > maxCross) {
        layoutColumns(root, gapX, gapY, maxCross);
      } else {
        placeCross(root, 0);
        placeDepth(root, 0);
        const toXY = (n) => {
          if (isTree) {
            n.x = n.cy - n.w / 2;
            n.y = n.d0;
          } else {
            n.y = n.cy - n.h / 2;
            n.x = n.d0;
          }
          n.dir = 1;
          n.kids.forEach(toXY);
        };
        toXY(root);
      }
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const scan = (n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
      n.kids.forEach(scan);
    };
    scan(root);
    const ox = padX - minX;
    const oy = padY - minY;
    const shift = (n) => {
      n.x += ox;
      n.y += oy;
      n.kids.forEach(shift);
    };
    shift(root);
    return { w: maxX - minX + padX * 2, h: maxY - minY + padY * 2 };
  }

  // src/core/edge.ts
  var MIN_TRUNK = 13;
  var MAX_TRUNK = 42;
  var MAX_RADIUS = 9;
  var r = (n) => Math.round(n * 100) / 100;
  function buildConnectors(input) {
    const { parent, kids, mode, style, gap, base, kidDash } = input;
    if (kids.length === 0) return [];
    const trunk = Math.max(MIN_TRUNK, Math.min(gap * 0.44, MAX_TRUNK));
    const spineW = Math.max(1, base * 0.75);
    const stubW = Math.max(1, base * 0.5);
    const radius = Math.max(3, Math.min(trunk * 0.5, MAX_RADIUS));
    return mode === "tree" ? vertical(parent, kids, style, trunk, base, spineW, stubW, radius, kidDash) : horizontal(parent, kids, style, trunk, base, spineW, stubW, radius, kidDash);
  }
  function vertical(parent, kids, style, trunk, base, spineW, stubW, radius, kidDash) {
    const px = parent.x + parent.w / 2;
    const py = parent.y + parent.h;
    const out = [];
    const dashAt = (i) => kidDash?.[i] ? { dash: kidDash[i] } : {};
    if (style === "straight") {
      kids.forEach((k, i) => {
        out.push({
          d: `M${r(px)},${r(py)} L${r(k.x + k.w / 2)},${r(k.y)}`,
          width: stubW,
          kind: "stub",
          childIndex: i,
          ...dashAt(i)
        });
      });
      return out;
    }
    const sy = py + trunk;
    const xs = kids.map((k) => k.x + k.w / 2);
    out.push({ d: `M${r(px)},${r(py)} L${r(px)},${r(sy)}`, width: base, kind: "trunk", childIndex: null });
    out.push({
      d: `M${r(Math.min(px, ...xs))},${r(sy)} L${r(Math.max(px, ...xs))},${r(sy)}`,
      width: spineW,
      kind: "spine",
      childIndex: null
    });
    kids.forEach((k, i) => {
      const kx = k.x + k.w / 2;
      const ky = k.y;
      const dx = Math.sign(kx - px);
      if (style === "elbow" || dx === 0 || Math.abs(kx - px) < radius * 1.2) {
        out.push({
          d: `M${r(kx)},${r(sy)} L${r(kx)},${r(ky)}`,
          width: stubW,
          kind: "stub",
          childIndex: i,
          ...dashAt(i)
        });
      } else {
        const x0 = kx - dx * radius;
        out.push({
          d: `M${r(x0)},${r(sy)} Q${r(kx)},${r(sy)} ${r(kx)},${r(sy + radius)} L${r(kx)},${r(ky)}`,
          width: stubW,
          kind: "stub",
          childIndex: i,
          ...dashAt(i)
        });
      }
    });
    return out;
  }
  function horizontal(parent, kids, style, trunk, base, spineW, stubW, radius, kidDash) {
    const out = [];
    const groups = /* @__PURE__ */ new Map();
    kids.forEach((k, i) => {
      const list = groups.get(k.dir);
      if (list) list.push({ k, i });
      else groups.set(k.dir, [{ k, i }]);
    });
    for (const [dir, group] of groups) {
      const px = dir === 1 ? parent.x + parent.w : parent.x;
      const py = parent.y + parent.h / 2;
      if (style === "straight") {
        for (const { k, i } of group) {
          const kx = dir === 1 ? k.x : k.x + k.w;
          out.push({
            d: `M${r(px)},${r(py)} L${r(kx)},${r(k.y + k.h / 2)}`,
            width: stubW,
            kind: "stub",
            childIndex: i,
            ...kidDash?.[i] ? { dash: kidDash[i] } : {}
          });
        }
        continue;
      }
      const sx = px + dir * trunk;
      const cys = group.map(({ k }) => k.y + k.h / 2);
      out.push({ d: `M${r(px)},${r(py)} L${r(sx)},${r(py)}`, width: base, kind: "trunk", childIndex: null });
      out.push({
        d: `M${r(sx)},${r(Math.min(py, ...cys))} L${r(sx)},${r(Math.max(py, ...cys))}`,
        width: spineW,
        kind: "spine",
        childIndex: null
      });
      for (const { k, i } of group) {
        const kx = dir === 1 ? k.x : k.x + k.w;
        const ky = k.y + k.h / 2;
        const dy = Math.sign(ky - py);
        const dash = kidDash?.[i] ? { dash: kidDash[i] } : {};
        if (style === "elbow" || dy === 0 || Math.abs(ky - py) < radius * 1.2) {
          out.push({
            d: `M${r(sx)},${r(ky)} L${r(kx)},${r(ky)}`,
            width: stubW,
            kind: "stub",
            childIndex: i,
            ...dash
          });
        } else {
          const y0 = ky - dy * radius;
          out.push({
            d: `M${r(sx)},${r(y0)} Q${r(sx)},${r(ky)} ${r(sx + dir * radius)},${r(ky)} L${r(kx)},${r(ky)}`,
            width: stubW,
            kind: "stub",
            childIndex: i,
            ...dash
          });
        }
      }
    }
    return out;
  }

  // src/generated/style.ts
  var PLUGIN_CSS = '/* ============================================================================\n   \u5927\u7EB2\u5BFC\u56FE (siyuan-plugin-mindmap)\n   ----------------------------------------------------------------------------\n   \u7EA6\u5B9A\uFF1A\u6240\u6709\u9009\u62E9\u5668\u90FD\u6302\u5728 .mm-root \u4E4B\u4E0B\uFF0C\u7981\u6B62\u88F8\u6807\u7B7E\u9009\u62E9\u5668\uFF0C\u907F\u514D\u6C61\u67D3\u6B63\u6587\u3002\n   \u989C\u8272\u53EA\u901A\u8FC7 --mm-* \u4E0E --c-* \u81EA\u5B9A\u4E49\u5C5E\u6027\u6CE8\u5165\uFF0C\u4E0D\u76F4\u63A5\u5F15\u7528\u601D\u6E90\u7684 --b3-* \u53D8\u91CF\uFF0C\n   \u8FD9\u6837\u5BFC\u51FA SVG \u65F6\u628A\u53D8\u91CF\u89E3\u6790\u6210\u5177\u4F53\u503C\u5373\u53EF\u5B8C\u6574\u8FD8\u539F\u5916\u89C2\u3002\n\n   \u6CE8\u610F\uFF1A.mm-node \u5FC5\u987B\u7528 width: max-content\u3002\n   \u5B83\u548C .mm-world / .mm-nodes \u90FD\u662F\u7EDD\u5BF9\u5B9A\u4F4D\uFF0C\u82E5\u7528 width: auto \u4F1A\u9000\u5316\u6210\n   shrink-to-fit\uFF0C\u800C .mm-nodes \u6CA1\u6709\u5728\u6D41\u5B50\u5143\u7D20 \u2192 \u53EF\u7528\u5BBD\u5EA6 0 \u2192 \u8282\u70B9\u5BBD\u5EA6\u574D\u7F29\u6210\n   \u4E00\u4E2A\u6C49\u5B57\u5BBD\uFF0C\u4E2D\u6587\u4F1A\u9010\u5B57\u7AD6\u6392\u3002max-content \u76F4\u63A5\u7ED5\u8FC7\u8FD9\u6761\u94FE\u8DEF\u3002\n   ============================================================================ */\n\n/* ---------------------------------------------------------------- \u6E90\u5217\u8868\u9690\u85CF */\n\n.mm-source-hidden {\n    padding: 0 !important;\n    margin: 0 !important;\n    background: transparent !important;\n    border: 0 !important;\n}\n\n.mm-source-hidden > :not(.mm-root) {\n    display: none !important;\n}\n\n/* \u300C\u8282\u70B9\u8FC7\u591A\u300D\u63D0\u793A\u6001\uFF1A\u53EA\u4FDD\u7559\u63D0\u793A\u6761 */\n.mm-notice-mode > :not(.mm-notice) {\n    display: none !important;\n}\n\n.mm-notice {\n    display: flex;\n    align-items: center;\n    gap: 10px;\n    flex-wrap: wrap;\n    padding: 10px 12px;\n    margin: 4px 0;\n    border-radius: 8px;\n    border: 1px dashed var(--b3-border-color, rgba(128, 128, 128, 0.4));\n    background: var(--b3-theme-surface, rgba(127, 127, 127, 0.08));\n    color: var(--b3-theme-on-surface, inherit);\n    font-size: 13px;\n    line-height: 1.5;\n}\n\n/* -------------------------------------------------------------------- \u6839\u5BB9\u5668 */\n\n.mm-root {\n    position: relative;\n    display: flex;\n    flex-direction: column;\n    box-sizing: border-box;\n    margin: 8px 0;\n    border-radius: 12px;\n    overflow: hidden;\n    outline: none;\n    font-family: var(--mm-font, sans-serif);\n    color: var(--mm-node-text);\n    background-color: var(--mm-canvas-solid);\n    background-image:\n        radial-gradient(circle, var(--mm-canvas-grid) 1.2px, transparent 1.2px),\n        var(--mm-canvas-bg);\n    background-size: 22px 22px, auto;\n    background-position: 0 0, 0 0;\n}\n\n.mm-root.mm-root--dialog,\n.mm-root.mm-root--side {\n    margin: 0;\n    height: 100%;\n    border-radius: 0;\n}\n\n.mm-dialog-body {\n    height: 100%;\n    overflow: hidden;\n}\n\n/* -------------------------------------------------------------------- \u5DE5\u5177\u6761 */\n\n.mm-root .mm-toolbar {\n    display: flex;\n    flex-wrap: wrap;\n    align-items: center;\n    gap: 4px;\n    flex: 0 0 auto;\n    padding: 6px 10px;\n    border-bottom: 1px solid var(--mm-node-border);\n    background: color-mix(in srgb, var(--mm-canvas-solid) 82%, transparent);\n    user-select: none;\n    z-index: 5;\n}\n\n.mm-root .mm-spacer {\n    flex: 1 1 auto;\n}\n\n.mm-root .mm-group {\n    display: flex;\n    align-items: center;\n    gap: 2px;\n}\n\n.mm-root .mm-sep {\n    width: 1px;\n    height: 16px;\n    margin: 0 5px;\n    background: var(--mm-node-border);\n    flex: 0 0 auto;\n}\n\n.mm-root .mm-toolbar button {\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    gap: 5px;\n    font-family: inherit;\n    font-size: 12px;\n    line-height: 1;\n    padding: 5px 9px;\n    border-radius: 6px;\n    border: 1px solid transparent;\n    background: transparent;\n    color: var(--mm-node-text);\n    cursor: pointer;\n    white-space: nowrap;\n    transition: background 0.15s, border-color 0.15s, color 0.15s;\n}\n\n.mm-root .mm-toolbar button:hover {\n    background: color-mix(in srgb, var(--mm-node-text) 12%, transparent);\n}\n\n.mm-root .mm-toolbar button:active {\n    transform: translateY(1px);\n}\n\n.mm-root .mm-toolbar button.mm-icon {\n    padding: 5px 7px;\n}\n\n.mm-root .mm-toolbar button svg {\n    width: 13px;\n    height: 13px;\n    flex: 0 0 auto;\n    display: block;\n}\n\n/* \u5E03\u5C40\u5207\u6362\uFF1A\u5206\u6BB5\u63A7\u4EF6 */\n.mm-root .mm-seg {\n    display: flex;\n    gap: 2px;\n    padding: 2px;\n    border-radius: 8px;\n    background: color-mix(in srgb, var(--mm-node-text) 9%, transparent);\n}\n\n.mm-root .mm-seg button {\n    border: 0;\n    background: transparent;\n    padding: 5px 10px;\n}\n\n.mm-root .mm-seg button.mm-on {\n    background: var(--mm-accent);\n    color: #ffffff;\n    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);\n}\n\n.mm-root .mm-seg button.mm-on:hover {\n    background: var(--mm-accent);\n}\n\n/* ---------------------------------------------------------------- \u72B6\u6001\u8FC7\u6EE4 chip\uFF08P1-1\uFF09\n *\n * \u548C\u5E03\u5C40\u5206\u6BB5\u63A7\u4EF6\u523B\u610F\u505A\u5F97**\u4E0D\u4E00\u6837**\uFF1A\u5E03\u5C40\u662F\u300C\u4E09\u9009\u4E00\u7684\u6A21\u5F0F\u300D\uFF0C\u7528\u7684\u662F\u5B9E\u5FC3\u9AD8\u4EAE\u5757\uFF1B\n * \u8FC7\u6EE4\u662F\u300C\u7B5B\u9009\u6761\u4EF6\u300D\uFF0C\u7528\u4E00\u4E2A\u63CF\u8FB9 + \u6DE1\u6DE1\u5E95\u8272\u7684\u80F6\u56CA\u5C31\u591F\u3002\n * \u4E24\u7EC4\u90FD\u505A\u6210\u5B9E\u5FC3\u5757\u7684\u8BDD\uFF0C\u5DE5\u5177\u6761\u4E0A\u4F1A\u51FA\u73B0\u4E24\u6392\u957F\u5F97\u5F88\u50CF\u7684\u6309\u94AE\uFF0C\n * \u7528\u6237\u5206\u4E0D\u6E05\u54EA\u4E2A\u4F1A\u6539\u53D8\u8FD9\u5F20\u56FE\u7684\u6027\u8D28\u3002\n *\n * \u5BBD\u5EA6\u4E0A chip \u4E5F\u523B\u610F\u6BD4\u5E03\u5C40\u6309\u94AE\u7A84\uFF08`\u5168\u90E8 / \u672A\u5B8C\u6210 / \u5DF2\u5B8C\u6210` \u4E09\u4E2A\u52A0\u8D77\u6765\n * \u6BD4 `\u903B\u8F91\u7ED3\u6784\u56FE / \u601D\u7EF4\u5BFC\u56FE / \u6811\u72B6\u56FE` \u77ED\u5F97\u591A\uFF09\uFF0C\u8BA9\u89C6\u89C9\u91CD\u5FC3\u7559\u5728\u5E03\u5C40\u4E0A\u3002\n */\n.mm-root .mm-filters button {\n    padding: 4px 8px;\n    border: 1px solid transparent;\n    border-radius: 999px;\n    font-size: 12px;\n    color: var(--mm-node-text);\n    opacity: 0.72;\n}\n\n.mm-root .mm-filters button:hover {\n    opacity: 1;\n    background: color-mix(in srgb, var(--mm-node-text) 10%, transparent);\n}\n\n.mm-root .mm-filters button.mm-on {\n    opacity: 1;\n    border-color: color-mix(in srgb, var(--mm-accent) 62%, transparent);\n    background: color-mix(in srgb, var(--mm-accent) 16%, transparent);\n    color: var(--mm-accent);\n    font-weight: 600;\n}\n\n/* ---------------------------------------------------------------- \u641C\u7D22\u8303\u56F4\u5F00\u5173 */\n\n.mm-root .mm-search .mm-search-scope {\n    width: auto;\n    min-width: 46px;\n    padding: 0 7px;\n    border: 1px solid color-mix(in srgb, var(--mm-node-text) 22%, transparent);\n    border-radius: 999px;\n    font-size: 11.5px;\n}\n\n.mm-root .mm-search .mm-search-scope.mm-on {\n    border-color: color-mix(in srgb, var(--mm-accent) 62%, transparent);\n    background: color-mix(in srgb, var(--mm-accent) 16%, transparent);\n    color: var(--mm-accent);\n    font-weight: 600;\n}\n\n.mm-root .mm-zoom-label {\n    min-width: 42px;\n    text-align: center;\n    font-size: 11.5px;\n    opacity: 0.72;\n    font-variant-numeric: tabular-nums;\n}\n\n/* ---------------------------------------------------------------- \u8282\u70B9\u6807\u8BB0\uFF08P1-2\uFF09 */\n\n/* \u56FE\u6807\u5728\u6587\u5B57\u524D\u3001\u6807\u7B7E\u5728\u6587\u5B57\u540E\uFF0C\u89C1 renderer.createNodeEl \u7684\u6CE8\u91CA */\n.mm-root .mm-mark-icon {\n    flex: 0 0 auto;\n    font-size: 13px;\n    line-height: 1;\n}\n\n/* \u6807\u7B7E\u7528 `--c-solid`\uFF08\u8282\u70B9\u81EA\u5DF1\u7684\u8272\uFF09\u800C\u4E0D\u662F\u56FA\u5B9A\u8272\uFF1A\n   \u8BBE\u4E86\u81EA\u5B9A\u4E49\u8272\u7684\u8282\u70B9\uFF0C\u6807\u7B7E\u8DDF\u7740\u53D8\u6210\u90A3\u4E2A\u8272\uFF0C\u89C6\u89C9\u4E0A\u662F\u4E00\u4F53\u7684\u3002 */\n.mm-root .mm-mark-label {\n    flex: 0 0 auto;\n    padding: 1px 6px;\n    border-radius: 999px;\n    border: 1px solid color-mix(in srgb, var(--c-solid) 42%, transparent);\n    background: color-mix(in srgb, var(--c-solid) 18%, transparent);\n    color: var(--c-solid);\n    font-size: 11px;\n    font-weight: 600;\n    line-height: 1.5;\n    white-space: nowrap;\n}\n\n/* ---- \u6807\u8BB0\u6D6E\u5C42 ---- */\n.mm-root .mm-mark-pop {\n    position: absolute;\n    z-index: 20;\n    display: flex;\n    flex-direction: column;\n    gap: 6px;\n    min-width: 236px;\n    padding: 9px 11px;\n    border-radius: 10px;\n    border: 1px solid var(--mm-node-border);\n    background: var(--mm-canvas-solid);\n    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3);\n}\n\n.mm-root .mm-mark-pop .mm-mark-row {\n    display: flex;\n    align-items: center;\n    gap: 4px;\n}\n\n.mm-root .mm-mark-pop .mm-mark-cap {\n    flex: 0 0 30px;\n    font-size: 11.5px;\n    opacity: 0.6;\n}\n\n.mm-root .mm-mark-pop .mm-mark-row button {\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    width: 24px;\n    height: 24px;\n    padding: 0;\n    border: 1px solid transparent;\n    border-radius: 6px;\n    background: transparent;\n    color: var(--mm-node-text);\n    cursor: pointer;\n    font-size: 14px;\n    line-height: 1;\n}\n\n.mm-root .mm-mark-pop .mm-mark-row button:hover {\n    background: color-mix(in srgb, var(--mm-node-text) 12%, transparent);\n}\n\n.mm-root .mm-mark-pop .mm-mark-row button.mm-on {\n    border-color: var(--mm-accent);\n    background: color-mix(in srgb, var(--mm-accent) 20%, transparent);\n}\n\n.mm-root .mm-mark-pop .mm-mark-swatch {\n    border-radius: 50%;\n    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);\n}\n\n/* \u300C\u8DDF\u968F\u5206\u652F\u8272\u300D\u90A3\u4E2A\uFF1A\u7A7A\u5FC3\u865A\u7EBF\u5708\uFF0C\u548C\u5B9E\u5FC3\u8272\u5757\u533A\u5206\u5F00 */\n.mm-root .mm-mark-pop .mm-mark-swatch--def {\n    border: 1px dashed color-mix(in srgb, var(--mm-node-text) 45%, transparent);\n    background: transparent;\n}\n\n.mm-root .mm-mark-pop .mm-mark-swatch--def.mm-on {\n    border-style: solid;\n    border-color: var(--mm-accent);\n}\n\n.mm-root .mm-mark-pop .mm-mark-input {\n    flex: 1 1 auto;\n    min-width: 0;\n    padding: 3px 6px;\n    border: 1px solid color-mix(in srgb, var(--mm-node-text) 22%, transparent);\n    border-radius: 6px;\n    background: transparent;\n    color: var(--mm-node-text);\n    font-family: inherit;\n    font-size: 12px;\n    outline: none;\n}\n\n.mm-root .mm-mark-pop .mm-mark-input:focus {\n    border-color: var(--mm-accent);\n}\n\n.mm-root .mm-mark-pop .mm-mark-input::placeholder {\n    color: var(--mm-node-text);\n    opacity: 0.42;\n}\n\n.mm-root .mm-mark-pop .mm-mark-foot {\n    display: flex;\n    justify-content: space-between;\n    gap: 8px;\n    padding-top: 2px;\n}\n\n.mm-root .mm-mark-pop .mm-mark-foot button {\n    padding: 3px 9px;\n    border: 1px solid color-mix(in srgb, var(--mm-node-text) 22%, transparent);\n    border-radius: 6px;\n    background: transparent;\n    color: var(--mm-node-text);\n    font-family: inherit;\n    font-size: 12px;\n    cursor: pointer;\n}\n\n.mm-root .mm-mark-pop .mm-mark-foot button:hover {\n    background: color-mix(in srgb, var(--mm-node-text) 10%, transparent);\n}\n\n/* \u6CA1\u6709\u6807\u8BB0\u53EF\u6E05\u7684\u65F6\u5019\uFF0C\u6309\u94AE\u53D8\u7070\u4F46\u4E0D\u9690\u85CF \u2014\u2014 \u4F4D\u7F6E\u56FA\u5B9A\uFF0C\u7528\u6237\u4E0D\u4F1A\u89C9\u5F97\u5B83\u300C\u521A\u624D\u8FD8\u5728\u300D */\n.mm-root .mm-mark-pop .mm-mark-clear.mm-dim {\n    opacity: 0.38;\n    cursor: default;\n}\n\n.mm-root .mm-mark-pop .mm-mark-done {\n    border-color: var(--mm-accent);\n    color: var(--mm-accent);\n    font-weight: 600;\n}\n\n/* ---------------------------------------------------------------- \u81EA\u7ED8 tooltip */\n\n.mm-tip {\n    position: fixed;\n    z-index: 2147483000;\n    max-width: 260px;\n    padding: 5px 9px;\n    border-radius: 6px;\n    font-size: 12px;\n    line-height: 1.5;\n    pointer-events: none;\n    white-space: nowrap;\n    color: #ffffff;\n    background: rgba(18, 20, 26, 0.94);\n    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.34);\n    opacity: 0;\n    transition: opacity 0.12s ease;\n}\n\n.mm-tip.mm-tip--on {\n    opacity: 1;\n}\n\n.mm-tip kbd {\n    display: inline-block;\n    margin-left: 6px;\n    padding: 1px 5px;\n    border-radius: 4px;\n    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;\n    font-size: 11px;\n    color: #cfd6e4;\n    background: rgba(255, 255, 255, 0.13);\n}\n\n/* ---------------------------------------------------------------- \u753B\u5E03\u89C6\u53E3 */\n\n.mm-root .mm-viewport {\n    position: relative;\n    flex: 1 1 auto;\n    overflow: hidden;\n    cursor: grab;\n}\n\n.mm-root .mm-viewport.mm-grabbing {\n    cursor: grabbing;\n}\n\n.mm-root .mm-world {\n    position: absolute;\n    left: 0;\n    top: 0;\n    /*\n     * \u4E0D\u8981\u52A0 will-change: transform\u3002\n     * \u5B83\u4F1A\u628A .mm-world \u63D0\u5347\u6210\u72EC\u7ACB\u5408\u6210\u5C42\uFF0C\u800C\u5408\u6210\u5C42\u4E00\u65E6\u7F13\u5B58\u4E86\u4F4E\u5206\u8FA8\u7387\u4F4D\u56FE\uFF0C\n     * \u653E\u5927\u65F6\u6574\u68F5\u5B50\u6811\uFF08\u6587\u5B57 / \u63CF\u8FB9 / SVG \u8FDE\u7EBF\uFF09\u90FD\u4F1A\u4E00\u8D77\u53D8\u7CCA\u3002\n     * \u7F29\u653E\u4EA4\u7ED9 zoom \u505A\uFF08\u89C1 renderer.ts \u7684 updateTransform\uFF09\uFF0C\n     * transform \u53EA\u8D1F\u8D23\u5E73\u79FB \u2014\u2014 \u7EAF\u5E73\u79FB\u4E0D\u4F1A\u6539\u53D8\u6805\u683C\u5316\u500D\u7387\uFF0C\u4E0D\u5B58\u5728\u8FD9\u4E2A\u95EE\u9898\u3002\n     */\n    transform-origin: 0 0;\n}\n\n.mm-root .mm-edges {\n    position: absolute;\n    left: 0;\n    top: 0;\n    overflow: visible;\n    pointer-events: none;\n}\n\n.mm-root .mm-nodes {\n    position: absolute;\n    left: 0;\n    top: 0;\n}\n\n/* ---------------------------------------------------------------------- \u8282\u70B9 */\n\n.mm-root .mm-node {\n    /* \u5173\u952E\uFF1A\u7ED5\u8FC7 shrink-to-fit\uFF0C\u5426\u5219\u5BBD\u5EA6\u4F1A\u574D\u7F29\u5230\u4E00\u4E2A\u6C49\u5B57 */\n    width: max-content;\n    min-width: 52px;\n    position: absolute;\n    box-sizing: border-box;\n    border-radius: 8px;\n    cursor: pointer;\n    user-select: none;\n\n    /* \u5C42\u7EA7 token\uFF0C\u7531 .mm-d0 ~ .mm-d3 \u8986\u5199 */\n    --tier-font: 13px;\n    --tier-weight: 500;\n    --tier-pad-y: 8px;\n    --tier-pad-x: 13px;\n    --tier-radius: 8px;\n    --tier-stripe: 3px;\n    --tier-gap: 7px;\n}\n\n.mm-root .mm-node .mm-inner {\n    display: flex;\n    align-items: center;\n    gap: var(--tier-gap);\n    box-sizing: border-box;\n    padding: var(--tier-pad-y) var(--tier-pad-x);\n    border-radius: var(--tier-radius);\n    border: 1px solid transparent;\n    font-size: var(--tier-font);\n    font-weight: var(--tier-weight);\n    line-height: 1.45;\n    letter-spacing: 0.1px;\n}\n\n/* ---- \u5C42\u7EA7\u4F53\u7CFB\uFF1A\u4E2D\u5FC3\u4E3B\u9898 \u2192 \u4E00\u7EA7\u5206\u652F \u2192 \u4E8C\u7EA7 \u2192 \u4E09\u7EA7\u53CA\u4EE5\u4E0B ---- */\n\n/* d0 \u4E2D\u5FC3\u4E3B\u9898\uFF1A\u5B9E\u5FC3\u80F6\u56CA\uFF0C\u6700\u9AD8\u6743\u91CD */\n.mm-root .mm-d0 {\n    --tier-font: 16px;\n    --tier-weight: 600;\n    --tier-pad-y: 12px;\n    --tier-pad-x: 22px;\n    --tier-radius: 12px;\n    --tier-gap: 9px;\n}\n\n.mm-root .mm-d0 .mm-inner {\n    background: var(--mm-root-bg);\n    color: var(--mm-root-text);\n    border-color: transparent;\n    box-shadow: 0 6px 22px var(--mm-root-shadow);\n}\n\n/* d1 \u4E00\u7EA7\u5206\u652F\uFF1A\u5206\u652F\u8272\u6D45\u586B\u5145\u5361 */\n.mm-root .mm-d1 {\n    --tier-font: 14px;\n    --tier-weight: 600;\n    --tier-pad-y: 9px;\n    --tier-pad-x: 15px;\n    --tier-radius: 10px;\n}\n\n.mm-root .mm-d1 .mm-inner {\n    background: var(--c-bg);\n    border-color: var(--c-border);\n    color: var(--c-solid);\n    box-shadow: var(--mm-card-shadow);\n}\n\n/* d2 \u4E8C\u7EA7\uFF1A\u4E2D\u6027\u5361\u7247 + \u5DE6\u4FA7\u5206\u652F\u8272\u6761 */\n.mm-root .mm-d2 {\n    --tier-font: 13px;\n    --tier-weight: 500;\n    --tier-pad-y: 8px;\n    --tier-pad-x: 14px;\n}\n\n.mm-root .mm-d2 .mm-inner,\n.mm-root .mm-d3 .mm-inner,\n.mm-root .mm-d4 .mm-inner {\n    position: relative;\n    overflow: hidden;\n    background: var(--mm-node-bg);\n    border-color: var(--mm-node-border);\n    color: var(--mm-node-text);\n    box-shadow: var(--mm-card-shadow);\n}\n\n.mm-root .mm-d2 .mm-inner::before,\n.mm-root .mm-d3 .mm-inner::before,\n.mm-root .mm-d4 .mm-inner::before {\n    content: "";\n    position: absolute;\n    left: 0;\n    top: 0;\n    bottom: 0;\n    width: var(--tier-stripe);\n    background: var(--c-solid);\n    opacity: 0.85;\n}\n\n.mm-root .mm-d2 .mm-inner {\n    padding-left: calc(var(--tier-pad-x) + 4px);\n}\n\n/* d3+ \u66F4\u8F7B\uFF0C\u8272\u6761\u66F4\u7EC6 */\n.mm-root .mm-d3,\n.mm-root .mm-d4 {\n    --tier-font: 12.5px;\n    --tier-weight: 400;\n    --tier-pad-y: 6px;\n    --tier-pad-x: 12px;\n    --tier-stripe: 2px;\n}\n\n/* ---- \u72B6\u6001\uFF1A\u60AC\u505C / \u9009\u4E2D / \u5F31\u5316 ---- */\n\n.mm-root .mm-node:hover {\n    transform: translateY(-1px);\n    z-index: 6;\n}\n\n.mm-root .mm-node:hover .mm-inner {\n    box-shadow: 0 9px 26px var(--mm-hover-shadow);\n}\n\n.mm-root .mm-node.mm-sel {\n    z-index: 7;\n}\n\n.mm-root .mm-node.mm-sel .mm-inner {\n    box-shadow:\n        0 0 0 2px var(--mm-focus-ring, var(--mm-accent)),\n        0 10px 28px var(--mm-hover-shadow);\n}\n\n/* \u952E\u76D8\u7126\u70B9\u4E0E\u9F20\u6807\u9009\u4E2D\u533A\u5206\uFF1A\u952E\u76D8\u64CD\u4F5C\u65F6\u73AF\u66F4\u660E\u663E */\n.mm-root.mm-kbd .mm-node.mm-sel .mm-inner {\n    box-shadow:\n        0 0 0 2.5px var(--mm-focus-ring, var(--mm-accent)),\n        0 0 0 5px color-mix(in srgb, var(--mm-accent) 18%, transparent),\n        0 10px 28px var(--mm-hover-shadow);\n}\n\n.mm-root .mm-node.mm-dim {\n    opacity: 0.3;\n}\n\n/* \u641C\u7D22\u547D\u4E2D */\n.mm-root .mm-node.mm-hit .mm-inner {\n    box-shadow: 0 0 0 2px var(--mm-accent), 0 6px 20px var(--mm-hover-shadow);\n}\n\n.mm-root .mm-node.mm-hit-cur .mm-inner {\n    box-shadow:\n        0 0 0 2.5px var(--mm-accent),\n        0 0 0 6px color-mix(in srgb, var(--mm-accent) 22%, transparent),\n        0 6px 20px var(--mm-hover-shadow);\n}\n\n/* ------------------------------------------------------------------ \u8282\u70B9\u5185\u5BB9 */\n\n.mm-root .mm-txt {\n    min-width: 0;\n    /* \u7528 overflow-wrap \u800C\u4E0D\u662F word-break: break-word \u2014\u2014\n       \u540E\u8005\u7B49\u4EF7\u4E8E overflow-wrap: anywhere\uFF0C\u4F1A\u5F71\u54CD min-content \u5C3A\u5BF8\u3002 */\n    overflow-wrap: break-word;\n    max-width: 240px;\n}\n\n.mm-root .mm-txt p {\n    margin: 0;\n}\n\n.mm-root .mm-txt strong,\n.mm-root .mm-txt b,\n.mm-root .mm-txt [data-type="strong"] {\n    font-weight: 650;\n}\n\n.mm-root .mm-txt em,\n.mm-root .mm-txt i,\n.mm-root .mm-txt [data-type="em"] {\n    font-style: italic;\n}\n\n.mm-root .mm-txt u,\n.mm-root .mm-txt [data-type="u"] {\n    text-decoration: underline;\n    text-underline-offset: 2px;\n}\n\n.mm-root .mm-txt s,\n.mm-root .mm-txt [data-type="s"] {\n    text-decoration: line-through;\n}\n\n.mm-root .mm-txt code,\n.mm-root .mm-txt [data-type="code"] {\n    font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace;\n    font-size: 0.88em;\n    padding: 1px 5px;\n    border-radius: 4px;\n    background: color-mix(in srgb, var(--mm-node-text) 14%, transparent);\n}\n\n.mm-root .mm-txt mark,\n.mm-root .mm-txt [data-type="mark"] {\n    background: rgba(255, 196, 0, 0.32);\n    color: inherit;\n    border-radius: 3px;\n    padding: 0 2px;\n}\n\n.mm-root .mm-txt [data-type="block-ref"],\n.mm-root .mm-txt [data-type="a"] {\n    color: var(--c-solid);\n    text-decoration: underline;\n    text-underline-offset: 2px;\n    text-decoration-style: dotted;\n    cursor: pointer;\n    /* \u957F URL \u4E0D\u6362\u884C\u4F1A\u628A\u8282\u70B9\u6491\u5F97\u6781\u5BBD\uFF08\u5B9E\u6D4B\u80FD\u9876\u5230 310px\uFF0C\u8FDC\u8D85 max-width\uFF09 */\n    word-break: break-all;\n}\n\n.mm-root .mm-txt [data-type="tag"] {\n    font-size: 0.85em;\n    padding: 1px 6px;\n    border-radius: 10px;\n    background: color-mix(in srgb, var(--mm-node-text) 13%, transparent);\n    word-break: break-all;\n}\n\n.mm-root .mm-txt [data-type="inline-math"] {\n    font-style: italic;\n}\n\n/* \u56FE\u7247\uFF1A\u7F29\u7565\u56FE\u5F62\u6001\u3002Protyle \u7528 <span data-type="img"><img></span> \u5305\u4E00\u5C42 */\n.mm-root .mm-txt [data-type="img"] {\n    display: inline-flex;\n    align-items: center;\n    vertical-align: middle;\n}\n\n.mm-root .mm-txt img {\n    max-width: 200px;\n    max-height: 48px;\n    width: auto;\n    height: auto;\n    object-fit: contain;\n    border-radius: 4px;\n    vertical-align: middle;\n    /* \u5355\u51FB\u653E\u5927\u770B\u539F\u56FE\uFF08\u89C1 renderer \u7684 zoomImage\uFF09 */\n    cursor: zoom-in;\n}\n\n.mm-root .mm-txt sup,\n.mm-root .mm-txt sub {\n    font-size: 0.72em;\n}\n\n.mm-root .mm-txt kbd {\n    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;\n    font-size: 0.85em;\n    padding: 1px 5px;\n    border-radius: 4px;\n    border: 1px solid var(--mm-node-border);\n}\n\n/* \u5C42\u7EA7\u7F16\u53F7 */\n.mm-root .mm-badge {\n    flex: 0 0 auto;\n    font-size: 10.5px;\n    font-weight: 600;\n    font-variant-numeric: tabular-nums;\n    letter-spacing: 0.3px;\n    padding: 1px 5px;\n    border-radius: 4px;\n    background: var(--c-soft);\n    color: var(--c-solid);\n}\n\n.mm-root .mm-d0 .mm-badge {\n    background: rgba(255, 255, 255, 0.24);\n    color: inherit;\n}\n\n/* \u4EFB\u52A1\u590D\u9009\u6846 */\n.mm-root .mm-task {\n    flex: 0 0 auto;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    /* \u662F\u4E2A <button>\uFF0C\u5F97\u5148\u628A\u6D4F\u89C8\u5668\u9ED8\u8BA4\u7684\u6309\u94AE\u5916\u89C2\u6E05\u6389\uFF1A\n       padding / background / font / appearance \u56DB\u9879\u4E0D\u6E05\uFF0C\u5C3A\u5BF8\u548C\u5B57\u4F53\u90FD\u4F1A\u8DDF\u7740\u7CFB\u7EDF\u8D70\uFF0C\n       \u5728\u4E0D\u540C\u5E73\u53F0\u4E0A\u8DDF\u65C1\u8FB9\u7684\u8282\u70B9\u6587\u5B57\u5BF9\u4E0D\u9F50 */\n    appearance: none;\n    -webkit-appearance: none;\n    padding: 0;\n    margin: 0;\n    background: transparent;\n    font-family: inherit;\n    width: 14px;\n    height: 14px;\n    border-radius: 4px;\n    border: 1.5px solid var(--c-solid);\n    font-size: 10px;\n    line-height: 1;\n    color: #ffffff;\n    cursor: pointer;\n    /* \u70B9\u51FB\u8981\u7ACB\u523B\u6709\u56DE\u5E94\uFF0C\u6240\u4EE5\u53EA\u7ED9\u989C\u8272\u8FC7\u6E21\uFF0C\u4E0D\u52A0 transform\uFF08\u4F1A\u8DDF\u8282\u70B9\u6296\u52A8\u6253\u67B6\uFF09 */\n    transition: background-color 120ms ease, border-color 120ms ease;\n}\n\n/* \u60AC\u505C\uFF1A\u628A\u6846\u586B\u6210\u534A\u900F\u660E\uFF0C\u6697\u793A\u300C\u70B9\u4E00\u4E0B\u5C31\u4F1A\u53D8\u6210\u5B9E\u5FC3\u300D */\n.mm-root .mm-task:hover {\n    background: color-mix(in srgb, var(--c-solid) 26%, transparent);\n}\n\n.mm-root .mm-task--done {\n    background: var(--c-solid);\n}\n\n.mm-root .mm-task--done:hover {\n    background: color-mix(in srgb, var(--c-solid) 72%, transparent);\n}\n\n/* \u952E\u76D8 Tab \u5230\u590D\u9009\u6846\u65F6\u5FC5\u987B\u770B\u5F97\u89C1\u7126\u70B9 \u2014\u2014 \u8FD9\u4E2A\u63A7\u4EF6\u672C\u6765\u5C31\u662F\u4E3A\u952E\u76D8\u7528\u6237\u8865\u7684 */\n.mm-root .mm-task:focus-visible {\n    outline: 2px solid var(--c-solid);\n    outline-offset: 2px;\n}\n\n.mm-root .mm-done .mm-txt {\n    opacity: 0.5;\n    text-decoration: line-through;\n}\n\n/* -------------------------------------------------------------- \u6298\u53E0\u6309\u94AE */\n\n/* \u843D\u5728\u5206\u652F\u7EBF\u4E0A\uFF0C\u50CF\u7EBF\u4E0A\u7684\u4E00\u4E2A\u8282\u70B9 */\n.mm-root .mm-toggle {\n    position: absolute;\n    z-index: 4;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    width: 15px;\n    height: 15px;\n    box-sizing: border-box;\n    border-radius: 50%;\n    border: 1.5px solid var(--c-solid);\n    background: var(--mm-toggle-bg);\n    color: var(--c-solid);\n    font-size: 9px;\n    font-weight: 600;\n    line-height: 1;\n    cursor: pointer;\n    transition: background 0.15s, color 0.15s, transform 0.15s;\n}\n\n.mm-root .mm-toggle:hover {\n    transform: scale(1.18);\n}\n\n.mm-root .mm-toggle:hover,\n.mm-root .mm-toggle--collapsed {\n    background: var(--c-solid);\n    color: var(--mm-toggle-bg);\n}\n\n/*\n * \u6298\u53E0\u6309\u94AE\u538B\u5728\u753B\u5E03\u4E0A\uFF08\u4E0D\u5728\u8282\u70B9\u5361\u7247\u91CC\uFF09\uFF0C\u6240\u4EE5\u5B83\u7684\u63CF\u8FB9\u4E0E\u6587\u5B57\u5FC5\u987B\u4E0E**\u753B\u5E03**\u5F62\u6210\u53CD\u5DEE\u3002\n * --c-solid \u662F\u5206\u652F\u8272\uFF0C\u672C\u8EAB\u5C31\u662F\u6309\u300C\u5728\u753B\u5E03\u4E0A\u53EF\u8BFB\u300D\u6311\u7684\uFF0C\u56E0\u6B64\u6839\u8282\u70B9\u4E5F\u6CBF\u7528\u540C\u4E00\u5957\u89C4\u5219\uFF0C\n * \u4E0D\u8981\u6539\u6210 --mm-root-text\uFF1A\u9AD8\u5BF9\u6BD4\u4E3B\u9898\u91CC rootText \u662F\u7EAF\u9ED1\u3001\u753B\u5E03\u4E5F\u662F\u7EAF\u9ED1\uFF0C\u4F1A\u76F4\u63A5\u9690\u5F62\u3002\n */\n.mm-root .mm-d0 .mm-toggle {\n    border-color: var(--c-solid);\n    color: var(--c-solid);\n}\n\n/* ---------------------------------------------------------- \u60AC\u505C\u5FEB\u6377\u64CD\u4F5C */\n\n.mm-root .mm-acts {\n    position: absolute;\n    left: calc(100% + 4px);\n    top: -10px;\n    z-index: 8;\n    display: flex;\n    gap: 2px;\n    padding: 2px;\n    border-radius: 7px;\n    border: 1px solid var(--mm-node-border);\n    background: var(--mm-canvas-solid);\n    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24);\n    opacity: 0;\n    visibility: hidden;\n    transform: translateY(2px);\n    transition: opacity 0.14s ease, transform 0.14s ease, visibility 0.14s;\n}\n\n/* \u601D\u7EF4\u5BFC\u56FE\u5DE6\u4FA7\u5206\u652F\uFF1A\u5FEB\u6377\u6309\u94AE\u955C\u50CF\u5230\u5DE6\u8FB9 */\n.mm-root .mm-node.mm-left .mm-acts {\n    left: auto;\n    right: calc(100% + 4px);\n}\n\n.mm-root .mm-node:hover .mm-acts,\n.mm-root .mm-node.mm-sel .mm-acts {\n    opacity: 1;\n    visibility: visible;\n    transform: translateY(0);\n}\n\n.mm-root .mm-acts button {\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    width: 18px;\n    height: 18px;\n    padding: 0;\n    border: 0;\n    border-radius: 5px;\n    background: transparent;\n    color: var(--mm-node-text);\n    cursor: pointer;\n    font-size: 13px;\n    line-height: 1;\n}\n\n.mm-root .mm-acts button:hover {\n    background: var(--mm-accent);\n    color: #ffffff;\n}\n\n/* ---------------------------------------------------------------- \u5B9A\u4F4D\u95EA\u70C1 */\n\n.protyle-wysiwyg .mm-flash {\n    box-shadow: 0 0 0 2px var(--b3-theme-primary, #4c8dff);\n    border-radius: 4px;\n    transition: box-shadow 0.3s;\n}\n\n/* ---------------------------------------------------------------- \u8282\u70B9\u7F16\u8F91 */\n\n.mm-root .mm-node.mm-editing {\n    z-index: 30;\n}\n\n.mm-root .mm-node.mm-editing .mm-inner {\n    box-shadow: 0 0 0 2px var(--mm-accent), 0 10px 28px var(--mm-hover-shadow);\n}\n\n/* \u7236\u7EA7 .mm-node \u8BBE\u4E86 user-select: none\uFF0C\u7F16\u8F91\u65F6\u5FC5\u987B\u653E\u5F00 */\n.mm-root .mm-node.mm-editing .mm-txt {\n    outline: none;\n    cursor: text;\n    user-select: text;\n    white-space: pre-wrap;\n    min-width: 24px;\n    max-width: 320px;\n    caret-color: var(--mm-accent);\n}\n\n/* -------------------------------------------------------------- \u62D6\u62FD\u91CD\u6392 */\n\n.mm-root.mm-drag-active,\n.mm-root.mm-drag-active * {\n    cursor: grabbing !important;\n    user-select: none !important;\n}\n\n.mm-root .mm-node.mm-dragging {\n    opacity: 0.45;\n}\n\n.mm-root .mm-drop {\n    position: absolute;\n    box-sizing: border-box;\n    pointer-events: none;\n    z-index: 20;\n}\n\n/* \u540C\u7EA7\u63D2\u5165\uFF1A\u5728\u8282\u70B9\u4E0A/\u4E0B\u7F18\u753B\u4E00\u6761\u7EBF */\n.mm-root .mm-drop--line {\n    border-radius: 2px;\n    background: var(--mm-accent);\n    box-shadow: 0 0 6px var(--mm-accent);\n}\n\n/* \u6210\u4E3A\u5B50\u8282\u70B9\uFF1A\u7ED9\u76EE\u6807\u5957\u4E00\u4E2A\u865A\u7EBF\u6846 */\n.mm-root .mm-drop--child {\n    border-radius: 10px;\n    border: 2px dashed var(--mm-accent);\n}\n\n/* \u62D6\u62FD\u60AC\u505C\u81EA\u52A8\u5C55\u5F00\u7684\u5012\u8BA1\u65F6\u53CD\u9988 */\n.mm-root .mm-drop--child.mm-drop--pending {\n    animation: mm-pulse 0.4s ease-in-out infinite alternate;\n}\n\n@keyframes mm-pulse {\n    from {\n        border-color: color-mix(in srgb, var(--mm-accent) 40%, transparent);\n    }\n    to {\n        border-color: var(--mm-accent);\n    }\n}\n\n/* ---------------------------------------------------------------- \u6846\u9009\u591A\u9009 */\n\n.mm-root .mm-marquee {\n    position: absolute;\n    z-index: 18;\n    pointer-events: none;\n    border: 1px solid var(--mm-accent);\n    border-radius: 3px;\n    background: color-mix(in srgb, var(--mm-accent) 14%, transparent);\n}\n\n.mm-root .mm-node.mm-multi .mm-inner {\n    box-shadow:\n        0 0 0 1.5px var(--mm-accent),\n        0 4px 14px var(--mm-hover-shadow);\n}\n\n/* ---------------------------------------------------------------- \u7F29\u653E\u80F6\u56CA */\n\n.mm-root .mm-zoombar {\n    position: absolute;\n    right: 14px;\n    bottom: 14px;\n    z-index: 12;\n    display: flex;\n    align-items: center;\n    gap: 2px;\n    padding: 3px;\n    border-radius: 9px;\n    border: 1px solid var(--mm-node-border);\n    /* \u4E0D\u7528 backdrop-filter\uFF1A\u5B83\u4F1A\u8BA9\u7956\u5148\u5EFA\u7ACB backdrop root\uFF0C\n       \u8FDB\u800C\u628A .mm-root \u6574\u68F5\u5B50\u6811\u6E32\u67D3\u8FDB\u4E00\u5F20\u5355\u72EC\u7684\u4F4D\u56FE\uFF0C\u653E\u5927\u65F6\u540C\u6837\u4F1A\u7CCA\u3002\n       \u8FD9\u91CC\u6539\u6210\u5B9E\u8272\u80CC\u666F\uFF0C\u89C2\u611F\u51E0\u4E4E\u4E00\u81F4\u3002 */\n    background: var(--mm-canvas-solid);\n    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);\n    user-select: none;\n}\n\n.mm-root .mm-zoombar button {\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    width: 24px;\n    height: 22px;\n    padding: 0;\n    border: 0;\n    border-radius: 6px;\n    background: transparent;\n    color: var(--mm-node-text);\n    cursor: pointer;\n    font-size: 13px;\n    line-height: 1;\n}\n\n.mm-root .mm-zoombar button:hover {\n    background: color-mix(in srgb, var(--mm-node-text) 12%, transparent);\n}\n\n.mm-root .mm-zoombar .mm-zoom-label {\n    min-width: 46px;\n    cursor: pointer;\n}\n\n/* ------------------------------------------------------------------ \u5C0F\u5730\u56FE */\n\n.mm-root .mm-minimap {\n    position: absolute;\n    right: 14px;\n    bottom: 52px;\n    z-index: 11;\n    box-sizing: border-box;\n    border-radius: 9px;\n    border: 1px solid var(--mm-node-border);\n    background: var(--mm-canvas-solid);\n    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);\n    cursor: pointer;\n    overflow: hidden;\n}\n\n.mm-root .mm-minimap svg {\n    display: block;\n}\n\n.mm-root .mm-minimap .mm-mm-view {\n    fill: color-mix(in srgb, var(--mm-accent) 16%, transparent);\n    stroke: var(--mm-accent);\n    stroke-width: 1;\n}\n\n/* ------------------------------------------------------------------ \u641C\u7D22\u6846 */\n\n.mm-root .mm-search {\n    position: absolute;\n    top: 12px;\n    right: 14px;\n    z-index: 14;\n    display: none;\n    flex-direction: column;\n    align-items: stretch;\n    gap: 4px;\n    padding: 4px 6px;\n    border-radius: 9px;\n    border: 1px solid var(--mm-node-border);\n    background: var(--mm-canvas-solid);\n    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.24);\n}\n\n/* \u63A7\u4EF6\u90A3\u4E00\u884C\u3002\u641C\u7D22\u6846\u672C\u8EAB\u662F\u5217\u5E03\u5C40\uFF0C\u56E0\u4E3A\u4E0B\u9762\u8FD8\u8981\u6302\u7ED3\u679C\u9762\u677F */\n.mm-root .mm-search .mm-search-row {\n    display: flex;\n    align-items: center;\n    gap: 4px;\n}\n\n/* ---------------------------------------------------------------- \u8DE8\u56FE\u641C\u7D22\u7ED3\u679C\uFF08P1-1\uFF09\n *\n * \u9762\u677F**\u957F\u5728\u641C\u7D22\u6846\u91CC**\uFF08\u540C\u4E00\u5757\u6D6E\u5C42\u5411\u4E0B\u5EF6\u4F38\uFF09\uFF0C\u800C\u4E0D\u662F\u53E6\u8D77\u4E00\u4E2A\u6D6E\u5C42\uFF1A\n * \u4E24\u5757\u6D6E\u5C42\u4F1A\u51FA\u73B0\u300C\u5173\u6389\u641C\u7D22\u6846\u3001\u7ED3\u679C\u8FD8\u6302\u5728\u753B\u5E03\u4E0A\u300D\u8FD9\u79CD\u5B64\u513F\u72B6\u6001\uFF0C\n * \u800C\u5B83\u4EEC\u672C\u6765\u5C31\u662F\u540C\u4E00\u6B21\u641C\u7D22\u7684\u4E24\u4E2A\u90E8\u5206\u3002\n */\n.mm-root .mm-search .mm-results {\n    display: none;\n    flex-direction: column;\n    gap: 1px;\n    max-height: 260px;\n    overflow-y: auto;\n    padding-top: 4px;\n    border-top: 1px solid color-mix(in srgb, var(--mm-node-text) 14%, transparent);\n}\n\n.mm-root .mm-search .mm-results.mm-results--on {\n    display: flex;\n}\n\n.mm-root .mm-search .mm-result {\n    display: flex;\n    align-items: baseline;\n    gap: 8px;\n    width: 100%;\n    max-width: 340px;\n    padding: 5px 7px;\n    border: 0;\n    border-radius: 6px;\n    background: transparent;\n    color: var(--mm-node-text);\n    text-align: left;\n    cursor: pointer;\n    font-family: inherit;\n}\n\n.mm-root .mm-search .mm-result:hover {\n    background: color-mix(in srgb, var(--mm-accent) 18%, transparent);\n}\n\n.mm-root .mm-search .mm-result .mm-result-text {\n    flex: 0 1 auto;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n    font-size: 12.5px;\n}\n\n.mm-root .mm-search .mm-result .mm-result-path {\n    flex: 0 0 auto;\n    margin-left: auto;\n    max-width: 46%;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n    font-size: 11px;\n    opacity: 0.55;\n}\n\n.mm-root .mm-search .mm-result--none {\n    padding: 6px 7px;\n    font-size: 12px;\n    opacity: 0.55;\n    cursor: default;\n}\n\n.mm-root .mm-search.mm-search--on {\n    display: flex;\n}\n\n.mm-root .mm-search input {\n    width: 148px;\n    padding: 3px 6px;\n    border: 0;\n    outline: none;\n    background: transparent;\n    color: var(--mm-node-text);\n    font-family: inherit;\n    font-size: 12.5px;\n}\n\n.mm-root .mm-search input::placeholder {\n    color: var(--mm-node-text);\n    opacity: 0.42;\n}\n\n.mm-root .mm-search button {\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    width: 22px;\n    height: 22px;\n    padding: 0;\n    border: 0;\n    border-radius: 6px;\n    background: transparent;\n    color: var(--mm-node-text);\n    cursor: pointer;\n    font-size: 12px;\n    line-height: 1;\n}\n\n.mm-root .mm-search button:hover {\n    background: color-mix(in srgb, var(--mm-node-text) 12%, transparent);\n}\n\n.mm-root .mm-search .mm-search-count {\n    min-width: 42px;\n    text-align: center;\n    font-size: 11.5px;\n    opacity: 0.66;\n    font-variant-numeric: tabular-nums;\n}\n\n/* ---------------------------------------------------------------- \u7A7A\u72B6\u6001 */\n\n.mm-root .mm-empty {\n    position: absolute;\n    inset: 0;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: 6px;\n    pointer-events: none;\n    color: var(--mm-node-text);\n    opacity: 0.45;\n    font-size: 13px;\n    text-align: center;\n}\n\n.mm-root .mm-empty strong {\n    font-size: 14px;\n    font-weight: 500;\n}\n\n/* ---------------------------------------------------------------- \u52A8\u6548\u5F00\u5173 */\n\n.mm-root.mm-flip .mm-node {\n    transition: opacity 0.18s ease;\n}\n\n.mm-root.mm-flip .mm-node.mm-enter {\n    opacity: 0;\n}\n\n/* ---------------------------------------------------------- \u5BFC\u51FA\u7528\u9759\u6001\u515C\u5E95 */\n\n.mm-root.mm-export {\n    display: block;\n    position: relative;\n    margin: 0;\n    padding: 0;\n    border: 0;\n    border-radius: 0;\n    box-shadow: none;\n    background-image: none;\n}\n\n.mm-root.mm-export .mm-nodes {\n    position: absolute;\n    left: 0;\n    top: 0;\n}\n\n.mm-root.mm-export .mm-toolbar,\n.mm-root.mm-export .mm-viewport {\n    display: none;\n}\n\n/* \u5BFC\u51FA\u65F6\u9690\u85CF\u4E00\u5207\u4EA4\u4E92\u6027\u88C5\u9970 */\n.mm-root.mm-export .mm-acts,\n.mm-root.mm-export .mm-toggle,\n.mm-root.mm-export .mm-tip,\n.mm-root.mm-export .mm-minimap,\n.mm-root.mm-export .mm-zoombar,\n.mm-root.mm-export .mm-search,\n.mm-root.mm-export .mm-marquee,\n.mm-root.mm-export .mm-drop {\n    display: none !important;\n}\n\n.mm-root.mm-export .mm-node.mm-dim {\n    opacity: 1;\n}\n\n.mm-root.mm-export .mm-node.mm-enter {\n    opacity: 1;\n}\n\n/* \u9AD8\u5BF9\u6BD4\u4E3B\u9898\uFF1A\u53BB\u6389\u4E00\u5207\u67D4\u548C\u6548\u679C */\n.mm-root.mm-hc .mm-inner {\n    box-shadow: none !important;\n}\n\n.mm-root.mm-hc .mm-d2 .mm-inner,\n.mm-root.mm-hc .mm-d3 .mm-inner,\n.mm-root.mm-hc .mm-d4 .mm-inner {\n    border-width: 1.5px;\n}\n\n.mm-root.mm-hc .mm-d0 .mm-inner {\n    border: 2px solid var(--mm-root-text);\n}\n\n/* ---------------------------------------------------------------- \u56FE\u7247\u653E\u5927 */\n\n.mm-lightbox {\n    position: fixed;\n    inset: 0;\n    z-index: 1000;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    padding: 6vh 6vw;\n    background: rgba(0, 0, 0, 0.62);\n    cursor: zoom-out;\n}\n\n.mm-lightbox img {\n    max-width: 100%;\n    max-height: 100%;\n    border-radius: 6px;\n    background: #fff;\n    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.4);\n}\n\n/* ================================================================ \u9762\u5305\u5C51\uFF08\u8282\u70B9\u4E0B\u94BB\uFF09\n\n   \u53EA\u5728\u300C\u805A\u7126\u67D0\u4E2A\u5206\u652F\u300D\u65F6\u51FA\u73B0\u3002\u653E\u5728\u5DE5\u5177\u6761\u4E0E\u753B\u5E03\u4E4B\u95F4\uFF0C\u800C\u4E0D\u662F\u6D6E\u5728\u753B\u5E03\u4E0A \u2014\u2014\n   \u5B83\u662F\u5BFC\u822A\u7ED3\u6784\u7684\u4E00\u90E8\u5206\uFF0C\u6D6E\u52A8\u4F1A\u6321\u4F4F\u8282\u70B9\u3002 */\n\n.mm-root .mm-crumb {\n    display: none;\n    align-items: center;\n    flex-wrap: wrap;\n    gap: 2px;\n    flex: 0 0 auto;\n    padding: 4px 10px;\n    border-bottom: 1px solid var(--mm-node-border);\n    background: color-mix(in srgb, var(--mm-canvas-solid) 72%, transparent);\n    font-size: 12px;\n    user-select: none;\n    z-index: 4;\n}\n\n.mm-root .mm-crumb.mm-crumb--on {\n    display: flex;\n}\n\n.mm-root .mm-crumb-item {\n    max-width: 190px;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n    padding: 2px 7px;\n    border: 0;\n    border-radius: 5px;\n    background: transparent;\n    color: var(--mm-node-text);\n    font-family: inherit;\n    font-size: 12px;\n    line-height: 1.6;\n    cursor: pointer;\n    opacity: 0.82;\n}\n\n.mm-root .mm-crumb-item:hover:not(:disabled) {\n    background: color-mix(in srgb, var(--mm-accent) 18%, transparent);\n    opacity: 1;\n}\n\n.mm-root .mm-crumb-item.mm-crumb-cur {\n    color: var(--mm-accent);\n    font-weight: 600;\n    opacity: 1;\n    cursor: default;\n}\n\n.mm-root .mm-crumb-sep {\n    color: var(--mm-node-text);\n    opacity: 0.38;\n}\n\n.mm-root .mm-crumb-out {\n    margin-left: auto;\n    padding: 2px 9px;\n    border: 1px solid var(--mm-node-border);\n    border-radius: 5px;\n    background: transparent;\n    color: var(--mm-node-text);\n    font-family: inherit;\n    font-size: 11px;\n    line-height: 1.7;\n    cursor: pointer;\n}\n\n.mm-root .mm-crumb-out:hover {\n    background: var(--mm-accent);\n    border-color: var(--mm-accent);\n    color: #ffffff;\n}\n\n/* ================================================================ \u5E76\u6392\u9762\u677F\n\n   \u5DE6\u8FB9\u5927\u7EB2\u3001\u53F3\u8FB9\u5BFC\u56FE\u3002\u5B83\u662F\u300C\u4F34\u751F\u89C6\u56FE\u300D\uFF1A\u4E0D\u9690\u85CF\u6E90\u5217\u8868\u3001\u4E0D\u5199\u5757\u5C5E\u6027\uFF0C\n   \u5173\u6389\u4E4B\u540E\u8FD9\u4E2A\u5757\u8BE5\u662F\u4EC0\u4E48\u8FD8\u662F\u4EC0\u4E48\u3002 */\n\n.mm-side {\n    position: fixed;\n    top: 0;\n    right: 0;\n    bottom: 0;\n    width: min(46vw, 720px);\n    min-width: 320px;\n    display: flex;\n    flex-direction: column;\n    z-index: 90;\n    border-left: 1px solid var(--b3-border-color, rgba(128, 128, 128, 0.28));\n    background: var(--b3-theme-background, #ffffff);\n    box-shadow: -8px 0 28px rgba(0, 0, 0, 0.16);\n    overflow: hidden;\n}\n\n.mm-side-grip {\n    position: absolute;\n    left: 0;\n    top: 0;\n    bottom: 0;\n    width: 6px;\n    cursor: col-resize;\n    z-index: 3;\n}\n\n.mm-side-grip:hover {\n    background: var(--b3-theme-primary, #4c8dff);\n    opacity: 0.55;\n}\n\n.mm-side-head {\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    flex: 0 0 auto;\n    padding: 6px 8px 6px 14px;\n    border-bottom: 1px solid var(--b3-border-color, rgba(128, 128, 128, 0.28));\n    font-size: 12px;\n    font-weight: 600;\n    color: var(--b3-theme-on-background, #202124);\n    user-select: none;\n}\n\n.mm-side-title {\n    flex: 1 1 auto;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n}\n\n.mm-side-close {\n    flex: 0 0 auto;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    width: 24px;\n    height: 24px;\n    border: 0;\n    border-radius: 5px;\n    background: transparent;\n    color: inherit;\n    cursor: pointer;\n    font-size: 13px;\n    line-height: 1;\n}\n\n.mm-side-close:hover {\n    background: rgba(128, 128, 128, 0.18);\n}\n\n.mm-side-body {\n    flex: 1 1 auto;\n    min-height: 0;\n    overflow: hidden;\n}\n\n.mm-side-body > .mm-root {\n    margin: 0;\n    height: 100%;\n    border-radius: 0;\n}\n\n/* ================================================================ \u300C\u56DE\u5230\u5BFC\u56FE\u300D\u6D6E\u52A8\u6761\n\n   \u8DF3\u56DE\u539F\u6587\u6539\u683C\u5F0F\u4E4B\u540E\uFF0C\u7ED9\u4E00\u6761\u56DE\u7A0B\u3002\u539F\u6765\u8FD9\u6761\u94FE\u8DEF\u662F\u5355\u5411\u7684\uFF1A\n   \u53CC\u51FB\u542B\u683C\u5F0F\u7684\u8282\u70B9 \u2192 \u9000\u51FA\u5BFC\u56FE \u2192 \u60F3\u56DE\u6765\u5F97\u81EA\u5DF1\u518D\u53BB\u627E\u5217\u8868\u5757\u7684\u56FE\u6807\u3002 */\n\n.mm-backbar {\n    position: fixed;\n    left: 50%;\n    bottom: 26px;\n    transform: translateX(-50%);\n    z-index: 200;\n    display: flex;\n    align-items: center;\n    gap: 10px;\n    padding: 8px 10px 8px 16px;\n    border-radius: 999px;\n    border: 1px solid var(--b3-border-color, rgba(128, 128, 128, 0.3));\n    background: var(--b3-theme-surface, #ffffff);\n    color: var(--b3-theme-on-surface, #202124);\n    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.24);\n    font-size: 12.5px;\n    user-select: none;\n    animation: mm-backbar-in 0.18s ease-out;\n}\n\n@keyframes mm-backbar-in {\n    from {\n        opacity: 0;\n        transform: translate(-50%, 10px);\n    }\n    to {\n        opacity: 1;\n        transform: translate(-50%, 0);\n    }\n}\n\n.mm-backbar-text {\n    opacity: 0.78;\n}\n\n.mm-backbar-btn {\n    padding: 4px 12px;\n    border: 0;\n    border-radius: 999px;\n    background: var(--b3-theme-primary, #4c8dff);\n    color: #ffffff;\n    font-family: inherit;\n    font-size: 12.5px;\n    line-height: 1.6;\n    cursor: pointer;\n}\n\n.mm-backbar-x {\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    width: 22px;\n    height: 22px;\n    border: 0;\n    border-radius: 50%;\n    background: transparent;\n    color: inherit;\n    opacity: 0.55;\n    cursor: pointer;\n    font-size: 12px;\n    line-height: 1;\n}\n\n.mm-backbar-x:hover {\n    opacity: 1;\n    background: rgba(128, 128, 128, 0.18);\n}\n\n/* ================================================================ \u89E6\u5C4F\u9002\u914D */\n\n/* \u7EB5\u5411\u62D6\u52A8\u4EA4\u7ED9\u6D4F\u89C8\u5668\u6EDA\u9875\u9762\uFF0C\u6A2A\u5411\u62D6\u52A8\u4E0E\u53CC\u6307\u624B\u52BF\u7559\u7ED9\u5BFC\u56FE\u3002\n   `pan-y` \u4F1A\u628A\u7EB5\u5411\u7684 touchmove \u76F4\u63A5\u4ECE\u6211\u4EEC\u624B\u91CC\u62FF\u8D70 \u2014\u2014 \u8FD9\u6B63\u662F\u60F3\u8981\u7684\uFF1A\n   \u957F\u6587\u6863\u91CC\u5D4C\u4E00\u5757\u5BFC\u56FE\uFF0C\u5982\u679C\u8FDE\u9875\u9762\u90FD\u6EDA\u4E0D\u52A8\uFF0C\u79FB\u52A8\u7AEF\u5C31\u6CA1\u6CD5\u7528\u4E86\u3002 */\n.mm-root .mm-viewport {\n    touch-action: pan-y;\n}\n\n/* \u957F\u6309\u7528\u6765\u547C\u51FA\u8282\u70B9\u83DC\u5355\uFF0C\u522B\u8BA9\u7CFB\u7EDF\u5F39\u51FA\u6587\u5B57\u9009\u62E9\u83DC\u5355\u3002\n   \u7F16\u8F91\u6001\u8981\u6B63\u5E38\u9009\u8BCD\uFF0C\u6240\u4EE5\u628A\u7F16\u8F91\u4E2D\u7684\u8282\u70B9\u6392\u9664\u6389\u3002 */\n.mm-root .mm-node:not([data-mm-editing]) {\n    -webkit-touch-callout: none;\n    -webkit-user-select: none;\n    user-select: none;\n}\n\n@media (hover: none) {\n    /* \u6CA1\u6709 hover\uFF1A\u60AC\u505C\u64CD\u4F5C\u6761\u53EA\u80FD\u9760\u300C\u9009\u4E2D\u6001\u5E38\u9A7B\u300D\u9732\u51FA\u6765\u3002\n       \u987A\u5E26\u628A\u70B9\u51FB\u76EE\u6807\u653E\u5927\u5230 22px\uFF0C\u624B\u6307\u70B9\u5F97\u4E2D\u3002 */\n    .mm-root .mm-acts button {\n        width: 22px;\n        height: 22px;\n        font-size: 14px;\n    }\n\n    .mm-root .mm-toolbar button {\n        padding: 6px 10px;\n    }\n\n    .mm-root .mm-crumb-item,\n    .mm-root .mm-crumb-out {\n        padding: 4px 9px;\n    }\n}\n\n/* ================================================================ \u4E50\u89C2\u5360\u4F4D\uFF08P0-2\uFF09\n\n   \u7ED3\u6784\u64CD\u4F5C\u8981\u7B49\u300C\u5199\u5185\u6838 \u2192 \u5185\u6838\u56DE\u63A8 \u2192 \u626B\u63CF\u91CD\u6302\u300D\u4E00\u6574\u5708\uFF0C\u4E2D\u95F4\u51E0\u767E\u6BEB\u79D2\u753B\u9762\n   \u6BEB\u65E0\u53D8\u5316\u3002\u5360\u4F4D\u6846\u5C31\u662F\u7528\u6765\u586B\u8FD9\u6BB5\u7A7A\u7A97\u7684\uFF1A\u5148\u7ED9\u53CD\u9988\uFF0C\u518D\u7B49\u771F\u76F8\u3002 */\n\n.mm-root .mm-ghost {\n    position: absolute;\n    z-index: 9;\n    display: flex;\n    align-items: center;\n    padding: 6px 12px;\n    border-radius: 8px;\n    border: 1.5px dashed var(--mm-accent);\n    background: color-mix(in srgb, var(--mm-accent) 12%, transparent);\n    color: var(--mm-accent);\n    font-size: 12px;\n    line-height: 1.4;\n    white-space: nowrap;\n    pointer-events: none;\n    animation: mm-ghost-breathe 1.1s ease-in-out infinite;\n}\n\n@keyframes mm-ghost-breathe {\n    0%,\n    100% {\n        opacity: 0.5;\n    }\n    50% {\n        opacity: 0.95;\n    }\n}\n\n/* \u79FB\u52A8 / \u5347\u964D\u7EA7 / \u5220\u9664\u6CA1\u6709\u65B0\u8282\u70B9\u53EF\u5360\u4F4D\uFF0C\u6539\u4E3A\u5728\u6E90\u8282\u70B9\u4E0A\u6253\u4E00\u5708\u547C\u5438\u63CF\u8FB9 */\n.mm-root .mm-node.mm-pending .mm-inner {\n    animation: mm-pending-pulse 0.95s ease-out infinite;\n}\n\n@keyframes mm-pending-pulse {\n    0% {\n        box-shadow: 0 0 0 0 color-mix(in srgb, var(--mm-accent) 62%, transparent);\n    }\n    70% {\n        box-shadow: 0 0 0 7px color-mix(in srgb, var(--mm-accent) 0%, transparent);\n    }\n    100% {\n        box-shadow: 0 0 0 0 color-mix(in srgb, var(--mm-accent) 0%, transparent);\n    }\n}\n\n/* \u5931\u8D25\uFF1A\u7EA2\u8FB9 + \u6296\u52A8\u3002\u6296\u52A8\u6253\u5728 .mm-inner \u4E0A\u800C\u4E0D\u662F .mm-node \u2014\u2014\n   \u540E\u8005\u88AB hover \u7684 translateY \u5360\u7528\uFF0C\u4F1A\u4E92\u76F8\u8986\u76D6\u3002 */\n.mm-root .mm-node.mm-error .mm-inner {\n    box-shadow:\n        0 0 0 2.5px #e5484d,\n        0 6px 20px rgba(229, 72, 77, 0.32);\n    animation: mm-shake 0.36s cubic-bezier(0.36, 0.07, 0.19, 0.97) 2;\n}\n\n@keyframes mm-shake {\n    10%,\n    90% {\n        transform: translateX(-1.5px);\n    }\n    20%,\n    80% {\n        transform: translateX(3px);\n    }\n    30%,\n    50%,\n    70% {\n        transform: translateX(-5px);\n    }\n    40%,\n    60% {\n        transform: translateX(5px);\n    }\n}\n\n/* \u65B0\u63D2\u5165\u7684\u8282\u70B9\uFF1A\u4E00\u5708\u7531\u4EAE\u8F6C\u706D\u7684\u63CF\u8FB9\uFF0C\u56DE\u7B54\u300C\u52A0\u5728\u54EA\u4E86\u300D */\n.mm-root .mm-node.mm-fresh .mm-inner {\n    animation: mm-fresh-in 1.5s ease-out;\n}\n\n@keyframes mm-fresh-in {\n    0% {\n        box-shadow:\n            0 0 0 3px var(--mm-accent),\n            0 0 22px color-mix(in srgb, var(--mm-accent) 55%, transparent);\n    }\n    55% {\n        box-shadow: 0 0 0 2px color-mix(in srgb, var(--mm-accent) 60%, transparent);\n    }\n    100% {\n        box-shadow: 0 0 0 0 transparent;\n    }\n}\n\n/* ================================================================ \u6279\u91CF\u64CD\u4F5C\u6761\uFF08P0-1\uFF09\n\n   \u591A\u9009\u4E4B\u540E\u6D6E\u5728\u753B\u5E03\u5DE6\u4E0A\u89D2\u3002\u505A\u6210\u300C\u6761\u300D\u800C\u4E0D\u662F\u5F39\u7A97 \u2014\u2014 \u7528\u6237\u6B64\u523B\u6B63\u9700\u8981\u770B\u7740\u753B\u5E03\n   \u786E\u8BA4\u81EA\u5DF1\u6846\u5BF9\u4E86\u54EA\u4E9B\u8282\u70B9\uFF0C\u5F39\u7A97\u4F1A\u6321\u4F4F\u3002\n\n   \u26A0\uFE0F \u5FC5\u987B\u662F**\u6D6E\u5C42**\uFF08absolute\uFF09\uFF0C\u4E0D\u80FD\u662F\u6D41\u5185\u5143\u7D20\u3002\n   \u65E9\u5148\u5B83\u63D2\u5728\u5DE5\u5177\u6761\u4E0E\u753B\u5E03\u4E4B\u95F4\uFF0C\u591A\u9009\u65F6\u4E00\u51FA\u73B0\u5C31\u628A\u6574\u5757\u753B\u5E03\u5F80\u4E0B\u63A8 ~40px \u2014\u2014\n   \u7528\u6237\u6309\u7740 Ctrl \u8FDE\u70B9\u7B2C\u4E8C\u4E2A\u8282\u70B9\u65F6\uFF0C\u7B2C\u4E8C\u4E0B\u5DF2\u7ECF\u6253\u504F\u4E86\uFF08\u5B9E\u6D4B\uFF1ACtrl+\u53CC\u51FB\u4E0B\u94BB\n   \u6574\u6761\u94FE\u8DEF\u56E0\u6B64\u5931\u6548\uFF0C\u56E0\u4E3A Ctrl+\u5355\u51FB\u4F1A toggleMulti\uFF0C\u6761\u5B50\u5F53\u573A\u5192\u51FA\u6765\uFF09\u3002\n   \u6D6E\u52A8\u5C42\u4E0D\u53C2\u4E0E\u5E03\u5C40\uFF0C\u8FD9\u7C7B\u300C\u624B\u8FD8\u6CA1\u677E\u3001\u753B\u9762\u5148\u52A8\u300D\u7684\u95EE\u9898\u4ECE\u6839\u4E0A\u6CA1\u4E86\u3002 */\n\n.mm-root .mm-batch {\n    position: absolute;\n    top: 8px;\n    left: 10px;\n    max-width: calc(100% - 20px);\n    box-sizing: border-box;\n    display: flex;\n    align-items: center;\n    flex-wrap: wrap;\n    gap: 3px;\n    padding: 4px 8px;\n    border-radius: 10px;\n    border: 1px solid var(--mm-node-border);\n    background: color-mix(in srgb, var(--mm-accent) 12%, var(--mm-canvas-solid));\n    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);\n    font-size: 12px;\n    user-select: none;\n    z-index: 13;\n    animation: mm-batch-in 0.16s ease-out;\n}\n\n@keyframes mm-batch-in {\n    from {\n        opacity: 0;\n        transform: translateY(-6px);\n    }\n    to {\n        opacity: 1;\n        transform: none;\n    }\n}\n\n.mm-root .mm-batch-count {\n    color: var(--mm-node-text);\n    font-weight: 600;\n    opacity: 0.85;\n}\n\n.mm-root .mm-batch-sep {\n    width: 1px;\n    height: 14px;\n    margin: 0 4px;\n    background: var(--mm-node-border);\n}\n\n.mm-root .mm-batch-btn {\n    padding: 3px 10px;\n    border: 1px solid var(--mm-node-border);\n    border-radius: 6px;\n    background: var(--mm-canvas-solid);\n    color: var(--mm-node-text);\n    font-family: inherit;\n    font-size: 12px;\n    line-height: 1.7;\n    cursor: pointer;\n    transition: background 0.15s, border-color 0.15s, color 0.15s;\n}\n\n.mm-root .mm-batch-btn:hover {\n    background: var(--mm-accent);\n    border-color: var(--mm-accent);\n    color: #ffffff;\n}\n\n.mm-root .mm-batch-btn--danger {\n    color: #e5484d;\n    border-color: color-mix(in srgb, #e5484d 45%, transparent);\n}\n\n.mm-root .mm-batch-btn--danger:hover {\n    background: #e5484d;\n    border-color: #e5484d;\n    color: #ffffff;\n}\n\n.mm-root .mm-batch-x {\n    margin-left: auto;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    width: 22px;\n    height: 22px;\n    border: 0;\n    border-radius: 5px;\n    background: transparent;\n    color: var(--mm-node-text);\n    cursor: pointer;\n    font-size: 12px;\n    line-height: 1;\n}\n\n.mm-root .mm-batch-x:hover {\n    background: color-mix(in srgb, var(--mm-node-text) 14%, transparent);\n}\n\n/* ================================================================ \u60AC\u505C\u9884\u89C8\uFF08P1-1\uFF09\n\n   \u6302\u5728 body \u4E0A\uFF08fixed\uFF09\uFF0C\u6240\u4EE5**\u4E0D\u80FD**\u5199\u5728 .mm-root \u4F5C\u7528\u57DF\u91CC\u3002\n   \u7528\u5BBF\u4E3B\u53D8\u91CF\u800C\u4E0D\u662F --mm-*\uFF1A\u5B83\u662F\u4E00\u4E2A\u6D6E\u52A8 UI\uFF0C\u8DDF\u753B\u5E03\u4E3B\u9898\u65E0\u5173\u3002 */\n\n.mm-preview {\n    position: fixed;\n    z-index: 2147482000;\n    max-width: 262px;\n    padding: 8px 10px;\n    border-radius: 9px;\n    border: 1px solid var(--b3-border-color, rgba(128, 128, 128, 0.32));\n    background: var(--b3-theme-surface, #ffffff);\n    color: var(--b3-theme-on-surface, #202124);\n    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);\n    font-size: 12px;\n    line-height: 1.5;\n    pointer-events: none;\n    opacity: 0;\n    transition: opacity 0.14s ease;\n}\n\n.mm-preview.mm-preview--on {\n    opacity: 1;\n}\n\n.mm-preview-head {\n    margin-bottom: 5px;\n    font-size: 11.5px;\n    font-weight: 600;\n    opacity: 0.62;\n}\n\n.mm-preview-row {\n    display: flex;\n    align-items: baseline;\n    gap: 6px;\n}\n\n.mm-preview-dot {\n    flex: 0 0 auto;\n    width: 6px;\n    height: 6px;\n    border-radius: 50%;\n    transform: translateY(-1px);\n}\n\n.mm-preview-txt {\n    flex: 1 1 auto;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n}\n\n.mm-preview-more {\n    margin-top: 4px;\n    font-size: 11.5px;\n    opacity: 0.5;\n}\n\n/* \u62D6\u62FD\u60AC\u505C\u81EA\u52A8\u5C55\u5F00\u7684\u73AF\u5F62\u8FDB\u5EA6\uFF1A\u6CA1\u6709\u5B83\u7528\u6237\u4E0D\u77E5\u9053\u300C\u505C\u4E00\u4E0B\u4F1A\u5C55\u5F00\u300D */\n.mm-root .mm-toggle--loading {\n    animation: mm-toggle-ring var(--mm-hover-delay, 420ms) linear forwards;\n}\n\n@keyframes mm-toggle-ring {\n    from {\n        box-shadow: 0 0 0 0 color-mix(in srgb, var(--c-solid) 58%, transparent);\n    }\n    to {\n        box-shadow: 0 0 0 9px color-mix(in srgb, var(--c-solid) 0%, transparent);\n    }\n}\n\n/* ================================================================ \u5C0F\u5730\u56FE\u6807\u8BB0\uFF08P1-3\uFF09 */\n\n.mm-root .mm-minimap .mm-mm-hit {\n    fill: #f5a623;\n}\n\n.mm-root .mm-minimap .mm-mm-sel {\n    fill: var(--mm-accent);\n    stroke: var(--mm-canvas-solid);\n    stroke-width: 0.8;\n}\n\n/* ================================================================ \u7F29\u653E\u83DC\u5355\uFF08P1-4\uFF09 */\n\n.mm-root .mm-zoombar .mm-zoom-label {\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    gap: 1px;\n    min-width: 0;\n    padding: 0 5px;\n}\n\n.mm-root .mm-zoombar .mm-zoom-label .mm-zoom-val {\n    min-width: 38px;\n    text-align: right;\n}\n\n.mm-root .mm-zoombar .mm-zoom-label svg {\n    width: 10px;\n    height: 10px;\n    opacity: 0.6;\n}\n\n/* ================================================================ \u6298\u53E0\u6536\u62E2\u52A8\u753B\uFF08P2-5\uFF09\n\n   \u6298\u53E0\u65F6\u5B50\u8282\u70B9\u662F\u6574\u6279\u6D88\u5931\u7684\uFF0CFLIP \u7BA1\u4E0D\u5230\u300C\u5DF2\u7ECF\u4E0D\u5728\u6811\u4E0A\u300D\u7684\u8282\u70B9\u3002\n   \u8FD9\u4E9B\u5143\u7D20\u88AB\u6458\u51FA\u6765\u6302\u5728 world \u5C42\uFF0C\u671D\u7236\u8282\u70B9\u805A\u62E2\u5E76\u6DE1\u51FA\u3002 */\n\n.mm-root .mm-node.mm-collapsing {\n    position: absolute;\n    z-index: 8;\n    pointer-events: none;\n    transition:\n        transform 210ms cubic-bezier(0.4, 0, 0.6, 1),\n        opacity 210ms ease-in;\n    will-change: transform, opacity;\n}\n\n/* \u53EA\u5BFC\u9009\u4E2D\u65F6\u7528\u6765\u85CF\u6389\u4E0D\u76F8\u5173\u7684\u8282\u70B9 */\n.mm-root .mm-node.mm-hidden {\n    display: none !important;\n}\n\n/* ================================================================ \u6F14\u793A\u6A21\u5F0F\uFF08P2-3\uFF09 */\n\n.mm-root.mm-present .mm-toolbar,\n.mm-root.mm-present .mm-crumb {\n    opacity: 0.32;\n    transition: opacity 0.2s ease;\n}\n\n.mm-root.mm-present .mm-toolbar:hover,\n.mm-root.mm-present .mm-crumb:hover {\n    opacity: 1;\n}\n\n.mm-root.mm-present .mm-node.mm-dim {\n    opacity: 0.16;\n}\n\n.mm-root.mm-present .mm-node.mm-sel .mm-inner {\n    box-shadow:\n        0 0 0 3px var(--mm-accent),\n        0 0 0 9px color-mix(in srgb, var(--mm-accent) 20%, transparent),\n        0 14px 36px var(--mm-hover-shadow);\n}\n\n.mm-root .mm-present-bar {\n    position: absolute;\n    left: 50%;\n    bottom: 14px;\n    transform: translateX(-50%);\n    z-index: 15;\n    display: flex;\n    align-items: center;\n    gap: 6px;\n    padding: 5px 8px;\n    border-radius: 999px;\n    border: 1px solid var(--mm-node-border);\n    background: var(--mm-canvas-solid);\n    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.26);\n    font-size: 12px;\n    user-select: none;\n    animation: mm-batch-in 0.18s ease-out;\n}\n\n.mm-root .mm-present-bar button {\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    min-width: 26px;\n    height: 24px;\n    padding: 0 8px;\n    border: 0;\n    border-radius: 999px;\n    background: transparent;\n    color: var(--mm-node-text);\n    font-family: inherit;\n    font-size: 13px;\n    line-height: 1;\n    cursor: pointer;\n}\n\n.mm-root .mm-present-bar button:hover {\n    background: color-mix(in srgb, var(--mm-node-text) 12%, transparent);\n}\n\n.mm-root .mm-present-bar .mm-present-count {\n    min-width: 52px;\n    text-align: center;\n    font-variant-numeric: tabular-nums;\n    opacity: 0.72;\n}\n\n.mm-root .mm-present-bar .mm-present-exit {\n    border: 1px solid var(--mm-node-border);\n    font-size: 12px;\n}\n\n/* ================================================================ \u5927\u7EB2 \u2194 \u5BFC\u56FE \u53CC\u5411\u9AD8\u4EAE\uFF08P2-1\uFF09 */\n\n/* \u5927\u7EB2\u91CC\u5149\u6807\u6240\u5728\u5757 \u2192 \u5BFC\u56FE\u5BF9\u5E94\u8282\u70B9 */\n.mm-root .mm-node.mm-cursor .mm-inner {\n    outline: 1.5px dashed var(--c-solid);\n    outline-offset: 2px;\n}\n\n/* \u5BFC\u56FE\u91CC\u9009\u4E2D\u7684\u8282\u70B9 \u2192 \u5927\u7EB2\u5BF9\u5E94\u5217\u8868\u9879\uFF08\u53EA\u5728\u5E76\u6392\u6A21\u5F0F\u4E0B\u770B\u5F97\u89C1\uFF09 */\n.protyle-wysiwyg .li.mm-outline-hit {\n    border-radius: 4px;\n    box-shadow: inset 2.5px 0 0 var(--b3-theme-primary, #4c8dff);\n    background: color-mix(in srgb, var(--b3-theme-primary, #4c8dff) 10%, transparent);\n}\n\n/* ================================================================ \u5BFC\u51FA\u65F6\u7684\u6E05\u7406 */\n\n.mm-root.mm-export .mm-ghost,\n.mm-root.mm-export .mm-batch,\n.mm-root.mm-export .mm-present-bar,\n.mm-root.mm-export .mm-node.mm-collapsing,\n.mm-root.mm-export .mm-node.mm-hidden {\n    display: none !important;\n}\n\n.mm-root.mm-export .mm-node.mm-fresh .mm-inner,\n.mm-root.mm-export .mm-node.mm-error .mm-inner,\n.mm-root.mm-export .mm-node.mm-pending .mm-inner {\n    animation: none !important;\n}\n\n.mm-root.mm-export .mm-node.mm-error .mm-inner {\n    box-shadow: var(--mm-card-shadow);\n}\n\n.mm-root.mm-export .mm-node.mm-cursor .mm-inner {\n    outline: none;\n}\n\n/* \u89E6\u5C4F\uFF1A\u6279\u91CF\u6761\u4E0E\u6F14\u793A\u6761\u4E0A\u7684\u6309\u94AE\u653E\u5927\u5230\u624B\u6307\u70B9\u5F97\u4E2D */\n@media (hover: none) {\n    .mm-root .mm-batch-btn {\n        padding: 5px 12px;\n    }\n\n    .mm-root .mm-present-bar button {\n        min-width: 32px;\n        height: 28px;\n    }\n}\n\n';

  // src/core/exporter.ts
  function worldParts(rootEl) {
    const world = rootEl.querySelector(".mm-world");
    const edges = rootEl.querySelector(".mm-edges");
    const nodes = rootEl.querySelector(".mm-nodes");
    if (!world || !edges || !nodes) throw new Error("\u5BFC\u56FE\u5C1A\u672A\u6E32\u67D3\u5B8C\u6210");
    return { world, edges, nodes };
  }
  function resolveCssValue(value, depth = 0) {
    if (depth > 6 || !value.includes("var(")) return value;
    const next = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_m, name, fallback) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback || "";
    });
    return next === value ? value : resolveCssValue(next, depth + 1);
  }
  function inlineHostVars(html) {
    return html.replace(/style="([^"]*)"/g, (whole, css) => {
      if (!css.includes("var(--b3-")) return whole;
      const resolved = css.replace(
        /var\(\s*(--b3-[\w-]+)\s*(?:,\s*([^)]*))?\)/g,
        (_m, name, fallback) => {
          const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
          return v || fallback || "inherit";
        }
      );
      return `style="${escapeAttr(resolved)}"`;
    });
  }
  async function inlineImages(html) {
    const box = document.createElement("div");
    box.innerHTML = html;
    const imgs = Array.from(box.querySelectorAll("img"));
    if (imgs.length === 0) return html;
    await Promise.all(
      imgs.map(async (img) => {
        const src = img.getAttribute("src") ?? "";
        if (!src || src.startsWith("data:")) return;
        try {
          img.setAttribute("src", await toDataUri(src));
        } catch (err) {
          console.warn("[mindmap] \u56FE\u7247\u8F6C data URI \u5931\u8D25\uFF0C\u5BFC\u51FA\u91CC\u4F1A\u4FDD\u7559\u539F\u5730\u5740", src, err);
        }
      })
    );
    return box.innerHTML;
  }
  async function toDataUri(src) {
    const abs = new URL(src, location.href).href;
    const res = await fetch(abs);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("FileReader \u5931\u8D25"));
      reader.readAsDataURL(blob);
    });
  }
  async function katexCss() {
    const link = document.querySelector('link[href*="katex"]');
    if (!link) return "";
    try {
      const res = await fetch(link.href);
      return res.ok ? await res.text() : "";
    } catch {
      return "";
    }
  }
  function escapeAttr(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }
  async function buildSvg(rootEl, crop) {
    const { world, edges, nodes } = worldParts(rootEl);
    const full = worldSize(world);
    const size = cropSize(full, crop);
    const W = size.w;
    const H = size.h;
    const ox = size.x;
    const oy = size.y;
    const vars = readResolvedVars(rootEl);
    const styleVars = THEME_VARS.filter((v) => v !== "--mm-font" && vars[v]).map((v) => `${v}:${resolveCssValue(vars[v])}`).join(";");
    const bg = resolveCssValue(vars["--mm-canvas-solid"] ?? "#ffffff");
    const font = resolveCssValue(vars["--mm-font"] ?? "sans-serif");
    const nodeHtml = inlineHostVars(await inlineImages(nodes.innerHTML));
    const katex = await katexCss();
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
      `<style><![CDATA[`,
      PLUGIN_CSS,
      katex,
      `.mm-root.mm-export{display:block;position:relative;width:${W}px;height:${H}px;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;background:transparent;}`,
      `.mm-root.mm-export .mm-nodes{position:absolute;left:0;top:0;}`,
      `.mm-root.mm-export .mm-toolbar,.mm-root.mm-export .mm-viewport{display:none;}`,
      `]]></style>`,
      `<rect x="0" y="0" width="${W}" height="${H}" fill="${escapeAttr(bg)}"/>`,
      `<g class="mm-edges" transform="translate(${-ox},${-oy})">${edges.innerHTML}</g>`,
      `<foreignObject x="0" y="0" width="${W}" height="${H}">`,
      `<div xmlns="http://www.w3.org/1999/xhtml" class="mm-root mm-export" style="${escapeAttr(styleVars)};--mm-font:${escapeAttr(font)}">`,
      `<div class="mm-nodes" style="position:absolute;left:${-ox}px;top:${-oy}px">${nodeHtml}</div>`,
      `</div>`,
      `</foreignObject>`,
      `</svg>`
    ].join("");
  }
  function worldSize(world) {
    return {
      x: 0,
      y: 0,
      w: Math.ceil(parseFloat(world.style.width) || world.offsetWidth || 1),
      h: Math.ceil(parseFloat(world.style.height) || world.offsetHeight || 1)
    };
  }
  function cropSize(full, crop) {
    if (!crop) return full;
    return {
      x: Math.max(0, Math.floor(crop.x)),
      y: Math.max(0, Math.floor(crop.y)),
      w: Math.max(1, Math.ceil(crop.w)),
      h: Math.max(1, Math.ceil(crop.h))
    };
  }
  function safeName(title) {
    const base = (title || "mindmap").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
    return base || "mindmap";
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4e3);
  }
  async function exportSvg(rootEl, title, crop) {
    const svg = await buildSvg(rootEl, crop);
    download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeName(title)}.svg`);
  }
  async function exportPng(rootEl, title, scale = 2, crop) {
    const blob = await renderPngBlob(rootEl, scale, crop);
    if (!blob) throw new Error("PNG \u7F16\u7801\u5931\u8D25");
    download(blob, `${safeName(title)}.png`);
  }
  async function renderPngBlob(rootEl, scale = 2, crop) {
    const svg = await buildSvg(rootEl, crop);
    const { world } = worldParts(rootEl);
    const size = cropSize(worldSize(world), crop);
    const W = size.w;
    const H = size.h;
    const maxSide = 8192;
    const s = Math.min(scale, maxSide / Math.max(W, H));
    const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(W * s));
    canvas.height = Math.max(1, Math.round(H * s));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("\u65E0\u6CD5\u521B\u5EFA canvas \u4E0A\u4E0B\u6587");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }
  function exportOutline(title, markdown) {
    download(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${safeName(title)}.md`);
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("SVG \u5149\u6805\u5316\u5931\u8D25"));
      img.src = src;
    });
  }

  // src/utils/api.ts
  function scrollToBlock(id) {
    const el = document.querySelector(`.protyle-wysiwyg [data-node-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("mm-flash");
    window.setTimeout(() => el.classList.remove("mm-flash"), 1400);
  }
  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  // src/core/renderer.ts
  var DROP_BEFORE_RATIO = 0.28;
  var DROP_AFTER_RATIO = 0.72;
  var DRAG_THRESHOLD = 4;
  var HOVER_EXPAND_DELAY = 420;
  var AUTO_SCROLL_MARGIN = 34;
  var AUTO_SCROLL_SPEED = 9;
  var LAYOUT_PAD_X = 72;
  var LAYOUT_PAD_Y = 64;
  var MINIMAP_MIN_NODES = 30;
  var MINIMAP_MAX_RECTS = 700;
  var MODIFIER_ONLY_KEYS = /* @__PURE__ */ new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);
  var LAYOUT_LABEL = {
    logic: "\u903B\u8F91\u7ED3\u6784\u56FE",
    mind: "\u601D\u7EF4\u5BFC\u56FE",
    tree: "\u6811\u72B6\u56FE"
  };
  var EDGE_LABEL = {
    curve: "\u66F2\u7EBF",
    elbow: "\u76F4\u89D2\u6298\u7EBF",
    straight: "\u76F4\u7EBF"
  };
  var GHOST_LABEL = {
    insertChild: "\u52A0\u5B50\u8282\u70B9\u2026",
    insertSiblingBefore: "\u63D2\u5165\u540C\u7EA7\u2026",
    insertSiblingAfter: "\u63D2\u5165\u540C\u7EA7\u2026",
    duplicate: "\u590D\u5236\u2026",
    paste: "\u7C98\u8D34\u2026",
    delete: "\u5220\u9664\u4E2D\u2026",
    indent: "\u964D\u7EA7\u4E2D\u2026",
    outdent: "\u5347\u7EA7\u4E2D\u2026",
    move: "\u79FB\u52A8\u4E2D\u2026",
    moveUp: "\u4E0A\u79FB\u4E2D\u2026",
    moveDown: "\u4E0B\u79FB\u4E2D\u2026",
    toggleCheck: "\u52FE\u9009\u4E2D\u2026",
    check: "\u52FE\u9009\u4E2D\u2026",
    uncheck: "\u53D6\u6D88\u4E2D\u2026"
  };
  var BATCH_DONE_LABEL = {
    indent: "\u5DF2\u6279\u91CF\u964D\u7EA7",
    outdent: "\u5DF2\u6279\u91CF\u5347\u7EA7",
    delete: "\u5DF2\u5220\u9664\u9009\u4E2D\u8282\u70B9\uFF08Ctrl+Z \u53EF\u64A4\u9500\uFF09",
    fold: "\u5DF2\u6298\u53E0\u9009\u4E2D\u8282\u70B9",
    unfold: "\u5DF2\u5C55\u5F00\u9009\u4E2D\u8282\u70B9",
    check: "\u5DF2\u52FE\u9009\u9009\u4E2D\u7684\u5F85\u529E",
    uncheck: "\u5DF2\u53D6\u6D88\u52FE\u9009\u9009\u4E2D\u7684\u5F85\u529E"
  };
  var MIN_SCALE = 0.15;
  var MAX_SCALE = 6;
  var READABLE_SCALE = 0.55;
  var LONG_PRESS_MS = 500;
  var PREVIEW_DELAY = 600;
  var GHOST_TIMEOUT_MS = 4e3;
  var ERROR_FLASH_MS = 900;
  var NEW_NODE_HIGHLIGHT_MS = 1500;
  var BATCH_MIN_SELECTED = 2;
  var COLLAPSE_MS = 210;
  var DONE_DASH = "5 4";
  var FLIP_DURATION = 230;
  var liveViews = /* @__PURE__ */ new Set();
  var keyDispatchInstalled = false;
  function installKeyDispatch() {
    if (keyDispatchInstalled) return;
    keyDispatchInstalled = true;
    document.addEventListener(
      "keydown",
      (e) => {
        const target = e.target;
        if (!target) return;
        for (const v of liveViews) v.handleGlobalKey(e);
      },
      true
    );
  }
  var ICONS = {
    zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20.5 20.5 16 16M11 8.2v5.6M8.2 11h5.6",
    zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20.5 20.5 16 16M8.2 11h5.6",
    fit: "M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5",
    fold: "M8.5 4.5 12 8l3.5-3.5M8.5 19.5 12 16l3.5 3.5M4.5 12h15",
    unfold: "M8.5 8 12 4.5 15.5 8M8.5 16l3.5 3.5L15.5 16M4.5 12h15",
    download: "M12 4v10.5M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15",
    expand: "M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5",
    close: "M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5",
    search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM19.5 19.5 15.4 15.4",
    prev: "M14.5 6 8.5 12l6 6",
    next: "M9.5 6l6 6-6 6",
    present: "M6 4.5 19 12 6 19.5z",
    caret: "M7 10l5 5 5-5",
    level: "M5 7h9M5 12h6M5 17h3",
    trash: "M5 7h14M9.5 7V5h5v2M7 7l1 12h8l1-12"
  };
  function mkIcon(name) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", ICONS[name] ?? "");
    svg.appendChild(p);
    return svg;
  }
  var easeOut = (t) => 1 - Math.pow(1 - t, 3);
  var MindMapView = class {
    constructor(listEl, options, getFoldOverlay, cb, title, mode = "inline") {
      this.title = title;
      this.mode = mode;
      this.tipEl = null;
      this.tree = null;
      this.byId = /* @__PURE__ */ new Map();
      /** 主选中节点 */
      this.selected = null;
      /** 附加选中（框选 / Ctrl 点选） */
      this.extraSel = /* @__PURE__ */ new Set();
      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
      this.worldW = 1;
      this.worldH = 1;
      this.disposers = [];
      this.drag = null;
      this.destroyed = false;
      /** 独立容器模式（全屏弹窗）时不接管源列表的显隐 */
      this.detached = false;
      /** 正在编辑的节点（编辑期间跳过重渲染，避免打断输入） */
      this.editing = null;
      /** 编辑期间被挡下的渲染请求，退出编辑时补做一次 */
      this.pendingRender = false;
      /** 正在拖拽的节点 */
      this.dragging = null;
      /** 当前拖拽落点 */
      this.pendingDrop = null;
      /** 拖放指示器 */
      this.indicatorEl = null;
      /** 框选矩形 */
      this.marqueeEl = null;
      /** 拖拽刚结束，抑制随之而来的 click */
      this.suppressClick = false;
      /* --- 新增状态 --- */
      this.palette0 = "#4c8dff";
      this.canvasRgb = [255, 255, 255];
      this.gapX = 58;
      this.trunkLen = 26;
      this.nodeCount = 0;
      this.flipHandle = 0;
      this.edgePaths = [];
      this.edgeSignature = "";
      /**
       * 搜索命中列表 —— 存的是**块 ID**，不是节点对象。
       *
       * 每次 render() 都会把整棵树重新解析出来，节点对象全是新的；如果这里存对象，
       * 重渲染之后 `hitSet.has(n)` 永远为 false，高亮会**静默全部消失**
       * （实测：搜到 1 条、计数显示 1/1，但画面上一个高亮框都没有）。
       * 存 ID 就能在每次重渲染后按需重新解析。
       */
      this.searchHits = [];
      this.searchIdx = -1;
      this.searchOpen = false;
      /* -------------------------------------------------- 过滤器（P1-1） */
      /**
       * 当前状态过滤器。
       *
       * **只活在内存里**，不写进文档偏好 —— 「我瞄一眼还有哪些没做完」是一次浏览行为，
       * 不该变成下次打开这张图的默认样子。要持久的是视图偏好（布局 / 缩放），不是筛选。
       */
      this.filter = "all";
      /** 工具条上那组 chip，用来同步高亮 / 显隐 */
      this.filterEls = [];
      /** 上一轮过滤命中了几项 —— 用来在「筛完是空的」时说一句人话 */
      this.filterHits = 0;
      /* -------------------------------------------------- 节点标记（P1-2） */
      /** 打开着的标记浮层。跟着节点走，所以只记 ID，重渲染后按 ID 重新定位 */
      this.markPop = null;
      this.markPopId = "";
      /**
       * 标记覆盖表（**活引用**，每次 render 现读）。
       *
       * 写块属性到内核把 DOM 推回来之间有几百毫秒。这段空窗里任何一次重渲染
       * 都会按**旧属性**解析，刚设好的标记会「闪一下再回来」。
       * 与折叠同步（`getFoldOverlay`）是同一个套路：先给结果，再等真相。
       * 每项带 3 秒超时 —— 写失败了就让它消失，别留一个永远不会成真的假象。
       */
      this.markOverlay = /* @__PURE__ */ new Map();
      /* -------------------------------------------------- 跨图搜索（P1-1） */
      /** 搜索范围是不是「本文档所有导图」 */
      this.searchAll = false;
      /** 最近一次跨图搜索的命中，点结果时按 id 取 */
      this.docHits = [];
      /** 跨图搜索的防抖句柄 —— 每敲一个字都打一次 SQL 太浪费 */
      this.docSearchTimer = 0;
      /** 请求序号：只认最后一次的返回，防止慢的请求盖掉快的 */
      this.docSearchSeq = 0;
      /** 小地图缩放比，更新视口框时复用 */
      this.minimapK = 1;
      /**
       * 小地图上「可能被标记」的节点及其换算好的坐标。
       *
       * 选中 / 搜索命中会变，但小地图的底图（那些 rect）不用跟着重画。
       * 把它们缓存下来，选择一变只重写标记那一层 —— 跟 `updateMinimapView`
       * 只动视口框是同一个思路。缓存的是**可见**节点的几何，折起来的子树
       * 没参与过布局，坐标是上一轮的残留，标出来会浮在错误的位置。
       */
      this.minimapMarks = [];
      this.clipboard = "";
      this.tipTarget = null;
      /**
       * 插件自己弹出的菜单里，当前还开着的那一个。
       *
       * 为什么要自己记一笔：导图的键盘处理挂在 document 的**捕获**阶段，
       * 一定比思源 Menu 自己的监听先拿到 Esc。菜单开着时按 Esc，会被我们
       * `take()` 掉（去清选中 / 退下钻），Menu 一个键都收不到 ——
       * 用户看到的是「菜单关不掉，反倒把选中弄丢了」。
       * 记下来，Esc 就先把菜单收掉。
       */
      this.activeMenu = null;
      this.hoverExpandTimer = 0;
      this.autoScrollTimer = 0;
      this.autoScrollDir = { x: 0, y: 0 };
      /**
       * 下钻路径：从「原文根」到「当前聚焦节点」的一串块 ID。
       *
       * 存 ID 而不是节点引用 —— 结构一变（Protyle 重建 DOM、内核回推）旧引用就作废了，
       * 而 ID 每次 render 都能在刚解析出来的树上重新走一遍。
       * 中途某一环被删掉时自动截断到最长的有效前缀，不会让用户卡在空白里。
       */
      this.drillPath = [];
      /** 搜索用的检索串缓存（正文 + 链接地址 + 图片 alt），节点对象重建即失效 */
      this.hayCache = /* @__PURE__ */ new WeakMap();
      /* --- 结构操作的乐观反馈（P0-2） --- */
      /**
       * 在途的乐观占位框：token → 占位元素。
       *
       * 结构操作要等「写内核 → 内核回推 → 扫描重挂」一整圈，中间几百毫秒画面毫无变化，
       * 用户会以为没点上、再点一次（结果插了两个）。所以发起动作的**当下**先放一个
       * 虚线占位框，拿到结果再决定撤掉还是报错。
       *
       * 存的是元素本身而不是节点引用 —— 占位框不属于这棵树，不需要跨渲染存活。
       */
      this.ghosts = /* @__PURE__ */ new Map();
      this.ghostSeq = 0;
      /** 刚插入的节点块 ID，用于给真节点补一圈高亮描边（P1-2） */
      this.freshIds = /* @__PURE__ */ new Set();
      this.freshTimer = 0;
      /* --- 批量操作条（P0-1） --- */
      this.batchEl = null;
      this.batchCountEl = null;
      /**
       * 批量条上的「完成 / 取消」按钮。
       *
       * 操作条是**建一次复用**的，但这两个按钮只对「选中里含待办」的场合有意义 ——
       * 全是普通段落时它们必须消失，否则点下去只会得到一句「没有待办项」。
       * 所以存下引用，在每次刷新时按选区内容切换显隐。
       */
      this.batchCheckEls = [];
      /* --- 悬停预览（P1-1） --- */
      this.previewEl = null;
      this.previewTimer = 0;
      this.previewTarget = null;
      /* --- 演示模式（P2-3） --- */
      this.presenting = false;
      this.presentIdx = 0;
      this.presentOrder = [];
      /**
       * 演示模式专用的折叠覆盖表（**只活在内存里，退出即清空**）。
       *
       * 为什么它可以存在：演示是「换一个视角讲这张图」，属于**临时的呈现透镜**，
       * 不是内容状态。它从不写回大纲，退出时清空后重新渲染，看到的就又是
       * 大纲里那个折叠状态 —— 真相源始终只有思源原生 `fold` 一个。
       * 这与「给导图独立折叠状态」是两回事，后者会被持久化、会与大纲打架。
       */
      this.presentFold = /* @__PURE__ */ new Map();
      this.presentBarEl = null;
      this.presentCountEl = null;
      /* --- 折叠收拢动画（P2-5） --- */
      this.collapseHandles = [];
      /* --- 大纲 ↔ 导图 双向高亮（P2-1） --- */
      /** 大纲光标所在的块 ID */
      this.cursorId = "";
      /** 视图偏好（P0-3）—— 由外部注入，改过之后通过 onViewPrefs 回传 */
      this.prefs = {};
      /** 哪些项是「用户显式改过」的，只有这些才写进文档 */
      this.prefsDirty = /* @__PURE__ */ new Set();
      this.listEl = listEl;
      this.options = { ...options };
      this.globalDefaults = { layout: options.layout, theme: options.theme, edge: options.edge };
      this.getFoldOverlay = getFoldOverlay;
      this.cb = cb;
      this.rootEl = document.createElement("div");
      this.rootEl.className = "mm-root";
      this.rootEl.dataset.mmFor = listEl.dataset.nodeId ?? "";
      this.rootEl.setAttribute("contenteditable", "false");
      this.rootEl.setAttribute("spellcheck", "false");
      this.rootEl.tabIndex = 0;
      this.toolbarEl = document.createElement("div");
      this.toolbarEl.className = "mm-toolbar";
      this.crumbEl = document.createElement("div");
      this.crumbEl.className = "mm-crumb";
      this.viewportEl = document.createElement("div");
      this.viewportEl.className = "mm-viewport";
      this.worldEl = document.createElement("div");
      this.worldEl.className = "mm-world";
      this.edgesEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.edgesEl.setAttribute("class", "mm-edges");
      this.nodesEl = document.createElement("div");
      this.nodesEl.className = "mm-nodes";
      this.emptyEl = document.createElement("div");
      this.emptyEl.className = "mm-empty";
      this.emptyEl.innerHTML = "<strong>\u8FD9\u91CC\u8FD8\u6CA1\u6709\u5185\u5BB9</strong><span>\u5728\u5217\u8868\u91CC\u6DFB\u52A0\u6761\u76EE\uFF0C\u5BFC\u56FE\u4F1A\u5B9E\u65F6\u540C\u6B65</span>";
      this.zoomBarEl = document.createElement("div");
      this.zoomBarEl.className = "mm-zoombar";
      this.minimapEl = document.createElement("div");
      this.minimapEl.className = "mm-minimap";
      this.minimapEl.style.display = "none";
      this.searchEl = document.createElement("div");
      this.searchEl.className = "mm-search";
      this.worldEl.append(this.edgesEl, this.nodesEl);
      this.viewportEl.append(this.worldEl, this.emptyEl, this.minimapEl, this.zoomBarEl, this.searchEl);
      this.rootEl.append(this.toolbarEl, this.crumbEl, this.viewportEl);
    }
    /* ==================================================================== 挂载 */
    /**
     * 挂载视图。
     * @param container 省略时挂到源列表块内部并隐藏原大纲；传入时作为独立容器使用（全屏弹窗）。
     */
    mount(container) {
      this.buildToolbar();
      this.buildZoomBar();
      this.buildSearch();
      if (container) {
        this.detached = true;
        this.rootEl.classList.add(this.mode === "side" ? "mm-root--side" : "mm-root--dialog");
      } else {
        container = this.listEl;
        this.listEl.classList.add("mm-source-hidden");
      }
      container.appendChild(this.rootEl);
      this.bindEvents();
      this.render(true);
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.editing = null;
      this.dragging = null;
      this.pendingDrop = null;
      this.clearIndicator();
      this.hideTip();
      this.hidePreview();
      this.hideBatchBar();
      this.hidePresentBar();
      this.closeMarkPopover();
      this.clearOutlineCursor();
      this.tipEl?.remove();
      this.tipEl = null;
      if (this.flipHandle) cancelAnimationFrame(this.flipHandle);
      this.flipHandle = 0;
      for (const g of this.ghosts.values()) {
        window.clearTimeout(g.timer);
        g.el.remove();
      }
      this.ghosts.clear();
      if (this.freshTimer) window.clearTimeout(this.freshTimer);
      this.freshTimer = 0;
      this.freshIds.clear();
      for (const h of this.collapseHandles) cancelAnimationFrame(h);
      this.collapseHandles = [];
      window.clearTimeout(this.hoverExpandTimer);
      this.stopAutoScroll();
      this.disposers.forEach((fn) => fn());
      this.disposers = [];
      this.rootEl.remove();
      if (!this.detached) {
        this.listEl.classList.remove("mm-source-hidden");
        this.listEl.removeAttribute("data-mm-mounted");
      }
      this.edgePaths = [];
      this.extraSel.clear();
    }
    get element() {
      return this.rootEl;
    }
    /**
     * 给「复制诊断信息」用的一行状态摘要（P1-5）。
     *
     * 只报**事实**，不做任何格式化排版 —— 排版归 diagnostics 那边管，
     * 这里多写一个冒号都会变成两处要同步的格式。
     */
    diagLine() {
      return {
        mode: this.mode,
        listId: this.listEl.dataset.nodeId ?? "",
        nodes: this.nodeCount,
        layout: this.options.layout,
        theme: this.options.theme,
        edge: this.options.edge,
        branchColor: this.options.branchColor ? "on" : "off",
        scale: Math.round(this.scale * 100),
        filter: this.filter,
        selected: (this.selected ? 1 : 0) + this.extraSel.size,
        drill: this.drillPath.length
      };
    }
    /** 被渲染的源列表元素 */
    get source() {
      return this.listEl;
    }
    /**
     * 换源：指向新的源列表元素。
     *
     * Protyle 在做结构操作（尤其 moveBlock）之后会把整个 `.list` 元素**重建**，
     * 旧元素变成游离节点。行内视图靠「源元素不在文档里就卸载重挂」自然绕过这个问题，
     * 但全屏弹层里的视图活在弹层里、不会跟着源元素一起消失，它会一直握着旧引用 ——
     * 于是 parseList 读到的永远是旧内容，签名永不变化、永不重渲染。
     * 表现出来就是「全屏里做了操作，界面一动不动」，用户会当成不能编辑。
     */
    setSource(el) {
      if (this.listEl === el) return;
      this.listEl = el;
    }
    /**
     * 把焦点收回导图。
     *
     * 撤销 / 重做会整块重写列表块，Protyle 随之重建 DOM ——
     * 行内视图会被卸载重挂，焦点掉到 body 上，**下一次 Ctrl+Z 就没人接了**。
     * 所以撤销之后要把焦点接回来。
     */
    focusRoot() {
      if (this.destroyed) return;
      this.rootEl.focus({ preventScroll: true });
    }
    /** 只更新渲染参数，不重建视图 */
    setOptions(options) {
      if (options.layout) this.globalDefaults.layout = options.layout;
      if (options.theme) this.globalDefaults.theme = options.theme;
      if (options.edge) this.globalDefaults.edge = options.edge;
      Object.assign(this.options, options);
      this.syncToolbar();
      this.render(true);
    }
    /**
     * 注入「文档级视图偏好」，覆盖全局默认。**必须在 `mount()` 之前调用**。
     *
     * 只覆盖用户显式改过的项 —— 没改过的继续跟随全局默认，
     * 否则用户改了全局主题之后所有文档都不跟着变，反而更别扭。
     */
    applyViewPrefs(prefs) {
      this.prefs = { ...prefs };
      this.prefsDirty.clear();
      if (prefs.layout) this.options.layout = prefs.layout;
      if (prefs.theme) this.options.theme = prefs.theme;
      if (prefs.edge) this.options.edge = prefs.edge;
      this.syncToolbar();
    }
    /** 当前这份视图偏好（只含「用户显式改过」的项） */
    get viewPrefs() {
      return { ...this.prefs };
    }
    /**
     * 记一项视图偏好，并通知外部（外部负责防抖写入块属性）。
     *
     * 记进 `prefs` 的同时也把 options 改掉 —— 这两份必须同步，
     * 否则下次 `setOptions` 从全局默认推一遍就会把用户的选择冲掉。
     */
    markPref(key, value) {
      this.prefs[key] = value;
      this.prefsDirty.add(key);
      this.cb.onViewPrefs({ ...this.prefs });
    }
    /** 忘掉一项偏好（下次打开回到全局默认） */
    forgetPref(key) {
      delete this.prefs[key];
      this.prefsDirty.delete(key);
      this.cb.onViewPrefs({ ...this.prefs });
    }
    /**
     * 清空文档级偏好，并把被偏好覆盖过的三项**显式**拉回全局默认。
     *
     * ## ⚠️ 为什么不能只调 `applyViewPrefs({})`
     *
     * `applyViewPrefs` 的语义是「用偏好**覆盖**全局默认」，所以它是
     * `if (prefs.layout) this.options.layout = prefs.layout;` 这样写的 ——
     * **只覆盖显式给出的项**。传空对象进去，它一项都不覆盖。
     *
     * 于是「恢复本列表的默认视图」原来这么写就废了：
     *
     * ```ts
     * for (const k of Object.keys(this.prefs)) this.forgetPref(k);   // prefs 清空 ✓
     * this.applyViewPrefs({});                                       // options 纹丝不动 ✗
     * this.render(true);                                             // 画出来还是旧布局
     * ```
     *
     * 结果：块属性里的偏好确实被删干净了（下次打开这个列表会回到默认），
     * 但**当前画面一点变化都没有**，而 toast 已经说了「已恢复默认视图」——
     * 一个会说谎的提示，比什么都不做更糟。
     *
     * 这个语义本身没错（`applyViewPrefs` 就该只覆盖显式项），
     * 错在「恢复默认」这个动作少了一半：它既要**清掉覆盖**，也要**把覆盖层撤掉**。
     */
    resetToGlobal() {
      this.prefs = {};
      this.prefsDirty.clear();
      this.options.layout = this.globalDefaults.layout;
      this.options.theme = this.globalDefaults.theme;
      this.options.edge = this.globalDefaults.edge;
      this.syncToolbar();
      this.render(true);
    }
    /* ==================================================================== 工具条 */
    buildToolbar() {
      const seg = document.createElement("div");
      seg.className = "mm-seg";
      for (const key of ["logic", "mind", "tree"]) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.layout = key;
        b.textContent = LAYOUT_LABEL[key];
        b.dataset.mmTip = LAYOUT_LABEL[key];
        b.onclick = (e) => {
          e.stopPropagation();
          this.options.layout = key;
          this.cb.onLayoutChange(key);
          this.markPref("layout", key);
          this.syncToolbar();
          this.render(true);
        };
        seg.appendChild(b);
      }
      const spacer = document.createElement("div");
      spacer.className = "mm-spacer";
      const foldGroup = document.createElement("div");
      foldGroup.className = "mm-group";
      foldGroup.append(
        this.mkToolBtn("fold", "\u6298\u53E0\u5168\u90E8", () => this.foldAll(true)),
        this.mkToolBtn("unfold", "\u5C55\u5F00\u5168\u90E8", () => this.foldAll(false))
      );
      this.filterGroup = document.createElement("div");
      this.filterGroup.className = "mm-group mm-filters";
      this.filterEls = ["all", "todo", "done"].map((key) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.filter = key;
        b.textContent = FILTER_LABEL[key];
        b.dataset.mmTip = key === "all" ? "\u663E\u793A\u5168\u90E8\u8282\u70B9" : `\u53EA\u770B${FILTER_LABEL[key]}\u7684\u5F85\u529E`;
        b.onclick = (e) => {
          e.stopPropagation();
          this.setFilter(key);
        };
        this.filterGroup.appendChild(b);
        return b;
      });
      this.filterGroup.style.display = "none";
      const actGroup = document.createElement("div");
      actGroup.className = "mm-group";
      actGroup.append(this.mkToolBtn("search", "\u641C\u7D22\u8282\u70B9", () => this.toggleSearch(), "Ctrl F"));
      actGroup.append(this.mkToolBtn("level", "\u89C6\u56FE\u9009\u9879\uFF08\u4E3B\u9898 / \u8FDE\u7EBF / \u914D\u8272\uFF09", (e) => this.openViewMenu(e)));
      actGroup.append(this.mkToolBtn("present", "\u6F14\u793A\u6A21\u5F0F\uFF1A\u9010\u5C42\u5C55\u5F00\uFF0C\u65B9\u5411\u952E\u63A8\u8FDB", () => this.togglePresent(), ""));
      actGroup.append(this.mkToolBtn("download", "\u5BFC\u51FA\u56FE\u7247", (e) => this.openExportMenu(e)));
      if (this.mode === "inline") {
        actGroup.append(
          this.mkToolBtn("expand", "\u5168\u5C4F\u67E5\u770B", () => {
            if (this.tree) this.cb.onFullscreen(this.tree, resolveTheme(this.options.theme));
          })
        );
      }
      actGroup.append(
        this.mkToolBtn(
          "close",
          this.mode === "dialog" ? "\u5173\u95ED" : "\u56DE\u5230\u5927\u7EB2\u89C6\u56FE",
          () => this.cb.onExit()
        )
      );
      this.toolbarEl.append(seg, this.mkSep(), foldGroup, this.filterGroup, spacer, actGroup);
      this.syncToolbar();
    }
    mkSep() {
      const d = document.createElement("div");
      d.className = "mm-sep";
      return d;
    }
    mkToolBtn(icon, tip, fn, key) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mm-icon";
      b.dataset.mmTip = tip;
      if (key) b.dataset.mmKey = key;
      b.appendChild(mkIcon(icon));
      b.onclick = (e) => {
        e.stopPropagation();
        fn(e);
      };
      return b;
    }
    buildZoomBar() {
      const mk = (label2, tip, fn, key) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label2;
        b.dataset.mmTip = tip;
        if (key) b.dataset.mmKey = key;
        b.onclick = (e) => {
          e.stopPropagation();
          fn(e);
        };
        return b;
      };
      const label = document.createElement("button");
      label.type = "button";
      label.className = "mm-zoom-label";
      label.dataset.mmTip = "\u7F29\u653E\u9009\u9879";
      label.dataset.mmKey = "Ctrl 1";
      label.onclick = (e) => {
        e.stopPropagation();
        this.openZoomMenu(e);
      };
      const val = document.createElement("span");
      val.className = "mm-zoom-val";
      val.textContent = "100%";
      label.append(val, mkIcon("caret"));
      this.zoomLabel = val;
      this.zoomBarEl.append(
        mk("\u2212", "\u7F29\u5C0F", () => this.zoomAt(1 / 1.2), "Ctrl -"),
        label,
        mk("+", "\u653E\u5927", () => this.zoomAt(1.2), "Ctrl ="),
        mk("\u9002\u5E94", "\u9002\u5E94\u753B\u5E03", () => this.fit(), "Ctrl 0")
      );
    }
    /**
     * 建一个插件自己的菜单，并挂上「关闭时自动注销」的回调。
     *
     * 只建不弹 —— 调用方加完菜单项再交给 {@link popMenu}。
     * `closeCB` 在菜单关闭时触发（Esc 关的、点空白关的、点中某一项关的都算），
     * 拿对象同一性判一下再清，免得把后开的那个新菜单一起清掉。
     */
    makeMenu(id) {
      const menu = new Menu(id, () => {
        if (this.activeMenu === menu) this.activeMenu = null;
      });
      return menu;
    }
    /**
     * 弹出菜单，并把它登记为「当前打开的菜单」。
     *
     * 为什么不用 `Menu.isOpen` 判断：实测（思源 3.8.4）`open()` 之后它**仍然是 false**，
     * 拿它当门闸的话 Esc 分支整个不生效 —— 表现出来就是「菜单关不掉，反倒把选中弄丢了」。
     * 自己记一笔最稳。
     */
    popMenu(menu, e) {
      this.activeMenu = menu;
      menu.open({ x: e?.clientX ?? 0, y: e?.clientY ?? 0 });
    }
    /**
     * 缩放菜单。
     *
     * 原来那个 `100%` 按钮的语义是「回到 1.0」—— 但用户真正想干的事
     * 往往是「缩放到能看清这个分支」。把这几件事收进一个下拉，
     * 顺带把「记住这个缩放」（文档级偏好）也放进来。
     */
    openZoomMenu(e) {
      const menu = this.makeMenu("mm-zoom-menu");
      const item = (label, key, disabled, click) => menu.addItem({ label: key ? `${label}    ${key}` : label, disabled, click });
      item("100%", "Ctrl 1", Math.abs(this.scale - 1) < 5e-3, () => this.setScale(1));
      item("\u9002\u5E94\u753B\u5E03", "Ctrl 0", false, () => this.fit());
      const sel = this.selNodes;
      item("\u9002\u5E94\u9009\u4E2D\u8282\u70B9", "", sel.length === 0, () => this.fitToNodes(sel));
      item(
        this.drillPath.length > 0 ? "\u53EA\u770B\u5F53\u524D\u5206\u652F\uFF08\u5DF2\u805A\u7126\uFF09" : "\u53EA\u770B\u5F53\u524D\u5206\u652F",
        "Ctrl \u53CC\u51FB",
        !this.selected || this.selected.children.length === 0,
        () => {
          if (this.selected) this.drillDown(this.selected);
        }
      );
      menu.addItem({ type: "separator" });
      const remembered = this.prefs.scale !== void 0;
      item(remembered ? "\u8BB0\u4F4F\u8FD9\u4E2A\u7F29\u653E \u2713" : "\u8BB0\u4F4F\u8FD9\u4E2A\u7F29\u653E", "", false, () => this.toggleRememberScale());
      this.popMenu(menu, e);
    }
    /** 视图选项菜单：主题 / 连线样式 —— 与布局一样，都记进文档级偏好 */
    openViewMenu(e) {
      const menu = this.makeMenu("mm-view-menu");
      const themeItems = THEME_LIST.map((t) => ({
        label: t.name,
        checked: this.options.theme === t.id,
        click: () => {
          this.options.theme = t.id;
          this.markPref("theme", t.id);
          this.render(true);
        }
      }));
      menu.addItem({ icon: "iconTheme", label: "\u4E3B\u9898", type: "submenu", submenu: themeItems });
      const edgeItems = ["curve", "elbow", "straight"].map((k) => ({
        label: EDGE_LABEL[k],
        checked: this.options.edge === k,
        click: () => {
          this.options.edge = k;
          this.markPref("edge", k);
          this.drawEdges();
        }
      }));
      menu.addItem({ icon: "iconLine", label: "\u8FDE\u7EBF\u6837\u5F0F", type: "submenu", submenu: edgeItems });
      menu.addItem({ type: "separator" });
      const hasPrefs = Object.keys(this.prefs).length > 0;
      menu.addItem({
        icon: "iconUndo",
        label: "\u6062\u590D\u672C\u5217\u8868\u7684\u9ED8\u8BA4\u89C6\u56FE",
        disabled: !hasPrefs,
        click: () => {
          for (const k of Object.keys(this.prefs)) this.forgetPref(k);
          this.resetToGlobal();
          showMessage("\u5DF2\u6062\u590D\u9ED8\u8BA4\u89C6\u56FE", 2e3);
        }
      });
      this.popMenu(menu, e);
    }
    /** 缩放到刚好框住这些节点 */
    fitToNodes(nodes) {
      if (nodes.length === 0) {
        showMessage("\u5148\u9009\u4E2D\u4E00\u4E2A\u8282\u70B9", 2200);
        return;
      }
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const walk = (n) => {
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + n.w);
        y1 = Math.max(y1, n.y + n.h);
        n.kids.forEach(walk);
      };
      nodes.forEach(walk);
      const vw = this.viewportEl.clientWidth;
      const vh = this.viewportEl.clientHeight;
      if (!Number.isFinite(x0) || vw <= 1 || vh <= 1) return;
      const pad = 48;
      const w = x1 - x0 + pad * 2;
      const h = y1 - y0 + pad * 2;
      const k = Math.min(Math.max(Math.min(vw / w, vh / h), MIN_SCALE), MAX_SCALE);
      this.scale = k;
      this.tx = vw / 2 - (x0 + x1) / 2 * k;
      this.ty = vh / 2 - (y0 + y1) / 2 * k;
      this.updateTransform();
    }
    /** 记住 / 忘记当前缩放（写进文档级偏好） */
    toggleRememberScale() {
      if (this.prefs.scale !== void 0) {
        this.forgetPref("scale");
        showMessage("\u5DF2\u53D6\u6D88\u8BB0\u4F4F\u7F29\u653E", 2e3);
        return;
      }
      this.markPref("scale", this.scale);
      showMessage(`\u5DF2\u8BB0\u4F4F\u8FD9\u4E2A\u7F29\u653E\uFF08${Math.round(this.scale * 100)}%\uFF09`, 2200);
    }
    buildSearch() {
      this.searchInput = document.createElement("input");
      this.searchInput.type = "text";
      this.searchInput.placeholder = "\u641C\u7D22\u8282\u70B9\u2026";
      this.searchInput.spellcheck = false;
      this.searchInput.oninput = () => this.runSearch(this.searchInput.value);
      this.searchInput.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          if (this.searchAll) this.pickDocHit(0);
          else this.stepSearch(e.shiftKey ? -1 : 1);
        } else if (e.key === "ArrowDown" && this.searchAll && this.docHits.length) {
          e.preventDefault();
          this.pickDocHit(0);
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.toggleSearch(false);
        }
      };
      this.searchCount = document.createElement("span");
      this.searchCount.className = "mm-search-count";
      const mk = (text, tip, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.dataset.mmTip = tip;
        b.onclick = (e) => {
          e.stopPropagation();
          fn();
        };
        return b;
      };
      this.scopeBtn = mk("\u672C\u56FE", "\u5207\u6362\u641C\u7D22\u8303\u56F4\uFF1A\u5F53\u524D\u5BFC\u56FE / \u672C\u6587\u6863\u6240\u6709\u5BFC\u56FE", () => this.setSearchScope(!this.searchAll));
      this.scopeBtn.className = "mm-search-scope";
      this.resultsEl = document.createElement("div");
      this.resultsEl.className = "mm-results";
      const row = document.createElement("div");
      row.className = "mm-search-row";
      row.append(
        this.searchInput,
        this.searchCount,
        this.scopeBtn,
        mk("\u2039", "\u4E0A\u4E00\u4E2A", () => this.stepSearch(-1)),
        mk("\u203A", "\u4E0B\u4E00\u4E2A", () => this.stepSearch(1)),
        mk("\u2715", "\u5173\u95ED\u641C\u7D22", () => this.toggleSearch(false))
      );
      this.searchEl.append(row, this.resultsEl);
    }
    /** 切换搜索范围，并立刻按新范围重跑一次 */
    setSearchScope(all) {
      this.searchAll = all;
      this.scopeBtn.textContent = all ? "\u5168\u6587\u6863" : "\u672C\u56FE";
      this.scopeBtn.classList.toggle("mm-on", all);
      this.runSearch(this.searchInput.value);
      if (all) this.searchInput.focus();
    }
    /** 跨图搜索的结果面板 */
    renderDocResults() {
      if (!this.searchAll || !this.searchInput.value.trim()) {
        this.resultsEl.classList.remove("mm-results--on");
        this.resultsEl.innerHTML = "";
        return;
      }
      this.updateSearchCount();
      this.resultsEl.innerHTML = "";
      this.resultsEl.classList.add("mm-results--on");
      if (this.docHits.length === 0) {
        const none = document.createElement("div");
        none.className = "mm-result mm-result--none";
        none.textContent = "\u672C\u6587\u6863\u7684\u5BFC\u56FE\u91CC\u6CA1\u6709\u5339\u914D\u7684\u8282\u70B9";
        this.resultsEl.appendChild(none);
        return;
      }
      for (const [i, hit] of this.docHits.entries()) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "mm-result";
        const text = document.createElement("span");
        text.className = "mm-result-text";
        text.textContent = hit.text;
        const path = document.createElement("span");
        path.className = "mm-result-path";
        const anc = hit.path.includes(" \u203A ") ? hit.path.slice(0, hit.path.lastIndexOf(" \u203A ")) : "";
        path.textContent = hit.listId === this.listEl.dataset.nodeId ? "\u672C\u56FE" : anc || "\u53E6\u4E00\u5F20\u5BFC\u56FE";
        row.append(text, path);
        row.dataset.mmTip = hit.path;
        row.onclick = (e) => {
          e.stopPropagation();
          this.pickDocHit(i);
        };
        this.resultsEl.appendChild(row);
      }
    }
    /**
     * 跳到某条跨图命中。
     *
     * 两种情况分得很清楚：
     *  - 命中就在**当前这张图**里 → 直接聚焦那个节点（还能顺手展开它的祖先）；
     *  - 命中在**别的导图**里 → 把编辑器滚过去并高亮。
     *    不去偷偷切换视图：用户正在这张图上干活，把画面换掉是一种冒犯。
     */
    pickDocHit(i) {
      const hit = this.docHits[i];
      if (!hit) return;
      if (hit.listId === this.listEl.dataset.nodeId && this.byId.has(hit.id)) {
        const node = this.byId.get(hit.id);
        if (node.hidden) {
          this.filter = "all";
          this.render(true);
        }
        this.searchHits = [hit.id];
        this.searchIdx = 0;
        this.updateSearchCount();
        this.applySearchMarks();
        this.gotoHit();
      } else {
        scrollToBlock(hit.id);
        showMessage("\u5DF2\u5B9A\u4F4D\u5230\u6B63\u6587\u91CC\u7684\u90A3\u4E2A\u8282\u70B9", 2200);
      }
      this.searchInput.focus();
    }
    syncToolbar() {
      this.toolbarEl.querySelectorAll("[data-layout]").forEach((el) => {
        el.classList.toggle("mm-on", el.dataset.layout === this.options.layout);
      });
    }
    openExportMenu(event) {
      const menu = this.makeMenu("mm-export-menu");
      const sel = this.selNodes.length;
      menu.addItem({
        icon: "iconImage",
        label: "\u5BFC\u51FA PNG",
        click: () => void this.doExport("png")
      });
      menu.addItem({
        icon: "iconFile",
        label: "\u5BFC\u51FA SVG",
        click: () => void this.doExport("svg")
      });
      menu.addItem({ type: "separator" });
      menu.addItem({
        icon: "iconImage",
        label: sel > 1 ? `\u53EA\u5BFC\u51FA\u9009\u4E2D\u7684 ${sel} \u4E2A\u8282\u70B9` : "\u53EA\u5BFC\u51FA\u9009\u4E2D\uFF08\u5148\u9009\u8282\u70B9\uFF09",
        disabled: sel === 0,
        click: () => void this.doExport("png", this.selectedInDocOrder())
      });
      menu.addItem({
        icon: "iconCopy",
        label: "\u590D\u5236\u4E3A\u56FE\u7247\u5230\u526A\u8D34\u677F",
        click: () => void this.copyImage()
      });
      menu.addItem({
        icon: "iconFile",
        label: "\u5BFC\u51FA Markdown \u5927\u7EB2",
        click: () => {
          const md = this.outlineMarkdown();
          if (!md) {
            showMessage("\u5BFC\u56FE\u662F\u7A7A\u7684\uFF0C\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u5185\u5BB9", 2400);
            return;
          }
          exportOutline(this.title, md);
        }
      });
      this.popMenu(menu, event);
    }
    async doExport(kind, only) {
      const restore = this.prepareExport(only);
      const crop = (only ? this.selectionBounds(only) : null) ?? void 0;
      if (only && !crop) {
        restore();
        showMessage("\u9009\u4E2D\u7684\u8282\u70B9\u90FD\u4E0D\u5728\u753B\u9762\u4E0A\uFF0C\u65E0\u6CD5\u5BFC\u51FA", 2600, "error");
        return;
      }
      try {
        if (kind === "png") await exportPng(this.rootEl, this.title, 2, crop);
        else await exportSvg(this.rootEl, this.title, crop);
        if (only) showMessage(`\u5DF2\u5BFC\u51FA\u9009\u4E2D\u7684 ${only.length} \u4E2A\u8282\u70B9`, 2e3);
      } catch (err) {
        console.warn("[mindmap] \u5BFC\u51FA\u5931\u8D25", err);
        showMessage("\u5BFC\u51FA\u5931\u8D25", 4e3, "error");
      } finally {
        restore();
      }
    }
    /**
     * 导出前临时清掉选中 / 搜索 / 悬停 / 动效残留，导出后恢复。
     *
     * 传了 `only` 就进入「只导选中」模式：把不相关的节点与连线藏起来，
     * 这样裁剪框里不会混进旁边那些「没被选中但恰好落在框内」的节点。
     */
    prepareExport(only) {
      const root = this.rootEl;
      const prevSel = this.selected;
      const prevExtra = new Set(this.extraSel);
      this.hideTip();
      this.hidePreview();
      let hiddenNodes = [];
      let hiddenEdges = [];
      if (only && only.length > 0) {
        const keep = this.selectionIds(only);
        hiddenNodes = [];
        const walk = (n) => {
          if (n.el && n.id && !keep.has(n.id)) {
            n.el.classList.add("mm-hidden");
            hiddenNodes.push(n.el);
          }
          n.children.forEach(walk);
        };
        if (this.tree) walk(this.tree);
        hiddenEdges = Array.from(this.edgesEl.querySelectorAll("path")).filter((p) => {
          const pid = p.dataset.mmParent ?? "";
          const off = !keep.has(pid);
          if (off) p.style.display = "none";
          return off;
        });
      }
      this.selected = null;
      this.extraSel.clear();
      this.refreshSelection();
      const strip = (n) => {
        if (n.el) {
          n.el.style.transform = "";
          n.el.classList.remove("mm-enter");
        }
        n.kids.forEach(strip);
      };
      if (this.tree) strip(this.tree);
      if (this.flipHandle) {
        cancelAnimationFrame(this.flipHandle);
        this.flipHandle = 0;
      }
      root.classList.add("mm-export");
      return () => {
        root.classList.remove("mm-export");
        for (const el of hiddenNodes) el.classList.remove("mm-hidden");
        for (const p of hiddenEdges) p.style.display = "";
        this.selected = prevSel;
        this.extraSel = prevExtra;
        this.refreshSelection();
      };
    }
    /* ==================================================================== 渲染 */
    /**
     * 重新渲染。
     * @param fitView 是否在渲染后重置视图。只有「用户主动改变结构」时才传 true；
     *                编辑器里打字引起的重渲染必须保持当前平移与缩放，否则画面会一直跳。
     */
    render(fitView = false) {
      if (this.destroyed) return;
      if (this.editing) {
        this.pendingRender = true;
        return;
      }
      this.pendingRender = false;
      const firstRender = this.tree === null;
      const oldTree = this.tree;
      const theme = resolveTheme(this.options.theme);
      const palette = this.paletteOf(theme);
      const font = getComputedStyle(document.body).fontFamily || "sans-serif";
      applyTheme(this.rootEl, theme, font);
      this.rootEl.classList.toggle("mm-hc", theme.id === "contrast");
      this.palette0 = palette[0] ?? theme.palette[0];
      this.canvasRgb = readRgb(this.rootEl);
      const prev = this.options.flipAnimation && this.tree ? this.snapshot() : null;
      if (this.flipHandle) {
        cancelAnimationFrame(this.flipHandle);
        this.flipHandle = 0;
      }
      const items = parseList(this.listEl);
      if (items.length === 0) {
        this.tree = null;
        this.byId.clear();
        this.nodesEl.innerHTML = "";
        this.edgesEl.innerHTML = "";
        this.edgePaths = [];
        this.edgeSignature = "";
        this.worldW = 1;
        this.worldH = 1;
        this.worldEl.style.width = "0px";
        this.worldEl.style.height = "0px";
        this.nodeCount = 0;
        this.emptyEl.style.display = "";
        this.refreshSelection();
        this.refreshMinimap();
        this.syncFilterGroup();
        return;
      }
      this.emptyEl.style.display = "none";
      const root0 = wrapRoot(items, this.title);
      const root = this.applyDrill(root0);
      decorate(root, palette, this.options.branchColor);
      for (const n of flatten(root)) if (n.mark?.color) n.color = n.mark.color;
      if (this.markOverlay.size > 0) {
        for (const n of flatten(root)) {
          if (!n.id || !this.markOverlay.has(n.id)) continue;
          const want = this.markOverlay.get(n.id) ?? void 0;
          if (sameMark(n.mark, want)) {
            this.markOverlay.delete(n.id);
            continue;
          }
          n.mark = want;
          if (want?.color) n.color = want.color;
        }
      }
      const overlay = this.getFoldOverlay();
      if (overlay.size > 0) {
        for (const n of flatten(root)) {
          if (!n.id) continue;
          const want = overlay.get(n.id);
          if (want !== void 0) n.folded = want;
        }
      }
      if (this.presentFold.size > 0) {
        for (const n of flatten(root)) {
          if (!n.id) continue;
          const want = this.presentFold.get(n.id);
          if (want !== void 0) n.folded = want;
        }
      }
      this.tree = root;
      this.byId = indexById(root);
      this.applyFilter(root);
      this.remapSelection();
      if (this.selected?.hidden) {
        this.selected = null;
        this.extraSel.clear();
      }
      for (const n of [...this.extraSel]) if (n.hidden) this.extraSel.delete(n);
      const vanish = oldTree && this.options.flipAnimation ? this.detachVanishing(oldTree, root) : [];
      this.nodesEl.innerHTML = "";
      this.edgePaths = [];
      this.edgeSignature = "";
      const all = [];
      const build = (n) => {
        const el = this.createNodeEl(n, theme);
        el.style.visibility = "hidden";
        this.nodesEl.appendChild(el);
        n.el = el;
        all.push(n);
        n.children.forEach(build);
      };
      build(root);
      this.nodeCount = all.length;
      const prevZoom = this.worldEl.style.zoom;
      if (prevZoom && prevZoom !== "1") this.worldEl.style.zoom = "1";
      for (const n of all) {
        n.w = n.el.offsetWidth;
        n.h = n.el.offsetHeight;
      }
      if (prevZoom && prevZoom !== "1") this.worldEl.style.zoom = prevZoom;
      const compact = this.options.compact || all.length > this.options.compactThreshold;
      const gapX = compact ? 34 : 58;
      const gapY = compact ? 8 : 16;
      this.gapX = gapX;
      this.trunkLen = Math.max(13, Math.min(gapX * 0.44, 42));
      const box = layout(root, {
        mode: this.options.layout,
        gapX,
        gapY,
        padX: LAYOUT_PAD_X,
        padY: LAYOUT_PAD_Y,
        // 逻辑图分列：单列高度超过可视区的 2.4 倍就摊成多列。
        // 下限 1200 是为了「视口还没量出来」的首次渲染兜底。
        // ⚠️ 这里必须用 availHeight() 而不是 viewportEl.clientHeight —— 后者是
        // 上一轮 resizeViewport 写进去的，会让列数决策依赖渲染次序。
        maxCross: this.options.columnLayout ? Math.max(1200, this.availHeight() * 2.4) : 0
      });
      this.worldW = box.w;
      this.worldH = box.h;
      this.worldEl.style.width = `${box.w}px`;
      this.worldEl.style.height = `${box.h}px`;
      this.edgesEl.setAttribute("width", String(box.w));
      this.edgesEl.setAttribute("height", String(box.h));
      this.edgesEl.setAttribute("viewBox", `0 0 ${box.w} ${box.h}`);
      const place = (n) => {
        const el = n.el;
        el.style.left = `${n.x}px`;
        el.style.top = `${n.y}px`;
        el.style.visibility = "visible";
        el.classList.toggle("mm-left", n.dir === -1);
        this.applyNodeColors(el, n, theme);
        this.placeToggle(n);
        n.kids.forEach(place);
      };
      place(root);
      this.drawEdges();
      this.markFresh();
      this.resizeViewport(box.h);
      this.refreshSelection();
      this.applySearchMarks();
      this.refreshBreadcrumb();
      if (firstRender && this.prefs.scale) this.applyRememberedScale();
      else if (this.options.autoFit && (fitView || !prev)) this.fit({ readable: true });
      else this.updateTransform();
      if (prev) this.runFlip(prev);
      if (vanish.length) this.runCollapse(vanish);
      this.refreshMinimap();
      this.refreshBatchBar();
      this.refreshPresentBar();
      this.syncFilterGroup();
      this.positionMarkPop();
    }
    /* ============================================================ 折叠收拢动画（P2-5） */
    /**
     * 把「这一轮会消失的节点元素」从 DOM 里摘出来，并算好各自要飞向哪里。
     *
     * 为什么需要这一步：折叠一个节点时，子节点是**整批消失**的。FLIP 只处理
     * 「还在、但位置变了」的节点，对消失的那批无能为力 —— 它们会在
     * `nodesEl.innerHTML = ""` 那一瞬间凭空蒸发，用户看到的是「啪一下没了」。
     *
     * 目标点取「最近的、新树里仍然可见的祖先」的中心：折叠时子节点朝父节点收，
     * 视觉上就是「被吸进去了」，正好对应折叠这个动作的语义。
     * 找不到可见祖先（整个分支被删掉）就直接丢弃，不做动画 —— 删除是另一回事。
     */
    detachVanishing(oldTree, newRoot) {
      const visible = /* @__PURE__ */ new Set();
      const walkNew = (n) => {
        if (n.id) visible.add(n.id);
        if (!n.folded) n.children.forEach(walkNew);
      };
      walkNew(newRoot);
      const out = [];
      const walkOld = (n) => {
        if (n.id && !visible.has(n.id) && n.el) {
          let p = n.parent;
          while (p && !(p.id && visible.has(p.id))) p = p.parent;
          if (!p) return;
          const el = n.el;
          n.el = void 0;
          el.remove();
          out.push({
            el,
            x: n.x,
            y: n.y,
            w: n.w,
            h: n.h,
            tx: p.x + p.w / 2,
            ty: p.y + p.h / 2
          });
          return;
        }
        n.children.forEach(walkOld);
      };
      walkOld(oldTree);
      return out;
    }
    /** 让消失的节点朝目标点聚拢并淡出，然后销毁 */
    runCollapse(items) {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      if (items.length > 120) return;
      for (const it of items) {
        const el = it.el;
        el.classList.add("mm-collapsing");
        el.style.left = `${it.x}px`;
        el.style.top = `${it.y}px`;
        el.style.transform = "translate(0,0) scale(1)";
        this.worldEl.appendChild(el);
      }
      const h = window.requestAnimationFrame(() => {
        const h2 = window.requestAnimationFrame(() => {
          for (const it of items) {
            const dx = it.tx - (it.x + it.w / 2);
            const dy = it.ty - (it.y + it.h / 2);
            it.el.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(.55)`;
            it.el.style.opacity = "0";
          }
        });
        this.collapseHandles.push(h2);
      });
      this.collapseHandles.push(h);
      window.setTimeout(() => {
        for (const it of items) it.el.remove();
      }, COLLAPSE_MS + 60);
    }
    /**
     * 恢复「上次的缩放」，并把内容摆回视口中央。
     *
     * 只恢复缩放，**不恢复平移** —— 平移跟画布尺寸强相关，
     * 换个窗口大小或者折叠几个节点之后，记住的平移量就变成了「把内容推到屏幕外」。
     */
    applyRememberedScale() {
      const want = this.prefs.scale;
      if (!want) return;
      const vw = this.viewportEl.clientWidth;
      const vh = this.viewportEl.clientHeight;
      if (vw <= 1 || vh <= 1) return;
      this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, want));
      this.tx = this.frameAxis(
        (vw - this.worldW * this.scale) / 2,
        this.worldW * this.scale,
        vw,
        LAYOUT_PAD_X * this.scale
      );
      this.ty = this.frameAxis(
        (vh - this.worldH * this.scale) / 2,
        this.worldH * this.scale,
        vh,
        LAYOUT_PAD_Y * this.scale
      );
      this.updateTransform();
    }
    /**
     * 实际使用的一级分支配色。
     *
     * 默认用主题自带色板；用户在设置里填了自定义色板就用它 —— 允许只填两三个色，
     * 超出部分循环取用（`decorate` 里就是这么做的）。
     * 非法输入直接忽略，免得把整张图渲染成一片透明。
     */
    paletteOf(theme) {
      const raw = (this.options.customPalette || "").trim();
      if (!raw) return theme.palette;
      const list = raw.split(/[,，\s]+/).map((s) => s.trim()).filter((s) => /^#?[0-9a-fA-F]{3,8}$/.test(s)).map((s) => s.startsWith("#") ? s : `#${s}`);
      return list.length >= 2 ? list : theme.palette;
    }
    /* ==================================================== 结构操作的乐观反馈（P0-2） */
    /**
     * 发起一次结构操作，并在途中给出反馈。
     *
     * 结构操作是**异步写内核**的：写回 → 内核回推 DOM → 扫描重挂视图，
     * 中间隔了 140ms 扫描防抖 + 一次内核往返，用户点完「+」之后有 300~500ms
     * 画面毫无变化。于是会出现两种典型误判：① 以为没点上，再点一次（插了两个）；
     * ② 以为插件坏了。
     *
     * 所以：发起动作的**当下**先放一个虚线占位框（或给源节点打上「处理中」标记），
     * 拿到结果再撤掉 —— 成功就悄悄撤走（真节点已经顶上来了），
     * 失败就在**原节点上**打红色描边 + 抖动，并把原因说清楚。
     * 与折叠同步用的「覆盖表」是同一个思路：**先给反馈，再等真相**。
     */
    runAction(kind, node, opts) {
      const res = this.cb.onNodeAction(kind, node, opts);
      if (!res) return;
      const token = this.showGhost(node, kind);
      void res.then((out) => {
        this.dropGhost(token);
        if (!out.ok) this.flashError(node, out.message);
      }).catch((err) => {
        console.warn("[mindmap] \u7ED3\u6784\u64CD\u4F5C\u5F02\u5E38", kind, err);
        this.dropGhost(token);
        this.flashError(node, "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
      });
    }
    /** 批量版：整体成功或整体回滚，所以只在失败时统一反馈一次 */
    runBatchAction(kind, nodes) {
      if (nodes.length === 0) return;
      if (kind === "fold" || kind === "unfold") {
        this.batchFold(kind === "fold");
        return;
      }
      if (kind === "export") {
        void this.doExport("png", nodes);
        return;
      }
      const tokens = nodes.map((n) => this.showGhost(n, kind));
      const res = this.cb.onBatchAction(kind, nodes);
      if (!res) {
        tokens.forEach((t) => this.dropGhost(t));
        return;
      }
      void res.then((out) => {
        tokens.forEach((t) => this.dropGhost(t));
        if (out.ok) {
          showMessage(BATCH_DONE_LABEL[kind] ?? "\u5DF2\u5B8C\u6210", 1800);
          return;
        }
        for (const n of nodes) this.flashNode(n, out.message);
        showMessage(out.message ?? "\u6279\u91CF\u64CD\u4F5C\u5931\u8D25\uFF0C\u5DF2\u5168\u90E8\u8FD8\u539F", 3200, "error");
      }).catch((err) => {
        console.warn("[mindmap] \u6279\u91CF\u64CD\u4F5C\u5F02\u5E38", kind, err);
        tokens.forEach((t) => this.dropGhost(t));
        showMessage("\u6279\u91CF\u64CD\u4F5C\u5931\u8D25\uFF0C\u5DF2\u5168\u90E8\u8FD8\u539F", 3200, "error");
      });
    }
    /* ================================================== 待办勾选（P0-1） */
    /**
     * 把勾选态画到某个复选框上（不传就按块 ID 找当前那一个）。
     *
     * 抽出来是因为**同一套画法要用在三处**：初次创建、点击后的乐观翻转、写失败后的回退。
     * 三处各写一遍迟早会漂移（比如某处忘了同步 `mm-done` 或 `aria-checked`）。
     */
    paintTaskCheck(n, checked, box) {
      const el = (n.id ? this.byId.get(n.id)?.el : void 0) ?? n.el;
      el?.classList.toggle("mm-done", checked);
      const b = box ?? el?.querySelector(".mm-task");
      if (!b) return;
      b.textContent = checked ? "\u2713" : "";
      b.classList.toggle("mm-task--done", checked);
      b.setAttribute("aria-checked", checked ? "true" : "false");
      b.setAttribute("aria-label", checked ? "\u6807\u8BB0\u4E3A\u672A\u5B8C\u6210" : "\u6807\u8BB0\u4E3A\u5DF2\u5B8C\u6210");
      b.dataset.mmTip = checked ? "\u70B9\u51FB\u53D6\u6D88\u52FE\u9009" : "\u70B9\u51FB\u6807\u8BB0\u4E3A\u5DF2\u5B8C\u6210";
    }
    /**
     * 点击复选框：乐观翻转 → 写内核 → 失败则退回。
     *
     * 这里没有走 `runAction`，因为**只有勾选需要「失败后把界面退回去」**：
     * 其它动作失败时内核不会回推 DOM，界面本来就没变，闪个红边就够了；
     * 而勾选是先在本地翻的，写失败时没有任何人会把那个 ✓ 抹掉 ——
     * 不退回去，用户看到的就是一个「勾上了但其实没勾上」的假象。
     */
    toggleTaskCheck(n, box) {
      if (this.editing === n) return;
      this.disarmPreview();
      const next = !n.checked;
      const revert = () => {
        n.checked = !next;
        this.paintTaskCheck(n, n.checked);
      };
      n.checked = next;
      this.paintTaskCheck(n, next, box);
      const token = this.showGhost(n, "toggleCheck");
      const res = this.cb.onNodeAction("toggleCheck", n, { checked: next });
      if (!res) {
        this.dropGhost(token);
        return;
      }
      void res.then((out) => {
        this.dropGhost(token);
        if (out.ok) return;
        revert();
        this.flashError(n, out.message);
      }).catch((err) => {
        console.warn("[mindmap] \u52FE\u9009\u5F02\u5E38", err);
        this.dropGhost(token);
        revert();
        this.flashError(n, "\u52FE\u9009\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
      });
    }
    /**
     * 放一个乐观占位。
     *
     * 分两种形态：
     *  - **新增类**（加子节点 / 插入同级 / 复制 / 粘贴）→ 在预期位置放一个虚线框，
     *    位置按「新节点会落在哪儿」估算（下一列 / 下一行），这样真节点出现时
     *    视觉上是「占位框变成了真节点」，而不是「别处冒出来一个」。
     *  - **移动 / 升降级 / 删除** → 没有新节点可占位，改为在源节点上打一个
     *    「处理中」的呼吸描边。它表达的是「这一下已经收到了，正在等内核」。
     */
    showGhost(node, kind) {
      const token = ++this.ghostSeq;
      const el = document.createElement("div");
      el.className = "mm-ghost";
      el.setAttribute("contenteditable", "false");
      el.textContent = GHOST_LABEL[kind] ?? "\u5904\u7406\u4E2D\u2026";
      const creating = kind === "insertChild" || kind === "insertSiblingBefore" || kind === "insertSiblingAfter" || kind === "duplicate" || kind === "paste";
      let inline = false;
      if (creating) {
        const p = this.ghostPlacement(node, kind);
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        this.worldEl.appendChild(el);
      } else {
        inline = true;
        node.el?.classList.add("mm-pending");
      }
      const timer = window.setTimeout(() => this.dropGhost(token), GHOST_TIMEOUT_MS);
      this.ghosts.set(token, { el, timer, node, inline });
      return token;
    }
    /** 新节点预计会落在哪 —— 只求「方向对、不打架」，不做精确布局预测 */
    ghostPlacement(node, kind) {
      const vertical2 = this.options.layout === "tree";
      const ahead = this.trunkLen + 18;
      if (kind === "insertChild") {
        return vertical2 ? { x: node.x, y: node.y + node.h + ahead } : { x: node.x + node.w + ahead, y: node.y };
      }
      if (kind === "insertSiblingBefore") return { x: node.x, y: node.y - 32 };
      return { x: node.x, y: node.y + node.h + 10 };
    }
    dropGhost(token) {
      const g = this.ghosts.get(token);
      if (!g) return;
      this.ghosts.delete(token);
      window.clearTimeout(g.timer);
      g.el.remove();
      if (g.inline) g.node.el?.classList.remove("mm-pending");
    }
    /** 在原节点上打红边 + 抖动。不弹提示（提示由调用方决定弹几次） */
    flashNode(node, message) {
      const el = (node.id ? this.byId.get(node.id)?.el : void 0) ?? node.el;
      if (!el || !el.isConnected) return;
      el.classList.add("mm-error");
      if (message) el.dataset.mmTip = message;
      window.setTimeout(() => {
        el.classList.remove("mm-error");
        if (message) delete el.dataset.mmTip;
      }, ERROR_FLASH_MS);
    }
    flashError(node, message) {
      const msg = message || "\u64CD\u4F5C\u672A\u751F\u6548\uFF0C\u8BF7\u91CD\u8BD5";
      this.flashNode(node, msg);
      showMessage(msg, 3e3, "error");
    }
    /**
     * 给新插入的节点补一圈高亮描边，让用户知道「加在哪了」。
     *
     * 存 ID 而不是元素 —— 插入之后视图会被重建，元素引用会作废。
     * 用一个统一的定时器清理：短时间内连插几个节点时，它们一起亮、一起灭。
     */
    addFresh(id) {
      if (!id) return;
      this.freshIds.add(id);
      this.byId.get(id)?.el?.classList.add("mm-fresh");
      if (this.freshTimer) window.clearTimeout(this.freshTimer);
      this.freshTimer = window.setTimeout(() => {
        this.freshTimer = 0;
        for (const fid of this.freshIds) this.byId.get(fid)?.el?.classList.remove("mm-fresh");
        this.freshIds.clear();
      }, NEW_NODE_HIGHLIGHT_MS);
    }
    /** 每次重渲染后把高亮补到新元素上（DOM 重建会丢掉类名） */
    markFresh() {
      for (const id of this.freshIds) this.byId.get(id)?.el?.classList.add("mm-fresh");
    }
    /* ====================================================== 批量操作条（P0-1） */
    /** 选中的节点，按**文档顺序**排列。批量操作对顺序敏感，必须有个确定的次序 */
    selectedInDocOrder() {
      const root = this.tree;
      if (!root) return [];
      const set = new Set(this.selNodes);
      if (set.size === 0) return [];
      const out = [];
      const walk = (n) => {
        if (set.has(n)) out.push(n);
        n.children.forEach(walk);
      };
      walk(root);
      return out;
    }
    refreshBatchBar() {
      const n = this.selNodes.length;
      if (n < BATCH_MIN_SELECTED) {
        this.hideBatchBar();
        return;
      }
      if (!this.batchEl) this.buildBatchBar();
      if (this.batchCountEl) this.batchCountEl.textContent = `\u5DF2\u9009 ${n} \u4E2A`;
      const hasTask = this.selectedInDocOrder().some((x) => x.kind === "task");
      for (const el of this.batchCheckEls) el.style.display = hasTask ? "" : "none";
    }
    /**
     * 批量操作条：多选之后浮在工具条下方。
     *
     * 为什么是「条」而不是弹窗 —— 弹窗会盖住画布，而用户此刻正需要看着画布
     * 确认自己框对了哪些节点。
     */
    buildBatchBar() {
      const bar = document.createElement("div");
      bar.className = "mm-batch";
      bar.setAttribute("contenteditable", "false");
      const count = document.createElement("span");
      count.className = "mm-batch-count";
      this.batchCountEl = count;
      const sep = () => {
        const d = document.createElement("span");
        d.className = "mm-batch-sep";
        return d;
      };
      const btn = (label, tip, extra, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `mm-batch-btn${extra}`;
        b.textContent = label;
        b.dataset.mmTip = tip;
        b.onclick = (e) => {
          e.stopPropagation();
          fn();
        };
        return b;
      };
      const close = document.createElement("button");
      close.type = "button";
      close.className = "mm-batch-x";
      close.textContent = "\u2715";
      close.dataset.mmTip = "\u53D6\u6D88\u9009\u62E9";
      close.onclick = (e) => {
        e.stopPropagation();
        this.clearSelection();
      };
      bar.append(
        count,
        sep(),
        btn("\u5347\u7EA7", "\u628A\u9009\u4E2D\u7684\u8282\u70B9\u6574\u4F53\u5347\u7EA7\u4E00\u7EA7", "", () => this.runBatchAction("outdent", this.selectedInDocOrder())),
        btn(
          "\u964D\u7EA7",
          "\u628A\u9009\u4E2D\u7684\u8282\u70B9\u6574\u4F53\u964D\u7EA7\u4E3A\u300C\u4E0A\u4E00\u4E2A\u8282\u70B9\u300D\u7684\u5B50\u8282\u70B9",
          "",
          () => this.runBatchAction("indent", this.selectedInDocOrder())
        ),
        btn("\u6298\u53E0", "\u6298\u53E0\u9009\u4E2D\u7684\u8282\u70B9", "", () => this.batchFold(true)),
        btn("\u5C55\u5F00", "\u5C55\u5F00\u9009\u4E2D\u7684\u8282\u70B9", "", () => this.batchFold(false)),
        sep()
      );
      const checkDone = btn(
        "\u5B8C\u6210",
        "\u628A\u9009\u4E2D\u7684\u5F85\u529E\u6807\u8BB0\u4E3A\u5DF2\u5B8C\u6210",
        "",
        () => this.runBatchAction("check", this.selectedInDocOrder())
      );
      const checkUndo = btn(
        "\u53D6\u6D88",
        "\u628A\u9009\u4E2D\u7684\u5F85\u529E\u6807\u8BB0\u4E3A\u672A\u5B8C\u6210",
        "",
        () => this.runBatchAction("uncheck", this.selectedInDocOrder())
      );
      this.batchCheckEls = [checkDone, checkUndo];
      bar.append(checkDone, checkUndo, sep());
      bar.append(
        btn("\u5BFC\u51FA\u8FD9\u4E9B", "\u53EA\u5BFC\u51FA\u9009\u4E2D\u7684\u5B50\u6811", "", () => this.runBatchAction("export", this.selectedInDocOrder())),
        btn(
          "\u5220\u9664",
          "\u5220\u9664\u9009\u4E2D\u7684\u8282\u70B9\u53CA\u5176\u5B50\u6811\uFF08Ctrl+Z \u53EF\u64A4\u9500\uFF09",
          " mm-batch-btn--danger",
          () => this.runBatchAction("delete", this.selectedInDocOrder())
        ),
        close
      );
      this.batchEl = bar;
      this.viewportEl.appendChild(bar);
    }
    hideBatchBar() {
      this.batchEl?.remove();
      this.batchEl = null;
      this.batchCountEl = null;
      this.batchCheckEls = [];
    }
    /** 批量折叠：直接改大纲的原生 fold（与单击折叠走同一条写回链路） */
    batchFold(folded) {
      const nodes = this.selectedInDocOrder().filter((n) => n.children.length > 0);
      if (nodes.length === 0) {
        showMessage("\u9009\u4E2D\u7684\u8282\u70B9\u90FD\u6CA1\u6709\u5B50\u8282\u70B9", 2200);
        return;
      }
      for (const n of nodes) {
        n.folded = folded;
        if (n.id) this.cb.onFoldChange(n.id, folded);
      }
      this.render();
      this.reclampView();
      showMessage(BATCH_DONE_LABEL[folded ? "fold" : "unfold"] ?? "\u5DF2\u5B8C\u6210", 1600);
    }
    /* ========================================================= 悬停预览（P1-1） */
    /** 悬停折叠节点一小会儿之后浮出预览卡片（列出前几个子节点） */
    armPreview(n, anchor) {
      if (!this.options.hoverPreview) return;
      if (!n.folded || n.children.length === 0) return;
      this.disarmPreview();
      this.previewTimer = window.setTimeout(() => {
        this.previewTimer = 0;
        if (this.destroyed || !anchor.isConnected) return;
        this.showPreview(n, anchor);
      }, PREVIEW_DELAY);
    }
    disarmPreview() {
      if (this.previewTimer) {
        window.clearTimeout(this.previewTimer);
        this.previewTimer = 0;
      }
      this.hidePreview();
    }
    /**
     * 折叠之后用户其实想知道「里面是什么」，但现在只有珠子上的一个数字。
     * 卡片就补这个信息 —— 只列前 5 个，多了反而看不清。
     */
    showPreview(n, anchor) {
      const el = document.createElement("div");
      el.className = "mm-preview";
      el.setAttribute("contenteditable", "false");
      const head = document.createElement("div");
      head.className = "mm-preview-head";
      head.textContent = `\u6298\u53E0\u4E86 ${n.children.length} \u4E2A\u5B50\u8282\u70B9`;
      el.appendChild(head);
      const list = document.createElement("div");
      list.className = "mm-preview-list";
      for (const kid of n.children.slice(0, 5)) {
        const row = document.createElement("div");
        row.className = "mm-preview-row";
        const dot = document.createElement("span");
        dot.className = "mm-preview-dot";
        dot.style.background = kid.color ?? this.palette0;
        const txt = document.createElement("span");
        txt.className = "mm-preview-txt";
        txt.textContent = kid.text || "\uFF08\u7A7A\uFF09";
        row.append(dot, txt);
        list.appendChild(row);
      }
      if (n.children.length > 5) {
        const more = document.createElement("div");
        more.className = "mm-preview-more";
        more.textContent = `\u8FD8\u6709 ${n.children.length - 5} \u4E2A\u2026`;
        list.appendChild(more);
      }
      el.appendChild(list);
      document.body.appendChild(el);
      this.previewEl = el;
      this.previewTarget = anchor;
      const r2 = anchor.getBoundingClientRect();
      const pr = el.getBoundingClientRect();
      let left = r2.right + 10;
      let top = r2.top + r2.height / 2 - pr.height / 2;
      if (left + pr.width > window.innerWidth - 6) left = r2.left - pr.width - 10;
      left = Math.min(Math.max(left, 6), Math.max(6, window.innerWidth - pr.width - 6));
      top = Math.min(Math.max(top, 6), Math.max(6, window.innerHeight - pr.height - 6));
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
      el.classList.add("mm-preview--on");
    }
    hidePreview() {
      this.previewTarget = null;
      this.previewEl?.remove();
      this.previewEl = null;
    }
    /** 拖拽悬停自动展开的环形进度：没有它用户不知道「停一下会展开」 */
    markHoverExpand(target) {
      this.rootEl.querySelectorAll(".mm-toggle--loading").forEach((el) => el.classList.remove("mm-toggle--loading"));
      if (!target) return;
      target.toggle?.classList.add("mm-toggle--loading");
      target.toggle?.style.setProperty("--mm-hover-delay", `${HOVER_EXPAND_DELAY}ms`);
    }
    /* ========================================================= 演示模式（P2-3） */
    /**
     * 演示模式：把导图当成一页一页讲的讲稿。
     *
     * 进入时整张图**折到只剩根**，然后随着方向键推进逐层展开 ——
     * 观众跟着讲述的节奏看到结构一层层长出来，而不是一上来就被一张
     * 几十个节点的图糊住。
     *
     * ⚠️ 折叠状态只写进 `presentFold`（内存里的临时透镜），**不写回大纲**。
     * 演示是「换个视角看」，不是「改内容」；退出即清空，看到的又是大纲的原状。
     */
    togglePresent(on) {
      const next = on ?? !this.presenting;
      if (next === this.presenting) return;
      if (next && !this.tree) return;
      this.presenting = next;
      if (next && this.activeMenu) {
        this.activeMenu.close();
        this.activeMenu = null;
      }
      if (!next) {
        this.presentFold.clear();
        this.rootEl.classList.remove("mm-present");
        this.hidePresentBar();
        this.render(true);
        return;
      }
      const root = this.tree;
      this.presentOrder = [];
      const collect = (n) => {
        if (n.id) this.presentOrder.push(n.id);
        n.children.forEach(collect);
      };
      collect(root);
      this.presentFold.clear();
      for (const n of flatten(root)) {
        if (n !== root && n.children.length > 0 && n.id) this.presentFold.set(n.id, true);
      }
      this.rootEl.classList.add("mm-present");
      this.presentIdx = 0;
      this.render(true);
      this.presentGo(0);
      this.rootEl.focus({ preventScroll: true });
    }
    /** 推进到第 idx 个节点：展开它的祖先链、选中并滚进视野 */
    presentGo(idx) {
      if (!this.presenting) return;
      const total = this.presentOrder.length;
      if (total === 0) return;
      this.presentIdx = Math.min(Math.max(idx, 0), total - 1);
      const id = this.presentOrder[this.presentIdx];
      const first = this.byId.get(id);
      if (!first) return;
      let changed = false;
      let cur = first.parent;
      while (cur) {
        if (cur.id && this.presentFold.get(cur.id) === true) {
          this.presentFold.set(cur.id, false);
          changed = true;
        }
        cur = cur.parent;
      }
      if (changed) this.render();
      const n = this.byId.get(id);
      if (!n) return;
      this.selected = n;
      this.extraSel.clear();
      this.rootEl.classList.add("mm-kbd");
      this.refreshSelection();
      this.ensureVisible(n);
      this.refreshPresentBar();
    }
    refreshPresentBar() {
      if (!this.presenting) {
        this.hidePresentBar();
        return;
      }
      if (!this.presentBarEl) {
        const bar = document.createElement("div");
        bar.className = "mm-present-bar";
        bar.setAttribute("contenteditable", "false");
        const prev = document.createElement("button");
        prev.type = "button";
        prev.textContent = "\u2039";
        prev.dataset.mmTip = "\u4E0A\u4E00\u4E2A\uFF08\u2190\uFF09";
        prev.onclick = (e) => {
          e.stopPropagation();
          this.presentGo(this.presentIdx - 1);
        };
        const next = document.createElement("button");
        next.type = "button";
        next.textContent = "\u203A";
        next.dataset.mmTip = "\u4E0B\u4E00\u4E2A\uFF08\u2192 / \u7A7A\u683C\uFF09";
        next.onclick = (e) => {
          e.stopPropagation();
          this.presentGo(this.presentIdx + 1);
        };
        const out = document.createElement("button");
        out.type = "button";
        out.className = "mm-present-exit";
        out.textContent = "\u9000\u51FA\u6F14\u793A";
        out.dataset.mmTip = "\u9000\u51FA\uFF08Esc\uFF09";
        out.onclick = (e) => {
          e.stopPropagation();
          this.togglePresent(false);
        };
        const progress = document.createElement("span");
        progress.className = "mm-present-count";
        bar.append(prev, progress, next, out);
        this.presentBarEl = bar;
        this.viewportEl.appendChild(bar);
        this.presentCountEl = progress;
      }
      if (this.presentCountEl) {
        this.presentCountEl.textContent = `${this.presentIdx + 1} / ${this.presentOrder.length}`;
      }
    }
    hidePresentBar() {
      this.presentBarEl?.remove();
      this.presentBarEl = null;
      this.presentCountEl = null;
    }
    /* ==================================================== 大纲 ↔ 导图 双向高亮（P2-1） */
    /**
     * 光标在大纲里移动时，导图对应节点跟着亮。
     *
     * 用 `selectionchange` 而不是 click / keyup —— 方向键移动光标、拖选、
     * 点击定位都会改选区，只有 selectionchange 能全覆盖。
     * rAF 节流：这个事件在拖选时每帧都发。
     */
    bindOutlineCursor() {
      let raf = 0;
      const sync = () => {
        raf = 0;
        if (this.destroyed) return;
        const sel = window.getSelection();
        const node = sel?.anchorNode ?? null;
        const el = node ? node.nodeType === 1 ? node : node.parentElement : null;
        if (!el || !this.listEl.contains(el)) {
          this.setCursorBlock("");
          return;
        }
        this.setCursorBlock(el.closest(".li")?.dataset.nodeId ?? "");
      };
      const onChange = () => {
        if (!raf) raf = window.requestAnimationFrame(sync);
      };
      document.addEventListener("selectionchange", onChange);
      this.disposers.push(() => {
        document.removeEventListener("selectionchange", onChange);
        if (raf) cancelAnimationFrame(raf);
      });
    }
    /** 大纲里光标所在块变了 —— 在导图上标出来 */
    setCursorBlock(id) {
      if (this.cursorId === id) return;
      this.cursorId = id;
      const root = this.tree;
      if (!root) return;
      const walk = (n) => {
        n.el?.classList.toggle("mm-cursor", !!id && n.id === id);
        n.kids.forEach(walk);
      };
      walk(root);
    }
    clearOutlineCursor() {
      this.cursorId = "";
      this.listEl.querySelectorAll(".mm-outline-hit").forEach((el) => el.classList.remove("mm-outline-hit"));
    }
    /** 反过来：导图上选中了哪个节点，就在大纲里把对应的列表项标出来 */
    markOutlineCursor() {
      this.listEl.querySelectorAll(".mm-outline-hit").forEach((el) => el.classList.remove("mm-outline-hit"));
      const id = this.selected?.id;
      if (!id) return;
      this.listEl.querySelector(`.li[data-node-id="${id}"]`)?.classList.add("mm-outline-hit");
    }
    /* ======================================================= 导出增强（P2-2） */
    /** 选中子树（含其可见后代）的包围盒，用作「只导选中」的裁剪框 */
    selectionBounds(nodes) {
      if (nodes.length === 0) return null;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const walk = (n) => {
        if (!n.el) return;
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + n.w);
        y1 = Math.max(y1, n.y + n.h);
        n.kids.forEach(walk);
      };
      nodes.forEach(walk);
      if (!Number.isFinite(x0)) return null;
      const pad = 36;
      return { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    }
    /** 选中子树里所有节点的块 ID（导出时用来隐藏「不相关」的节点与连线） */
    selectionIds(nodes) {
      const keep = /* @__PURE__ */ new Set();
      const walk = (n) => {
        if (n.id) keep.add(n.id);
        n.children.forEach(walk);
      };
      nodes.forEach(walk);
      return keep;
    }
    /** 导出 Markdown 大纲（把当前树按缩进还原成可粘贴的 markdown） */
    outlineMarkdown() {
      const root = this.tree;
      if (!root) return "";
      const lines = [];
      const walk = (n, depth) => {
        const marker = n.kind === "task" ? `- [${n.checked ? "x" : " "}]` : n.kind === "ordered" ? "1." : "-";
        lines.push(`${"    ".repeat(depth)}${marker} ${n.text}`);
        n.children.forEach((c) => walk(c, depth + 1));
      };
      if (root.id) walk(root, 0);
      else root.children.forEach((c) => walk(c, 0));
      return lines.join("\n");
    }
    async copyImage() {
      const restore = this.prepareExport();
      try {
        const blob = await renderPngBlob(this.rootEl);
        if (!blob) throw new Error("PNG \u7F16\u7801\u5931\u8D25");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        showMessage("\u5DF2\u590D\u5236\u56FE\u7247\u5230\u526A\u8D34\u677F", 2e3);
      } catch (err) {
        console.warn("[mindmap] \u590D\u5236\u56FE\u7247\u5931\u8D25", err);
        showMessage("\u590D\u5236\u56FE\u7247\u5931\u8D25\uFF0C\u6D4F\u89C8\u5668\u53EF\u80FD\u4E0D\u652F\u6301", 3200, "error");
      } finally {
        restore();
      }
    }
    /* ==================================================================== 下钻与渐进展开 */
    /**
     * 把 drillPath 沿新解析出来的树重走一遍，返回当前该当根的那个节点。
     *
     * 中途某一环没了（被删掉 / 被拖走）就截断到最长的有效前缀 ——
     * 直接整段作废会让用户「莫名其妙回到了全图」，而卡住不返回又会一直显示空白。
     */
    applyDrill(fallback) {
      if (this.drillPath.length === 0) return fallback;
      let cur = fallback;
      const kept = [];
      for (const id of this.drillPath) {
        const next = cur.children.find((c) => c.id === id);
        if (!next) break;
        cur = next;
        kept.push(id);
      }
      if (kept.length !== this.drillPath.length) this.drillPath = kept;
      return kept.length > 0 ? cur : fallback;
    }
    /**
     * 下钻：只看这一个分支。
     *
     * 交互放在 Ctrl/⌘ + 双击、悬停操作条上的 ⊙、以及右键菜单里 ——
     * 裸双击留给改名（那是更高频的操作，也符合思源/大多数编辑器的习惯）。
     */
    drillDown(n) {
      if (!n.id || n.children.length === 0) return;
      const add = [];
      let cur = n;
      while (cur && cur !== this.tree) {
        if (cur.id) add.unshift(cur.id);
        cur = cur.parent;
      }
      this.drillPath = this.drillPath.concat(add);
      this.selected = null;
      this.extraSel.clear();
      this.clipboard = "";
      this.render(true);
    }
    /** 回到第 depth 层（0 = 最外层全图） */
    drillTo(depth) {
      const next = this.drillPath.slice(0, Math.max(0, depth));
      if (next.length === this.drillPath.length) return;
      this.drillPath = next;
      this.selected = null;
      this.extraSel.clear();
      this.render(true);
    }
    drillUp() {
      if (this.drillPath.length === 0) return;
      this.drillPath.pop();
      this.selected = null;
      this.extraSel.clear();
      this.render(true);
    }
    /* ================================================================ 面包屑 */
    /** 从当前根往上收集各级标题，长度 = drillPath.length + 1 */
    crumbLabels() {
      const labels = [];
      let cur = this.tree;
      while (cur) {
        labels.unshift(cur.text?.trim() || "\uFF08\u7A7A\uFF09");
        cur = cur.parent;
      }
      return labels;
    }
    refreshBreadcrumb() {
      const on = this.drillPath.length > 0;
      this.crumbEl.classList.toggle("mm-crumb--on", on);
      if (!on) {
        this.crumbEl.textContent = "";
        return;
      }
      const labels = this.crumbLabels();
      this.crumbEl.textContent = "";
      labels.forEach((label, i) => {
        if (i > 0) {
          const sep = document.createElement("span");
          sep.className = "mm-crumb-sep";
          sep.textContent = "\u203A";
          this.crumbEl.appendChild(sep);
        }
        const b = document.createElement("button");
        b.type = "button";
        const last = i === labels.length - 1;
        b.className = `mm-crumb-item${last ? " mm-crumb-cur" : ""}`;
        b.textContent = label;
        b.dataset.mmTip = last ? "\u5F53\u524D\u805A\u7126\u7684\u5206\u652F" : "\u56DE\u5230\u8FD9\u4E00\u5C42";
        b.disabled = last;
        b.onclick = (e) => {
          e.stopPropagation();
          this.drillTo(i);
        };
        this.crumbEl.appendChild(b);
      });
      const out = document.createElement("button");
      out.type = "button";
      out.className = "mm-crumb-out";
      out.textContent = "\u9000\u51FA\u805A\u7126";
      out.dataset.mmTip = "\u56DE\u5230\u5168\u56FE\uFF08Esc\uFF09";
      out.onclick = (e) => {
        e.stopPropagation();
        this.drillTo(0);
      };
      this.crumbEl.appendChild(out);
    }
    /** 定位到某个节点并直接进入编辑态（插入新节点后用，见 Scanner 的 pendingEdit） */
    revealAndEdit(id) {
      if (this.destroyed) return false;
      const n = this.byId.get(id);
      if (!n) return false;
      this.rootEl.classList.add("mm-kbd");
      this.select(n);
      this.ensureVisible(n);
      this.addFresh(id);
      this.beginEdit(n, n.text === NEW_NODE_TEXT);
      return true;
    }
    /** 记录当前每个节点的位置，用于 FLIP */
    snapshot() {
      const out = /* @__PURE__ */ new Map();
      const root = this.tree;
      if (!root) return out;
      const walk = (n) => {
        if (n.id) out.set(n.id, { x: n.x, y: n.y, w: n.w, h: n.h });
        n.kids.forEach(walk);
      };
      walk(root);
      return out;
    }
    /**
     * FLIP：节点从旧位置滑到新位置，连线同步重绘。
     *
     * 位移完全由 JS 驱动（用 transform 而不是 left/top 过渡），
     * 这样节点与连线的进度可以严格对齐 —— 用 CSS 过渡的话连线会跟不上。
     */
    runFlip(prev) {
      const root = this.tree;
      if (!root || prev.size === 0) return;
      if (this.nodeCount > 300) return;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const moving = [];
      const entering = [];
      const walk = (n) => {
        const old = n.id ? prev.get(n.id) : void 0;
        if (old && n.el) {
          const dx = old.x - n.x;
          const dy = old.y - n.y;
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moving.push({ n, dx, dy });
        } else if (n.el) {
          entering.push(n);
        }
        n.kids.forEach(walk);
      };
      walk(root);
      if (moving.length === 0 && entering.length === 0) return;
      for (const n of entering) n.el?.classList.add("mm-enter");
      this.rootEl.classList.add("mm-flip");
      const release = () => {
        this.rootEl.classList.remove("mm-flip");
        for (const n of entering) n.el?.classList.remove("mm-enter");
      };
      if (moving.length === 0) {
        window.requestAnimationFrame(() => window.requestAnimationFrame(release));
        return;
      }
      const rectOf = (n, k) => {
        const old = n.id ? prev.get(n.id) : void 0;
        if (!old) return { x: n.x, y: n.y, w: n.w, h: n.h, dir: n.dir };
        return {
          x: old.x + (n.x - old.x) * k,
          y: old.y + (n.y - old.y) * k,
          w: old.w + (n.w - old.w) * k,
          h: old.h + (n.h - old.h) * k,
          dir: n.dir
        };
      };
      const t0 = performance.now();
      const step = (now) => {
        if (this.destroyed) return;
        const t = Math.min(1, (now - t0) / FLIP_DURATION);
        const k = easeOut(t);
        for (const m of moving) {
          if (!m.n.el) continue;
          const ox = m.dx * (1 - k);
          const oy = m.dy * (1 - k);
          m.n.el.style.transform = `translate(${ox.toFixed(2)}px,${oy.toFixed(2)}px)`;
        }
        this.drawEdges((n) => rectOf(n, k));
        if (t < 1) {
          this.flipHandle = requestAnimationFrame(step);
        } else {
          for (const m of moving) {
            if (m.n.el) m.n.el.style.transform = "";
          }
          this.flipHandle = 0;
          this.drawEdges();
          release();
          this.refreshMinimap();
        }
      };
      this.flipHandle = requestAnimationFrame(step);
    }
    /** 按内容高度调整可视区，返回是否发生了变化 */
    resizeViewport(contentH) {
      const avail = this.availHeight();
      const h = Math.min(Math.max(contentH, 260), avail);
      const prev = parseFloat(this.viewportEl.style.height || "0");
      if (Math.abs(prev - h) < 1) return false;
      this.viewportEl.style.height = `${Math.round(h)}px`;
      return true;
    }
    /* ==================================================================== 连线 */
    drawEdges(getRect) {
      const root = this.tree;
      if (!root) return;
      const rect = getRect ?? ((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h, dir: n.dir }));
      const items = [];
      const walk = (n) => {
        if (n.kids.length > 0) {
          const base = Math.max(1.2, 2.8 - n.depth * 0.42);
          const kidDash = n.kids.map((k) => k.kind === "task" && k.checked ? DONE_DASH : void 0);
          const cons = buildConnectors({
            parent: rect(n),
            kids: n.kids.map((k) => rect(k)),
            mode: this.options.layout,
            style: this.options.edge,
            gap: this.gapX,
            base,
            kidDash
          });
          const own = this.edgeColor(n);
          for (const c of cons) {
            const kid = c.childIndex === null ? null : n.kids[c.childIndex];
            items.push({ c, stroke: kid ? this.edgeColor(kid, true) : own, parent: n.id ?? "" });
          }
        }
        n.kids.forEach(walk);
      };
      walk(root);
      const signature = items.map((i) => `${i.c.kind}:${i.c.width}:${i.c.dash ?? ""}`).join("|");
      if (signature === this.edgeSignature && this.edgePaths.length === items.length) {
        for (let i = 0; i < items.length; i++) {
          this.edgePaths[i].setAttribute("d", items[i].c.d);
        }
        return;
      }
      const parts = [];
      for (const { c, stroke, parent } of items) {
        const dash = c.dash ? ` stroke-dasharray="${c.dash}"` : "";
        parts.push(
          `<path d="${c.d}" fill="none" stroke="${stroke}" stroke-width="${c.width}"${dash} stroke-linecap="round" stroke-linejoin="round" data-mm-parent="${parent}"/>`
        );
      }
      this.edgesEl.innerHTML = parts.join("");
      this.edgeSignature = signature;
      this.edgePaths = Array.from(this.edgesEl.querySelectorAll("path"));
    }
    /** 连线的颜色：分支色与画布底色混成实色，避免主干与支线重叠处叠深 */
    edgeColor(n, isStub = false) {
      const base = n.color ?? this.palette0;
      const alpha = Math.max(0.46, 0.9 - Math.min(n.depth, 5) * 0.09);
      return mixHex(base, this.canvasRgb, isStub ? alpha : alpha * 0.92);
    }
    applyNodeColors(el, n, theme) {
      const s = el.style;
      if (n.color) {
        s.setProperty("--c-solid", n.color);
        s.setProperty("--c-bg", hexA(n.color, theme.tint));
        s.setProperty("--c-soft", hexA(n.color, 0.2));
        s.setProperty("--c-border", hexA(n.color, 0.55));
      } else {
        s.setProperty("--c-solid", theme.palette[0]);
        s.setProperty("--c-bg", "transparent");
        s.setProperty("--c-soft", "rgba(255,255,255,.24)");
        s.setProperty("--c-border", "transparent");
      }
    }
    /* ==================================================================== 节点 */
    createNodeEl(n, theme) {
      const el = document.createElement("div");
      const depth = Math.min(n.depth, 4);
      el.className = `mm-node mm-d${depth}`;
      if (n.kind === "task" && n.checked) el.classList.add("mm-done");
      el.dataset.mmId = n.id;
      if (this.cursorId && this.cursorId === n.id) el.classList.add("mm-cursor");
      this.applyNodeColors(el, n, theme);
      const inner = document.createElement("div");
      inner.className = "mm-inner";
      if (this.options.showOrder && n.numbered && n.depth > 0) {
        const badge = document.createElement("span");
        badge.className = "mm-badge";
        badge.textContent = n.order;
        inner.appendChild(badge);
      }
      if (n.kind === "task") {
        const box = document.createElement("button");
        box.type = "button";
        box.className = `mm-task${n.checked ? " mm-task--done" : ""}`;
        box.setAttribute("role", "checkbox");
        this.paintTaskCheck(n, !!n.checked, box);
        box.onclick = (e) => {
          e.stopPropagation();
          this.toggleTaskCheck(n, box);
        };
        inner.appendChild(box);
      }
      const txt = document.createElement("span");
      txt.className = "mm-txt";
      txt.innerHTML = n.html;
      if (n.mark?.icon) {
        const ic = document.createElement("span");
        ic.className = "mm-mark-icon";
        ic.textContent = n.mark.icon;
        inner.appendChild(ic);
      }
      inner.appendChild(txt);
      if (n.mark?.label) {
        const lb = document.createElement("span");
        lb.className = "mm-mark-label";
        lb.textContent = n.mark.label;
        inner.appendChild(lb);
      }
      el.appendChild(inner);
      if (n.children.length > 0) {
        const tog = document.createElement("div");
        tog.className = `mm-toggle${n.folded ? " mm-toggle--collapsed" : ""}`;
        tog.textContent = n.folded ? String(n.children.length) : "\u2212";
        tog.dataset.mmTip = n.folded ? `\u5C55\u5F00 ${n.children.length} \u4E2A\u5B50\u8282\u70B9` : "\u6298\u53E0\u5B50\u8282\u70B9";
        tog.dataset.mmKey = "\u7A7A\u683C";
        tog.onclick = (e) => {
          e.stopPropagation();
          this.disarmPreview();
          this.toggleFold(n);
        };
        tog.onmouseenter = () => this.armPreview(n, tog);
        tog.onmouseleave = () => this.disarmPreview();
        el.appendChild(tog);
        n.toggle = tog;
      } else {
        n.toggle = void 0;
      }
      if (n.id) {
        const acts = document.createElement("div");
        acts.className = "mm-acts";
        const add = document.createElement("button");
        add.type = "button";
        add.textContent = "+";
        add.dataset.mmTip = "\u63D2\u5165\u5B50\u8282\u70B9";
        add.dataset.mmKey = "Tab";
        add.onclick = (e) => {
          e.stopPropagation();
          void this.runAction("insertChild", n);
        };
        acts.appendChild(add);
        if (n.children.length > 0) {
          const drill = document.createElement("button");
          drill.type = "button";
          drill.textContent = "\u2299";
          drill.dataset.mmTip = "\u805A\u7126\u6B64\u5206\u652F";
          drill.dataset.mmKey = "Ctrl \u53CC\u51FB";
          drill.onclick = (e) => {
            e.stopPropagation();
            this.drillDown(n);
          };
          acts.appendChild(drill);
        }
        if (n.children.length > 0) {
          const fold = document.createElement("button");
          fold.type = "button";
          fold.textContent = n.folded ? "\u25B8" : "\u25BE";
          fold.dataset.mmTip = n.folded ? "\u5C55\u5F00" : "\u6298\u53E0";
          fold.onclick = (e) => {
            e.stopPropagation();
            this.toggleFold(n);
          };
          acts.appendChild(fold);
        }
        el.appendChild(acts);
        n.acts = acts;
      } else {
        n.acts = void 0;
      }
      el.onclick = (e) => {
        e.stopPropagation();
        if (this.suppressClick) return;
        const t = e.target;
        if (el.hasAttribute(EDIT_FLAG)) return;
        const img = t?.closest?.("img");
        if (img) {
          this.zoomImage(img);
          return;
        }
        const link = t?.closest?.('[data-type="a"], [data-type="block-ref"]');
        if (link && (e.ctrlKey || e.metaKey || e.altKey)) {
          this.openInlineTarget(link);
          return;
        }
        this.rootEl.focus({ preventScroll: true });
        if (e.shiftKey || e.ctrlKey || e.metaKey) this.toggleMulti(n);
        else this.select(n);
      };
      el.ondblclick = (e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && n.children.length > 0) {
          this.drillDown(n);
          return;
        }
        if (this.options.editable && canEdit(n)) this.beginEdit(n);
        else if (n.id) this.cb.onLocate(n.id);
      };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.extraSel.has(n) && this.selected !== n) this.select(n);
        this.openNodeMenu(n, e);
      };
      el.onmousedown = (e) => {
        if (e.button !== 0) return;
        if (el.hasAttribute(EDIT_FLAG)) {
          const t = e.target;
          if (!t?.closest?.(".mm-txt")) e.preventDefault();
          return;
        }
        e.preventDefault();
        if (!this.options.draggable || !n.id) return;
        this.armDrag(n, e);
      };
      let pressTimer = 0;
      const cancelPress = () => {
        if (pressTimer) {
          window.clearTimeout(pressTimer);
          pressTimer = 0;
        }
      };
      el.addEventListener(
        "touchstart",
        (e) => {
          cancelPress();
          if (e.touches.length !== 1) return;
          const t = e.touches[0];
          pressTimer = window.setTimeout(() => {
            pressTimer = 0;
            this.select(n);
            this.openNodeMenu(n, { clientX: t.clientX, clientY: t.clientY });
          }, LONG_PRESS_MS);
        },
        { passive: true }
      );
      el.addEventListener("touchmove", cancelPress, { passive: true });
      el.addEventListener("touchend", cancelPress, { passive: true });
      el.addEventListener("touchcancel", cancelPress, { passive: true });
      return el;
    }
    /** 折叠按钮落在主干中间，像线上的一个珠子 */
    placeToggle(n) {
      const t = n.toggle;
      if (!t) return;
      const size = 15;
      const layoutMode = this.options.layout;
      if (layoutMode === "tree") {
        t.style.left = `${n.w / 2 - size / 2}px`;
        t.style.top = `${n.h + Math.max(4, this.trunkLen / 2 - size / 2)}px`;
        return;
      }
      const left = n.dir === -1 && layoutMode === "mind";
      const offset = Math.max(3, this.trunkLen / 2 - size / 2);
      t.style.left = left ? `${-(size + offset)}px` : `${n.w + offset}px`;
      t.style.top = `${n.h / 2 - size / 2}px`;
    }
    /* ==================================================================== 选中 */
    select(n) {
      this.selected = n;
      this.extraSel.clear();
      this.rootEl.classList.remove("mm-kbd");
      this.refreshSelection();
    }
    toggleMulti(n) {
      if (this.selected === n) {
        this.selected = this.extraSel.size ? this.extraSel.values().next().value : null;
        this.extraSel.delete(n);
      } else if (this.extraSel.has(n)) {
        this.extraSel.delete(n);
      } else {
        if (!this.selected) this.selected = n;
        else this.extraSel.add(n);
      }
      this.refreshSelection();
    }
    /** 全选：第一次同级，第二次整棵树 */
    selectAllSiblings() {
      const n = this.selected;
      if (!n?.parent) return;
      const sibs = shownChildren(n.parent);
      const allSelected = sibs.every((s) => s === this.selected || this.extraSel.has(s));
      if (allSelected) {
        this.selected = this.tree;
        this.extraSel.clear();
        const walk = (x) => {
          if (x !== this.tree) this.extraSel.add(x);
          x.kids.forEach(walk);
        };
        if (this.tree) this.tree.kids.forEach(walk);
      } else {
        this.selected = sibs[0];
        this.extraSel = new Set(sibs.slice(1));
      }
      this.refreshSelection();
    }
    clearSelection() {
      this.selected = null;
      this.extraSel.clear();
      this.refreshSelection();
    }
    /**
     * 把「选中的节点」重新绑到这一轮新树的节点对象上。
     *
     * 为什么非做不可：`render()` 每次都从 DOM 重新解析、**整棵重建** MMNode，
     * 而 `selected` / `extraSel` 里握着的是上一轮的旧对象。旧对象带着正确的
     * `.id`，但跟新树里的任何节点都不是同一个引用 —— 于是所有「按对象找节点」
     * 的地方全部落空：
     *
     *   - `refreshSelection()` 走新树打 `mm-sel` / `mm-multi`，一个都匹配不上
     *     → 选中高亮在做完任何结构操作后凭空消失；
     *   - `selectedInDocOrder()` 遍历新树收集选中项，`set.has(n)` 恒为假
     *     → 返回空数组。批量操作里最先暴露的就是折叠：点一次「折叠」之后
     *     再点「展开」，`batchFold(false)` 拿到空数组、弹一句「选中的节点
     *     都没有子节点」就返回，大纲里的 `fold="1"` 一个都没清掉。
     *
     * 按块 ID 重绑即可 —— ID 是内核给的、跨渲染稳定的唯一标识。
     * 找不到（节点被删了、被移出这个列表了）就把它从选中里摘掉：
     * 留着一个不在树上的幽灵选中项，比清掉更让人困惑。
     */
    remapSelection() {
      const remap = (n) => n && n.id ? this.byId.get(n.id) ?? null : null;
      this.selected = remap(this.selected);
      const next = /* @__PURE__ */ new Set();
      for (const n of this.extraSel) {
        const m = remap(n);
        if (m && m !== this.selected) next.add(m);
      }
      this.extraSel = next;
    }
    refreshSelection() {
      const root = this.tree;
      if (!root) {
        this.hideBatchBar();
        return;
      }
      const related = /* @__PURE__ */ new Set();
      const addSubtree = (n) => {
        related.add(n);
        n.kids.forEach(addSubtree);
      };
      for (const n of this.extraSel) addSubtree(n);
      if (this.selected) {
        addSubtree(this.selected);
        let cur = this.selected.parent;
        while (cur) {
          related.add(cur);
          cur = cur.parent;
        }
      }
      const hasSel = this.selected !== null || this.extraSel.size > 0;
      const walk = (n) => {
        const el = n.el;
        if (el) {
          el.classList.toggle("mm-sel", n === this.selected);
          el.classList.toggle("mm-multi", this.extraSel.has(n));
          el.classList.toggle("mm-dim", hasSel && !related.has(n));
        }
        n.kids.forEach(walk);
      };
      walk(root);
      this.markOutlineCursor();
      this.refreshBatchBar();
      this.updateMinimapMarks();
    }
    /** 当前参与批量操作的节点，主选中排在最后（删除时从后往前更安全） */
    get selNodes() {
      const list = [...this.extraSel];
      if (this.selected && !this.extraSel.has(this.selected)) list.push(this.selected);
      return list;
    }
    toggleFold(n) {
      this.disarmPreview();
      n.folded = !n.folded;
      if (n.id) this.cb.onFoldChange(n.id, n.folded);
      this.render();
      this.reclampView();
    }
    foldAll(folded) {
      const root = this.tree;
      if (!root) return;
      const walk = (n) => {
        if (n.children.length > 0 && n !== root) {
          n.folded = folded;
          if (n.id) this.cb.onFoldChange(n.id, folded);
        }
        n.children.forEach(walk);
      };
      walk(root);
      this.render(true);
    }
    /* ==================================================================== 键盘 */
    /** 让节点进入可视区，必要时平移画布 */
    ensureVisible(n) {
      const vw = this.viewportEl.clientWidth;
      const vh = this.viewportEl.clientHeight;
      const pad = 56;
      const sx = this.tx + n.x * this.scale;
      const sy = this.ty + n.y * this.scale;
      const sw = n.w * this.scale;
      const sh = n.h * this.scale;
      let dx = 0;
      let dy = 0;
      if (sx < pad) dx = pad - sx;
      else if (sx + sw > vw - pad) dx = vw - pad - (sx + sw);
      if (sy < pad) dy = pad - sy;
      else if (sy + sh > vh - pad) dy = vh - pad - (sy + sh);
      if (dx || dy) {
        this.tx += dx;
        this.ty += dy;
        this.updateTransform();
      }
    }
    focusNode(n) {
      this.selected = n;
      this.extraSel.clear();
      this.rootEl.classList.add("mm-kbd");
      this.refreshSelection();
      this.ensureVisible(n);
    }
    /**
     * 方向键导航。
     * ↑↓ 走同级，← 回父节点，→ 进第一个子节点（折叠则先展开）。
     *
     * 同级与子级都按 `shownChildren()` 取 —— 折叠的、被过滤器筛掉的一律跳过。
     * 用 `children` 的话，方向键会停在一个**看不见的节点**上：选中框不出现、
     * 按 Enter 却会去改那个节点，是那种「界面没反应但其实干了事」的故障。
     */
    navigate(dir) {
      const cur = this.selected ?? this.tree;
      if (!cur) return;
      if (dir === "left") {
        if (cur.parent) this.focusNode(cur.parent);
        return;
      }
      if (dir === "right") {
        const kids = shownChildren(cur);
        if (kids.length === 0) return;
        if (cur.folded) {
          this.toggleFold(cur);
          this.selected = cur;
          this.refreshSelection();
        }
        this.focusNode(kids[0]);
        return;
      }
      const parent = cur.parent;
      if (!parent) return;
      const sibs = shownChildren(parent);
      const idx = sibs.indexOf(cur);
      if (idx < 0) return;
      if (dir === "home") {
        this.focusNode(sibs[0]);
        return;
      }
      if (dir === "end") {
        this.focusNode(sibs[sibs.length - 1]);
        return;
      }
      const next = dir === "up" ? idx - 1 : idx + 1;
      if (next < 0 || next >= sibs.length) return;
      this.focusNode(sibs[next]);
    }
    /**
     * 由全局键盘分发器调用（见文件顶部 installKeyDispatch 的注释）。
     * 只有事件目标真的落在本视图里才处理 —— 页面上可能同时存在行内视图与全屏视图，
     * 别互相抢键。
     */
    handleGlobalKey(e) {
      if (this.destroyed) return;
      const t = e.target;
      if (!t || !this.rootEl.contains(t)) return;
      this.onKeyDown(e);
      if (e.defaultPrevented) this.restoreFocus();
      else if (MODIFIER_ONLY_KEYS.has(e.key)) this.restoreFocus(true);
    }
    /**
     * 把焦点抢回导图根元素。
     * 异步做，免得和 trapFocus / 编辑器里同步的 focus() 打架（谁后调用谁赢）。
     *
     * `fromModifier` 为真时再多补两次 —— 修饰键单独按下那一下，思源编辑器抢焦点
     * **有快有慢**（实测同一个动作，有时同步发生、有时晚一个节拍），
     * 只做一次 `setTimeout(0)` 会输给后者，`Ctrl+D` 照样收不到。
     *
     * 补的那两次**必须收窄**：只针对「焦点落在思源编辑器 `.protyle-wysiwyg` 里」
     * 这一种情况。不加这个限制的话，按 ⌥⇧P 时会把焦点从刚打开的命令面板输入框里
     * 抢回导图，用户就打不了字了。
     */
    restoreFocus(fromModifier = false) {
      const attempt = () => {
        if (this.destroyed || this.editing || this.searchOpen) return;
        if (!this.rootEl.isConnected) return;
        if (this.rootEl.contains(document.activeElement)) return;
        this.rootEl.focus({ preventScroll: true });
      };
      window.setTimeout(attempt, 0);
      if (!fromModifier) return;
      for (const delay of [60, 200]) {
        window.setTimeout(() => {
          const a = document.activeElement;
          if (!a || typeof a.closest !== "function") return;
          if (!a.closest(".protyle-wysiwyg")) return;
          if (this.rootEl.contains(a)) return;
          attempt();
        }, delay);
      }
    }
    /**
     * 导图内的键盘处理。
     *
     * 与 Protyle 抢按键是本插件最容易翻车的地方：
     * 不拦截的话 Tab 会往正文插制表符、Ctrl+A 会全选整个文档、Delete 会删掉编辑器选区。
     * 所以接管的按键必须 preventDefault + stopPropagation，同时留白名单放行系统级快捷键。
     */
    onKeyDown(e) {
      if (!this.options.keyboard) return;
      if (this.destroyed) return;
      if (e.isComposing) return;
      if (e.target?.closest?.(".mm-search")) return;
      if (e.target?.closest?.(".mm-mark-pop")) return;
      if (this.editing) return;
      const mod = e.ctrlKey || e.metaKey;
      const modOnly = mod && !e.altKey;
      const key = e.key;
      if (mod && !e.altKey) {
        const lower = key.toLowerCase();
        if (lower === "s" || lower === "p" || lower === "w" || lower === "r") return;
        if (lower === "z" || lower === "y") {
          const redo = lower === "y" || e.shiftKey;
          const handled = this.cb.onHistory(redo);
          document.documentElement.dataset.mmHistory = handled ? redo ? "redo" : "undo" : "none";
          if (handled) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
      }
      if (key === "F5" || key === "F11" || key === "F12") return;
      const take = (fn) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      if (this.presenting) {
        if (key === "Escape") return take(() => this.togglePresent(false));
        if (key === "ArrowRight" || key === "ArrowDown" || key === " " || key === "PageDown" || key === "Enter") {
          return take(() => this.presentGo(this.presentIdx + 1));
        }
        if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") {
          return take(() => this.presentGo(this.presentIdx - 1));
        }
        if (key === "Home") return take(() => this.presentGo(0));
        if (key === "End") return take(() => this.presentGo(this.presentOrder.length - 1));
        return take(() => void 0);
      }
      const cur = this.selected;
      if (modOnly && (key === "=" || key === "+")) return take(() => this.zoomAt(1.2));
      if (modOnly && key === "-") return take(() => this.zoomAt(1 / 1.2));
      if (modOnly && key === "0") return take(() => this.fit());
      if (modOnly && key === "1") return take(() => this.setScale(1));
      if (modOnly && key.toLowerCase() === "f") return take(() => this.toggleSearch(true));
      if (!mod && !e.altKey && (key === "f" || key === "F") && this.mode === "inline") {
        if (!this.tree) return;
        return take(() => this.cb.onFullscreen(this.tree, resolveTheme(this.options.theme)));
      }
      if (key === "Escape" && this.markPop) return take(() => this.closeMarkPopover());
      if (key === "Escape" && this.activeMenu) {
        const menu = this.activeMenu;
        this.activeMenu = null;
        return take(() => menu.close());
      }
      if (key === "Escape") {
        if (this.searchOpen) return take(() => this.toggleSearch(false));
        if (this.extraSel.size) return take(() => this.clearSelection());
        if (this.selected) return take(() => this.clearSelection());
        if (this.drillPath.length > 0) return take(() => this.drillUp());
        return take(() => this.rootEl.blur());
      }
      if (!cur) {
        if (key.startsWith("Arrow") && this.tree) return take(() => this.focusNode(this.tree));
        return;
      }
      if (!mod && !e.altKey) {
        if (key === "ArrowUp") return take(() => this.navigate("up"));
        if (key === "ArrowDown") return take(() => this.navigate("down"));
        if (key === "ArrowLeft") return take(() => this.navigate("left"));
        if (key === "ArrowRight") return take(() => this.navigate("right"));
        if (key === "Home") return take(() => this.navigate("home"));
        if (key === "End") return take(() => this.navigate("end"));
        if (key === " ") return take(() => this.toggleFold(cur));
        if (key === "F2") return take(() => this.beginEdit(cur));
        if ((key === "x" || key === "X") && cur.kind === "task") {
          return take(() => this.toggleTaskCheck(cur));
        }
        if (key === "Enter" && e.shiftKey) return take(() => void 0);
        if (key === "Enter") return take(() => void this.runAction("insertSiblingAfter", cur));
        if (key === "Tab" && !e.shiftKey) return take(() => void this.runAction("insertChild", cur));
        if (key === "Delete" || key === "Backspace") {
          return take(() => {
            const targets = this.selectedInDocOrder().filter(canDelete);
            if (targets.length === 0) return;
            if (targets.length > 1) {
              if (window.confirm(`\u786E\u5B9A\u5220\u9664\u9009\u4E2D\u7684 ${targets.length} \u4E2A\u8282\u70B9\u53CA\u5176\u5B50\u6811\uFF1F`)) {
                this.runBatchAction("delete", targets);
              }
              return;
            }
            const only = targets[0];
            const kids = only.children.length;
            if (kids > 0 && !window.confirm(`\u300C${only.text}\u300D\u4E0B\u8FD8\u6709 ${kids} \u4E2A\u5B50\u8282\u70B9\uFF0C\u4E00\u5E76\u5220\u9664\uFF1F`)) return;
            void this.runAction("delete", only);
          });
        }
      }
      if (e.shiftKey && key === "Tab") return take(() => void this.runAction("outdent", cur));
      if (modOnly && key === "ArrowUp") return take(() => void this.runAction("moveUp", cur));
      if (modOnly && key === "ArrowDown") return take(() => void this.runAction("moveDown", cur));
      if (modOnly && key.toLowerCase() === "a") return take(() => this.selectAllSiblings());
      if (modOnly && key.toLowerCase() === "d") return take(() => void this.runAction("duplicate", cur));
      if (modOnly && key.toLowerCase() === "c") {
        return take(() => {
          this.clipboard = serializeSubtree(cur);
          void this.copyNodeText(cur);
        });
      }
      if (modOnly && key.toLowerCase() === "v") {
        if (!this.clipboard) return;
        const data = this.clipboard;
        return take(() => void this.runAction("paste", cur, { data }));
      }
      if (modOnly && key.toLowerCase() === "x") {
        return take(() => {
          this.clipboard = serializeSubtree(cur);
          void this.copyNodeText(cur);
          void this.runAction("delete", cur);
        });
      }
      if (e.altKey && !mod && key === "ArrowLeft") return take(() => void this.runAction("outdent", cur));
      if (e.altKey && !mod && key === "ArrowRight") return take(() => void this.runAction("indent", cur));
    }
    /* ==================================================================== 编辑 */
    /**
     * 进入编辑态。
     *
     * **两条路，按节点内容分流**（这是「改名会抹掉格式」那个数据破坏问题的修法）：
     *
     * - **纯文本节点** → 就地改。写回的是 `escapeMd(textContent)`，不会丢任何东西，
     *   而且不用离开导图，体验最轻快。
     * - **含行内格式的节点**（加粗 / 双链 / 公式 / 图片 / 颜色……）→ **回到源列表改**。
     *   就地编辑提交时只能拿到 `textContent`，双链、公式、加粗会被**静默重建成纯文本**
     *   写进笔记（实测：`加粗 **粗体** 斜体 *斜体*` 改名后只剩 `改过`）。
     *   视觉上因为还原了 `savedHtml` 当场看不出来，所以这条必须堵死。
     *
     * @param force 跳过上面的分流，强制就地编辑。只给「插入即编辑」用 ——
     *   刚建出来的节点只有占位文字，没有任何格式会被写坏，而回源编辑会退出导图。
     */
    beginEdit(n, force = false) {
      if (!this.options.editable || !n.contentId) return;
      const el = n.el;
      if (!el || el.hasAttribute(EDIT_FLAG)) return;
      if (!force && hasInlineFormat(n)) {
        this.cb.onEditInSource(n);
        return;
      }
      const txt = el.querySelector(".mm-txt");
      if (!txt) return;
      this.editing = n;
      el.setAttribute(EDIT_FLAG, "1");
      el.classList.add("mm-editing");
      const original = n.text;
      const savedHtml = n.html;
      txt.textContent = original;
      txt.setAttribute("contenteditable", "true");
      txt.setAttribute("spellcheck", "false");
      try {
        const range = document.createRange();
        range.selectNodeContents(txt);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
      }
      txt.focus();
      let done = false;
      let blurTimer = 0;
      const cleanup = () => {
        txt.removeEventListener("keydown", onKey);
        txt.removeEventListener("blur", onBlur);
        txt.removeEventListener("paste", onPaste);
        if (blurTimer) {
          window.clearTimeout(blurTimer);
          blurTimer = 0;
        }
      };
      const finish = (commit) => {
        if (done) return;
        done = true;
        cleanup();
        this.editing = null;
        el.removeAttribute(EDIT_FLAG);
        el.classList.remove("mm-editing");
        txt.removeAttribute("contenteditable");
        const next = (txt.textContent ?? "").replace(/\s+/g, " ").trim();
        txt.innerHTML = savedHtml;
        if (commit && !this.destroyed && next && next !== original) this.cb.onRename(n, next);
        if (this.pendingRender) {
          this.pendingRender = false;
          window.setTimeout(() => {
            if (!this.destroyed && !this.editing) this.render();
          }, 0);
        }
      };
      const onKey = (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      };
      const onBlur = () => {
        if (blurTimer) window.clearTimeout(blurTimer);
        blurTimer = window.setTimeout(() => {
          blurTimer = 0;
          if (done || this.destroyed) return;
          const ae = document.activeElement;
          if (ae && el.contains(ae)) return;
          finish(true);
        }, 0);
      };
      const onPaste = (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData("text/plain") ?? "";
        document.execCommand("insertText", false, text);
      };
      txt.addEventListener("keydown", onKey);
      txt.addEventListener("blur", onBlur);
      txt.addEventListener("paste", onPaste);
    }
    /* ==================================================================== 行内交互 */
    /**
     * 打开节点里的链接 / 双链。
     *
     * 之前这两个元素在导图里**完全点不动**：`mousedown` 上为了保焦点做了 preventDefault，
     * 裸单击又是「选中节点」，没有任何入口能打开它们。
     */
    openInlineTarget(el) {
      const type = el.dataset.type;
      if (type === "a") {
        const href = el.dataset.href || el.getAttribute("href") || "";
        if (href) window.open(href, "_blank", "noopener,noreferrer");
        else showMessage("\u8FD9\u4E2A\u94FE\u63A5\u6CA1\u6709\u5730\u5740", 2e3);
        return;
      }
      const id = el.dataset.id;
      if (id) this.cb.onOpenBlock(id);
      else showMessage("\u8FD9\u4E2A\u53CC\u94FE\u6CA1\u6709\u76EE\u6807\u5757", 2e3);
    }
    /** 图片放大：遮罩层里看原图，点任意处或 Esc 关闭 */
    zoomImage(img) {
      const src = img.currentSrc || img.src;
      if (!src) return;
      const mask = document.createElement("div");
      mask.className = "mm-lightbox";
      mask.setAttribute("contenteditable", "false");
      const big = document.createElement("img");
      big.src = src;
      big.alt = img.alt || "";
      mask.appendChild(big);
      const onKey = (e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        close();
      };
      const close = () => {
        document.removeEventListener("keydown", onKey, true);
        mask.remove();
      };
      mask.onclick = (e) => {
        e.stopPropagation();
        close();
      };
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(mask);
    }
    /* ==================================================================== 菜单 */
    /* ==================================================================== 节点标记（P1-2） */
    /**
     * 打开「节点标记」浮层。
     *
     * 为什么不是一串 `window.prompt`：图标 / 标签 / 颜色是三个并列的维度，
     * 分三次问不仅烦，而且每次都要走一遍「写内核 → 重渲染」。
     * 一个浮层里一次配完，改一项即时生效（所见即所得），关掉就是最终结果。
     */
    openMarkPopover(n) {
      this.closeMarkPopover();
      const anchor = n.el;
      if (!anchor) return;
      const pop = document.createElement("div");
      pop.className = "mm-mark-pop";
      let draft = { ...n.mark ?? {} };
      const sync = () => {
        for (const b of pop.querySelectorAll("[data-icon]")) {
          b.classList.toggle("mm-on", b.dataset.icon === draft.icon);
        }
        for (const b of pop.querySelectorAll("[data-color]")) {
          b.classList.toggle("mm-on", b.dataset.color === draft.color);
        }
        const clr = pop.querySelector(".mm-mark-clear");
        if (clr) clr.classList.toggle("mm-dim", !hasMark(draft));
      };
      const apply = () => {
        this.commitMark(n, draft);
        sync();
      };
      const row = (label) => {
        const r2 = document.createElement("div");
        r2.className = "mm-mark-row";
        const t = document.createElement("span");
        t.className = "mm-mark-cap";
        t.textContent = label;
        r2.appendChild(t);
        pop.appendChild(r2);
        return r2;
      };
      const iconRow = row("\u56FE\u6807");
      for (const icon of MARK_ICONS) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.icon = icon;
        b.dataset.mmTip = icon;
        b.textContent = icon;
        b.onclick = (e) => {
          e.stopPropagation();
          draft.icon = draft.icon === icon ? void 0 : icon;
          apply();
        };
        iconRow.appendChild(b);
      }
      const labelRow = row("\u6807\u7B7E");
      const input = document.createElement("input");
      input.type = "text";
      input.className = "mm-mark-input";
      input.maxLength = MARK_LABEL_MAX;
      input.placeholder = `\u6700\u591A ${MARK_LABEL_MAX} \u4E2A\u5B57`;
      input.value = draft.label ?? "";
      input.oninput = () => {
        draft.label = input.value.trim() || void 0;
      };
      input.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          apply();
          if (e.key === "Escape") this.closeMarkPopover();
        }
      };
      input.onblur = () => apply();
      labelRow.appendChild(input);
      const colorRow = row("\u989C\u8272");
      const def = document.createElement("button");
      def.type = "button";
      def.dataset.color = "";
      def.className = "mm-mark-swatch mm-mark-swatch--def";
      def.dataset.mmTip = "\u8DDF\u968F\u5206\u652F\u8272";
      def.onclick = (e) => {
        e.stopPropagation();
        draft.color = void 0;
        apply();
      };
      colorRow.appendChild(def);
      for (const color of MARK_COLORS) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.color = color;
        b.className = "mm-mark-swatch";
        b.dataset.mmTip = color;
        b.style.background = color;
        b.onclick = (e) => {
          e.stopPropagation();
          draft.color = draft.color === color ? void 0 : color;
          apply();
        };
        colorRow.appendChild(b);
      }
      const foot = document.createElement("div");
      foot.className = "mm-mark-foot";
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "mm-mark-clear";
      clear.textContent = "\u6E05\u9664\u6807\u8BB0";
      clear.onclick = (e) => {
        e.stopPropagation();
        draft = {};
        input.value = "";
        apply();
      };
      const done = document.createElement("button");
      done.type = "button";
      done.className = "mm-mark-done";
      done.textContent = "\u5B8C\u6210";
      done.onclick = (e) => {
        e.stopPropagation();
        this.closeMarkPopover();
      };
      foot.append(clear, done);
      pop.appendChild(foot);
      pop.onmousedown = (e) => e.stopPropagation();
      pop.onclick = (e) => e.stopPropagation();
      this.rootEl.appendChild(pop);
      this.markPop = pop;
      this.markPopId = n.id;
      sync();
      this.positionMarkPop();
      input.focus();
      input.select();
    }
    /** 把浮层贴到它那个节点旁边（重渲染之后节点换了元素，要重新贴） */
    positionMarkPop() {
      const pop = this.markPop;
      if (!pop) return;
      const el = this.markPopId ? this.byId.get(this.markPopId)?.el : null;
      if (!el) {
        this.closeMarkPopover();
        return;
      }
      const r2 = el.getBoundingClientRect();
      const host2 = this.rootEl.getBoundingClientRect();
      const pw = pop.offsetWidth;
      const ph = pop.offsetHeight;
      let left = r2.left - host2.left;
      let top = r2.bottom - host2.top + 6;
      if (top + ph > host2.height - 6) top = Math.max(6, r2.top - host2.top - ph - 6);
      left = Math.max(6, Math.min(left, host2.width - pw - 6));
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
    }
    closeMarkPopover() {
      this.markPop?.remove();
      this.markPop = null;
      this.markPopId = "";
    }
    /**
     * 丢掉所有在途的乐观标记。     *
     * 由外部在**撤销 / 重做之后**调用：那是内容被整体写回的时刻，
     * 覆盖表里的值既已经过时，又永远等不到「DOM 追上来」的对齐
     * （撤销是反方向的改动），只能靠 3 秒超时退休 —— 那 3 秒里画面上
     * 挂着的就是一个已经被撤掉的标记。
     */
    forgetMarkOverlay() {
      if (this.markOverlay.size === 0) return;
      this.markOverlay.clear();
      this.render();
    }
    /**
     * 提交一次标记改动。
     *
     * 分两层：**先改本地**（节点立刻变样，不等内核），**再写内核**。
     * 写回之后内核会回推 DOM、触发一次重渲染，那时 `mark` 会从块属性重新解析出来，
     * 两边自然对齐 —— 所以这里不需要在内存里维护一份「标记真相」。
     */
    commitMark(n, mark) {
      const next = hasMark(mark) ? { ...mark } : void 0;
      const live = n.id && this.byId.get(n.id) || n;
      if (sameMark(live.mark, next)) return;
      live.mark = next;
      if (next?.color) live.color = next.color;
      if (live.id) {
        const id = live.id;
        this.markOverlay.set(id, next ? { ...next } : null);
        window.setTimeout(() => {
          if (!this.markOverlay.has(id)) return;
          this.markOverlay.delete(id);
          this.render();
        }, 3e3);
      }
      this.cb.onMarkChange(live, next ?? null);
      this.render();
    }
    openNodeMenu(n, event) {
      const menu = this.makeMenu("mm-node-menu");
      const act = (kind, opts) => {
        void this.runAction(kind, n, opts);
      };
      const item = (label, key, disabled, click) => {
        menu.addItem({ label: key ? `${label}    ${key}` : label, disabled, click });
      };
      if (n.kind === "task") {
        item(n.checked ? "\u6807\u8BB0\u4E3A\u672A\u5B8C\u6210" : "\u6807\u8BB0\u4E3A\u5DF2\u5B8C\u6210", "X", !n.id, () => this.toggleTaskCheck(n));
        menu.addItem({ type: "separator" });
      }
      item(
        n.mark ? "\u7F16\u8F91\u6807\u8BB0\uFF08\u56FE\u6807 / \u6807\u7B7E / \u989C\u8272\uFF09\u2026" : "\u6DFB\u52A0\u6807\u8BB0\uFF08\u56FE\u6807 / \u6807\u7B7E / \u989C\u8272\uFF09\u2026",
        "",
        !n.id,
        () => this.openMarkPopover(n)
      );
      const rich = hasInlineFormat(n);
      item(
        rich ? "\u56DE\u5230\u539F\u6587\u7F16\u8F91\uFF08\u4FDD\u7559\u683C\u5F0F\uFF09" : "\u7F16\u8F91\u6587\u5B57",
        "F2",
        !this.options.editable || !canEdit(n),
        () => this.beginEdit(n)
      );
      item("\u63D2\u5165\u5B50\u8282\u70B9", "Tab", false, () => act("insertChild"));
      item("\u5728\u4E0B\u65B9\u63D2\u5165", "Enter", false, () => act("insertSiblingAfter"));
      if (n.children.length > 0) {
        item("\u805A\u7126\u6B64\u5206\u652F\uFF08\u53EA\u770B\u8FD9\u4E00\u652F\uFF09", "Ctrl \u53CC\u51FB", false, () => this.drillDown(n));
      }
      if (this.drillPath.length > 0) {
        item("\u9000\u51FA\u805A\u7126\uFF0C\u56DE\u5230\u5168\u56FE", "Esc", false, () => this.drillTo(0));
      }
      menu.addItem({ type: "separator" });
      item("\u4E0A\u79FB", "Ctrl \u2191", !canMoveUp(n), () => act("moveUp"));
      item("\u4E0B\u79FB", "Ctrl \u2193", !canMoveDown(n), () => act("moveDown"));
      item("\u964D\u7EA7\u4E3A\u4E0A\u4E00\u4E2A\u8282\u70B9\u7684\u5B50\u8282\u70B9", "Alt \u2192", !canIndent(n), () => act("indent"));
      item("\u5347\u7EA7\u4E3A\u7236\u8282\u70B9\u7684\u5144\u5F1F", "Alt \u2190", !canOutdent(n), () => act("outdent"));
      menu.addItem({ type: "separator" });
      if (n.children.length > 0) {
        item(n.folded ? `\u5C55\u5F00\uFF08${n.children.length} \u4E2A\u5B50\u8282\u70B9\uFF09` : "\u6298\u53E0\u5B50\u8282\u70B9", "\u7A7A\u683C", false, () => this.toggleFold(n));
      }
      item("\u590D\u5236\u5B50\u6811", "Ctrl C", false, () => {
        this.clipboard = serializeSubtree(n);
        void this.copyNodeText(n);
      });
      item("\u5FEB\u901F\u590D\u5236", "Ctrl D", !n.id, () => act("duplicate"));
      item("\u590D\u5236\u6587\u5B57", "", false, () => void this.copyNodeText(n));
      item("\u5B9A\u4F4D\u5230\u7F16\u8F91\u5668", "", !n.id, () => this.cb.onLocate(n.id));
      menu.addItem({ type: "separator" });
      item(
        n.children.length > 0 ? `\u5220\u9664\u8282\u70B9\uFF08\u542B ${n.children.length} \u4E2A\u5B50\u8282\u70B9\uFF09` : "\u5220\u9664\u8282\u70B9",
        "Delete",
        !canDelete(n),
        () => act("delete")
      );
      this.popMenu(menu, event);
    }
    /* ==================================================================== 拖拽 */
    /** 记录按下位置，移动超过阈值才真正进入拖拽，避免与点击冲突 */
    armDrag(n, down) {
      const startX = down.clientX;
      const startY = down.clientY;
      let active = false;
      const onMove = (e) => {
        if (!active) {
          if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) {
            return;
          }
          active = true;
          this.dragging = n;
          this.hideTip();
          this.rootEl.classList.add("mm-drag-active");
          n.el?.classList.add("mm-dragging");
        }
        e.preventDefault();
        this.updateDropTarget(n, e);
        this.autoScroll(e);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        this.rootEl.classList.remove("mm-drag-active");
        n.el?.classList.remove("mm-dragging");
        this.clearIndicator();
        this.stopAutoScroll();
        window.clearTimeout(this.hoverExpandTimer);
        this.markHoverExpand(null);
        this.dragging = null;
        if (!active) return;
        this.suppressClick = true;
        window.setTimeout(() => {
          this.suppressClick = false;
        }, 0);
        const drop = this.pendingDrop;
        this.pendingDrop = null;
        if (drop) void this.runAction("move", n, { target: drop.target, position: drop.position });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
    /** 拖到画布边缘时自动平移 */
    autoScroll(e) {
      const r2 = this.viewportEl.getBoundingClientRect();
      const dx = e.clientX - r2.left;
      const dy = e.clientY - r2.top;
      let sx = 0;
      let sy = 0;
      if (dx < AUTO_SCROLL_MARGIN) sx = -1;
      else if (dx > r2.width - AUTO_SCROLL_MARGIN) sx = 1;
      if (dy < AUTO_SCROLL_MARGIN) sy = -1;
      else if (dy > r2.height - AUTO_SCROLL_MARGIN) sy = 1;
      if (sx === 0 && sy === 0) {
        this.stopAutoScroll();
        return;
      }
      this.autoScrollDir = { x: sx, y: sy };
      if (this.autoScrollTimer) return;
      const tick = () => {
        if (!this.dragging || this.destroyed) {
          this.stopAutoScroll();
          return;
        }
        this.tx -= this.autoScrollDir.x * AUTO_SCROLL_SPEED;
        this.ty -= this.autoScrollDir.y * AUTO_SCROLL_SPEED;
        this.updateTransform();
        this.autoScrollTimer = window.setTimeout(tick, 16);
      };
      this.autoScrollTimer = window.setTimeout(tick, 16);
    }
    stopAutoScroll() {
      window.clearTimeout(this.autoScrollTimer);
      this.autoScrollTimer = 0;
      this.autoScrollDir = { x: 0, y: 0 };
    }
    updateDropTarget(source, e) {
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest(
        ".mm-node"
      );
      const target = hit ? this.byId.get(hit.dataset.mmId ?? "") : null;
      if (!hit || !target || target === source || isAncestor(source, target)) {
        this.pendingDrop = null;
        window.clearTimeout(this.hoverExpandTimer);
        this.markHoverExpand(null);
        this.clearIndicator();
        return;
      }
      const rect = hit.getBoundingClientRect();
      const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
      const position = ratio < DROP_BEFORE_RATIO ? "before" : ratio > DROP_AFTER_RATIO ? "after" : "child";
      this.pendingDrop = { target, position };
      this.showIndicator(hit, position);
      window.clearTimeout(this.hoverExpandTimer);
      if (position === "child" && target.folded && target.children.length > 0) {
        this.markHoverExpand(target);
        this.hoverExpandTimer = window.setTimeout(() => {
          this.markHoverExpand(null);
          if (this.dragging && this.pendingDrop?.target === target) {
            target.folded = false;
            if (target.id) this.cb.onFoldChange(target.id, false);
            this.render();
          }
        }, HOVER_EXPAND_DELAY);
      } else {
        this.markHoverExpand(null);
      }
    }
    /** 指示器画在 world 坐标系内，所以要把屏幕坐标除以当前缩放 */
    showIndicator(targetEl, position) {
      if (!this.indicatorEl) {
        this.indicatorEl = document.createElement("div");
        this.worldEl.appendChild(this.indicatorEl);
      }
      const ind = this.indicatorEl;
      const k = this.scale || 1;
      const wr = this.worldEl.getBoundingClientRect();
      const tr = targetEl.getBoundingClientRect();
      const left = (tr.left - wr.left) / k;
      const top = (tr.top - wr.top) / k;
      const w = tr.width / k;
      const h = tr.height / k;
      if (position === "child") {
        ind.className = "mm-drop mm-drop--child";
        ind.style.left = `${left - 5}px`;
        ind.style.top = `${top - 5}px`;
        ind.style.width = `${w + 10}px`;
        ind.style.height = `${h + 10}px`;
      } else {
        ind.className = "mm-drop mm-drop--line";
        ind.style.left = `${left - 8}px`;
        ind.style.top = `${position === "before" ? top - 3 : top + h - 1}px`;
        ind.style.width = `${w + 16}px`;
        ind.style.height = "2px";
      }
    }
    clearIndicator() {
      this.indicatorEl?.remove();
      this.indicatorEl = null;
    }
    async copyNodeText(n) {
      const ok = await copyText(n.text);
      if (ok) showMessage("\u5DF2\u590D\u5236\u8282\u70B9\u6587\u5B57");
      else showMessage("\u590D\u5236\u5931\u8D25", 4e3, "error");
    }
    /* ==================================================================== 状态过滤（P1-1） */
    /** 切换过滤器并重渲染。视图会整体换形，所以重新取景一次 */
    setFilter(f) {
      if (this.filter === f) return;
      this.filter = f;
      this.render(true);
      if (f !== "all" && this.filterHits === 0) {
        showMessage(f === "done" ? "\u8FD9\u5F20\u56FE\u91CC\u6CA1\u6709\u5DF2\u5B8C\u6210\u7684\u5F85\u529E" : "\u8FD9\u5F20\u56FE\u91CC\u6CA1\u6709\u672A\u5B8C\u6210\u7684\u5F85\u529E", 2400);
      }
    }
    /**
     * 把过滤器落到树上：算一遍「该留下谁」，写进每个节点的 `hidden`。
     *
     * 保留规则和主流大纲工具一致：**命中的节点 + 它的全部祖先**。
     * 祖先必须留下，否则树就断了 —— 一个未完成的子任务总得挂在它那个
     * （可能已完成的）父任务下面，不然用户根本看不出它为什么在这儿。
     *
     * 「命中」的判定对**非待办节点**是继承的：一个普通列表项算什么状态，
     * 看它最近的那个待办祖先。理由是实际用法 —— 任务下面挂的说明、备注、子条目
     * 本来就属于那条任务，任务没做完就不该把它们一起藏起来。
     * 上面没有待办祖先的（纯散文节点）不继承任何状态，只在「全部」下出现。
     *
     * 必须在**布局之前**调用：布局只认 `kids`，而 `kids` 是按 `hidden` 算的。
     */
    applyFilter(root) {
      const all = flatten(root);
      const reset = () => {
        for (const n of all) n.hidden = false;
        this.filterHits = all.filter((n) => n.kind === "task").length;
      };
      if (this.filter === "all") return reset();
      const tasks = all.filter((n) => n.kind === "task");
      if (tasks.length === 0) return reset();
      const want = this.filter === "done";
      let hits = 0;
      const walk = (n, inherited) => {
        const state = n.kind === "task" ? !!n.checked : inherited;
        let keep = state === want;
        if (keep) hits++;
        for (const c of n.children) if (walk(c, state)) keep = true;
        n.hidden = !keep;
        return keep;
      };
      walk(root, null);
      root.hidden = false;
      this.filterHits = hits;
    }
    /** 同步过滤 chip 的高亮与整组的显隐 */
    syncFilterGroup() {
      const hasTask = !!this.tree && flatten(this.tree).some((n) => n.kind === "task");
      this.filterGroup.style.display = hasTask ? "" : "none";
      for (const b of this.filterEls) b.classList.toggle("mm-on", b.dataset.filter === this.filter);
    }
    /* ==================================================================== 搜索 */
    toggleSearch(open) {
      const next = open ?? !this.searchOpen;
      this.searchOpen = next;
      this.searchEl.classList.toggle("mm-search--on", next);
      if (next) {
        this.searchInput.focus();
        this.searchInput.select();
        this.runSearch(this.searchInput.value);
      } else {
        this.searchInput.value = "";
        this.searchHits = [];
        this.searchIdx = -1;
        this.docHits = [];
        this.docSearchSeq++;
        window.clearTimeout(this.docSearchTimer);
        this.renderDocResults();
        this.updateSearchCount();
        this.applySearchMarks();
        this.rootEl.focus({ preventScroll: true });
      }
    }
    /**
     * 检索串：正文 + 链接地址 + 图片 alt / title。
     *
     * 之前只搜 `n.text`，于是「按双链目标找节点」「按图片名找节点」都搜不到 ——
     * 而这两样恰好是导图里最常见的两种富内容。链接地址与 alt 只活在行内 HTML 里，
     * 纯文本里一个字都看不到（双链的锚文本在 text 里，但目标块 ID / 标题不在）。
     */
    searchHay(n) {
      let hay = this.hayCache.get(n);
      if (hay !== void 0) return hay;
      hay = n.text.toLowerCase();
      const html = n.html ?? "";
      if (html) {
        const extra = html.match(/(?:data-href|alt|title)="[^"]*"/g);
        if (extra) hay += " " + extra.join(" ").toLowerCase();
      }
      this.hayCache.set(n, hay);
      return hay;
    }
    runSearch(q) {
      const root = this.tree;
      this.searchHits = [];
      const needle = q.trim().toLowerCase();
      if (root && needle) {
        const walk = (n) => {
          if (n.hidden) return;
          if (n.id && this.searchHay(n).includes(needle)) this.searchHits.push(n.id);
          n.children.forEach(walk);
        };
        walk(root);
      }
      this.searchIdx = this.searchHits.length > 0 ? 0 : -1;
      this.updateSearchCount();
      this.applySearchMarks();
      if (this.searchIdx >= 0) this.gotoHit();
      if (this.searchAll) this.runDocSearch(needle);
      else {
        this.docHits = [];
        this.renderDocResults();
      }
    }
    /**
     * 跨图搜索：防抖 + 只认最后一次的返回。
     *
     * 每敲一个字都打一次 SQL 太浪费；而「慢的请求后到、把新结果盖掉」是
     * 中文输入法连续输入时很容易撞上的真问题，所以用一个自增序号认领结果 ——
     * 回来的不是最新那一次就直接丢掉。
     */
    runDocSearch(needle) {
      window.clearTimeout(this.docSearchTimer);
      const seq2 = ++this.docSearchSeq;
      if (!needle) {
        this.docHits = [];
        this.renderDocResults();
        return;
      }
      this.docSearchTimer = window.setTimeout(() => {
        const pending = this.cb.onSearchDoc?.(needle) ?? Promise.resolve([]);
        void pending.then((hits) => {
          if (seq2 !== this.docSearchSeq || this.destroyed) return;
          this.docHits = hits;
          this.renderDocResults();
        }).catch((err) => {
          if (seq2 !== this.docSearchSeq) return;
          console.warn("[mindmap] \u8DE8\u56FE\u641C\u7D22\u5F02\u5E38", err);
          this.docHits = [];
          this.renderDocResults();
        });
      }, 220);
    }
    stepSearch(delta) {
      if (this.searchHits.length === 0) return;
      this.searchIdx = (this.searchIdx + delta + this.searchHits.length) % this.searchHits.length;
      this.updateSearchCount();
      this.applySearchMarks();
      this.gotoHit();
    }
    updateSearchCount() {
      if (this.searchAll) {
        const n2 = this.docHits.length;
        this.searchCount.textContent = !this.searchInput.value.trim() ? "" : n2 === 0 ? "\u65E0\u7ED3\u679C" : `${n2} \u6761`;
        return;
      }
      const n = this.searchHits.length;
      this.searchCount.textContent = n === 0 ? this.searchInput.value ? "\u65E0\u7ED3\u679C" : "" : `${this.searchIdx + 1}/${n}`;
    }
    /** 命中项可能在折叠的子树里，先展开祖先 */
    gotoHit() {
      const id = this.searchHits[this.searchIdx];
      if (!id) return;
      let hit = this.byId.get(id);
      if (!hit) return;
      let unfolded = false;
      let cur = hit.parent;
      while (cur) {
        if (cur.folded) {
          cur.folded = false;
          if (cur.id) this.cb.onFoldChange(cur.id, false);
          unfolded = true;
        }
        cur = cur.parent;
      }
      if (unfolded) {
        this.render();
        hit = this.byId.get(id);
        if (!hit) return;
      }
      this.focusNode(hit);
      if (this.scale < READABLE_SCALE) {
        this.setScale(READABLE_SCALE);
        this.ensureVisible(hit);
      }
    }
    applySearchMarks() {
      const root = this.tree;
      if (!root) return;
      const hitSet = new Set(this.searchHits);
      const current = this.searchHits[this.searchIdx];
      const walk = (n) => {
        const el = n.el;
        if (el) {
          el.classList.toggle("mm-hit", hitSet.has(n.id));
          el.classList.toggle("mm-hit-cur", n.id === current);
        }
        n.kids.forEach(walk);
      };
      walk(root);
    }
    /* ==================================================================== 小地图 */
    refreshMinimap() {
      const root = this.tree;
      const on = !!this.options.minimap && !!root && this.nodeCount >= MINIMAP_MIN_NODES;
      if (!on) {
        this.minimapEl.style.display = "none";
        this.minimapEl.innerHTML = "";
        this.minimapMarks = [];
        return;
      }
      const MW = 156;
      const MH = 108;
      const k = Math.min(MW / Math.max(this.worldW, 1), MH / Math.max(this.worldH, 1));
      const w = Math.max(1, this.worldW * k);
      const h = Math.max(1, this.worldH * k);
      this.minimapEl.style.display = "";
      this.minimapEl.style.width = `${Math.ceil(w) + 2}px`;
      this.minimapEl.style.height = `${Math.ceil(h) + 2}px`;
      const step = Math.max(1, Math.ceil(this.nodeCount / MINIMAP_MAX_RECTS));
      const rects = [];
      const marks = [];
      let i = 0;
      const walk = (n) => {
        if (i++ % step === 0) {
          const x = (n.x * k).toFixed(1);
          const y = (n.y * k).toFixed(1);
          const nw = Math.max(1.5, n.w * k).toFixed(1);
          const nh = Math.max(1.2, n.h * k).toFixed(1);
          const fill = n.color ?? this.palette0;
          rects.push(`<rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="1" fill="${fill}" opacity=".72"/>`);
        }
        marks.push({
          node: n,
          id: n.id ?? "",
          cx: ((n.x + n.w / 2) * k).toFixed(1),
          cy: ((n.y + n.h / 2) * k).toFixed(1)
        });
        n.kids.forEach(walk);
      };
      walk(root);
      this.minimapMarks = marks;
      const vw = this.viewportEl.clientWidth;
      const vh = this.viewportEl.clientHeight;
      const vx = -this.tx / this.scale * k;
      const vy = -this.ty / this.scale * k;
      const vw2 = vw / this.scale * k;
      const vh2 = vh / this.scale * k;
      this.minimapEl.innerHTML = [
        `<svg width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}">`,
        rects.join(""),
        // 标记单独成层：选中一变只重写这一层，底图不动
        `<g class="mm-mm-marks">${this.minimapMarkSvg()}</g>`,
        `<rect class="mm-mm-view" x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw2.toFixed(1)}" height="${vh2.toFixed(1)}" rx="2"/>`,
        `</svg>`
      ].join("");
      this.minimapK = k;
      this.updateMinimapView();
    }
    /** 搜索命中 / 选中的标记。搜索命中的用暖色、选中的用主色，一眼能分开 */
    minimapMarkSvg() {
      const hitSet = new Set(this.searchHits);
      const selSet = new Set(this.selNodes);
      const out = [];
      for (const m of this.minimapMarks) {
        if (m.id && hitSet.has(m.id)) out.push(`<circle class="mm-mm-hit" cx="${m.cx}" cy="${m.cy}" r="2.4"/>`);
        if (selSet.has(m.node)) out.push(`<circle class="mm-mm-sel" cx="${m.cx}" cy="${m.cy}" r="2.8"/>`);
      }
      return out.join("");
    }
    /**
     * 只重写标记层。
     *
     * 选择变化（点节点、Ctrl+A、框选）不触发重渲染，所以不会走到 refreshMinimap ——
     * 以前的表现是「小地图上永远看不到自己选了哪儿」，那个增强等于白做。
     */
    updateMinimapMarks() {
      if (this.minimapEl.style.display === "none") return;
      const g = this.minimapEl.querySelector(".mm-mm-marks");
      if (!g) return;
      g.innerHTML = this.minimapMarkSvg();
    }
    /** 只更新视口框。平移时每帧都会调用，所以不能整块重建 */
    updateMinimapView() {
      if (this.minimapEl.style.display === "none") return;
      const box = this.minimapEl.querySelector(".mm-mm-view");
      if (!box) return;
      const k = this.minimapK;
      const vw = this.viewportEl.clientWidth;
      const vh = this.viewportEl.clientHeight;
      box.setAttribute("x", (-this.tx / this.scale * k).toFixed(1));
      box.setAttribute("y", (-this.ty / this.scale * k).toFixed(1));
      box.setAttribute("width", (vw / this.scale * k).toFixed(1));
      box.setAttribute("height", (vh / this.scale * k).toFixed(1));
    }
    onMinimapDown(e) {
      if (!this.tree) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = this.minimapEl.getBoundingClientRect();
      const MW = 156;
      const MH = 108;
      const k = Math.min(MW / Math.max(this.worldW, 1), MH / Math.max(this.worldH, 1));
      const center = (ev) => {
        const wx = (ev.clientX - rect.left) / k;
        const wy = (ev.clientY - rect.top) / k;
        this.tx = this.viewportEl.clientWidth / 2 - wx * this.scale;
        this.ty = this.viewportEl.clientHeight / 2 - wy * this.scale;
        this.updateTransform();
      };
      center(e);
      const onMove = (ev) => center(ev);
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
    /* ==================================================================== 框选 */
    startMarquee(down) {
      const vr = this.viewportEl.getBoundingClientRect();
      const startX = down.clientX - vr.left;
      const startY = down.clientY - vr.top;
      let active = false;
      const onMove = (e) => {
        const cx = e.clientX - vr.left;
        const cy = e.clientY - vr.top;
        if (!active) {
          if (Math.abs(cx - startX) < DRAG_THRESHOLD && Math.abs(cy - startY) < DRAG_THRESHOLD) return;
          active = true;
          this.marqueeEl = document.createElement("div");
          this.marqueeEl.className = "mm-marquee";
          this.viewportEl.appendChild(this.marqueeEl);
        }
        const x = Math.min(startX, cx);
        const y = Math.min(startY, cy);
        const w = Math.abs(cx - startX);
        const h = Math.abs(cy - startY);
        if (this.marqueeEl) {
          this.marqueeEl.style.left = `${x}px`;
          this.marqueeEl.style.top = `${y}px`;
          this.marqueeEl.style.width = `${w}px`;
          this.marqueeEl.style.height = `${h}px`;
        }
      };
      const onUp = (e) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        this.marqueeEl?.remove();
        this.marqueeEl = null;
        if (!active || !this.tree) return;
        const cx = e.clientX - vr.left;
        const cy = e.clientY - vr.top;
        const x0 = Math.min(startX, cx);
        const y0 = Math.min(startY, cy);
        const x1 = Math.max(startX, cx);
        const y1 = Math.max(startY, cy);
        const hits = [];
        const walk = (n) => {
          const sx = this.tx + n.x * this.scale;
          const sy = this.ty + n.y * this.scale;
          const sw = n.w * this.scale;
          const sh = n.h * this.scale;
          if (sx + sw >= x0 && sx <= x1 && sy + sh >= y0 && sy <= y1) hits.push(n);
          n.kids.forEach(walk);
        };
        walk(this.tree);
        if (hits.length === 0) {
          this.clearSelection();
        } else {
          this.selected = hits[0];
          this.extraSel = new Set(hits.slice(1));
          this.refreshSelection();
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
    /* ==================================================================== 提示 */
    showTip(el) {
      const text = el.dataset.mmTip;
      if (!text) return;
      if (!this.tipEl) {
        this.tipEl = document.createElement("div");
        this.tipEl.className = "mm-tip";
        document.body.appendChild(this.tipEl);
      }
      const tip = this.tipEl;
      if (this.tipTarget === el && tip.classList.contains("mm-tip--on")) return;
      this.tipTarget = el;
      tip.textContent = text;
      const key = el.dataset.mmKey;
      if (key) {
        const kbd = document.createElement("kbd");
        kbd.textContent = key;
        tip.appendChild(kbd);
      }
      tip.classList.add("mm-tip--on");
      const r2 = el.getBoundingClientRect();
      const tr = tip.getBoundingClientRect();
      let left = r2.left + r2.width / 2 - tr.width / 2;
      let top = r2.bottom + 8;
      if (top + tr.height > window.innerHeight - 4) top = r2.top - tr.height - 8;
      left = Math.min(Math.max(left, 4), window.innerWidth - tr.width - 4);
      top = Math.min(Math.max(top, 4), window.innerHeight - tr.height - 4);
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
    }
    hideTip() {
      this.tipTarget = null;
      this.tipEl?.classList.remove("mm-tip--on");
    }
    /* ==================================================================== 变换 */
    /**
     * 适应视口。
     *
     * 两种语义：
     *
     * - **默认（适应画布）**：把整张图缩到刚好铺满，缩到多小都认。
     *   这是用户主动要全貌时的行为（工具条按钮 / Ctrl+0 / 双击空白）。
     * - **readable（可读优先）**：只在**首次进入**时用。缩放不低于 `READABLE_SCALE`，
     *   宁可让用户平移也不把图压成一片色块；并且把视口对齐到**根节点**，
     *   而不是整张画布的中心 —— 大图时画布中心离根节点很远（实测 64 节点画布
     *   742×3406，中心在 y≈1700，那里是第五层的一堆叶子），
     *   按画布中心对齐等于把用户直接丢进一片无关的枝叶里。
     */
    fit(opts) {
      const w = this.worldW;
      const h = this.worldH;
      const vw = this.viewportEl.clientWidth;
      const vh = this.viewportEl.clientHeight;
      if (w <= 1 || h <= 1 || vw <= 1 || vh <= 1) return;
      const exact = Math.min(vw / w, vh / h, 2);
      const readable = opts?.readable === true && exact < READABLE_SCALE;
      if (!readable) {
        this.scale = Math.max(MIN_SCALE, exact);
        this.tx = (vw - w * this.scale) / 2;
        this.ty = (vh - h * this.scale) / 2;
        this.updateTransform();
        return;
      }
      this.scale = READABLE_SCALE;
      const r2 = this.tree;
      const rx = (r2 ? r2.x + r2.w / 2 : w / 2) * this.scale;
      const ry = (r2 ? r2.y + r2.h / 2 : h / 2) * this.scale;
      const layoutMode = this.options.layout;
      const anchorX = layoutMode === "logic" ? vw * 0.3 : vw / 2;
      const anchorY = layoutMode === "tree" ? vh * 0.26 : vh / 2;
      this.tx = this.frameAxis(anchorX - rx, w * this.scale, vw, LAYOUT_PAD_X * this.scale);
      this.ty = this.frameAxis(anchorY - ry, h * this.scale, vh, LAYOUT_PAD_Y * this.scale);
      this.updateTransform();
    }
    /**
     * 把一个轴的平移量钳进「不无谓留白、也不无谓裁切」的范围。
     *
     * 可读优先模式下内容常常比视口大，这时「根节点放在 30% 处」会同时造成两个后果：
     * 左边白白空掉三成，右边却被裁掉更多 —— 用户看到的就是「错位」。
     * 实测：内容宽 1017px、视口 942px 时，左空 228px 而右裁 225px。
     *
     * 钳制规则：
     *   装得下 → 居中（此时锚点没有意义，居中最好看）
     *   装不下 → 把**内容边缘**夹到离视口边 M，保证视口被内容铺满，
     *            不出现「一边空一大片」
     *
     * ⚠️ `c` 是**画布**尺寸，而用户看到的是**内容** —— 画布在内容外侧还裹着一圈
     * `pad` 的内边距（`LAYOUT_PAD_*`）。所以要判断「装不装得下」、要夹到 M 的，
     * 都必须是 `c - pad * 2` 那一段。按画布算的后果实测过：内容宽 1231px、
     * 视口 519px 时，画布左边缘被钉在 28px，可内容左边缘却在 28 + 72×0.55 ≈ 68px 处
     * —— 左右各白空 68px，覆盖率只有 87%（可视区被吃掉两成半）。
     * 换成按内容边缘夹之后，左空 28px、覆盖率 94.6%。
     *
     * @param want 按锚点算出来的期望平移量
     * @param c    该轴上的**画布**尺寸（已乘缩放）
     * @param v    该轴上的视口尺寸
     * @param pad  画布内边距（已乘缩放），即画布边缘到内容边缘的距离
     */
    frameAxis(want, c, v, pad = 0) {
      const M = 28;
      const content = c - pad * 2;
      if (content <= v - M * 2) return (v - c) / 2;
      return Math.min(M - pad, Math.max(v - c + pad - M, want));
    }
    /**
     * 可视区高度的「稳定值」。
     *
     * ⚠️ 不能直接读 `viewportEl.clientHeight` —— 那个值正是上一轮 `resizeViewport`
     * 写进去的，用它算布局参数（maxCross / 分列阈值）会让**布局依赖渲染次序**：
     * 首轮读到的还是 CSS 默认值，之后读到的是真实值，同一份数据会算出不同列数。
     * 这里只依赖窗口 / 容器尺寸，与渲染历史无关。
     */
    availHeight() {
      if (this.detached) {
        const chrome = this.toolbarEl.offsetHeight + this.crumbEl.offsetHeight;
        const own = this.rootEl.clientHeight - chrome;
        if (own > 40) return own;
      }
      return Math.max(280, window.innerHeight * 0.76);
    }
    /**
     * 内容尺寸变了之后，把视图重新夹回合理范围（保持缩放）。
     *
     * 折叠 / 展开会让画布尺寸剧变，但 `scale / tx / ty` 是原样留着的 ——
     * 于是视口停在原地、内容大范围溢出到屏幕外，看起来就是「节点错位」。
     * 实测：展开全部后画布从 661×688 涨到 2437×1552，而缩放仍是 1，
     * 用户只能看到 38%×47% 的一角。
     *
     * ⚠️ 只在「内容装得下」时居中。内容比视口大时不碰 —— 那多半是用户
     * 特意放大后平移到某个角落看细节，替他把视图挪回去是帮倒忙。
     */
    reclampView() {
      const vw = this.viewportEl.clientWidth;
      const vh = this.viewportEl.clientHeight;
      if (vw <= 1 || vh <= 1) return;
      const M = 28;
      const cw = this.worldW * this.scale;
      const ch = this.worldH * this.scale;
      const innerW = cw - LAYOUT_PAD_X * this.scale * 2;
      const innerH = ch - LAYOUT_PAD_Y * this.scale * 2;
      let moved = false;
      if (innerW <= vw - M * 2) {
        this.tx = (vw - cw) / 2;
        moved = true;
      }
      if (innerH <= vh - M * 2) {
        this.ty = (vh - ch) / 2;
        moved = true;
      }
      if (moved) this.updateTransform();
    }
    setScale(next, cx, cy) {
      const vw = this.viewportEl.clientWidth;
      const vh = this.viewportEl.clientHeight;
      const px = cx ?? vw / 2;
      const py = cy ?? vh / 2;
      const clamped = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
      const k = clamped / this.scale;
      this.tx = px - (px - this.tx) * k;
      this.ty = py - (py - this.ty) * k;
      this.scale = clamped;
      this.updateTransform();
    }
    zoomAt(factor, cx, cy) {
      this.setScale(this.scale * factor, cx, cy);
    }
    /**
     * 应用当前缩放与平移。
     *
     * ⚠️ 缩放用 `zoom` 而不是 `transform: scale()`。
     *
     * `transform: scale()` 走的是「先把整棵子树画成一张位图，再交给合成器放大」的路径。
     * 合成器会缓存这张位图，一旦它用的还是旧的低栅格化倍率，放大后整棵子树就会糊
     * —— 而且糊得很均匀：文字、1.5px 描边、SVG 连线一起糊，因为它们是同一张位图。
     * 用户反馈的「放大后变模糊」就是这个现象（实测截图里 1.5px 圆环被拉成了十几像素的软边）。
     *
     * `zoom` 是布局级的缩放：浏览器直接按最终尺寸排版并栅格化，不存在「放大一张位图」这一步，
     * 所以无论放大到多少倍，文字与矢量线条都是按目标分辨率重新绘制的。
     *
     * 代价是 `zoom` 会把元素自身的长度（含 `transform: translate`）一起放大，
     * 所以屏幕位移要除以缩放比再写回去。
     */
    updateTransform() {
      const s = this.scale || 1;
      this.worldEl.style.zoom = String(s);
      this.worldEl.style.transform = `translate(${this.tx / s}px,${this.ty / s}px)`;
      if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
      this.hideTip();
      this.hidePreview();
      this.updateMinimapView();
    }
    /* ==================================================================== 事件 */
    bindEvents() {
      const on = (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts);
        this.disposers.push(() => target.removeEventListener(type, fn, opts));
      };
      installKeyDispatch();
      liveViews.add(this);
      this.disposers.push(() => liveViews.delete(this));
      on(this.rootEl, "blur", () => {
        this.hideTip();
        this.disarmPreview();
      });
      this.bindOutlineCursor();
      on(
        this.viewportEl,
        "wheel",
        (e) => {
          if (this.options.ctrlWheelZoom && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            const r2 = this.viewportEl.getBoundingClientRect();
            this.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r2.left, e.clientY - r2.top);
            return;
          }
          if (this.options.wheelPan) {
            e.preventDefault();
            e.stopPropagation();
            this.disarmPreview();
            this.tx -= e.deltaX;
            this.ty -= e.deltaY;
            this.updateTransform();
          }
        },
        { passive: false }
      );
      on(this.viewportEl, "mousedown", (e) => {
        this.disarmPreview();
        const t = e.target;
        if (t.closest(".mm-node") || t.closest(".mm-zoombar") || t.closest(".mm-minimap") || t.closest(".mm-search") || t.closest(".mm-present-bar") || // 批量条现在浮在画布里面（见样式表），按住它不能开始拖画布
        t.closest(".mm-batch")) {
          return;
        }
        if (e.button !== 0) return;
        e.preventDefault();
        this.rootEl.focus({ preventScroll: true });
        if (e.shiftKey) {
          this.startMarquee(e);
          return;
        }
        this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
        this.viewportEl.classList.add("mm-grabbing");
      });
      on(window, "mousemove", (e) => {
        if (!this.drag) return;
        this.tx = this.drag.tx + (e.clientX - this.drag.x);
        this.ty = this.drag.ty + (e.clientY - this.drag.y);
        this.updateTransform();
      });
      on(window, "mouseup", () => {
        this.drag = null;
        this.viewportEl.classList.remove("mm-grabbing");
      });
      let tAxis = null;
      let pinch = null;
      on(
        this.viewportEl,
        "touchstart",
        (e) => {
          const t = e.target;
          if (t?.closest?.(".mm-zoombar, .mm-minimap, .mm-search, .mm-toolbar, .mm-crumb, .mm-lightbox, .mm-present-bar")) {
            return;
          }
          if (e.touches.length === 2) {
            const [a, b] = [e.touches[0], e.touches[1]];
            pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), s: this.scale };
            this.drag = null;
            tAxis = null;
            return;
          }
          if (e.touches.length === 1 && !pinch) {
            const one = e.touches[0];
            this.drag = { x: one.clientX, y: one.clientY, tx: this.tx, ty: this.ty };
            tAxis = null;
          }
        },
        { passive: true }
      );
      on(
        this.viewportEl,
        "touchmove",
        (e) => {
          const t = e.target;
          if (t?.closest?.(".mm-zoombar, .mm-minimap, .mm-search, .mm-toolbar, .mm-crumb, .mm-lightbox, .mm-present-bar")) return;
          if (pinch && e.touches.length === 2) {
            e.preventDefault();
            const [a, b] = [e.touches[0], e.touches[1]];
            const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            if (pinch.d > 0 && d > 0) {
              const r2 = this.viewportEl.getBoundingClientRect();
              this.setScale(
                pinch.s * (d / pinch.d),
                (a.clientX + b.clientX) / 2 - r2.left,
                (a.clientY + b.clientY) / 2 - r2.top
              );
            }
            return;
          }
          if (!this.drag || e.touches.length !== 1) return;
          const one = e.touches[0];
          const dx = one.clientX - this.drag.x;
          const dy = one.clientY - this.drag.y;
          if (!tAxis) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            tAxis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          }
          if (tAxis !== "x") return;
          e.preventDefault();
          this.tx = this.drag.tx + dx;
          this.ty = this.drag.ty + dy;
          this.updateTransform();
        },
        { passive: false }
      );
      const endTouch = (e) => {
        if (e.touches.length === 0) {
          pinch = null;
          tAxis = null;
          this.drag = null;
        } else if (e.touches.length === 1 && pinch) {
          pinch = null;
          tAxis = null;
          this.drag = null;
        }
      };
      on(this.viewportEl, "touchend", endTouch, { passive: true });
      on(this.viewportEl, "touchcancel", endTouch, { passive: true });
      on(this.viewportEl, "dblclick", (e) => {
        if (e.target.closest(".mm-node")) return;
        this.fit();
      });
      on(this.viewportEl, "click", (e) => {
        const t = e.target;
        if (t.closest(".mm-node") || t.closest(".mm-zoombar") || t.closest(".mm-minimap") || t.closest(".mm-present-bar") || t.closest(".mm-batch"))
          return;
        this.clearSelection();
      });
      on(this.minimapEl, "mousedown", (e) => this.onMinimapDown(e));
      on(this.rootEl, "mouseover", (e) => {
        const t = e.target?.closest?.("[data-mm-tip]");
        if (t) this.showTip(t);
      });
      on(this.rootEl, "mouseout", (e) => {
        const from = e.target?.closest?.("[data-mm-tip]");
        if (!from) return;
        const to = e.relatedTarget?.closest?.("[data-mm-tip]");
        if (to !== from) this.hideTip();
      });
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => {
          if (!this.tree || this.destroyed) return;
          if (this.resizeViewport(this.worldH) && this.options.autoFit) this.fit({ readable: true });
          else this.refreshMinimap();
        });
        ro.observe(document.body);
        ro.observe(this.rootEl);
        this.disposers.push(() => ro.disconnect());
      }
    }
  };

  // tests/visual.ts
  var seq = 0;
  var nid = () => `20260919${String(++seq).padStart(10, "0")}`;
  function buildList(specs, subtype) {
    const list = document.createElement("div");
    list.className = "list";
    list.dataset.nodeId = nid();
    list.dataset.subtype = subtype;
    for (const spec of specs) {
      const li = document.createElement("div");
      li.className = "li";
      li.dataset.nodeId = nid();
      if (spec.done) li.classList.add("protyle-task--done");
      if (spec.task) li.classList.add("protyle-task--undone");
      const action = document.createElement("div");
      action.className = "protyle-action";
      li.appendChild(action);
      const content = document.createElement("div");
      content.className = "p";
      content.dataset.nodeId = nid();
      content.textContent = spec.text;
      li.appendChild(content);
      if (spec.children?.length) li.appendChild(buildList(spec.children, subtype));
      list.appendChild(li);
    }
    return list;
  }
  var CONTENT = [
    {
      text: "\u5927\u7EB2\u5BFC\u56FE\u63D2\u4EF6",
      children: [
        {
          text: "\u6E32\u67D3\u5185\u6838",
          children: [
            { text: "tidy-tree \u5E03\u5C40\u5F15\u64CE\uFF0C\u652F\u6301\u4E09\u79CD\u7ED3\u6784" },
            { text: "SVG \u753B\u8FDE\u7EBF + HTML \u753B\u8282\u70B9" },
            {
              text: "\u4E3B\u5E72\u6C47\u805A\u7684\u8FDE\u7EBF\u5F62\u6001",
              children: [{ text: "\u7236\u8282\u70B9\u5F15\u51FA\u7C97\u4E3B\u5E72" }, { text: "\u6CBF\u810A\u5206\u53C9\u6210\u7EC6\u652F\u7EBF" }]
            }
          ]
        },
        {
          text: "\u4EA4\u4E92",
          children: [
            { text: "\u65B9\u5411\u952E\u5728\u8282\u70B9\u95F4\u5BFC\u822A" },
            { text: "Tab \u52A0\u5B50\u8282\u70B9\u3001Enter \u52A0\u540C\u7EA7" },
            { text: "F2 \u6539\u540D\u5E76\u5199\u56DE\u601D\u6E90\u5757" }
          ]
        },
        {
          text: "\u89C6\u89C9",
          children: [
            { text: "\u56DB\u5C42\u8282\u70B9\u5C42\u7EA7\u4F53\u7CFB" },
            { text: "\u516D\u5957\u4E3B\u9898\uFF0C\u542B\u9AD8\u5BF9\u6BD4\u5EA6" }
          ]
        }
      ]
    }
  ];
  var ORDERED = [
    {
      text: "\u9A8C\u6536\u6E05\u5355",
      children: [
        { text: "\u8282\u70B9\u6587\u5B57\u4E0D\u518D\u9010\u5B57\u7AD6\u6392", children: [{ text: "\u4E2D\u6587\u6309\u5185\u5BB9\u81EA\u9002\u5E94\u5BBD\u5EA6" }] },
        { text: "\u5BFC\u56FE\u94FA\u6EE1\u753B\u5E03", children: [{ text: "\u4E0D\u518D\u7F29\u5728\u4E2D\u592E\u4E00\u5C0F\u5757" }] },
        { text: "\u6298\u53E0\u6309\u94AE\u7A33\u5B9A\u8D34\u5728\u4E3B\u5E72\u4E0A" }
      ]
    }
  ];
  var TASKS = [
    {
      text: "\u5F85\u529E",
      task: true,
      children: [
        { text: "\u4FEE\u590D\u8282\u70B9\u5BBD\u5EA6\u574D\u7F29", task: true, done: true },
        { text: "\u63A5\u5165\u952E\u76D8\u5FEB\u6377\u952E", task: true, done: true },
        { text: "\u771F\u673A\u9A8C\u6536", task: true }
      ]
    }
  ];
  function newRecorder() {
    return {
      actions: [],
      folds: [],
      renames: [],
      layouts: [],
      locateIds: [],
      fullscreen: 0,
      exits: 0,
      history: [],
      batch: [],
      marks: [],
      prefs: [],
      opened: [],
      editInSource: []
    };
  }
  var historyHandled = false;
  function writeFoldBack(id, folded) {
    const li = document.querySelector(`.li[data-node-id="${id}"]`);
    if (!li) return;
    if (folded) li.setAttribute("fold", "1");
    else li.removeAttribute("fold");
  }
  function mount(host2, specs, subtype, title, patch, mode = "inline") {
    const wrap = document.createElement("div");
    wrap.className = "protyle-wysiwyg";
    const list = buildList(specs, subtype);
    wrap.appendChild(list);
    host2.appendChild(wrap);
    const rec = newRecorder();
    const config = { ...DEFAULT_CONFIG, ...patch };
    const view = new MindMapView(
      list,
      config,
      // ⚠️ 第 3 个参数是 `() => ReadonlyMap<string, boolean>`（折叠覆盖表），
      //    不是早年的 `Set<string>`。产品代码改签名时这里没跟上 ——
      //    而 tsconfig 的 include 只有 `src/**`，本文件不在类型检查范围内，
      //    于是它静默烂掉：页面照样能渲染出导图，但 `report()` 之前就抛
      //    `this.getFoldOverlay is not a function`，`npm run visual` 只会
      //    干巴巴地说「页面上没有找到 #report」。
      //    验证页的写回是同步的，不存在「内核还没更新回来」的空窗，
      //    所以覆盖表恒空 —— 这正是它该有的样子（见 writeFoldBack 的注释）。
      () => /* @__PURE__ */ new Map(),
      {
        onFoldChange: (id, folded) => {
          rec.folds.push({ id, folded });
          writeFoldBack(id, folded);
        },
        onLocate: (id) => void rec.locateIds.push(id),
        onEditInSource: (node) => void rec.editInSource.push(node.id ?? ""),
        onExit: () => void (rec.exits += 1),
        onLayoutChange: (k) => void rec.layouts.push(k),
        onFullscreen: () => void (rec.fullscreen += 1),
        onRename: (node, text) => void rec.renames.push({ id: node.id ?? "", text }),
        onNodeAction: (kind, node) => void rec.actions.push({ kind, text: node.text }),
        onBatchAction: (kind, nodes) => void rec.batch.push(`${kind}\xD7${nodes.length}`),
        onViewPrefs: (prefs) => void rec.prefs.push(prefs),
        onOpenBlock: (id) => void rec.opened.push(id),
        onMarkChange: (node, mark) => void rec.marks.push(
          `${node.id ?? ""}=${mark ? mark.icon || mark.label || mark.color || "?" : "null"}`
        ),
        onHistory: (redo) => {
          rec.history.push(redo ? "redo" : "undo");
          return historyHandled;
        }
      },
      title,
      mode
    );
    if (mode === "dialog") {
      const layer = document.createElement("div");
      layer.className = "mm-test-dialog";
      wrap.appendChild(layer);
      view.mount(layer);
    } else {
      view.mount();
    }
    return { view, rec };
  }
  var host = document.getElementById("app");
  var views = [];
  var recs = [];
  var push = (m) => {
    views.push(m.view);
    recs.push(m.rec);
  };
  push(mount(host, CONTENT, "u", "\u5927\u7EB2\u5BFC\u56FE\u63D2\u4EF6", { theme: "deep", layout: "logic", edge: "curve" }));
  push(mount(host, ORDERED, "o", "\u9A8C\u6536\u6E05\u5355", { theme: "paper", layout: "mind", edge: "curve" }));
  push(mount(host, TASKS, "t", "\u5F85\u529E", { theme: "contrast", layout: "tree", edge: "elbow" }));
  function keyboardProbe() {
    const view = views[0];
    const rec = recs[0];
    const root = view.element;
    const out = [];
    const check = (name, ok, detail = "") => void out.push({ name, ok, detail });
    const selTexts = () => Array.from(root.querySelectorAll(".mm-node.mm-sel")).map(
      (e) => e.querySelector(".mm-txt")?.textContent ?? ""
    );
    const selCount = () => root.querySelectorAll(".mm-node.mm-sel, .mm-node.mm-multi").length;
    const nodeByDepth0 = () => root.querySelector(".mm-node.mm-d0");
    function pressOn(target, key, opts = {}) {
      let leaked = false;
      const spy = () => void (leaked = true);
      document.addEventListener("keydown", spy);
      const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
      target.dispatchEvent(ev);
      document.removeEventListener("keydown", spy);
      return { prevented: ev.defaultPrevented, leaked };
    }
    const press = (key, opts = {}) => pressOn(root, key, opts);
    const clearSel = () => void press("Escape");
    const focusRoot = () => {
      clearSel();
      press("ArrowRight");
    };
    clearSel();
    nodeByDepth0()?.click();
    check("\u5355\u51FB\u8282\u70B9\u8FDB\u5165\u9009\u4E2D\u6001", selTexts().join() === "\u5927\u7EB2\u5BFC\u56FE\u63D2\u4EF6", `\u9009\u4E2D=${JSON.stringify(selTexts())}`);
    press("ArrowRight");
    check("\u2192 \u8D70\u5230\u7B2C\u4E00\u4E2A\u5B50\u8282\u70B9", selTexts().join() === "\u6E32\u67D3\u5185\u6838", `\u9009\u4E2D=${JSON.stringify(selTexts())}`);
    press("ArrowDown");
    check("\u2193 \u8D70\u5230\u4E0B\u4E00\u4E2A\u540C\u7EA7", selTexts().join() === "\u4EA4\u4E92", `\u9009\u4E2D=${JSON.stringify(selTexts())}`);
    press("ArrowLeft");
    check("\u2190 \u56DE\u5230\u7236\u8282\u70B9", selTexts().join() === "\u5927\u7EB2\u5BFC\u56FE\u63D2\u4EF6", `\u9009\u4E2D=${JSON.stringify(selTexts())}`);
    rec.actions.length = 0;
    const rTab = press("Tab");
    check(
      "Tab \u52A0\u5B50\u8282\u70B9\u4E14\u4E0D\u56DE\u6F0F\u7ED9\u601D\u6E90",
      rTab.prevented && !rTab.leaked && rec.actions[0]?.kind === "insertChild",
      `prevented=${rTab.prevented} leaked=${rTab.leaked} action=${rec.actions[0]?.kind}`
    );
    rec.actions.length = 0;
    press("Enter");
    check("Enter \u52A0\u540C\u7EA7", rec.actions[0]?.kind === "insertSiblingAfter", `action=${rec.actions[0]?.kind}`);
    rec.actions.length = 0;
    const rSoft = press("Enter", { shiftKey: true });
    check(
      "Shift+Enter \u4E0D\u8BEF\u52A0\u540C\u7EA7\u3001\u4E5F\u4E0D\u5916\u6CC4",
      rec.actions.length === 0 && rSoft.prevented && !rSoft.leaked,
      `action \u6570=${rec.actions.length} prevented=${rSoft.prevented} leaked=${rSoft.leaked}`
    );
    rec.actions.length = 0;
    press("Tab", { shiftKey: true });
    check("Shift+Tab \u964D\u7EA7", rec.actions[0]?.kind === "outdent", `action=${rec.actions[0]?.kind}`);
    rec.actions.length = 0;
    press("ArrowRight", { altKey: true });
    check("Alt+\u2192 \u5347\u7EA7", rec.actions[0]?.kind === "indent", `action=${rec.actions[0]?.kind}`);
    rec.actions.length = 0;
    const rMove = press("ArrowUp", { ctrlKey: true });
    check(
      "Ctrl+\u2191 \u4E0A\u79FB\u540C\u7EA7",
      rec.actions[0]?.kind === "moveUp" && rMove.prevented,
      `action=${rec.actions[0]?.kind}`
    );
    rec.folds.length = 0;
    press(" ");
    const foldedOnce = rec.folds[0]?.folded === true;
    press(" ");
    check(
      "\u7A7A\u683C\u5207\u6362\u6298\u53E0",
      foldedOnce && rec.folds[1]?.folded === false,
      `\u5E8F\u5217=${JSON.stringify(rec.folds.map((f) => f.folded))}`
    );
    focusRoot();
    press("ArrowRight");
    press("a", { ctrlKey: true });
    check("Ctrl+A \u9009\u4E2D\u540C\u7EA7", selCount() === 3, `\u9009\u4E2D\u6570=${selCount()}`);
    press("Escape");
    check("Esc \u9010\u7EA7\u6E05\u7A7A\u9009\u4E2D", selCount() === 0 && selTexts().length === 0, `\u9009\u4E2D\u6570=${selCount()}`);
    const passthrough = [
      ["Ctrl+S", "s", { ctrlKey: true }],
      ["Ctrl+P", "p", { ctrlKey: true }],
      ["F5", "F5", {}],
      ["F12", "F12", {}]
    ];
    for (const [label, key, init] of passthrough) {
      const r2 = press(key, init);
      check(`${label} \u653E\u884C\u7ED9\u601D\u6E90`, !r2.prevented && r2.leaked, `prevented=${r2.prevented} leaked=${r2.leaked}`);
    }
    focusRoot();
    historyHandled = false;
    for (const [label, key] of [
      ["Ctrl+Z", "z"],
      ["Ctrl+Y", "y"]
    ]) {
      const r2 = press(key, { ctrlKey: true });
      check(`${label} \u63D2\u4EF6\u6808\u7A7A\u65F6\u653E\u884C\u7ED9\u601D\u6E90`, !r2.prevented && r2.leaked, `prevented=${r2.prevented} leaked=${r2.leaked}`);
    }
    historyHandled = true;
    const rUndo = press("z", { ctrlKey: true });
    check("Ctrl+Z \u63D2\u4EF6\u6709\u53EF\u64A4\u9500\u64CD\u4F5C\u65F6\u88AB\u63A5\u7BA1", rUndo.prevented && !rUndo.leaked, `prevented=${rUndo.prevented} leaked=${rUndo.leaked}`);
    check("Ctrl+Z \u628A redo=false \u4EA4\u7ED9\u626B\u63CF\u5668", rec.history.at(-1) === "undo", JSON.stringify(rec.history));
    const rRedo = press("y", { ctrlKey: true });
    check("Ctrl+Y \u63D2\u4EF6\u6709\u53EF\u91CD\u505A\u64CD\u4F5C\u65F6\u88AB\u63A5\u7BA1", rRedo.prevented && !rRedo.leaked, `prevented=${rRedo.prevented} leaked=${rRedo.leaked}`);
    check("Ctrl+Y \u628A redo=true \u4EA4\u7ED9\u626B\u63CF\u5668", rec.history.at(-1) === "redo", JSON.stringify(rec.history));
    const rShiftZ = press("z", { ctrlKey: true, shiftKey: true });
    check("Ctrl+Shift+Z \u6309\u91CD\u505A\u5904\u7406", rShiftZ.prevented && rec.history.at(-1) === "redo", JSON.stringify(rec.history));
    historyHandled = false;
    focusRoot();
    const rFind = press("f", { ctrlKey: true });
    const searchOn = root.querySelector(".mm-search")?.classList.contains("mm-search--on") ?? false;
    check("Ctrl+F \u6253\u5F00\u641C\u7D22\u4E14\u62E6\u4E0B\u6309\u952E", rFind.prevented && searchOn, `prevented=${rFind.prevented} open=${searchOn}`);
    press("Escape");
    check(
      "Esc \u5173\u95ED\u641C\u7D22",
      !(root.querySelector(".mm-search")?.classList.contains("mm-search--on") ?? true),
      "\u641C\u7D22\u6846\u5DF2\u6536\u8D77"
    );
    press("1", { ctrlKey: true });
    const zoomTxt = root.querySelector(".mm-zoombar")?.textContent ?? "";
    check("Ctrl+1 \u56DE\u5230 100%", zoomTxt.includes("100%"), `\u7F29\u653E\u6807\u7B7E=${zoomTxt}`);
    focusRoot();
    press("F2");
    const editTxt = root.querySelector('.mm-txt[contenteditable="true"]');
    check("F2 \u8FDB\u5165\u6539\u540D\u7F16\u8F91\u6001", !!editTxt, `contenteditable \u6570=${root.querySelectorAll('[contenteditable="true"]').length}`);
    if (editTxt) {
      const selBefore = selTexts().join();
      const rArrow = pressOn(editTxt, "ArrowLeft");
      check(
        "\u7F16\u8F91\u6001\u4E0B\u65B9\u5411\u952E\u4E0D\u62A2",
        !rArrow.prevented && selTexts().join() === selBefore,
        `prevented=${rArrow.prevented} \u9009\u4E2D\u672A\u53D8=${selTexts().join() === selBefore}`
      );
      const rEsc = pressOn(editTxt, "Escape");
      check(
        "Esc \u9000\u51FA\u7F16\u8F91\u6001\u4E14\u4E0D\u5916\u6CC4",
        rEsc.prevented && !rEsc.leaked && !root.querySelector('[contenteditable="true"]'),
        `prevented=${rEsc.prevented} leaked=${rEsc.leaked}`
      );
    } else {
      check("\u7F16\u8F91\u6001\u4E0B\u65B9\u5411\u952E\u4E0D\u62A2", false, "\u672A\u8FDB\u5165\u7F16\u8F91\u6001\uFF0C\u8DF3\u8FC7");
      check("Esc \u9000\u51FA\u7F16\u8F91\u6001\u4E14\u4E0D\u5916\u6CC4", false, "\u672A\u8FDB\u5165\u7F16\u8F91\u6001\uFF0C\u8DF3\u8FC7");
    }
    clearSel();
    press("ArrowRight");
    check("\u65E0\u9009\u4E2D\u65F6 \u2192 \u628A\u7126\u70B9\u9001\u5230\u6839\u8282\u70B9", selTexts().join() === "\u5927\u7EB2\u5BFC\u56FE\u63D2\u4EF6", `\u9009\u4E2D=${JSON.stringify(selTexts())}`);
    const btns = Array.from(root.querySelectorAll(".mm-toolbar button"));
    check(
      "\u5DE5\u5177\u680F\u6309\u94AE\u5168\u90E8\u53EF Tab \u5230\u8FBE",
      btns.length > 0 && btns.every((b) => b.tabIndex >= 0 || b.tagName === "BUTTON"),
      `\u6309\u94AE\u6570=${btns.length}`
    );
    check(
      "\u5DE5\u5177\u680F\u6309\u94AE\u90FD\u6709 tooltip \u4E0E\u5FEB\u6377\u952E\u6807\u6CE8",
      btns.every((b) => !!b.dataset.mmTip),
      `\u7F3A tooltip \u7684\u6309\u94AE\u6570=${btns.filter((b) => !b.dataset.mmTip).length}`
    );
    focusRoot();
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowRight");
    check("\u6536\u5C3E\u4FDD\u7559\u9009\u4E2D\u6001\u4F9B\u622A\u56FE", selTexts().length === 1, `\u9009\u4E2D=${JSON.stringify(selTexts())}`);
    return out;
  }
  function report() {
    const out = [];
    views.forEach((view, i) => {
      const root = view.element;
      const nodes = Array.from(root.querySelectorAll(".mm-node"));
      const widths = nodes.map((n) => Math.round(n.getBoundingClientRect().width));
      const heights = nodes.map((n) => Math.round(n.getBoundingClientRect().height));
      const edges = Array.from(root.querySelectorAll(".mm-edges path"));
      const dAttrs = edges.map((p) => p.getAttribute("d") ?? "");
      const widths2 = edges.map((p) => Number(p.getAttribute("stroke-width")));
      const strokes = edges.map((p) => p.getAttribute("stroke") ?? "");
      const scroll = root.querySelector(".mm-viewport");
      const world = root.querySelector(".mm-world");
      const leftward = dAttrs.filter((d) => {
        const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
        return n.length >= 3 && n[2] < n[0];
      }).length;
      out.push({
        view: i,
        nodes: nodes.length,
        minNodeWidth: Math.min(...widths),
        maxNodeWidth: Math.max(...widths),
        minNodeHeight: Math.min(...heights),
        tallestNode: Math.max(...heights),
        // 逐字竖排的典型特征：宽度很小但高度很高
        collapsed: nodes.filter((n) => n.getBoundingClientRect().width < 30).length,
        edges: edges.length,
        leftward,
        maxStroke: Math.max(...widths2),
        minStroke: Math.min(...widths2),
        opaque: strokes.every((s) => s.startsWith("rgb(")),
        world: world ? `${world.style.width} x ${world.style.height}` : "",
        viewportH: scroll?.clientHeight ?? 0,
        toolbarBtns: root.querySelectorAll(".mm-toolbar button").length,
        zoomBtns: root.querySelectorAll(".mm-zoombar button").length,
        hoverActions: root.querySelectorAll(".mm-acts").length,
        toggles: root.querySelectorAll(".mm-toggle").length,
        tabIndex: root.tabIndex,
        // 折叠按钮：文字、尺寸、算出来的颜色都得对，否则会退化成一个空圈
        toggleInfo: Array.from(root.querySelectorAll(".mm-toggle")).map((t) => {
          const cs = getComputedStyle(t);
          const r2 = t.getBoundingClientRect();
          const host2 = t.parentElement;
          const hr = host2?.getBoundingClientRect();
          return {
            text: t.textContent ?? "",
            size: `${Math.round(r2.width)}x${Math.round(r2.height)}`,
            color: cs.color,
            bg: cs.backgroundColor,
            border: cs.borderTopColor,
            fs: cs.fontSize,
            nodeCls: (host2?.className ?? "").replace(/mm-node\s*/, ""),
            solid: host2 ? getComputedStyle(host2).getPropertyValue("--c-solid").trim() : "",
            // 用来验证「贴在主干上、不压节点边」
            rect: [r2.left, r2.top, r2.right, r2.bottom].map(Math.round),
            hostRect: hr ? [hr.left, hr.top, hr.right, hr.bottom].map(Math.round) : null
          };
        }),
        canvasSolid: getComputedStyle(root).getPropertyValue("--mm-canvas-solid").trim(),
        // 排查折叠按钮配色被谁覆盖
        toggleColorRules: colorRules(
          Array.from(root.querySelectorAll(".mm-toggle")).find(
            (t) => !t.parentElement?.classList.contains("mm-d0")
          ) ?? null
        ),
        // 节点内允许出现的子元素：.mm-inner / .mm-toggle / .mm-acts。
        // 出现别的东西就说明有元素画错地方了。
        strayInNodes: (() => {
          const allowed = /* @__PURE__ */ new Set(["mm-inner", "mm-toggle", "mm-acts"]);
          const stray = [];
          for (const n of nodes) {
            for (const c of Array.from(n.children)) {
              const cls = c.className || "";
              if (!String(cls).split(/\s+/).some((x) => allowed.has(x))) stray.push(cls);
            }
          }
          return stray;
        })(),
        // 悬停按钮默认必须完全不可见，否则会在每个节点边上留一堆小图标
        actsHidden: Array.from(root.querySelectorAll(".mm-acts")).every((a) => {
          const cs = getComputedStyle(a);
          return cs.visibility === "hidden" || Number(cs.opacity) === 0;
        })
      });
    });
    return { views: out, keyboard: keyboardProbe(), callbacks: summarizeCallbacks() };
  }
  function summarizeCallbacks() {
    return recs.map((r2, i) => ({
      view: i,
      actions: r2.actions.map((a) => a.kind),
      folds: r2.folds.map((f) => f.folded),
      renames: r2.renames.length,
      layouts: r2.layouts,
      locateIds: r2.locateIds.length,
      fullscreen: r2.fullscreen,
      exits: r2.exits,
      history: r2.history,
      batch: r2.batch,
      marks: r2.marks,
      prefs: r2.prefs,
      opened: r2.opened,
      editInSource: r2.editInSource
    }));
  }
  function colorRules(el) {
    if (!el) return [];
    const out = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        const r2 = rule;
        if (!r2.selectorText || !r2.style) continue;
        if (!r2.style.getPropertyValue("color")) continue;
        try {
          if (el.matches(r2.selectorText)) out.push(`${r2.selectorText} \u2192 ${r2.style.getPropertyValue("color")}`);
        } catch {
        }
      }
    }
    return out;
  }
  var pre = document.createElement("pre");
  pre.id = "report";
  pre.style.cssText = "display:none";
  pre.textContent = JSON.stringify(report());
  document.body.appendChild(pre);
  window.__mm = {
    views,
    set(i, patch) {
      views[i].setOptions(patch);
    },
    /** 直接设缩放，用来验证高倍放大时文字是否还清晰 */
    zoom(i, s) {
      views[i].setScale(s);
    }
  };
  {
    const p = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (p.has("zoomto")) {
      const s = Number(p.get("zoomto"));
      const i = Number(p.get("view") ?? 0);
      const apply = () => {
        if (!views[i]) return;
        views[i].setScale(s);
      };
      apply();
      window.addEventListener("load", () => window.setTimeout(apply, 60));
    }
  }
})();
