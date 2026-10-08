import assert from 'node:assert/strict'
import test from 'node:test'

test('join observers survive sync callback replacement, cancel late replies, and unsubscribe', async (t) => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
  const { socketService } = await import('../../src/services/socket.service')
  const handlers = new Map<string, (...args: any[]) => void>()
  const commands: string[] = []
  // Install an in-memory transport at the service boundary; no server/network.
  const transport = socketService as unknown as {
    socket: unknown
    setupEventListeners: () => void
    autoReconnectRadio: () => void
  }
  transport.socket = {
    on: (name: string, handler: (...args: any[]) => void) => handlers.set(name, handler),
    emit: (name: string) => commands.push(name),
  }
  transport.setupEventListeners()
  const replies: unknown[] = []
  let synced = 0
  const unsubscribe = socketService.subscribeRadioJoin((event) => replies.push(event))
  socketService.setCallbacks({ onRadioJoined: () => { synced += 1 } })
  socketService.setCallbacks({ onRadioError: () => {} })

  const cancelled = socketService.joinRadioStation('A')
  socketService.cancelRadioJoin(cancelled)
  const retry = socketService.joinRadioStation('A')
  handlers.get('radio:joined')?.({ stationId: 'A' })
  assert.equal(synced, 0, 'a cancelled late reply must not start synchronized playback')
  assert.equal(replies.length, 0)
  handlers.get('radio:joined')?.({ stationId: 'A' })
  assert.equal(synced, 1)
  assert.deepEqual(replies, [{ type: 'joined', requestId: retry, stationId: 'A' }])
  assert.deepEqual(commands.slice(0, 3), ['radio:join', 'radio:leave', 'radio:join'])

  const failed = socketService.joinRadioStation('missing')
  handlers.get('radio:error')?.({ message: '找不到電台' })
  assert.deepEqual(replies[1], { type: 'error', requestId: failed, message: '找不到電台' })
  unsubscribe()
  handlers.get('disconnect')?.()
  assert.equal(replies.length, 2, 'unmounted observers must not receive later events')

  const beforeCleanup = commands.length
  values.set('radio_host_data', JSON.stringify({ stationName: '目前的 DJ 電台' }))
  socketService.clearRadioJoinIntent()
  assert.equal(commands.length, beforeCleanup, 'failure cleanup must not leave or close an existing station')
  assert.equal(values.has('radio_listener_data'), false)
  assert.equal(values.has('radio_host_data'), true, 'failed joins must preserve the current host intent')

  t.mock.timers.enable({ apis: ['setTimeout'] })
  values.delete('radio_host_data')
  values.set('radio_listener_data', JSON.stringify({ stationId: 'A' }))
  transport.autoReconnectRadio()
  t.mock.timers.tick(500) // Restore intent is captured; the discovery delay is still pending.
  const manual = socketService.joinRadioStation('A')
  socketService.cancelRadioJoin(manual)
  const joinsAfterCancel = commands.filter((command) => command === 'radio:join').length
  t.mock.timers.tick(500)
  assert.equal(commands.filter((command) => command === 'radio:join').length, joinsAfterCancel,
    'a reconnect timer scheduled before cancellation must not issue a fresh join')
})
