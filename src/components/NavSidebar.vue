<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import { AppStateManager, type GameInfo } from '../store/AppStateManager';
import { ResourceManager } from '../store/ResourceManager';
import { getGamePresetDisplayName } from '../store/GamePreset';
import { calculateContextMenuPosition } from '../utils/ContextMenuPosition';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const appSettings = AppStateManager.appSettings;
const gamesList = AppStateManager.gamesList;

/** Collapsed (icon-only) pane mode — reuses the legacy compact-view setting. */
const isCollapsed = computed(() => appSettings.titlebarCompactView);

/* ═══════════════════════ Navigation items ═══════════════════════ */

interface NavItem { id: string; path: string; labelKey: string; label?: string }

const STORAGE_KEY_NAV_ORDER = 'ssmt4_nav_order';

const visibilityKeyByNavId: Partial<Record<string, keyof typeof appSettings.pageVisibility>> = {
    work: 'work',
    'mark-texture-full': 'markTexture',
    'texture-mod-maker': 'textureModMaker',
    mods: 'mods',
    gamebanana: 'gameBanana',
    nexusmods: 'nexusMods',
    xianzun: 'xianzun',
    'ui-builder': 'uiBuilder',
};

const allNavItems: NavItem[] = [
    { id: 'home', path: '/', labelKey: 'titlebar.nav.home' },
    { id: 'work', path: '/work', labelKey: 'titlebar.nav.work' },
    { id: 'mark-texture-full', path: '/mark-texture-full', labelKey: 'titlebar.nav.markTexture' },
    { id: 'texture-mod-maker', path: '/texture-mod-maker', labelKey: 'titlebar.nav.textureModMaker' },
    { id: 'mods', path: '/mods', labelKey: 'titlebar.nav.mods' },
    { id: 'gamebanana', path: '/gamebanana', labelKey: 'titlebar.nav.gameBanana' },
    { id: 'nexusmods', path: '/nexusmods', labelKey: 'titlebar.nav.nexusMods' },
    { id: 'xianzun', path: '/xianzun', labelKey: 'titlebar.nav.xianzun' },
    { id: 'ui-builder', path: '/ui-builder', labelKey: 'titlebar.nav.uiBuilder' },
];

const navOrder = ref<string[]>([]);

const ensureNavOrderCompleteness = () => {
    const ids = allNavItems.map(i => i.id);
    const cleaned = navOrder.value.filter(id => ids.includes(id));
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

    navOrder.value = allNavItems.map(i => i.id);
};

const saveOrder = () => {
    localStorage.setItem(STORAGE_KEY_NAV_ORDER, JSON.stringify(navOrder.value));
};

const displayItems = computed<NavItem[]>(() => {
    const map = new Map(allNavItems.map(i => [i.id, i]));
    const result: NavItem[] = [];

    navOrder.value.forEach(id => {
        const item = map.get(id);
        if (item) {
            result.push({ ...item, label: t(item.labelKey) });
        }
    });

    allNavItems.forEach(i => {
        if (!navOrder.value.includes(i.id)) {
            result.push({ ...i, label: t(i.labelKey) });
        }
    });

    return result.filter(item => {
        const key = visibilityKeyByNavId[item.id];
        return !key || appSettings.pageVisibility[key];
    });
});

const isNavItemActive = (item: NavItem) => {
    if (item.path === '/') return route.path === '/';
    return route.path === item.path || route.path.startsWith(`${item.path}/`);
};

const navTo = (path: string) => {
    if (suppressNavClick.value) return;
    if (route.path !== path) {
        router.push(path);
    }
};

/* ─────── Navigation item drag-to-reorder (manual, Tauri-safe) ─────── */

const navHoverId = ref<string | null>(null);
const navDraggingId = ref<string | null>(null);
const suppressNavClick = ref(false);
const navDragState = reactive({
    active: false,
    startX: 0,
    startY: 0,
    hasMoved: false,
    itemId: null as string | null,
});

const resetNavDrag = () => {
    navDragState.active = false;
    navDragState.hasMoved = false;
    navDragState.itemId = null;
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
    navDragState.active = true;
    navDragState.startX = e.clientX;
    navDragState.startY = e.clientY;
    navDragState.hasMoved = false;
    navDragState.itemId = item.id;
    navDraggingId.value = item.id;
    suppressNavClick.value = false;
    document.addEventListener('mousemove', onNavMouseMove);
    document.addEventListener('mouseup', onNavMouseUp);
};

const onNavMouseMove = (e: MouseEvent) => {
    if (!navDragState.active || !navDragState.itemId) return;
    const dx = e.clientX - navDragState.startX;
    const dy = e.clientY - navDragState.startY;
    if (!navDragState.hasMoved && Math.hypot(dx, dy) > 4) {
        navDragState.hasMoved = true;
        suppressNavClick.value = true;
        document.body.style.userSelect = 'none';
    }

    if (navDragState.hasMoved) {
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const btn = el?.closest?.('.nav-item[data-nav-id]') as HTMLElement | null;
        const targetId = btn?.dataset.navId || null;
        navHoverId.value = targetId && targetId !== navDragState.itemId ? targetId : null;
    }
};

const onNavMouseUp = (_e: MouseEvent) => {
    document.removeEventListener('mousemove', onNavMouseMove);
    document.removeEventListener('mouseup', onNavMouseUp);

    if (navDragState.active && navDragState.hasMoved && navDragState.itemId && navHoverId.value && navHoverId.value !== navDragState.itemId) {
        applyNavReorder(navDragState.itemId, navHoverId.value);
    }

    resetNavDrag();
    window.setTimeout(() => {
        suppressNavClick.value = false;
    }, 0);
};

/* ─────── Navigation item context menu ─────── */

const navContextMenu = reactive({ visible: false, x: 0, y: 0, item: null as NavItem | null });
const navContextMenuRef = ref<HTMLElement | null>(null);

const closeNavContextMenu = () => {
    navContextMenu.visible = false;
    navContextMenu.item = null;
};

const openNavContextMenu = (event: MouseEvent, item: NavItem) => {
    closeGameContextMenu();
    navContextMenu.item = item;
    navContextMenu.x = event.clientX;
    navContextMenu.y = event.clientY;
    navContextMenu.visible = true;

    nextTick(() => {
        const menuEl = navContextMenuRef.value;
        if (!menuEl) return;
        const rect = menuEl.getBoundingClientRect();
        const pos = calculateContextMenuPosition({
            clientX: event.clientX,
            clientY: event.clientY,
            menuWidth: rect.width,
            menuHeight: rect.height,
        });
        navContextMenu.x = pos.x;
        navContextMenu.y = pos.y;
    });
};

const hideNavItem = async (item: NavItem) => {
    const key = visibilityKeyByNavId[item.id];
    if (!key) return;
    appSettings.pageVisibility[key] = false;
    closeNavContextMenu();
    await AppStateManager.saveSettingsNow();
};

const toggleCompactView = async () => {
    appSettings.titlebarCompactView = !appSettings.titlebarCompactView;
    closeNavContextMenu();
    await AppStateManager.saveSettingsNow();
};

/** WinUI3 pane toggle (hamburger) — same collapse state as the context menu. */
const togglePaneCollapsed = async () => {
    appSettings.titlebarCompactView = !appSettings.titlebarCompactView;
    await AppStateManager.saveSettingsNow();
};

/* ═══════════════════════ Footer pages (library) ═══════════════════════ */

const toggleGamePage = () => {
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

/* ═══════════════════════ Game quick-switch strip ═══════════════════════ */

const sidebarGames = computed(() => {
    const orderIndex = new Map(appSettings.sidebarGameOrder.map((name, index) => [name, index]));

    return [...gamesList]
        .filter(g => g.showSidebar)
        .sort((left, right) => {
            const leftIndex = orderIndex.get(left.name) ?? Number.MAX_SAFE_INTEGER;
            const rightIndex = orderIndex.get(right.name) ?? Number.MAX_SAFE_INTEGER;
            return leftIndex - rightIndex;
        });
});

const isGameActive = (gameName: string) => appSettings.CurrentGameName === gameName;

const getSidebarGameTooltip = (gameName: string) => `${getGamePresetDisplayName(gameName, t)} · ${t('home.tooltips.sidebarGame')}`;

const handleGameClick = async (game: GameInfo) => {
    if (suppressGameClick.value) return;

    try {
        await AppStateManager.selectGame(game);
    } catch (error) {
        console.error('Failed to switch game:', error);
        ElMessage.error(t('appState.messages.loadSettingsFailed', { error: String(error) }));
    }
};

/* ─────── Game strip drag-to-reorder ─────── */

const GAME_DRAG_START_THRESHOLD = 6;
const draggedGameName = ref('');
const dragOverGameName = ref('');
const pendingDragGameName = ref('');
const suppressGameClick = ref(false);
const gameDragState = reactive({
    active: false,
    startX: 0,
    startY: 0,
    hasMoved: false,
});

const clearGameDragState = () => {
    draggedGameName.value = '';
    dragOverGameName.value = '';
    pendingDragGameName.value = '';
    gameDragState.active = false;
    gameDragState.startX = 0;
    gameDragState.startY = 0;
    gameDragState.hasMoved = false;
    document.body.style.userSelect = '';
};

const persistVisibleGameOrder = (orderedVisibleNames: string[]) => {
    const visibleNames = new Set(sidebarGames.value.map(game => game.name));
    const pendingVisibleNames = [...orderedVisibleNames];
    const mergedOrder: string[] = [];

    for (const gameName of appSettings.sidebarGameOrder) {
        if (!visibleNames.has(gameName)) {
            mergedOrder.push(gameName);
            continue;
        }

        const replacement = pendingVisibleNames.shift();
        if (replacement) {
            mergedOrder.push(replacement);
        }
    }

    if (pendingVisibleNames.length > 0) {
        mergedOrder.push(...pendingVisibleNames);
    }

    AppStateManager.setSidebarGameOrder(mergedOrder);
};

const reorderGames = (draggedName: string, targetName: string) => {
    if (!draggedName || !targetName || draggedName === targetName) return;

    const orderedVisibleNames = sidebarGames.value.map(game => game.name);
    const draggedIndex = orderedVisibleNames.indexOf(draggedName);
    const targetIndex = orderedVisibleNames.indexOf(targetName);
    if (draggedIndex < 0 || targetIndex < 0) return;

    const nextVisibleOrder = [...orderedVisibleNames];
    nextVisibleOrder.splice(draggedIndex, 1);
    nextVisibleOrder.splice(targetIndex, 0, draggedName);

    persistVisibleGameOrder(nextVisibleOrder);
};

const updateGameDragTargetFromPoint = (clientX: number, clientY: number) => {
    if (!draggedGameName.value) {
        dragOverGameName.value = '';
        return;
    }

    const hoveredElement = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const hoveredIcon = hoveredElement?.closest<HTMLElement>('.nav-game-icon[data-game-name]');
    const targetGameName = hoveredIcon?.dataset.gameName || '';

    dragOverGameName.value = targetGameName && targetGameName !== draggedGameName.value
        ? targetGameName
        : '';
};

const handleGameMouseDown = (gameName: string, event: MouseEvent) => {
    if (event.button !== 0) return;

    pendingDragGameName.value = gameName;
    gameDragState.active = true;
    gameDragState.startX = event.clientX;
    gameDragState.startY = event.clientY;
    gameDragState.hasMoved = false;
    suppressGameClick.value = false;
    document.addEventListener('mousemove', handleWindowMouseMove);
    document.addEventListener('mouseup', finishGameMouseInteraction);
};

const handleWindowMouseMove = (event: MouseEvent) => {
    if (!gameDragState.active || !pendingDragGameName.value) return;

    if (!draggedGameName.value) {
        const deltaX = event.clientX - gameDragState.startX;
        const deltaY = event.clientY - gameDragState.startY;
        const distance = Math.hypot(deltaX, deltaY);

        if (distance < GAME_DRAG_START_THRESHOLD) return;

        draggedGameName.value = pendingDragGameName.value;
        gameDragState.hasMoved = true;
        suppressGameClick.value = true;
        document.body.style.userSelect = 'none';
    }

    updateGameDragTargetFromPoint(event.clientX, event.clientY);
};

const finishGameMouseInteraction = (event: MouseEvent) => {
    document.removeEventListener('mousemove', handleWindowMouseMove);
    document.removeEventListener('mouseup', finishGameMouseInteraction);

    if (!gameDragState.active || !pendingDragGameName.value) {
        clearGameDragState();
        return;
    }

    if (draggedGameName.value) {
        updateGameDragTargetFromPoint(event.clientX, event.clientY);
        reorderGames(draggedGameName.value, dragOverGameName.value);
        window.setTimeout(() => {
            suppressGameClick.value = false;
        }, 0);
    }

    clearGameDragState();
};

/* ─────── Game strip context menu ─────── */

const gameContextMenu = reactive({ visible: false, x: 0, y: 0, game: null as GameInfo | null });
const gameContextMenuRef = ref<HTMLElement | null>(null);

const openGameContextMenu = (event: MouseEvent, game: GameInfo) => {
    closeNavContextMenu();
    gameContextMenu.game = game;
    gameContextMenu.x = event.clientX;
    gameContextMenu.y = event.clientY;
    gameContextMenu.visible = true;

    nextTick(() => {
        const menuEl = gameContextMenuRef.value;
        if (!menuEl) return;

        const rect = menuEl.getBoundingClientRect();
        const pos = calculateContextMenuPosition({
            clientX: event.clientX,
            clientY: event.clientY,
            menuWidth: rect.width,
            menuHeight: rect.height,
        });

        gameContextMenu.x = pos.x;
        gameContextMenu.y = pos.y;
    });
};

const closeGameContextMenu = () => {
    gameContextMenu.visible = false;
    gameContextMenu.game = null;
};

const hideGame = async () => {
    if (!gameContextMenu.game) return;

    const gameName = gameContextMenu.game.name;
    const wasActive = isGameActive(gameName);

    try {
        await ResourceManager.setGameVisibility(gameName, false);
        await AppStateManager.loadGames();

        if (wasActive && sidebarGames.value.length > 0) {
            await AppStateManager.selectGame(sidebarGames.value[0]);
        }
    } catch (err) {
        console.error('Failed to hide game:', err);
    }

    closeGameContextMenu();
};

const closeAllFlyouts = () => {
    closeNavContextMenu();
    closeGameContextMenu();
};

/**
 * WinUI3 light-dismiss: while the pane floats open (expanded), pressing
 * anywhere outside it — the page area, caption bar, anywhere — collapses it.
 * Interactions inside the pane and its teleported flyouts are ignored.
 */
const handleLightDismiss = (event: PointerEvent) => {
    if (isCollapsed.value) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('.nav-pane')) return;
    if (target.closest('.shell-flyout')) return;
    appSettings.titlebarCompactView = true;
    void AppStateManager.saveSettingsNow();
};

/* ═══════════════════════ Lifecycle ═══════════════════════ */

onMounted(() => {
    loadOrder();
    document.addEventListener('pointerdown', closeAllFlyouts);
    document.addEventListener('pointerdown', handleLightDismiss);
});

onUnmounted(() => {
    document.removeEventListener('pointerdown', closeAllFlyouts);
    document.removeEventListener('pointerdown', handleLightDismiss);
    document.removeEventListener('mousemove', onNavMouseMove);
    document.removeEventListener('mouseup', onNavMouseUp);
    document.removeEventListener('mousemove', handleWindowMouseMove);
    document.removeEventListener('mouseup', finishGameMouseInteraction);
    resetNavDrag();
    clearGameDragState();
});
</script>

<template>
    <aside class="nav-pane" :class="{ 'is-collapsed': isCollapsed }">
        <div class="nav-pane-inner">
        <!-- Frosted backdrop — only visible while the pane floats open over content -->
        <div class="nav-pane-bg" aria-hidden="true"></div>

        <!-- Pane header: WinUI3 hamburger toggle -->
        <div class="nav-pane-header">
            <el-tooltip
                :content="t(isCollapsed ? 'titlebar.disableCompactView' : 'titlebar.enableCompactView')"
                placement="right"
                :show-after="400"
            >
                <button
                    type="button"
                    class="nav-toggle"
                    :aria-label="t(isCollapsed ? 'titlebar.disableCompactView' : 'titlebar.enableCompactView')"
                    :aria-expanded="!isCollapsed"
                    @click="togglePaneCollapsed"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path></svg>
                </button>
            </el-tooltip>
        </div>

        <!-- Primary navigation -->
        <nav class="nav-menu" aria-label="SSMT4">
            <transition-group name="nav-items" tag="div" class="nav-menu-list" appear>
                <div
                    v-for="(item, index) in displayItems"
                    :key="item.id"
                    class="nav-item-wrap"
                    :style="{ '--stagger': index }"
                >
                    <el-tooltip
                        :content="item.label"
                        placement="right"
                        :show-after="250"
                        :disabled="!isCollapsed"
                    >
                        <button
                            type="button"
                            class="nav-item"
                            :class="{ active: isNavItemActive(item), 'drag-hover': navHoverId === item.id, dragging: navDraggingId === item.id }"
                            :data-nav-id="item.id"
                            :aria-label="item.label"
                            @click="navTo(item.path)"
                            @mousedown.prevent="onNavMouseDown($event, item)"
                            @contextmenu.prevent.stop="openNavContextMenu($event, item)"
                        >
                            <span class="nav-item-pill" aria-hidden="true"></span>
                            <span class="nav-item-icon" aria-hidden="true">
                                <svg v-if="item.id === 'home'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                                <svg v-else-if="item.id === 'work'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="M9 4v16"></path><path d="M4 9h16"></path><path d="M12.5 14h4"></path><path d="M12.5 17h2.5"></path></svg>
                                <svg v-else-if="item.id === 'mark-texture-full'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"></path><path d="M9 9h6"></path><path d="M9 13h6"></path><path d="M9 17h4"></path></svg>
                                <svg v-else-if="item.id === 'texture-mod-maker'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8" cy="9" r="2"></circle><path d="m4 17 5-5 3 3 2-2 6 6"></path><path d="M17 2v4M15 4h4"></path></svg>
                                <svg v-else-if="item.id === 'mods'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                                <svg v-else-if="item.id === 'gamebanana'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10l2 4-2 12H7L5 8l2-4z"></path><path d="M9 4l1 4h4l1-4"></path><path d="M9 12h6"></path><path d="M10 16h4"></path></svg>
                                <svg v-else-if="item.id === 'nexusmods'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v16H6z"></path><path d="M9 8h6"></path><path d="M9 12h6"></path><path d="M9 16h4"></path></svg>
                                <svg v-else-if="item.id === 'xianzun'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path><path d="M8.5 11h7"></path><path d="M8.5 14.5h4"></path></svg>
                                <svg v-else-if="item.id === 'ui-builder'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M8 8h8v8H8z"></path><path d="M8 12h8M12 8v8"></path></svg>
                            </span>
                            <span class="nav-item-label">{{ item.label }}</span>
                        </button>
                    </el-tooltip>
                </div>
            </transition-group>
        </nav>

        <!-- Game quick-switch strip — proportional height share of the pane -->
        <div v-if="sidebarGames.length > 0" class="nav-games">
            <div class="nav-games-track" :aria-label="t('titlebar.selectGame')">
                <transition-group name="nav-games" tag="div" class="nav-games-list" appear>
                    <div
                        v-for="(game, index) in sidebarGames"
                        :key="game.name"
                        class="nav-game-wrap"
                        :style="{ '--stagger': index }"
                    >
                        <el-tooltip
                            :content="getSidebarGameTooltip(game.name)"
                            placement="right"
                            :show-after="250"
                            effect="dark"
                            popper-class="game-tooltip"
                        >
                            <button
                                type="button"
                                class="nav-game-icon"
                                :class="{ active: isGameActive(game.name), dragging: draggedGameName === game.name, 'drag-over': dragOverGameName === game.name }"
                                :data-game-name="game.name"
                                :aria-label="getGamePresetDisplayName(game.name, t)"
                                @click.stop="handleGameClick(game)"
                                @contextmenu.prevent="openGameContextMenu($event, game)"
                                @mousedown.prevent="handleGameMouseDown(game.name, $event)"
                            >
                                <img
                                    :src="game.iconPath"
                                    :alt="getGamePresetDisplayName(game.name, t)"
                                    loading="lazy"
                                    draggable="false"
                                    @load="(e) => ((e.target as HTMLImageElement).style.opacity = '1')"
                                    @error="(e) => ((e.target as HTMLImageElement).style.opacity = '0')"
                                />
                            </button>
                        </el-tooltip>
                    </div>
                </transition-group>
            </div>
        </div>

        <!-- Footer: game library -->
        <div class="nav-footer">
            <div class="nav-footer-items">
                <el-tooltip
                    :content="t('titlebar.switchToGameLibrary')"
                    placement="right"
                    :show-after="250"
                    :disabled="!isCollapsed"
                >
                    <button
                        type="button"
                        class="nav-item"
                        :class="{ active: route.path === '/games' }"
                        :aria-label="t('titlebar.switchToGameLibrary')"
                        @click="toggleGamePage"
                    >
                        <span class="nav-item-pill" aria-hidden="true"></span>
                        <span class="nav-item-icon" aria-hidden="true">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect></svg>
                        </span>
                        <span class="nav-item-label">{{ t('titlebar.switchToGameLibrary') }}</span>
                    </button>
                </el-tooltip>
            </div>
        </div>
        </div>

        <!-- Flyouts -->
        <Teleport to="body">
            <div
                v-if="navContextMenu.visible && navContextMenu.item"
                ref="navContextMenuRef"
                class="shell-flyout"
                :style="{ left: `${navContextMenu.x}px`, top: `${navContextMenu.y}px` }"
                @pointerdown.stop
                @contextmenu.prevent
            >
                <button type="button" class="shell-flyout-item" @click="toggleCompactView">
                    {{ t(isCollapsed ? 'titlebar.disableCompactView' : 'titlebar.enableCompactView') }}
                </button>
                <button
                    v-if="visibilityKeyByNavId[navContextMenu.item.id]"
                    type="button"
                    class="shell-flyout-item"
                    @click="hideNavItem(navContextMenu.item)"
                >
                    {{ t('titlebar.hidePage') }}
                </button>
            </div>
        </Teleport>

        <Teleport to="body">
            <div
                v-if="gameContextMenu.visible && gameContextMenu.game"
                ref="gameContextMenuRef"
                class="shell-flyout"
                :style="{ left: `${gameContextMenu.x}px`, top: `${gameContextMenu.y}px` }"
                @pointerdown.stop
                @click.stop
                @contextmenu.prevent
            >
                <div class="shell-flyout-hint">{{ t('home.tooltips.sidebarGame') }}</div>
                <button type="button" class="shell-flyout-item" @click="hideGame">
                    {{ t('home.actions.hideGame') }}
                </button>
            </div>
        </Teleport>
    </aside>
</template>

<style scoped>
/* ═══════════ Pane (floating overlay — WinUI3 LeftCompact) ═══════════ */
.nav-pane {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 264px;
    z-index: 20;
    box-sizing: border-box;
    /* Legacy home-rail look: vertical translucent gradient that fades to
       fully transparent at the top, melting seamlessly into the caption bar */
    background: var(--shell-pane-bg);
    transition: width 183ms cubic-bezier(0.16, 1, 0.3, 1);
    will-change: width;
}

.nav-pane.is-collapsed {
    width: var(--shell-pane-width-collapsed, 56px);
}

.nav-pane-inner {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

/* Content layers sit above the frosted backdrop */
.nav-pane-header,
.nav-menu,
.nav-games,
.nav-footer {
    position: relative;
}

/* Frosted backdrop — fades in only while the pane is expanded (floating over
   page content), so icons/labels never blend with the page beneath. The top
   fade mask keeps the caption-bar junction seamless (blur fades in too). */
.nav-pane-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    opacity: 0;
    pointer-events: none;
    background: var(--shell-pane-overlay-bg);
    backdrop-filter: var(--shell-pane-overlay-blur);
    -webkit-backdrop-filter: var(--shell-pane-overlay-blur);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 48px);
    mask-image: linear-gradient(to bottom, transparent 0, #000 48px);
    transition: opacity 183ms ease;
}

.nav-pane:not(.is-collapsed) .nav-pane-bg {
    opacity: 1;
}

/* Right hairline — fades in from the top so no junction shows at the caption bar */
.nav-pane::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    width: 1px;
    background: var(--shell-pane-border);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 44px);
    mask-image: linear-gradient(to bottom, transparent 0, #000 44px);
    pointer-events: none;
}

/* Right elevation shadow — same seamless top fade */
.nav-pane::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    right: -9px;
    width: 9px;
    background: linear-gradient(to right, var(--shell-pane-shadow-color), transparent);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 44px);
    mask-image: linear-gradient(to bottom, transparent 0, #000 44px);
    pointer-events: none;
}

/* ═══════════ Pane header (hamburger toggle) ═══════════ */
.nav-pane-header {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    padding: 8px 8px 6px;
    box-sizing: border-box;
    transition: padding 183ms cubic-bezier(0.16, 1, 0.3, 1);
}

.is-collapsed .nav-pane-header {
    padding: 8px 6px 6px;
}

/* WinUI3 PaneToggleButton (hamburger) */
.nav-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 36px;
    flex: 0 0 auto;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--shell-text);
    font: inherit;
    cursor: pointer;
    transition:
        background 83ms ease,
        transform 127ms cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-toggle:hover {
    background: var(--shell-fill-hover);
}

.nav-toggle:active {
    background: var(--shell-fill-pressed);
    transform: scale(0.92);
}

.nav-toggle svg {
    width: 16px;
    height: 16px;
    display: block;
    shape-rendering: geometricPrecision;
}

.is-collapsed .nav-toggle {
    margin: 0 auto;
}

/* ═══════════ Primary navigation ═══════════ */
.nav-menu {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 2px 0 8px;
    /* Scrollbars always hidden — wheel/touch scrolling stays */
    scrollbar-width: none;
}

.nav-menu::-webkit-scrollbar {
    display: none;
}

.nav-menu-list {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 8px;
    box-sizing: border-box;
    transition: padding 183ms cubic-bezier(0.16, 1, 0.3, 1);
}

.is-collapsed .nav-menu-list {
    padding: 0 6px;
}

.nav-item-wrap {
    flex: 0 0 auto;
    min-width: 0;
}

/* ═══════════ Navigation item (WinUI3 NavigationViewItem) ═══════════ */
.nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    height: 36px;
    padding: 0 12px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--shell-text);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    white-space: nowrap;
    box-sizing: border-box;
    transition:
        background 83ms ease,
        transform 127ms cubic-bezier(0.16, 1, 0.3, 1),
        padding 183ms cubic-bezier(0.16, 1, 0.3, 1),
        gap 183ms cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-item:hover {
    background: var(--shell-fill-hover);
}

.nav-item:active {
    background: var(--shell-fill-pressed);
    transform: scale(0.982);
}

.nav-item.active {
    background: var(--shell-fill-selected);
    font-weight: 600;
}

.nav-item.active:hover {
    background: var(--shell-fill-selected-hover);
}

.nav-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: var(--shell-text-secondary);
    transition: color 83ms ease;
}

.nav-item:hover .nav-item-icon,
.nav-item.active .nav-item-icon {
    color: var(--shell-text);
}

.nav-item-icon svg {
    width: 16px;
    height: 16px;
    display: block;
    shape-rendering: geometricPrecision;
}

.nav-item-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: opacity 127ms ease;
}

.is-collapsed .nav-item {
    justify-content: center;
    gap: 0;
    padding: 0;
}

.is-collapsed .nav-item-label {
    position: absolute;
    width: 0;
    opacity: 0;
    pointer-events: none;
}

/* Selection pill — WinUI3 animated indicator */
.nav-item-pill {
    position: absolute;
    left: 0;
    top: 50%;
    width: 3px;
    height: 16px;
    border-radius: 99px;
    background: var(--shell-accent);
    transform: translateY(-50%) scaleY(0.25);
    opacity: 0;
    transition:
        transform 250ms cubic-bezier(0.34, 1.45, 0.64, 1),
        opacity 110ms ease,
        height 110ms ease;
}

.nav-item.active .nav-item-pill {
    transform: translateY(-50%) scaleY(1);
    opacity: 1;
}

.nav-item.active:active .nav-item-pill {
    height: 11px;
}

/* Drag-to-reorder affordances */
.nav-item.drag-hover {
    background: var(--shell-fill-selected);
    outline: 1px dashed var(--shell-accent-soft);
    outline-offset: -1px;
}

.nav-item.dragging {
    opacity: 0.55;
}

/* ═══════════ Game quick-switch strip (proportional height) ═══════════ */
.nav-games {
    flex: 0 1 auto;
    min-height: 0;
    /* Share of the pane height — grows/shrinks proportionally with the window */
    max-height: var(--shell-pane-games-max, 36%);
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--shell-divider);
}

.nav-games-track {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    /* Extra headroom so the active ring + glow on edge icons never clips */
    padding: 12px 0;
    /* Scrollbars always hidden — wheel/touch scrolling stays */
    scrollbar-width: none;
}

.nav-games-track::-webkit-scrollbar {
    display: none;
}

/* ═══════════ Footer ═══════════ */
.nav-footer {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    padding: 8px 0 10px;
    border-top: 1px solid var(--shell-divider);
}

.nav-games-list {
    display: grid;
    /* Guaranteed five icons per row in the expanded pane (5×40 + 4×8 = 232px) */
    grid-template-columns: repeat(5, 40px);
    justify-content: center;
    gap: 8px;
    padding: 0 12px;
    box-sizing: border-box;
    transition: padding 183ms cubic-bezier(0.16, 1, 0.3, 1);
}

.is-collapsed .nav-games-list {
    grid-template-columns: 32px;
    justify-content: center;
    padding: 0 6px;
}

.nav-game-wrap {
    flex: 0 0 auto;
}

.nav-game-icon {
    display: block;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: 10px;
    overflow: hidden;
    background: var(--shell-game-icon-bg);
    cursor: pointer;
    transition:
        transform 150ms cubic-bezier(0.16, 1, 0.3, 1),
        box-shadow 150ms ease,
        width 183ms cubic-bezier(0.16, 1, 0.3, 1),
        height 183ms cubic-bezier(0.16, 1, 0.3, 1),
        border-radius 183ms cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-game-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 220ms ease;
    pointer-events: none;
}

.nav-game-icon:hover {
    transform: scale(1.08);
}

.nav-game-icon:active {
    transform: scale(0.96);
}

.nav-game-icon.active {
    box-shadow:
        0 0 0 2px var(--shell-game-gap),
        0 0 0 4px var(--shell-game-ring),
        0 0 14px var(--shell-game-ring-glow);
    transform: scale(1.04);
    z-index: 1;
}

.nav-game-icon.dragging {
    opacity: 0.42;
    transform: scale(0.92);
}

.nav-game-icon.drag-over {
    box-shadow:
        0 0 0 2px var(--shell-game-gap),
        0 0 0 4px var(--shell-accent),
        0 0 16px var(--shell-game-ring-glow);
    transform: scale(1.1);
}

.is-collapsed .nav-game-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
}

.nav-footer-items {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 8px;
    box-sizing: border-box;
    transition: padding 183ms cubic-bezier(0.16, 1, 0.3, 1);
}

.is-collapsed .nav-footer-items {
    padding: 0 6px;
}

/* ═══════════ Flyouts (context menus) ═══════════ */
.shell-flyout {
    position: fixed;
    z-index: 30000;
    min-width: 172px;
    padding: 5px;
    box-sizing: border-box;
    border: 1px solid var(--shell-flyout-border);
    border-radius: 8px;
    background: var(--shell-flyout-bg);
    backdrop-filter: blur(20px) saturate(1.3);
    -webkit-backdrop-filter: blur(20px) saturate(1.3);
    box-shadow: var(--shell-flyout-shadow);
    animation: shell-flyout-in 140ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes shell-flyout-in {
    from {
        opacity: 0;
        transform: translateY(-3px) scale(0.98);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

.shell-flyout-item {
    display: flex;
    align-items: center;
    width: 100%;
    height: 32px;
    padding: 0 11px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--shell-flyout-text);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 83ms ease;
}

.shell-flyout-item:hover {
    background: var(--shell-flyout-hover);
}

.shell-flyout-hint {
    padding: 7px 11px 6px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--shell-divider);
    color: var(--shell-flyout-text-muted);
    font-size: 11px;
    line-height: 1.4;
    white-space: nowrap;
    cursor: default;
}

/* ═══════════ Transition-group animations ═══════════ */
.nav-items-move,
.nav-games-move {
    transition: transform 210ms cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-items-enter-active,
.nav-items-leave-active {
    transition: opacity 167ms ease, transform 167ms cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-items-enter-from,
.nav-items-leave-to {
    opacity: 0;
    transform: translateX(-8px);
}

.nav-items-leave-active {
    position: absolute;
    left: 8px;
    right: 8px;
}

.is-collapsed .nav-items-leave-active {
    left: 6px;
    right: 6px;
}

.nav-items-appear-active {
    transition:
        opacity 250ms ease,
        transform 250ms cubic-bezier(0.16, 1, 0.3, 1);
    transition-delay: calc(var(--stagger, 0) * 22ms);
}

.nav-items-appear-from {
    opacity: 0;
    transform: translateX(-10px);
}

.nav-games-enter-active,
.nav-games-leave-active {
    transition: opacity 167ms ease, transform 167ms cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-games-enter-from,
.nav-games-leave-to {
    opacity: 0;
    transform: scale(0.6);
}

.nav-games-leave-active {
    position: absolute;
}

.nav-games-appear-active {
    transition:
        opacity 260ms ease,
        transform 260ms cubic-bezier(0.16, 1, 0.3, 1);
    transition-delay: calc(var(--stagger, 0) * 20ms);
}

.nav-games-appear-from {
    opacity: 0;
    transform: translateY(8px) scale(0.7);
}
</style>
