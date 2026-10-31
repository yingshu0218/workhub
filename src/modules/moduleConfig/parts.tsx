/**
 * 功能配置页通用片段（Issue #86）
 * Section = 单个配置域卡片（图标 + 标题 + 说明 + 内容）；Toggle = 应用风格开关。
 * 供各模块配置面板复用：模块内只写配置逻辑，不重复造容器。
 *
 * ⚠️ 审计第三批（2026-11-01）：本文件原有的两份实现**都已收口**到
 * `modules/settings/settingsUi.tsx`，这里只剩转出（facade），不再持有实现：
 * - `Toggle`：两份逐行等价（`h-6 w-11` + `translate-x-[24px]`），保留设置页那份；
 * - `Section`：设置页那份是超集（多可选 `badge`，标题与徽标同处一个 `flex` 行）。
 *   `moduleConfig` 侧只用到「不给 badge」的形态，DOM 上仅多一层只含 `<h3>` 的
 *   `flex items-center gap-2` 容器 —— 单子元素时 `gap` 不生效、块级文本换行位置不变，
 *   故视觉等价（2026-11-01 逐类核对）。
 *
 * 保留本文件（而非让调用方改 import 路径）是为了不牵动配置面板的调用点。
 */
export { Section, Toggle } from '../settings/settingsUi'
