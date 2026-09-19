/**
 * 生成 icon.png（160×160）与 preview.png（1024×768）
 *
 * 纯 Node 手写 PNG 编码 + 有符号距离场光栅化，不引入任何图像依赖。
 * 采用 3 倍超采样绘制后降采样，保证边缘抗锯齿。
 *
 * 用法：node scripts/make-icon.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ PNG 编码 */

const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const stride = width * 4 + 1;
    const raw = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        raw[y * stride] = 0;
        rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

/** 超采样降采样（按 alpha 加权平均，避免边缘发黑） */
function downsample(buf, W, H, f) {
    const w = Math.round(W / f);
    const h = Math.round(H / f);
    const out = Buffer.alloc(w * h * 4);
    const n = f * f;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let dy = 0; dy < f; dy++) {
                for (let dx = 0; dx < f; dx++) {
                    const i = ((y * f + dy) * W + (x * f + dx)) * 4;
                    const al = buf[i + 3] / 255;
                    r += buf[i] * al;
                    g += buf[i + 1] * al;
                    b += buf[i + 2] * al;
                    a += al;
                }
            }
            const o = (y * w + x) * 4;
            if (a > 0) {
                out[o] = Math.round(r / a);
                out[o + 1] = Math.round(g / a);
                out[o + 2] = Math.round(b / a);
            }
            out[o + 3] = Math.round((a / n) * 255);
        }
    }
    return out;
}

/* --------------------------------------------------------------- 光栅化工具 */

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

function sdRoundRect(px, py, x, y, w, h, r) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const dx = Math.abs(px - cx) - (w / 2 - r);
    const dy = Math.abs(py - cy) - (h / 2 - r);
    return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - r;
}

function sdSegment(px, py, x1, y1, x2, y2) {
    const vx = x2 - x1;
    const vy = y2 - y1;
    const len2 = vx * vx + vy * vy || 1;
    const t = clamp(((px - x1) * vx + (py - y1) * vy) / len2, 0, 1);
    return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

/** 二次贝塞尔采样成折线后取最小距离 */
function sdQuad(px, py, x0, y0, cx, cy, x1, y1) {
    let best = Infinity;
    const N = 20;
    let prevX = x0;
    let prevY = y0;
    for (let i = 1; i <= N; i++) {
        const t = i / N;
        const mt = 1 - t;
        const bx = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
        const by = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
        const d = sdSegment(px, py, prevX, prevY, bx, by);
        if (d < best) best = d;
        prevX = bx;
        prevY = by;
    }
    return best;
}

function paint(buf, W, H, x, y, d, rgb, alpha = 1) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const cov = clamp(0.5 - d, 0, 1) * alpha;
    if (cov <= 0) return;
    const i = (y * W + x) * 4;
    const a = buf[i + 3] / 255;
    const outA = cov + a * (1 - cov);
    if (outA <= 0) return;
    buf[i] = Math.round((rgb[0] * cov + buf[i] * a * (1 - cov)) / outA);
    buf[i + 1] = Math.round((rgb[1] * cov + buf[i + 1] * a * (1 - cov)) / outA);
    buf[i + 2] = Math.round((rgb[2] * cov + buf[i + 2] * a * (1 - cov)) / outA);
    buf[i + 3] = Math.round(outA * 255);
}

/** 只在包围盒内光栅化，避免整画布多次扫描 */
function fill(buf, W, H, bbox, sdf, rgb, alpha = 1) {
    const x0 = Math.max(0, Math.floor(bbox[0]));
    const y0 = Math.max(0, Math.floor(bbox[1]));
    const x1 = Math.min(W - 1, Math.ceil(bbox[2]));
    const y1 = Math.min(H - 1, Math.ceil(bbox[3]));
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            paint(buf, W, H, x, y, sdf(x, y), rgb, alpha);
        }
    }
}

const pad = (bbox, p) => [bbox[0] - p, bbox[1] - p, bbox[2] + p, bbox[3] + p];
const rectBox = (x, y, w, h) => [x, y, x + w, y + h];
const quadBox = (x0, y0, cx, cy, x1, y1) => [
    Math.min(x0, cx, x1),
    Math.min(y0, cy, y1),
    Math.max(x0, cx, x1),
    Math.max(y0, cy, y1),
];

/* --------------------------------------------------------------- 图形绘制 */

const BLUE = [76, 141, 255];
const PURPLE = [123, 92, 255];
const WHITE = [255, 255, 255];

function lerp(a, b, t) {
    return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
    ];
}

/** 徽标：蓝紫渐变圆角方块 + 一拖三的导图结构 */
function drawLogo(size, S) {
    const buf = Buffer.alloc(size * size * 4, 0);
    const k = size / S;

    // 背景：圆角方块内做蓝 → 紫渐变
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const d = sdRoundRect(x, y, 3 * k, 3 * k, (S - 6) * k, (S - 6) * k, 32 * k) - 0.5;
            if (d > 0) continue;
            const t = (x / size) * 0.6 + (y / size) * 0.4;
            const col = lerp(BLUE, PURPLE, t);
            const i = (y * size + x) * 4;
            buf[i] = col[0];
            buf[i + 1] = col[1];
            buf[i + 2] = col[2];
            buf[i + 3] = 255;
        }
    }

    const rx = 24 * k;
    const ry = 70 * k;
    const rw = 34 * k;
    const rh = 26 * k;

    const kids = [
        { x: 100 * k, y: 34 * k, w: 40 * k, h: 22 * k, a: 1 },
        { x: 100 * k, y: 69 * k, w: 40 * k, h: 22 * k, a: 0.92 },
        { x: 100 * k, y: 104 * k, w: 40 * k, h: 22 * k, a: 0.84 },
    ];

    for (const kd of kids) {
        const x0 = rx + rw;
        const y0 = ry + rh / 2;
        const x1 = kd.x;
        const y1 = kd.y + kd.h / 2;
        const cx = (x0 + x1) / 2;
        fill(
            buf,
            size,
            size,
            pad(quadBox(x0, y0, cx, y0, x1, y1), 6 * k),
            (x, y) => sdQuad(x, y, x0, y0, cx, y0, x1, y1) - 2.6 * k,
            WHITE,
            0.75,
        );
    }

    fill(buf, size, size, pad(rectBox(rx, ry, rw, rh), 3 * k), (x, y) => sdRoundRect(x, y, rx, ry, rw, rh, 7 * k), WHITE, 1);
    for (const kd of kids) {
        fill(
            buf,
            size,
            size,
            pad(rectBox(kd.x, kd.y, kd.w, kd.h), 3 * k),
            (x, y) => sdRoundRect(x, y, kd.x, kd.y, kd.w, kd.h, 6 * k),
            WHITE,
            kd.a,
        );
    }

    return buf;
}

/**
 * 预览图：深色画布上的一棵三层导图。
 * 逻辑坐标系固定为 1024×768，与输出尺寸同比例，因此可统一缩放。
 */
function drawPreview(sizeW, sizeH) {
    const LW = 1024;
    const k = sizeW / LW;
    const buf = Buffer.alloc(sizeW * sizeH * 4, 0);

    // 深色底 + 自上而下变暗
    for (let y = 0; y < sizeH; y++) {
        for (let x = 0; x < sizeW; x++) {
            const t = y / sizeH;
            const i = (y * sizeW + x) * 4;
            buf[i] = Math.round(22 - 11 * t);
            buf[i + 1] = Math.round(26 - 13 * t);
            buf[i + 2] = Math.round(38 - 21 * t);
            buf[i + 3] = 255;
        }
    }

    const cy = 384;
    const rx = 110;
    const rw = 160;
    const rh = 48;
    const ry = cy - rh / 2;

    const palette = [
        [91, 157, 255],
        [61, 214, 140],
        [255, 180, 84],
        [255, 122, 182],
    ];

    // 根节点
    for (let y = 0; y < sizeH; y++) {
        for (let x = 0; x < sizeW; x++) {
            const d = sdRoundRect(x, y, rx * k, ry * k, rw * k, rh * k, 11 * k) - 0.5;
            if (d > 0) continue;
            const t = clamp((x / k - rx) / rw, 0, 1);
            const col = lerp(BLUE, PURPLE, t);
            const i = (y * sizeW + x) * 4;
            buf[i] = col[0];
            buf[i + 1] = col[1];
            buf[i + 2] = col[2];
            buf[i + 3] = 255;
        }
    }

    const branches = palette.length;
    const spacing = 115;

    for (let i = 0; i < branches; i++) {
        const col = palette[i];
        const bcy = cy + (i - (branches - 1) / 2) * spacing;
        const bx = 390;
        const bw = 140;
        const bh = 40;

        fill(
            buf,
            sizeW,
            sizeH,
            pad(quadBox(rx + rw, cy, (rx + rw + bx) / 2, cy, bx, bcy).map((v) => v * k), 8 * k),
            (x, y) => sdQuad(x, y, (rx + rw) * k, cy * k, ((rx + rw + bx) / 2) * k, cy * k, bx * k, bcy * k) - 2.8 * k,
            col,
            0.95,
        );
        fill(
            buf,
            sizeW,
            sizeH,
            pad(rectBox(bx * k, (bcy - bh / 2) * k, bw * k, bh * k), 3 * k),
            (x, y) => sdRoundRect(x, y, bx * k, (bcy - bh / 2) * k, bw * k, bh * k, 9 * k),
            col,
            0.26,
        );

        for (let j = 0; j < 2; j++) {
            const lcy = bcy + (j - 0.5) * 34;
            const lx = 700;
            const lw = 190;
            const lh = 32;

            fill(
                buf,
                sizeW,
                sizeH,
                pad(quadBox(bx + bw, bcy, (bx + bw + lx) / 2, bcy, lx, lcy).map((v) => v * k), 6 * k),
                (x, y) =>
                    sdQuad(x, y, (bx + bw) * k, bcy * k, ((bx + bw + lx) / 2) * k, bcy * k, lx * k, lcy * k) - 2.2 * k,
                col,
                0.62,
            );
            fill(
                buf,
                sizeW,
                sizeH,
                pad(rectBox(lx * k, (lcy - lh / 2) * k, lw * k, lh * k), 3 * k),
                (x, y) => sdRoundRect(x, y, lx * k, (lcy - lh / 2) * k, lw * k, lh * k, 8 * k),
                [255, 255, 255],
                0.1,
            );
            fill(
                buf,
                sizeW,
                sizeH,
                pad(rectBox(lx * k, (lcy - lh / 2) * k, lw * k, lh * k), 3 * k),
                (x, y) => Math.abs(sdRoundRect(x, y, lx * k, (lcy - lh / 2) * k, lw * k, lh * k, 8 * k)) - 0.6 * k,
                [255, 255, 255],
                0.16,
            );
        }
    }

    return buf;
}

/* -------------------------------------------------------------------- 输出 */

const SS = 3;
const iconLogical = 160;
const icon = downsample(drawLogo(iconLogical * SS, iconLogical), iconLogical * SS, iconLogical * SS, SS);
fs.writeFileSync(path.join(root, "icon.png"), encodePng(iconLogical, iconLogical, icon));
console.log(`icon.png    ${iconLogical}×${iconLogical}  ${(fs.statSync(path.join(root, "icon.png")).size / 1024).toFixed(1)} KB`);

const pw = 1024;
const ph = 768;
const preview = downsample(drawPreview(pw * SS, ph * SS), pw * SS, ph * SS, SS);
fs.writeFileSync(path.join(root, "preview.png"), encodePng(pw, ph, preview));
console.log(`preview.png ${pw}×${ph}  ${(fs.statSync(path.join(root, "preview.png")).size / 1024).toFixed(1)} KB`);
