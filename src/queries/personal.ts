import { useCallback, useEffect, useRef, useState } from 'react'
import { queryPersonal } from '@/domain/personal'
export type Value = Record<string, unknown>
export interface PersonalPage extends Value {
  items: Value[]
  nextCursor?: string | null
  generation: string
  truncated?: boolean
  cached?: boolean
}
export function usePersonalQuery(name: string, input: Value = {}, enabled = true) {
  const key = JSON.stringify(input)
  const [data, setData] = useState<PersonalPage>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0)
  const lifecycle = useRef({ version: 0, paging: false, identity: '' }).current
  const requestKey = JSON.stringify([name, key, enabled, refresh])
  if (lifecycle.identity !== requestKey) {
    lifecycle.identity = requestKey
    lifecycle.version++
    lifecycle.paging = false
  }
  const reload = useCallback(() => {
    lifecycle.version++
    lifecycle.paging = false
    setData(undefined)
    setError('')
    setRefresh((n) => n + 1)
  }, [lifecycle])
  useEffect(() => {
    const changed = () => reload()
    window.addEventListener('workhub:changed', changed)
    return () => {
      lifecycle.version++
      window.removeEventListener('workhub:changed', changed)
    }
  }, [reload, lifecycle])
  useEffect(() => {
    const started = ++lifecycle.version
    lifecycle.paging = false
    setData(undefined)
    setError('')
    setLoading(enabled)
    if (!enabled) return
    void queryPersonal(name, JSON.parse(key))
      .then((result) => {
        if (started === lifecycle.version) setData(result as PersonalPage)
      })
      .catch((e) => {
        if (started === lifecycle.version) {
          setData(undefined)
          setError(String(e.message || e))
        }
      })
      .finally(() => {
        if (started === lifecycle.version) setLoading(false)
      })
    return () => {
      lifecycle.version++
    }
  }, [name, key, enabled, refresh, lifecycle])
  async function more() {
    if (!data?.nextCursor || loading || lifecycle.paging || !enabled) return
    const started = lifecycle.version
    lifecycle.paging = true
    setLoading(true)
    try {
      const next = (await queryPersonal(name, {
        ...JSON.parse(key),
        cursor: data.nextCursor,
        generation: data.generation,
      })) as PersonalPage
      if (started === lifecycle.version) setData({ ...next, items: [...data.items, ...next.items] })
    } catch (e) {
      if (started === lifecycle.version) {
        setData(undefined)
        setError(String(e))
      }
    } finally {
      if (started === lifecycle.version) {
        lifecycle.paging = false
        setLoading(false)
      }
    }
  }
  return { data, error, loading, reload, more }
}
