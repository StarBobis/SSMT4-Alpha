<script setup lang="ts">
// 占位路由组件：真正的 UI 构造器 iframe 由 UIBuilderHost.vue 常驻挂载在 App.vue 中，
// 切换路由时不会被卸载/刷新，本组件仅占住路由位置。
</script>

<template>
  <section class="ui-builder-page-placeholder" aria-hidden="true" />
</template>
