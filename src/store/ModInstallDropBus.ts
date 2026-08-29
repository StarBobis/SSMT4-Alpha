/* ═══════════════════════════════════════════════════════════════
   Mod 安装拖放交接 — 主页/模组管理页专用
   ═══════════════════════════════════════════════════════════════
   在「默认主页」(/) 拖入压缩包或文件夹时,Home 把路径写入这里并
   跳转到 /mods;ModsManagement 消费这些路径并走正常的安装预览/
   批量安装流程。只有主页与模组管理页会触发拖拽安装,其他页面
   (芝士猫工作目录、工作台帧分析等)各自处理自己的拖放语义。
   ═══════════════════════════════════════════════════════════════ */

const pendingPaths: string[] = []

/** 记录从主页转交过来的待安装路径(调用方负责去重)。 */
export const handOffModInstallDrop = (paths: string[]): void => {
  pendingPaths.splice(0, pendingPaths.length, ...paths)
}

/** 取出并清空待安装路径;没有转交时返回空数组。 */
export const takePendingModInstallDrop = (): string[] => {
  if (pendingPaths.length === 0) return []
  const taken = pendingPaths.splice(0)
  return taken
}