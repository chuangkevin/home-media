import assert from 'node:assert/strict'
import test from 'node:test'
import { RadioJoinRequests } from '../../src/services/radio-join-requests'

test('a cancelled join reply cannot be treated as a retry of the same station succeeding', () => {
  const requests = new RadioJoinRequests()
  const first = requests.start('A')
  assert.equal(requests.cancel(first), true)
  const retry = requests.start('A')
  const lateReply = requests.settle('A')
  assert.equal(lateReply?.id, first)
  assert.equal(lateReply?.cancelled, true)
  const retryReply = requests.settle('A')
  assert.equal(retryReply?.id, retry)
  assert.equal(retryReply?.cancelled, false)
})

test('a cancelled A reply cannot complete a subsequent join to B', () => {
  const requests = new RadioJoinRequests()
  const first = requests.start('A')
  requests.cancel(first)
  const second = requests.start('B')
  assert.equal(requests.settle('A')?.cancelled, true)
  assert.equal(requests.settle('B')?.id, second)
})

test('a late error belongs to the cancelled request rather than its retry', () => {
  const requests = new RadioJoinRequests()
  const first = requests.start('A')
  requests.cancel(first)
  const retry = requests.start('A')
  assert.deepEqual(requests.settle(), { id: first, stationId: 'A', cancelled: true })
  assert.deepEqual(requests.settle(), { id: retry, stationId: 'A', cancelled: false })
})

test('disconnect drops old attempts and identifiers remain distinct on reconnect', () => {
  const requests = new RadioJoinRequests()
  const old = requests.start('A')
  requests.clear()
  assert.equal(requests.settle('A'), undefined)
  assert.equal(requests.cancel(old), false)
  const next = requests.start('A')
  assert.notEqual(next, old)
  assert.equal(requests.settle('A')?.id, next)
})
