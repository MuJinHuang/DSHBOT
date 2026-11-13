/**
 * 计划项的依赖排序（DAG）。
 *
 * 纯函数：输入带 id / dependsOn 的计划项，输出按层分好的执行顺序。
 * 只负责排序与发现环，不碰 Bot、不碰文件。
 */
export interface DagItem {
  id?: string
  dependsOn?: string[]
}

export interface DagOrder {
  /** 每一层可以并行执行的下标；按层串行。 */
  levels: number[][]
  /** 存在环时为 true，此时 levels 可能不完整。 */
  cycle: boolean
  /** 指向不存在/自身/重复 id 的依赖。 */
  missing: string[]
}

/**
 * 按依赖关系分层。
 *
 * 同一层内的任务互不依赖，可以并行；层与层之间必须等上一层完成。
 * 缺少 id 的计划项按“不可被依赖”处理；如果它们依赖别人，仍会等待。
 *
 * @param items - 计划项
 */
export function orderPlanItems(items: DagItem[]): DagOrder {
  const byId = new Map<string, number>()
  const duplicateIds = new Set<string>()
  items.forEach((item, index) => {
    if (item.id === undefined || item.id === '') return
    if (byId.has(item.id)) duplicateIds.add(item.id)
    byId.set(item.id, index)
  })

  const missing: string[] = []
  const dependencies = new Map<number, Set<number>>()
  items.forEach((item, index) => {
    const deps = new Set<number>()
    for (const dep of item.dependsOn ?? []) {
      const target = byId.get(dep)
      if (target === undefined || target === index || duplicateIds.has(dep)) {
        missing.push(dep)
        continue
      }
      deps.add(target)
    }
    dependencies.set(index, deps)
  })

  const levels: number[][] = []
  const done = new Set<number>()
  let remaining = items.map((_, index) => index)

  while (remaining.length > 0) {
    const ready = remaining.filter((index) => {
      const deps = dependencies.get(index) ?? new Set<number>()
      return [...deps].every((dep) => done.has(dep))
    })
    if (ready.length === 0) {
      return { levels, cycle: true, missing }
    }
    levels.push(ready)
    for (const index of ready) done.add(index)
    const readySet = new Set(ready)
    remaining = remaining.filter((index) => !readySet.has(index))
  }

  return { levels, cycle: false, missing }
}
