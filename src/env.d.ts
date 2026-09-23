/**
 * 构建期注入的常量（见 `scripts/build.mjs` 的 `define`）。
 *
 * 声明单独放一个文件，是为了让「这个标识符是构建时替换的、不是运行时的全局变量」
 * 一眼可见 —— 直接 `declare const` 在某个业务文件里会让人以为是运行时的东西。
 */
declare const __MM_VERSION__: string;
