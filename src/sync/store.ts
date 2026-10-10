import { create } from 'zustand'
import type { SyncReachability, SyncTargetKind } from './connectivity'

export type SyncStatus = 'synced' | 'syncing' | 'offline'

/** 连通性相关的字段（一次写入，避免多次 set 产生中间态） */
export interface SyncConnectivityPatch {
  /** 当前配置的同步中心地址（未配置为空串） */
  serverUrl: string
  /** 同步中心在哪：未配置 / 本机回环 / 远端 */
  target: SyncTargetKind
  /** 最近一次探测结果 */
  reachability: SyncReachability
  /** 最近一次探测完成的时间 */
  lastCheckedAt: number
}

interface SyncState {
  status: SyncStatus
  pendingCount: number
  lastSyncAt: number | null
  serverUrl: string
  target: SyncTargetKind
  reachability: SyncReachability
  lastCheckedAt: number
  /** 最近一次同步/探测的失败原因（成功即清空） */
  lastError: string | null
  setStatus: (s: SyncStatus) => void
  setPending: (n: number) => void
  setLastSync: (t: number) => void
  /** 一次性写连通性四件套（地址 / 位置 / 可达性 / 探测时间） */
  setConnectivity: (patch: SyncConnectivityPatch) => void
  setLastError: (message: string | null) => void
}

/**
 * 同步状态。
 *
 * 分两组字段，因为它们回答的是不同问题：
 * - `status` / `pendingCount` / `lastSyncAt`：**同步这件事**进行到哪了（引擎写入）
 * - `target` / `reachability` / `lastCheckedAt`：**同步中心**在哪、此刻连得上吗
 *   （由 `syncEngine.refreshConnectivity()` 独立探测写入 —— 后者是修掉
 *   「服务器早就没了、徽章还显示已同步」这个假绿的关键：没有待推送数据时引擎
 *   根本不会发请求，所以连通性必须独立探测）
 *
 * 展示侧的派生统一走 `src/sync/badge.ts` 的 deriveSyncBadge，本文件只管存事实。
 */
export const useSyncStore = create<SyncState>((set) => ({
  status: 'synced',
  pendingCount: 0,
  lastSyncAt: null,
  serverUrl: '',
  target: 'none',
  reachability: 'unknown',
  lastCheckedAt: 0,
  lastError: null,
  setStatus: (status) => set({ status }),
  setPending: (pendingCount) => set({ pendingCount }),
  setLastSync: (lastSyncAt) => set({ lastSyncAt }),
  setConnectivity: (patch) => set(patch),
  setLastError: (lastError) => set({ lastError }),
}))
