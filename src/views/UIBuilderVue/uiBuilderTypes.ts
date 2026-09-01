/* UI 构造器引擎句柄类型(引擎文件为 @ts-nocheck 移植,类型在此声明)。 */

export interface UIBuilderEngineHandle {
  /** 销毁引擎:移除全部窗口/文档级监听并取消预览动画循环。 */
  destroy(): void
}