/**
 * 演示数据播种（线上环境）
 *
 * ⚠️ 这不是测试：它是给演示环境造一套**覆盖全部业务模块**的样例数据，让每个页面打开都有内容，
 * 且各模块之间互相有关联（体现「一体化」而不是一堆孤立记录）。
 * 放在 __tests__ 下只是为了复用 vitest 的 TS 运行时与 e2e.harness 的 MCP 客户端（零额外依赖）；
 * 未提供环境变量时自动 skip，不污染默认 CI。
 *
 * 运行：
 *   WORKHUB_ONLINE_URL=ws://8.153.19.221:9001/relay WORKHUB_ONLINE_TOKEN=<token> \
 *   npx vitest run src/agent/__tests__/demoSeed.online.test.ts
 *
 * 覆盖不到的：**习惯 / 习惯打卡 / 待办清单** —— habit 与 todoList 没有对应的 agentOps 工具，
 * 无法经 MCP 创建，改由桥侧脚本直接写入浏览器本地库（打卡仍走 `habit_checkin` 正规路径）。
 *
 * 数据会先落浏览器 IndexedDB，再由同步引擎推到线上 PocketBase。
 */
import { describe, it, beforeAll } from 'vitest'
import { installWebSocketGlobal, McpClient, type ReadEnvelope } from './e2e.harness'
import { makeInvoker } from './sweep.cases'

const ONLINE_URL = process.env.WORKHUB_ONLINE_URL ?? ''
const ONLINE_TOKEN = process.env.WORKHUB_ONLINE_TOKEN ?? ''
const ONLINE = Boolean(ONLINE_URL && ONLINE_TOKEN)

const DAY = 86_400_000
/** 相对今天的日期（YYYY-MM-DD） */
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)
/** 相对今天的时间戳 */
const ts = (offset: number) => Date.now() + offset * DAY

type R = { ok: boolean; text: string; data: unknown }

describe.skipIf(!ONLINE)('演示数据播种（线上）', () => {
  let mcp: McpClient

  beforeAll(async () => {
    installWebSocketGlobal()
    mcp = await McpClient.open(ONLINE_URL)
    await mcp.initialize(ONLINE_TOKEN)
  }, 60_000)

  it('造一套覆盖全模块、互相有关联的样例数据', async () => {
    const call = makeInvoker(mcp)
    const ids: Record<string, string> = {}
    const log: string[] = []

    const must = (r: R, what: string): Record<string, string> => {
      if (!r.ok) throw new Error(`${what} 失败：${r.text.slice(0, 160)}`)
      return r.data as Record<string, string>
    }

    /* ==================== 1. 客户（含决策角色） ==================== */
    const customers: { key: string; args: Record<string, unknown> }[] = [
      { key: 'chen', args: { name: '陈致远', company: '星野科技', title: '品牌总监', decisionLevel: '决策人', tags: ['重点客户', '长期合作'], phone: '13800000001', wechat: 'chen_zy' } },
      { key: 'lin', args: { name: '林晓棠', company: '云上文创', title: '内容主理人', decisionLevel: '影响者', tags: ['转介绍'] } },
      { key: 'zhao', args: { name: '赵屹峰', company: '启衡咨询', title: '合伙人', decisionLevel: '把关人', tags: ['咨询'] } },
      { key: 'zhou', args: { name: '周敏', company: '南禾文化', title: '项目经理', decisionLevel: '使用者' } },
      { key: 'wu', args: { name: '吴迪', company: '蓝湖数据', title: '市场负责人', decisionLevel: '决策人', tags: ['竞品调研'] } },
      { key: 'sun', args: { name: '孙博', company: '极光传媒', title: '创意总监', decisionLevel: '影响者', tags: ['VIP'] } },
      { key: 'qian', args: { name: '钱琳', company: '麦田教育', title: '市场经理', decisionLevel: '使用者', tags: ['VIP', '华东'] } },
      { key: 'he', args: { name: '何军', company: '潮汐科技', title: '技术负责人', decisionLevel: '把关人', tags: ['长期合作'] } },
      { key: 'lu', args: { name: '陆一鸣', company: '橙子影视', title: '制片人', decisionLevel: '决策人', tags: ['重点客户'] } },
      { key: 'tan', args: { name: '谭雅', company: '云翼航空', title: '品牌经理', decisionLevel: '影响者', tags: ['华东'] } },
      { key: 'fan', args: { name: '范伟', company: '星辰互娱', title: '商务总监', decisionLevel: '决策人', tags: ['转介绍', '华东'] } },
      { key: 'xu', args: { name: '徐宁', company: '木棉设计', title: '主理人', decisionLevel: '使用者', tags: ['竞品调研'] } },
    ]
    for (const c of customers) {
      const d = must(await call('crm_createCustomer', c.args), `建客户 ${String(c.args.name)}`)
      ids[c.key] = d.customerId
    }
    log.push(`客户 ${customers.length} 个`)

    /* ==================== 2. 客户关系（双向落两侧，构成关系网） ==================== */
    for (const [a, b, label, category] of [
      ['chen', 'lin', '转介绍人', 'person'],
      ['zhao', 'zhou', '同一公司', 'person'],
      ['chen', 'wu', '竞对参照', 'other'],
    ] as const) {
      must(await call('crm_addRelation', { customerId: ids[a], targetId: ids[b], label, category }), `关系 ${label}`)
    }
    log.push('客户关系 3 条（转介绍 / 同一公司 / 竞对参照）')

    /* ==================== 3. 沟通日志（时间线的素材） ==================== */
    for (const [k, content] of [
      ['chen', '二期合同付款节点沟通，对方希望分两笔'],
      ['chen', '品牌升级需求评审，确认主视觉方向'],
      ['lin', '年度合作方案反馈，希望增加短视频条数'],
      ['zhao', '内训需求访谈，覆盖 3 个部门约 40 人'],
      ['zhou', '合作意向初步确认，待报价'],
    ] as const) {
      must(await call('crm_addInteraction', { customerId: ids[k], content }), `沟通日志「${content.slice(0, 8)}」`)
    }
    log.push('沟通日志 5 条')

    /* ==================== 4. 健康分档位（演示图谱与健康分） ==================== */
    for (const [k, level] of [['chen', 'T3'], ['lin', 'T2'], ['zhao', 'T2'], ['zhou', 'T1']] as const) {
      must(await call('crm_updateCustomer', { customerId: ids[k], intimacyLevel: level }), `档位 ${k}`)
    }
    log.push('健康分档位 4 个（T3 / T2 / T2 / T1）')

    /* ==================== 5. 项目（含一个已归档） ==================== */
    for (const [k, name, cust, budget] of [
      ['brand', '星野科技品牌升级', 'chen', 120000],
      ['content', '云上文创年度内容合作', 'lin', 80000],
      ['training', '启衡咨询内训方案', 'zhao', 30000],
    ] as const) {
      const d = must(await call('project_createProject', { name, customerId: ids[cust], budget }), `建项目 ${name}`)
      ids[k] = d.projectId
    }
    must(await call('project_updateProject', { projectId: ids.training, status: 'archived' }), '归档内训项目')
    log.push('项目 3 个（2 进行中 / 1 已归档）')

    /* ==================== 6. 待办（四档优先级 × 多状态 × 标签 × 关联 × 逾期） ==================== */
    const todos: { key: string; args: Record<string, unknown> }[] = [
      { key: 't1', args: { title: '星野科技二期合同终稿校对', priority: 'high', customerId: ids.chen, projectId: ids.brand, tags: ['合同', '本周'], dueAt: ts(1) } },
      { key: 't2', args: { title: '云上文创方案预算部分修订', priority: 'high', customerId: ids.lin, projectId: ids.content, tags: ['方案'], dueAt: ts(0) } },
      { key: 't3', args: { title: '季度服务器费用对账', priority: 'mid', tags: ['财务'], dueAt: ts(-2) } },
      { key: 't4', args: { title: '整理启衡内训的课程大纲', priority: 'mid', customerId: ids.zhao, projectId: ids.training, tags: ['内训'] } },
      { key: 't5', args: { title: '给周敏发南禾文化的合作资料', priority: 'low', customerId: ids.zhou } },
      { key: 't6', args: { title: '联系吴迪确认竞品报价区间', priority: 'high', customerId: ids.wu } },
      { key: 't7', args: { title: '预约年度体检', priority: 'low', tags: ['生活'] } },
      { key: 't8', args: { title: '读完《定位》第 4 章', priority: 'none', tags: ['阅读'] } },
      { key: 't9', args: { title: '更新客户关系图谱的配色', priority: 'low', tags: ['产品'] } },
      { key: 't10', args: { title: '清理废弃的测试账本', priority: 'none' } },
      { key: 't11', args: { title: '归档旧版方案文档', priority: 'low' } },
      { key: 't12', args: { title: '晨间深度写作 90 分钟', priority: 'mid', tags: ['习惯'], dueAt: ts(3) } },
      { key: 't13', args: { title: '整理极光传媒的创意 brief', priority: 'high', customerId: ids.sun, tags: ['方案'] } },
      { key: 't14', args: { title: '麦田教育课程方案初稿', priority: 'mid', customerId: ids.qian, dueAt: ts(2), tags: ['方案', '本周'] } },
      { key: 't15', args: { title: '潮汐科技技术对接会', priority: 'high', customerId: ids.he, dueAt: ts(5) } },
      { key: 't16', args: { title: '橙子影视片单筛选', priority: 'low', customerId: ids.lu, tags: ['内容'] } },
      { key: 't17', args: { title: '更新行业观察笔记', priority: 'none', tags: ['阅读'] } },
      { key: 't18', args: { title: '月度对账', priority: 'mid', dueAt: ts(7), tags: ['财务'] } },
    ]
    for (const t of todos) {
      const d = must(await call('todo_createTodo', t.args), `建待办「${String(t.args.title).slice(0, 10)}」`)
      ids[t.key] = d.todoId
    }
    // 三种状态各有留档，让列表与「今天/逾期」视图都有内容
    for (const k of ['t9', 't10', 't12']) must(await call('todo_completeTodo', { todoId: ids[k] }), `完成 ${k}`)
    log.push('待办 18 个（3 已完成 / 1 逾期 / 1 今日到期 / 若干关联客户与项目）')

    /* ==================== 7. 笔记文件夹 + 笔记 ==================== */
    for (const [k, name] of [['fCustomer', '客户资料'], ['fReview', '项目复盘']] as const) {
      const d = must(await call('note_createFolder', { name }), `建文件夹 ${name}`)
      ids[k] = d.folderId
    }

    const notes: Record<string, unknown>[] = [
      {
        title: '星野科技品牌升级 · 需求评审纪要',
        folderId: ids.fCustomer,
        tags: ['会议', '星野'],
        markdown: `# 需求评审纪要\n\n**参与**：陈致远、设计组\n\n## 核心诉求\n\n1. 主视觉体现「稳定 + 专业」，避免过度年轻化\n2. 官网与物料保持同一套视觉语言\n3. 交付节点卡在季度末\n\n## 待确认\n\n- 是否需要英文版物料\n- 印刷供应商由谁指定\n`,
      },
      {
        title: '云上文创年度合作 · 方案要点',
        folderId: ids.fCustomer,
        tags: ['方案', '云上'],
        markdown: `# 年度内容合作要点\n\n- 短视频 **24 条/年**，季度交付 6 条\n- 图文 12 篇，配合节点排期\n- 预算分四期支付，每期验收后结清\n\n> 对方关注点：产出节奏要可预期，不接受临时改稿。\n`,
      },
      {
        title: 'Q3 项目复盘',
        folderId: ids.fReview,
        tags: ['复盘'],
        markdown: `# Q3 复盘\n\n## 做对的\n\n- 客户分级后跟进优先级清晰了很多\n- 记账与项目挂钩，成本能直接看到\n\n## 要改的\n\n- 待办积压在前两周，后半月空转\n- 沟通日志记了但没回看\n`,
      },
      {
        title: 'AI 音乐行业的三个观察',
        tags: ['行业', '思考'],
        markdown: `# 三个观察\n\n1. **工具平权**：生成能力不再是壁垒，审美与分发才是\n2. **版权链条**：平台自研结算会逐步成为标配\n3. **场景优先**：短剧、广告、游戏语音是最先跑通的场景\n\n---\n\n待补充：与版权平台的结算周期对比\n`,
      },
      {
        title: '极光传媒创意方向探讨',
        folderId: ids.fCustomer,
        tags: ['会议', '极光'],
        markdown: `# 创意方向探讨\n\n**参与**：孙博、创意组\n\n## 三个方向\n\n1. 以「光」为母题的系列视觉\n2. 纪录片式真实质感的短片\n3. 高饱和撞色的年轻化路线\n\n> 孙博倾向方向 1，但要求先出 2 版风格样稿再定。\n`,
      },
      {
        title: '麦田教育合作框架',
        folderId: ids.fCustomer,
        tags: ['方案', '麦田'],
        markdown: `# 合作框架\n\n- 服务周期：一学年，分上下两学期\n- 交付物：品牌手册 + 招生物料 + 线上视觉规范\n- 结算：按学期两期，验收后 15 日内\n\n## 待确认\n\n- 是否需要驻场支持\n- 校区数量与物料分发方式\n`,
      },
      {
        title: '潮汐科技技术对接要点',
        folderId: ids.fCustomer,
        tags: ['会议', '潮汐'],
        markdown: `# 技术对接要点\n\n## 接口约束\n\n- 需要提供 openapi 文档\n- 认证走 OAuth2 客户端凭证模式\n- 沙箱环境与生产环境分离\n\n## 何军强调\n\n> 上线窗口只有两周，接口定稿后不接受变更。\n`,
      },
      {
        title: '橙子影视片单评估',
        folderId: ids.fReview,
        tags: ['内容', '橙子'],
        markdown: `# 片单评估\n\n| 片名 | 类型 | 适配度 |\n|---|---|---|\n| 城市之光 | 都市 | 高 |\n| 山海之间 | 纪录 | 中 |\n| 夜航 | 悬疑 | 待看 |\n\n先推《城市之光》，与陆一鸣约一次试映。\n`,
      },
      {
        title: '云翼航空品牌需求',
        folderId: ids.fCustomer,
        tags: ['需求'],
        markdown: `# 品牌需求\n\n谭雅提出三点：\n\n1. 视觉要体现「安全 + 舒适」，避免过度科技感\n2. 需要一套可延展的辅助图形\n3. 年底前完成主视觉与两条产品线物料\n`,
      },
      {
        title: '星辰互娱商务纪要',
        folderId: ids.fReview,
        tags: ['会议', '星辰'],
        markdown: `# 商务纪要\n\n- 范伟提出后续三个季度有持续投放预算\n- 转介绍来源是林晓棠，需在合同里备注渠道激励\n- 下次沟通带上媒介排期模板\n`,
      },
    ]
    for (const n of notes) must(await call('note_createNote', n), `建笔记「${String(n.title).slice(0, 10)}」`)
    log.push('笔记 10 篇 / 文件夹 2 个')

    /* ==================== 8. 账本 ==================== */
    for (const [k, name, isDefault] of [['company', '对公账户', true], ['personal', '个人卡', false]] as const) {
      const d = must(await call('fin_createLedger', { name, isDefault }), `建账本 ${name}`)
      ids[k] = d.ledgerId
    }
    log.push('账本 2 个（对公账户为默认）')

    /* ==================== 9. 流水（收支 × 状态 × 关联客户 / 项目） ==================== */
    const txns: Record<string, unknown>[] = [
      { summary: '星野科技 · 品牌升级首款', amount: 60000, type: 'income', status: '已结算', ledger: 'company', customer: 'chen', project: 'brand', occurredAt: day(-12), tags: ['项目款'] },
      { summary: '云上文创 · 年度合作定金', amount: 24000, type: 'income', status: '已结算', ledger: 'company', customer: 'lin', project: 'content', occurredAt: day(-9), tags: ['项目款'] },
      { summary: '启衡咨询 · 内训尾款', amount: 30000, type: 'income', status: '待对账', ledger: 'company', customer: 'zhao', occurredAt: day(-3), tags: ['项目款'] },
      { summary: '南禾文化 · 合作预付款', amount: 15000, type: 'income', status: '待对账', ledger: 'company', customer: 'zhou', occurredAt: day(-1) },
      { summary: '老客户转介绍 · 咨询费', amount: 8000, type: 'income', status: '已结算', ledger: 'personal', occurredAt: day(-6) },
      { summary: '云服务器年费续费', amount: 3600, type: 'expense', status: '已结算', ledger: 'company', occurredAt: day(-14), tags: ['固定成本'] },
      { summary: '差旅 · 拜访启衡咨询', amount: 1280, type: 'expense', status: '待对账', ledger: 'personal', customer: 'zhao', occurredAt: day(-5), tags: ['差旅'] },
      { summary: '设计素材订阅', amount: 299, type: 'expense', status: '已结算', ledger: 'personal', occurredAt: day(-8), tags: ['订阅'] },
      { summary: '团队聚餐', amount: 860, type: 'expense', status: '已结算', ledger: 'personal', occurredAt: day(-4) },
      { summary: '办公用品采购', amount: 420, type: 'expense', status: '待对账', ledger: 'company', occurredAt: day(-2) },
      { summary: '域名与证书续费', amount: 480, type: 'expense', status: '已结算', ledger: 'company', occurredAt: day(-10), tags: ['固定成本'] },
      { summary: '快递与打印', amount: 156, type: 'expense', status: '已结算', ledger: 'personal', occurredAt: day(-7) },
    ]
    for (const raw of txns) {
      const t = raw as Record<string, unknown>
      must(
        await call('fin_recordTransaction', {
          summary: t.summary,
          amount: Number(t.amount),
          type: t.type,
          status: t.status,
          occurredAt: t.occurredAt,
          ledgerId: ids[t.ledger as string],
          ...(Array.isArray(t.tags) ? { tags: t.tags } : {}),
          ...(typeof t.customer === 'string' ? { customerId: ids[t.customer] } : {}),
          ...(typeof t.project === 'string' ? { projectId: ids[t.project] } : {}),
        }),
        `记流水「${String(t.summary).slice(0, 12)}」`,
      )
    }
    log.push('流水 12 笔（收入 5 / 支出 7；含待对账 5 笔）')

    /* ==================== 10. 习惯打卡（习惯由桥侧写入本地库，此处走正规打卡路径） ==================== */
    const hb = await call('listHabits', {})
    const habits = (hb.data as ReadEnvelope<{ id: string; name: string }>).items ?? []
    if (!habits.length) {
      log.push('⚠️ 未发现习惯，跳过打卡（习惯需先由桥侧脚本写入浏览器本地库）')
    } else {
      let total = 0
      for (const h of habits) {
        // 每个习惯给不同的连续区间，制造「长连续 / 隔日 / 稀疏」三种热力图形态
        const everyOther = h.name.includes('健身')
        const span = h.name.includes('写作') ? 13 : h.name.includes('阅读') ? 9 : 6
        const sparse = h.name.includes('复盘')
        for (let d = span; d >= 0; d--) {
          if (everyOther && d % 2 === 1) continue
          if (sparse && d % 3 !== 0) continue
          const r = await call('habit_checkin', { habitId: h.id, date: day(-d) })
          if (r.ok) total++
        }
      }
      log.push(`习惯打卡 ${total} 次（覆盖最近 14 天）`)
    }

    console.log('\n===== 演示数据播种完成 =====\n' + log.map((l) => '  · ' + l).join('\n'))
  }, 900_000)
})
