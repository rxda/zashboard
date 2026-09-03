<template>
  <div
    class="relative flex size-full overflow-hidden"
    :class="[disableProxiesPageTextSelect ? 'select-none' : '']"
  >
    <FolderManagerPanel v-if="foldersUiVisible && folderManagerOpen" />
    <div
      class="max-md:scrollbar-hidden relative h-full min-w-0 flex-1"
      :class="disableProxiesPageScroll ? 'overflow-y-hidden' : 'overflow-y-scroll'"
      :style="padding"
      ref="proxiesRef"
      @scroll.passive="handleScroll"
    >
      <ProxiesCtrl />
      <FolderTopBar v-if="foldersUiVisible" />
      <div
        ref="columnsRef"
        class="flex gap-3 p-3 md:pr-2"
      >
        <VirtualColumn
          v-for="(items, idx) in columns"
          :key="`${cardVariant}-${idx}`"
          class="min-w-0 flex-1"
          :data="items"
          :scroll-element="proxiesRef"
          :scroll-margin="scrollMargin"
          :estimate-size="estimatedCardHeight"
          :size-cache-key="cardVariant"
        >
          <template v-slot="{ item }: { item: string }">
            <component
              :is="renderComponent"
              :name="item"
            />
          </template>
        </VirtualColumn>
      </div>
    </div>
    <ProxyGroupChainModal />
  </div>
</template>

<script setup lang="ts">
import VirtualColumn from '@/components/common/VirtualColumn.vue'
import ProxiesCtrl from '@/components/controls/ProxiesCtrl'
import FolderManagerPanel from '@/components/proxies/folders/FolderManagerPanel.vue'
import FolderTopBar from '@/components/proxies/folders/FolderTopBar.vue'
import ProxyGroup from '@/components/proxies/ProxyGroup.vue'
import ProxyGroupForMobile from '@/components/proxies/ProxyGroupForMobile.vue'
import ProxyProvider from '@/components/proxies/ProxyProvider.vue'
import ProxyGroupChainModal from '@/components/proxies/ProxyGroupChainModal.vue'
import { usePaddingForViews } from '@/composables/paddingViews'
import { disableProxiesPageScroll, renderProxiesPageItems } from '@/composables/proxies'
import { PROXY_TAB_TYPE } from '@/constant'
import { isMiddleScreen } from '@/helper/utils'
import { fetchProxies } from '@/assembly/proxies'
import { proxiesTabShow } from '@/assembly/proxies'
import { disableProxiesPageTextSelect, twoColumnProxyGroup } from '@/store/settings'
import { folderManagerOpen, isProxyFolderModeActive } from '@/store/proxyFolders'
import { useResizeObserver, useSessionStorage } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

const { padding } = usePaddingForViews({
  offsetTop: 0,
  offsetBottom: 0,
})
const renderPageItems = renderProxiesPageItems
const proxiesRef = ref()
const scrollStatus = useSessionStorage('cache/proxies-scroll-status', {
  [PROXY_TAB_TYPE.PROVIDER]: 0,
  [PROXY_TAB_TYPE.PROXIES]: 0,
})

const handleScroll = () => {
  if (!proxiesRef.value) return
  scrollStatus.value[proxiesTabShow.value] = proxiesRef.value.scrollTop
  syncScrollMargin()
}

/*
 * 卡片列上面还有控制栏(桌面端 sticky,占着流内高度)和文件夹栏,虚拟列表得知道
 * 自己从滚动内容的哪个位置开始,否则算出来的可视区会整体偏移一个控制栏的高度。
 *
 * 滚动容器是 relative,列的 offsetParent 就是它,offsetTop 直接就是这个偏移;
 * 它只在控制栏高度 / 内边距变化时才会变,所以跟着滚动、resize 和几个布局开关同步就够了。
 */
const columnsRef = ref<HTMLElement | null>(null)
const scrollMargin = ref(0)
const syncScrollMargin = () => {
  scrollMargin.value = columnsRef.value?.offsetTop ?? 0
}

const waitTickUntilReady = (startTime = performance.now()) => {
  const proxiesEl = proxiesRef.value
  const isTimedOut = performance.now() - startTime > 300

  if (
    isTimedOut ||
    (proxiesEl && proxiesEl.scrollHeight > scrollStatus.value[proxiesTabShow.value])
  ) {
    if (!proxiesEl) return
    proxiesEl.scrollTo({
      top: scrollStatus.value[proxiesTabShow.value],
      behavior: 'smooth',
    })
  } else {
    requestAnimationFrame(() => {
      waitTickUntilReady(startTime)
    })
  }
}

watch(proxiesTabShow, () =>
  nextTick(() => {
    waitTickUntilReady()
  }),
)

onMounted(() => {
  nextTick(syncScrollMargin)
  setTimeout(() => {
    nextTick(() => {
      waitTickUntilReady()
      fetchProxies()
    })
  })
})

const cardType = computed(() => {
  if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER) {
    return 'provider' as const
  }

  if (isMiddleScreen.value && displayTwoColumns.value) {
    return 'mobile' as const
  }

  return 'group' as const
})

const renderComponent = computed(() => {
  if (cardType.value === 'provider') {
    return ProxyProvider
  }

  if (cardType.value === 'mobile') {
    return ProxyGroupForMobile
  }

  return ProxyGroup
})

// 三种卡片折叠态的高度不同,估算高度与量到的高度缓存都按形态分开
const cardVariant = computed(() => `${cardType.value}:${displayTwoColumns.value ? 2 : 1}`)
const estimatedCardHeight = computed(() => (cardType.value === 'mobile' ? 88 : 112))

const foldersUiVisible = computed(
  () => isProxyFolderModeActive.value && proxiesTabShow.value === PROXY_TAB_TYPE.PROXIES,
)

const displayTwoColumns = computed(() => {
  if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER && isMiddleScreen.value) {
    return false
  }
  return twoColumnProxyGroup.value && renderPageItems.value.length > 1
})

const filterContent: <T>(all: T[], target: number) => T[] = (all, target) => {
  return all.filter((_, index: number) => index % 2 === target)
}

// 双列不是 masonry,还是按 index % 2 分成两条独立的列,各自一个 virtualizer 共用页面的滚动条
const columns = computed(() =>
  displayTwoColumns.value
    ? [filterContent(renderPageItems.value, 0), filterContent(renderPageItems.value, 1)]
    : [renderPageItems.value],
)

useResizeObserver(proxiesRef, syncScrollMargin)
watch([foldersUiVisible, displayTwoColumns, isMiddleScreen], () => nextTick(syncScrollMargin))
</script>
