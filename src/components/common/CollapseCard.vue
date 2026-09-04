<template>
  <div
    ref="placeholderRef"
    class="collapse-motion-placeholder"
  >
    <div
      ref="cardRef"
      class="group collapse-motion collapse"
      :class="expanded && 'collapse-motion-open'"
    >
      <div
        ref="headerRef"
        class="collapse-motion-header relative cursor-pointer px-4 pt-4"
        @click="showCollapse = !showCollapse"
      >
        <slot name="title" />
      </div>
      <div
        ref="bodyRef"
        class="collapse-motion-body"
        :class="transitioning && 'collapse-motion-body-transitioning'"
        :style="bodyHeight === null ? undefined : { height: `${bodyHeight}px` }"
        @transitionend="handlerTransitionEnd"
      >
        <div
          v-if="showPreview"
          ref="previewRef"
          class="collapse-motion-preview px-4 pb-4"
        >
          <slot name="preview" />
        </div>
        <div
          v-if="showContent"
          ref="contentRef"
          class="collapse-motion-content mt-2 max-h-108 overflow-y-auto p-4 pt-0"
          :class="PROXIES_PARENT_CLASS"
        >
          <slot name="content" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { provideCollapseTransition } from '@/composables/collapseTransition'
import { useVirtualRowShift, type VirtualRowShift } from '@/composables/virtualRowShift'
import { PROXIES_PARENT_CLASS } from '@/helper/utils'
import { collapseGroupMap } from '@/store/settings'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  name: string
  forceOpen?: boolean
}>()

const FLOATING_CLASS = 'collapse-motion-floating'

/*
 * 位移量是挂在列容器上的一个 CSS 变量，同一列同时只能有一张卡片在动。全部展开 / 收起
 * 那种一起动的情况，位移量本该逐张累加，一个变量表达不了，索性全都退回原生的逐帧重排。
 *
 * 按列分桶：变量本来就是各列一份，双列模式下两列各动各的并不冲突，混在一个集合里会让
 * 它们互相判定成并发、白白一起退回逐帧。注入到的 VirtualRowShift 实例就是列的身份。
 */
const shiftingCardsByColumn = new WeakMap<VirtualRowShift, Set<() => void>>()

const getShiftingCards = (shift: VirtualRowShift) => {
  let cards = shiftingCardsByColumn.get(shift)

  if (!cards) {
    cards = new Set()
    shiftingCardsByColumn.set(shift, cards)
  }

  return cards
}

const placeholderRef = ref<HTMLDivElement>()
const cardRef = ref<HTMLDivElement>()
const headerRef = ref<HTMLDivElement>()
const bodyRef = ref<HTMLDivElement>()
const previewRef = ref<HTMLDivElement>()
const contentRef = ref<HTMLDivElement>()

const showCollapse = computed({
  get() {
    return props.forceOpen || collapseGroupMap.value[props.name]
  },
  set(value) {
    if (!props.forceOpen) {
      collapseGroupMap.value[props.name] = value
    }
  },
})

/*
 * 视觉上的展开态。它会等目标内容挂载、布局稳定后再更新，用于同时切换 preview/content
 * 的透明度和 body 的目标高度。
 */
const expanded = ref(showCollapse.value)
const showContent = ref(showCollapse.value)
const showPreview = ref(!showCollapse.value)
const transitioning = ref(false)
const bodyHeight = ref<number | null>(null)

provideCollapseTransition(transitioning)

const rowShift = useVirtualRowShift()

let shiftRow: HTMLElement | null = null
let shiftBaseHeight = 0
let openFrameId = 0
let openToken = 0
let transitionTimer = 0

const TRANSITION_FALLBACK_DELAY = 400

/*
 * 动画期间把卡片浮起来、占位高度钉死在动画开始时的值：卡片挂在虚拟列表上，高度每变一次
 * 就要重测一次、整列重新定位，逐帧变高等于整列每帧重排。钉死之后 virtualizer 全程不动，
 * 后面的行改成一次性 transform 到终点，剩下的插值交给 CSS —— 每帧只有卡片自己的布局。
 *
 * 终点高度在 DOM 更新后量一次(展开量节点内容、收起量 preview)，占位本身不跟着
 * 撑，所以量得不准最多是收尾归位差一点，不会出现先撑开再缩回去。
 */
const beginShift = (targetBodyHeight: number) => {
  const placeholder = placeholderRef.value
  const card = cardRef.value
  const row = placeholder?.parentElement

  if (!rowShift || !placeholder || !card || !row) return

  // 上一程还没跑完就被点回去了(连点)：基准还是第一次钉下的那个高度，只要把终点重算一遍
  if (!shiftRow) {
    const shiftingCards = getShiftingCards(rowShift)

    if (shiftingCards.size) {
      for (const stop of [...shiftingCards]) {
        stop()
      }

      return
    }

    shiftBaseHeight = card.offsetHeight
    placeholder.style.height = `${shiftBaseHeight}px`
    placeholder.classList.add(FLOATING_CLASS)
    shiftRow = row
    rowShift.begin(row)
    shiftingCards.add(endShift)
  }

  const header = headerRef.value

  if (header) {
    rowShift.update(header.offsetHeight + targetBodyHeight - shiftBaseHeight)
  }
}

// 收尾(或被并发的另一张卡片挤掉时)：占位交还给卡片，位移交还给 virtualizer
const endShift = () => {
  if (rowShift) {
    shiftingCardsByColumn.get(rowShift)?.delete(endShift)
  }

  const placeholder = placeholderRef.value

  if (placeholder) {
    placeholder.classList.remove(FLOATING_CLASS)
    placeholder.style.height = ''
  }

  if (shiftRow) {
    rowShift?.end(shiftRow)
    shiftRow = null
  }
}

// nextTick 的回调撤不掉,换成对暗号:令牌一变,还没跑到的那一节自己作废
const cancelPendingOpen = () => {
  openToken++
  cancelAnimationFrame(openFrameId)
  openFrameId = 0
  window.clearTimeout(transitionTimer)
  transitionTimer = 0
}

const finishTransition = () => {
  if (!transitioning.value) return

  window.clearTimeout(transitionTimer)
  transitionTimer = 0

  showContent.value = expanded.value
  showPreview.value = !expanded.value
  bodyHeight.value = null
  transitioning.value = false
  endShift()
}

const settleWithoutTransition = (value: boolean) => {
  expanded.value = value
  showContent.value = value
  showPreview.value = !value
  bodyHeight.value = null
  transitioning.value = false
  endShift()
}

const startHeightTransition = (value: boolean, targetHeight: number) => {
  const body = bodyRef.value

  if (!body) {
    settleWithoutTransition(value)

    return
  }

  expanded.value = value
  beginShift(targetHeight)
  bodyHeight.value = targetHeight

  transitionTimer = window.setTimeout(finishTransition, TRANSITION_FALLBACK_DELAY)
}

/*
 * 展开分两步：先挂内容，等它布局落定，再加 open 类起动画。
 *
 * 内容一挂就是几十张节点卡片(虚拟列表首屏)，和动画同帧的话过渡刚起步就被这一次长任务
 * 卡住 —— 掉的正好是动画开头那几帧。拆开之后卡的是点击到起动之间那一下，动画本身全程干净。
 *
 * 双 rAF 是因为虚拟列表要两拍才稳：第一拍挂 ProxiesContent，它在 onMounted 里才拿到
 * 滚动容器、算出行范围，第二拍才把行渲出来。等两帧就能让这些布局都在动画之前提交完。
 * 收起只需要等 preview 挂载和起始高度提交，所以一帧就够。
 */
watch(showCollapse, (value) => {
  cancelPendingOpen()

  const token = openToken
  const body = bodyRef.value

  /*
   * 连点发生在目标态真正起动之前时，当前画面本来就是用户刚切回的状态，不需要凭空补一段
   * 动画。把为上一程预挂的内容清掉即可。
   */
  if (value === expanded.value) {
    settleWithoutTransition(value)

    return
  }

  transitioning.value = true
  bodyHeight.value = body?.getBoundingClientRect().height ?? 0

  if (!value) {
    showPreview.value = true
    nextTick(() => {
      if (token !== openToken) return

      openFrameId = requestAnimationFrame(() => {
        openFrameId = 0
        startHeightTransition(false, previewRef.value?.offsetHeight ?? 0)
      })
    })

    return
  }

  showContent.value = true
  nextTick(() => {
    if (token !== openToken) return

    openFrameId = requestAnimationFrame(() => {
      openFrameId = requestAnimationFrame(() => {
        openFrameId = 0
        startHeightTransition(true, (contentRef.value?.offsetHeight ?? 0) + 8)
      })
    })
  })
})

/*
 * body 自己只有 height 这一条过渡。preview/content 的透明度事件会冒泡到这里，按 target
 * 和 propertyName 一起过滤。高度相同而没有 transitionend 时由上面的短定时器兜底。
 */
const handlerTransitionEnd = (e: TransitionEvent) => {
  if (e.target !== bodyRef.value || e.propertyName !== 'height') return

  finishTransition()
}

onBeforeUnmount(() => {
  cancelPendingOpen()
  endShift()
})
</script>
