import { clientSession } from '@/storage/clientSession'
import type { Note } from '@/db/types'
import { nanoid } from 'nanoid'

export interface NoteEditSnapshot {
  title: string
  markdown: string
  tags: string[]
}

export type NoteAutosaveState = 'saved' | 'dirty' | 'saving' | 'failed' | 'unknown' | 'conflict'

export interface NoteDraftRecord extends NoteEditSnapshot {
  version: 1
  noteId: string
  baseRev: number
  savedAt: number
  /** 标识当前 localStorage 所有者，旧控制器的晚回执不能清理较新的草稿。 */
  draftId?: string
}

export interface NoteDraftScope {
  sessionKey?: string
}

function currentDraftKey(noteId: string, scope?: NoteDraftScope): string {
  const key = `workhub.draft.note:${encodeURIComponent(noteId)}`
  const sessionKey = scope === undefined ? clientSession()?.key : scope.sessionKey
  return sessionKey ? `${key}:${sessionKey}` : key
}

export function noteDraftKey(noteId: string, scope?: NoteDraftScope): string {
  return currentDraftKey(noteId, scope)
}

export function readNoteDraft(noteId: string, scope?: NoteDraftScope): NoteDraftRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(noteDraftKey(noteId, scope)) || 'null') as
      | Partial<NoteDraftRecord>
      | null
    if (
      !value ||
      value.version !== 1 ||
      value.noteId !== noteId ||
      typeof value.title !== 'string' ||
      typeof value.markdown !== 'string' ||
      !Array.isArray(value.tags) ||
      !value.tags.every((tag) => typeof tag === 'string') ||
      typeof value.baseRev !== 'number' ||
      (value.draftId !== undefined && typeof value.draftId !== 'string')
    ) {
      return null
    }
    return value as NoteDraftRecord
  } catch {
    return null
  }
}

export function writeNoteDraft(
  noteId: string,
  snapshot: NoteEditSnapshot,
  baseRev: number,
  scope?: NoteDraftScope,
  expectedOwner?: NoteDraftRecord,
): NoteDraftRecord | null {
  try {
    const key = noteDraftKey(noteId, scope)
    if (expectedOwner && !sameDraftRecord(readNoteDraft(noteId, scope), expectedOwner)) return null
    const draft: NoteDraftRecord = {
      version: 1,
      noteId,
      title: snapshot.title,
      markdown: snapshot.markdown,
      tags: [...snapshot.tags],
      baseRev,
      savedAt: Date.now(),
      draftId: nanoid(16),
    }
    localStorage.setItem(key, JSON.stringify(draft))
    return draft
  } catch {
    // 隐私模式或配额耗尽时，内存编辑仍保留；保存状态仍由真实命令回执决定。
    return null
  }
}

export function clearNoteDraft(
  noteId: string,
  scope?: NoteDraftScope,
  expectedOwner?: NoteDraftRecord,
): boolean {
  try {
    if (expectedOwner && !sameDraftRecord(readNoteDraft(noteId, scope), expectedOwner)) return false
    localStorage.removeItem(noteDraftKey(noteId, scope))
    return true
  } catch {
    // 清理本地副本失败不会改变服务器确认状态。
    return false
  }
}

function sameDraftRecord(current: NoteDraftRecord | null, expected: NoteDraftRecord): boolean {
  if (!current) return false
  if (expected.draftId) return current.draftId === expected.draftId
  return (
    current.noteId === expected.noteId &&
    current.savedAt === expected.savedAt &&
    current.baseRev === expected.baseRev &&
    current.title === expected.title &&
    current.markdown === expected.markdown &&
    JSON.stringify(current.tags) === JSON.stringify(expected.tags)
  )
}

export function classifyNoteSaveError(error: unknown): 'conflict' | 'unknown' | 'failed' {
  const message = error instanceof Error ? error.message : String(error)
  if (/VERSION_CONFLICT|QUERY_REFRESH_REQUIRED|CONFLICT/i.test(message)) return 'conflict'
  if (
    /RESULT_UNKNOWN|REQUEST_REUSED|RECOVERY_REVIEW_REQUIRED|GENERATION|SESSION_CHANGED/i.test(
      message,
    ) ||
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === 'AbortError')
  ) {
    return 'unknown'
  }
  return 'failed'
}

export interface NoteAutosaveHooks {
  save(snapshot: NoteEditSnapshot, expectedRev: number): Promise<Note>
  reload(): Promise<Note | undefined>
  readConflict(): Promise<unknown>
  recoverOriginal(
    retryOriginal: boolean,
    pending: { snapshot: NoteEditSnapshot; baseRev: number },
  ): Promise<NoteConfirmedWrite | false>
  hasPendingRequest(): boolean
  onStatus(
    state: NoteAutosaveState,
    message?: string,
    canRetryOriginal?: boolean,
  ): void
  onEditorSnapshot?(snapshot: NoteEditSnapshot): void
  onConflict(value: unknown): void
}

export interface NoteConfirmedWrite {
  requestId: string
  generation: string
  revision: number
}

/**
 * 单篇笔记的串行保存队列。快照有编辑序号，旧回执只能确认其发出时的序号；
 * 如果等待回执期间又有输入，队列以新回执提供的 rev 再提交最新快照。
 */
export class NoteAutosaveController {
  private latest: NoteEditSnapshot
  private version = 0
  private savedVersion = 0
  private pendingVersion: number | undefined
  private pendingBaseRev: number | undefined
  private pendingSnapshot: NoteEditSnapshot | undefined
  private baseRev: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private worker: Promise<boolean> | undefined
  private blocked: 'failed' | 'unknown' | 'conflict' | undefined
  private closed = false
  private invalidated = false
  private readonly sessionKey: string | undefined
  private readonly draftScope: NoteDraftScope
  private draftRecord: NoteDraftRecord | null = null

  constructor(
    private readonly noteId: string,
    initial: Note,
    private readonly hooks: NoteAutosaveHooks,
    private readonly debounceMs = 800,
  ) {
    this.latest = { title: initial.title, markdown: initial.markdown, tags: [...initial.tags] }
    this.baseRev = initial.rev
    this.sessionKey = clientSession()?.key
    this.draftScope = { sessionKey: this.sessionKey }
  }

  get baseRevision(): number {
    return this.baseRev
  }

  /** Restoring a persisted draft must keep the revision it was created against. */
  restoreDraft(draft: NoteDraftRecord): boolean {
    const restoringUnknownRequest = this.blocked === 'unknown'
    if (
      this.invalidated ||
      (this.blocked && this.blocked !== 'unknown') ||
      (!restoringUnknownRequest && this.worker) ||
      (!restoringUnknownRequest && this.savedVersion !== this.version) ||
      draft.noteId !== this.noteId ||
      !Number.isSafeInteger(draft.baseRev) ||
      draft.baseRev < 0 ||
      !this.ensureCurrentSession()
    ) {
      return false
    }
    if (!restoringUnknownRequest) this.baseRev = draft.baseRev
    this.draftRecord = draft
    return true
  }

  /** Unknown recovery can discard a later local draft without changing the pending B1 request. */
  discardPendingRecoveryDraft(): boolean {
    const owner = this.draftRecord
    if (
      this.invalidated ||
      this.blocked !== 'unknown' ||
      !this.pendingSnapshot ||
      this.pendingVersion === undefined ||
      !owner
    ) {
      return false
    }
    const persisted = readNoteDraft(this.noteId, this.draftScope)
    if (persisted && !sameDraftRecord(persisted, owner)) return false
    if (persisted && !clearNoteDraft(this.noteId, this.draftScope, owner)) return false

    this.draftRecord = null
    this.latest = { ...this.pendingSnapshot, tags: [...this.pendingSnapshot.tags] }
    this.version = this.pendingVersion
    this.hooks.onEditorSnapshot?.({ ...this.latest, tags: [...this.latest.tags] })
    return true
  }

  /** 刷新后从持久命令重建原请求上下文，不能用当前编辑器或镜像快照替换它。 */
  restoreUnknownRequest(
    original: NoteEditSnapshot,
    baseRev: number,
    laterDraft?: NoteDraftRecord | null,
  ): boolean {
    if (
      this.invalidated ||
      this.worker ||
      !Number.isSafeInteger(baseRev) ||
      baseRev < 0 ||
      !this.ensureCurrentSession()
    ) {
      return false
    }
    const pendingSnapshot = { ...original, tags: [...original.tags] }
    this.baseRev = baseRev
    this.pendingBaseRev = baseRev
    this.pendingSnapshot = pendingSnapshot
    this.pendingVersion = 1
    this.savedVersion = 0
    this.version = 1
    this.latest = pendingSnapshot
    this.draftRecord = laterDraft && laterDraft.noteId === this.noteId ? laterDraft : null
    if (laterDraft && laterDraft.noteId === this.noteId && !sameSnapshot(laterDraft, pendingSnapshot)) {
      this.latest = { title: laterDraft.title, markdown: laterDraft.markdown, tags: [...laterDraft.tags] }
      this.version = 2
    }
    this.blocked = 'unknown'
    this.publish('unknown', '发现一条刷新前尚未确认的保存请求；请先核对原请求。', this.hooks.hasPendingRequest())
    return true
  }

  /** 原请求仍在 localStorage、但无法安全解析时，阻止本端继续提交覆盖它。 */
  blockForUnverifiablePending(message: string): void {
    if (this.invalidated || !this.ensureCurrentSession()) return
    this.blocked = 'conflict'
    this.publish('conflict', message)
  }

  edit(snapshot: NoteEditSnapshot): void {
    if (this.invalidated || this.closed) return
    this.latest = { ...snapshot, tags: [...snapshot.tags] }
    this.version += 1
    this.writeDraft()
    if (!this.ensureCurrentSession()) return
    if (this.blocked) return
    this.publish(this.worker ? 'saving' : 'dirty')
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.debounceMs)
  }

  async flush(): Promise<boolean> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.invalidated || this.blocked) return false
    if (!this.ensureCurrentSession()) return false
    return this.startWorker()
  }

  async retryFailed(): Promise<boolean> {
    if (this.blocked !== 'failed' || this.invalidated) return false
    if (!this.ensureCurrentSession()) return false
    this.blocked = undefined
    return this.startWorker()
  }

  async checkUnknown(retryOriginal = false): Promise<boolean> {
    if (this.blocked !== 'unknown' || this.invalidated) return false
    if (!this.ensureCurrentSession()) return false
    const pendingVersion = this.pendingVersion
    const pendingBaseRev = this.pendingBaseRev
    const pendingSnapshot = this.pendingSnapshot
    if (pendingVersion === undefined || pendingBaseRev === undefined || !pendingSnapshot) {
      this.blocked = 'conflict'
      this.publish('conflict', '原请求上下文不完整；本端草稿已保留，请比较服务器内容后处理。')
      return false
    }
    try {
      const confirmed = await this.hooks.recoverOriginal(retryOriginal, {
        snapshot: { ...pendingSnapshot, tags: [...pendingSnapshot.tags] },
        baseRev: pendingBaseRev,
      })
      if (!this.ensureCurrentSession()) return false
      if (!confirmed) {
        this.publish('unknown', '服务端尚未确认原请求。草稿仍保留。', this.hooks.hasPendingRequest())
        return false
      }
      if (
        !confirmed.requestId ||
        !confirmed.generation ||
        !Number.isSafeInteger(confirmed.revision) ||
        confirmed.revision !== pendingBaseRev + 1
      ) {
        await this.enterConflict(
          new Error('原请求回执与本端版本不匹配；草稿已保留，请比较服务器内容后处理。'),
        )
        return false
      }
      const latest = await this.hooks.reload()
      if (!this.ensureCurrentSession()) return false
      if (!latest || latest.deleted) {
        await this.enterConflict(
          new Error('DELETED: 原请求已确认，但笔记已删除；本端草稿仍保留。'),
        )
        return false
      }
      let authoritative: unknown
      try {
        authoritative = await this.hooks.readConflict()
      } catch (error) {
        if (!this.ensureCurrentSession()) return false
        this.blocked = 'conflict'
        this.publish(
          'conflict',
          `原请求已确认到 rev ${confirmed.revision}，但无法核实服务器后续版本；本端草稿仍保留。${errorMessage(error)}`,
        )
        return false
      }
      if (!this.ensureCurrentSession()) return false
      const remote = authoritative as {
        title?: unknown
        markdown?: unknown
        tags?: unknown
        revision?: unknown
        generation?: unknown
      }
      const confirmedSnapshot: NoteEditSnapshot = {
        title: pendingSnapshot.title.trim() || '未命名笔记',
        markdown: pendingSnapshot.markdown,
        tags: [...pendingSnapshot.tags],
      }
      const latestMatches = sameSnapshot(latest, confirmedSnapshot)
      const remoteMatches =
        typeof remote.title === 'string' &&
        typeof remote.markdown === 'string' &&
        Array.isArray(remote.tags) &&
        remote.tags.every((tag): tag is string => typeof tag === 'string') &&
        sameSnapshot(
          {
            title: remote.title,
            markdown: remote.markdown,
            tags: remote.tags,
          },
          confirmedSnapshot,
        )
      if (
        latest.rev !== confirmed.revision ||
        remote.revision !== confirmed.revision ||
        remote.generation !== confirmed.generation ||
        !latestMatches ||
        !remoteMatches
      ) {
        this.blocked = 'conflict'
        this.hooks.onConflict(authoritative)
        const remoteRevision =
          typeof remote.revision === 'number' && Number.isSafeInteger(remote.revision)
            ? String(remote.revision)
            : '未知'
        this.publish(
          'conflict',
          `原请求已确认到 rev ${confirmed.revision}，当前服务器版本为 rev ${remoteRevision} 或内容已变化；本端草稿仍保留，请比较后手动处理。`,
        )
        return false
      }
      // Controller.latest is the exact snapshot the queue will preserve next. Refresh the UI
      // before publishing "saved" so a stale mirror cannot leave an older editor body visible.
      this.hooks.onEditorSnapshot?.({
        ...this.latest,
        tags: [...this.latest.tags],
      })
      this.baseRev = confirmed.revision
      this.savedVersion = pendingVersion
      this.pendingVersion = undefined
      this.pendingBaseRev = undefined
      this.pendingSnapshot = undefined
      this.blocked = undefined
      if (this.version === this.savedVersion) this.clearOwnedDraft()
      else this.writeDraftIfOwned()
      if (this.savedVersion === this.version) {
        this.publish('saved')
        return true
      }
      return this.startWorker()
    } catch (error) {
      if (!this.ensureCurrentSession()) return false
      const kind = classifyNoteSaveError(error)
      if (kind === 'conflict') {
        await this.enterConflict(error)
      } else if (kind === 'failed') {
        this.blocked = 'failed'
        this.publish('failed', errorMessage(error))
      } else {
        this.publish('unknown', errorMessage(error), this.hooks.hasPendingRequest())
      }
      return false
    }
  }

  /** 路由离开时启动最后一次尝试；本地隔离草稿先已同步写入。 */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.closed = true
    if (
      !this.invalidated &&
      !this.blocked &&
      this.savedVersion < this.version &&
      this.ensureCurrentSession()
    ) {
      void this.startWorker()
    }
  }

  /** 删除前需先确认队列为空；成功后再禁止任何旧定时器发出写入。 */
  invalidate(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.invalidated = true
  }

  /** 删除事务失败时记录仍存活；恢复输入队列，避免后续编辑被静默忽略。 */
  resumeAfterFailedDelete(): void {
    if (this.closed) return
    this.invalidated = false
  }

  private startWorker(): Promise<boolean> {
    if (this.worker) return this.worker
    const current = this.drain()
    this.worker = current
    void current.then(
      () => {
        if (this.worker === current) this.worker = undefined
      },
      () => {
        if (this.worker === current) this.worker = undefined
      },
    )
    return current
  }

  private async drain(): Promise<boolean> {
    while (!this.invalidated && !this.blocked && this.savedVersion < this.version) {
      if (!this.ensureCurrentSession()) return false
      const version = this.version
      const snapshot = { ...this.latest, tags: [...this.latest.tags] }
      const expectedRev = this.baseRev
      this.pendingVersion = version
      this.pendingBaseRev = expectedRev
      this.pendingSnapshot = snapshot
      this.publish('saving')
      try {
        const saved = await this.hooks.save(snapshot, expectedRev)
        if (!this.ensureCurrentSession()) return false
        this.baseRev = saved.rev
        this.savedVersion = version
        this.pendingVersion = undefined
        this.pendingBaseRev = undefined
        this.pendingSnapshot = undefined
        if (this.savedVersion === this.version) {
          this.clearOwnedDraft()
          this.publish('saved')
          return true
        }
        this.writeDraftIfOwned()
        this.publish('saving')
      } catch (error) {
        if (!this.ensureCurrentSession()) return false
        this.pendingVersion = version
        this.pendingBaseRev = this.baseRev
        this.pendingSnapshot = snapshot
        const kind = classifyNoteSaveError(error)
        if (kind === 'conflict') await this.enterConflict(error)
        else {
          this.blocked = kind
          this.publish(
            kind,
            errorMessage(error),
            kind === 'unknown' && this.hooks.hasPendingRequest(),
          )
        }
        return false
      }
    }
    return !this.blocked && this.savedVersion === this.version
  }

  private async enterConflict(error: unknown): Promise<void> {
    this.blocked = 'conflict'
    let message = errorMessage(error)
    try {
      const authoritative = await this.hooks.readConflict()
      if (!this.ensureCurrentSession()) return
      this.hooks.onConflict(authoritative)
      message = '服务器已有更新版本；本端输入已保留，请比较后处理。'
    } catch (readError) {
      if (!this.ensureCurrentSession()) return
      message = `服务器已有更新版本，且最新内容暂时无法读取；本端输入已保留。${errorMessage(readError)}`
    }
    this.publish('conflict', message)
  }

  private writeDraft(): void {
    this.draftRecord = writeNoteDraft(this.noteId, this.latest, this.baseRev, this.draftScope)
  }

  /** Receipt-driven updates may only touch the draft version this controller still owns. */
  private writeDraftIfOwned(): void {
    if (!this.draftRecord) return
    this.draftRecord = writeNoteDraft(
      this.noteId,
      this.latest,
      this.baseRev,
      this.draftScope,
      this.draftRecord,
    )
  }

  private clearOwnedDraft(): void {
    if (!this.draftRecord) return
    clearNoteDraft(this.noteId, this.draftScope, this.draftRecord)
    this.draftRecord = null
  }

  private ensureCurrentSession(): boolean {
    if (clientSession()?.key === this.sessionKey) return true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.blocked = 'conflict'
    this.publish(
      'conflict',
      '账号、服务器或数据世代已改变；旧会话草稿仍保留在原身份中，请切回原身份核对。',
    )
    return false
  }

  private publish(state: NoteAutosaveState, message?: string, canRetryOriginal = false): void {
    if (!this.closed) this.hooks.onStatus(state, message, canRetryOriginal)
  }
}

function sameSnapshot(left: NoteEditSnapshot, right: NoteEditSnapshot): boolean {
  return (
    left.title === right.title &&
    left.markdown === right.markdown &&
    JSON.stringify(left.tags) === JSON.stringify(right.tags)
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
