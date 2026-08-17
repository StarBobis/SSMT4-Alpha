import { reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { cloneModKeyInfo, linkSharedConstantBindings, migotoIniService } from './MigotoIni';
import type { ModAnalysisResult, ModInfo, ModKeyEditorDialogState, ModKeyInfo } from './ModsManagement.types';
import type { Ref } from 'vue';

type Translate = (key: string, params?: Record<string, unknown>) => string;

interface UseModsManagementModKeysOptions {
    selectedGame: Ref<string>;
    mods: Ref<ModInfo[]>;
    suppressFsRefresh: (durationMs?: number) => void;
    applyAnalysisResultToMod: (mod: ModInfo, modKey: string, result: ModAnalysisResult) => void;
    t: Translate;
}

export const useModsManagementModKeys = (options: UseModsManagementModKeysOptions) => {
    const modKeyLists = reactive<Record<string, ModKeyInfo[]>>({});
    const modKeyLoadingState = reactive<Record<string, boolean>>({});
    const modKeyErrorState = reactive<Record<string, string>>({});

    const modKeyEditorDialog = reactive<ModKeyEditorDialogState>({
        visible: false,
        loading: false,
        saving: false,
        modId: '',
        modName: '',
        modRelativePath: '',
        modPath: '',
        items: [],
    });

    const resetModKeyPopoverState = () => {
        Object.keys(modKeyLists).forEach((key) => delete modKeyLists[key]);
        Object.keys(modKeyLoadingState).forEach((key) => delete modKeyLoadingState[key]);
        Object.keys(modKeyErrorState).forEach((key) => delete modKeyErrorState[key]);
    };

    const getModKeyItems = (modId: string) => modKeyLists[modId] || [];

    // ── 虚拟键码 → 人类可读键名 ──
    const KEY_MAP: Record<string, string> = {
        // F 功能键
        VK_F1: 'F1', VK_F2: 'F2', VK_F3: 'F3', VK_F4: 'F4',
        VK_F5: 'F5', VK_F6: 'F6', VK_F7: 'F7', VK_F8: 'F8',
        VK_F9: 'F9', VK_F10: 'F10', VK_F11: 'F11', VK_F12: 'F12',
        VK_F13: 'F13', VK_F14: 'F14', VK_F15: 'F15', VK_F16: 'F16',
        VK_F17: 'F17', VK_F18: 'F18', VK_F19: 'F19', VK_F20: 'F20',
        VK_F21: 'F21', VK_F22: 'F22', VK_F23: 'F23', VK_F24: 'F24',
        // 修饰键
        VK_SHIFT: 'Shift', VK_LSHIFT: 'Shift', VK_RSHIFT: 'Shift',
        VK_CONTROL: 'Ctrl', VK_LCONTROL: 'Ctrl', VK_RCONTROL: 'Ctrl',
        VK_MENU: 'Alt', VK_LMENU: 'Alt', VK_RMENU: 'Alt',
        alt: 'Alt', ctrl: 'Ctrl', shift: 'Shift',
        // 方向键
        VK_UP: '↑', VK_DOWN: '↓', VK_LEFT: '←', VK_RIGHT: '→',
        // 导航键
        VK_SPACE: 'Space', VK_TAB: 'Tab', VK_RETURN: 'Enter',
        VK_BACK: 'Backspace', VK_DELETE: 'Del', VK_INSERT: 'Ins',
        VK_HOME: 'Home', VK_END: 'End',
        VK_PRIOR: 'PgUp', VK_NEXT: 'PgDn',
        VK_ESCAPE: 'Esc', VK_CAPITAL: 'CapsLock',
        VK_NUMLOCK: 'NumLk', VK_SCROLL: 'ScrLk',
        VK_PAUSE: 'Pause', VK_SNAPSHOT: 'PrtSc',
        // 数字小键盘
        VK_NUMPAD0: 'Num0', VK_NUMPAD1: 'Num1', VK_NUMPAD2: 'Num2',
        VK_NUMPAD3: 'Num3', VK_NUMPAD4: 'Num4', VK_NUMPAD5: 'Num5',
        VK_NUMPAD6: 'Num6', VK_NUMPAD7: 'Num7', VK_NUMPAD8: 'Num8',
        VK_NUMPAD9: 'Num9',
        VK_MULTIPLY: 'Num*', VK_ADD: 'Num+', VK_SUBTRACT: 'Num-',
        VK_DECIMAL: 'Num.', VK_DIVIDE: 'Num/',
        // 鼠标
        VK_LBUTTON: 'Mouse1', VK_RBUTTON: 'Mouse2', VK_MBUTTON: 'Mouse3',
        VK_XBUTTON1: 'Mouse4', VK_XBUTTON2: 'Mouse5',
        // 多媒体
        VK_VOLUME_MUTE: 'Mute', VK_VOLUME_DOWN: 'Vol↓', VK_VOLUME_UP: 'Vol↑',
        VK_MEDIA_NEXT_TRACK: 'Next', VK_MEDIA_PREV_TRACK: 'Prev',
        VK_MEDIA_STOP: 'Stop', VK_MEDIA_PLAY_PAUSE: 'Play',
        // OEM 符号键 (US ANSI)
        VK_OEM_PLUS: '=', VK_OEM_MINUS: '-', VK_OEM_COMMA: ',',
        VK_OEM_PERIOD: '.', VK_OEM_1: ';', VK_OEM_2: '/',
        VK_OEM_3: '`', VK_OEM_4: '[', VK_OEM_5: '\\',
        VK_OEM_6: ']', VK_OEM_7: "'",
        // Win / App
        VK_LWIN: 'Win', VK_RWIN: 'Win', VK_APPS: 'Menu',
    };

    /** 过滤 no_* 修饰符，翻译 VK_ 码为人类可读键名，用 + 连接 */
    const formatKeyDisplay = (raw: string): string => {
        const tokens = raw
            .split(' ')
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && !s.toLowerCase().startsWith('no_'));

        const translated = tokens.map((token) => {
            // 精确匹配映射表
            if (KEY_MAP[token] !== undefined) return KEY_MAP[token];
            // VK_ 开头的未知码保留原名
            if (token.toUpperCase().startsWith('VK_')) return token;
            return token;
        });

        return translated.join(' + ');
    };

    const getModKeyDisplayName = (item: ModKeyInfo) => {
        const keyName = formatKeyDisplay((item.keyName || '').trim());
        const backName = formatKeyDisplay((item.backName || '').trim());

        if (keyName && backName && keyName !== backName) {
            return `${keyName} / ${backName}`;
        }

        if (keyName) {
            return keyName;
        }

        if (backName) {
            return backName;
        }

        return options.t('modsManagement.ui.unnamedKey');
    };

    const getModKeySectionTitle = (item: ModKeyInfo) => {
        const sectionName = (item.sectionName || '').trim();
        if (sectionName) {
            return sectionName;
        }
        return getModKeyDisplayName(item);
    };

    const addBindingInput = (values: string[]) => {
        values.push('');
    };

    const removeBindingInput = (values: string[], index: number) => {
        values.splice(index, 1);
        if (values.length === 0) {
            values.push('');
        }
    };

    const loadModKeyList = async (mod: ModInfo) => {
        if (!options.selectedGame.value || modKeyLoadingState[mod.id] || mod.id in modKeyLists) {
            return;
        }

        const gameName = options.selectedGame.value;
        const snapshot = migotoIniService.getSnapshot(gameName, mod.relativePath);
        if (snapshot.status === 'ready' && snapshot.result) {
            modKeyLists[mod.id] = snapshot.result.modKeyList;
            return;
        }

        modKeyLoadingState[mod.id] = true;
        delete modKeyErrorState[mod.id];

        try {
            const result = await migotoIniService.load(gameName, mod);
            modKeyLists[mod.id] = result.modKeyList;
        } catch (error) {
            console.error('Failed to load mod key list:', error);
            modKeyErrorState[mod.id] = String(error);
        } finally {
            modKeyLoadingState[mod.id] = false;
        }
    };

    const openModKeyEditor = async (mod: ModInfo) => {
        if (!options.selectedGame.value) {
            return;
        }

        modKeyEditorDialog.visible = true;
        modKeyEditorDialog.loading = true;
        modKeyEditorDialog.saving = false;
        modKeyEditorDialog.modId = mod.id;
        modKeyEditorDialog.modName = mod.name;
        modKeyEditorDialog.modRelativePath = mod.relativePath;
        modKeyEditorDialog.modPath = mod.path;

        try {
            const result = await migotoIniService.load(options.selectedGame.value, mod);
            modKeyEditorDialog.items = linkSharedConstantBindings(result.modKeyList.map(cloneModKeyInfo));
        } catch (error) {
            modKeyEditorDialog.items = [];
            ElMessage.error(options.t('modsManagement.messages.loadModKeyListFailed', { error: String(error) }));
        } finally {
            modKeyEditorDialog.loading = false;
        }
    };

    const saveModKeyEditor = async () => {
        if (!options.selectedGame.value || !modKeyEditorDialog.modRelativePath || !modKeyEditorDialog.modPath) {
            return;
        }

        modKeyEditorDialog.saving = true;
        try {
            options.suppressFsRefresh(1800);
            const result = await migotoIniService.saveModKeys(
                options.selectedGame.value,
                { relativePath: modKeyEditorDialog.modRelativePath, path: modKeyEditorDialog.modPath },
                modKeyEditorDialog.items.map(cloneModKeyInfo),
            );

            modKeyLists[modKeyEditorDialog.modId] = result.modKeyList;

            const liveMod = options.mods.value.find((item) => item.id === modKeyEditorDialog.modId);
            if (liveMod) {
                options.applyAnalysisResultToMod(liveMod, `${options.selectedGame.value}:${liveMod.relativePath}`, result);
            }

            ElMessage.success(options.t('modsManagement.messages.modKeySaved'));
            modKeyEditorDialog.visible = false;
        } catch (error) {
            ElMessage.error(options.t('modsManagement.messages.saveModKeyFailed', { error: String(error) }));
        } finally {
            modKeyEditorDialog.saving = false;
        }
    };

    return {
        modKeyLists,
        modKeyLoadingState,
        modKeyErrorState,
        modKeyEditorDialog,
        resetModKeyPopoverState,
        getModKeyItems,
        getModKeyDisplayName,
        getModKeySectionTitle,
        addBindingInput,
        removeBindingInput,
        loadModKeyList,
        openModKeyEditor,
        saveModKeyEditor,
    };
};
