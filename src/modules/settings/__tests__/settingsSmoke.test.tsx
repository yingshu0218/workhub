// @vitest-environment jsdom
import {it,expect,afterEach,vi} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import 'fake-indexeddb/auto'
import SettingsPage from '../SettingsPage'
vi.mock('@/platform/request',()=>({clientRequest:async()=>({items:[]})}))
afterEach(cleanup)
it('五组设置可切换，个人凭据和旧队列核对入口可达',async()=>{
 render(<MemoryRouter><SettingsPage/></MemoryRouter>)
 for(const [label,marker] of [['账号与服务器','服务器地址'],['Agent 接入','独立 Agent 凭据'],['数据与备份','旧客户端待核对数据'],['外观与偏好','界面风格'],['关于','版本信息']]){fireEvent.click(screen.getByRole('button',{name:label}));expect(await screen.findByText(marker,{exact:false})).toBeTruthy()}
 expect(screen.queryByRole('button',{name:'云端同步'})).toBeNull()
})
it('外观仍提供原主题、密度、字体与快捷键',async()=>{
 render(<MemoryRouter><SettingsPage/></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'外观与偏好'}))
 for(const [label,marker] of [['外观与主题','界面风格'],['色彩与密度','圆角与信息密度'],['字体与排版','字体组合'],['通用与快捷键','通用偏好设定']]){fireEvent.click(screen.getByRole('button',{name:label}));expect(await screen.findByText(marker,{exact:false})).toBeTruthy()}
})
