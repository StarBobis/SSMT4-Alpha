<script setup lang="ts">
/* 输出模态框:引擎把生成的 INI / JSON 写入 #output 后显示 #modal。 */
const closeModal = (): void => {
  const modal = document.getElementById('modal')
  if (modal) modal.style.display = 'none'
}
</script>

<template>
  <div id="modal">
    <div id="modal-content">
      <button type="button" class="close-btn" @click="closeModal">关闭</button>
      <textarea id="output" class="code-out" spellcheck="false"></textarea>
    </div>
  </div>
</template>
