import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import { exists } from '@tauri-apps/plugin-fs'
import Home from '../views/Home/Home.vue'
import GameLibrary from '../views/GameLibrary/GameLibrary.vue'
import { PathHelper } from '../helper/PathHelper'
import { i18n } from '../i18n'
import { AppStateManager } from '../store/AppStateManager'

const t = i18n.global.t

const WorkPage = () => import('../views/WorkPage/WorkPage.vue')
const ModsManagement = () => import('../views/ModsManagement/ModsManagement.vue')
const GameBanana = () => import('../views/GameBanana/GameBanana.vue')
const GameBananaAuthor = () => import('../views/GameBanana/GameBananaAuthor.vue')
const NexusMods = () => import('../views/NexusMods/NexusMods.vue')
const MarkTextureFull = () => import('../views/MarkTexture/MarkTextureFull.vue')
const Settings = () => import('../views/Settings/Settings.vue')
const XianZun = () => import('../views/XianZun/XianZun.vue')
const UIBuilder = () => import('../views/UIBuilder/UIBuilder.vue')

const routes = [
  { path: '/', name: 'Home', component: Home, meta: { title: 'Home', requiresGame: false } },
  { path: '/games', name: 'GameLibrary', component: GameLibrary, meta: { title: 'Game Library', requiresGame: false } },
  { path: '/mods', name: 'ModsManagement', component: ModsManagement, meta: { title: 'Mods Management', requiresGame: true } },
  { path: '/gamebanana', name: 'GameBanana', component: GameBanana, meta: { title: 'GameBanana', requiresGame: false } },
  { path: '/gamebanana/author/:authorId', name: 'GameBananaAuthor', component: GameBananaAuthor, meta: { title: 'GameBanana Author', requiresGame: false } },
  { path: '/nexusmods', name: 'NexusMods', component: NexusMods, meta: { title: 'Nexus Mods', requiresGame: false } },
  { path: '/work', name: 'WorkPage', component: WorkPage, meta: { title: 'Work Page', requiresGame: true } },
  { path: '/mark-texture-full', name: 'MarkTextureFull', component: MarkTextureFull, meta: { title: 'Extraction Postprocess', requiresGame: true } },
  { path: '/settings', name: 'Settings', component: Settings, meta: { title: 'Settings', requiresGame: false } },
  { path: '/xianzun', name: 'XianZun', component: XianZun, meta: { title: '芝士猫', requiresGame: false } },
  { path: '/ui-builder', name: 'UIBuilder', component: UIBuilder, meta: { title: 'UI Builder', requiresGame: false } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  if (to.name === 'Home' && AppStateManager.hasLoadedInitialState() && !AppStateManager.hasSelectedGame()) {
    return { name: 'GameLibrary' }
  }

  const needMigotoPath = new Set(['WorkPage', 'MarkTextureFull'])
  if (!needMigotoPath.has(String(to.name ?? ''))) {
    return true
  }

  const current3DmigotoFolderPath = await PathHelper.GetCurrentGame3DmigotoFolderPath()
  if (current3DmigotoFolderPath && (await exists(current3DmigotoFolderPath))) {
    return true
  }

  ElMessage.warning(t('router.messages.configureMigotoPathFirst'))
  return { name: 'Home' }
})

export default router
