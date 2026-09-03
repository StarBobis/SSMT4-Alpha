<template>
  <!-- Shown by async route components while their chunk loads — keeps route
       switches feeling instant instead of freezing on the previous page. -->
  <div class="page-loading" role="status" aria-label="Loading">
    <div class="page-loading-ring" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
.page-loading {
  width: 100%;
  height: 100%;
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  animation: page-loading-in 0.18s ease-out;
}

@keyframes page-loading-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.page-loading-ring {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.14);
  border-top-color: rgba(255, 255, 255, 0.85);
  animation: page-loading-spin 0.8s linear infinite;
  filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.18));
}

@keyframes page-loading-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .page-loading-ring {
    animation-duration: 1.6s;
  }
}
</style>
