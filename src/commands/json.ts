/** PB JSVM 的 JSONRaw 读取为 UTF-8 字节数组；HTTP/Node 已经是普通 JSON。 */
export function decodePbJson(value: unknown): unknown {
  if (value == null) return null
  if (Array.isArray(value) && !value.length) return null
  if (typeof value === 'string') { try { return JSON.parse(value) as unknown } catch { return value } }
  if (Array.isArray(value) && value.length && value.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255)) {
    try { return JSON.parse(decodeURIComponent(value.map(n => '%' + Number(n).toString(16).padStart(2, '0')).join(''))) as unknown } catch { return value }
  }
  return value
}
