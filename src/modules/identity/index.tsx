import { scopedClientKey } from '@/storage/clientSession'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * 当前用户身份（Issue #123）
 * 「我」是谁从散落的硬编码（陈致远）收口到唯一事实源：
 * 默认档案 + localStorage 持久化覆盖 + 订阅广播。
 * - 首屏同步读 localStorage，保证画布/侧栏/首页首帧不会闪名字；
 * - React 侧用 Context + useSyncExternalStore 语义（订阅 onIdentityChange）实时联动；
 * - 与后端账号体系无关（本地优先应用，Phase 7 接入真账号后再迁移）。
 */

/** 默认用户显示名（Issue #123 口径）：系统内默认用户名 */
export const DEFAULT_IDENTITY_NAME = '阿蓝'
/** 默认工作区（AppLayout WORKSPACES 与个人主页共用同一份） */
export const DEFAULT_WORKSPACE_NAME = '个人空间'
export const DEFAULT_WORKSPACE_ROLE = 'Personal'
/** 工作区副标题的默认展示串 */
export const DEFAULT_WORKSPACE_SUB = '个人空间'

export interface Identity {
  /** 用户显示名 —— 画布「我」节点、侧栏、首页问候、个人主页统一取这里 */
  name: string
  /** 所属工作区名 */
  workspace: string
  /** 在工作区中的角色 */
  role: string
}

export const DEFAULT_IDENTITY: Identity = {
  name: DEFAULT_IDENTITY_NAME,
  workspace: DEFAULT_WORKSPACE_NAME,
  role: DEFAULT_WORKSPACE_ROLE,
}

const IDENTITY_KEY = 'nexus:identity'

function normalize(raw: unknown): Identity {
  const src = (raw ?? {}) as Partial<Identity>
  const pick = (v: unknown, fallback: string) =>
    typeof v === 'string' && v.trim() ? v.trim() : fallback
  return {
    name: pick(src.name, DEFAULT_IDENTITY.name),
    workspace: pick(src.workspace, DEFAULT_IDENTITY.workspace),
    role: pick(src.role, DEFAULT_IDENTITY.role),
  }
}

/** 读身份（localStorage 不可用/无值时回落默认档案） */
export function loadIdentity(): Identity {
  try {
    const raw = localStorage.getItem(scopedClientKey(IDENTITY_KEY))
    return raw ? normalize(JSON.parse(raw)) : DEFAULT_IDENTITY
  } catch {
    return DEFAULT_IDENTITY
  }
}

// ── 进程内单例 + 订阅（避免每个组件各自读 storage 造成首帧不一致） ──
let current: Identity = loadIdentity()
const listeners = new Set<() => void>()

export function getIdentity(): Identity {
  return current
}

/** 订阅身份变更，返回取消订阅函数（React 外部订阅也走这里） */
export function onIdentityChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 更新身份：空值回落默认（不允许把名字清成空串） */
export function setIdentity(patch: Partial<Identity>): Identity {
  current = normalize({ ...current, ...patch })
  try {
    localStorage.setItem(scopedClientKey(IDENTITY_KEY), JSON.stringify(current))
  } catch {
    // 持久化失败不影响本次会话内生效
  }
  listeners.forEach((fn) => fn())
  return current
}

/** 恢复默认身份（阿蓝 / 青枫工作室） */
export function resetIdentity(): Identity {
  current = { ...DEFAULT_IDENTITY }
  try {
    localStorage.removeItem(scopedClientKey(IDENTITY_KEY))
  } catch {
    /* 忽略 */
  }
  listeners.forEach((fn) => fn())
  return current
}

const IdentityContext = createContext<Identity>(current)

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, set] = useState<Identity>(() => { current=loadIdentity();return current })
  useEffect(() => onIdentityChange(() => set(getIdentity())), [])
  return <IdentityContext.Provider value={identity}>{children}</IdentityContext.Provider>
}

/** 任意组件读当前身份（含实时更新） */
export function useIdentity(): Identity {
  return useContext(IdentityContext)
}

/** 只取显示名（画布「我」节点等高频场景） */
export function useUserName(): string {
  return useIdentity().name
}
