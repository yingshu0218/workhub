/**
 * 最小 RFC6455 WebSocket 服务端（Node 内置模块实现，零新增依赖）
 *
 * 为什么手写而不引 `ws`：方案 §10.4 验收要求「桥不 import 任何厂商 SDK」、
 * §A1 对码确认 `package.json` 零服务端依赖。relay 只需要「文本帧 + ping/pong + close」，
 * 用 node:http 升级握手 + node:crypto 校验，覆盖面足够且可被 Node 24 内置 WebSocket 客户端实测。
 *
 * 范围限定（首版）：只服务文本帧；不支持扩展协商（拒绝 permessage-deflate）；
 * 支持客户端掩码解帧、分片续帧、ping/pong 心跳、close 握手。
 */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 计算 Sec-WebSocket-Accept */
export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64')
}

/** 单条连接：把二进制流解成 message 事件，提供 send/close */
class WsConnection extends EventEmitter {
  constructor(socket) {
    super()
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.fragments = []
    this.fragmentOpcode = 0
    this.closed = false
    this.alive = true
    socket.on('data', (chunk) => this.#onData(chunk))
    socket.on('error', (e) => this.#fail(e))
    socket.on('close', () => {
      if (!this.closed) {
        this.closed = true
        this.emit('close')
      }
    })
  }

  #fail(err) {
    if (!this.closed) {
      this.closed = true
      this.emit('error', err)
      this.emit('close')
      this.socket.destroy()
    }
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    // 循环解帧（一次 data 可能含多帧或半帧）
    for (;;) {
      const frame = this.#readFrame()
      if (!frame) return
      this.#handleFrame(frame)
      if (this.closed) return
    }
  }

  /** 尝试从缓冲区读一帧；数据不足返回 null */
  #readFrame() {
    const buf = this.buffer
    if (buf.length < 2) return null
    const b0 = buf[0]
    const b1 = buf[1]
    const fin = (b0 & 0x80) !== 0
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f
    let offset = 2
    if (len === 126) {
      if (buf.length < offset + 2) return null
      len = buf.readUInt16BE(offset)
      offset += 2
    } else if (len === 127) {
      if (buf.length < offset + 8) return null
      const big = buf.readBigUInt64BE(offset)
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return this.#fail(new Error('帧过大'))
      len = Number(big)
      offset += 8
    }
    // 客户端 -> 服务端必须掩码（RFC6455 §5.1）
    if (!masked) return this.#fail(new Error('客户端帧必须掩码'))
    if (buf.length < offset + 4) return null
    const mask = buf.subarray(offset, offset + 4)
    offset += 4
    if (buf.length < offset + len) return null
    const payload = Buffer.from(buf.subarray(offset, offset + len))
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
    this.buffer = buf.subarray(offset + len)
    return { fin, opcode, payload }
  }

  #handleFrame({ fin, opcode, payload }) {
    if (opcode === 0x8) {
      this.#sendFrame(0x8, Buffer.alloc(0))
      this.closed = true
      this.emit('close')
      this.socket.end()
      return
    }
    if (opcode === 0x9) {
      this.#sendFrame(0xa, payload)
      return
    }
    if (opcode === 0xa) {
      this.alive = true
      return
    }
    if (opcode === 0x0) {
      // 续帧
      this.fragments.push(payload)
      if (fin) {
        const full = Buffer.concat(this.fragments)
        const op = this.fragmentOpcode
        this.fragments = []
        this.fragmentOpcode = 0
        this.#deliver(op, full)
      }
      return
    }
    // 文本/二进制起始帧
    if (!fin) {
      this.fragmentOpcode = opcode
      this.fragments = [payload]
      return
    }
    this.#deliver(opcode, payload)
  }

  #deliver(opcode, payload) {
    if (opcode === 0x1) this.emit('message', payload.toString('utf8'))
    else if (opcode === 0x2) this.emit('binary', payload)
    // 其它 opcode 忽略
  }

  #sendFrame(opcode, payload) {
    if (this.closed || this.socket.destroyed) return
    const len = payload.length
    let header
    if (len < 126) {
      header = Buffer.alloc(2)
      header[1] = len
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[1] = 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[1] = 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }
    header[0] = 0x80 | opcode // FIN=1，服务端不作掩码
    try {
      this.socket.write(Buffer.concat([header, payload]))
    } catch (e) {
      this.#fail(e)
    }
  }

  /** 发送文本帧 */
  send(text) {
    this.#sendFrame(0x1, Buffer.from(text, 'utf8'))
  }

  ping() {
    this.#sendFrame(0x9, Buffer.alloc(0))
  }

  /** 主动关闭（发送 close 帧并断开） */
  close() {
    if (this.closed) return
    this.#sendFrame(0x8, Buffer.alloc(0))
    this.closed = true
    this.socket.end()
  }
}

/**
 * 启动 WebSocket 服务端。
 * @param {{ port:number, host?:string }} opts
 * @returns {Promise<{ server:import('node:http').Server, connections:Set<WsConnection>, close:()=>Promise<void>, port:number }>}
 */
export function createWsServer({ port, host = '127.0.0.1' }) {
  const connections = new Set()
  const server = createServer((req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Upgrade Required: 请使用 WebSocket 连接（MCP over WS）')
  })

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key']
    const upgrade = String(req.headers.upgrade || '').toLowerCase()
    if (upgrade !== 'websocket' || !key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    )
    socket.setNoDelay(true)
    const conn = new WsConnection(socket)
    connections.add(conn)
    conn.on('close', () => connections.delete(conn))
    server.emit('ws-connection', conn, req)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      resolve({
        server,
        connections,
        port: server.address().port,
        close: () =>
          new Promise((res) => {
            for (const c of connections) c.close()
            server.close(() => res())
          }),
      })
    })
  })
}
