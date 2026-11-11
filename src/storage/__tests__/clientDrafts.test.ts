// @vitest-environment jsdom
import { it, expect } from 'vitest'
import { activateClientSession } from '../clientSession'
import { oldDraftGroups, reviewDraftCopy } from '../clientDrafts'
it('旧世代核对只发现同站点同账号，保留原请求并排除其它身份', () => {
  localStorage.clear()
  const current = activateClientSession('owner-a', 'new', 6)
  const key = (owner: string, generation: string, server = current.server) =>
    'workhub.pending.request:' + encodeURIComponent(JSON.stringify([server, owner, generation, 6]))
  const prior = key('owner-a', 'old')
  localStorage.setItem(
    prior,
    JSON.stringify({ requestId: 'original', generation: 'old', input: 'not submitted' }),
  )
  localStorage.setItem(key('owner-b', 'old'), 'other owner')
  localStorage.setItem(key('owner-a', 'old', 'https://other.test'), 'other server')
  localStorage.setItem('workhub.pending.legacy', 'legacy')
  const groups = oldDraftGroups(current)
  expect(groups.length).toBe(1)
  expect(groups[0].keys).toEqual([prior])
  expect(reviewDraftCopy(groups[0]).submitted).toBe(false)
  expect(JSON.stringify(reviewDraftCopy(groups[0]))).toContain('original')
  expect(localStorage.getItem(prior)).toBeTruthy()
})
