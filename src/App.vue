<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { AppStateManager, BGType } from "./store/AppStateManager";
import { normalizeAppUiScale, type PageVisibilitySettings } from "./store/AppSettings";
import TitleBar from "./components/TitleBar.vue";
import { useI18n } from 'vue-i18n';

const route = useRoute();
const appSettings = AppStateManager.appSettings;
const { t } = useI18n();
const selectedFirstRunRole = ref<'author' | 'player' | 'both' | null>(null);
const firstRunStep = ref(0);
const firstRunStepCount = 2;
const firstRunRoleVisibility: Record<'author' | 'player' | 'both', PageVisibilitySettings> = {
  author: { work: true, markTexture: true, mods: false, gameBanana: false, nexusMods: false, xianzun: false, uiBuilder: true },
  player: { work: false, markTexture: false, mods: true, gameBanana: true, nexusMods: true, xianzun: true, uiBuilder: false },
  both: { work: true, markTexture: true, mods: true, gameBanana: true, nexusMods: true, xianzun: true, uiBuilder: true },
};
const firstRunPageLabels: Array<{ id: keyof PageVisibilitySettings; labelKey: string }> = [
  { id: 'work', labelKey: 'titlebar.nav.work' },
  { id: 'markTexture', labelKey: 'titlebar.nav.markTexture' },
  { id: 'mods', labelKey: 'titlebar.nav.mods' },
  { id: 'gameBanana', labelKey: 'titlebar.nav.gameBanana' },
  { id: 'nexusMods', labelKey: 'titlebar.nav.nexusMods' },
  { id: 'xianzun', labelKey: 'titlebar.nav.xianzun' },
  { id: 'uiBuilder', labelKey: 'titlebar.nav.uiBuilder' },
];
const selectedFirstRunPages = computed(() => {
  if (!selectedFirstRunRole.value) return [t('titlebar.nav.home')];
  const visibility = firstRunRoleVisibility[selectedFirstRunRole.value];
  return [t('titlebar.nav.home'), ...firstRunPageLabels.filter(page => visibility[page.id]).map(page => t(page.labelKey))];
});
const confirmFirstRunRole = async () => {
  if (!selectedFirstRunRole.value) return;
  await AppStateManager.completeFirstRunOnboarding(firstRunRoleVisibility[selectedFirstRunRole.value]);
};
const advanceFirstRun = () => {
  if (firstRunStep.value === 0 && selectedFirstRunRole.value) firstRunStep.value = 1;
};
const retreatFirstRun = () => {
  if (firstRunStep.value > 0) firstRunStep.value -= 1;
};
const isHomeRoute = computed(() => route.path === '/');
const shouldShowGlobalDimLayer = computed(() => (
  route.path === '/games'
  || route.path === '/settings'
  || route.path === '/mods'
  || route.path === '/work'
  || route.path === '/mark-texture-full'
  || route.path === '/xianzun'
  || route.path === '/ui-builder'
  || route.path.startsWith('/gamebanana')
  || route.path.startsWith('/nexusmods')
));

const mainContentStyle = computed(() => {
  if (isHomeRoute.value) {
    return {
      '--content-bg-opacity': 0,
    };
  }

  return {
    '--content-bg-opacity': appSettings.contentOpacity,
  };
});

const clamp = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
};

const globalDimLayerBackground = computed(() => {
  const strength = clamp(Number(appSettings.globalDimMaskStrength ?? 1), 0, 4);
  const center = clamp(0.12 * strength, 0, 0.48).toFixed(3);
  const middle = clamp(0.24 * strength, 0, 0.86).toFixed(3);
  const edge = clamp(0.34 * strength, 0, 0.96).toFixed(3);

  return `radial-gradient(circle at 50% 50%, rgba(0, 0, 0, ${center}) 0%, rgba(0, 0, 0, ${middle}) 52%, rgba(0, 0, 0, ${edge}) 100%)`;
});

const appUiScale = computed(() => normalizeAppUiScale(appSettings.uiScale));

const normalizeStoredAppUiScale = (value: number) => {
  const normalizedScale = normalizeAppUiScale(value);
  if (appSettings.uiScale !== normalizedScale) {
    appSettings.uiScale = normalizedScale;
  }
};

watch(() => appSettings.uiScale, normalizeStoredAppUiScale, { immediate: true });
 
 
// Disable default right-click context menu
const preventContextMenu = (event: Event) => {
  event.preventDefault();
};

onMounted(() => {
  document.addEventListener('contextmenu', preventContextMenu);
});

onUnmounted(() => {
  document.removeEventListener('contextmenu', preventContextMenu);
});

/* bgStyle removed, handled in template */
</script>

<template>
  <!-- Background Layer -->
  <div class="bg-layer">
    <transition-group name="bg-trans">
      <!-- Image Background -->
      <div 
        v-if="appSettings.bgType === BGType.Image && appSettings.bgImage"
        :key="appSettings.bgImage"
        class="bg-item"
        :style="{ backgroundImage: `url(${appSettings.bgImage})` }"
      ></div>

      <!-- Video Background -->
      <video 
        v-if="appSettings.bgType === BGType.Video && appSettings.bgVideo" 
        :key="appSettings.bgVideo"
        :src="appSettings.bgVideo" 
        autoplay loop muted playsinline 
        class="bg-item"
      ></video>
    </transition-group>
  </div>
  
  <!-- Home Ambient Shadow Layer -->
  <div class="home-shadow-layer" v-if="route.path === '/'"></div>

  <!-- Global Mask Layer for Game Library Page -->
  <transition name="fade">
    <div
      v-if="shouldShowGlobalDimLayer"
      class="global-dim-layer"
      :style="{ background: globalDimLayerBackground }"
    ></div>
  </transition>

  <el-config-provider>
    <TitleBar />

    <div v-if="AppStateManager.isFirstRunOnboardingOpen.value" class="first-run-overlay">
      <section class="first-run-dialog" role="dialog" aria-modal="true" :aria-label="t('firstRun.title')">
        <header>
          <span class="first-run-kicker">SSMT4</span>
          <h2>{{ t('firstRun.title') }}</h2>
          <p>{{ t(`firstRun.steps.${firstRunStep}.description`) }}</p>
        </header>
        <div class="first-run-progress" :aria-label="t('firstRun.progress')">
          <span v-for="index in firstRunStepCount" :key="index" :class="{ 'is-active': index - 1 <= firstRunStep }"></span>
        </div>
        <div v-if="firstRunStep === 0" class="first-run-role-grid">
            <button
              v-for="role in (['author', 'player', 'both'] as const)"
              :key="role"
              type="button"
              class="first-run-role"
              :class="{ 'is-selected': selectedFirstRunRole === role }"
              @click="selectedFirstRunRole = role"
            >
              <strong>{{ t(`firstRun.roles.${role}`) }}</strong>
              <span>{{ t(`firstRun.roleDescriptions.${role}`) }}</span>
            </button>
        </div>
        <template v-else>
          <div class="first-run-preview">
            <span>{{ t('firstRun.visiblePages') }}</span>
            <div><em v-for="page in selectedFirstRunPages" :key="page">{{ page }}</em></div>
          </div>
          <p class="first-run-settings-hint">{{ t('firstRun.settingsHint') }}</p>
        </template>
        <footer class="first-run-actions">
          <el-button v-if="firstRunStep > 0" @click="retreatFirstRun">{{ t('firstRun.back') }}</el-button>
          <span></span>
          <el-button v-if="firstRunStep < firstRunStepCount - 1" type="primary" :disabled="!selectedFirstRunRole" @click="advanceFirstRun">{{ t('firstRun.next') }}</el-button>
          <el-button v-else type="primary" @click="confirmFirstRunRole">{{ t('firstRun.confirm') }}</el-button>
        </footer>
      </section>
    </div>

    <div class="app-ui-scale" :style="{ '--app-ui-scale': appUiScale }">
      <!-- Use a Flex Layout Container -->
      <div class="app-layout">
        <!-- 1. Main Content Area (Flex grow, takes remaining space) -->
        <div class="app-content-area">
          <main class="app-main" :style="mainContentStyle">
            <div class="content-scroll-wrapper glass-scrollbar" :class="{ 'no-scroll': route.path === '/' }">
              <router-view v-slot="{ Component }">
                <transition name="page-blur">
                  <KeepAlive>
                    <component :is="Component" />
                  </KeepAlive>
                </transition>
              </router-view>
            </div>
          </main>
        </div>
      </div>
    </div>
  </el-config-provider>
</template>

<style>
/* Global Resets */
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;

  /* Disable text selection */
  user-select: none;

  /* Cyberpunk Black Fallback: Deep dark with subtle neon glows */
  background-color: #030305;
  background-image: 
    radial-gradient(circle at 50% 50%, rgba(60, 20, 100, 0.2) 0%, transparent 60%),
    radial-gradient(circle at 50% 50%, rgba(0, 100, 180, 0.1) 0%, transparent 70%);

  overflow: hidden;
}

/* Re-enable selection for inputs */
input, textarea {
  user-select: text;
}

#app {
  position: fixed;
  inset: 0;
  width: auto;
  height: auto;
  margin: 0;
  overflow: hidden;
}
.bg-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  overflow: hidden;
  background-color: #050505;
}

/* Background Transition Items */
.bg-item {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background-size: cover;
  background-position: center;
  will-change: opacity;
}

/* Transition Classes */
.bg-trans-enter-active,
.bg-trans-leave-active {
  transition: opacity 0.6s ease; /* Smooth 0.6s fade */
}

.bg-trans-enter-from,
.bg-trans-leave-to {
  opacity: 0;
}

.home-shadow-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0; /* On top of bg-layer (also 0, but later in DOM), behind app-container (1) */
  pointer-events: none;
  /* 
     Fix: Removed 'multiply' blend mode which made things look dirty.
     New Style: Clean cinematic vignette + bottom fade for UI readability.
     Keeps the center bright and clean.
  */
  background: 
    /* 1. Seamless smooth fade from bottom (for potential footer text) */
    linear-gradient(to top, rgba(0, 0, 0, 0.5) 0%, transparent 25%),
    
    /* 2. Very subtle cinematic vignette (corners only, center is pure clean) */
    radial-gradient(circle at 50% 50%, transparent 75%, rgba(0, 0, 0, 0.4) 140%);
}

.global-dim-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0; /* Above bg-layer (0 via DOM order), below App Content (1) */
  pointer-events: none; /* Let clicks pass through if needed, though standard bg doesn't need interactions */
}

</style>

<style scoped>
.first-run-overlay {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(3, 6, 12, 0.68);
  backdrop-filter: blur(12px);
}

.first-run-dialog {
  width: min(680px, calc(100vw - 48px));
  padding: 26px;
  border: var(--t-card-dark-border);
  border-radius: 18px;
  background: var(--t-card-dark-bg);
  box-shadow: var(--t-card-dark-shadow);
}

.first-run-dialog header h2 { margin: 5px 0 8px; font-size: 22px; }
.first-run-dialog header p, .first-run-settings-hint { color: rgba(255,255,255,.62); line-height: 1.55; }
.first-run-kicker { color: rgba(117,214,187,.9); font-size: 11px; font-weight: 800; letter-spacing: .14em; }
.first-run-role-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 20px 0; }
.first-run-role { min-height: 94px; padding: 14px; border: 1px solid rgba(255,255,255,.11); border-radius: 12px; background: rgba(255,255,255,.035); color: white; text-align: left; cursor: pointer; }
.first-run-role strong, .first-run-role span { display: block; }
.first-run-role span { margin-top: 7px; color: rgba(255,255,255,.55); font-size: 12px; line-height: 1.45; }
.first-run-role.is-selected { border-color: rgba(117,214,187,.65); background: rgba(117,214,187,.13); }
.first-run-preview { padding: 14px; border-radius: 12px; background: rgba(255,255,255,.035); }
.first-run-preview > span { color: rgba(255,255,255,.56); font-size: 12px; }
.first-run-preview div { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
.first-run-preview em { padding: 5px 9px; border-radius: 999px; background: rgba(255,255,255,.08); color: rgba(255,255,255,.9); font-size: 12px; font-style: normal; }
.first-run-progress { display: flex; gap: 6px; margin-top: 18px; }
.first-run-progress span { flex: 1; height: 3px; border-radius: 3px; background: rgba(255,255,255,.1); }
.first-run-progress span.is-active { background: rgba(117,214,187,.72); }
.first-run-actions { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; margin-top: 18px; }

@media (max-width: 620px) { .first-run-role-grid { grid-template-columns: 1fr; } }

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
  position: relative;
  z-index: 1; /* Above bg */
  padding-top: calc(32px / var(--app-ui-scale, 1)); /* Space for fixed TitleBar */
  box-sizing: border-box;
}

.app-ui-scale {
  position: absolute;
  top: 0;
  left: 0;
  width: calc(100% / var(--app-ui-scale, 1));
  height: calc(100% / var(--app-ui-scale, 1));
  transform: scale(var(--app-ui-scale, 1));
  transform-origin: top left;
}

/* New wrapper for content area (flex item) */
.app-content-area {
  position: absolute;
  inset: calc(32px / var(--app-ui-scale, 1)) 0 0;
  min-height: 0;
  overflow: hidden; /* Clean cut */
  display: flex;
  flex-direction: column;
}

/* Main Content Styles */
.app-main {
  position: absolute;
  inset: 0;
  padding: 0;
  box-sizing: border-box;
  overflow: hidden;
  background-color: rgba(0, 0, 0, var(--content-bg-opacity, 0.4));
  color: #ffffff;
}

.content-scroll-wrapper {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden; /* Prevent flash of horizontal bar during transitions */

  /* 
  杩欓噷娉ㄦ剰鍟婏紝scrollbar-gutter鍗冧竾涓嶈鍔燽oth-edges
  鍚﹀垯浼氬鑷?宸﹀彸涓や晶鐨勬粦鏉′綅缃?琚己鍒剁┖鍑烘潵涓€鍧楀効
  瀵艰嚧瑙嗚鏁堟灉涓嶄匠
  */
  scrollbar-gutter: stable ; /* Reserve space to avoid scrollbar flicker */
  box-sizing: border-box; /* Ensures padding doesn't cause overflow */
  /* position:relative intentionally NOT set here — .app-main (parent) already has it,
     and this would create a containing block that clips absolutely-positioned
     children (dropdowns, context menus) via overflow-y:auto */
}



.no-scroll {
  overflow-y: hidden;
}

/* Glassmorphism for Element Plus Components */
:deep(.el-card) {
  background-color: rgba(30, 30, 30, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #ffffff;
  --el-card-bg-color: transparent;
}
:deep(.el-card__header) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #fff;
}
/* Form Labels */
:deep(.el-form-item__label) {
  color: #e0e0e0;
}

/* Page Transition Effects */
.page-blur-enter-active,
.page-blur-leave-active {
  transition: all 0.2s ease-out; /* 鎭㈠ 0.2s 杩囨浮 */
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.page-blur-enter-from {
  opacity: 0;
  transform: scale(0.98);
}

.page-blur-leave-to {
  opacity: 0;
  transform: scale(1);
}


</style>

