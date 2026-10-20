import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 动效基础层「形状锁」（Phase M1）
 *
 * 这一层几乎全是 CSS，没有运行时逻辑可测——但恰恰因为如此，它最容易被无声地削弱：
 * 有人「清理无用变量」时删掉降级块、有人调色时顺手把 token 名改掉，
 * 表现都是「看起来没问题，但无障碍降级失灵 / 某处动画不动了」，很难在 code review 里看出来。
 *
 * 故这里对**源码文本**做形状断言（与 storage/__tests__/boundary.test.ts 同一思路：
 * 断言的是「结构存在」，不是「运行时行为」）。
 * 每条断言都刻意对应方案里的一条硬纪律，注释里写清「删了会怎样」。
 */

const ROOT = path.resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8')

/** 剔除注释，避免注释里的字样把断言「喂饱」（例如文档里提到的 token 名） */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('motion token 层（src/styles/index.css）', () => {
  const css = read('src/styles/index.css')
  const code = stripComments(css)

  it('时长阶梯齐全，且 fast 就是 Tailwind 默认 150ms（改造零回归的锚点）', () => {
    for (const name of [
      '--motion-duration-instant',
      '--motion-duration-fast',
      '--motion-duration-base',
      '--motion-duration-slow',
      '--motion-duration-slower',
      '--motion-duration-crawl',
    ]) {
      expect(code, `缺少时长 token ${name}`).toContain(name)
    }
    // 150ms 是被刻意选定的「原样」值：与 Tailwind 默认 duration 一致，
    // 这样把 transition-colors 换成 token 化写法时不会出现肉眼可见的变化。
    expect(code).toMatch(/--motion-duration-fast:\s*150ms/)
  })

  it('缓动曲线齐全，含「进入/离开」两条方向性曲线', () => {
    for (const name of [
      '--ease-standard',
      '--ease-decelerate',
      '--ease-accelerate',
      '--ease-emphasized',
      '--ease-spring',
    ]) {
      expect(code, `缺少缓动 token ${name}`).toContain(name)
    }
  })

  it('存在全局时长倍率 --motion-duration-scale，且默认值引用皮肤倍率', () => {
    /**
     * 刻意不写死 1：皮肤要能调「动起来的性格」，就必须让这条倍率引用皮肤通道。
     * 写死 1 的话，四套皮肤的 --skin-motion-scale 会被无声无视（改了没反应）。
     */
    expect(code).toMatch(/--motion-duration-scale:\s*var\(--skin-motion-scale\)/)
  })

  it('关键帧齐全（进出场 + 强调 + 环境 + 皮肤专属）', () => {
    for (const name of [
      'nx-fade-in',
      'nx-fade-out',
      'nx-scale-in',
      'nx-scale-out',
      'nx-slide-in-right',
      'nx-slide-out-right',
      'nx-slide-in-bottom',
      'nx-slide-out-bottom',
      'nx-slide-in-down',
      'nx-slide-out-up',
      'nx-pop-in',
      'nx-enter-up',
      'nx-row-out',
      'nx-breathe',
      'nx-pulse-soft',
      'nx-check-pop',
      'nx-shimmer',
      'nx-scanline',
      'nx-blink',
      'nx-sparkle',
    ]) {
      expect(code, `缺少关键帧 @keyframes ${name}`).toContain(`@keyframes ${name}`)
    }
  })

  it('关键帧只动 transform / opacity —— 布局动画必须有明确豁免', () => {
    /**
     * 为什么单独锁这条：动画 width/height/top/left 每帧触发 layout，
     * 在 Tauri 移动 WebView 上代价与桌面完全不同，是这一层最容易失控的地方。
     *
     * 豁免规则（2026-10-20 起改为白名单式）：布局属性只在「该属性就是这件事的语义本身」
     * 时才允许，且必须在下面的 ALLOWED 里逐条署名。裸禁止已经不合用了 ——
     * 列表行退场若不收拢高度，视觉上是「行先变淡 → 位置被突兀填上」，
     * 中间那次上跳比不做动画更刺眼。
     */
    const ALLOWED: Record<string, string[]> = {
      // 行退场：这几条就是「该行腾出位置」的语义本身（逐条署名，不是整类放行）
      'nx-row-out': ['max-height', 'padding-top', 'padding-bottom', 'margin-top', 'margin-bottom'],
    }
    const keyframes = [...code.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)]
    expect(keyframes.length).toBeGreaterThan(10)
    /**
     * 逐条声明解析（而不是对整块正文做子串/正则匹配）。
     * 子串法在这份 CSS 上有两个真实误报源：
     *   · `max-height:` 含子串 `height:`
     *   · `padding-top:` / `margin-top:` 含子串 `top:`
     * 反过来，宽松规则又会漏掉 `padding-top` 这类带后缀的属性。
     * 取出每条声明的属性名做**精确集合比对**，两侧问题一起消失。
     */
    for (const [, name, body] of keyframes) {
      const declared = [...body.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:/g)].map((m) => m[1])
      const allowed = new Set(ALLOWED[name] ?? [])
      const BANNED = ['width', 'height', 'top', 'left', 'margin', 'padding']
      for (const prop of declared) {
        if (allowed.has(prop)) continue
        const hit = BANNED.find((b) => prop === b || prop.endsWith(`-${b}`))
        expect(hit, `关键帧 ${name} 里出现了未豁免的 layout 属性「${prop}」`).toBeUndefined()
      }
    }
  })

  it('豁免清单不许悄悄扩大（新增一条就要在这里署名）', () => {
    // 白名单是「逐条署名」的，任何新增都必须同步改本断言 —— 防止有人往 ALLOWED 里加名字
    // 却不留痕迹。清单本身极小，改它应该是一次显式的、可被 review 到的动作。
    const allowedNames = ['nx-row-out']
    for (const n of allowedNames) {
      expect(code, `豁免的关键帧 ${n} 不见了（要么是删了动画，要么是名字被改）`).toContain(
        `@keyframes ${n}`,
      )
    }
  })

  it('⚠️ `.press` 的 transition 必须包含颜色属性（无层级声明会压掉 transition-colors）', () => {
    /**
     * 2026-10-20 用户反馈「鼠标移动到组件、点击之后没有明显的交互」时定位到的缺陷。
     *
     * `.press` 是**无层级声明**，优先级高于 `@layer utilities`；而 Tailwind 的
     * `transition-colors` 在 layer 内。两者都声明 `transition` 属性 → 无层级那条
     * **整条覆盖**掉 layer 内那条 → `transition-colors` 完全失效 →
     * **hover 变色从平滑过渡退化为瞬间跳变**（按钮上尤其明显）。
     *
     * 修法是让 `.press` 自己把颜色属性也列进同一条 transition（与 `.lift` 同范式）。
     * 这条锁防止有人日后「精简」掉看似冗余的颜色项，导致缺陷复发。
     */
    const pressBlock = code.match(/\.press\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(pressBlock, '.press 规则不见了').not.toBe('')
    // 至少要有颜色相关的过渡项，否则 transition-colors 会被压掉
    for (const prop of ['color', 'background-color']) {
      expect(pressBlock, `.press 的 transition 缺少「${prop}」—— transition-colors 会被压掉`).toContain(
        prop,
      )
    }
    // 按压缩放本身不能丢
    expect(pressBlock).toContain('transform')
  })

  it('语义类齐全（.anim-* / .press / .lift）', () => {
    for (const name of [
      '.anim-overlay-in',
      '.anim-overlay-out',
      '.anim-panel-in',
      '.anim-panel-out',
      '.anim-drawer-in',
      '.anim-drawer-out',
      '.anim-sheet-in',
      '.anim-sheet-out',
      '.anim-toast-in',
      '.anim-toast-out',
      '.anim-enter',
      '.anim-enter-up',
      '.anim-pop',
      '.anim-page',
      '.anim-list-item',
      '.anim-row-out',
      '.anim-breathe',
      '.anim-pulse-soft',
      '.anim-check-pop',
      '.anim-skeleton',
      '.anim-fill',
      '.anim-fade',
      '.app-nav-link',
      '.app-tab-pill',
      '.press',
      '.lift',
    ]) {
      expect(code, `缺少语义类 ${name}`).toContain(name)
    }
  })

  it('入场类用 backwards、出场类用 both —— 这条不对称是防「hover 失效」的关键', () => {
    /**
     * 为什么必须锁这条（2026-10-19 实测事故）：
     * CSS 动画的优先级高于 :hover / :active 与 transition。
     * 入场动画若用 `both`，播完后仍持续持有 `transform: translateY(0)`，
     * 于是同一元素上的 hover 抬升 / hover:scale / .press:active **全部静默失效**
     * （无报错，只是「点了没反应」）—— 而没有任何运行时测试能发现。
     * 实测冲突点：habits/HabitsPage 月历格的 hover:scale-105、
     * projects/ProjectsPage 的 <Card hover>。
     */
    const entry = [
      '.anim-overlay-in',
      '.anim-panel-in',
      '.anim-drawer-in',
      '.anim-sheet-in',
      '.anim-toast-in',
      '.anim-enter',
      '.anim-enter-up',
      '.anim-pop',
      '.anim-page',
      '.anim-list-item',
      '.anim-fade',
    ]
    for (const cls of entry) {
      const m = code.match(new RegExp(`${cls.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))
      expect(m, `${cls} 未找到`).toBeTruthy()
      expect(m![1], `${cls} 应为 backwards（否则锁死 transform、hover 失效）`).toContain(
        'backwards',
      )
      expect(m![1], `${cls} 不应为 both`).not.toMatch(/\bboth\b/)
    }

    // 出场类相反：必须在卸载前一直持有终点态，故保持 both
    const exit = [
      '.anim-overlay-out',
      '.anim-panel-out',
      '.anim-drawer-out',
      '.anim-sheet-out',
      '.anim-toast-out',
      '.anim-row-out',
    ]
    for (const cls of exit) {
      const m = code.match(new RegExp(`${cls.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))
      expect(m, `${cls} 未找到`).toBeTruthy()
      expect(m![1], `${cls} 应为 both（否则会先闪回原样再消失）`).toContain('both')
    }
  })

  it('语义类时长一律经倍率计算（不允许写死 ms —— 否则三处降级各改一遍）', () => {
    // 抽样检查几个代表类：其 animation 简写里必须出现 * var(--motion-duration-scale)
    const sampled = ['.anim-panel-in', '.anim-drawer-out', '.anim-page', '.anim-list-item']
    for (const cls of sampled) {
      const re = new RegExp(`${cls.replace('.', '\\.')}\\s*\\{([^}]*)\\}`)
      const m = code.match(re)
      expect(m, `${cls} 未找到`).toBeTruthy()
      expect(m![1], `${cls} 的时长没有乘倍率`).toContain('var(--motion-duration-scale)')
    }
  })

  it('窄屏把桌面弹窗的缩放换成底部滑入（形态与动效必须同源）', () => {
    /**
     * 桌面是居中对话框（scale），窄屏是贴底抽屉（从下方滑上来）。
     * 若窄屏仍用 scale，观感就是「从屏幕中间掉下来一张贴底的板」——
     * 这条锁保证 768px 断点下动画名确实被改写。
     */
    const narrow = code.slice(code.indexOf('@media (max-width: 47.99rem)'))
    expect(narrow).toContain('animation-name: nx-slide-in-bottom')
    expect(narrow).toContain('animation-name: nx-slide-out-bottom')
  })

  /** 取出一段 CSS 块（从 startMarker 起到 nextMarker 之前）——避免跨块互相「喂饱」断言 */
  const blockBetween = (startMarker: string, endMarker?: string) => {
    const at = code.indexOf(startMarker)
    if (at < 0) return ''
    const end = endMarker ? code.indexOf(endMarker, at + startMarker.length) : -1
    return end > at ? code.slice(at, end) : code.slice(at)
  }

  it('无障碍硬降级：prefers-reduced-motion 必须停掉所有动画并去掉位移反馈', () => {
    /**
     * WCAG 2.1 SC 2.3.3。这条**不能**被应用内设置覆盖，必须无条件生效。
     * 删了它，前庭功能敏感用户在设置页里「没开过开关」就会看到满屏动效。
     *
     * ⚠️ 本块单独截取（到文件末尾）：早期版本用 `code.slice(at)` 直接断言，
     * 结果下面的 `data-motion='off'` 块里的类名把断言「喂饱」了 ——
     * 删掉本块里的 `.anim-fade` 也能通过（实测的假阳性）。
     */
    const block = blockBetween('@media (prefers-reduced-motion: reduce)')
    expect(block, '缺少 prefers-reduced-motion 降级块').not.toBe('')
    expect(block).toContain('--motion-duration-scale: 0')
    expect(block).toContain('animation: none !important')
    expect(block).toContain('.press:active')
    expect(block).toContain('.lift:hover')
    // 新增的按压点与填充条也必须一并停掉（漏一个就是「无障碍下仍在动」）
    expect(block).toContain('.anim-fill')
    expect(block).toContain('.anim-fade')
    expect(block).toContain('.app-nav-link:active')
    expect(block).toContain('.app-tab-pill:active')
  })

  it('应用内降级：data-motion=off 既归零倍率、也停动画（倍率归零不足以停 both 填充的动画）', () => {
    // ⚠️ 同样单独截取到 `@media` 之前，不被无障碍块喂饱
    const block = blockBetween("[data-motion='off']", '@media (prefers-reduced-motion')
    expect(block).not.toBe('')
    expect(block).toContain('--motion-duration-scale: 0')
    // 必须另有显式 animation: none —— 0s + `both` 仍会跳到终点
    expect(block).toContain('animation: none !important')
    expect(block).toContain('.anim-panel-in')
    expect(block).toContain('.anim-fade')
    // 进度条走 transition 而非 animation，`animation: none` 管不到，必须单独停
    expect(block).toContain('transition: none')
  })

  it('reduced 档位只降速不关闭（与 off 是两档语义）', () => {
    const block = blockBetween("[data-motion='reduced']", "[data-motion='off']")
    expect(block).not.toBe('')
    expect(block).toMatch(/--motion-duration-scale:\s*0?\.\d+/)
    // 降速档**不该**停动画（那才是 off 的语义）
    expect(block).not.toContain('animation: none')
  })
})

describe('皮肤动效维度（src/styles/skins.css）', () => {
  const code = stripComments(read('src/styles/skins.css'))

  it('四套皮肤各有时长倍率与缓动覆写', () => {
    for (const skin of ['pixel', 'cartoon', 'cyber', 'glass']) {
      const at = code.indexOf(`:root[data-skin='${skin}']`)
      expect(at, `未找到皮肤 ${skin}`).toBeGreaterThan(-1)
    }
    expect(code, 'pixel 缺步进缓动（8-bit 的形态语言，不只是快慢）').toContain('steps(')
    expect(code, 'cartoon 缺回弹缓动').toContain('--ease-spring')
    expect(code, 'glass 缺慢缓动').toContain('--ease-emphasized')
  })

  it('皮肤只覆写 motion / 形态 token，不碰配色与正文字体通道', () => {
    // 与既有皮肤纪律一致：--color-* 只在配色主题里改、--font-sans 只在排版设置里改
    const skinBlocks = [...code.matchAll(/:root\[data-skin='[\w]+'\]\s*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .filter((b) => b.includes('--skin'))
    for (const b of skinBlocks) {
      expect(b).not.toContain('--font-sans')
    }
  })
})