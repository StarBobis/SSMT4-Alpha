<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { AppStateManager, type GameInfo } from '../store/AppStateManager';
import { debugLog } from '../utils/debugLog';
import { getGamePresetDisplayName } from '../store/GamePreset';
import { useI18n } from 'vue-i18n';

const isDrawerOpen = AppStateManager.isDrawerOpen;
const gamesList = AppStateManager.gamesList;
const { t } = useI18n();
const appSettings = AppStateManager.appSettings;
const selectGame = AppStateManager.selectGame.bind(AppStateManager);

const scrollContainer = ref<HTMLElement | null>(null);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

// Drawer Logic
const startAutoCloseTimer = () => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
        isDrawerOpen.value = false;
    }, 3000); // 3 seconds of inactivity closes the drawer
};

// Watch global drawer state to manage timer
watch(isDrawerOpen, (isOpen) => {
    if (isOpen) {
        startAutoCloseTimer();
    } else {
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
    }
});

const onWindowMouseDown = (e: MouseEvent) => {
    // 1. Check if clicking inside the drawer (ignore closure, allow interaction)
    const drawer = document.querySelector('.games-drawer-panel');
    const target = e.target as HTMLElement;

    if (drawer && drawer.contains(target)) {
        return;
    }

    // 2. Click on TitleBar area
    // If click target is inside TitleBar, let's play safe and NOT trigger close, 
    // to avoid conflict with the toggle button click inside App.vue/TitleBar.vue
    if (e.clientY <= 40) {
        return;
    }

    // 3. Click elsewhere (Content area) -> Close
    if (isDrawerOpen.value) {
        isDrawerOpen.value = false;
    }
};

const onDrawerMouseMove = () => {
    // If mouse is moving inside drawer, keep it open and reset timer
    if (!isDrawerOpen.value) isDrawerOpen.value = true;
    startAutoCloseTimer();
};

const onWheel = (e: WheelEvent) => {
    // Scrolling counts as activity
    startAutoCloseTimer();

    if (scrollContainer.value) {
        e.preventDefault();
        // Increase scroll distance per wheel tick for faster horizontal navigation
        scrollContainer.value.scrollLeft += e.deltaY * 3;
    }
};

const handleGameSelect = async (game: GameInfo) => {
    debugLog('GamesDrawer', 'select game', game && game.name);
    await selectGame(game);
    startAutoCloseTimer(); // Keep open for a moment after select
};

onMounted(() => {
    // Using mousedown to capture interactions on the TitleBar even if dragging starts
    window.addEventListener('mousedown', onWindowMouseDown, true);
});

onUnmounted(() => {
    window.removeEventListener('mousedown', onWindowMouseDown, true);
    if (closeTimer) clearTimeout(closeTimer);
});
</script>

<template>
    <Teleport to="body">
        <Transition name="drawer-slide">
            <div 
                v-if="isDrawerOpen"
                class="games-drawer-panel"
                @mousemove="onDrawerMouseMove"
                @mouseleave="startAutoCloseTimer"
            >
                <div class="games-slider-wrapper">
                    <div 
                        ref="scrollContainer" 
                        class="games-slider"
                        @wheel="onWheel"
                    >
                        <div 
                            v-for="game in gamesList" 
                            :key="game.name"
                            class="game-card"
                            :class="{ active: appSettings.CurrentGameName === game.name }"
                            @click="handleGameSelect(game)"
                        >
                            <div class="game-icon-wrapper">
                                <img :src="game.iconPath" class="game-icon" alt="icon" />
                            </div>
                            <div class="game-label">{{ getGamePresetDisplayName(game.name, t) }}</div>
                        </div>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.games-drawer-panel {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    z-index: 9000;
    /* High enough to be above content, but below TitleBar (9999) if we want interaction */
    /* Wait, TitleBar is transparent region but has buttons. 
       If we want to interact with drawer, it must be clickable.
       If we put it below TitleBar visually, we add padding.
    */
    padding-top: 35px;
    /* Clear TitleBar height */
    background: linear-gradient(to bottom, rgba(8, 22, 32, 0.75) 0%, rgba(8, 22, 32, 0) 100%);
    /* Optional shadow gradient */
    display: flex;
    justify-content: center;
}

/* Transition for the drawer */
.drawer-slide-enter-active,
.drawer-slide-leave-active {
    transition: transform 0.3s ease, opacity 0.3s ease;
}

.drawer-slide-enter-from,
.drawer-slide-leave-to {
    transform: translateY(-100%);
    opacity: 0;
}

.games-slider-wrapper {
    width: 100%;
    min-width: 0;
    max-width: none;
    /* Reduced vertical padding to fit larger icons */
    padding: 10px 40px;
    overflow: hidden;
    background: transparent;
    border: none;
    box-shadow: none;
}


.games-slider {
    display: flex;
    justify-content: center;
    gap: 12px;
    overflow-x: auto;
    overflow-y: visible;
    /* Reduced vertical padding, added horizontal safe area */
    padding: 8px 40px;
    scroll-behavior: smooth;
    /* Hide scrollbar for cleaner look */
    scrollbar-width: none;
    -ms-overflow-style: none;
    scrollbar-color: transparent transparent;
    align-items: center;
}

.games-slider::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
}

.game-card {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    /* On mouse leave: wait 0.2s, then start a slower restore animation. */
    transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1) 0.2s, opacity 0.5s ease 0.2s, filter 0.5s ease 0.2s;
    border-radius: 8px;
    justify-content: center;
    /* 长预设名时卡片随文字自动变宽/变高 */
    width: auto;
    min-width: 100px;
    max-width: 190px;
    /* height: 100px;  Removed fixed height to accommodate label flow */
    opacity: 0.7;
    /* Dusty/Sealed look: Darker, desaturated - REMOVED BLUR as requested */
    filter: brightness(0.6) grayscale(0.4); 
    transform-origin: center top;
}

.game-card:hover {
    /* On hover: respond immediately with no delay. */
    transition: transform 0.15s ease-out 0s, opacity 0.2s ease 0s, filter 0.2s ease 0s;
    transform: scale(1.1);
    opacity: 1;
    /* Restore clarity */
    filter: none;
}

.game-card.active {
    transform: none;
    opacity: 1;
    filter: none;
    z-index: 10;
}

.game-icon-wrapper {
    position: relative;
    width: 80px;
    height: 80px;

    /* Crystal filling texture: Refractive glass look */
    background: radial-gradient(circle at 50% 0%,
            rgba(255, 255, 255, 0.15) 0%,
            rgba(255, 255, 255, 0.05) 40%,
            rgba(255, 255, 255, 0.02) 100%);

    /* Delicate but distinct border */
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 12px;

    /* Padding creates the "encased" look */
    padding: 2px;

    display: flex;
    align-items: center;
    justify-content: center;

    /* Constant radiating light (Flowing Light Overflowing) */
    box-shadow:
        0 0 12px rgba(var(--theme-surface-tint-rgb), 0.14),
        inset 0 0 15px rgba(255, 255, 255, 0.1);

    transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
    overflow: hidden;

    /* Breathing light effect */
    animation: crystalPulse 4s ease-in-out infinite;
}

@keyframes crystalPulse {

    0%,
    100% {
        box-shadow:
            0 0 12px rgba(var(--theme-surface-tint-rgb), 0.14),
            inset 0 0 15px rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.25);
    }

    50% {
        box-shadow:
            0 0 20px rgba(var(--theme-surface-tint-rgb), 0.24),
            inset 0 0 20px rgba(255, 255, 255, 0.2);
        border-color: rgba(255, 255, 255, 0.45);
    }
}

/* Pseudo-element for magic fluid/particle flow */
.game-icon-wrapper::before {
    content: "";
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background:
        conic-gradient(from 0deg at 50% 50%,
            transparent 0deg,
            rgba(255, 255, 255, 0.05) 40deg,
            rgba(var(--theme-surface-tint-rgb), 0.1) 90deg,
            transparent 135deg,
            rgba(255, 255, 255, 0.05) 200deg,
            transparent 360deg);
    filter: blur(15px);
    animation: magicRotate 6s linear infinite;
    /* Slightly faster rotation */
    z-index: 2;
    pointer-events: none;
    mix-blend-mode: screen;
}

@keyframes magicRotate {
    0% {
        transform: rotate(0deg);
    }

    100% {
        transform: rotate(360deg);
    }
}

/* Crystal reflection sheen - constantly moving */
.game-icon-wrapper::after {
    content: "";
    position: absolute;
    top: 0;
    left: -150%;
    width: 200%;
    height: 100%;
    background: linear-gradient(115deg,
            transparent 40%,
            rgba(255, 255, 255, 0.05) 45%,
            rgba(255, 255, 255, 0.4) 50%,
            rgba(255, 255, 255, 0.05) 55%,
            transparent 60%);
    transform: skewX(-20deg);
    pointer-events: none;
    z-index: 5;
    animation: subtleSheen 5s ease-in-out infinite;
}

/* 位移改用 translateX（合成器属性）：left 动画每帧触发布局+重绘。
   换算：left -150%→150% = 300% 父宽；元素宽 200% 父宽 → 300/200 = 150% 自身宽 */
@keyframes subtleSheen {
    0% {
        transform: translateX(0) skewX(-20deg);
        opacity: 0.3;
    }

    50% {
        opacity: 0.6;
    }

    100% {
        transform: translateX(150%) skewX(-20deg);
        opacity: 0.3;
    }
}

.game-card:hover .game-icon-wrapper::after {
    /* Swipe the reflection across（与 keyframes 统一使用 transform，避免布局属性过渡） */
    transform: translateX(150%) skewX(-20deg);
    transition: transform 0.6s ease-in-out;
}

.game-card:hover .game-icon-wrapper {
    transform: translateY(-4px);
    /* Brighter crystal effect on hover */
    border-color: rgba(255, 255, 255, 0.5);
    box-shadow: inset 0 0 20px rgba(255, 255, 255, 0.2);
}

.game-card.active .game-icon-wrapper {
    /* Bright glossy border for active state */
    border-color: rgba(255, 255, 255, 0.9);
    box-shadow: inset 0 0 15px rgba(255, 255, 255, 0.3), 0 0 10px rgba(255, 255, 255, 0.3);
}

.game-icon {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 11px;
    /* Tighter radius for smaller gap (12-1=11) */
    display: block;
    z-index: 1;
    position: relative;
}

.game-label {
    width: 100%;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    padding: 4px 2px 0;
    margin: 0;

    line-height: 1.25;
    z-index: 10;
    /* 长预设名自动换行，不再截断省略 */
    white-space: normal;
    overflow-wrap: anywhere;
    border-radius: 0;
}
</style>
