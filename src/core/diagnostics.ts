/**
 * 诊断信息（P1-5）。
 *
 * 排障的时候最缺的从来不是「能不能查到」，而是「用户说的那句『点了没反应』
 * 背后到底发生了什么」—— 版本、配置、节点数、最近几条插件警告。
 * 这些信息用户自己拼不出来，只能靠插件收集。
 *
 * ## 两条硬边界
 *
 * 1. **不联网、不上报。** 这里只把文本拼出来丢进剪贴板，
 *    连一个 HTTP 请求都没有，更不会偷偷发到哪儿去。
 *    排障信息里可能带着用户的文档标题和节点文字，那是用户自己的东西。
 * 2. **不拦截、不改写。** 对 `console.warn` / `console.error` 只做「顺带记一份」，
 *    原样继续往下传。任何情况下都不该因为「记日志」而吞掉一条真正的日志。
 */

/** 最多留多少条 —— 排障看的是「最近发生了什么」，不是完整日志 */
const MAX = 24;

interface Note {
    at: number;
    level: string;
    text: string;
}

const notes: Note[] = [];
let installed = false;

/** 把参数压成一行可读文本（对象走 JSON，异常带上 message） */
function stringify(args: unknown[]): string {
    return args
        .map((a) => {
            if (typeof a === "string") return a;
            if (a instanceof Error) return `${a.name}: ${a.message}`;
            try {
                return JSON.stringify(a);
            } catch {
                return String(a);
            }
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 400);
}

/**
 * 装一次 console 转发。**幂等** —— 重复调用只会生效一次
 * （插件热重载 / 多次 onload 时不会套娃）。
 *
 * 只收带 `[mindmap]` 前缀的：插件自己的失败分支都是 `console.warn("[mindmap] …")`，
 * 而思源本体和别的插件也会往 console 里写一大堆东西，全收进来会把真正有用的挤掉。
 */
export function installDiagnostics() {
    if (installed) return;
    installed = true;
    for (const level of ["warn", "error"] as const) {
        const orig = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            try {
                const text = stringify(args);
                if (text.includes("[mindmap]")) {
                    notes.push({ at: Date.now(), level, text });
                    if (notes.length > MAX) notes.shift();
                }
            } catch {
                /* 记录本身失败绝不能影响原日志 */
            }
            orig(...args);
        };
    }
}

export function recentNotes(): Note[] {
    return notes.slice();
}

export function clearNotes() {
    notes.length = 0;
}

function hhmmss(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 把最近的警告 / 错误排成几行 */
export function formatNotes(): string {
    if (notes.length === 0) return "（本次会话没有 [mindmap] 警告或错误）";
    return notes.map((n) => `  ${hhmmss(n.at)} [${n.level}] ${n.text}`).join("\n");
}

/** 完整时间戳，给诊断信息的抬头用 */
export function stamp(ms = Date.now()): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
