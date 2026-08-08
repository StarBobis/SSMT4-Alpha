import { ref } from 'vue';
import type { RouteLocationNormalizedLoaded, RouteLocationRaw, Router } from 'vue-router';

export type GameBananaHistoryKind = 'home' | 'author' | 'mod';

export interface GameBananaHistoryEntry {
  kind: GameBananaHistoryKind;
  title: string;
  location: RouteLocationRaw;
}

const initialEntry: GameBananaHistoryEntry = {
  kind: 'home',
  title: '',
  location: { name: 'GameBanana', query: {} },
};
const entries = ref<GameBananaHistoryEntry[]>([]);
const index = ref(-1);

interface HistorySnapshot {
  entries: GameBananaHistoryEntry[];
  index: number;
}

let pruneUndo: HistorySnapshot | null = null;
let pruneRedo: HistorySnapshot | null = null;

const snapshot = (): HistorySnapshot => ({ entries: [...entries.value], index: index.value });
const restore = (value: HistorySnapshot) => {
  entries.value = [...value.entries];
  index.value = value.index;
};
const clearPruneHistory = () => {
  pruneUndo = null;
  pruneRedo = null;
};

const isGameBananaRoute = (route: RouteLocationNormalizedLoaded): boolean =>
  route.name === 'GameBanana' || route.name === 'GameBananaAuthor';

const routeKey = (router: Router, entry: GameBananaHistoryEntry): string => router.resolve(entry.location).fullPath;

const queryValue = (value: unknown): string => Array.isArray(value) ? String(value[0] || '') : String(value || '');

const routeEntry = (route: RouteLocationNormalizedLoaded): GameBananaHistoryEntry => {
  if (route.name === 'GameBananaAuthor') {
    return {
      kind: 'author',
      title: `#${queryValue(route.params.authorId)}`,
      location: { name: route.name, params: { ...route.params }, query: { ...route.query } },
    };
  }

  const modId = queryValue(route.query.mod);
  if (modId) {
    return {
      kind: 'mod',
      title: `#${modId}`,
      location: { name: route.name as string, params: { ...route.params }, query: { ...route.query } },
    };
  }

  return {
    kind: 'home',
    title: '',
    location: { name: route.name as string, params: { ...route.params }, query: { ...route.query } },
  };
};

export const gameBananaHistory = {
  entries,
  index,
  get items() { return entries.value; },
  get currentIndex() { return index.value; },
  get canGoBack() { return pruneUndo !== null || index.value > 0; },
  get canGoForward() { return pruneRedo !== null || (index.value >= 0 && index.value < entries.value.length - 1); },
  get canGoParent() { return index.value > 0; },
  get isHome() { return index.value === 0; },

  ensureInitialized(router: Router, route: RouteLocationNormalizedLoaded) {
    if (index.value >= 0) return;
    entries.value = [initialEntry];
    index.value = 0;
    if (isGameBananaRoute(route)) {
      const current = routeEntry(route);
      if (routeKey(router, current) !== routeKey(router, initialEntry)) {
        entries.value.push(current);
        index.value = 1;
      }
    }
  },

  observe(router: Router, route: RouteLocationNormalizedLoaded) {
    this.ensureInitialized(router, route);
    if (!isGameBananaRoute(route)) return;

    const current = routeEntry(route);
    const key = routeKey(router, current);
    if (index.value >= 0 && routeKey(router, entries.value[index.value]) === key) return;
    clearPruneHistory();
    let existingIndex = -1;
    entries.value.forEach((entry, entryIndex) => {
      if (routeKey(router, entry) === key) existingIndex = entryIndex;
    });
    if (existingIndex >= 0) {
      index.value = existingIndex;
      return;
    }

    entries.value.push(current);
    index.value = entries.value.length - 1;
  },

  async push(router: Router, entry: GameBananaHistoryEntry) {
    this.ensureInitialized(router, router.currentRoute.value);
    clearPruneHistory();
    entries.value.push(entry);
    index.value = entries.value.length - 1;
    await router.push(entry.location);
  },

  async replace(router: Router, entry: GameBananaHistoryEntry) {
    this.ensureInitialized(router, router.currentRoute.value);
    clearPruneHistory();
    entries.value[index.value] = entry;
    await router.replace(entry.location);
  },

  async go(router: Router, direction: -1 | 1) {
    if (direction === -1 && pruneUndo) {
      const redo = snapshot();
      const target = pruneUndo.entries[pruneUndo.index];
      restore(pruneUndo);
      pruneUndo = null;
      pruneRedo = redo;
      if (target && routeKey(router, target) !== router.currentRoute.value.fullPath) {
        await router.push(target.location);
      }
      return;
    }

    if (direction === 1 && pruneRedo) {
      const undo = snapshot();
      const target = pruneRedo.entries[pruneRedo.index];
      restore(pruneRedo);
      pruneRedo = null;
      pruneUndo = undo;
      if (target && routeKey(router, target) !== router.currentRoute.value.fullPath) {
        await router.push(target.location);
      }
      return;
    }

    const targetIndex = index.value + direction;
    const target = entries.value[targetIndex];
    if (!target) return;
    clearPruneHistory();
    index.value = targetIndex;
    await router.push(target.location);
  },

  async jump(router: Router, targetIndex: number) {
    const target = entries.value[targetIndex];
    if (!target) return;
    const wasPruned = targetIndex < entries.value.length - 1;
    if (wasPruned) pruneUndo = snapshot();
    pruneRedo = null;
    entries.value.splice(targetIndex + 1);
    index.value = targetIndex;
    if (routeKey(router, target) !== router.currentRoute.value.fullPath) {
      await router.push(target.location);
    }
  },

  async parent(router: Router) {
    if (index.value <= 0) return;
    await this.jump(router, index.value - 1);
  },

  async home(router: Router) {
    clearPruneHistory();
    entries.value = [initialEntry];
    index.value = 0;
    if (routeKey(router, initialEntry) !== router.currentRoute.value.fullPath) {
      await router.replace(initialEntry.location);
    }
  },
};
