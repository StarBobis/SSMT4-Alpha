<script setup lang="ts">
import { AppStateManager } from '../../store/AppStateManager'
import {
  APP_UI_SCALE_MAX,
  APP_UI_SCALE_MIN,
  APP_UI_SCALE_STEP,
  SSMTLocale,
} from '../../store/AppSettings'
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getVersion } from '@tauri-apps/api/app';
import { ref, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ArrowRight,
  Brush,
  ChatDotRound,
  Coffee,
  Document,
  FolderOpened,
  Key,
  Link,
  Lock,
  Monitor,
  Refresh,
  FullScreen,
  View,
} from '@element-plus/icons-vue';
import {
  checkAndInstallAppUpdate,
  isCheckingAppUpdate,
  isInstallingAppUpdate,
} from '../../common/AppSelfUpdate';

const appSettings = AppStateManager.appSettings;
const textureMarkStyleOptions = ['Hash', 'Slot', 'SharedSlot'] as const;
const { t } = useI18n();

const languageOptions = computed(() => [
  { value: SSMTLocale.en, label: t('settings.personalization.languageOptions.en') },
  { value: SSMTLocale.zhs, label: t('settings.personalization.languageOptions.zhs') },
]);

const appVersion = ref('1.0.0');

const formatMaskOpacity = (value: number) => `${value.toFixed(1)}x`;
const uiScalePercent = computed({
  get: () => Math.round(appSettings.uiScale * 100),
  set: (value: number) => {
    appSettings.uiScale = value / 100;
  },
});
const formatUiScale = (value: number) => `${value}%`;

const selectCacheDir = async () => {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: t('settings.general.selectCacheFolderTitle')
  });

  if (selected && typeof selected === 'string') {
    appSettings.DBMTWorkFolder = selected;
  }
};

onMounted(async () => {
  try {
    appVersion.value = await getVersion();
  } catch (e) {
    console.error('Failed to get version:', e);
  }
});

const openReleasePage = async () => {
  await openUrl('https://github.com/StarBobis/SSMT4-Alpha/releases');
};

const handleCheckAndInstallAppUpdate = async () => {
  await checkAndInstallAppUpdate('manual');
};

const openUsageDocs = async () => {
  await openUrl('https://starbobis.github.io/SSMT4-Documents/');
};
</script>

<template>
  <div class="settings-page">
    <div class="settings-shell">
      <div class="settings-layout">
        <main class="settings-main" :aria-label="t('settings.title')">
          <section class="settings-section">
            <div class="section-heading">
              <h2>{{ t('settings.sections.general') }}</h2>
              <p>{{ t('settings.sections.generalDesc') }}</p>
            </div>
            <div class="settings-group">
              <div class="setting-row setting-row-wide">
                <div class="setting-identity">
                  <span class="setting-icon"><el-icon><FolderOpened /></el-icon></span>
                  <div>
                    <div class="setting-label">{{ t('settings.general.cacheFolder') }}</div>
                    <div class="setting-description">{{ t('settings.hints.cacheFolder') }}</div>
                  </div>
                </div>
                <div class="setting-control path-control">
                  <el-input
                    v-model="appSettings.DBMTWorkFolder"
                    :aria-label="t('settings.general.cacheFolder')"
                    :placeholder="t('settings.general.cacheFolderPlaceholder')"
                    readonly
                  />
                  <el-button @click="selectCacheDir">
                    <el-icon><FolderOpened /></el-icon>
                    <span>{{ t('settings.general.changeFolder') }}</span>
                  </el-button>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-identity">
                  <span class="setting-icon"><el-icon><Lock /></el-icon></span>
                  <div>
                    <div class="setting-label">{{ t('settings.general.githubToken') }}</div>
                    <div class="setting-description">{{ t('settings.hints.githubToken') }}</div>
                  </div>
                </div>
                <div class="setting-control">
                  <el-input
                    v-model="appSettings.githubToken"
                    :aria-label="t('settings.general.githubToken')"
                    :placeholder="t('settings.general.githubTokenPlaceholder')"
                    type="password"
                    show-password
                  />
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-identity">
                  <span class="setting-icon"><el-icon><Key /></el-icon></span>
                  <div>
                    <div class="setting-label">{{ t('settings.general.showWindowShortcut') }}</div>
                    <div class="setting-description">{{ t('settings.hints.showWindowShortcut') }}</div>
                  </div>
                </div>
                <div class="setting-control compact-control">
                  <el-switch
                    v-model="appSettings.showWindowShortcutEnabled"
                    :aria-label="t('settings.general.showWindowShortcut')"
                  />
                </div>
              </div>
            </div>
          </section>

          <section class="settings-section">
            <div class="section-heading">
              <h2>{{ t('settings.sections.appearance') }}</h2>
              <p>{{ t('settings.sections.appearanceDesc') }}</p>
            </div>
            <div class="settings-group">
              <div class="setting-row">
                <div class="setting-identity">
                  <span class="setting-icon"><el-icon><Monitor /></el-icon></span>
                  <div>
                    <div class="setting-label">{{ t('settings.personalization.language') }}</div>
                    <div class="setting-description">{{ t('settings.hints.language') }}</div>
                  </div>
                </div>
                <div class="setting-control compact-control">
                  <el-select
                    v-model="appSettings.locale"
                    :aria-label="t('settings.personalization.language')"
                  >
                    <el-option
                      v-for="item in languageOptions"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </el-select>
                </div>
              </div>

              <div class="setting-row">
                <div class="setting-identity">
                  <span class="setting-icon"><el-icon><Brush /></el-icon></span>
                  <div>
                    <div class="setting-label">{{ t('settings.personalization.textureMarkStyle') }}</div>
                    <div class="setting-description">{{ t('settings.hints.textureMarkStyle') }}</div>
                  </div>
                </div>
                <div class="setting-control compact-control">
                  <el-select
                    v-model="appSettings.textureMarkStylePreference"
                    :aria-label="t('settings.personalization.textureMarkStyle')"
                  >
                    <el-option
                      v-for="item in textureMarkStyleOptions"
                      :key="item"
                      :label="item"
                      :value="item"
                    />
                  </el-select>
                </div>
              </div>

              <div class="setting-row setting-row-slider">
                <div class="setting-identity">
                  <span class="setting-icon"><el-icon><FullScreen /></el-icon></span>
                  <div>
                    <div class="setting-label">{{ t('settings.personalization.uiScale') }}</div>
                    <div class="setting-description">{{ t('settings.personalization.uiScaleHint') }}</div>
                  </div>
                </div>
                <div class="setting-control ui-scale-control">
                  <el-slider
                    v-model="uiScalePercent"
                    :aria-label="t('settings.personalization.uiScale')"
                    :min="APP_UI_SCALE_MIN * 100"
                    :max="APP_UI_SCALE_MAX * 100"
                    :step="APP_UI_SCALE_STEP * 100"
                    :format-tooltip="formatUiScale"
                  />
                  <output class="scale-value">{{ formatUiScale(uiScalePercent) }}</output>
                </div>
              </div>

              <div class="setting-row setting-row-slider">
                <div class="setting-identity">
                  <span class="setting-icon"><el-icon><View /></el-icon></span>
                  <div>
                    <div class="setting-label">{{ t('settings.personalization.backgroundMaskOpacity') }}</div>
                    <div class="setting-description">{{ t('settings.personalization.backgroundMaskOpacityHint') }}</div>
                  </div>
                </div>
                <div class="setting-control mask-opacity-control">
                  <el-slider
                    v-model="appSettings.globalDimMaskStrength"
                    :aria-label="t('settings.personalization.backgroundMaskOpacity')"
                    :min="0"
                    :max="4"
                    :step="0.1"
                    :format-tooltip="formatMaskOpacity"
                    show-input
                    input-size="small"
                  />
                </div>
              </div>
            </div>
          </section>

        </main>

        <aside class="settings-sidebar" :aria-label="t('settings.sections.about')">
          <div class="about-panel">
            <div class="product-lockup">
              <img src="/icon.png" class="app-logo" alt="SSMT4" />
              <div>
                <h2>SSMT4</h2>
                <span class="app-version">V{{ appVersion }}</span>
              </div>
            </div>

            <el-button
              class="update-button"
              :loading="isCheckingAppUpdate || isInstallingAppUpdate"
              :aria-busy="isCheckingAppUpdate || isInstallingAppUpdate"
              @click="handleCheckAndInstallAppUpdate"
            >
              <el-icon><Refresh /></el-icon>
              <span>{{ isInstallingAppUpdate ? t('settings.actions.installingUpdate') : t('settings.actions.checkAppUpdate') }}</span>
            </el-button>

            <div class="about-section">
              <h3>{{ t('settings.sections.resources') }}</h3>
              <button type="button" class="link-row" @click="openReleasePage">
                <el-icon><Document /></el-icon>
                <span>{{ t('settings.about.releasePage') }}</span>
                <el-icon class="link-arrow"><ArrowRight /></el-icon>
              </button>
              <button type="button" class="link-row" @click="openUsageDocs">
                <el-icon><Link /></el-icon>
                <span>{{ t('settings.about.usageDocs') }}</span>
                <el-icon class="link-arrow"><ArrowRight /></el-icon>
              </button>
            </div>

            <div class="about-section">
              <h3>{{ t('settings.sections.community') }}</h3>
              <button type="button" class="link-row" @click="openUrl('https://discord.gg/hgzbSSXXz2')">
                <el-icon><ChatDotRound /></el-icon>
                <span>{{ t('settings.about.discord') }}</span>
                <el-icon class="link-arrow"><ArrowRight /></el-icon>
              </button>
            </div>

            <div class="about-section">
              <h3>{{ t('settings.about.sponsor') }}</h3>
              <button type="button" class="link-row" @click="openUrl('https://ifdian.net/a/NicoMico666')">
                <el-icon><Coffee /></el-icon>
                <span>{{ t('settings.about.afdian') }}</span>
                <el-icon class="link-arrow"><ArrowRight /></el-icon>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  padding: 28px 32px 40px;
  color: rgba(var(--theme-text-primary-rgb), 0.96);
}

.settings-shell {
  width: min(1180px, 100%);
  margin: 0 auto;
}

.setting-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: rgba(var(--theme-text-primary-rgb), 0.94);
  background: rgba(var(--theme-surface-tint-rgb), 0.11);
  border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.16);
}

.product-lockup h2,
.section-heading h2,
.about-section h3 {
  margin: 0;
  letter-spacing: 0;
}

.section-heading p {
  margin: 4px 0 0;
  color: rgba(var(--theme-text-secondary-rgb), 0.78);
  font-size: 13px;
  line-height: 1.45;
}

.settings-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 276px;
  gap: 28px;
  align-items: start;
}

.settings-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 26px;
}

.settings-section {
  min-width: 0;
}

.section-heading {
  margin: 0 4px 10px;
}

.section-heading h2 {
  font-size: 14px;
  line-height: 1.3;
  font-weight: 650;
}

.settings-group,
.about-panel {
  position: relative;
  overflow: hidden;
  border: var(--t-material-border);
  border-radius: 14px;
  background: var(--t-material-bg);
  box-shadow: var(--t-material-shadow);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.settings-group::before,
.about-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  z-index: 1;
  border-radius: 14px 14px 0 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent);
  pointer-events: none;
}

.setting-row {
  min-height: 78px;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(240px, 360px);
  gap: 24px;
  align-items: center;
  padding: 14px 18px;
  box-sizing: border-box;
}

.setting-row + .setting-row {
  border-top: 1px solid rgba(var(--theme-surface-tint-rgb), 0.10);
}

.setting-row-wide {
  grid-template-columns: minmax(220px, 0.8fr) minmax(300px, 1.2fr);
}

.setting-identity {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.setting-icon {
  width: 30px;
  height: 30px;
  margin-top: 1px;
  border-radius: 7px;
  font-size: 16px;
}

.setting-label {
  color: rgba(var(--theme-text-primary-rgb), 0.96);
  font-size: 13px;
  line-height: 1.4;
  font-weight: 600;
}

.setting-description {
  max-width: 520px;
  margin-top: 3px;
  color: rgba(var(--theme-text-secondary-rgb), 0.72);
  font-size: 12px;
  line-height: 1.45;
}

.setting-control {
  min-width: 0;
  width: 100%;
}

.compact-control {
  width: min(100%, 220px);
  justify-self: end;
}

.path-control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.path-control :deep(.el-input) {
  min-width: 0;
}

.path-control :deep(.el-button) {
  flex: 0 0 auto;
}

.action-control {
  display: flex;
  justify-content: flex-end;
}

.settings-page :deep(.el-input__wrapper),
.settings-page :deep(.el-select__wrapper) {
  min-height: 34px;
  border-radius: 7px;
  color: rgba(var(--theme-text-primary-rgb), 0.96);
  background: rgba(var(--theme-surface-tint-rgb), 0.065) !important;
  border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.15);
  box-shadow: none !important;
  transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.settings-page :deep(.el-input__wrapper:hover),
.settings-page :deep(.el-select__wrapper:hover) {
  background: rgba(var(--theme-surface-tint-rgb), 0.09) !important;
  border-color: rgba(var(--theme-surface-tint-rgb), 0.26);
}

.settings-page :deep(.el-input__wrapper.is-focus),
.settings-page :deep(.el-select__wrapper.is-focused) {
  border-color: rgba(var(--theme-surface-tint-rgb), 0.62);
  box-shadow: 0 0 0 3px rgba(var(--theme-surface-tint-rgb), 0.10) !important;
}

.settings-page :deep(.el-input__inner),
.settings-page :deep(.el-select__selected-item),
.settings-page :deep(.el-select__placeholder) {
  color: rgba(var(--theme-text-primary-rgb), 0.94);
  font-size: 13px;
}

.settings-page :deep(.el-input__inner::placeholder) {
  color: rgba(var(--theme-text-secondary-rgb), 0.62);
}

.settings-page :deep(.el-button) {
  min-height: 34px;
  border-radius: 7px;
  padding: 7px 13px;
  font-weight: 600;
  color: rgba(var(--theme-text-primary-rgb), 0.92);
  background: rgba(var(--theme-surface-tint-rgb), 0.09);
  border-color: rgba(var(--theme-surface-tint-rgb), 0.18);
  transition: background-color 160ms ease, border-color 160ms ease;
}

.settings-page :deep(.el-button:hover),
.settings-page :deep(.el-button:focus-visible) {
  color: rgba(var(--theme-text-primary-rgb), 1);
  background: rgba(var(--theme-surface-tint-rgb), 0.15);
  border-color: rgba(var(--theme-surface-tint-rgb), 0.34);
}

.mask-opacity-control :deep(.el-slider) {
  --el-slider-main-bg-color: rgba(var(--theme-text-primary-rgb), 0.88);
  --el-slider-runway-bg-color: rgba(var(--theme-surface-tint-rgb), 0.16);
  --el-slider-button-size: 16px;
}

.ui-scale-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px;
  align-items: center;
  gap: 12px;
}

.ui-scale-control :deep(.el-slider) {
  --el-slider-main-bg-color: rgba(var(--theme-text-primary-rgb), 0.88);
  --el-slider-runway-bg-color: rgba(var(--theme-surface-tint-rgb), 0.16);
  --el-slider-button-size: 16px;
}

.scale-value {
  color: rgba(var(--theme-text-primary-rgb), 0.9);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.mask-opacity-control :deep(.el-slider__input),
.mask-opacity-control :deep(.el-input-number) {
  width: 104px;
}

.mask-opacity-control :deep(.el-input-number__decrease),
.mask-opacity-control :deep(.el-input-number__increase) {
  color: rgba(var(--theme-text-primary-rgb), 0.84);
  background: rgba(var(--theme-surface-tint-rgb), 0.08);
}

.settings-sidebar {
  position: sticky;
  top: 20px;
  min-width: 0;
}

.about-panel {
  padding: 18px;
}

.product-lockup {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-logo {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
}

.product-lockup h2 {
  font-size: 18px;
  line-height: 1.25;
  font-weight: 700;
}

.app-version {
  display: block;
  margin-top: 2px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  color: rgba(var(--theme-text-secondary-rgb), 0.72);
}

.update-button {
  width: 100%;
  margin-top: 18px;
}

.about-section {
  padding-top: 18px;
  margin-top: 18px;
  border-top: 1px solid rgba(var(--theme-surface-tint-rgb), 0.10);
}

.about-section h3 {
  padding: 0 8px 7px;
  color: rgba(var(--theme-text-secondary-rgb), 0.78);
  font-size: 12px;
  line-height: 1.3;
  font-weight: 650;
}

.link-row {
  width: 100%;
  min-height: 36px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  border: 0;
  border-radius: 7px;
  color: rgba(var(--theme-text-primary-rgb), 0.88);
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
  transition: color 160ms ease, background-color 160ms ease;
}

.link-row span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.link-row:hover,
.link-row:focus-visible {
  color: rgba(var(--theme-text-primary-rgb), 1);
  background: rgba(var(--theme-surface-tint-rgb), 0.10);
}

.link-row:focus-visible {
  outline: 2px solid rgba(var(--theme-text-primary-rgb), 0.72);
  outline-offset: 1px;
}

.link-arrow {
  color: rgba(var(--theme-text-secondary-rgb), 0.62);
}

@media (max-width: 960px) {
  .settings-page {
    padding: 24px 22px 36px;
  }

  .settings-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-sidebar {
    position: static;
  }

  .about-panel {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0 22px;
  }

  .product-lockup,
  .update-button {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .settings-page {
    padding: 20px 14px 28px;
  }

  .setting-row,
  .setting-row-wide {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 16px;
  }

  .compact-control {
    width: 100%;
    justify-self: stretch;
  }

  .action-control {
    justify-content: stretch;
  }

  .action-control :deep(.el-button) {
    width: 100%;
  }

  .about-panel {
    display: block;
  }
}

@media (max-width: 480px) {
  .path-control {
    align-items: stretch;
    flex-direction: column;
  }

  .path-control :deep(.el-button) {
    width: 100%;
  }

  .setting-row-slider .mask-opacity-control :deep(.el-slider) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 96px;
    gap: 12px;
  }

  .mask-opacity-control :deep(.el-slider__input),
  .mask-opacity-control :deep(.el-input-number) {
    width: 96px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-page *,
  .settings-page *::before,
  .settings-page *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
</style>
