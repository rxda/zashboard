<template>
  <div
    class="grid min-w-0 gap-2"
    :style="`grid-template-columns: repeat(auto-fill, minmax(min(${minProxyCardWidth}px, 100%), 1fr));`"
  >
    <slot />
  </div>
</template>

<script lang="ts" setup>
/*
 * 根节点必须是单个真实 <div>。调用方 ProxiesContent 用 useCurrentElement() 量宽度算
 * maxProxies,根是组件/Fragment 时 $el 拿不到 Element,ResizeObserver 会直接抛错。
 * 注意 template 顶层的 HTML 注释在 dev 构建里会被保留,同样会让组件变成多根。
 */
import { minProxyCardWidth } from '@/store/settings'
</script>
