<script setup lang="ts">
import { Delete } from '@element-plus/icons-vue';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SkipRow, VSCheckRow } from './WorkPage.types';

const { t } = useI18n();

const skipRows = defineModel<SkipRow[]>('skipRows', { required: true });
const vsRows = defineModel<VSCheckRow[]>('vsRows', { required: true });

const emit = defineEmits<{
  removeSkipRow: [index: number];
  generateIBSkip: [];
  removeVSCheckRow: [index: number];
  updateVSCheck: [];
  generateVSCheck: [];
}>();

type ResizableColumn = { minWidth?: number | string; width?: number | string; realWidth?: number | null };
const skipTable = ref<any>();
const vsTable = ref<any>();
const skipTableHost = ref<HTMLElement>();
const vsTableHost = ref<HTMLElement>();
let resizePair: { next?: ResizableColumn; nextStart: number } | undefined;
const resizeObservers: ResizeObserver[] = [];

const fitColumnsToContainer = (host: HTMLElement | undefined, tableInstance: any) => {
  if (!host || !tableInstance) return;
  const columns = tableInstance.store?.states?.columns?.value as ResizableColumn[] | undefined;
  if (!columns?.length) return;
  const available = host.clientWidth;
  const fixedWidth = Number(columns.at(-1)?.realWidth ?? columns.at(-1)?.width) || 56;
  const resizable = columns.slice(0, -1);
  const currentTotal = resizable.reduce((sum, item) => sum + (Number(item.realWidth ?? item.width) || 0), 0);
  if (available <= fixedWidth || currentTotal <= 0) return;
  const scale = (available - fixedWidth) / currentTotal;
  let used = fixedWidth;
  resizable.forEach((item, index) => {
    const width = index === resizable.length - 1
      ? available - used
      : Math.round((Number(item.realWidth ?? item.width) || 0) * scale);
    item.width = width;
    item.realWidth = width;
    used += width;
  });
  tableInstance.store.scheduleLayout(false, true);
};

const observeTable = (host: HTMLElement | undefined, tableInstance: any) => {
  if (!host) return;
  const observer = new ResizeObserver(() => fitColumnsToContainer(host, tableInstance));
  observer.observe(host);
  resizeObservers.push(observer);
  fitColumnsToContainer(host, tableInstance);
};
const keepDraggedColumnWidth = (newWidth: number, _oldWidth: number, column: ResizableColumn) => {
  const minimum = Number(column.minWidth) || 60;
  const resolvedWidth = Math.max(minimum, newWidth);
  column.width = resolvedWidth;
  column.realWidth = resolvedWidth;
  if (resizePair?.next) {
    const nextWidth = resizePair.nextStart - (resolvedWidth - _oldWidth);
    resizePair.next.width = nextWidth;
    resizePair.next.realWidth = nextWidth;
  }
  resizePair = undefined;
};

let stopResizePreview: (() => void) | undefined;
const constrainResizePreview = (event: MouseEvent, tableInstance: any) => {
  const headerCell = (event.target as HTMLElement | null)?.closest('th.el-table__cell') as HTMLElement | null;
  const table = headerCell?.closest('.el-table') as HTMLElement | null;
  if (!headerCell || !table || headerCell.classList.contains('model-table-actions-column')) return;
  const classMinimum = [...headerCell.classList].find((name) => name.startsWith('column-min-'));
  const minimum = Number(classMinimum?.slice('column-min-'.length)) || 80;
  const tableLeft = table.getBoundingClientRect().left;
  const minimumLeft = headerCell.getBoundingClientRect().left - tableLeft + minimum;
  const headers = [...headerCell.parentElement!.children] as HTMLElement[];
  const columnIndex = headers.indexOf(headerCell);
  const columns = tableInstance?.store?.states?.columns?.value as ResizableColumn[] | undefined;
  const current = columns?.[columnIndex];
  const next = columns?.[columnIndex + 1];
  if (!current || !next) return;
  const currentStart = Number(current.realWidth ?? current.width) || headerCell.offsetWidth;
  const nextStart = Number(next.realWidth ?? next.width) || headers[columnIndex + 1]?.offsetWidth || 0;
  const nextMinimum = Number(next.minWidth) || 56;
  const maximumLeft = headerCell.getBoundingClientRect().left - tableLeft + currentStart + nextStart - nextMinimum;
  resizePair = { next, nextStart };
  const move = () => requestAnimationFrame(() => {
    const proxy = table.querySelector('.el-table__column-resize-proxy') as HTMLElement | null;
    if (proxy) proxy.style.left = `${Math.min(maximumLeft, Math.max(minimumLeft, Number.parseFloat(proxy.style.left)))}px`;
  });
  document.addEventListener('mousemove', move, true);
  const stop = () => {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('mouseup', stop, true);
  };
  document.addEventListener('mouseup', stop, true);
  stopResizePreview = stop;
};
onMounted(() => nextTick(() => {
  observeTable(skipTableHost.value, skipTable.value);
  observeTable(vsTableHost.value, vsTable.value);
}));
onBeforeUnmount(() => {
  stopResizePreview?.();
  resizeObservers.forEach((observer) => observer.disconnect());
});
</script>

<template>
  <section class="inner-panel">
    <div ref="skipTableHost" class="table-row">
      <el-table ref="skipTable" :data="skipRows" border size="small" class="model-table glass-table" @mousedown.capture="constrainResizePreview($event, skipTable)" @header-dragend="keepDraggedColumnWidth">
        <el-table-column :label="t('workPage.columns.skipIB')" width="130" min-width="110" label-class-name="column-min-110">
          <template #default="{ $index }">
            <el-input
              v-model="skipRows[$index].skipIB"
              :placeholder="t('workPage.placeholders.enterSkipIB')"
            />
          </template>
        </el-table-column>
        <el-table-column :label="t('workPage.columns.aliasName')" width="150" min-width="120" label-class-name="column-min-120">
          <template #default="{ $index }">
            <el-input
              v-model="skipRows[$index].aliasName"
              :placeholder="t('workPage.placeholders.enterAlias')"
            />
          </template>
        </el-table-column>
        <el-table-column :label="t('workPage.columns.indexCount')" width="110" min-width="90" label-class-name="column-min-90">
          <template #default="{ $index }">
            <el-input
              v-model="skipRows[$index].indexCount"
              :placeholder="t('workPage.placeholders.enterIndexCount')"
            />
          </template>
        </el-table-column>
        <el-table-column :label="t('workPage.columns.firstIndex')" width="110" min-width="90" label-class-name="column-min-90">
          <template #default="{ $index }">
            <el-input
              v-model="skipRows[$index].firstIndex"
              :placeholder="t('workPage.placeholders.enterFirstIndex')"
            />
          </template>
        </el-table-column>
        <el-table-column width="56" align="center" :resizable="false" class-name="model-table-actions-column" label-class-name="model-table-actions-column">
          <template #default="{ $index }">
            <el-tooltip :content="t('workPage.common.delete')" placement="left">
              <button
                type="button"
                class="config-row-delete-btn"
                @click.stop="emit('removeSkipRow', $index)"
              >
                <el-icon><Delete /></el-icon>
              </button>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="controls-row">
      <el-button type="primary" plain @click="emit('generateIBSkip')">
        {{ t('workPage.actions.generateIBSkip') }}
      </el-button>
    </div>
  </section>

  <section class="inner-panel">
    <div ref="vsTableHost" class="table-row">
      <el-table ref="vsTable" :data="vsRows" border size="small" class="model-table glass-table" @mousedown.capture="constrainResizePreview($event, vsTable)" @header-dragend="keepDraggedColumnWidth">
        <el-table-column :label="t('workPage.columns.enabled')" width="80" min-width="72" align="center">
          <template #default="{ $index }">
            <el-checkbox v-model="vsRows[$index].enabled" />
          </template>
        </el-table-column>
        <el-table-column :label="t('workPage.columns.vsHash')" width="420" min-width="180" label-class-name="column-min-180">
          <template #default="{ $index }">
            <el-input
              v-model="vsRows[$index].hash"
              :placeholder="t('workPage.placeholders.enterVSHash')"
            />
          </template>
        </el-table-column>
        <el-table-column width="56" align="center" :resizable="false" class-name="model-table-actions-column" label-class-name="model-table-actions-column">
          <template #default="{ $index }">
            <el-tooltip :content="t('workPage.common.delete')" placement="left">
              <button
                type="button"
                class="config-row-delete-btn"
                @click.stop="emit('removeVSCheckRow', $index)"
              >
                <el-icon><Delete /></el-icon>
              </button>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="controls-row">
      <el-button type="primary" plain @click="emit('updateVSCheck')">
        {{ t('workPage.actions.updateVSCheckList') }}
      </el-button>
      <el-button type="primary" @click="emit('generateVSCheck')">
        {{ t('workPage.actions.generateVSCheck') }}
      </el-button>
    </div>
  </section>
</template>

<style scoped>
.controls-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.table-row {
  margin-top: 16px;
}

.config-row-delete-btn {
  width: 26px;
  height: 26px;
  border: 1px solid rgba(255, 90, 90, 0.18);
  border-radius: 6px;
  background: rgba(255, 70, 70, 0.055);
  color: rgba(255, 145, 145, 0.78);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.18s ease;
}

.config-row-delete-btn:hover {
  border-color: rgba(255, 105, 105, 0.42);
  background: rgba(255, 75, 75, 0.14);
  color: rgba(255, 215, 215, 0.96);
  box-shadow: 0 0 14px rgba(255, 70, 70, 0.16);
}

.config-row-delete-btn:active {
  transform: scale(0.94);
}

.inner-panel {
  background: rgba(var(--theme-surface-tint-rgb), 0.022);
  border: 1px solid rgba(var(--theme-surface-tint-rgb), 0.10);
  border-radius: 8px;
  padding: 14px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
  transition: all 0.25s ease;
  position: relative;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.inner-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(var(--theme-surface-tint-rgb), 0.16), transparent);
  pointer-events: none;
  border-radius: 8px 8px 0 0;
}
</style>
