/**
 * S0-1 冒烟插件的 Host 侧。
 *
 * 只做一件事：证明第三方包的根入口能被 Loader 正确加载。
 * 形状对齐 DSH 自家的插件（如 dsh-persona）：具名导出 name / inject / apply。
 */

/** Cordis 插件名。 */
const name = 'dshbot-hello'

/** 不依赖任何 Host 服务。 */
const inject = []

/**
 * 挂载时打印一行，出现在 dsh 进程的 stdout 里。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
function apply(ctx) {
  console.log('[dshbot-hello] host side loaded, cwd=' + process.cwd())
}

export { apply, inject, name }
