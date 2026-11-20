/**
 * Browser-half tests: slot metadata, subject matching, summary, Markdown, and
 * one check call with a stubbed fetch. No DSH runtime or DOM is needed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** Load client.js against a stub module loader and a minimal React. */
function loadClient(overrides = {}) {
  let exported
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
  }
  const context = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          exported = entry.factory((id) => (id === 'react' ? React : overrides[id]))
        },
      },
      setTimeout,
      clearTimeout,
    },
    fetch: overrides.fetch,
    AbortController,
    navigator: overrides.navigator,
    console,
  }
  vm.createContext(context)
  vm.runInContext(source, context)
  return { module: exported, context }
}

const { module } = loadClient()
const selftest = module.__selftest

test('the section registers on plugins.detail.section with the required metadata', () => {
  assert.equal(selftest.registration.name, 'plugins.detail.section')
  assert.equal(selftest.registration.id, 'dsh-approval-zh.selftest')
  assert.equal(selftest.registration.order, 90)
  assert.deepEqual([...module.inject], ['slots', 'locale'])
  assert.deepEqual([...selftest.checkIds], ['config', 'probe', 'channels', 'cache'])
  assert.equal(selftest.dictionaries.zh['selftest.title'], '自检')
  assert.equal(selftest.dictionaries.en['selftest.title'], 'Self-test')
})

test('the subject matcher accepts the bundle page and both row ids', () => {
  assert.equal(selftest.subject({ kind: 'bundle', pkg: { name: 'dsh-approval-zh' } }), 'dsh-approval-zh')
  assert.equal(selftest.subject({ kind: 'item', id: 'dsh-approval-zh' }), 'dsh-approval-zh')
  assert.equal(selftest.subject({ kind: 'item', id: 'include:dsh-approval-zh' }), 'dsh-approval-zh')
  assert.equal(selftest.subject({ kind: 'item', id: 'include:dsh-session-stars' }), undefined)
  assert.equal(selftest.subject({ kind: 'bundle', pkg: { name: 'other' } }), 'other')
  assert.equal(selftest.subject(undefined), undefined)
})

test('summary and Markdown follow the shared shape', () => {
  const t = (key, params) => {
    const table = {
      'selftest.idle': '未运行',
      'selftest.summary': `${params?.pass ?? 0} 通过 · ${params?.fail ?? 0} 失败`,
      'selftest.pass': '通过',
      'selftest.fail': '失败',
      'selftest.run': '运行中…',
      'selftest.colon': '：',
    }
    return table[key] ?? key
  }
  assert.equal(selftest.summary([], t), '未运行')
  const rows = [
    { id: 'config', label: '配置可读', status: 'pass', detail: '' },
    { id: 'probe', label: '翻译探针', status: 'fail', detail: '两条通道都没有产出译文' },
  ]
  assert.equal(selftest.summary(rows, t), '1 通过 · 1 失败')
  assert.equal(
    selftest.markdown(rows, t),
    '- [x] 配置可读 — 通过\n- [ ] 翻译探针 — 失败：两条通道都没有产出译文',
  )
})

test('a check call maps HTTP, payload, and timeout outcomes', async () => {
  const t = (key) => ({ 'selftest.timeout': '超时', 'selftest.noAnswer': '无响应' }[key] ?? key)

  const cases = [
    { fetch: async () => ({ status: 200, json: async () => ({ row: { ok: true, detail: 'ok' } }) }), expect: { ok: true, detail: 'ok' } },
    { fetch: async () => ({ status: 500, json: async () => ({}) }), expect: { ok: false, detail: 'HTTP 500' } },
    { fetch: async () => ({ status: 200, json: async () => ({}) }), expect: { ok: false, detail: '无响应' } },
    { fetch: async () => { throw new Error('boom') }, expect: { ok: false, detail: '无响应' } },
  ]

  for (const item of cases) {
    const loaded = loadClient({ fetch: item.fetch })
    const outcome = await loaded.module.__selftest.runOneCheck('config', t)
    // The module runs in its own VM realm, so compare fields rather than prototypes.
    assert.deepEqual({ ok: outcome.ok, detail: outcome.detail }, item.expect)
  }
})
