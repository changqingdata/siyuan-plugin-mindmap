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
    persistFold: true,
    autoFit: true,
    editable: true,
    draggable: true,
    lazyRender: true,
    keyboard: true,
    flipAnimation: true,
    minimap: true,
    compactThreshold: 400,
    hardLimit: 2e3
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
  function resolveTheme(id, dark = isDarkMode()) {
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

  // src/core/parser.ts
  var ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
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
      if (!text && children.length === 0) continue;
      items.push({
        id: li.dataset.nodeId ?? "",
        contentId: contentEl?.dataset.nodeId ?? "",
        listId: ownerListId,
        subListId: subList?.dataset.nodeId ?? "",
        html: html || escapeHtml(text),
        text,
        kind,
        checked: li.classList.contains("protyle-task--done") ? true : void 0,
        folded: false,
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
  function sanitizeInline(html) {
    return html.replace(ZERO_WIDTH, "").replace(/\scontenteditable="[^"]*"/g, "").replace(/\sspellcheck="[^"]*"/g, "").replace(/\sdata-render="[^"]*"/g, "").replace(/\sclass="protyle-wysiwyg--select"/g, "").trim();
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

  // src/core/layout.ts
  function layout(root, opt) {
    const { mode, gapX, gapY, padX, padY } = opt;
    const isTree = mode === "tree";
    const crossSelf = (n) => isTree ? n.w : n.h;
    const depthSelf = (n) => isTree ? n.h : n.w;
    function measure(n) {
      n.kids = n.folded ? [] : n.children;
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
    const { parent, kids, mode, style, gap, base } = input;
    if (kids.length === 0) return [];
    const trunk = Math.max(MIN_TRUNK, Math.min(gap * 0.44, MAX_TRUNK));
    const spineW = Math.max(1, base * 0.75);
    const stubW = Math.max(1, base * 0.5);
    const radius = Math.max(3, Math.min(trunk * 0.5, MAX_RADIUS));
    return mode === "tree" ? vertical(parent, kids, style, trunk, base, spineW, stubW, radius) : horizontal(parent, kids, style, trunk, base, spineW, stubW, radius);
  }
  function vertical(parent, kids, style, trunk, base, spineW, stubW, radius) {
    const px = parent.x + parent.w / 2;
    const py = parent.y + parent.h;
    const out = [];
    if (style === "straight") {
      kids.forEach((k, i) => {
        out.push({ d: `M${r(px)},${r(py)} L${r(k.x + k.w / 2)},${r(k.y)}`, width: stubW, kind: "stub", childIndex: i });
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
        out.push({ d: `M${r(kx)},${r(sy)} L${r(kx)},${r(ky)}`, width: stubW, kind: "stub", childIndex: i });
      } else {
        const x0 = kx - dx * radius;
        out.push({
          d: `M${r(x0)},${r(sy)} Q${r(kx)},${r(sy)} ${r(kx)},${r(sy + radius)} L${r(kx)},${r(ky)}`,
          width: stubW,
          kind: "stub",
          childIndex: i
        });
      }
    });
    return out;
  }
  function horizontal(parent, kids, style, trunk, base, spineW, stubW, radius) {
    const out = [];
    const groups = /* @__PURE__ */ new Map();
    for (const k of kids) {
      const list = groups.get(k.dir);
      if (list) list.push(k);
      else groups.set(k.dir, [k]);
    }
    for (const [dir, group] of groups) {
      const px = dir === 1 ? parent.x + parent.w : parent.x;
      const py = parent.y + parent.h / 2;
      if (style === "straight") {
        group.forEach((k, i) => {
          const kx = dir === 1 ? k.x : k.x + k.w;
          out.push({
            d: `M${r(px)},${r(py)} L${r(kx)},${r(k.y + k.h / 2)}`,
            width: stubW,
            kind: "stub",
            childIndex: i
          });
        });
        continue;
      }
      const sx = px + dir * trunk;
      const cys = group.map((k) => k.y + k.h / 2);
      out.push({ d: `M${r(px)},${r(py)} L${r(sx)},${r(py)}`, width: base, kind: "trunk", childIndex: null });
      out.push({
        d: `M${r(sx)},${r(Math.min(py, ...cys))} L${r(sx)},${r(Math.max(py, ...cys))}`,
        width: spineW,
        kind: "spine",
        childIndex: null
      });
      group.forEach((k, i) => {
        const kx = dir === 1 ? k.x : k.x + k.w;
        const ky = k.y + k.h / 2;
        const dy = Math.sign(ky - py);
        if (style === "elbow" || dy === 0 || Math.abs(ky - py) < radius * 1.2) {
          out.push({ d: `M${r(sx)},${r(ky)} L${r(kx)},${r(ky)}`, width: stubW, kind: "stub", childIndex: i });
        } else {
          const y0 = ky - dy * radius;
          out.push({
            d: `M${r(sx)},${r(y0)} Q${r(sx)},${r(ky)} ${r(sx + dir * radius)},${r(ky)} L${r(kx)},${r(ky)}`,
            width: stubW,
            kind: "stub",
            childIndex: i
          });
        }
      });
    }
    return out;
  }

  // src/generated/style.ts
  var PLUGIN_CSS = '/* ============================================================================\n   \u5927\u7EB2\u5BFC\u56FE (siyuan-plugin-mindmap)\n   ----------------------------------------------------------------------------\n   \u7EA6\u5B9A\uFF1A\u6240\u6709\u9009\u62E9\u5668\u90FD\u6302\u5728 .mm-root \u4E4B\u4E0B\uFF0C\u7981\u6B62\u88F8\u6807\u7B7E\u9009\u62E9\u5668\uFF0C\u907F\u514D\u6C61\u67D3\u6B63\u6587\u3002\n   \u989C\u8272\u53EA\u901A\u8FC7 --mm-* \u4E0E --c-* \u81EA\u5B9A\u4E49\u5C5E\u6027\u6CE8\u5165\uFF0C\u4E0D\u76F4\u63A5\u5F15\u7528\u601D\u6E90\u7684 --b3-* \u53D8\u91CF\uFF0C\n   \u8FD9\u6837\u5BFC\u51FA SVG \u65F6\u628A\u53D8\u91CF\u89E3\u6790\u6210\u5177\u4F53\u503C\u5373\u53EF\u5B8C\u6574\u8FD8\u539F\u5916\u89C2\u3002\n\n   \u6CE8\u610F\uFF1A.mm-node \u5FC5\u987B\u7528 width: max-content\u3002\n   \u5B83\u548C .mm-world / .mm-nodes \u90FD\u662F\u7EDD\u5BF9\u5B9A\u4F4D\uFF0C\u82E5\u7528 width: auto \u4F1A\u9000\u5316\u6210\n   shrink-to-fit\uFF0C\u800C .mm-nodes \u6CA1\u6709\u5728\u6D41\u5B50\u5143\u7D20 \u2192 \u53EF\u7528\u5BBD\u5EA6 0 \u2192 \u8282\u70B9\u5BBD\u5EA6\u574D\u7F29\u6210\n   \u4E00\u4E2A\u6C49\u5B57\u5BBD\uFF0C\u4E2D\u6587\u4F1A\u9010\u5B57\u7AD6\u6392\u3002max-content \u76F4\u63A5\u7ED5\u8FC7\u8FD9\u6761\u94FE\u8DEF\u3002\n   ============================================================================ */\n\n/* ---------------------------------------------------------------- \u6E90\u5217\u8868\u9690\u85CF */\n\n.mm-source-hidden {\n    padding: 0 !important;\n    margin: 0 !important;\n    background: transparent !important;\n    border: 0 !important;\n}\n\n.mm-source-hidden > :not(.mm-root) {\n    display: none !important;\n}\n\n/* \u300C\u8282\u70B9\u8FC7\u591A\u300D\u63D0\u793A\u6001\uFF1A\u53EA\u4FDD\u7559\u63D0\u793A\u6761 */\n.mm-notice-mode > :not(.mm-notice) {\n    display: none !important;\n}\n\n.mm-notice {\n    display: flex;\n    align-items: center;\n    gap: 10px;\n    flex-wrap: wrap;\n    padding: 10px 12px;\n    margin: 4px 0;\n    border-radius: 8px;\n    border: 1px dashed var(--b3-border-color, rgba(128, 128, 128, 0.4));\n    background: var(--b3-theme-surface, rgba(127, 127, 127, 0.08));\n    color: var(--b3-theme-on-surface, inherit);\n    font-size: 13px;\n    line-height: 1.5;\n}\n\n/* -------------------------------------------------------------------- \u6839\u5BB9\u5668 */\n\n.mm-root {\n    position: relative;\n    display: flex;\n    flex-direction: column;\n    box-sizing: border-box;\n    margin: 8px 0;\n    border-radius: 12px;\n    overflow: hidden;\n    outline: none;\n    font-family: var(--mm-font, sans-serif);\n    color: var(--mm-node-text);\n    background-color: var(--mm-canvas-solid);\n    background-image:\n        radial-gradient(circle, var(--mm-canvas-grid) 1.2px, transparent 1.2px),\n        var(--mm-canvas-bg);\n    background-size: 22px 22px, auto;\n    background-position: 0 0, 0 0;\n}\n\n.mm-root.mm-root--dialog {\n    margin: 0;\n    height: 100%;\n    border-radius: 0;\n}\n\n.mm-dialog-body {\n    height: 100%;\n    overflow: hidden;\n}\n\n/* -------------------------------------------------------------------- \u5DE5\u5177\u6761 */\n\n.mm-root .mm-toolbar {\n    display: flex;\n    flex-wrap: wrap;\n    align-items: center;\n    gap: 4px;\n    flex: 0 0 auto;\n    padding: 6px 10px;\n    border-bottom: 1px solid var(--mm-node-border);\n    background: color-mix(in srgb, var(--mm-canvas-solid) 82%, transparent);\n    user-select: none;\n    z-index: 5;\n}\n\n.mm-root .mm-spacer {\n    flex: 1 1 auto;\n}\n\n.mm-root .mm-group {\n    display: flex;\n    align-items: center;\n    gap: 2px;\n}\n\n.mm-root .mm-sep {\n    width: 1px;\n    height: 16px;\n    margin: 0 5px;\n    background: var(--mm-node-border);\n    flex: 0 0 auto;\n}\n\n.mm-root .mm-toolbar button {\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    gap: 5px;\n    font-family: inherit;\n    font-size: 12px;\n    line-height: 1;\n    padding: 5px 9px;\n    border-radius: 6px;\n    border: 1px solid transparent;\n    background: transparent;\n    color: var(--mm-node-text);\n    cursor: pointer;\n    white-space: nowrap;\n    transition: background 0.15s, border-color 0.15s, color 0.15s;\n}\n\n.mm-root .mm-toolbar button:hover {\n    background: color-mix(in srgb, var(--mm-node-text) 12%, transparent);\n}\n\n.mm-root .mm-toolbar button:active {\n    transform: translateY(1px);\n}\n\n.mm-root .mm-toolbar button.mm-icon {\n    padding: 5px 7px;\n}\n\n.mm-root .mm-toolbar button svg {\n    width: 13px;\n    height: 13px;\n    flex: 0 0 auto;\n    display: block;\n}\n\n/* \u5E03\u5C40\u5207\u6362\uFF1A\u5206\u6BB5\u63A7\u4EF6 */\n.mm-root .mm-seg {\n    display: flex;\n    gap: 2px;\n    padding: 2px;\n    border-radius: 8px;\n    background: color-mix(in srgb, var(--mm-node-text) 9%, transparent);\n}\n\n.mm-root .mm-seg button {\n    border: 0;\n    background: transparent;\n    padding: 5px 10px;\n}\n\n.mm-root .mm-seg button.mm-on {\n    background: var(--mm-accent);\n    color: #ffffff;\n    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);\n}\n\n.mm-root .mm-seg button.mm-on:hover {\n    background: var(--mm-accent);\n}\n\n.mm-root .mm-zoom-label {\n    min-width: 42px;\n    text-align: center;\n    font-size: 11.5px;\n    opacity: 0.72;\n    font-variant-numeric: tabular-nums;\n}\n\n/* ---------------------------------------------------------------- \u81EA\u7ED8 tooltip */\n\n.mm-tip {\n    position: fixed;\n    z-index: 2147483000;\n    max-width: 260px;\n    padding: 5px 9px;\n    border-radius: 6px;\n    font-size: 12px;\n    line-height: 1.5;\n    pointer-events: none;\n    white-space: nowrap;\n    color: #ffffff;\n    background: rgba(18, 20, 26, 0.94);\n    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.34);\n    opacity: 0;\n    transition: opacity 0.12s ease;\n}\n\n.mm-tip.mm-tip--on {\n    opacity: 1;\n}\n\n.mm-tip kbd {\n    display: inline-block;\n    margin-left: 6px;\n    padding: 1px 5px;\n    border-radius: 4px;\n    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;\n    font-size: 11px;\n    color: #cfd6e4;\n    background: rgba(255, 255, 255, 0.13);\n}\n\n/* ---------------------------------------------------------------- \u753B\u5E03\u89C6\u53E3 */\n\n.mm-root .mm-viewport {\n    position: relative;\n    flex: 1 1 auto;\n    overflow: hidden;\n    cursor: grab;\n}\n\n.mm-root .mm-viewport.mm-grabbing {\n    cursor: grabbing;\n}\n\n.mm-root .mm-world {\n    position: absolute;\n    left: 0;\n    top: 0;\n    /*\n     * \u4E0D\u8981\u52A0 will-change: transform\u3002\n     * \u5B83\u4F1A\u628A .mm-world \u63D0\u5347\u6210\u72EC\u7ACB\u5408\u6210\u5C42\uFF0C\u800C\u5408\u6210\u5C42\u4E00\u65E6\u7F13\u5B58\u4E86\u4F4E\u5206\u8FA8\u7387\u4F4D\u56FE\uFF0C\n     * \u653E\u5927\u65F6\u6574\u68F5\u5B50\u6811\uFF08\u6587\u5B57 / \u63CF\u8FB9 / SVG \u8FDE\u7EBF\uFF09\u90FD\u4F1A\u4E00\u8D77\u53D8\u7CCA\u3002\n     * \u7F29\u653E\u4EA4\u7ED9 zoom \u505A\uFF08\u89C1 renderer.ts \u7684 updateTransform\uFF09\uFF0C\n     * transform \u53EA\u8D1F\u8D23\u5E73\u79FB \u2014\u2014 \u7EAF\u5E73\u79FB\u4E0D\u4F1A\u6539\u53D8\u6805\u683C\u5316\u500D\u7387\uFF0C\u4E0D\u5B58\u5728\u8FD9\u4E2A\u95EE\u9898\u3002\n     */\n    transform-origin: 0 0;\n}\n\n.mm-root .mm-edges {\n    position: absolute;\n    left: 0;\n    top: 0;\n    overflow: visible;\n    pointer-events: none;\n}\n\n.mm-root .mm-nodes {\n    position: absolute;\n    left: 0;\n    top: 0;\n}\n\n/* ---------------------------------------------------------------------- \u8282\u70B9 */\n\n.mm-root .mm-node {\n    /* \u5173\u952E\uFF1A\u7ED5\u8FC7 shrink-to-fit\uFF0C\u5426\u5219\u5BBD\u5EA6\u4F1A\u574D\u7F29\u5230\u4E00\u4E2A\u6C49\u5B57 */\n    width: max-content;\n    min-width: 52px;\n    position: absolute;\n    box-sizing: border-box;\n    border-radius: 8px;\n    cursor: pointer;\n    user-select: none;\n\n    /* \u5C42\u7EA7 token\uFF0C\u7531 .mm-d0 ~ .mm-d3 \u8986\u5199 */\n    --tier-font: 13px;\n    --tier-weight: 500;\n    --tier-pad-y: 8px;\n    --tier-pad-x: 13px;\n    --tier-radius: 8px;\n    --tier-stripe: 3px;\n    --tier-gap: 7px;\n}\n\n.mm-root .mm-node .mm-inner {\n    display: flex;\n    align-items: center;\n    gap: var(--tier-gap);\n    box-sizing: border-box;\n    padding: var(--tier-pad-y) var(--tier-pad-x);\n    border-radius: var(--tier-radius);\n    border: 1px solid transparent;\n    font-size: var(--tier-font);\n    font-weight: var(--tier-weight);\n    line-height: 1.45;\n    letter-spacing: 0.1px;\n}\n\n/* ---- \u5C42\u7EA7\u4F53\u7CFB\uFF1A\u4E2D\u5FC3\u4E3B\u9898 \u2192 \u4E00\u7EA7\u5206\u652F \u2192 \u4E8C\u7EA7 \u2192 \u4E09\u7EA7\u53CA\u4EE5\u4E0B ---- */\n\n/* d0 \u4E2D\u5FC3\u4E3B\u9898\uFF1A\u5B9E\u5FC3\u80F6\u56CA\uFF0C\u6700\u9AD8\u6743\u91CD */\n.mm-root .mm-d0 {\n    --tier-font: 16px;\n    --tier-weight: 600;\n    --tier-pad-y: 12px;\n    --tier-pad-x: 22px;\n    --tier-radius: 12px;\n    --tier-gap: 9px;\n}\n\n.mm-root .mm-d0 .mm-inner {\n    background: var(--mm-root-bg);\n    color: var(--mm-root-text);\n    border-color: transparent;\n    box-shadow: 0 6px 22px var(--mm-root-shadow);\n}\n\n/* d1 \u4E00\u7EA7\u5206\u652F\uFF1A\u5206\u652F\u8272\u6D45\u586B\u5145\u5361 */\n.mm-root .mm-d1 {\n    --tier-font: 14px;\n    --tier-weight: 600;\n    --tier-pad-y: 9px;\n    --tier-pad-x: 15px;\n    --tier-radius: 10px;\n}\n\n.mm-root .mm-d1 .mm-inner {\n    background: var(--c-bg);\n    border-color: var(--c-border);\n    color: var(--c-solid);\n    box-shadow: var(--mm-card-shadow);\n}\n\n/* d2 \u4E8C\u7EA7\uFF1A\u4E2D\u6027\u5361\u7247 + \u5DE6\u4FA7\u5206\u652F\u8272\u6761 */\n.mm-root .mm-d2 {\n    --tier-font: 13px;\n    --tier-weight: 500;\n    --tier-pad-y: 8px;\n    --tier-pad-x: 14px;\n}\n\n.mm-root .mm-d2 .mm-inner,\n.mm-root .mm-d3 .mm-inner,\n.mm-root .mm-d4 .mm-inner {\n    position: relative;\n    overflow: hidden;\n    background: var(--mm-node-bg);\n    border-color: var(--mm-node-border);\n    color: var(--mm-node-text);\n    box-shadow: var(--mm-card-shadow);\n}\n\n.mm-root .mm-d2 .mm-inner::before,\n.mm-root .mm-d3 .mm-inner::before,\n.mm-root .mm-d4 .mm-inner::before {\n    content: "";\n    position: absolute;\n    left: 0;\n    top: 0;\n    bottom: 0;\n    width: var(--tier-stripe);\n    background: var(--c-solid);\n    opacity: 0.85;\n}\n\n.mm-root .mm-d2 .mm-inner {\n    padding-left: calc(var(--tier-pad-x) + 4px);\n}\n\n/* d3+ \u66F4\u8F7B\uFF0C\u8272\u6761\u66F4\u7EC6 */\n.mm-root .mm-d3,\n.mm-root .mm-d4 {\n    --tier-font: 12.5px;\n    --tier-weight: 400;\n    --tier-pad-y: 6px;\n    --tier-pad-x: 12px;\n    --tier-stripe: 2px;\n}\n\n/* ---- \u72B6\u6001\uFF1A\u60AC\u505C / \u9009\u4E2D / \u5F31\u5316 ---- */\n\n.mm-root .mm-node:hover {\n    transform: translateY(-1px);\n    z-index: 6;\n}\n\n.mm-root .mm-node:hover .mm-inner {\n    box-shadow: 0 9px 26px var(--mm-hover-shadow);\n}\n\n.mm-root .mm-node.mm-sel {\n    z-index: 7;\n}\n\n.mm-root .mm-node.mm-sel .mm-inner {\n    box-shadow:\n        0 0 0 2px var(--mm-focus-ring, var(--mm-accent)),\n        0 10px 28px var(--mm-hover-shadow);\n}\n\n/* \u952E\u76D8\u7126\u70B9\u4E0E\u9F20\u6807\u9009\u4E2D\u533A\u5206\uFF1A\u952E\u76D8\u64CD\u4F5C\u65F6\u73AF\u66F4\u660E\u663E */\n.mm-root.mm-kbd .mm-node.mm-sel .mm-inner {\n    box-shadow:\n        0 0 0 2.5px var(--mm-focus-ring, var(--mm-accent)),\n        0 0 0 5px color-mix(in srgb, var(--mm-accent) 18%, transparent),\n        0 10px 28px var(--mm-hover-shadow);\n}\n\n.mm-root .mm-node.mm-dim {\n    opacity: 0.3;\n}\n\n/* \u641C\u7D22\u547D\u4E2D */\n.mm-root .mm-node.mm-hit .mm-inner {\n    box-shadow: 0 0 0 2px var(--mm-accent), 0 6px 20px var(--mm-hover-shadow);\n}\n\n.mm-root .mm-node.mm-hit-cur .mm-inner {\n    box-shadow:\n        0 0 0 2.5px var(--mm-accent),\n        0 0 0 6px color-mix(in srgb, var(--mm-accent) 22%, transparent),\n        0 6px 20px var(--mm-hover-shadow);\n}\n\n/* ------------------------------------------------------------------ \u8282\u70B9\u5185\u5BB9 */\n\n.mm-root .mm-txt {\n    min-width: 0;\n    /* \u7528 overflow-wrap \u800C\u4E0D\u662F word-break: break-word \u2014\u2014\n       \u540E\u8005\u7B49\u4EF7\u4E8E overflow-wrap: anywhere\uFF0C\u4F1A\u5F71\u54CD min-content \u5C3A\u5BF8\u3002 */\n    overflow-wrap: break-word;\n    max-width: 240px;\n}\n\n.mm-root .mm-txt p {\n    margin: 0;\n}\n\n.mm-root .mm-txt strong,\n.mm-root .mm-txt b,\n.mm-root .mm-txt [data-type="strong"] {\n    font-weight: 650;\n}\n\n.mm-root .mm-txt em,\n.mm-root .mm-txt i,\n.mm-root .mm-txt [data-type="em"] {\n    font-style: italic;\n}\n\n.mm-root .mm-txt u,\n.mm-root .mm-txt [data-type="u"] {\n    text-decoration: underline;\n    text-underline-offset: 2px;\n}\n\n.mm-root .mm-txt s,\n.mm-root .mm-txt [data-type="s"] {\n    text-decoration: line-through;\n}\n\n.mm-root .mm-txt code,\n.mm-root .mm-txt [data-type="code"] {\n    font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace;\n    font-size: 0.88em;\n    padding: 1px 5px;\n    border-radius: 4px;\n    background: color-mix(in srgb, var(--mm-node-text) 14%, transparent);\n}\n\n.mm-root .mm-txt mark,\n.mm-root .mm-txt [data-type="mark"] {\n    background: rgba(255, 196, 0, 0.32);\n    color: inherit;\n    border-radius: 3px;\n    padding: 0 2px;\n}\n\n.mm-root .mm-txt [data-type="block-ref"],\n.mm-root .mm-txt [data-type="a"] {\n    color: var(--c-solid);\n    text-decoration: underline;\n    text-underline-offset: 2px;\n    text-decoration-style: dotted;\n    cursor: pointer;\n}\n\n.mm-root .mm-txt [data-type="tag"] {\n    font-size: 0.85em;\n    padding: 1px 6px;\n    border-radius: 10px;\n    background: color-mix(in srgb, var(--mm-node-text) 13%, transparent);\n}\n\n.mm-root .mm-txt [data-type="inline-math"] {\n    font-style: italic;\n}\n\n.mm-root .mm-txt img {\n    max-height: 18px;\n    width: auto;\n    border-radius: 3px;\n    vertical-align: -3px;\n}\n\n.mm-root .mm-txt sup,\n.mm-root .mm-txt sub {\n    font-size: 0.72em;\n}\n\n.mm-root .mm-txt kbd {\n    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;\n    font-size: 0.85em;\n    padding: 1px 5px;\n    border-radius: 4px;\n    border: 1px solid var(--mm-node-border);\n}\n\n/* \u5C42\u7EA7\u7F16\u53F7 */\n.mm-root .mm-badge {\n    flex: 0 0 auto;\n    font-size: 10.5px;\n    font-weight: 600;\n    font-variant-numeric: tabular-nums;\n    letter-spacing: 0.3px;\n    padding: 1px 5px;\n    border-radius: 4px;\n    background: var(--c-soft);\n    color: var(--c-solid);\n}\n\n.mm-root .mm-d0 .mm-badge {\n    background: rgba(255, 255, 255, 0.24);\n    color: inherit;\n}\n\n/* \u4EFB\u52A1\u590D\u9009\u6846 */\n.mm-root .mm-task {\n    flex: 0 0 auto;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    width: 14px;\n    height: 14px;\n    border-radius: 4px;\n    border: 1.5px solid var(--c-solid);\n    font-size: 10px;\n    line-height: 1;\n    color: #ffffff;\n}\n\n.mm-root .mm-task--done {\n    background: var(--c-solid);\n}\n\n.mm-root .mm-done .mm-txt {\n    opacity: 0.5;\n    text-decoration: line-through;\n}\n\n/* -------------------------------------------------------------- \u6298\u53E0\u6309\u94AE */\n\n/* \u843D\u5728\u5206\u652F\u7EBF\u4E0A\uFF0C\u50CF\u7EBF\u4E0A\u7684\u4E00\u4E2A\u8282\u70B9 */\n.mm-root .mm-toggle {\n    position: absolute;\n    z-index: 4;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    width: 15px;\n    height: 15px;\n    box-sizing: border-box;\n    border-radius: 50%;\n    border: 1.5px solid var(--c-solid);\n    background: var(--mm-toggle-bg);\n    color: var(--c-solid);\n    font-size: 9px;\n    font-weight: 600;\n    line-height: 1;\n    cursor: pointer;\n    transition: background 0.15s, color 0.15s, transform 0.15s;\n}\n\n.mm-root .mm-toggle:hover {\n    transform: scale(1.18);\n}\n\n.mm-root .mm-toggle:hover,\n.mm-root .mm-toggle--collapsed {\n    background: var(--c-solid);\n    color: var(--mm-toggle-bg);\n}\n\n/*\n * \u6298\u53E0\u6309\u94AE\u538B\u5728\u753B\u5E03\u4E0A\uFF08\u4E0D\u5728\u8282\u70B9\u5361\u7247\u91CC\uFF09\uFF0C\u6240\u4EE5\u5B83\u7684\u63CF\u8FB9\u4E0E\u6587\u5B57\u5FC5\u987B\u4E0E**\u753B\u5E03**\u5F62\u6210\u53CD\u5DEE\u3002\n * --c-solid \u662F\u5206\u652F\u8272\uFF0C\u672C\u8EAB\u5C31\u662F\u6309\u300C\u5728\u753B\u5E03\u4E0A\u53EF\u8BFB\u300D\u6311\u7684\uFF0C\u56E0\u6B64\u6839\u8282\u70B9\u4E5F\u6CBF\u7528\u540C\u4E00\u5957\u89C4\u5219\uFF0C\n * \u4E0D\u8981\u6539\u6210 --mm-root-text\uFF1A\u9AD8\u5BF9\u6BD4\u4E3B\u9898\u91CC rootText \u662F\u7EAF\u9ED1\u3001\u753B\u5E03\u4E5F\u662F\u7EAF\u9ED1\uFF0C\u4F1A\u76F4\u63A5\u9690\u5F62\u3002\n */\n.mm-root .mm-d0 .mm-toggle {\n    border-color: var(--c-solid);\n    color: var(--c-solid);\n}\n\n/* ---------------------------------------------------------- \u60AC\u505C\u5FEB\u6377\u64CD\u4F5C */\n\n.mm-root .mm-acts {\n    position: absolute;\n    left: calc(100% + 4px);\n    top: -10px;\n    z-index: 8;\n    display: flex;\n    gap: 2px;\n    padding: 2px;\n    border-radius: 7px;\n    border: 1px solid var(--mm-node-border);\n    background: var(--mm-canvas-solid);\n    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24);\n    opacity: 0;\n    visibility: hidden;\n    transform: translateY(2px);\n    transition: opacity 0.14s ease, transform 0.14s ease, visibility 0.14s;\n}\n\n/* \u601D\u7EF4\u5BFC\u56FE\u5DE6\u4FA7\u5206\u652F\uFF1A\u5FEB\u6377\u6309\u94AE\u955C\u50CF\u5230\u5DE6\u8FB9 */\n.mm-root .mm-node.mm-left .mm-acts {\n    left: auto;\n    right: calc(100% + 4px);\n}\n\n.mm-root .mm-node:hover .mm-acts,\n.mm-root .mm-node.mm-sel .mm-acts {\n    opacity: 1;\n    visibility: visible;\n    transform: translateY(0);\n}\n\n.mm-root .mm-acts button {\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    width: 18px;\n    height: 18px;\n    padding: 0;\n    border: 0;\n    border-radius: 5px;\n    background: transparent;\n    color: var(--mm-node-text);\n    cursor: pointer;\n    font-size: 13px;\n    line-height: 1;\n}\n\n.mm-root .mm-acts button:hover {\n    background: var(--mm-accent);\n    color: #ffffff;\n}\n\n/* ---------------------------------------------------------------- \u5B9A\u4F4D\u95EA\u70C1 */\n\n.protyle-wysiwyg .mm-flash {\n    box-shadow: 0 0 0 2px var(--b3-theme-primary, #4c8dff);\n    border-radius: 4px;\n    transition: box-shadow 0.3s;\n}\n\n/* ---------------------------------------------------------------- \u8282\u70B9\u7F16\u8F91 */\n\n.mm-root .mm-node.mm-editing {\n    z-index: 30;\n}\n\n.mm-root .mm-node.mm-editing .mm-inner {\n    box-shadow: 0 0 0 2px var(--mm-accent), 0 10px 28px var(--mm-hover-shadow);\n}\n\n/* \u7236\u7EA7 .mm-node \u8BBE\u4E86 user-select: none\uFF0C\u7F16\u8F91\u65F6\u5FC5\u987B\u653E\u5F00 */\n.mm-root .mm-node.mm-editing .mm-txt {\n    outline: none;\n    cursor: text;\n    user-select: text;\n    white-space: pre-wrap;\n    min-width: 24px;\n    max-width: 320px;\n    caret-color: var(--mm-accent);\n}\n\n/* -------------------------------------------------------------- \u62D6\u62FD\u91CD\u6392 */\n\n.mm-root.mm-drag-active,\n.mm-root.mm-drag-active * {\n    cursor: grabbing !important;\n    user-select: none !important;\n}\n\n.mm-root .mm-node.mm-dragging {\n    opacity: 0.45;\n}\n\n.mm-root .mm-drop {\n    position: absolute;\n    box-sizing: border-box;\n    pointer-events: none;\n    z-index: 20;\n}\n\n/* \u540C\u7EA7\u63D2\u5165\uFF1A\u5728\u8282\u70B9\u4E0A/\u4E0B\u7F18\u753B\u4E00\u6761\u7EBF */\n.mm-root .mm-drop--line {\n    border-radius: 2px;\n    background: var(--mm-accent);\n    box-shadow: 0 0 6px var(--mm-accent);\n}\n\n/* \u6210\u4E3A\u5B50\u8282\u70B9\uFF1A\u7ED9\u76EE\u6807\u5957\u4E00\u4E2A\u865A\u7EBF\u6846 */\n.mm-root .mm-drop--child {\n    border-radius: 10px;\n    border: 2px dashed var(--mm-accent);\n}\n\n/* \u62D6\u62FD\u60AC\u505C\u81EA\u52A8\u5C55\u5F00\u7684\u5012\u8BA1\u65F6\u53CD\u9988 */\n.mm-root .mm-drop--child.mm-drop--pending {\n    animation: mm-pulse 0.4s ease-in-out infinite alternate;\n}\n\n@keyframes mm-pulse {\n    from {\n        border-color: color-mix(in srgb, var(--mm-accent) 40%, transparent);\n    }\n    to {\n        border-color: var(--mm-accent);\n    }\n}\n\n/* ---------------------------------------------------------------- \u6846\u9009\u591A\u9009 */\n\n.mm-root .mm-marquee {\n    position: absolute;\n    z-index: 18;\n    pointer-events: none;\n    border: 1px solid var(--mm-accent);\n    border-radius: 3px;\n    background: color-mix(in srgb, var(--mm-accent) 14%, transparent);\n}\n\n.mm-root .mm-node.mm-multi .mm-inner {\n    box-shadow:\n        0 0 0 1.5px var(--mm-accent),\n        0 4px 14px var(--mm-hover-shadow);\n}\n\n/* ---------------------------------------------------------------- \u7F29\u653E\u80F6\u56CA */\n\n.mm-root .mm-zoombar {\n    position: absolute;\n    right: 14px;\n    bottom: 14px;\n    z-index: 12;\n    display: flex;\n    align-items: center;\n    gap: 2px;\n    padding: 3px;\n    border-radius: 9px;\n    border: 1px solid var(--mm-node-border);\n    /* \u4E0D\u7528 backdrop-filter\uFF1A\u5B83\u4F1A\u8BA9\u7956\u5148\u5EFA\u7ACB backdrop root\uFF0C\n       \u8FDB\u800C\u628A .mm-root \u6574\u68F5\u5B50\u6811\u6E32\u67D3\u8FDB\u4E00\u5F20\u5355\u72EC\u7684\u4F4D\u56FE\uFF0C\u653E\u5927\u65F6\u540C\u6837\u4F1A\u7CCA\u3002\n       \u8FD9\u91CC\u6539\u6210\u5B9E\u8272\u80CC\u666F\uFF0C\u89C2\u611F\u51E0\u4E4E\u4E00\u81F4\u3002 */\n    background: var(--mm-canvas-solid);\n    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);\n    user-select: none;\n}\n\n.mm-root .mm-zoombar button {\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    width: 24px;\n    height: 22px;\n    padding: 0;\n    border: 0;\n    border-radius: 6px;\n    background: transparent;\n    color: var(--mm-node-text);\n    cursor: pointer;\n    font-size: 13px;\n    line-height: 1;\n}\n\n.mm-root .mm-zoombar button:hover {\n    background: color-mix(in srgb, var(--mm-node-text) 12%, transparent);\n}\n\n.mm-root .mm-zoombar .mm-zoom-label {\n    min-width: 46px;\n    cursor: pointer;\n}\n\n/* ------------------------------------------------------------------ \u5C0F\u5730\u56FE */\n\n.mm-root .mm-minimap {\n    position: absolute;\n    right: 14px;\n    bottom: 52px;\n    z-index: 11;\n    box-sizing: border-box;\n    border-radius: 9px;\n    border: 1px solid var(--mm-node-border);\n    background: var(--mm-canvas-solid);\n    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);\n    cursor: pointer;\n    overflow: hidden;\n}\n\n.mm-root .mm-minimap svg {\n    display: block;\n}\n\n.mm-root .mm-minimap .mm-mm-view {\n    fill: color-mix(in srgb, var(--mm-accent) 16%, transparent);\n    stroke: var(--mm-accent);\n    stroke-width: 1;\n}\n\n/* ------------------------------------------------------------------ \u641C\u7D22\u6846 */\n\n.mm-root .mm-search {\n    position: absolute;\n    top: 12px;\n    right: 14px;\n    z-index: 14;\n    display: none;\n    align-items: center;\n    gap: 4px;\n    padding: 4px 6px;\n    border-radius: 9px;\n    border: 1px solid var(--mm-node-border);\n    background: var(--mm-canvas-solid);\n    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.24);\n}\n\n.mm-root .mm-search.mm-search--on {\n    display: flex;\n}\n\n.mm-root .mm-search input {\n    width: 148px;\n    padding: 3px 6px;\n    border: 0;\n    outline: none;\n    background: transparent;\n    color: var(--mm-node-text);\n    font-family: inherit;\n    font-size: 12.5px;\n}\n\n.mm-root .mm-search input::placeholder {\n    color: var(--mm-node-text);\n    opacity: 0.42;\n}\n\n.mm-root .mm-search button {\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    width: 22px;\n    height: 22px;\n    padding: 0;\n    border: 0;\n    border-radius: 6px;\n    background: transparent;\n    color: var(--mm-node-text);\n    cursor: pointer;\n    font-size: 12px;\n    line-height: 1;\n}\n\n.mm-root .mm-search button:hover {\n    background: color-mix(in srgb, var(--mm-node-text) 12%, transparent);\n}\n\n.mm-root .mm-search .mm-search-count {\n    min-width: 42px;\n    text-align: center;\n    font-size: 11.5px;\n    opacity: 0.66;\n    font-variant-numeric: tabular-nums;\n}\n\n/* ---------------------------------------------------------------- \u7A7A\u72B6\u6001 */\n\n.mm-root .mm-empty {\n    position: absolute;\n    inset: 0;\n    display: flex;\n    flex-direction: column;\n    align-items: center;\n    justify-content: center;\n    gap: 6px;\n    pointer-events: none;\n    color: var(--mm-node-text);\n    opacity: 0.45;\n    font-size: 13px;\n    text-align: center;\n}\n\n.mm-root .mm-empty strong {\n    font-size: 14px;\n    font-weight: 500;\n}\n\n/* ---------------------------------------------------------------- \u52A8\u6548\u5F00\u5173 */\n\n.mm-root.mm-flip .mm-node {\n    transition: opacity 0.18s ease;\n}\n\n.mm-root.mm-flip .mm-node.mm-enter {\n    opacity: 0;\n}\n\n/* ---------------------------------------------------------- \u5BFC\u51FA\u7528\u9759\u6001\u515C\u5E95 */\n\n.mm-root.mm-export {\n    display: block;\n    position: relative;\n    margin: 0;\n    padding: 0;\n    border: 0;\n    border-radius: 0;\n    box-shadow: none;\n    background-image: none;\n}\n\n.mm-root.mm-export .mm-nodes {\n    position: absolute;\n    left: 0;\n    top: 0;\n}\n\n.mm-root.mm-export .mm-toolbar,\n.mm-root.mm-export .mm-viewport {\n    display: none;\n}\n\n/* \u5BFC\u51FA\u65F6\u9690\u85CF\u4E00\u5207\u4EA4\u4E92\u6027\u88C5\u9970 */\n.mm-root.mm-export .mm-acts,\n.mm-root.mm-export .mm-toggle,\n.mm-root.mm-export .mm-tip,\n.mm-root.mm-export .mm-minimap,\n.mm-root.mm-export .mm-zoombar,\n.mm-root.mm-export .mm-search,\n.mm-root.mm-export .mm-marquee,\n.mm-root.mm-export .mm-drop {\n    display: none !important;\n}\n\n.mm-root.mm-export .mm-node.mm-dim {\n    opacity: 1;\n}\n\n.mm-root.mm-export .mm-node.mm-enter {\n    opacity: 1;\n}\n\n/* \u9AD8\u5BF9\u6BD4\u4E3B\u9898\uFF1A\u53BB\u6389\u4E00\u5207\u67D4\u548C\u6548\u679C */\n.mm-root.mm-hc .mm-inner {\n    box-shadow: none !important;\n}\n\n.mm-root.mm-hc .mm-d2 .mm-inner,\n.mm-root.mm-hc .mm-d3 .mm-inner,\n.mm-root.mm-hc .mm-d4 .mm-inner {\n    border-width: 1.5px;\n}\n\n.mm-root.mm-hc .mm-d0 .mm-inner {\n    border: 2px solid var(--mm-root-text);\n}\n';

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
  function escapeAttr(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }
  function buildSvg(rootEl) {
    const { world, edges, nodes } = worldParts(rootEl);
    const W = Math.ceil(parseFloat(world.style.width) || world.offsetWidth);
    const H = Math.ceil(parseFloat(world.style.height) || world.offsetHeight);
    const vars = readResolvedVars(rootEl);
    const styleVars = THEME_VARS.filter((v) => v !== "--mm-font" && vars[v]).map((v) => `${v}:${resolveCssValue(vars[v])}`).join(";");
    const bg = resolveCssValue(vars["--mm-canvas-solid"] ?? "#ffffff");
    const font = resolveCssValue(vars["--mm-font"] ?? "sans-serif");
    const nodeHtml = nodes.innerHTML;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
      `<style><![CDATA[`,
      PLUGIN_CSS,
      `.mm-root.mm-export{display:block;position:relative;width:${W}px;height:${H}px;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;background:transparent;}`,
      `.mm-root.mm-export .mm-nodes{position:absolute;left:0;top:0;}`,
      `.mm-root.mm-export .mm-toolbar,.mm-root.mm-export .mm-viewport{display:none;}`,
      `]]></style>`,
      `<rect x="0" y="0" width="${W}" height="${H}" fill="${escapeAttr(bg)}"/>`,
      `<g class="mm-edges">${edges.innerHTML}</g>`,
      `<foreignObject x="0" y="0" width="${W}" height="${H}">`,
      `<div xmlns="http://www.w3.org/1999/xhtml" class="mm-root mm-export" style="${escapeAttr(styleVars)};--mm-font:${escapeAttr(font)}">`,
      `<div class="mm-nodes">${nodeHtml}</div>`,
      `</div>`,
      `</foreignObject>`,
      `</svg>`
    ].join("");
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
  async function exportSvg(rootEl, title) {
    const svg = buildSvg(rootEl);
    download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeName(title)}.svg`);
  }
  async function exportPng(rootEl, title, scale = 2) {
    const svg = buildSvg(rootEl);
    const { world } = worldParts(rootEl);
    const W = Math.ceil(parseFloat(world.style.width) || world.offsetWidth);
    const H = Math.ceil(parseFloat(world.style.height) || world.offsetHeight);
    const maxSide = 8192;
    const s = Math.min(scale, maxSide / Math.max(W, H), 1);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(W * s));
      canvas.height = Math.max(1, Math.round(H * s));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("\u65E0\u6CD5\u521B\u5EFA canvas \u4E0A\u4E0B\u6587");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG \u7F16\u7801\u5931\u8D25");
      download(blob, `${safeName(title)}.png`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("SVG \u5149\u6805\u5316\u5931\u8D25"));
      img.src = src;
    });
  }

  // src/core/tree.ts
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
  function markerOf(node) {
    if (node.kind === "task") return "- [ ]";
    if (node.numbered) return "1.";
    return "-";
  }
  function serializeSubtree(node, depth = 0) {
    const indent = "  ".repeat(depth);
    const line = `${indent}${markerOf(node)} ${escapeMd(node.text)}`;
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

  // src/utils/api.ts
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
  var MINIMAP_MIN_NODES = 50;
  var MINIMAP_MAX_RECTS = 700;
  var LAYOUT_LABEL = {
    logic: "\u903B\u8F91\u7ED3\u6784\u56FE",
    mind: "\u601D\u7EF4\u5BFC\u56FE",
    tree: "\u6811\u72B6\u56FE"
  };
  var MIN_SCALE = 0.15;
  var MAX_SCALE = 6;
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
    next: "M9.5 6l6 6-6 6"
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
    constructor(listEl, options, foldSet, cb, title, mode = "inline") {
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
      this.searchHits = [];
      this.searchIdx = -1;
      this.searchOpen = false;
      /** 小地图缩放比，更新视口框时复用 */
      this.minimapK = 1;
      this.clipboard = "";
      this.tipTarget = null;
      this.hoverExpandTimer = 0;
      this.autoScrollTimer = 0;
      this.autoScrollDir = { x: 0, y: 0 };
      this.listEl = listEl;
      this.options = { ...options };
      this.foldSet = foldSet;
      this.cb = cb;
      this.rootEl = document.createElement("div");
      this.rootEl.className = "mm-root";
      this.rootEl.dataset.mmFor = listEl.dataset.nodeId ?? "";
      this.rootEl.setAttribute("contenteditable", "false");
      this.rootEl.setAttribute("spellcheck", "false");
      this.rootEl.tabIndex = 0;
      this.toolbarEl = document.createElement("div");
      this.toolbarEl.className = "mm-toolbar";
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
      this.rootEl.append(this.toolbarEl, this.viewportEl);
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
        this.rootEl.classList.add("mm-root--dialog");
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
      this.tipEl?.remove();
      this.tipEl = null;
      if (this.flipHandle) cancelAnimationFrame(this.flipHandle);
      this.flipHandle = 0;
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
      Object.assign(this.options, options);
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
      const actGroup = document.createElement("div");
      actGroup.className = "mm-group";
      actGroup.append(this.mkToolBtn("search", "\u641C\u7D22\u8282\u70B9", () => this.toggleSearch(), "Ctrl F"));
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
      this.toolbarEl.append(seg, this.mkSep(), foldGroup, spacer, actGroup);
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
      label.textContent = "100%";
      label.dataset.mmTip = "\u56DE\u5230 100%";
      label.dataset.mmKey = "Ctrl 1";
      label.onclick = (e) => {
        e.stopPropagation();
        this.setScale(1);
      };
      this.zoomLabel = label;
      this.zoomBarEl.append(
        mk("\u2212", "\u7F29\u5C0F", () => this.zoomAt(1 / 1.2), "Ctrl -"),
        label,
        mk("+", "\u653E\u5927", () => this.zoomAt(1.2), "Ctrl ="),
        mk("\u9002\u5E94", "\u9002\u5E94\u753B\u5E03", () => this.fit(), "Ctrl 0")
      );
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
          this.stepSearch(e.shiftKey ? -1 : 1);
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
      this.searchEl.append(
        this.searchInput,
        this.searchCount,
        mk("\u2039", "\u4E0A\u4E00\u4E2A", () => this.stepSearch(-1)),
        mk("\u203A", "\u4E0B\u4E00\u4E2A", () => this.stepSearch(1)),
        mk("\u2715", "\u5173\u95ED\u641C\u7D22", () => this.toggleSearch(false))
      );
    }
    syncToolbar() {
      this.toolbarEl.querySelectorAll("[data-layout]").forEach((el) => {
        el.classList.toggle("mm-on", el.dataset.layout === this.options.layout);
      });
    }
    openExportMenu(event) {
      const menu = new Menu("mm-export-menu");
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
      if (event) menu.open({ x: event.clientX, y: event.clientY });
      else menu.open({ x: 0, y: 0 });
    }
    async doExport(kind) {
      const restore = this.prepareExport();
      try {
        if (kind === "png") await exportPng(this.rootEl, this.title);
        else await exportSvg(this.rootEl, this.title);
      } catch (err) {
        console.warn("[mindmap] \u5BFC\u51FA\u5931\u8D25", err);
        showMessage("\u5BFC\u51FA\u5931\u8D25", 4e3, "error");
      } finally {
        restore();
      }
    }
    /** 导出前临时清掉选中 / 搜索 / 悬停 / 动效残留，导出后恢复 */
    prepareExport() {
      const root = this.rootEl;
      const prevSel = this.selected;
      const prevExtra = new Set(this.extraSel);
      this.hideTip();
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
      if (this.editing) return;
      const theme = resolveTheme(this.options.theme);
      const font = getComputedStyle(document.body).fontFamily || "sans-serif";
      applyTheme(this.rootEl, theme, font);
      this.rootEl.classList.toggle("mm-hc", theme.id === "contrast");
      this.palette0 = theme.palette[0];
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
        return;
      }
      this.emptyEl.style.display = "none";
      const root = wrapRoot(items, this.title);
      decorate(root, theme.palette, this.options.branchColor);
      for (const n of flatten(root)) {
        if (n.id && this.foldSet.has(n.id)) n.folded = true;
      }
      this.tree = root;
      this.byId = indexById(root);
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
      for (const n of all) {
        n.w = n.el.offsetWidth;
        n.h = n.el.offsetHeight;
      }
      const compact = this.options.compact || all.length > this.options.compactThreshold;
      const gapX = compact ? 34 : 58;
      const gapY = compact ? 8 : 16;
      this.gapX = gapX;
      this.trunkLen = Math.max(13, Math.min(gapX * 0.44, 42));
      const box = layout(root, { mode: this.options.layout, gapX, gapY, padX: 72, padY: 64 });
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
      this.resizeViewport(box.h);
      this.refreshSelection();
      this.applySearchMarks();
      if (this.options.autoFit && (fitView || !prev)) this.fit();
      else this.updateTransform();
      if (prev) this.runFlip(prev);
      this.refreshMinimap();
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
      const maxH = Math.max(280, window.innerHeight * 0.76);
      const h = Math.min(Math.max(contentH, 260), maxH);
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
          const cons = buildConnectors({
            parent: rect(n),
            kids: n.kids.map((k) => rect(k)),
            mode: this.options.layout,
            style: this.options.edge,
            gap: this.gapX,
            base
          });
          const own = this.edgeColor(n);
          for (const c of cons) {
            const kid = c.childIndex === null ? null : n.kids[c.childIndex];
            items.push({ c, stroke: kid ? this.edgeColor(kid, true) : own });
          }
        }
        n.kids.forEach(walk);
      };
      walk(root);
      const signature = items.map((i) => `${i.c.kind}:${i.c.width}`).join("|");
      if (signature === this.edgeSignature && this.edgePaths.length === items.length) {
        for (let i = 0; i < items.length; i++) {
          this.edgePaths[i].setAttribute("d", items[i].c.d);
        }
        return;
      }
      const parts = [];
      for (const { c, stroke } of items) {
        parts.push(
          `<path d="${c.d}" fill="none" stroke="${stroke}" stroke-width="${c.width}" stroke-linecap="round" stroke-linejoin="round"/>`
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
      el.dataset.nodeId = n.id;
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
        const box = document.createElement("span");
        box.className = `mm-task ${n.checked ? "mm-task--done" : ""}`;
        box.textContent = n.checked ? "\u2713" : "";
        inner.appendChild(box);
      }
      const txt = document.createElement("span");
      txt.className = "mm-txt";
      txt.innerHTML = n.html;
      inner.appendChild(txt);
      el.appendChild(inner);
      if (n.children.length > 0) {
        const tog = document.createElement("div");
        tog.className = `mm-toggle${n.folded ? " mm-toggle--collapsed" : ""}`;
        tog.textContent = n.folded ? String(n.children.length) : "\u2212";
        tog.dataset.mmTip = n.folded ? `\u5C55\u5F00 ${n.children.length} \u4E2A\u5B50\u8282\u70B9` : "\u6298\u53E0\u5B50\u8282\u70B9";
        tog.dataset.mmKey = "\u7A7A\u683C";
        tog.onclick = (e) => {
          e.stopPropagation();
          this.toggleFold(n);
        };
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
          this.cb.onNodeAction("insertChild", n);
        };
        acts.appendChild(add);
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
        this.rootEl.focus({ preventScroll: true });
        if (e.shiftKey || e.ctrlKey || e.metaKey) this.toggleMulti(n);
        else this.select(n);
      };
      el.ondblclick = (e) => {
        e.stopPropagation();
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
        if (!el.hasAttribute(EDIT_FLAG)) e.preventDefault();
        if (!this.options.draggable || !n.id) return;
        if (el.hasAttribute(EDIT_FLAG)) return;
        this.armDrag(n, e);
      };
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
      const sibs = n.parent.children;
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
    refreshSelection() {
      const root = this.tree;
      if (!root) return;
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
    }
    /** 当前参与批量操作的节点，主选中排在最后（删除时从后往前更安全） */
    get selNodes() {
      const list = [...this.extraSel];
      if (this.selected && !this.extraSel.has(this.selected)) list.push(this.selected);
      return list;
    }
    toggleFold(n) {
      n.folded = !n.folded;
      if (n.id) this.cb.onFoldChange(n.id, n.folded);
      this.render();
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
      this.render();
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
     */
    navigate(dir) {
      const cur = this.selected ?? this.tree;
      if (!cur) return;
      if (dir === "left") {
        if (cur.parent) this.focusNode(cur.parent);
        return;
      }
      if (dir === "right") {
        if (cur.children.length === 0) return;
        if (cur.folded) {
          this.toggleFold(cur);
          this.selected = cur;
          this.refreshSelection();
        }
        const first = cur.children[0];
        if (first) this.focusNode(first);
        return;
      }
      const parent = cur.parent;
      if (!parent) return;
      const sibs = parent.children;
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
    }
    /**
     * 把焦点抢回导图根元素。
     * 异步做，免得和 trapFocus / 编辑器里同步的 focus() 打架（谁后调用谁赢）。
     */
    restoreFocus() {
      window.setTimeout(() => {
        if (this.destroyed || this.editing || this.searchOpen) return;
        if (!this.rootEl.isConnected) return;
        if (this.rootEl.contains(document.activeElement)) return;
        this.rootEl.focus({ preventScroll: true });
      }, 0);
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
      if (this.editing) return;
      const mod = e.ctrlKey || e.metaKey;
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
      const cur = this.selected;
      if (mod && (key === "=" || key === "+")) return take(() => this.zoomAt(1.2));
      if (mod && key === "-") return take(() => this.zoomAt(1 / 1.2));
      if (mod && key === "0") return take(() => this.fit());
      if (mod && key === "1") return take(() => this.setScale(1));
      if (mod && key.toLowerCase() === "f") return take(() => this.toggleSearch(true));
      if (!mod && (key === "f" || key === "F") && this.mode === "inline") {
        if (!this.tree) return;
        return take(() => this.cb.onFullscreen(this.tree, resolveTheme(this.options.theme)));
      }
      if (key === "Escape") {
        if (this.searchOpen) return take(() => this.toggleSearch(false));
        if (this.extraSel.size) return take(() => this.clearSelection());
        if (this.selected) return take(() => this.clearSelection());
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
        if (key === "Enter" && e.shiftKey) return take(() => void 0);
        if (key === "Enter") return take(() => this.cb.onNodeAction("insertSiblingAfter", cur));
        if (key === "Tab" && !e.shiftKey) return take(() => this.cb.onNodeAction("insertChild", cur));
        if (key === "Delete" || key === "Backspace") {
          return take(() => {
            const targets = this.selNodes.filter(canDelete);
            if (targets.length === 0) return;
            if (targets.length > 1) {
              if (window.confirm(`\u786E\u5B9A\u5220\u9664\u9009\u4E2D\u7684 ${targets.length} \u4E2A\u8282\u70B9\u53CA\u5176\u5B50\u6811\uFF1F`)) {
                targets.forEach((t) => this.cb.onNodeAction("delete", t));
              }
              return;
            }
            const only = targets[0];
            const kids = only.children.length;
            if (kids > 0 && !window.confirm(`\u300C${only.text}\u300D\u4E0B\u8FD8\u6709 ${kids} \u4E2A\u5B50\u8282\u70B9\uFF0C\u4E00\u5E76\u5220\u9664\uFF1F`)) return;
            this.cb.onNodeAction("delete", only);
          });
        }
      }
      if (e.shiftKey && key === "Tab") return take(() => this.cb.onNodeAction("outdent", cur));
      if (mod && key === "ArrowUp") return take(() => this.cb.onNodeAction("moveUp", cur));
      if (mod && key === "ArrowDown") return take(() => this.cb.onNodeAction("moveDown", cur));
      if (mod && key.toLowerCase() === "a") return take(() => this.selectAllSiblings());
      if (mod && key.toLowerCase() === "d") return take(() => this.cb.onNodeAction("duplicate", cur));
      if (mod && key.toLowerCase() === "c") {
        return take(() => {
          this.clipboard = serializeSubtree(cur);
          void this.copyNodeText(cur);
        });
      }
      if (mod && key.toLowerCase() === "v") {
        if (!this.clipboard) return;
        const data = this.clipboard;
        return take(() => this.cb.onNodeAction("paste", cur, { data }));
      }
      if (mod && key.toLowerCase() === "x") {
        return take(() => {
          this.clipboard = serializeSubtree(cur);
          void this.copyNodeText(cur);
          this.cb.onNodeAction("delete", cur);
        });
      }
      if (e.altKey && key === "ArrowLeft") return take(() => this.cb.onNodeAction("outdent", cur));
      if (e.altKey && key === "ArrowRight") return take(() => this.cb.onNodeAction("indent", cur));
    }
    /* ==================================================================== 编辑 */
    /**
     * 进入编辑态。
     * 编辑的是纯文本 —— 提交时用 markdown 更新内容块，
     * 因此节点内的行内格式（加粗、行内代码等）在改名后不会保留。
     */
    beginEdit(n) {
      if (!this.options.editable || !n.contentId) return;
      const el = n.el;
      if (!el || el.hasAttribute(EDIT_FLAG)) return;
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
      const cleanup = () => {
        txt.removeEventListener("keydown", onKey);
        txt.removeEventListener("blur", onBlur);
        txt.removeEventListener("paste", onPaste);
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
      const onBlur = () => finish(true);
      const onPaste = (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData("text/plain") ?? "";
        document.execCommand("insertText", false, text);
      };
      txt.addEventListener("keydown", onKey);
      txt.addEventListener("blur", onBlur);
      txt.addEventListener("paste", onPaste);
    }
    /* ==================================================================== 菜单 */
    openNodeMenu(n, event) {
      const menu = new Menu("mm-node-menu");
      const act = (kind, opts) => {
        this.cb.onNodeAction(kind, n, opts);
      };
      const item = (label, key, disabled, click) => {
        menu.addItem({ label: key ? `${label}    ${key}` : label, disabled, click });
      };
      item("\u7F16\u8F91\u6587\u5B57", "F2", !this.options.editable || !canEdit(n), () => this.beginEdit(n));
      item("\u63D2\u5165\u5B50\u8282\u70B9", "Tab", false, () => act("insertChild"));
      item("\u5728\u4E0B\u65B9\u63D2\u5165", "Enter", false, () => act("insertSiblingAfter"));
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
      menu.open({ x: event.clientX, y: event.clientY });
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
        this.dragging = null;
        if (!active) return;
        this.suppressClick = true;
        window.setTimeout(() => {
          this.suppressClick = false;
        }, 0);
        const drop = this.pendingDrop;
        this.pendingDrop = null;
        if (drop) this.cb.onNodeAction("move", n, { target: drop.target, position: drop.position });
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
      const target = hit ? this.byId.get(hit.dataset.nodeId ?? "") : null;
      if (!hit || !target || target === source || isAncestor(source, target)) {
        this.pendingDrop = null;
        window.clearTimeout(this.hoverExpandTimer);
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
        this.hoverExpandTimer = window.setTimeout(() => {
          if (this.dragging && this.pendingDrop?.target === target) {
            target.folded = false;
            if (target.id) this.cb.onFoldChange(target.id, false);
            this.render();
          }
        }, HOVER_EXPAND_DELAY);
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
        this.applySearchMarks();
        this.rootEl.focus({ preventScroll: true });
      }
    }
    runSearch(q) {
      const root = this.tree;
      this.searchHits = [];
      const needle = q.trim().toLowerCase();
      if (root && needle) {
        const walk = (n) => {
          if (n.text.toLowerCase().includes(needle)) this.searchHits.push(n);
          n.children.forEach(walk);
        };
        walk(root);
      }
      this.searchIdx = this.searchHits.length > 0 ? 0 : -1;
      this.updateSearchCount();
      this.applySearchMarks();
      if (this.searchIdx >= 0) this.gotoHit();
    }
    stepSearch(delta) {
      if (this.searchHits.length === 0) return;
      this.searchIdx = (this.searchIdx + delta + this.searchHits.length) % this.searchHits.length;
      this.updateSearchCount();
      this.applySearchMarks();
      this.gotoHit();
    }
    updateSearchCount() {
      const n = this.searchHits.length;
      this.searchCount.textContent = n === 0 ? this.searchInput.value ? "\u65E0\u7ED3\u679C" : "" : `${this.searchIdx + 1}/${n}`;
    }
    /** 命中项可能在折叠的子树里，先展开祖先 */
    gotoHit() {
      const hit = this.searchHits[this.searchIdx];
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
      if (unfolded) this.render();
      this.focusNode(hit);
    }
    applySearchMarks() {
      const root = this.tree;
      if (!root) return;
      const hitSet = new Set(this.searchHits);
      const current = this.searchHits[this.searchIdx];
      const walk = (n) => {
        const el = n.el;
        if (el) {
          el.classList.toggle("mm-hit", hitSet.has(n));
          el.classList.toggle("mm-hit-cur", n === current);
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
        n.kids.forEach(walk);
      };
      walk(root);
      const vw = this.viewportEl.clientWidth;
      const vh = this.viewportEl.clientHeight;
      const vx = -this.tx / this.scale * k;
      const vy = -this.ty / this.scale * k;
      const vw2 = vw / this.scale * k;
      const vh2 = vh / this.scale * k;
      this.minimapEl.innerHTML = [
        `<svg width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}">`,
        rects.join(""),
        `<rect class="mm-mm-view" x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw2.toFixed(1)}" height="${vh2.toFixed(1)}" rx="2"/>`,
        `</svg>`
      ].join("");
      this.minimapK = k;
      this.updateMinimapView();
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
    fit() {
      const w = this.worldW;
      const h = this.worldH;
      const vw = this.viewportEl.clientWidth;
      const vh = this.viewportEl.clientHeight;
      if (w <= 1 || h <= 1) return;
      this.scale = Math.max(MIN_SCALE, Math.min(vw / w, vh / h, 2));
      this.tx = (vw - w * this.scale) / 2;
      this.ty = (vh - h * this.scale) / 2;
      this.updateTransform();
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
      on(this.rootEl, "blur", () => this.hideTip());
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
            this.tx -= e.deltaX;
            this.ty -= e.deltaY;
            this.updateTransform();
          }
        },
        { passive: false }
      );
      on(this.viewportEl, "mousedown", (e) => {
        const t = e.target;
        if (t.closest(".mm-node") || t.closest(".mm-zoombar") || t.closest(".mm-minimap") || t.closest(".mm-search")) {
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
      on(this.viewportEl, "dblclick", (e) => {
        if (e.target.closest(".mm-node")) return;
        this.fit();
      });
      on(this.viewportEl, "click", (e) => {
        const t = e.target;
        if (t.closest(".mm-node") || t.closest(".mm-zoombar") || t.closest(".mm-minimap")) return;
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
          if (this.resizeViewport(this.worldH) && this.options.autoFit) this.fit();
          else this.refreshMinimap();
        });
        ro.observe(document.body);
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
    return { actions: [], folds: [], renames: [], layouts: [], locateIds: [], fullscreen: 0, exits: 0, history: [] };
  }
  var historyHandled = false;
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
      /* @__PURE__ */ new Set(),
      {
        onFoldChange: (id, folded) => void rec.folds.push({ id, folded }),
        onLocate: (id) => void rec.locateIds.push(id),
        onExit: () => void (rec.exits += 1),
        onLayoutChange: (k) => void rec.layouts.push(k),
        onFullscreen: () => void (rec.fullscreen += 1),
        onRename: (node, text) => void rec.renames.push({ id: node.id ?? "", text }),
        onNodeAction: (kind, node) => void rec.actions.push({ kind, text: node.text }),
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
    return { views: out, keyboard: keyboardProbe() };
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
