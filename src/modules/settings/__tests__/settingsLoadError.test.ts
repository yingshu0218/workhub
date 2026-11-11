// @vitest-environment jsdom
import {it,expect,vi,afterEach} from 'vitest'
import {render,screen,cleanup} from '@testing-library/react'
import {createElement} from 'react'
const {get}=vi.hoisted(()=>({get:vi.fn()}))
vi.mock('@/repositories/localAdmin',()=>({settingsRepo:{get,save:vi.fn()}}))
import PreferencesPanel from '../PreferencesPanel'
afterEach(cleanup)
it('偏好读取失败显示原因，默认主题仍可见',async()=>{get.mockRejectedValue(new Error('IndexedDB blocked'));render(createElement(PreferencesPanel));expect((await screen.findByRole('alert')).textContent).toContain('IndexedDB blocked');expect(screen.getByText('界面风格')).toBeTruthy()})
