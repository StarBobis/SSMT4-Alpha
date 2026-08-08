<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute } from "vue-router";
import { AppStateManager, BGType } from "./store/AppStateManager";
import { normalizeAppUiScale } from "./store/AppSettings";
import TitleBar from "./components/TitleBar.vue";

const route = useRoute();
const appSettings = AppStateManager.appSettings;
const isHomeRoute = computed(() => route.path === '/');
const shouldShowGlobalDimLayer = computed(() => (
  route.path === '/games'
  || route.path === '/settings'
  || route.path === '/mods'
  || route.path === '/work'
  || route.path === '/mark-texture-full'
  || route.path === '/xianzun'
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

  <div class="app-ui-scale" :style="{ '--app-ui-scale': appUiScale }">
    <el-config-provider>
      <!-- Title Bar (fixed, outside flex flow so backdrop-filter always targets bg-layer) -->
      <TitleBar />

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
    </el-config-provider>
  </div>
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
  height: 100%;
  position: relative;
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
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
  position: relative;
  z-index: 1; /* Above bg */
  padding-top: 32px; /* Space for fixed TitleBar */
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
  flex: 1;
  width: 100%;
  overflow: hidden; /* Clean cut */
  position: relative;
  display: flex;
  flex-direction: column;
}

/* Main Content Styles */
.app-main {
  flex: 1;
  width: 100%;
  height: 100%;
  padding: 0;
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
  background-color: rgba(0, 0, 0, var(--content-bg-opacity, 0.4));
  color: #ffffff;
}

.content-scroll-wrapper {
  margin-top: 0;
  height: 100%;
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

