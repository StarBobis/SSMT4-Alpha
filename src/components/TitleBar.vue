<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { getAlwaysOnTop, setAlwaysOnTop } from '../store/WindowPinStore';

const appWindow = getCurrentWindow();
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const isMaximized = ref(false);
const isPinned = ref(false);
const appVersion = ref('');

const checkMaximized = async () => {
    isMaximized.value = await appWindow.isMaximized();
};

let unlistenResize: (() => void) | null = null;

onMounted(async () => {
    checkMaximized();
    void getVersion()
        .then(version => {
            appVersion.value = version;
        })
        .catch(error => {
            console.error('Failed to get app version:', error);
        });
    // Listen to resize event to update maximized state icon
    unlistenResize = await appWindow.onResized(() => {
        checkMaximized();
    });
    // Restore always-on-top state
    try {
        const pinned = await getAlwaysOnTop();
        if (pinned) {
            isPinned.value = true;
            await appWindow.setAlwaysOnTop(true);
        }
    } catch (e) {
        console.error('Failed to restore always-on-top state', e);
    }
});

onUnmounted(() => {
    if (unlistenResize) {
        unlistenResize();
    }
});

const minimize = () => appWindow.minimize();
const toggleMaximize = async () => {
    await appWindow.toggleMaximize();
    checkMaximized();
};
const close = () => appWindow.close();
const startDrag = () => {
    appWindow.startDragging();
};

const togglePin = async () => {
    const newVal = !isPinned.value;
    isPinned.value = newVal;
    await appWindow.setAlwaysOnTop(newVal);
    await setAlwaysOnTop(newVal);
};

const toggleSettingsPage = () => {
    if (route.path === '/settings') {
        if (window.history.length > 1) {
            router.back();
        } else {
            router.push('/');
        }
    } else {
        if (route.path === '/games') {
            router.replace('/settings');
        } else {
            router.push('/settings');
        }
    }
};
</script>

<template>
    <div class="caption-bar">
        <!-- Product brand (display only — drags fall through to the drag region) -->
        <div class="caption-brand">
            <img class="caption-brand-icon" src="/icon.png" alt="" draggable="false" />
            <span class="caption-brand-name">SSMT4</span>
            <span v-if="appVersion" class="caption-brand-version">v{{ appVersion }}</span>
        </div>

        <!-- Drag region (window move) -->
        <div class="caption-drag-region" data-tauri-drag-region @mousedown="startDrag"></div>

        <!-- Window controls (WinUI3 caption buttons) -->
        <div class="caption-controls">
            <el-tooltip :content="isPinned ? t('titlebar.unpinWindow') : t('titlebar.pinWindow')" placement="bottom" :show-after="250">
                <button
                    type="button"
                    class="caption-button pin-button"
                    :class="{ active: isPinned }"
                    :aria-label="isPinned ? t('titlebar.unpinWindow') : t('titlebar.pinWindow')"
                    @click="togglePin"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M16 3L21 8 18 11 19 16 14 14 11 17H8L4 21 3 20 7 16V13L10 10 8 5 13 7 16 3Z"/>
                    </svg>
                </button>
            </el-tooltip>

            <el-tooltip :content="t('titlebar.settings')" placement="bottom" :show-after="250">
                <button
                    type="button"
                    class="caption-button settings-button"
                    :class="{ active: route.path === '/settings' }"
                    :aria-label="t('titlebar.settings')"
                    @click="toggleSettingsPage"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.82 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                </button>
            </el-tooltip>

            <button type="button" class="caption-button" :aria-label="t('titlebar.windowControls.minimize')" @click="minimize">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
                    <path d="M0,5 L10,5 L10,6 L0,6 Z" />
                </svg>
            </button>

            <button type="button" class="caption-button" :aria-label="t('titlebar.windowControls.maximize')" @click="toggleMaximize">
                <svg v-if="!isMaximized" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
                    <path d="M1,1 L9,1 L9,9 L1,9 L1,1 Z M0,0 L0,10 L10,10 L10,0 L0,0 Z" />
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
                    <path d="M2.1,0v2H0v8.1h8.2v-2h2V0H2.1z M7.2,9.2H1V3h6.1V9.2z M9.2,7.1h-1V2H3.1V1h6.1V7.1z" />
                </svg>
            </button>

            <button type="button" class="caption-button close-button" :aria-label="t('titlebar.windowControls.close')" @click="close">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
                    <path d="M1,0 L5,4 L9,0 L10,1 L6,5 L10,9 L9,10 L5,6 L1,10 L0,9 L4,5 L0,1 L1,0 Z" />
                </svg>
            </button>
        </div>
    </div>
</template>

<style scoped>
.caption-bar {
    position: relative;
    height: 32px;
    flex: 0 0 auto;
    display: flex;
    align-items: stretch;
    justify-content: flex-start;
    user-select: none;
    z-index: 30;
    /* Soft scrim keeps caption glyphs readable over bright game backgrounds
       without hiding the background like the old opaque titlebar did. */
    background: var(--shell-caption-scrim);
}

.caption-drag-region {
    position: absolute;
    inset: 0;
    cursor: default;
}

/* Product brand — left side of the caption bar */
.caption-brand {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 100%;
    padding: 0 10px;
    /* Let window dragging work through the brand area */
    pointer-events: none;
    user-select: none;
}

.caption-brand-icon {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    filter: drop-shadow(var(--shell-caption-glyph-shadow));
}

.caption-brand-name {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--shell-caption-fg);
    text-shadow: var(--shell-caption-glyph-shadow);
}

.caption-brand-version {
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.03em;
    color: var(--shell-caption-fg);
    opacity: 0.62;
    text-shadow: var(--shell-caption-glyph-shadow);
}

.caption-controls {
    position: relative;
    display: flex;
    align-items: stretch;
    height: 100%;
    margin-left: auto;
    z-index: 1;
}

/* WinUI3 caption button: 46x32, subtle hover fill, instant press feedback */
.caption-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--shell-caption-fg);
    cursor: default;
    transition: background-color 83ms ease, color 83ms ease;
}

.caption-button svg {
    display: block;
    fill: currentColor;
    filter: drop-shadow(var(--shell-caption-glyph-shadow));
}

.caption-button:hover {
    background: var(--shell-caption-btn-hover);
}

.caption-button:active {
    background: var(--shell-caption-btn-pressed);
}

/* Pin button */
.pin-button svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    transition: transform 167ms cubic-bezier(0.16, 1, 0.3, 1);
}

.pin-button.active {
    color: var(--shell-caption-fg);
    background: var(--shell-caption-btn-hover);
}

.pin-button.active svg {
    fill: currentColor;
    transform: rotate(-45deg);
}

/* Settings button (right of pin) */
.settings-button svg {
    fill: none;
    stroke: currentColor;
    transition: transform 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

.settings-button:hover svg {
    transform: rotate(40deg);
}

.settings-button.active {
    color: var(--shell-caption-fg);
    background: var(--shell-caption-btn-hover);
}

/* Close button — Windows red */
.close-button:hover {
    background: var(--shell-caption-close-hover);
    color: #ffffff;
}

.close-button:active {
    background: var(--shell-caption-close-pressed);
    color: #ffffff;
}

.close-button:hover svg,
.close-button:active svg {
    filter: none;
}
</style>
