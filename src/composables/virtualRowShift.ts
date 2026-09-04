import { inject, nextTick, provide, type InjectionKey } from 'vue'

/*
 * 虚拟列表里某一行改高度，后面所有行的 top 都要 JS 重算一遍再 patch 回 DOM ——
 * 折叠卡片逐帧变高的话，整列就是每帧重排一次。
 *
 * 动画期间改走这里：那一行的高度先被 CollapseCard 钉死（卡片浮起来单独长），后面的行
 * 用 transform 临时往下（或往上）挪同样的距离 —— 终点距离一次性写进变量，插值由 CSS
 * 过渡完成，transform 不进布局，每帧只有合成器的事。
 * 动画结束时 end() 先把新高度同步给 virtualizer，等 top 落位的同一帧再撤掉位移，两边
 * 正好抵消，看不到跳动。
 */
export type VirtualRowShift = {
  begin: (row: HTMLElement) => void
  update: (offset: number) => void
  end: (row: HTMLElement) => void
}

const ORIGIN_CLASS = 'virtual-row-shift-origin'
const SHIFT_VAR = '--virtual-row-shift'

const virtualRowShiftKey: InjectionKey<VirtualRowShift> = Symbol('virtual-row-shift')

export const provideVirtualRowShift = (shift: VirtualRowShift) => {
  provide(virtualRowShiftKey, shift)
}

export const useVirtualRowShift = () => inject(virtualRowShiftKey, null)

/*
 * 位移量挂在列容器上、由 `.virtual-row-shift-origin ~ *` 选中后面的行（见 motion.css），
 * 所以同一列同一时刻只能有一张卡片在动 —— 并发的那几张由 CollapseCard 自己退回原生逐帧。
 */
export const createVirtualRowShift = (
  getColumn: () => HTMLElement | undefined,
  measureRow: (row: HTMLElement) => void,
): VirtualRowShift => ({
  begin: (row) => {
    row.classList.add(ORIGIN_CLASS)
  },
  update: (offset) => {
    getColumn()?.style.setProperty(SHIFT_VAR, `${offset}px`)
  },
  end: (row) => {
    if (row.isConnected) {
      measureRow(row)
    }

    nextTick(() => {
      row.classList.remove(ORIGIN_CLASS)
      getColumn()?.style.removeProperty(SHIFT_VAR)
    })
  },
})
