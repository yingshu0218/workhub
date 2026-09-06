import { create } from 'zustand'

export type SyncStatus = 'synced' | 'syncing' | 'offline'

interface SyncState {
  status: SyncStatus
  pendingCount: number
  lastSyncAt: number | null
  setStatus: (s: SyncStatus) => void
  setPending: (n: number) => void
  setLastSync: (t: number) => void
}

/** 同步状态（顶栏徽章三态：已同步 / 同步中 / 离线待同步） */
export const useSyncStore = create<SyncState>((set) => ({
  status: 'synced',
  pendingCount: 0,
  lastSyncAt: null,
  setStatus: (status) => set({ status }),
  setPending: (pendingCount) => set({ pendingCount }),
  setLastSync: (lastSyncAt) => set({ lastSyncAt }),
}))
