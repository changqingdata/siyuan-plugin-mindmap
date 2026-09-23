/**
 * 测试脚本的 Node 全局声明。
 *
 * `tests/*.ts` 由 `tests/run.mjs` 打包后在 Node 里跑，但项目刻意不引
 * `@types/node` —— 运行时零依赖（`dependencies` 是空的），
 * devDependencies 只有 esbuild / siyuan / typescript 三样。
 *
 * 目前只用到 `process.exitCode` 这一个 Node 全局。为一个字段拖进整套
 * `@types/node`（几百个声明）不划算，所以在这里显式声明用到的部分。
 *
 * 顺带的好处：以后要在测试里用新的 Node 能力（`process.env`、`Buffer`、
 * `__dirname`…），类型检查会先在这里拦一下 —— 得先表态「确实要用」，
 * 而不是随手写一个在浏览器里会 undefined 的全局。
 */
declare const process: {
    /** 进程退出码。测试汇总里用它把失败传给 CI（不能直接 process.exit，会吞掉输出）。 */
    exitCode: number;
};
