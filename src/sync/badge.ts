import type { SyncReachability, SyncTargetKind } from './connectivity'
import type { SyncStatus } from './store'

/**
 * 同步状态 → 展示视图的**唯一派生处**。
 *
 * 为什么要抽成纯函数：顶栏徽章与设置页的状态卡片本来各写了一套 `status` 判断，
 * 一旦连通性维度加进来，两处必然出现「徽章说连不上、设置说已同步」这类互相打脸。
 * 这里把判断收口成一份，两处只负责渲染，并顺带让这套优先级能被单测钉住。
 */

/** 与 Chip 组件的 tone 取值保持一致（design-system/ui.tsx 的 chipTones） */
export type SyncBadgeTone = 'blue' | 'green' | 'amber' | 'red' | 'gray'

/**
 * tone → 文字色 class。给设置页那种「用裸 Icon 而不是 Chip」的位置复用，
 * 避免那边再写一套 tone 映射而与 Chip 的配色漂移。
 */
export const SYNC_TONE_TEXT_CLASS: Record<SyncBadgeTone, string> = {
  blue: 'text-primary',
  green: 'text-success',
  amber: 'text-warning',
  red: 'text-danger',
  gray: 'text-outline',
}

export interface SyncBadgeInput {
  status: SyncStatus
  pendingCount: number
  target: SyncTargetKind
  reachability: SyncReachability
  lastSyncAt: number | null
  lastError: string | null
  /** 当前配置的同步中心地址（仅用于展示；未配置为空串） */
  serverUrl: string
  /** 注入「现在」以便相对时间可测 */
  now: number
}

export interface SyncBadgeView {
  tone: SyncBadgeTone
  icon: string
  /** 顶栏徽章短标签 */
  label: string
  /** 设置页用的一句话状态（比 label 完整） */
  summary: string
  /** 悬浮提示：把徽章概括不了的事实摊开（地址 / 待推送 / 上次同步 / 最近错误） */
  title: string
}

/** 上次同步的相对时间描述（注入 now 以便单测） */
export function describeLastSync(lastSyncAt: number | null, now: number): string {
  if (!lastSyncAt) return '尚未同步'
  const diff = Math.max(0, now - lastSyncAt)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

function buildTitle(i: SyncBadgeInput): string {
  const lines: string[] = []
  if (i.target === 'none') {
    lines.push('同步中心：未配置（数据只保存在本机）')
  } else {
    lines.push(`同步中心：${i.serverUrl}${i.target === 'loopback' ? '（本机）' : '（远程）'}`)
    lines.push(
      i.reachability === 'online'
        ? '连接状态：已连接'
        : i.reachability === 'offline'
          ? '连接状态：无法连接'
          : '连接状态：检测中',
    )
  }
  lines.push(`待推送：${i.pendingCount} 条`)
  lines.push(`上次同步：${describeLastSync(i.lastSyncAt, i.now)}`)
  if (i.lastError) lines.push(`最近错误：${i.lastError}`)
  return lines.join('\n')
}

/**
 * 派生徽章视图。判断顺序即优先级，逐条都有理由：
 *
 * ① 正在同步 —— 此刻最该看到的事实，压过一切；
 * ② 未配置同步中心 —— 数据只在本机，这是**正常状态不是故障**，用中性灰，不要吓唬用户；
 * ③ 还没测出结果 —— 首次探测中，别急着说「连不上」；
 * ④ 连不上 —— 本机中心（用户自己能去把服务拉起来）与远端中心（只能等/查网络）措辞分开；
 * ⑤ 连得上但有积压 —— 积压比「已连接」更值得用户注意：还有东西没送出去；
 * ⑥ 一切正常 —— 本机中心与远端中心措辞不同（用户明确要求区分）。
 */
export function deriveSyncBadge(i: SyncBadgeInput): SyncBadgeView {
  const title = buildTitle(i)

  if (i.status === 'syncing') {
    return { tone: 'blue', icon: 'sync', label: '同步中', summary: '正在与同步中心交换数据…', title }
  }

  if (i.target === 'none') {
    return {
      tone: 'gray',
      icon: 'hard_drive',
      label: '仅本机',
      summary: '本地模式（数据仅存本机，未配置同步中心）',
      title,
    }
  }

  const where = i.target === 'loopback' ? '本机同步中心' : '远程同步中心'

  if (i.reachability === 'unknown' || i.reachability === 'checking') {
    return { tone: 'gray', icon: 'progress_activity', label: '检测连接…', summary: `正在检测${where}…`, title }
  }

  if (i.reachability === 'offline') {
    return i.target === 'loopback'
      ? { tone: 'amber', icon: 'cloud_off', label: '本机 · 未连接', summary: '本机同步中心未响应（服务没起来？）', title }
      : { tone: 'red', icon: 'cloud_off', label: '无法连接', summary: '无法连接远程同步中心，改动暂存在本机', title }
  }

  if (i.pendingCount > 0) {
    return {
      tone: 'amber',
      icon: 'cloud_upload',
      label: `待推送 ${i.pendingCount}`,
      summary: `已连接，仍有 ${i.pendingCount} 条改动待推送`,
      title,
    }
  }

  return i.target === 'loopback'
    ? { tone: 'blue', icon: 'hard_drive', label: '本机', summary: '本机同步中心 · 已连接且已同步', title }
    : { tone: 'green', icon: 'cloud_done', label: '已连接', summary: '远程同步中心 · 已连接且已同步', title }
}
