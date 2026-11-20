/**
 * Host self-test checks: metadata, per-check outcomes, isolation, timeout.
 *
 * The fake translator stands in for the real one so these stay offline.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CACHE_HIT_MS,
  SELFTEST_PROBE_TEXT,
  createSelfTest,
  createSelfTestHandler,
} from '../lib/selftest.js'

const CONFIG = Object.freeze({ enabled: true, target: 'zh-Hans', timeoutMs: 8000 })

/** A translator that answers every probe immediately. */
function healthyTranslator() {
  const cache = new Map()
  return {
    async translate(text) {
      if (cache.has(text)) return cache.get(text)
      const translated = `译：${text}`
      cache.set(text, translated)
      return translated
    },
    async probe() {
      return { bing: { ok: true, ms: 12 }, llm: { ok: true, ms: 40 } }
    },
  }
}

test('self-test exposes the four required checks in order', () => {
  const selfTest = createSelfTest({ config: CONFIG, translator: healthyTranslator() })
  assert.deepEqual(selfTest.ids, ['config', 'probe', 'channels', 'cache'])
})

test('self-test passes every check when the translator is healthy', async () => {
  const selfTest = createSelfTest({ config: CONFIG, translator: healthyTranslator() })
  const rows = await selfTest.runAll()
  assert.equal(rows.length, 4)
  for (const row of rows) assert.equal(row.ok, true, `${row.id}: ${row.detail}`)
  assert.match(rows[0].detail, /zh-Hans/)
  const cached = rows.find((row) => row.id === 'cache')
  assert.ok(cached.ms < CACHE_HIT_MS + 200, 'the cached call is fast')
})

test('self-test reports a disabled plugin without touching the network', async () => {
  let called = 0
  const selfTest = createSelfTest({
    config: { ...CONFIG, enabled: false },
    translator: {
      async translate() {
        called += 1
        return '译'
      },
      async probe() {
        called += 1
        return { bing: { ok: true, ms: 1 }, llm: { ok: true, ms: 1 } }
      },
    },
  })
  const row = await selfTest.runOne('config')
  assert.equal(row.ok, false)
  assert.match(row.detail, /enabled=false/)
  assert.equal(called, 0)
})

test('one failing channel row leaves the other checks unaffected', async () => {
  const translator = healthyTranslator()
  translator.probe = async () => ({
    bing: { ok: false, ms: 2000, detail: 'ECONNRESET' },
    llm: { skipped: true, detail: '没有可用的会话上下文' },
  })
  const selfTest = createSelfTest({ config: CONFIG, translator })
  const rows = await selfTest.runAll()
  const channels = rows.find((row) => row.id === 'channels')
  assert.equal(channels.ok, false)
  assert.match(channels.detail, /Bing 失败/)
  assert.match(channels.detail, /模型 跳过/)
  for (const row of rows.filter((entry) => entry.id !== 'channels')) {
    assert.equal(row.ok, true, `${row.id} must still pass`)
  }
})

test('the translation probe fails when both channels returned the original text', async () => {
  const selfTest = createSelfTest({
    config: CONFIG,
    translator: {
      async translate(text) {
        return text
      },
      async probe() {
        return {
          bing: { ok: false, ms: 30, detail: 'HTTP 429' },
          llm: { ok: false, ms: 50, detail: 'TRANSPORT' },
        }
      },
    },
  })
  const row = await selfTest.runOne('probe')
  assert.equal(row.ok, false)
  assert.match(row.detail, /两条通道/)
})

test('a hung check times out alone and the remaining rows still run', async () => {
  const selfTest = createSelfTest({
    config: CONFIG,
    timeoutMs: 120,
    translator: {
      async translate(text) {
        if (text === SELFTEST_PROBE_TEXT) await new Promise(() => {})
        return `译：${text}`
      },
      async probe() {
        return { bing: { ok: true, ms: 3 }, llm: { ok: true, ms: 5 } }
      },
    },
  })
  const rows = await selfTest.runAll()
  const probe = rows.find((row) => row.id === 'probe')
  assert.equal(probe.ok, false)
  assert.match(probe.detail, /超时（120ms）/)
  for (const row of rows.filter((entry) => entry.id !== 'probe')) {
    assert.equal(row.ok, true, `${row.id} must not be blocked by the hung check`)
  }
})

test('an unknown check id fails without throwing', async () => {
  const selfTest = createSelfTest({ config: CONFIG, translator: healthyTranslator() })
  const row = await selfTest.runOne('nope')
  assert.equal(row.ok, false)
  assert.match(row.detail, /未知检查项/)
})

/** Minimal response double that records what the handler sent. */
function fakeResponse() {
  const record = { status: 0, headers: {}, body: '' }
  return {
    record,
    writeHead(status, headers) {
      record.status = status
      record.headers = headers
    },
    end(body) {
      record.body = body
    },
  }
}

test('the route handler answers one check and refuses a foreign origin', async () => {
  const selfTest = createSelfTest({ config: CONFIG, translator: healthyTranslator() })
  const handler = createSelfTestHandler({ selfTest })

  const ok = fakeResponse()
  await handler({ method: 'GET', url: '/approval-zh/selftest?id=config', headers: {} }, ok)
  assert.equal(ok.record.status, 200)
  assert.equal(JSON.parse(ok.record.body).row.id, 'config')

  const forbidden = fakeResponse()
  await handler({
    method: 'GET',
    url: '/approval-zh/selftest',
    headers: { origin: 'https://evil.example', host: '127.0.0.1:1' },
  }, forbidden)
  assert.equal(forbidden.record.status, 403)

  const noPost = fakeResponse()
  await handler({ method: 'POST', url: '/approval-zh/selftest', headers: {} }, noPost)
  assert.equal(noPost.record.status, 405)
})
