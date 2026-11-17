import { useLayoutEffect } from 'react'
import { MODULE_THEMES, moduleForPath } from './moduleTheme'

/** 挂在 body 让 portal 浮层也继承模块色；退出应用壳时恢复用户的全局强调色。 */
export function useModuleTheme(pathname: string) {
  const module = moduleForPath(pathname)
  useLayoutEffect(() => {
    const body = document.body
    body.classList.add('module-theme')
    body.dataset.module = module
    body.style.setProperty('--module-light', MODULE_THEMES[module].light)
    body.style.setProperty('--module-dark', MODULE_THEMES[module].dark)
    return () => {
      body.classList.remove('module-theme')
      delete body.dataset.module
      body.style.removeProperty('--module-light')
      body.style.removeProperty('--module-dark')
    }
  }, [module])
}
