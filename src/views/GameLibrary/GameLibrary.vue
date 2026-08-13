<script setup lang="ts">
import { computed, reactive, type CSSProperties, ref, onMounted, onUnmounted, nextTick } from 'vue';
import { AppStateManager, type GameInfo } from '../../store/AppStateManager';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ResourceManager } from '../../store/ResourceManager';
import { useRouter } from 'vue-router';
import { ElMessageBox, ElMessage } from 'element-plus';
import { useI18n } from 'vue-i18n';
import { open } from '@tauri-apps/plugin-dialog';
import { calculateContextMenuPosition } from '../../utils/ContextMenuPosition';
import { GAME_PRESET_OPTIONS } from '../../store/GamePreset';

const gamesList = AppStateManager.gamesList;
const appSettings = AppStateManager.appSettings;
const selectGame = AppStateManager.selectGame.bind(AppStateManager);
const loadGames = AppStateManager.loadGames.bind(AppStateManager);

// Router
const router = useRouter();
const { t } = useI18n();

// Reactive styles for animation
const cardStyles = reactive<Record<string, CSSProperties>>({});

// Context Menu State
const showMenu = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const targetGame = ref<any>(null);
const contextMenuRef = ref<HTMLElement | null>(null);

// Background Context Menu
const showBgMenu = ref(false);
const bgMenuX = ref(0);
const bgMenuY = ref(0);
const bgContextMenuRef = ref<HTMLElement | null>(null);

// Create Config Dialog
const showCreateDialog = ref(false);
const newConfigName = ref('');
const newConfigPreset = ref('');
const newIconPath = ref('');
const newIconPreview = ref('');
const presetOptions = computed(() => GAME_PRESET_OPTIONS);

const handleContextMenu = (e: MouseEvent, game: GameInfo) => {
  e.preventDefault();
    e.stopPropagation();
  targetGame.value = game;
  menuX.value = e.clientX;
  menuY.value = e.clientY;
  showMenu.value = true;
    showBgMenu.value = false;

    nextTick(() => {
        const menuEl = contextMenuRef.value;
        if (!menuEl) return;

        const rect = menuEl.getBoundingClientRect();
        const pos = calculateContextMenuPosition({
            clientX: e.clientX,
            clientY: e.clientY,
            menuWidth: rect.width,
            menuHeight: rect.height,
        });

        menuX.value = pos.x;
        menuY.value = pos.y;
    });
};

const closeMenu = () => {
  showMenu.value = false;
    showBgMenu.value = false;
};

const addGameToFavoritesByName = async (gameName: string, shouldNavigateHome = true) => {
    await ResourceManager.setGameVisibility(gameName, true);
    await loadGames();
    if (shouldNavigateHome) {
        router.push('/');
    }
};

const addToFavorites = async () => {
  if (!targetGame.value) return;
  
  const gameName = targetGame.value.name;
  
  try {
        // True = Show in Sidebar
        await addGameToFavoritesByName(gameName);
  } catch (err) {
    console.error('Failed to add game to favorites:', err);
  }
  
  closeMenu();
};

const deleteGameConfig = async () => {
    if (!targetGame.value) return;
    const gameName = targetGame.value.name;
    try {
        await ElMessageBox.confirm(
            t('gameLibrary.messages.deleteConfirmContent', { gameName }),
            t('gameLibrary.messages.deleteConfirmTitle'),
            {
            confirmButtonText: t('gameLibrary.dialog.delete'),
            cancelButtonText: t('gameLibrary.dialog.cancel'),
            type: 'warning',
            }
        );
    } catch {
        closeMenu();
        return;
    }

    try {
        await ResourceManager.deleteGameConfigFolder(gameName);
        await loadGames();

        // If the deleted game was active, switch to first available
        if (appSettings.CurrentGameName === gameName && gamesList.length > 0) {
            await selectGame(gamesList[0]);
        }
    } catch (err) {
        console.error('Failed to delete game config:', err);
        ElMessage.error(t('gameLibrary.messages.deleteConfigFailed'));
    } finally {
        closeMenu();
    }
};

const handleBackgroundContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    // Ignore if right-clicked on a card (they have their own menu)
    const target = e.target as HTMLElement;
    if (target.closest('.game-card')) return;

    bgMenuX.value = e.clientX;
    bgMenuY.value = e.clientY;
    showBgMenu.value = true;
    showMenu.value = false;

    nextTick(() => {
        const menuEl = bgContextMenuRef.value;
        if (!menuEl) return;

        const rect = menuEl.getBoundingClientRect();
        const pos = calculateContextMenuPosition({
            clientX: e.clientX,
            clientY: e.clientY,
            menuWidth: rect.width,
            menuHeight: rect.height,
        });

        bgMenuX.value = pos.x;
        bgMenuY.value = pos.y;
    });
};

const openCreateDialog = () => {
    showBgMenu.value = false;
    newConfigName.value = '';
    newConfigPreset.value = presetOptions.value[0]?.value || '';
    showCreateDialog.value = true;
};

const confirmCreateConfig = async () => {
    if (!newConfigName.value.trim()) {
        ElMessage.warning(t('gameLibrary.messages.enterConfigName'));
        return;
    }

    try {
        await ResourceManager.createNewConfig(newConfigName.value.trim(), {
                gamePreset: newConfigPreset.value, backgroundType: 'Image',
                
            });

        if (newIconPath.value) {
            await ResourceManager.setGameIcon(newConfigName.value.trim(), newIconPath.value);
        }

        await loadGames();
        const created = gamesList.find(g => g.name === newConfigName.value.trim());
        if (created) {
            await selectGame(created);
        }
        showCreateDialog.value = false;
        newIconPath.value = '';
        newIconPreview.value = '';
    } catch (err) {
        console.error('Create config failed:', err);
        ElMessage.error(t('gameLibrary.messages.createConfigFailed'));
    }
};

const pickNewIcon = async () => {
    try {
        const file = await open({
            multiple: false,
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif'] }],
        });
        if (typeof file === 'string') {
            newIconPath.value = file;
            newIconPreview.value = convertFileSrc(file);
        }
    } catch (err) {
        console.error('Pick icon failed:', err);
    }
};

const pickIconForGame = async () => {
    if (!targetGame.value) return;
    try {
        const file = await open({
            multiple: false,
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif'] }],
        });
        if (typeof file === 'string') {
            await ResourceManager.setGameIcon(targetGame.value.name, file);
            await loadGames();
        }
    } catch (err) {
        console.error('Set icon failed:', err);
        ElMessage.error(t('gameLibrary.messages.setIconFailed'));
    } finally {
        closeMenu();
    }
};

const handleGameDoubleClick = (game: GameInfo, event?: MouseEvent) => {
    if (event) {
        spawnLoveExplosion(event);
    }

    addTimer(async () => {
        try {
            if (!game.showSidebar) {
                await addGameToFavoritesByName(game.name, false);
            }
        } catch (err) {
            console.error('Failed to add game to favorites by double click:', err);
            ElMessage.error(t('gameLibrary.messages.addToFavoritesFailed'));
        }

        router.push('/');
    }, 300);
};

onMounted(() => {
  document.addEventListener('click', closeMenu);
});

onUnmounted(() => {
  document.removeEventListener('click', closeMenu);
});

// Animation Timer Management
let animationTimers: ReturnType<typeof setTimeout>[] = [];
const clearTimers = () => { 
    animationTimers.forEach(id => clearTimeout(id)); 
    animationTimers = []; 
};
const addTimer = (callback: () => void, delay: number) => {
    const id = setTimeout(callback, delay);
    animationTimers.push(id);
    return id;
};

// Love Particle System
interface Particle {
    id: number;
    x: number;
    y: number;
    text: string;
    style: CSSProperties;
}
const particles = ref<Particle[]>([]);
let particleId = 0;
const colors = ['#ff7eb3', '#ff758c', '#ff7eb3', '#fgbdff', '#ff9999', '#ffffff'];

// Background Hearts
interface BgHeart {
    id: number;
    x: number;
    y: number;
    size: number;
    rotation: number;
    color: string;
    opacity: number;
}
const bgHearts = ref<BgHeart[]>([]);

// Meteor Star System
interface MeteorStar {
    id: number;
    x: number;     // Start X
    y: number;     // Start Y
    tx: number;    // Translate X
    ty: number;    // Translate Y
    angle: number; // Movement angle for tail rotation
    color: string;
    emoji: string; // New: Random Emoji
    rotationDuration: string;
    flickerDuration: string; // New: Flicker speed
    flyDuration: string; 
    size: number;
    // opacity removed
    trail: Array<{ x: number, y: number, s: number, o: number }>; 
}
const meteorStars = ref<MeteorStar[]>([]);
let meteorId = 0;
const getMeteorStarColors = () => {
    if (typeof window === 'undefined') {
        return ['#7DDCFF', '#AEEBFF', '#E8F8FF'];
    }
    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue('--theme-accent').trim() || '#7DDCFF';
    const accentHover = style.getPropertyValue('--theme-accent-hover').trim() || '#AEEBFF';
    const textPrimary = style.getPropertyValue('--theme-text-primary').trim() || '#E8F8FF';
    return [accent, accentHover, textPrimary];
};
const meteorEmojis = ['⭐', '🌟', '💫', '✨', '☄️', '🪐', '🦄', '🌈', '🍭', '🌸', '🍩', '🍪', '🍕', '🚀', '🛸', '🧚', '💎', '🍄', '🐱', '🐶'];

const consecutiveClickCount = ref(0);
const lastClickedGameId = ref('');

const spawnMeteorStars = () => {
    // Spawn a few stars to create a "shower" feel
    const count = 3 + Math.floor(Math.random() * 4); 
    const w = window.innerWidth;
    const h = window.innerHeight;
    const starColors = getMeteorStarColors();
    
    for (let i = 0; i < count; i++) {
        // Pick a random start edge
        const edge = Math.floor(Math.random() * 4);
        let startX = 0, startY = 0;
        let endX = 0, endY = 0;
        
        switch(edge) {
            case 0: // Top -> Bottom
                startX = Math.random() * w; startY = -80; endX = Math.random() * w; endY = h + 150; break;
            case 1: // Right -> Left
                startX = w + 80; startY = Math.random() * h; endX = -150; endY = Math.random() * h; break;
            case 2: // Bottom -> Top
                startX = Math.random() * w; startY = h + 80; endX = Math.random() * w; endY = -150; break;
            case 3: // Left -> Right
                startX = -80; startY = Math.random() * h; endX = w + 150; endY = Math.random() * h; break;
        }

        // Calculate relative translation
        const tx = endX - startX;
        const ty = endY - startY;
        const angle = Math.atan2(ty, tx);

        // Speed: 1.2s - 2.5s
        const durationSec = 1.2 + Math.random() * 1.3;

        const ms: MeteorStar = {
            id: meteorId++,
            x: startX,
            y: startY,
            tx,
            ty,
            angle,
            color: starColors[Math.floor(Math.random() * starColors.length)],
            emoji: meteorEmojis[Math.floor(Math.random() * meteorEmojis.length)],
            rotationDuration: `${0.2 + Math.random() * 0.3}s`, // Fast Spin
            flickerDuration: `${0.1 + Math.random() * 0.2}s`, // Fast Flicker
            flyDuration: `${durationSec}s`,
            size: 24 + Math.random() * 32, 
            trail: [] // Empty
        };

        meteorStars.value.push(ms);
        
        // Remove after animation
        setTimeout(() => {
            meteorStars.value = meteorStars.value.filter(s => s.id !== ms.id);
        }, durationSec * 1000 + 100); 
    }
};

const handleGameSelect = async (game: GameInfo, event: MouseEvent) => {
    // 0. Track Consecutive Clicks
    if (lastClickedGameId.value === game.name) {
        consecutiveClickCount.value++;
    } else {
        lastClickedGameId.value = game.name;
        consecutiveClickCount.value = 1;
    }

    // Trigger Meteor Shower if 3+ clicks
    if (consecutiveClickCount.value >= 3) {
        spawnMeteorStars();
    }

    // If detecting consecutive click on already selected item
    if (appSettings.CurrentGameName === game.name) {
        spawnLoveExplosion(event);
    }
    
    // Always switch (or refresh) and trigger animations
    try {
        await selectGame(game);
    } catch (error) {
        console.error('Failed to switch game:', error);
        ElMessage.error(t('gameLibrary.messages.createConfigFailed'));
        return;
    }
    
    // Clear any pending return/cleanup timers to prevent conflict/snapping
    clearTimers();
    
    // Animate others being "blown away"
    const others = gamesList.filter(g => g.name !== game.name);
    
    // 1. Others: Blast away + Gray out
    others.forEach(g => {
        // If already blown away (and not returning), maintain current momentum/position
        const current = cardStyles[g.name];
        const isAlreadyOut = current && current.transform && !(current.transform as string).includes('translate(0, 0)');

        if (!isAlreadyOut) {
            // Random direction (complete 360 scatter)
            const angle = Math.random() * Math.PI * 2;
            const distance = 600 + Math.random() * 900;
            
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;
            
            // Random rotation for chaotic effect
            const rot = (Math.random() - 0.5) * 180; 

            cardStyles[g.name] = {
                transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(0.5)`,
                opacity: '0.4', // Fade slightly
                filter: 'grayscale(1) brightness(0.5)', // Turn gray and dark
                // Fast, explosive movement out
                transition: 'transform 0.4s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.4s ease, filter 0.4s ease'
            };
        }
    });

    // 2. Selected: Instant Pop + Shake Sequence
    // Phase A: Instant expansion
    cardStyles[game.name] = {
        transform: 'scale(1.5)',
        transition: 'transform 0.1s ease-out',
        zIndex: '200',
        filter: 'brightness(1.5)' // Flash bright
    };

    addTimer(() => {
        // Phase B: Vibration (Shake)
        // using animation property
        cardStyles[game.name] = {
            animation: 'impactShake 0.3s linear', // defined in CSS
            zIndex: '200',
            filter: 'brightness(1.2)'
        };

        // Phase C: Settle to Active State (Slow shrink)
        addTimer(() => {
            cardStyles[game.name] = {
                transform: 'scale(1.2)',
                transition: 'transform 0.6s ease-out',
                zIndex: '200',
                filter: 'none'
            };
            
            // Cleanup selected after settle
            addTimer(() => {
                delete cardStyles[game.name];
            }, 600);
            
        }, 300); // 300ms shake duration
    }, 100);

    // 3. Others: Schedule return (Traction force)
    addTimer(() => {
        others.forEach(g => {
            cardStyles[g.name] = {
                transform: 'translate(0, 0) rotate(0deg) scale(1)',
                opacity: '', // Revert to class-controlled opacity
                filter: 'grayscale(1) brightness(0.5)', // Keep gray during return!
                // Elastic/Springy return
                transition: 'transform 1.0s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.8s ease'
            };
        });

        // 4. Others: Recover color with random delay (GRADUAL FADE IN)
        addTimer(() => {
            others.forEach(g => {
                const randomDelay = Math.random() * 1000; // 0-1s random delay
                addTimer(() => {
                    // Transition to color (restore to default dim state)
                    cardStyles[g.name] = {
                         // Ensure we don't jump positions if they are still settling
                         transform: 'translate(0, 0) rotate(0deg) scale(1)', 
                         filter: 'grayscale(0.2) brightness(0.7)',
                         transition: 'filter 1.5s ease-in-out' // Smooth color transition
                    };
                    
                    // Final cleanup
                    addTimer(() => {
                        delete cardStyles[g.name]; 
                    }, 1500);
                }, randomDelay);
            });
        }, 1000); // Wait for return transition
    }, 350); // Wait for blast
};

const spawnLoveExplosion = (e: MouseEvent) => {
    // Determine coordinates based on click event source, or just use mouse position
    const x = e.clientX;
    const y = e.clientY;

    // 1. Background Giant Heart
    bgHearts.value.push({
        id: particleId++,
        x: x, 
        y: y,
        size: 300 + Math.random() * 300, // 300-600px
        rotation: (Math.random() - 0.5) * 60,
        color: '#ff7eb3',
        opacity: 0.1 + Math.random() * 0.2 // Random opacity
    });
    // Remove bg heart after animation
    setTimeout(() => {
        bgHearts.value.shift();
    }, 2000);

    // 2. Exploding Particles
    for (let i = 0; i < 15; i++) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = 100 + Math.random() * 200;
        const tx = Math.cos(angle) * velocity;
        const ty = Math.sin(angle) * velocity;
        const color = colors[Math.floor(Math.random() * colors.length)];
        const kaomojisArr = [
            '(｡♥‿♥｡)', '( ˘ ³˘)♥', 'OwO', 'UwU', '(*♡∀♡)', 
            '(◕‿◕✿)', '♥', '❤', '❥', '(≧◡≦)', '(>ω<)', 
            'Ciallo～(∠・ω< )⌒☆', 'Ciallo', '(∠・ω< )⌒★', 
            '(・ω< )', '☆⌒(ゝ。∂)', '(★^O^★)'
        ];
        const text = kaomojisArr[Math.floor(Math.random() * kaomojisArr.length)];
        
        const p: Particle = {
            id: particleId++,
            x: x,
            y: y,
            text: text,
            style: {
                '--tx': `${tx}px`,
                '--ty': `${ty}px`,
                color: color,
                fontSize: `${12 + Math.random() * 16}px`,
                fontWeight: 'bold',
                textShadow: '0 0 5px rgba(255,100,100,0.5)'
            } as CSSProperties
        };
        
        particles.value.push(p);
        
        // Remove particle
        setTimeout(() => {
            particles.value = particles.value.filter(item => item.id !== p.id);
        }, 1500);
    }
};
</script>

<template>
    <div class="game-library-container glass-scrollbar" @contextmenu.prevent="handleBackgroundContextMenu">
        <!-- Background Effects Layer -->
        <div class="effects-layer" aria-hidden="true">
            <div 
                v-for="h in bgHearts" 
                :key="h.id" 
                class="bg-heart"
                :style="{
                    left: h.x + 'px',
                    top: h.y + 'px',
                    width: h.size + 'px',
                    height: h.size + 'px',
                    transform: `translate(-50%, -50%) rotate(${h.rotation}deg)`,
                    opacity: h.opacity
                }"
            >
                <svg viewBox="0 0 32 29.6" fill="currentColor">
                    <path d="M23.6,0c-3.4,0-6.3,2.7-7.6,5.6C14.7,2.7,11.8,0,8.4,0C3.8,0,0,3.8,0,8.4c0,9.4,9.5,11.9,16,21.2
                    c6.1-9.3,16-11.8,16-21.2C32,3.8,28.2,0,23.6,0z"/>
                </svg>
            </div>
        </div>

        <!-- Meteor Star Layer -->
        <div class="meteor-layer" aria-hidden="true">
            <div 
                v-for="s in meteorStars" 
                :key="s.id" 
                class="meteor-star-wrapper"
                :style="{
                    left: s.x + 'px',
                    top: s.y + 'px',
                    '--tx': s.tx + 'px',
                    '--ty': s.ty + 'px',
                    animationDuration: s.flyDuration
                } as Record<string, string | number>"
            >
                <div 
                    class="meteor-star-inner"
                    :style="{
                        color: s.color,
                        fontSize: s.size + 'px',
                        animation: `starSpin ${s.rotationDuration} linear infinite, starFlicker ${s.flickerDuration} ease-in-out infinite alternate`,
                        textShadow: `0 0 10px ${s.color}`
                    }"
                >{{ s.emoji }}</div>
            </div>
        </div>

        <!-- Particle Layer -->
        <div class="particles-layer" aria-hidden="true">
             <div 
                v-for="p in particles" 
                :key="p.id" 
                class="love-particle"
                :style="{
                    left: p.x + 'px',
                    top: p.y + 'px',
                    ...p.style
                }"
            >
                {{ p.text }}
            </div>
        </div>

        <div class="games-grid">
                <button class="game-card"
                    v-for="game in gamesList" 
                    :key="game.name"
                    type="button"
                    :class="{ active: appSettings.CurrentGameName === game.name }"
                    :style="cardStyles[game.name]"
                    :aria-pressed="appSettings.CurrentGameName === game.name"
                    :title="game.name"
                    @click="handleGameSelect(game, $event)"
                    @dblclick.stop="handleGameDoubleClick(game, $event)"
                    @keydown.enter.stop.prevent="handleGameDoubleClick(game)"
                    @contextmenu.prevent="handleContextMenu($event, game)"
                >
                    <div class="game-icon-wrapper">
                        <img 
                            :src="game.iconPath" 
                            class="game-icon" 
                            alt=""
                            @load="(e) => (e.target as HTMLImageElement).style.opacity = '1'"
                            @error="(e) => (e.target as HTMLImageElement).style.opacity = '0'"
                        />
                    </div>
                    <span class="game-label">{{ game.name }}</span>
                </button>
        </div>

        <!-- Custom Context Menu for Game Library -->
        <div 
          v-if="showMenu" 
                    ref="contextMenuRef"
          class="context-menu glass-context-menu game-library-context-menu"
          :style="{ top: menuY + 'px', left: menuX + 'px' }"
          role="menu"
          @click.stop
        >
          <button type="button" class="menu-item" role="menuitem" @click="addToFavorites">
                                                {{ t('gameLibrary.actions.addToFavorites') }}
          </button>
                    <button type="button" class="menu-item danger" role="menuitem" @click="deleteGameConfig">
                                                                                                {{ t('gameLibrary.actions.deleteConfig') }}
                    </button>
                    <button type="button" class="menu-item" role="menuitem" @click="pickIconForGame">
                                                                                                {{ t('gameLibrary.actions.chooseIcon') }}
                    </button>
        </div>

                <!-- Background Context Menu -->
                <div
                    v-if="showBgMenu"
                    ref="bgContextMenuRef"
                    class="context-menu glass-context-menu game-library-context-menu"
                    :style="{ top: bgMenuY + 'px', left: bgMenuX + 'px' }"
                    role="menu"
                    @click.stop
                >
                    <button type="button" class="menu-item" role="menuitem" @click="openCreateDialog">{{ t('gameLibrary.actions.createConfig') }}</button>
                </div>

                <!-- Create Config Dialog -->
                <el-dialog v-model="showCreateDialog" class="game-library-dialog" :title="t('gameLibrary.dialog.createTitle')" width="min(440px, calc(100vw - 32px))">
                    <div class="dialog-body">
                        <div class="icon-preview">
                            <img v-if="newIconPreview" :src="newIconPreview" :alt="newConfigName || t('gameLibrary.dialog.noIcon')" />
                            <div v-else class="icon-placeholder">{{ t('gameLibrary.dialog.noIcon') }}</div>
                            <el-button class="icon-pick-btn" size="small" @click="pickNewIcon">{{ t('gameLibrary.actions.chooseIcon') }}</el-button>
                        </div>

                        <div class="dialog-fields">
                            <div class="dialog-row">
                                <label class="dialog-label" for="new-config-name">{{ t('gameLibrary.dialog.configName') }}</label>
                                <el-input id="new-config-name" v-model="newConfigName" :placeholder="t('gameLibrary.dialog.enterConfigName')" />
                            </div>
                            <div class="dialog-row">
                                <label class="dialog-label" for="new-config-preset">{{ t('gameLibrary.dialog.gamePreset') }}</label>
                                <el-select id="new-config-preset" v-model="newConfigPreset" popper-class="game-library-select-popper" :placeholder="t('gameLibrary.dialog.selectPreset')" style="width: 100%">
                                    <el-option
                                        v-for="opt in presetOptions"
                                        :key="opt.value"
                                        :label="opt.label"
                                        :value="opt.value"
                                    />
                                </el-select>
                            </div>
                        </div>
                    </div>

                    <template #footer>
                        <span class="dialog-footer">
                            <el-button @click="showCreateDialog = false">{{ t('gameLibrary.dialog.cancel') }}</el-button>
                            <el-button type="primary" @click="confirmCreateConfig">{{ t('gameLibrary.dialog.confirm') }}</el-button>
                        </span>
                    </template>
                </el-dialog>
    </div>
</template>

<style scoped>
.game-library-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: 32px 28px;
    background: transparent;
    overflow-y: auto;
    overflow-x: hidden;
}

/* Context Menu — visual styles handled by .glass-context-menu global */
.context-menu {
  position: fixed;
  z-index: 10000;
  border-radius: 10px;
  padding: 6px;
  min-width: 150px;
}

.game-library-context-menu {
  background: #1e1e2e;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.menu-item {
  width: 100%;
  border: 0;
  background: transparent;
  font: inherit;
  text-align: left;
  padding: 9px 14px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  font-weight: 500;
  border-radius: 6px;
  transition: all 0.15s;
  white-space: nowrap;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
}

/* Meteor Star CSS */
.meteor-layer {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 300; /* Above cards and explosions */
}
.meteor-star-wrapper {
    position: absolute;
    /* Use ease-in to simulate gravity or accelerating streak currently mapped to flying across whole screen */
    animation: flyAcross linear forwards; 
}
.meteor-star-inner {
    /* Self-rotation handled by inline style */
    display: inline-block;
    width: 100%;
    height: 100%;
    line-height: 1;
    font-weight: bold;
    transform-origin: 50% 55%; /* Fix visual center rotation */
    text-align: center;
}
.meteor-tail-container {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    z-index: -1;
    pointer-events: none;
}
.meteor-trail-dot {
    position: absolute;
    border-radius: 50%;
    /* Create a pulsing effect for trail particles */
    animation: trailPulse 0.5s ease-in-out infinite alternate;
}

@keyframes flyAcross {
    to { transform: translate(var(--tx), var(--ty)); }
}
@keyframes starSpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
@keyframes starFlicker {
    from { opacity: 1; }
    to { opacity: 0.3; }
}
@keyframes trailPulse {
    from { transform: scale(0.8); opacity: 0.3; }
    to { transform: scale(1.2); opacity: 0.8; }
}

/* Keyframes for Impact Shake */
@keyframes impactShake {
    0% { transform: scale(1.5) translate(0, 0); }
    20% { transform: scale(1.5) translate(-4px, 4px); }
    40% { transform: scale(1.5) translate(4px, -4px); }
    60% { transform: scale(1.5) translate(-3px, 0); }
    80% { transform: scale(1.5) translate(3px, 0); }
    100% { transform: scale(1.5) translate(0, 0); }
}



.games-grid {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 28px;
    padding: 24px 40px 40px;
}

/* --- Crystal Icon Styles (Reused & Adapted) --- */

.game-card {
    position: relative;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: center;
    cursor: pointer;
    transition: transform 0.4s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s ease, filter 0.4s ease;
    width: 100px;
    opacity: 0.75;
    filter: brightness(0.7) grayscale(0.25);
    transform-origin: center center;
    z-index: 10;
    padding-bottom: 24px;
}

:global(.game-library-dialog) {
    background: #111827;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

:global(.game-library-select-popper.el-popper) {
    background: transparent;
}

.game-card:hover {
    transition: transform 0.15s ease-out, opacity 0.2s ease, filter 0.2s ease;
    transform: scale(1.12);
    opacity: 1;
    filter: none;
    z-index: 100;
}

.game-card.active {
    opacity: 1;
    filter: none;
    transform: scale(1.15);
    z-index: 50;
}

.game-icon-wrapper {
    position: relative;
    width: 82px;
    height: 82px;

    /* Crystal filling texture */
    background: radial-gradient(circle at 50% 0%,
            rgba(255, 255, 255, 0.12) 0%,
            rgba(255, 255, 255, 0.04) 40%,
            rgba(255, 255, 255, 0.01) 100%);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 16px;
    padding: 3px;

    display: flex;
    align-items: center;
    justify-content: center;

    /* Constant radiating light */
    box-shadow:
        0 0 10px rgba(var(--theme-surface-tint-rgb), 0.10),
        inset 0 0 12px rgba(255, 255, 255, 0.08);
    transition: all 0.25s;
    overflow: hidden;

    /* Magic fluid/particle flow */
}

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
    z-index: 2;
    pointer-events: none;
    mix-blend-mode: screen;
    opacity: 0;
    transition: opacity 0.3s;
}

.game-card:hover .game-icon-wrapper::before,
.game-card.active .game-icon-wrapper::before {
    opacity: 1;
    animation: magicRotate 7s linear infinite;
}

/* Crystal reflection sheen */
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
}

.game-card:hover .game-icon-wrapper::after,
.game-card.active .game-icon-wrapper::after {
    animation: subtleSheen 2s ease-in-out infinite;
}

.game-card:hover .game-icon-wrapper {
    transform: translateY(-3px);
    border-color: rgba(255, 255, 255, 0.5);
    box-shadow: 0 4px 20px rgba(var(--theme-surface-tint-rgb), 0.20), inset 0 0 20px rgba(255, 255, 255, 0.2);
}

.game-card.active .game-icon-wrapper {
    animation: crystalPulse 4s ease-in-out infinite;
    border-color: rgba(255, 255, 255, 0.3);
    box-shadow: 0 0 20px rgba(var(--theme-surface-tint-rgb), 0.24), inset 0 0 20px rgba(255, 255, 255, 0.25);
}

.game-card.active .game-label {
    color: rgba(var(--theme-surface-tint-rgb), 0.85);
}

@keyframes crystalPulse {
    0%, 100% {
        box-shadow: 0 0 12px rgba(var(--theme-surface-tint-rgb), 0.14), inset 0 0 15px rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.25);
    }
    50% {
        box-shadow: 0 0 22px rgba(var(--theme-surface-tint-rgb), 0.28), inset 0 0 22px rgba(255, 255, 255, 0.25);
        border-color: rgba(255, 255, 255, 0.5);
    }
}

@keyframes magicRotate {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

@keyframes subtleSheen {
    0% { left: -150%; opacity: 0.3; }
    40% { left: 150%; opacity: 0.3; }
    100% { left: 150%; opacity: 0.3; }
}

/* Radiating Warm White Breathing Light */
.game-card.active::before {
    content: "";
    position: absolute;
    top: 50%; left: 50%;
    width: 220%; height: 220%;
    transform: translate(-50%, -50%);
    background: radial-gradient(
        circle closest-side,
        rgba(var(--theme-surface-tint-rgb), 0.2) 0%,
        rgba(214, 240, 255, 0.12) 35%,
        transparent 70%
    );
    z-index: -1;
    border-radius: 50%;
    filter: blur(24px);
    animation: radiateBreath 3s ease-in-out infinite;
    pointer-events: none;
}

@keyframes radiateBreath {
    0%, 100% {
        opacity: 0.4;
        transform: translate(-50%, -50%) scale(0.85);
    }
    50% {
        opacity: 0.8;
        transform: translate(-50%, -50%) scale(1.15);
    }
}

.game-icon {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 13px;
    display: block;
    z-index: 1;
    position: relative;
}

.game-label {
    width: 100%;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.65);
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
    padding: 6px 0 0;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: 0.02em;
    transition: color 0.2s;
}

.game-card:hover .game-label {
    color: rgba(255, 255, 255, 0.9);
}

/* Animations and Layers */
.effects-layer, .particles-layer {
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    pointer-events: none;
    z-index: 5; /* Below game cards (z-index 10) but above background */
    overflow: hidden;
}

.bg-heart {
    position: absolute;
    color: #ff7eb3;
    animation: bgHeartFade 2s ease-out forwards;
    filter: blur(5px);
}

@keyframes bgHeartFade {
    0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
    20% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); }
    100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
}

.love-particle {
    position: absolute;
    pointer-events: none;
    animation: particleFly 1.5s cubic-bezier(0.25, 1, 0.5, 1) forwards;
    white-space: nowrap;
}

@keyframes particleFly {
    0% { transform: translate(-50%, -50%) scale(0); opacity: 1; }
    50% { opacity: 1; }
    100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) scale(1.5); opacity: 0; }
}
</style>
