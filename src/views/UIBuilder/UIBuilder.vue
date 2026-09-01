<script setup lang="ts">
// UI 构造器页面:渲染 Vue 版编辑器组件(UIBuilderVue/)。
// 组件被全局 KeepAlive 保活,切换路由不会丢失编辑器状态。
import UIBuilderApp from '../UIBuilderVue/UIBuilderApp.vue'
</script>

<template>
  <UIBuilderApp />
</template>