/**
 * 全局快捷键注册机制（Phase 0 骨架）
 * 频道约定：⌘K 全局搜索 / Space 灵感换一个 / Esc 退出全屏态 等（Phase 6 实装具体行为）
 *
 * 注册表加固（审计 Phase 6 P2-2）：
 * - 同一 combo 允许多实例并存（Map<string, ShortcutDef[]>），cleanup 只摘除自己注册的实例；
 * - scope: 'page' 的快捷键在注册时快照 location.pathname，派发时按前缀校验真实生效，
 *   离开该页面（或其子路径）后 page 快捷键不再触发。
 */
import { isImeComposing } from './ime'

export interface ShortcutDef {
  /** 标准化组合键，如 'mod+k'、'space'、'esc' */
  combo: string
  description: string
  handler: (e: KeyboardEvent) => void
  /** 全局 = 任何页面生效；否则仅激活路由内生效 */
  scope?: 'global' | 'page'
}

interface RegistryEntry extends ShortcutDef {
  /** page scope 注册时的路径快照（global 为 undefined） */
  registeredPathname?: string
}

const registry = new Map<string, RegistryEntry[]>()

export function normalizeCombo(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  const key = e.key === ' ' ? 'space' : e.key.toLowerCase()
  parts.push(key)
  return parts.join('+')
}

export function registerShortcut(def: ShortcutDef): () => void {
  const entry: RegistryEntry =
    def.scope === 'page' ? { ...def, registeredPathname: window.location.pathname } : { ...def }
  const list = registry.get(def.combo)
  if (list) list.push(entry)
  else registry.set(def.combo, [entry])
  return () => {
    const cur = registry.get(def.combo)
    if (!cur) return
    const next = cur.filter((e) => e !== entry)
    if (next.length > 0) registry.set(def.combo, next)
    else registry.delete(def.combo)
  }
}

/** 实例是否当前真实生效：global 恒生效；page 需当前路径为其注册路径（或子路径） */
function isActive(entry: RegistryEntry): boolean {
  if (entry.scope !== 'page') return true
  const p = entry.registeredPathname
  if (!p) return false
  const now = window.location.pathname
  return now === p || now.startsWith(p.endsWith('/') ? p : `${p}/`)
}

/** 取当前真实生效的第一个实例（global 优先于 page） */
export function getShortcut(combo: string): ShortcutDef | undefined {
  const list = registry.get(combo)
  if (!list) return undefined
  return (
    list.find((e) => e.scope !== 'page' && isActive(e)) ??
    list.find((e) => e.scope === 'page' && isActive(e))
  )
}

export function listShortcuts(): ShortcutDef[] {
  return [...registry.values()].flat()
}

export function installKeyboardListener() {
  window.addEventListener(
    'keydown',
    (e) => {
      // 输入法组合中不拦截（戒点④：IME isComposing；单一实现见 shared/ime.ts）
      if (isImeComposing(e)) return
      // 输入场景不拦截
      const target = e.target as HTMLElement
      if (
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) &&
        !e.metaKey &&
        !e.ctrlKey
      )
        return
      const def = getShortcut(normalizeCombo(e))
      if (def) {
        e.preventDefault()
        def.handler(e)
      }
    },
    { capture: true },
  )
}
