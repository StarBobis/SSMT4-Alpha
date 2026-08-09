<script setup lang="ts">
import { ref } from 'vue'

const source = ref('/ui-builder-v79.html')
const loadError = ref(false)

const retry = () => {
  loadError.value = false
  source.value = `${source.value.split('?')[0]}?reload=${Date.now()}`
}
</script>

<template>
  <section class="ui-builder-page" aria-label="UI 构造器">
    <iframe
      v-if="!loadError"
      :src="source"
      title="3Dmigoto UI 构造器"
      class="ui-builder-frame"
      @error="loadError = true"
    />
    <div v-else class="ui-builder-error">
      <h2>UI 构造器加载失败</h2>
      <p>构造器资源无法加载，请重试。</p>
      <button type="button" @click="retry">重试</button>
    </div>
  </section>
</template>

<style scoped>
.ui-builder-page {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #050914;
}

.ui-builder-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #050914;
}

.ui-builder-error {
  display: grid;
  place-content: center;
  gap: 8px;
  height: 100%;
  color: #e8f2ff;
  text-align: center;
}

.ui-builder-error h2,
.ui-builder-error p {
  margin: 0;
}

.ui-builder-error p {
  color: #a8b8ca;
}

.ui-builder-error button {
  justify-self: center;
  padding: 8px 18px;
  border: 1px solid #72d2ff;
  border-radius: 6px;
  background: #16364c;
  color: #fff;
  cursor: pointer;
}
</style>
