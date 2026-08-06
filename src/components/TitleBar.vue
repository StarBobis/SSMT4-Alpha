<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { getAlwaysOnTop, setAlwaysOnTop } from '../store/WindowPinStore';

const appWindow = getCurrentWindow();
const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const isMaximized = ref(false);
const isPinned = ref(false);

const checkMaximized = async () => {
    isMaximized.value = await appWindow.isMaximized();
};

let unlistenResize: (() => void) | null = null;

// --- Nav Button Logic ---
const STORAGE_KEY_NAV_ORDER = 'ssmt4_nav_order';

// interface NavButton {
//     id: string;
//     path: string;
//     label: string;
//     // We will render icon using conditional template or dynamic component if we extracted them
//     // For now, simpler to just use ID to switch in template or store SVG path
//     iconPath?: string; 
//     iconPolys?: string; // For complex SVGs
//     // Or just simple raw logic
// }

// We rely on stable IDs
interface NavItem { id: string; path: string; labelKey: string; iconType: string; label?: string }

const allNavItems = ref<NavItem[]>([
    { id: 'home', path: '/', labelKey: 'titlebar.nav.home', iconType: 'home' },
    { id: 'work', path: '/work', labelKey: 'titlebar.nav.work', iconType: 'work' },
    { id: 'mark-texture-full', path: '/mark-texture-full', labelKey: 'titlebar.nav.markTexture', iconType: 'mark-texture-full' },
    { id: 'mods', path: '/mods', labelKey: 'titlebar.nav.mods', iconType: 'mods' },
    { id: 'gamebanana', path: '/gamebanana', labelKey: 'titlebar.nav.gameBanana', iconType: 'gamebanana' },
]);

// Current order of IDs
const navOrder = ref<string[]>([]);

// Initialize Order
// Keep navOrder in sync with available items (adds new IDs, drops unknown ones)
const ensureNavOrderCompleteness = () => {
    const ids = allNavItems.value.map(i => i.id);
    // Drop unknown
    const cleaned = navOrder.value.filter(id => ids.includes(id));
    // Append new ids to the end to keep relative ordering predictable
    ids.forEach(id => {
        if (!cleaned.includes(id)) cleaned.push(id);
    });
    navOrder.value = cleaned;
};

const loadOrder = () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_NAV_ORDER);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                navOrder.value = parsed;
                ensureNavOrderCompleteness();
                saveOrder();
                return;
            }
        }
    } catch (e) { console.warn('Failed to load nav order', e); }
    
    // Default order
    navOrder.value = allNavItems.value.map(i => i.id);
};

const saveOrder = () => {
    localStorage.setItem(STORAGE_KEY_NAV_ORDER, JSON.stringify(navOrder.value));
};

// Computed display list
const displayItems = computed(() => {
    // strict order based on navOrder
    const map = new Map(allNavItems.value.map(i => [i.id, i]));
    const result: NavItem[] = [];
    
    // Add items in order
    navOrder.value.forEach(id => {
        const item = map.get(id);
        if (item) {
             result.push({ ...item, label: t(item.labelKey) });
        }
    });

    // Append any new items not in order (robustness)
    allNavItems.value.forEach(i => {
        if (!navOrder.value.includes(i.id)) {
             result.push({ ...i, label: t(i.labelKey) });
        }
    });
    
    return result;
});

// Manual drag state to bypass Tauri drag restrictions
const navHoverId = ref<string | null>(null);
const navDraggingId = ref<string | null>(null);
const navManualState = reactive({
    active: false,
    startX: 0,
    startY: 0,
    hasMoved: false,
    itemId: null as string | null,
});

const resetNavDrag = () => {
    navManualState.active = false;
    navManualState.hasMoved = false;
    navManualState.itemId = null;
    navHoverId.value = null;
    navDraggingId.value = null;
    document.body.style.userSelect = '';
};

const applyNavReorder = (sourceId: string, targetId: string) => {
    const oldIndex = navOrder.value.indexOf(sourceId);
    const newIndex = navOrder.value.indexOf(targetId);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = [...navOrder.value];
    newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, sourceId);
    navOrder.value = newOrder;
    saveOrder();
};

const onNavMouseDown = (e: MouseEvent, item: NavItem) => {
    if (e.button !== 0) return;
    navManualState.active = true;
    navManualState.startX = e.clientX;
    navManualState.startY = e.clientY;
    navManualState.hasMoved = false;
    navManualState.itemId = item.id;
    navDraggingId.value = item.id;
    document.addEventListener('mousemove', onNavMouseMove);
    document.addEventListener('mouseup', onNavMouseUp);
};

const onNavMouseMove = (e: MouseEvent) => {
    if (!navManualState.active || !navManualState.itemId) return;
    const dx = e.clientX - navManualState.startX;
    const dy = e.clientY - navManualState.startY;
    if (!navManualState.hasMoved && Math.hypot(dx, dy) > 3) {
        navManualState.hasMoved = true;
        document.body.style.userSelect = 'none';
    }

    if (navManualState.hasMoved) {
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const btn = el?.closest?.('.nav-button') as HTMLElement | null;
        const targetId = btn?.dataset.navId || null;
        if (targetId && targetId !== navManualState.itemId) {
            navHoverId.value = targetId;
        } else {
            navHoverId.value = null;
        }
    }
};

const onNavMouseUp = (_e: MouseEvent) => {
    document.removeEventListener('mousemove', onNavMouseMove);
    document.removeEventListener('mouseup', onNavMouseUp);

    if (navManualState.active && navManualState.hasMoved && navManualState.itemId && navHoverId.value && navHoverId.value !== navManualState.itemId) {
        applyNavReorder(navManualState.itemId, navHoverId.value);
    }

    resetNavDrag();
};

onMounted(async () => {
    checkMaximized();
    loadOrder();
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
    document.removeEventListener('mousemove', onNavMouseMove);
    document.removeEventListener('mouseup', onNavMouseUp);
    resetNavDrag();
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

const toggleGamePage = (e: MouseEvent) => {
    e.stopPropagation(); // prevent drag
    if (route.path === '/games') {
        if (window.history.length > 1) {
            router.back();
        } else {
            router.push('/');
        }
    } else {
        if (route.path === '/settings') {
            router.replace('/games');
        } else {
            router.push('/games');
        }
    }
};

const toggleSettingsPage = (e: MouseEvent) => {
    e.stopPropagation();
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

const navTo = (path: string) => {
    router.push(path);
};

const togglePin = async () => {
    const newVal = !isPinned.value;
    isPinned.value = newVal;
    await appWindow.setAlwaysOnTop(newVal);
    await setAlwaysOnTop(newVal);
};
</script>


<template>
  <div class="titlebar">
    <div class="nav-controls">
        <transition-group name="nav-list">
          <div
            v-for="item in displayItems"
            :key="item.id"
            class="nav-entry"
          >
            <el-tooltip
                :content="item.label"
                placement="bottom"
                :show-after="250"
            >
            <div
                class="nav-button"
                :class="{ active: route.path === item.path, 'drag-hover': navHoverId === item.id, dragging: navDraggingId === item.id }"
                :data-nav-id="item.id"
                @click="navTo(item.path)"
                @mousedown.prevent="onNavMouseDown($event, item)"
            >
                <!-- Icons -->
                <svg v-if="item.id === 'home'" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                
                <svg v-if="item.id === 'mods'" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>

                <svg v-if="item.id === 'gamebanana'" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10l2 4-2 12H7L5 8l2-4z"></path><path d="M9 4l1 4h4l1-4"></path><path d="M9 12h6"></path><path d="M10 16h4"></path></svg>

                <svg v-if="item.id === 'work'" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="3"></rect>
                    <path d="M9 4v16"></path>
                    <path d="M4 9h16"></path>
                    <path d="M12.5 14h4"></path>
                    <path d="M12.5 17h2.5"></path>
                </svg>

                <svg v-if="item.id === 'mark-texture-full'" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"></path><path d="M9 9h6"></path><path d="M9 13h6"></path><path d="M9 17h4"></path></svg>

                <span class="nav-text">{{ item.label }}</span>
            </div>
            </el-tooltip>
          </div>
        </transition-group>
    </div>

    <div class="drag-region" @mousedown="startDrag">
      <div class="title-content">
          <slot></slot>
      </div>
    </div>
    
        <div class="window-controls">
      <!-- Pin/Always-on-Top Toggle Button -->
    <el-tooltip :content="isPinned ? t('titlebar.unpinWindow') : t('titlebar.pinWindow')" placement="bottom" :show-after="250">
    <div class="control-button pin-button" :class="{ active: isPinned }" @click="togglePin">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 3L21 8 18 11 19 16 14 14 11 17H8L4 21 3 20 7 16V13L10 10 8 5 13 7 16 3Z"/>
        </svg>

    </div>
    </el-tooltip>

      <!-- Game List Toggle Button -->
    <el-tooltip :content="t('titlebar.switchToGameLibrary')" placement="bottom" :show-after="250">
    <div class="control-button game-list-toggle" :class="{ active: route.path === '/games' }" @click="toggleGamePage">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
      </div>
    </el-tooltip>

      <!-- Settings Button (Placed to right of Game Toggle) -->
    <el-tooltip :content="t('titlebar.settings')" placement="bottom" :show-after="250">
    <div class="control-button settings-btn" :class="{ active: route.path === '/settings' }" @click="toggleSettingsPage">
         <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.82 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
      </div>
    </el-tooltip>

      <div class="control-button minimize" @click="minimize">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
          <path d="M0,5 L10,5 L10,6 L0,6 Z" />
        </svg>
      </div>
      
      <div class="control-button maximize" @click="toggleMaximize">
        <svg v-if="!isMaximized" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
          <path d="M1,1 L9,1 L9,9 L1,9 L1,1 Z M0,0 L0,10 L10,10 L10,0 L0,0 Z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
           <path d="M2.1,0v2H0v8.1h8.2v-2h2V0H2.1z M7.2,9.2H1V3h6.1V9.2z M9.2,7.1h-1V2H3.1V1h6.1V7.1z" />
        </svg>
      </div>
      
      <div class="control-button close" @click="close">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">
          <path d="M1,0 L5,4 L9,0 L10,1 L6,5 L10,9 L9,10 L5,6 L1,10 L0,9 L4,5 L0,1 L1,0 Z" />
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 9999;
  user-select: none;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  transition: background 0.3s ease, backdrop-filter 0.3s ease;
  background:
    linear-gradient(to bottom, rgba(16, 14, 10, 0.78), rgba(14, 12, 9, 0.58)),
    rgba(0, 0, 0, 0.35);
  border-bottom: 1px solid rgba(var(--theme-surface-tint-rgb), 0.10);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.20);
}

.nav-controls {
    display: flex;
    align-items: center;
    height: 100%;
    padding-left: 0; 
    z-index: 10001; /* Above drag region */
}

.nav-entry {
    display: flex;
    align-items: center;
    height: 100%;
}

.nav-button {
    display: flex;
    align-items: center;
    padding: 0 10px;
    height: 26px;
    cursor: auto; /* It is clickable, but we set to auto to avoid global pointer. Actual clickable is fine. */
    cursor: pointer;
    font-size: 12px;
    color: rgba(var(--theme-text-primary-rgb), 0.62);
    transition: color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
    border-radius: 6px;
    position: relative;
    margin: 0 1px;
}
.nav-button:hover {
    color: rgba(var(--theme-text-primary-rgb), 0.90);
    background: rgba(var(--theme-surface-tint-rgb), 0.075);
}
.nav-button.active {
    color: rgba(var(--theme-text-primary-rgb), 0.96);
    font-weight: 600;
    background:
        radial-gradient(circle at 50% 100%, rgba(var(--theme-surface-tint-rgb), 0.14), transparent 68%),
        rgba(255, 255, 255, 0.035);
    box-shadow: none;
}

.nav-button.active::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: 3px;
    width: 18px;
    height: 1px;
    transform: translateX(-50%);
    border-radius: 999px;
    background: linear-gradient(90deg, transparent, rgba(var(--theme-surface-tint-rgb), 0.82), transparent);
    box-shadow: 0 0 8px rgba(var(--theme-surface-tint-rgb), 0.22);
    opacity: 0.9;
}

.nav-button svg {
    width: 16px;
    height: 16px;
    margin-right: 6px;
    opacity: 0.8;
    display: block;
    flex: 0 0 auto;
    shape-rendering: geometricPrecision;
    vector-effect: non-scaling-stroke;
    stroke-width: 2.25;
    color: rgba(var(--theme-text-secondary-rgb), 0.70);
}
.nav-button.active svg {
    opacity: 1;
    color: rgba(var(--theme-surface-tint-rgb), 0.92);
}

.drag-region {
  flex-grow: 1;
  height: 100%;
  background: transparent; 
}

.title-content {
    height: 100%;
    display: flex;
    align-items: center;
    font-size: 12px;
}

.window-controls {
  display: flex;
  height: 32px;
  flex-shrink: 0;
  z-index: 10001; /* Ensure buttons are top-most */
    position: relative;
}

.control-button {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 46px;
  height: 100%;
  cursor: default;
  transition: background-color 0.1s;
}

.control-button svg {
        width: 16px;
        height: 16px;
    fill: none;
    stroke: currentColor;
        display: block;
        flex: 0 0 auto;
        shape-rendering: geometricPrecision;
        vector-effect: non-scaling-stroke;
        stroke-width: 2.25;
}

.control-button.minimize svg,
.control-button.maximize svg,
.control-button.close svg {
    width: 10px;
    height: 10px;
  fill: currentColor;
    stroke: none;
    shape-rendering: crispEdges;
    vector-effect: none;
}

.control-button:hover {
  background-color: rgba(var(--theme-surface-tint-rgb), 0.075);
}

/* Game Library Button */
.control-button.game-list-toggle {
    color: rgba(var(--theme-text-secondary-rgb), 0.68);
    transition: all 0.2s;
}

.control-button.game-list-toggle:hover {
    color: rgba(var(--theme-text-primary-rgb), 0.92);
    background: rgba(var(--theme-surface-tint-rgb), 0.08);
}

.control-button.game-list-toggle.active {
    color: rgba(var(--theme-surface-tint-rgb), 0.96);
    background: rgba(var(--theme-surface-tint-rgb), 0.12);
    box-shadow: 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.12) inset;
}

.control-button.game-list-toggle svg {
    width: 14px;
    height: 14px;
    stroke-width: 2;
}

/* Settings Button */
.control-button.settings-btn {
    color: rgba(var(--theme-text-secondary-rgb), 0.68);
    transition: all 0.2s;
}

.control-button.settings-btn:hover {
    color: rgba(var(--theme-text-primary-rgb), 0.92);
    background: rgba(var(--theme-surface-tint-rgb), 0.08);
}

.control-button.settings-btn.active {
    color: rgba(var(--theme-surface-tint-rgb), 0.96);
    background: rgba(var(--theme-surface-tint-rgb), 0.12);
    box-shadow: 0 0 0 1px rgba(var(--theme-surface-tint-rgb), 0.12) inset;
}

/* Pin Button */
.control-button.pin-button {
    color: rgba(var(--theme-text-secondary-rgb), 0.58);
    transition: all 0.2s;
}

.control-button.pin-button:hover {
    color: rgba(var(--theme-text-primary-rgb), 0.90);
    background: rgba(var(--theme-surface-tint-rgb), 0.07);
}

.control-button.pin-button.active {
    color: rgba(var(--theme-surface-tint-rgb), 0.96);
    background: rgba(var(--theme-surface-tint-rgb), 0.12);
}

.control-button.pin-button.active svg {
    fill: rgba(var(--theme-surface-tint-rgb), 0.18);
}

.control-button.settings-btn svg {
    width: 15px;
    height: 15px;
    stroke-width: 1.8;
}

.control-button.close:hover {
  background-color: #e81123;
}
.control-button.close:hover svg {
    fill: white;
}

/* Nav List Animation */
.nav-list-move, 
.nav-list-enter-active,
.nav-list-leave-active {
    transition: all 0.3s ease;
}
.nav-list-enter-from,
.nav-list-leave-to {
    opacity: 0;
    transform: translateX(-10px);
}
/* ensure leaving items are taken out of flow so others can move smoothly */
.nav-list-leave-active {
    position: absolute; 
}

.nav-button.drag-hover {
    background: rgba(var(--theme-surface-tint-rgb), 0.14);
    outline: 1px dashed rgba(var(--theme-surface-tint-rgb), 0.55);
}

.nav-button.dragging {
    opacity: 0.65;
}
</style>
