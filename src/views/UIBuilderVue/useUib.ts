/* ═══════════════════════════════════════════════════════════════
   UI 构造器 — 引擎命令访问入口(纯 Vue 模板事件绑定用)

   引擎(uiBuilderEngine.ts)启动后把全部命令挂到 window.UIB。
   各面板组件在模板中以 @click="uib.xxx(...)" 形式调用,
   这里用 Proxy 做惰性取值:引擎未启动时返回 undefined,
   启动后每次访问实时读取最新实现(含 defineProperty 的 getter)。
   ═══════════════════════════════════════════════════════════════ */

/* 引擎命令为动态命名空间(引擎文件本身 @ts-nocheck),此处按任意签名转发。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UibCommand = (...args: any[]) => any

/** window.UIB 的惰性代理,模板中直接使用:`@click="uib.toggleTheme()"`。 */
export const uib: Record<string, UibCommand | undefined> = new Proxy(
  {} as Record<string, UibCommand | undefined>,
  {
    get: (_target, prop: string) =>
      (window as unknown as { UIB?: Record<string, UibCommand> }).UIB?.[prop],
  },
)
