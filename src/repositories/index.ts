import { createRepository, newId } from './repository'
import type {
  Customer,
  Interaction,
  Ledger,
  Transaction,
  Todo,
  Note,
  QuickNote,
  Habit,
  HabitLog,
  Trophy,
} from '@/db/types'

/** 模块统一从这里拿仓储实例，不直接触碰 Dexie */
export const customerRepo = createRepository<Customer>('customers')
export const interactionRepo = createRepository<Interaction>('interactions')
export const ledgerRepo = createRepository<Ledger>('ledgers')
export const transactionRepo = createRepository<Transaction>('transactions')
export const todoRepo = createRepository<Todo>('todos')
export const noteRepo = createRepository<Note>('notes')
export const quickNoteRepo = createRepository<QuickNote>('quickNotes')
export const habitRepo = createRepository<Habit>('habits')
export const habitLogRepo = createRepository<HabitLog>('habitLogs')
export const trophyRepo = createRepository<Trophy>('trophies')

export { newId }
