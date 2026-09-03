import { PROXY_CARD_SIZE } from '@/constant'
import { findScrollableParent } from '@/helper/utils'
import { minProxyCardWidth, proxyCardSize } from '@/store/settings'
import { useCurrentElement, useElementSize, useInfiniteScroll } from '@vueuse/core'
import { computed, nextTick, onMounted, ref, watch, type InjectionKey } from 'vue'

export const useCalculateMaxProxies = (totalProxies: number, activeIndex: number) => {
  const el = useCurrentElement()
  const { width } = useElementSize(el)
  const initMaxProxies = computed(() => {
    return (
      Math.max(Math.floor(width.value / minProxyCardWidth.value), 2) *
      (proxyCardSize.value === PROXY_CARD_SIZE.LARGE ? 9 : 12)
    )
  })
  const maxProxies = ref(Math.max(24, activeIndex + 12))

  onMounted(() => {
    watch(
      initMaxProxies,
      () => {
        maxProxies.value = Math.max(maxProxies.value, initMaxProxies.value)
      },
      { immediate: true },
    )

    nextTick(() => {
      const scrollEl = findScrollableParent(el.value as HTMLElement)

      useInfiniteScroll(
        scrollEl,
        () => {
          maxProxies.value = Math.min((maxProxies.value += initMaxProxies.value), totalProxies)
        },
        {
          distance: 100,
          canLoadMore: () => {
            return maxProxies.value < totalProxies
          },
        },
      )
    })
  })

  return {
    maxProxies,
  }
}

/*
 * 虚拟化之后,节点卡片可能不在渲染窗口里 —— 想滚到某个节点得让列表自己去滚,
 * 卡片拿不到自己的 DOM 也就无从滚起。ProxiesContent 提供它,非虚拟化的用法注入不到,
 * 退回原来的 scrollIntoCenter。
 */
export const scrollNodeIntoViewKey: InjectionKey<(name: string) => void> =
  Symbol('scrollNodeIntoView')

/*
 * 测速后的高亮提到模块作用域:重排会把卡片挪出渲染窗口再挪回来,
 * 状态留在组件实例里的话,卡片一卸载高亮就没了。
 */
export const highlightedProxyNode = ref('')

let highlightTimer: ReturnType<typeof setTimeout> | undefined

export const highlightProxyNode = (name: string) => {
  highlightedProxyNode.value = name
  clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    if (highlightedProxyNode.value === name) {
      highlightedProxyNode.value = ''
    }
  }, 1500)
}
