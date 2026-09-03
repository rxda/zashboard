<script setup lang="ts">
/*
 * 节点网格按「行」虚拟化。
 *
 * 原来是 useCalculateMaxProxies + useInfiniteScroll:先渲一屏,滚到底再追加一批,
 * 追加进去的卡片不会再卸载。节点多的组(几百个)展开后就一直挂着几百张 ProxyNodeCard,
 * 每张都带自己的 computed 和 LatencyTag 的 CountUp。这里只渲染视口附近的那几行。
 *
 * 代价是放弃了 ProxyNodeGrid 的 TransitionGroup 重排动画 —— 跨行的 FLIP 和虚拟化
 * 没法共存。测速后要跟住刚点过的那张卡片,靠的仍然是 ProxyNodeCard 里的
 * latency-highlight 高亮 + scrollIntoCenter 滚动居中。
 *
 * 布局用「上下占位块 + 正常流里的几行」,而不是把行绝对定位:卡片一旦多出一个定位祖先,
 * scrollIntoCenter 依赖的 offsetTop 口径就变了,两处滚动居中会一起失效。
 */
import { handlerProxySelect } from '@/assembly/proxies'
import { PROXY_CARD_SIZE } from '@/constant'
import { scrollNodeIntoViewKey } from '@/composables/proxiesScroll'
import { PROXIES_PARENT_CLASS } from '@/helper/utils'
import { minProxyCardWidth, proxyCardSize } from '@/store/settings'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useElementSize, useResizeObserver } from '@vueuse/core'
import { computed, nextTick, onMounted, provide, ref, watch } from 'vue'
import ProxyNodeCard from './ProxyNodeCard.vue'

// 行距做在行自己的 pb 上,让它算进量到的行高里(virtualizer 的 gap 保持 0)
const GAP = 8

const props = defineProps<{
  name?: string
  now?: string
  renderProxies: string[]
}>()

const rootRef = ref<HTMLElement | null>(null)
const scrollEl = ref<HTMLElement | null>(null)
const scrollMargin = ref(0)
const { width } = useElementSize(rootRef)

// 和原来 grid 的 repeat(auto-fill, minmax(minProxyCardWidth, 1fr)) 是同一个算法
const columns = computed(() =>
  width.value ? Math.max(1, Math.floor((width.value + GAP) / (minProxyCardWidth.value + GAP))) : 1,
)
const rowCount = computed(() => Math.ceil(props.renderProxies.length / columns.value))
const estimatedRowHeight = computed(
  () => (proxyCardSize.value === PROXY_CARD_SIZE.SMALL ? 48 : 60) + GAP,
)

/*
 * 入场 / 高亮动画会给卡片挂 transform,getBoundingClientRect 量出来是变换后的高度。
 * borderBoxSize 和 offsetHeight 都是布局尺寸,不受影响。
 */
const measureRowHeight = (element: Element, entry: ResizeObserverEntry | undefined) => {
  const box = entry?.borderBoxSize?.[0]

  return box ? Math.round(box.blockSize) : (element as HTMLElement).offsetHeight
}

const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: rowCount.value,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => estimatedRowHeight.value,
    measureElement: measureRowHeight,
    scrollMargin: scrollMargin.value,
    overscan: 3,
  })),
)

const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())
const totalSize = computed(() => rowVirtualizer.value.getTotalSize())
const topSpacer = computed(() => {
  const first = virtualRows.value[0]

  return first ? first.start - scrollMargin.value : 0
})
const bottomSpacer = computed(() => {
  const last = virtualRows.value[virtualRows.value.length - 1]

  /*
   * 一行都没渲染时占位块要顶起全部高度。滚动容器是 max-h-108,高度全靠内容撑;
   * 这里要是返回 0,容器就是 0 高 → 算不出可视区 → 更渲染不出行,两边互相等死。
   * 手机端的卡片内容区没有内边距,正好会踩到这个死锁。
   */
  return Math.max(0, totalSize.value - (last ? last.end - scrollMargin.value : 0))
})

const rowNodes = (rowIndex: number) =>
  props.renderProxies.slice(rowIndex * columns.value, (rowIndex + 1) * columns.value)

// 每个元素只交给 virtualizer 量一次:measureElement 每调一次都会读一次布局,
// 而 ref 回调每次 patch 都跑;首次调用后高度变化由 virtualizer 自己的 ResizeObserver 报回来。
const measuredRows = new WeakSet<Element>()
const measureRow = (el: Element | null) => {
  if (!el || measuredRows.has(el)) return

  measuredRows.add(el)
  nextTick(() => {
    if (el.isConnected) {
      rowVirtualizer.value.measureElement(el)
    }
  })
}

/*
 * 滚动容器不一定紧挨着自己(组卡片 / 手机端卡片 / 代理集卡片各套了一层),
 * 位置差用 rect 算,不依赖 offsetParent 是谁。
 */
const syncScrollMargin = () => {
  const root = rootRef.value
  const scroller = scrollEl.value

  if (!root || !scroller) return

  scrollMargin.value =
    root.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
}

/*
 * 选中的节点可能落在窗口之外 —— 不先滚过去它根本不会挂载,ProxyNodeCard 里那次
 * scrollIntoCenter 也就无从触发。滚到位之后那次居中会判定已经可见,不会再动一次。
 */
const scrollNodeIntoView = (name: string) => {
  const index = props.renderProxies.indexOf(name)

  if (index < 0) return

  // behavior 用 auto:直接跳过去,不要滚动动画
  rowVirtualizer.value.scrollToIndex(Math.floor(index / columns.value), {
    align: 'center',
    behavior: 'auto',
  })
}

// 测速重排后卡片可能已经不在渲染窗口里,由列表负责滚过去(见 ProxyNodeCard)
provide(scrollNodeIntoViewKey, scrollNodeIntoView)

/*
 * 展开时选中的节点直接就在视野里,不滚给用户看。
 *
 * 只能等列宽量出来再定位:首帧 useElementSize 还是 0,列数会被当成 1,
 * 算出来的行号差好几倍,跳到的位置根本不对。
 */
let activeNodeShown = false

const showActiveNode = () => {
  if (activeNodeShown || !scrollEl.value || !width.value || !props.now) return

  activeNodeShown = true
  syncScrollMargin()
  scrollNodeIntoView(props.now)
}

watch([width, scrollEl], showActiveNode)

useResizeObserver(scrollEl, syncScrollMargin)

onMounted(() => {
  scrollEl.value = rootRef.value?.closest(`.${PROXIES_PARENT_CLASS}`) as HTMLElement | null

  nextTick(() => {
    syncScrollMargin()
    showActiveNode()
  })
})
</script>

<template>
  <div
    ref="rootRef"
    class="min-w-0"
  >
    <div :style="{ height: `${topSpacer}px` }" />
    <div
      v-for="row in virtualRows"
      :key="row.key.toString()"
      :data-index="row.index"
      :ref="(el) => measureRow(el as Element | null)"
      class="grid min-w-0 gap-2 pb-2"
      :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
    >
      <ProxyNodeCard
        v-for="node in rowNodes(row.index)"
        :key="node"
        :name="node"
        :group-name="name"
        :active="node === now"
        @click.stop="name && handlerProxySelect(name, node)"
      />
    </div>
    <div :style="{ height: `${bottomSpacer}px` }" />
  </div>
</template>
