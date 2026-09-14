/**
 * 文件下载的**单一实现**（P2 #42）
 *
 * 此前全仓有 6 处「建 Blob URL → 造 <a> → click → revokeObjectURL」的内联写法，
 * 且口径不一致：notes 两处已延时释放，而 settings 两处导出、trophies 海报、
 * finance 附件下载**仍是同步 revoke**。同步 revoke 在 Safari / WebKit 下会出问题 ——
 * `a.click()` 只是把下载**排入队列**，浏览器尚未真正开始读取该 URL 就把底层 Blob
 * 释放掉了，表现为「点了导出没反应 / 下载中断 / 文件 0 字节」。Chromium 下读取早已
 * 排队完成，所以这个坑**只在换浏览器时才暴露**（正是 #98 要验的方向）。
 *
 * 两条硬约束收在这里，调用方不必再各自记忆：
 *   ① **revoke 必须延时**（默认 3s）—— 给浏览器留出真正读取的时间；
 *   ② **锚点必须入 DOM** —— Safari 对游离节点的 `a.click()` 不保证触发下载
 *      （Chromium / Firefox 容忍，同样是只在换浏览器时暴露）。
 *
 * 由 `src/shared/__tests__/download.test.ts` 锁定「全仓不得再出现内联 revoke」，
 * 防止新增导出入口时又抄一份 —— 本项目已多次出现「一处接了、另一处漏了」的形状。
 */

/** 默认延时释放时长（ms）：沿用 notes 侧既有取值，足以覆盖慢启动的下载 */
export const REVOKE_DELAY_MS = 3000

/**
 * 触发一次浏览器下载（Blob 版）。
 * 对象 URL 的创建、锚点插入/移除、延迟释放全部收在本函数内，调用方只给 Blob 与文件名。
 */
export function downloadBlob(blob: Blob, filename: string, delayMs = REVOKE_DELAY_MS): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  // 锚点与对象 URL 一起延时清理：立刻 remove 会让 Safari 找不到触发源（见文件头 ②）；
  // 不用下载完成事件是因为 blob URL 下载没有可靠的完成回调可监听。
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, delayMs)
}

/** 文本类文件下载（自带 MIME，需要 BOM 的调用方自己在 content 里带上） */
export function downloadText(content: string, mime: string, filename: string): void {
  downloadBlob(new Blob([content], { type: mime }), filename)
}
