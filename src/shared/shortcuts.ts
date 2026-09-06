/**
 * 全局快捷键注册机制（Phase 0 骨架）
 * 频道约定：⌘K 全局搜索 / Space 灵感换一个 / Esc 退出全屏态 等（Phase 6 实装具体行为）
 */
export interface ShortcutDef {
  /** 标准化组合键，如 'mod+k'、'space'、'esc' */
  combo: string
  description: string
  handler: (e: KeyboardEvent) => void
  /** 全局 = 任何页面生效；否则仅激活路由内生效 */
  scope?: 'global' | 'page'
}

const registry = new Map<string, ShortcutDef>()

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
  registry.set(def.combo, def)
  return () => registry.delete(def.combo)
}

export function getShortcut(combo: string): ShortcutDef | undefined {
  return registry.get(combo)
}

export function listShortcuts(): ShortcutDef[] {
  return [...registry.values()]
}

export function installKeyboardListener() {
  window.addEventListener(
    'keydown',
    (e) => {
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
