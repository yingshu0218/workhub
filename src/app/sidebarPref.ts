/**
 * 侧栏伸缩偏好（2026-10-19 用户需求：「最左侧的菜单没有伸缩按钮」）
 *
 * 口径：**本地偏好，不进同步、不写 settings 表**。
 *
 * 为什么不做成 `settings.appearance` 字段：折叠是**每台设备各自的窗口形态**
 * （桌面上宽屏要展开、笔记本上要收起），跟主题/圆角这种「一个人的审美偏好」不同 ——
 * 若进同步，一端收起会通过 LWW 把另一端也收起来，反而添乱。同款先例：
 * 笔记预览开关（`NoteEditorPage` 的 `nexus:note-preview`）、用户身份（`nexus:identity`）。
 *
 * 为什么首屏同步读：侧栏宽度直接决定主内容区位置，异步读会先按展开态渲染一帧再跳成
 * 收起态（可见的宽度抖动）。与 identity 同策略：模块加载时同步取一次做初值。
 *
 * ⚠️ 抽屉式（浮层）展开是**纯 UI 瞬态**，不进这里：它由鼠标悬停驱动，
 * 存下来只会让下次进入时莫名停在一个悬停态。
 */

const STORAGE_KEY = 'nexus:sidebar-collapsed'

/** 侧栏展开宽度（原型 w-64 = 256px；本项目既有实现为 232px，保持不动） */
export const SIDEBAR_WIDTH_EXPANDED = 232

/** 图标轨宽度：够容纳 24px 图标 + 左右各 16px 内边距（与既有 px-4 对齐） */
export const SIDEBAR_WIDTH_COLLAPSED = 56

function readStored(): boolean {
  try {
    // 只认显式的 '1'；缺省（首次进入）＝ 展开，与既有行为完全一致，老用户零感知
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // 隐私模式 / 存储被禁：回落展开态（功能可用性优先于偏好记忆）
    return false
  }
}

let collapsed = readStored()
const listeners = new Set<() => void>()

export function isSidebarCollapsed(): boolean {
  return collapsed
}

/** 订阅变更（React 外部订阅亦走这里），返回取消订阅函数 */
export function onSidebarCollapsedChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 设置折叠态；返回实际生效值（写存储失败也仍然本次会话内生效） */
export function setSidebarCollapsed(next: boolean): boolean {
  if (next === collapsed) return collapsed
  collapsed = next
  try {
    if (next) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 持久化失败不影响本次会话内生效 */
  }
  listeners.forEach((fn) => fn())
  return collapsed
}

export function toggleSidebarCollapsed(): boolean {
  return setSidebarCollapsed(!collapsed)
}

/**
 * 测试用：把模块单例重置回「从存储重新读取」的初态 —— 等价于**模拟一次页面刷新**。
 *
 * ⚠️ 刻意是 `collapsed = readStored()` 而不是硬写 `false`：若硬写 false，
 * 「缺省应展开」这条口径就永远测不到（变异成「缺省收起」也不会转红）。
 * 调用方若要先造出持久化状态（如 setItem('1')）再调本函数，即可复现「刷新后仍收起」。
 * 注意 `beforeEach` 里应先 `localStorage.clear()` 再调本函数，否则会读到上个用例的残留。
 */
export function __resetSidebarCollapsedForTest(): void {
  collapsed = readStored()
  listeners.clear()
}