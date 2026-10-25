import dayjs from 'dayjs'
import { db, DEFAULT_WORKSPACE_ID } from './db'
import { addCustomerRelation, habitLogId } from '@/repositories'
import { buildLinkId } from '@/repositories/linkId'
import type {
  Workspace,
  Customer,
  Ledger,
  Transaction,
  Todo,
  Note,
  QuickNote,
  Habit,
  HabitLog,
  Trophy,
  Interaction,
  Project,
  ProjectMilestone,
  RelationCategory,
  Link,
} from './types'

/**
 * 种子数据 —— 对齐 design/prototypes 演示数据（深蓝科技 / 二期款 ¥185,000）
 * 当前用户身份（Issue #123）已收口到 src/modules/identity，默认显示名「阿蓝」
 * 标记 synced=1，不进同步队列（本地演示数据）
 */
const now = Date.now()
const meta = () => ({ updatedAt: now, deleted: 0 as const, rev: 1, synced: 1 as const })

export async function seedIfEmpty(): Promise<boolean> {
  const count = await db.customers.count()
  if (count > 0) return false

  const workspace: Workspace = {
    id: DEFAULT_WORKSPACE_ID,
    name: '青枫工作室',
    role: 'Owner',
    createdAt: now,
    ...meta(),
  }

  const customers: Customer[] = [
    {
      id: 'c1',
      name: '严伟强',
      company: '深蓝科技',
      title: '采购总监',
      decisionLevel: '决策人',
      tags: ['深度工作', '优先跟进', '合同客户'],
      phone: '138****6672',
      wechat: 'yanwq_blue',
      email: 'yanwq@deepblue-tech.com',
      address: '厦门市软件园二期',
      lastContactAt: now - 2 * 3600_000,
      createdAt: now - 90 * 86400_000,
      // 演示可见关系（Issue #123）：三人都与「我」连成星型，且互相之间有关系线，
      // 画布上不会出现孤立点；每条关系带归类维度（项目/财务/人物）供着色与筛选演示
      relations: [
        { targetId: 'c2', label: '项目合作', category: 'project' },
        { targetId: 'c3', label: '同行伙伴', category: 'person' },
      ],
      ...meta(),
    },
    {
      id: 'c2',
      name: '林晓棠',
      company: '云上文创',
      title: '品牌经理',
      decisionLevel: '影响者',
      tags: ['内容合作', '潜力客户'],
      phone: '159****2210',
      wechat: 'xitang_lin',
      email: 'linxt@cloudcc.cn',
      address: '厦门市湖里区',
      lastContactAt: now - 3 * 86400_000,
      createdAt: now - 45 * 86400_000,
      relations: [
        { targetId: 'c1', label: '项目合作', category: 'project' },
        { targetId: 'c3', label: '转介绍人', category: 'person' },
      ],
      ...meta(),
    },
    {
      id: 'c3',
      name: '赵屹峰',
      company: '启衡咨询',
      title: '合伙人',
      decisionLevel: '决策人',
      tags: ['观察'],
      phone: '137****0915',
      wechat: 'qiheng_zhao',
      email: 'zhao@qiheng-consult.com',
      address: '福州市鼓楼区',
      lastContactAt: now - 21 * 86400_000,
      createdAt: now - 120 * 86400_000,
      // 双向补全（Issue #123）：与 c1/c2 互指，连线标签聚合后完整呈现
      relations: [
        { targetId: 'c1', label: '同行伙伴', category: 'person' },
        { targetId: 'c2', label: '转介绍人', category: 'person' },
      ],
      ...meta(),
    },
  ]

  const interactions: Interaction[] = [
    {
      id: 'i1',
      customerId: 'c1',
      content: '二期需求评审会，确认交付范围与时间线，下周回签补充协议',
      at: now - 2 * 3600_000,
      ...meta(),
    },
    {
      id: 'i2',
      customerId: 'c2',
      content: '沟通品牌年度框架合作意向，对方需要内部预算审批',
      at: now - 3 * 86400_000,
      ...meta(),
    },
  ]

  const ledgers: Ledger[] = [
    {
      id: 'l1',
      name: '运营主账本',
      currency: 'CNY',
      openingBalance: 150000,
      closingCycle: '月结',
      sortOrder: 0,
      createdAt: now - 180 * 86400_000,
      ...meta(),
    },
    {
      id: 'l2',
      name: '项目备用金',
      currency: 'CNY',
      openingBalance: 20000,
      closingCycle: '月结',
      sortOrder: 1,
      createdAt: now - 60 * 86400_000,
      ...meta(),
    },
  ]

  const transactions: Transaction[] = [
    {
      id: 't1',
      ledgerId: 'l1',
      type: 'income',
      amount: 185000,
      summary: '深蓝科技 · 二期平台开发款',
      channel: '对公转账',
      occurredAt: now - 1 * 86400_000,
      tags: ['项目收款', '深蓝科技'],
      invoiceNo: 'INV-2026-0892',
      status: '已结算',
      ...meta(),
    },
    {
      id: 't2',
      ledgerId: 'l1',
      type: 'expense',
      amount: 8600,
      summary: '云服务器季度费用',
      channel: '支付宝',
      occurredAt: now - 5 * 86400_000,
      tags: ['基础设施'],
      status: '待对账',
      ...meta(),
    },
    {
      id: 't3',
      ledgerId: 'l2',
      type: 'expense',
      amount: 428,
      summary: '客户拜访差旅 · 打车',
      channel: '微信支付',
      occurredAt: now - 2 * 86400_000,
      tags: ['差旅', 'CRM 关联'],
      status: '已结算',
      ...meta(),
    },
  ]

  const today = dayjs().format('YYYY-MM-DD')
  const todos: Todo[] = [
    {
      id: 'td1',
      title: '深蓝科技二期合同终稿校对',
      desc: '重点核对交付边界条款与验收标准，17:30 前发出',
      priority: 'high',
      dueAt: dayjs().hour(17).minute(30).valueOf(),
      status: 'todo',
      customerId: 'c1',
      projectId: 'p1',
      createdAt: now - 86400_000,
      ...meta(),
    },
    {
      id: 'td2',
      title: '云上文创方案预算部分修订',
      desc: '按林晓棠反馈调整内容生产模块报价',
      priority: 'mid',
      dueAt: dayjs().add(1, 'day').hour(12).valueOf(),
      status: 'todo',
      customerId: 'c2',
      createdAt: now - 2 * 86400_000,
      ...meta(),
    },
    {
      id: 'td3',
      title: '季度服务器费用对账',
      desc: '关联流水 t2，核对发票抬头',
      priority: 'mid',
      status: 'todo',
      ledgerId: 'l1',
      createdAt: now - 4 * 86400_000,
      ...meta(),
    },
    {
      id: 'td4',
      title: '晨间深度写作 90 分钟',
      desc: 'AI 音乐课程第 3 章大纲',
      priority: 'low',
      status: 'done',
      completedAt: dayjs().hour(9).minute(41).valueOf(),
      createdAt: now - 86400_000,
      ...meta(),
    },
  ]

  const notes: Note[] = [
    {
      id: 'n1',
      title: '深蓝科技二期 · 交付边界备忘',
      markdown:
        '# 交付边界备忘\n\n## 范围内\n- 平台二期 4 个核心模块\n- 数据迁移脚本\n\n## 范围外\n- 硬件对接（转三期）\n- 定制报表（另行报价）\n\n> 关联客户 @严伟强，款项目前已结清 ¥185,000。',
      tags: ['合同', '深蓝科技'],
      // @提及已迁 links（v15）：归属在下方 links 数组（kind='mention'）
      createdAt: now - 2 * 86400_000,
      ...meta(),
    },
  ]

  /** 关联层种子：笔记 n1 提及客户 c1（mention）+ 流水的客户/项目关联（related）。
   *  确定性 id 与运行期 linkAtoms / syncRelatedLinks 同源。 */
  const links: Link[] = [
    {
      id: buildLinkId({ type: 'notes', id: 'n1' }, { type: 'customers', id: 'c1' }, 'mention'),
      fromType: 'notes',
      fromId: 'n1',
      toType: 'customers',
      toId: 'c1',
      kind: 'mention',
      meta: { label: '严伟强' },
      createdAt: now - 2 * 86400_000,
      ...meta(),
    },
    {
      id: buildLinkId({ type: 'transactions', id: 't1' }, { type: 'customers', id: 'c1' }, 'related'),
      fromType: 'transactions',
      fromId: 't1',
      toType: 'customers',
      toId: 'c1',
      kind: 'related',
      createdAt: now - 1 * 86400_000,
      ...meta(),
    },
    {
      id: buildLinkId({ type: 'transactions', id: 't1' }, { type: 'projects', id: 'p1' }, 'related'),
      fromType: 'transactions',
      fromId: 't1',
      toType: 'projects',
      toId: 'p1',
      kind: 'related',
      createdAt: now - 1 * 86400_000,
      ...meta(),
    },
    {
      id: buildLinkId({ type: 'transactions', id: 't3' }, { type: 'customers', id: 'c2' }, 'related'),
      fromType: 'transactions',
      fromId: 't3',
      toType: 'customers',
      toId: 'c2',
      kind: 'related',
      createdAt: now - 2 * 86400_000,
      ...meta(),
    },
  ]

  const quickNotes: QuickNote[] = [
    {
      id: 'qn1',
      content: '灵感：给课程学员做一个「AI 旋律生成器」小工具作为赠品',
      createdAt: now - 3600_000,
      ...meta(),
    },
  ]

  const habits: Habit[] = [
    {
      id: 'h1',
      name: '深度专注',
      icon: 'psychology',
      color: '#2563eb',
      category: '工作',
      schedule: '每日',
      targetMinutes: 25,
      motivationNote: '专注力是自由职业者唯一的护城河',
      crossModuleSync: true,
      createdAt: now - 60 * 86400_000,
      ...meta(),
    },
    {
      id: 'h2',
      name: '客户跟进',
      icon: 'handshake',
      color: '#0f6e56',
      category: '商务',
      schedule: '每日',
      targetMinutes: 15,
      motivationNote: '每一条线索都值得被认真对待',
      crossModuleSync: true,
      createdAt: now - 45 * 86400_000,
      ...meta(),
    },
    {
      id: 'h3',
      name: '睡前复盘',
      icon: 'edit_note',
      color: '#854f0b',
      category: '成长',
      schedule: '每日',
      targetMinutes: 10,
      motivationNote: '不总结，就没有积累',
      crossModuleSync: false,
      createdAt: now - 30 * 86400_000,
      ...meta(),
    },
  ]

  const projects: Project[] = [
    {
      id: 'p1',
      name: '深蓝科技二期交付',
      color: '#004ac6',
      status: 'active',
      customerId: 'c1',
      budget: 300000,
      note: '平台二期 4 个核心模块 + 数据迁移，长期项目，持续跟进到验收',
      createdAt: now - 30 * 86400_000,
      ...meta(),
    },
    {
      id: 'p2',
      name: 'AI 音乐课程开发',
      color: '#6d43c4',
      status: 'active',
      note: '资料聚合型项目：课程大纲、素材与灵感都归到这里',
      createdAt: now - 15 * 86400_000,
      ...meta(),
    },
  ]

  const milestones: ProjectMilestone[] = [
    {
      id: 'ms1',
      projectId: 'p1',
      name: '需求评审定稿',
      weight: 2,
      status: 'done',
      sortOrder: 0,
      createdAt: now - 30 * 86400_000,
      ...meta(),
    },
    {
      id: 'ms2',
      projectId: 'p1',
      name: '核心模块开发',
      weight: 3,
      status: 'inProgress',
      sortOrder: 1,
      createdAt: now - 30 * 86400_000,
      ...meta(),
    },
    {
      id: 'ms3',
      projectId: 'p1',
      name: '验收与回签',
      weight: 2,
      status: 'planned',
      sortOrder: 2,
      dueAt: now + 30 * 86400_000,
      createdAt: now - 30 * 86400_000,
      ...meta(),
    },
  ]

  const trophy: Omit<Trophy, 'id'>[] = [
    {
      name: '首笔大额回款',
      tier: '金',
      rarity: '8.1%',
      description: '单笔项目款首次突破 5 位数',
      icon: 'emoji_events',
      unlockedAt: now - 86400_000,
      conditionType: 'transactions_total',
      conditionValue: 1,
      ...meta(),
    },
    {
      name: '21 天稳态达成',
      tier: '白金',
      rarity: '2.3%',
      description: '任一习惯连续打卡 21 天',
      icon: 'military_tech',
      unlockedAt: now - 3 * 86400_000,
      conditionType: 'habit_streak',
      conditionValue: 21,
      ...meta(),
    },
    {
      name: '笔记开张',
      tier: '铜',
      rarity: '43.7%',
      description: '创建第一篇笔记',
      icon: 'description',
      unlockedAt: now - 60 * 86400_000,
      ...meta(),
    },
  ]
  const trophies: Trophy[] = trophy.map((t, i) => ({ ...t, id: `tr${i + 1}` }))

  await db.transaction(
    'rw',
    [
      db.workspaces,
      db.customers,
      db.interactions,
      db.ledgers,
      db.transactions,
      db.todos,
      db.notes,
      db.links,
      db.quickNotes,
      db.habits,
      db.habitLogs,
      db.trophies,
      db.projects,
      db.projectMilestones,
      db.meta,
    ],
    async () => {
      await db.workspaces.put(workspace)
      await db.customers.bulkPut(customers)
      await db.interactions.bulkPut(interactions)
      await db.ledgers.bulkPut(ledgers)
      await db.transactions.bulkPut(transactions)
      await db.todos.bulkPut(todos)
      await db.notes.bulkPut(notes)
      await db.links.bulkPut(links)
      await db.quickNotes.bulkPut(quickNotes)
      await db.habits.bulkPut(habits)
      await db.habitLogs.bulkPut(
        habits.map((h, i): HabitLog => ({
          id: habitLogId(h.id, today),
          habitId: h.id,
          date: today,
          completedAt: now - i * 600_000,
          ...meta(),
        })),
      )
      await db.trophies.bulkPut(trophies)
      await db.projects.bulkPut(projects)
      await db.projectMilestones.bulkPut(milestones)
      await db.meta.put({ key: 'seeded', value: now })
    },
  )
  return true
}

/* ────────────────── 演示关系自愈（2026-10-14） ────────────────── */

/** 种子演示客户的固定 id：下面自愈逻辑的**唯一**作用范围（真实用户的库里不会有这些 id） */
export const SEED_DEMO_CUSTOMER_IDS = ['c1', 'c2', 'c3'] as const

/**
 * 补齐老本地库的**演示客户关系**。
 *
 * 为什么需要它：`seedIfEmpty()` 只检查「有没有客户」，所以**更早播种的库永远补不上后来新增的
 * 演示数据**（种子的 relations 是 Issue #123 前后才加的）。表现就是画布上一条线都没有，
 * 而界面上「本来没有关系」和「关系坏了」长得一模一样 —— 这个坑真实吃掉了好几轮排查成本。
 *
 * 安全边界（三重，缺一不做）：
 * ① 只认**应用自己种的那三个 id**（c1/c2/c3）：真实用户库里没有它们 → 直接 no-op；
 * ② 三者必须都存在且未删除，否则认为「这不是这份种子数据」，不动；
 * ③ 三者**当前必须一条关系都没有** —— 只要有任何一条，就认为用户已经自己管过关系，绝不掺和
 *    （幂等：补齐后再跑一次会因第 ③ 条直接返回 0）。
 *
 * 写入一律走 `repositories.addCustomerRelation` —— UI 与 agentOps 的同一入口
 * （双向落两侧 + 同步队列 + 触发同步），不在这里手写盖章/入队。
 *
 * @returns 实际补齐的**关系对数**（0 = 无需补齐/不满足边界）
 */
export async function backfillDemoRelations(): Promise<number> {
  const rows = await Promise.all(SEED_DEMO_CUSTOMER_IDS.map((id) => db.customers.get(id)))
  if (rows.some((c) => !c || c.deleted)) return 0
  if (rows.some((c) => (c!.relations ?? []).length > 0)) return 0

  // 与 seedIfEmpty 里的演示关系**同源**：同一对客户、同一语义、同一归类
  const [c1, c2, c3] = SEED_DEMO_CUSTOMER_IDS
  const pairs: [string, string, string, RelationCategory][] = [
    [c1, c2, '项目合作', 'project'],
    [c2, c3, '转介绍人', 'person'],
    [c1, c3, '同行伙伴', 'person'],
  ]
  for (const [a, b, label, category] of pairs) {
    await addCustomerRelation(a, b, label, category)
  }
  return pairs.length
}
