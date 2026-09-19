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
  const items2 = [];
  for (const child of Array.from(listEl.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.classList.contains("list")) {
      items2.push(...parseList(child, path ? `${path}.${items2.length + 1}` : `${items2.length + 1}`));
      continue;
    }
    if (!child.classList.contains("li")) continue;
    const li2 = child;
    const contentEl = findContentEl(li2);
    const subList = findSubListEl(li2);
    const order = path ? `${path}.${items2.length + 1}` : `${items2.length + 1}`;
    const children = subList ? parseList(subList, order) : [];
    const html = contentEl ? sanitizeInline(contentEl.innerHTML) : "";
    const text = cleanText(contentEl?.textContent ?? "");
    if (!text && children.length === 0) continue;
    items2.push({
      id: li2.dataset.nodeId ?? "",
      contentId: contentEl?.dataset.nodeId ?? "",
      listId: ownerListId,
      subListId: subList?.dataset.nodeId ?? "",
      html: html || escapeHtml(text),
      text,
      kind,
      checked: li2.classList.contains("protyle-task--done") ? true : void 0,
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
  return items2;
}
function findContentEl(li2) {
  for (const el2 of Array.from(li2.children)) {
    if (!(el2 instanceof HTMLElement)) continue;
    if (el2.classList.contains("list")) continue;
    if (el2.classList.contains("protyle-action")) continue;
    if (el2.hasAttribute("data-node-id")) return el2;
  }
  return null;
}
function findSubListEl(li2) {
  for (const el2 of Array.from(li2.children)) {
    if (el2 instanceof HTMLElement && el2.classList.contains("list")) return el2;
  }
  return null;
}
function sanitizeInline(html) {
  return html.replace(ZERO_WIDTH, "").replace(/\scontenteditable="[^"]*"/g, "").replace(/\sspellcheck="[^"]*"/g, "").replace(/\sdata-render="[^"]*"/g, "").replace(/\sclass="protyle-wysiwyg--select"/g, "").trim();
}
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function decorate(root2, palette, useBranchColor) {
  let count = 0;
  let maxDepth = 0;
  root2.depth = 0;
  root2.branch = -1;
  root2.order = "1";
  root2.parent = null;
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
  walk(root2);
  const paint = (n) => {
    n.color = n.depth === 0 ? null : useBranchColor && n.branch >= 0 ? palette[n.branch % palette.length] : palette[0];
    n.children.forEach(paint);
  };
  paint(root2);
  return { count, maxDepth };
}
function wrapRoot(items2, title) {
  if (items2.length === 1) return items2[0];
  return {
    id: "",
    contentId: "",
    listId: items2[0]?.listId ?? "",
    subListId: "",
    html: escapeHtml(title),
    text: title,
    kind: "heading",
    folded: false,
    numbered: false,
    order: "1",
    children: items2,
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
function flatten(root2) {
  const out = [];
  const walk = (n) => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(root2);
  return out;
}

// src/core/layout.ts
function layout(root2, opt) {
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
    const all = root2.folded ? [] : root2.children;
    const mid = Math.ceil(all.length / 2);
    const sides = [
      { kids: all.slice(0, mid), dir: 1 },
      { kids: all.slice(mid), dir: -1 }
    ];
    root2.kids = [];
    root2.cross = crossSelf(root2);
    root2.slot = 0;
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
      for (const k of kids) placeDepth(k, dir === 1 ? root2.w + gapX : gapX);
      const collect2 = (n) => {
        n.dir = dir;
        collected.push(n);
        n.kids.forEach(collect2);
      };
      kids.forEach(collect2);
    }
    root2.kids = sides[0].kids.concat(sides[1].kids);
    root2.dir = 1;
    root2.d0 = 0;
    root2.d1 = root2.w;
    for (const n of collected) {
      n.y = n.cy - crossSelf(n) / 2;
      n.x = n.dir === 1 ? n.d0 : -n.d1;
    }
    root2.x = 0;
    root2.y = -root2.h / 2;
  } else {
    measure(root2);
    placeCross(root2, 0);
    placeDepth(root2, 0);
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
    toXY(root2);
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
  scan(root2);
  const ox = padX - minX;
  const oy = padY - minY;
  const shift = (n) => {
    n.x += ox;
    n.y += oy;
    n.kids.forEach(shift);
  };
  shift(root2);
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
    const list2 = groups.get(k.dir);
    if (list2) list2.push(k);
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

// src/core/theme.ts
function mixHex(hex, bg, alpha) {
  if (!hex.startsWith("#") || hex.length < 7) return hex;
  const n = parseInt(hex.slice(1, 7), 16);
  const a = Math.min(Math.max(alpha, 0), 1);
  const r2 = Math.round((n >> 16 & 255) * a + bg[0] * (1 - a));
  const g2 = Math.round((n >> 8 & 255) * a + bg[1] * (1 - a));
  const b = Math.round((n & 255) * a + bg[2] * (1 - a));
  return `rgb(${r2},${g2},${b})`;
}

// src/core/tree.ts
var NEW_NODE_TEXT = "\u65B0\u8282\u70B9";
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
function newItemMarkdown(ref) {
  if (ref.kind === "task") return `- [ ] ${NEW_NODE_TEXT}`;
  if (ref.numbered) return `1. ${NEW_NODE_TEXT}`;
  return `- ${NEW_NODE_TEXT}`;
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

// tests/entry.ts
var g = globalThis;
var passed = 0;
var failures = [];
function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failures.push(msg);
    console.error(`  \u2717 ${msg}`);
  }
}
function eq(actual, expected, msg) {
  ok(
    actual === expected,
    `${msg} \u2014\u2014 \u671F\u671B ${JSON.stringify(expected)}\uFF0C\u5B9E\u9645 ${JSON.stringify(actual)}`
  );
}
function el(spec) {
  const node = new g.HTMLElement();
  if (spec.id) node.dataset.nodeId = spec.id;
  if (spec.subtype) node.dataset.subtype = spec.subtype;
  for (const c of spec.cls ?? []) node.classList.add(c);
  node.innerHTML = spec.html ?? "";
  node.textContent = spec.text ?? "";
  for (const child of spec.children ?? []) node.appendChild(el(child));
  return node;
}
var p = (id, text, html) => ({
  id,
  cls: ["p"],
  text,
  html: html ?? text
});
var li = (id, content, sub, cls = []) => ({
  id,
  cls: ["li", ...cls],
  children: sub ? [content, sub] : [content]
});
var list = (subtype, id, items2) => ({
  id,
  cls: ["list"],
  subtype,
  children: items2
});
var tree = list("u", "L0", [
  li("L1", p("P1", "\u6839\u8282\u70B9"), list("o", "L1sub", [
    li("L11", p("P11", "\u7B2C\u4E00\u9879"), list("u", "L11sub", [li("L111", p("P111", "\u53F6\u5B50"))])),
    li("L12", p("P12", "\u7B2C\u4E8C\u9879"))
  ])),
  li("L2", p("P2", "\u4EFB\u52A1\u7EC4"), list("t", "L2sub", [
    li("L21", p("P21", "\u5DF2\u5B8C\u6210\u4EFB\u52A1"), void 0, ["protyle-task--done"]),
    li("L22", p("P22", "\u672A\u5B8C\u6210\u4EFB\u52A1"), void 0, ["protyle-task--undone"])
  ]))
]);
console.log("\n[1] \u89E3\u6790 Protyle DOM");
var domTree = el(tree);
var items = parseList(domTree);
eq(items.length, 2, "\u9876\u5C42\u5217\u8868\u9879\u6570\u91CF");
eq(items[0].id, "L1", "\u7B2C\u4E00\u4E2A\u9876\u5C42\u9879\u7684\u5757 ID");
eq(items[0].text, "\u6839\u8282\u70B9", "\u7B2C\u4E00\u4E2A\u9876\u5C42\u9879\u7684\u6587\u672C");
eq(items[0].children.length, 2, "L1 \u7684\u5B50\u9879\u6570\u91CF");
eq(items[0].children[0].order, "1.1", "L1 \u7B2C\u4E00\u4E2A\u5B50\u9879\u7684\u5C42\u7EA7\u7F16\u53F7");
eq(items[0].children[1].order, "1.2", "L1 \u7B2C\u4E8C\u4E2A\u5B50\u9879\u7684\u5C42\u7EA7\u7F16\u53F7");
eq(items[0].children[0].children[0].order, "1.1.1", "\u4E09\u7EA7\u8282\u70B9\u7684\u5C42\u7EA7\u7F16\u53F7");
eq(items[0].children[0].children[0].text, "\u53F6\u5B50", "\u4E09\u7EA7\u8282\u70B9\u7684\u6587\u672C");
eq(items[1].order, "2", "\u7B2C\u4E8C\u4E2A\u9876\u5C42\u9879\u7684\u5C42\u7EA7\u7F16\u53F7");
eq(items[0].kind, "bullet", "\u65E0\u5E8F\u5217\u8868\u8282\u70B9 kind");
eq(items[0].numbered, false, "\u65E0\u5E8F\u5217\u8868\u4E0D\u663E\u793A\u7F16\u53F7");
eq(items[0].children[0].kind, "ordered", "\u6709\u5E8F\u5217\u8868\u8282\u70B9 kind");
eq(items[0].children[0].numbered, true, "\u6709\u5E8F\u5217\u8868\u663E\u793A\u7F16\u53F7");
eq(items[1].children[0].kind, "task", "\u4EFB\u52A1\u5217\u8868\u8282\u70B9 kind");
eq(items[1].children[0].checked, true, "\u5DF2\u5B8C\u6210\u4EFB\u52A1\u88AB\u8BC6\u522B");
eq(items[1].children[1].checked, void 0, "\u672A\u5B8C\u6210\u4EFB\u52A1 checked \u4E3A undefined");
var withEmpty = list("u", "LE", [li("E1", p("PE1", "   ")), li("E2", p("PE2", "\u6709\u5185\u5BB9"))]);
eq(parseList(el(withEmpty)).length, 1, "\u7A7A\u5217\u8868\u9879\u88AB\u8FC7\u6EE4");
var withZwsp = list("u", "LZ", [
  li("Z1", p("PZ1", "\u96F6\u5BBD\u200B\u8282\u70B9\uFEFF", "\u96F6\u5BBD\u200B\u8282\u70B9\uFEFF")),
  li("Z2", p("PZ2", "\u200B"))
]);
var zwItems = parseList(el(withZwsp));
eq(zwItems.length, 1, "\u53EA\u542B\u96F6\u5BBD\u5B57\u7B26\u7684\u5217\u8868\u9879\u6309\u7A7A\u8282\u70B9\u4E22\u5F03");
eq(zwItems[0].text, "\u96F6\u5BBD\u8282\u70B9", "\u6587\u672C\u91CC\u7684\u96F6\u5BBD\u5B57\u7B26\u88AB\u6E05\u6389");
eq(zwItems[0].html, "\u96F6\u5BBD\u8282\u70B9", "HTML \u91CC\u7684\u96F6\u5BBD\u5B57\u7B26\u4E5F\u88AB\u6E05\u6389");
eq(serializeSubtree(zwItems[0]), "- \u96F6\u5BBD\u8282\u70B9", "\u5E8F\u5217\u5316\u7ED3\u679C\u4E0D\u542B\u96F6\u5BBD\u5B57\u7B26");
console.log("[2] \u88C5\u9970\uFF08\u6DF1\u5EA6 / \u5206\u652F\u8272 / \u7F16\u53F7\uFF09");
var PALETTE = ["#111111", "#222222", "#333333"];
var root = wrapRoot(items, "\u5BFC\u56FE");
var meta = decorate(root, PALETTE, true);
eq(root.depth, 0, "\u6839\u8282\u70B9\u6DF1\u5EA6");
eq(root.children[0].depth, 1, "\u4E00\u7EA7\u8282\u70B9\u6DF1\u5EA6");
eq(root.children[0].children[0].depth, 2, "\u4E8C\u7EA7\u8282\u70B9\u6DF1\u5EA6");
eq(root.children[0].children[0].children[0].depth, 3, "\u4E09\u7EA7\u8282\u70B9\u6DF1\u5EA6");
eq(meta.maxDepth, 3, "\u6700\u5927\u6DF1\u5EA6");
eq(meta.count, flatten(root).length, "\u8282\u70B9\u603B\u6570\u4E0E flatten \u4E00\u81F4");
eq(root.children[0].color, PALETTE[0], "\u7B2C\u4E00\u4E2A\u4E00\u7EA7\u5206\u652F\u53D6\u5230\u8272\u677F\u7B2C 0 \u8272");
eq(root.children[1].color, PALETTE[1], "\u7B2C\u4E8C\u4E2A\u4E00\u7EA7\u5206\u652F\u53D6\u5230\u8272\u677F\u7B2C 1 \u8272");
eq(root.children[0].children[0].color, PALETTE[0], "\u5B50\u8282\u70B9\u7EE7\u627F\u4E00\u7EA7\u5206\u652F\u8272");
eq(root.color, null, "\u6839\u8282\u70B9\u4E0D\u5E26\u5206\u652F\u8272");
var noColor = wrapRoot(parseList(domTree), "\u5BFC\u56FE");
decorate(noColor, PALETTE, false);
eq(noColor.children[0].children[0].color, PALETTE[0], "\u5173\u95ED\u5206\u652F\u914D\u8272\u65F6\u5168\u90E8\u4F7F\u7528\u9996\u8272");
console.log("[3] \u5E03\u5C40\uFF08\u903B\u8F91\u56FE / \u601D\u7EF4\u5BFC\u56FE / \u6811\u72B6\u56FE\uFF09");
function collect(n) {
  const out = [];
  const walk = (x) => {
    out.push(x);
    x.kids.forEach(walk);
  };
  walk(n);
  return out;
}
function checkLayout(mode) {
  const r2 = wrapRoot(parseList(domTree), "\u5BFC\u56FE");
  decorate(r2, PALETTE, true);
  for (const n of flatten(r2)) {
    n.w = Math.min(240, 40 + n.text.length * 14);
    n.h = 34;
  }
  const box = layout(r2, { mode, gapX: 58, gapY: 16, padX: 72, padY: 64 });
  const nodes = collect(r2);
  const horiz = mode !== "tree";
  ok(box.w > 0 && box.h > 0, `${mode}: \u753B\u5E03\u5C3A\u5BF8\u6709\u6548`);
  ok(nodes.length === flatten(r2).length, `${mode}: \u5E03\u5C40\u8986\u76D6\u5168\u90E8\u8282\u70B9`);
  for (const n of nodes) {
    ok(n.x >= -0.01 && n.y >= -0.01, `${mode}: \u8282\u70B9 ${n.text} \u5750\u6807\u4E3A\u8D1F`);
    ok(n.x + n.w <= box.w + 1 && n.y + n.h <= box.h + 1, `${mode}: \u8282\u70B9 ${n.text} \u8D8A\u754C`);
  }
  let overlap = 0;
  for (let a = 0; a < nodes.length; a++) {
    for (let b = a + 1; b < nodes.length; b++) {
      const x = nodes[a];
      const y = nodes[b];
      if (x.x < y.x + y.w - 0.01 && y.x < x.x + x.w - 0.01 && x.y < y.y + y.h - 0.01 && y.y < x.y + x.h - 0.01) {
        overlap++;
      }
    }
  }
  eq(overlap, 0, `${mode}: \u4E0D\u5B58\u5728\u8282\u70B9\u91CD\u53E0`);
  for (const n of nodes) {
    if (n.kids.length === 0) continue;
    if (mode === "mind" && n.depth === 0) continue;
    const first = n.kids[0];
    const last = n.kids[n.kids.length - 1];
    const pc = horiz ? n.y + n.h / 2 : n.x + n.w / 2;
    const mid = horiz ? (first.y + first.h / 2 + last.y + last.h / 2) / 2 : (first.x + first.w / 2 + last.x + last.w / 2) / 2;
    ok(Math.abs(pc - mid) < 0.6, `${mode}: \u7236\u8282\u70B9 ${n.text} \u672A\u5BF9\u9F50\u5B50\u6811\u4E2D\u70B9\uFF08\u504F\u5DEE ${(pc - mid).toFixed(2)}\uFF09`);
  }
  const depthOk = (n) => {
    for (const k of n.kids) {
      const parentEnd = horiz ? n.x + n.w : n.y + n.h;
      const childStart = horiz ? k.x : k.y;
      if (k.x >= n.x) {
        ok(childStart >= parentEnd - 0.01, `${mode}: \u6DF1\u5EA6\u8F74\u9519\u8BEF ${n.text} \u2192 ${k.text}`);
      }
      depthOk(k);
    }
  };
  depthOk(r2);
  if (mode === "mind") {
    const side = collect(r2).filter((n) => n.depth === 1);
    ok(side.some((n) => n.dir === 1) && side.some((n) => n.dir === -1), "mind: \u4E00\u7EA7\u5206\u652F\u5206\u5E03\u5728\u5DE6\u53F3\u4E24\u4FA7");
  }
}
checkLayout("logic");
checkLayout("mind");
checkLayout("tree");
console.log("[4] \u6298\u53E0");
{
  const r2 = wrapRoot(parseList(domTree), "\u5BFC\u56FE");
  decorate(r2, PALETTE, true);
  for (const n of flatten(r2)) {
    n.w = 100;
    n.h = 34;
  }
  const before = layout(r2, { mode: "logic", gapX: 58, gapY: 16, padX: 72, padY: 64 });
  const first = r2.children[0];
  first.folded = true;
  const after = layout(r2, { mode: "logic", gapX: 58, gapY: 16, padX: 72, padY: 64 });
  eq(first.kids.length, 0, "\u6298\u53E0\u540E\u4E0D\u53C2\u4E0E\u5E03\u5C40\u7684\u5B50\u8282\u70B9\u4E3A\u7A7A");
  ok(after.w < before.w, "\u6298\u53E0\u540E\u753B\u5E03\u53D8\u7A84");
  ok(after.h <= before.h, "\u6298\u53E0\u540E\u753B\u5E03\u4E0D\u53D8\u9AD8");
}
console.log("[5] \u7ED3\u6784\u64CD\u4F5C\uFF08\u5757 ID / \u7956\u5148 / \u53EF\u6267\u884C\u6027 / \u5E8F\u5217\u5316\uFF09");
var mk = (o) => o;
{
  const r2 = wrapRoot(parseList(domTree), "\u5BFC\u56FE");
  const l1 = r2.children[0];
  eq(l1.id, "L1", "\u8282\u70B9\u8BB0\u5F55\u5217\u8868\u9879\u5757 ID");
  eq(l1.contentId, "P1", "\u8282\u70B9\u8BB0\u5F55\u5185\u5BB9\u5757 ID\uFF08\u6539\u540D\u8981\u7528\u5B83\uFF09");
  eq(l1.listId, "L0", "\u9876\u5C42\u8282\u70B9\u5F52\u5C5E\u6839\u5217\u8868\u5757");
  eq(l1.subListId, "L1sub", "\u8282\u70B9\u8BB0\u5F55\u5B50\u5217\u8868\u5757 ID\uFF08\u964D\u7EA7\u8981\u7528\u5B83\uFF09");
  const l11 = l1.children[0];
  eq(l11.listId, "L1sub", "\u4E8C\u7EA7\u8282\u70B9\u5F52\u5C5E\u5176\u6240\u5728\u5217\u8868\u5757");
  eq(l11.subListId, "L11sub", "\u4E8C\u7EA7\u8282\u70B9\u8BB0\u5F55\u5B50\u5217\u8868\u5757 ID");
  eq(l11.children[0].subListId, "", "\u53F6\u5B50\u8282\u70B9\u6CA1\u6709\u5B50\u5217\u8868 ID");
}
{
  const r2 = wrapRoot(parseList(domTree), "\u5BFC\u56FE");
  decorate(r2, PALETTE, true);
  const a = r2.children[0];
  const b = a.children[0].children[0];
  ok(isAncestor(a, b), "\u8DE8\u4E24\u7EA7\u4ECD\u80FD\u8BC6\u522B\u7956\u5148\u5173\u7CFB");
  ok(!isAncestor(b, a), "\u53CD\u5411\u4E0D\u6210\u7ACB");
  ok(!isAncestor(a, a), "\u81EA\u8EAB\u4E0D\u7B97\u81EA\u5DF1\u7684\u7956\u5148");
  ok(!isAncestor(a, null), "\u7A7A\u8282\u70B9\u8FD4\u56DE false");
}
{
  const r2 = wrapRoot(parseList(domTree), "\u5BFC\u56FE");
  decorate(r2, PALETTE, true);
  const first = r2.children[0];
  const second = r2.children[1];
  eq(indexInParent(first), 0, "\u7B2C\u4E00\u4E2A\u5B50\u8282\u70B9\u4E0B\u6807\u4E3A 0");
  eq(indexInParent(second), 1, "\u7B2C\u4E8C\u4E2A\u5B50\u8282\u70B9\u4E0B\u6807\u4E3A 1");
  eq(indexInParent(r2), -1, "\u865A\u62DF\u6839\u65E0\u7236\u8282\u70B9");
  ok(!canMoveUp(first), "\u9996\u4E2A\u8282\u70B9\u4E0D\u80FD\u4E0A\u79FB");
  ok(canMoveDown(first), "\u9996\u4E2A\u8282\u70B9\u53EF\u4EE5\u4E0B\u79FB");
  ok(!canMoveDown(second), "\u672B\u4E2A\u8282\u70B9\u4E0D\u80FD\u4E0B\u79FB");
  ok(!canIndent(first), "\u9996\u4E2A\u8282\u70B9\u4E0D\u80FD\u964D\u7EA7");
  ok(canIndent(second), "\u7B2C\u4E8C\u4E2A\u8282\u70B9\u53EF\u4EE5\u964D\u7EA7");
  ok(!canOutdent(first), "\u9876\u5C42\u8282\u70B9\u4E0D\u80FD\u5347\u7EA7");
  ok(canOutdent(first.children[0]), "\u4E8C\u7EA7\u8282\u70B9\u53EF\u4EE5\u5347\u7EA7");
  ok(canDelete(first) && canEdit(first), "\u771F\u5B9E\u8282\u70B9\u53EF\u5220\u9664\u3001\u53EF\u7F16\u8F91");
  ok(!canDelete(r2) && !canEdit(r2), "\u865A\u62DF\u6839\u4E0D\u53EF\u5220\u9664\u3001\u4E0D\u53EF\u7F16\u8F91");
}
{
  eq(markerOf(mk({ kind: "bullet" })), "-", "\u65E0\u5E8F\u9879\u6807\u8BB0");
  eq(markerOf(mk({ kind: "ordered", numbered: true })), "1.", "\u6709\u5E8F\u9879\u6807\u8BB0");
  eq(markerOf(mk({ kind: "task" })), "- [ ]", "\u4EFB\u52A1\u9879\u6807\u8BB0");
  eq(newItemMarkdown(mk({ kind: "bullet" })), "- \u65B0\u8282\u70B9", "\u65B0\u5EFA\u65E0\u5E8F\u8282\u70B9");
  eq(newItemMarkdown(mk({ kind: "task" })), "- [ ] \u65B0\u8282\u70B9", "\u65B0\u5EFA\u4EFB\u52A1\u8282\u70B9");
  const r2 = wrapRoot(parseList(domTree), "\u5BFC\u56FE");
  const lines = serializeSubtree(r2.children[0]).split("\n");
  eq(lines.length, 4, "\u5E8F\u5217\u5316\u884C\u6570");
  eq(lines[0], "- \u6839\u8282\u70B9", "\u9996\u884C\u662F\u6839\u8282\u70B9");
  eq(lines[1], "  1. \u7B2C\u4E00\u9879", "\u5B50\u5C42\u7EA7\u7F29\u8FDB\u4E24\u683C\u4E14\u8DDF\u968F\u6709\u5E8F\u5217\u8868\u7C7B\u578B");
  eq(lines[2], "    - \u53F6\u5B50", "\u5B59\u5C42\u7EA7\u7EE7\u7EED\u7F29\u8FDB\u4E14\u8DDF\u968F\u65E0\u5E8F\u5217\u8868\u7C7B\u578B");
  eq(lines[3], "  1. \u7B2C\u4E8C\u9879", "\u540C\u7EA7\u5B50\u9879\u7F29\u8FDB\u4E00\u81F4");
}
{
  eq(escapeMd("- \u770B\u8D77\u6765\u50CF\u5217\u8868"), "\\- \u770B\u8D77\u6765\u50CF\u5217\u8868", "\u884C\u9996\u77ED\u6A2A\u88AB\u8F6C\u4E49");
  eq(escapeMd("1. \u770B\u8D77\u6765\u50CF\u6709\u5E8F\u5217\u8868"), "1\\. \u770B\u8D77\u6765\u50CF\u6709\u5E8F\u5217\u8868", "\u884C\u9996\u6570\u5B57\u52A0\u70B9\u88AB\u8F6C\u4E49");
  eq(escapeMd("# \u6807\u9898"), "\\# \u6807\u9898", "\u884C\u9996\u4E95\u53F7\u88AB\u8F6C\u4E49");
  eq(escapeMd("\u6B63\u6587\u91CC\u7684 * \u661F\u53F7"), "\u6B63\u6587\u91CC\u7684 \\* \u661F\u53F7", "\u884C\u5185\u661F\u53F7\u88AB\u8F6C\u4E49");
  eq(escapeMd("a_b_c"), "a\\_b\\_c", "\u884C\u5185\u4E0B\u5212\u7EBF\u88AB\u8F6C\u4E49");
  eq(escapeMd("\u666E\u901A\u6587\u672C"), "\u666E\u901A\u6587\u672C", "\u666E\u901A\u6587\u672C\u4FDD\u6301\u4E0D\u53D8");
}
var nums = (d) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
console.log("[6] \u8FDE\u7EBF\u51E0\u4F55\uFF08\u4E3B\u5E72\u6C47\u805A / \u6E10\u7EC6 / \u5706\u89D2\uFF09");
{
  const parent = { x: 0, y: 100, w: 80, h: 40, dir: 1 };
  const kids = [
    { x: 200, y: 0, w: 60, h: 30, dir: 1 },
    { x: 200, y: 100, w: 60, h: 30, dir: 1 },
    { x: 200, y: 200, w: 60, h: 30, dir: 1 }
  ];
  const cons = buildConnectors({ parent, kids, mode: "logic", style: "elbow", gap: 58, base: 2.8 });
  const trunk = cons.find((c) => c.kind === "trunk");
  const spine = cons.find((c) => c.kind === "spine");
  const stubs = cons.filter((c) => c.kind === "stub");
  ok(!!trunk && !!spine, "\u903B\u8F91\u56FE\u540C\u65F6\u4EA7\u51FA\u4E3B\u5E72\u4E0E\u810A");
  eq(stubs.length, 3, "\u6BCF\u4E2A\u5B50\u8282\u70B9\u5404\u6709\u4E00\u6761\u652F\u7EBF");
  const tp = nums(trunk.d);
  eq(tp[0], 80, "\u4E3B\u5E72\u4ECE\u7236\u8282\u70B9\u53F3\u8FB9\u7F18\u51FA\u53D1");
  eq(tp[1], 120, "\u4E3B\u5E72\u8D77\u70B9\u843D\u5728\u7236\u8282\u70B9\u5782\u76F4\u4E2D\u5FC3");
  ok(tp[2] > 80, "\u4E3B\u5E72\u5411\u53F3\u5EF6\u4F38");
  ok(tp[2] - tp[0] <= 42, "\u4E3B\u5E72\u957F\u5EA6\u4E0D\u8D85\u8FC7\u4E0A\u9650");
  const sp = nums(spine.d);
  eq(sp[0], sp[2], "\u810A\u662F\u5782\u76F4\u7684");
  eq(sp[0], tp[2], "\u810A\u7684 x \u4E0E\u4E3B\u5E72\u7EC8\u70B9\u5BF9\u9F50");
  ok(sp[1] <= 115, "\u810A\u7684\u4E0A\u7AEF\u8986\u76D6\u6700\u4E0A\u65B9\u5B50\u8282\u70B9");
  ok(sp[3] >= 215, "\u810A\u7684\u4E0B\u7AEF\u8986\u76D6\u6700\u4E0B\u65B9\u5B50\u8282\u70B9");
  for (const s of stubs) {
    const p2 = nums(s.d);
    eq(p2[0], tp[2], "\u652F\u7EBF\u4ECE\u810A\u4E0A\u51FA\u53D1");
    eq(p2[p2.length - 2], 200, "\u652F\u7EBF\u7EC8\u70B9\u843D\u5728\u5B50\u8282\u70B9\u5DE6\u8FB9\u7F18");
  }
  ok(trunk.width > spine.width, "\u4E3B\u5E72\u6BD4\u810A\u7C97\uFF08\u6E10\u7EC6\uFF09");
  ok(spine.width > stubs[0].width, "\u810A\u6BD4\u652F\u7EBF\u7C97\uFF08\u6E10\u7EC6\uFF09");
  eq(stubs[0].childIndex, 0, "\u652F\u7EBF\u8BB0\u5F55\u5B50\u8282\u70B9\u4E0B\u6807");
  eq(trunk.childIndex, null, "\u4E3B\u5E72\u4E0D\u5F52\u5C5E\u4EFB\u4F55\u5B50\u8282\u70B9");
}
{
  const parent = { x: 0, y: 0, w: 80, h: 40, dir: 1 };
  const kids = [{ x: 200, y: 0, w: 60, h: 30, dir: 1 }];
  const cons = buildConnectors({ parent, kids, mode: "logic", style: "straight", gap: 58, base: 2.8 });
  eq(cons.length, 1, "\u76F4\u7EBF\u6A21\u5F0F\u53EA\u753B\u4E00\u6761\u7EBF");
  eq(cons[0].kind, "stub", "\u76F4\u7EBF\u6A21\u5F0F\u6CA1\u6709\u4E3B\u5E72\u4E0E\u810A");
}
{
  const parent = { x: 0, y: 100, w: 80, h: 40, dir: 1 };
  const kids = [
    { x: 200, y: 0, w: 60, h: 30, dir: 1 },
    { x: 200, y: 100, w: 60, h: 30, dir: 1 }
  ];
  const cons = buildConnectors({ parent, kids, mode: "logic", style: "curve", gap: 58, base: 2.8 });
  const stubs = cons.filter((c) => c.kind === "stub");
  ok(stubs[0].d.includes("Q"), "\u8FDC\u79BB\u7236\u8282\u70B9\u7684\u652F\u7EBF\u5E26\u5706\u89D2");
  ok(!stubs[1].d.includes("Q"), "\u8D34\u8FD1\u7236\u8282\u70B9\u7684\u652F\u7EBF\u9000\u5316\u4E3A\u76F4\u7EBF\uFF0C\u907F\u514D\u5706\u89D2\u4E92\u76F8\u6253\u67B6");
}
{
  const parent = { x: 0, y: 0, w: 80, h: 40, dir: 1 };
  const kids = [
    { x: -40, y: 150, w: 60, h: 30, dir: 1 },
    { x: 120, y: 150, w: 60, h: 30, dir: 1 }
  ];
  const cons = buildConnectors({ parent, kids, mode: "tree", style: "elbow", gap: 58, base: 2.8 });
  const trunk = cons.find((c) => c.kind === "trunk");
  const spine = cons.find((c) => c.kind === "spine");
  const tp = nums(trunk.d);
  eq(tp[0], 40, "\u6811\u72B6\u56FE\u4E3B\u5E72\u4ECE\u7236\u8282\u70B9\u6C34\u5E73\u4E2D\u5FC3\u51FA\u53D1");
  eq(tp[1], 40, "\u4E3B\u5E72\u8D77\u70B9\u843D\u5728\u7236\u8282\u70B9\u4E0B\u8FB9\u7F18");
  eq(tp[2], 40, "\u4E3B\u5E72\u5782\u76F4\u5411\u4E0B");
  ok(tp[3] > 40, "\u4E3B\u5E72\u5411\u4E0B\u5EF6\u4F38");
  const sp = nums(spine.d);
  eq(sp[1], sp[3], "\u6811\u72B6\u56FE\u7684\u810A\u662F\u6C34\u5E73\u7684");
  eq(sp[1], tp[3], "\u810A\u7684 y \u4E0E\u4E3B\u5E72\u7EC8\u70B9\u5BF9\u9F50");
  ok(sp[0] < 40 && sp[2] > 40, "\u810A\u6A2A\u8DE8\u6240\u6709\u5B50\u8282\u70B9");
}
{
  const parent = { x: 0, y: 0, w: 80, h: 40, dir: 1 };
  const kids = [
    { x: 200, y: 0, w: 60, h: 30, dir: 1 },
    { x: -200, y: 0, w: 60, h: 30, dir: -1 }
  ];
  const cons = buildConnectors({ parent, kids, mode: "mind", style: "elbow", gap: 58, base: 2.8 });
  const trunks = cons.filter((c) => c.kind === "trunk");
  const stubs = cons.filter((c) => c.kind === "stub");
  eq(trunks.length, 2, "\u5DE6\u53F3\u4E24\u4FA7\u5404\u6709\u4E00\u6761\u4E3B\u5E72");
  const right = nums(trunks[0].d);
  const left = nums(trunks[1].d);
  eq(right[0], 80, "\u53F3\u4FA7\u4E3B\u5E72\u4ECE\u7236\u8282\u70B9\u53F3\u8FB9\u7F18\u51FA\u53D1");
  ok(right[2] > 80, "\u53F3\u4FA7\u4E3B\u5E72\u5411\u53F3");
  eq(left[0], 0, "\u5DE6\u4FA7\u4E3B\u5E72\u4ECE\u7236\u8282\u70B9\u5DE6\u8FB9\u7F18\u51FA\u53D1");
  ok(left[2] < 0, "\u5DE6\u4FA7\u4E3B\u5E72\u5411\u5DE6");
  eq(stubs.length, 2, "\u4E24\u4FA7\u5404\u6709\u4E00\u6761\u652F\u7EBF");
  eq(nums(stubs[1].d).slice(-2)[0], -140, "\u5DE6\u4FA7\u652F\u7EBF\u7EC8\u70B9\u843D\u5728\u5B50\u8282\u70B9\u53F3\u8FB9\u7F18");
}
console.log("[7] \u8FDE\u7EBF\u914D\u8272\uFF08\u5B9E\u8272\u6DF7\u5408\uFF09");
{
  eq(mixHex("#ffffff", [0, 0, 0], 1), "rgb(255,255,255)", "alpha=1 \u65F6\u4FDD\u7559\u539F\u8272");
  eq(mixHex("#ffffff", [0, 0, 0], 0), "rgb(0,0,0)", "alpha=0 \u65F6\u5B8C\u5168\u53D8\u6210\u5E95\u8272");
  eq(mixHex("#000000", [255, 255, 255], 0.5), "rgb(128,128,128)", "\u534A\u900F\u660E\u6DF7\u8272\u53D6\u4E2D\u95F4\u503C");
  eq(mixHex("\u4E0D\u662F\u989C\u8272", [0, 0, 0], 1), "\u4E0D\u662F\u989C\u8272", "\u975E\u5341\u516D\u8FDB\u5236\u8F93\u5165\u539F\u6837\u8FD4\u56DE");
  ok(mixHex("#4c8dff", [11, 13, 18], 0.9).startsWith("rgb("), "\u6DF7\u51FA\u7684\u989C\u8272\u4E0D\u900F\u660E\uFF0C\u91CD\u53E0\u6BB5\u4E0D\u4F1A\u53E0\u6DF1");
}
console.log("");
if (failures.length === 0) {
  console.log(`\u5168\u90E8\u901A\u8FC7 \u2713  \u5171 ${passed} \u9879\u65AD\u8A00`);
} else {
  console.error(`${failures.length} \u9879\u5931\u8D25\uFF0C${passed} \u9879\u901A\u8FC7`);
  process.exitCode = 1;
}
