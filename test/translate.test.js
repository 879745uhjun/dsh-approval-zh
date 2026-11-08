import test from 'node:test'
import assert from 'node:assert/strict'

import {
  pickLocalized,
  polishTranslation,
  protectTechnical,
  restoreTechnical,
  splitDisplayText,
  translateApprovalRequest,
} from '../lib/translate.js'

const SAMPLE =
  '允许本次操作使用 danger-full-access 权限：plugin_manager {"action":"list_plugins","limit":50}. Profile changes persist across sessions; installed Host code runs outside the workspace sandbox.'

test('splitDisplayText preserves the localized sandbox prefix', () => {
  const { prefix, tail } = splitDisplayText(SAMPLE)
  assert.equal(prefix, '允许本次操作使用 danger-full-access 权限：')
  assert.equal(
    tail,
    'plugin_manager {"action":"list_plugins","limit":50}. Profile changes persist across sessions; installed Host code runs outside the workspace sandbox.',
  )
})

test('splitDisplayText preserves an auto-review prefix', () => {
  const text = 'Auto review 拒绝了此调用：The command `rm -rf /` is dangerous.'
  const { prefix, tail } = splitDisplayText(text)
  assert.equal(prefix, 'Auto review 拒绝了此调用：')
  assert.equal(tail, 'The command `rm -rf /` is dangerous.')
})

test('splitDisplayText leaves a pure English prompt whole', () => {
  const text = 'Allow this operation with danger-full-access permissions: plugin_manager {"action":"list_plugins"}'
  const { prefix, tail } = splitDisplayText(text)
  assert.equal(prefix, '')
  assert.equal(tail, text)
})

test('protectTechnical round-trips code, JSON, tool names and paths', () => {
  const source =
    'Run `ops_bash` on C:\\work\\demo with {"action":"list_plugins","limit":50} then see https://example.com/a?b=1 for danger-full-access.'
  const { text, slots } = protectTechnical(source)
  assert.ok(!text.includes('"action"'))
  assert.ok(!text.includes('ops_bash'))
  assert.ok(!text.includes('C:\\work\\demo'))
  assert.ok(text.includes('[[Z7Q0]]'))
  assert.equal(restoreTechnical(text, slots), source)
})

test('restoreTechnical refuses a response that dropped a placeholder', () => {
  assert.equal(restoreTechnical('translated without token', ['plugin_manager']), undefined)
})

test('polishTranslation repairs common choices and punctuation', () => {
  const result = polishTranslation('自动审核拒绝了这个呼叫;主机代码运行在工作区沙箱之外。', [
    ['自动审核', '自动审查'],
    ['自动审查拒绝了这个呼叫', '自动审查拒绝了此调用'],
    ['呼叫', '调用'],
    ['主机代码', 'Host 代码'],
  ])
  assert.equal(result, '自动审查拒绝了此调用；Host 代码运行在工作区沙箱之外。')
})

test('pickLocalized prefers Chinese and falls back to English', () => {
  assert.equal(pickLocalized({ en: 'English', zh: '中文' }), '中文')
  assert.equal(pickLocalized({ en: 'English' }), 'English')
  assert.equal(pickLocalized('plain'), 'plain')
  assert.equal(pickLocalized(undefined), undefined)
})

test('translateApprovalRequest rewrites only the English tail', async () => {
  const calls = []
  const translator = {
    async translate(text) {
      calls.push(text)
      return `【译】${text}`
    },
  }
  const request = {
    displayReason: { zh: '允许本次操作使用 danger-full-access 权限：Profile changes persist across sessions.' },
  }
  const changed = await translateApprovalRequest(request, translator, {
    translateDisplayReason: true,
    translateReason: true,
  })
  assert.equal(changed, true)
  assert.equal(
    request.displayReason,
    '允许本次操作使用 danger-full-access 权限：【译】Profile changes persist across sessions.',
  )
  assert.deepEqual(calls, ['Profile changes persist across sessions.'])
})

test('translateApprovalRequest falls back to reason when displayReason is absent', async () => {
  const calls = []
  const translator = {
    async translate(text) {
      calls.push(text)
      return '已翻译'
    },
  }
  const request = { reason: 'escalate sandbox to danger-full-access: plugin_manager {"action":"list_plugins"}' }
  const changed = await translateApprovalRequest(request, translator, {
    translateDisplayReason: true,
    translateReason: true,
  })
  assert.equal(changed, true)
  assert.equal(request.reason, '已翻译')
  assert.equal(calls.length, 1)
})

test('translateApprovalRequest leaves already-Chinese text alone', async () => {
  let called = false
  const translator = {
    async translate(text) {
      called = true
      return `【译】${text}`
    },
  }
  const request = { displayReason: { zh: '允许本次操作使用 danger-full-access 权限：已经完成。' } }
  const changed = await translateApprovalRequest(request, translator, {
    translateDisplayReason: true,
    translateReason: true,
  })
  assert.equal(changed, false)
  assert.equal(called, false)
})

test('translateApprovalRequest never throws on a frozen request', async () => {
  const request = Object.freeze({
    displayReason: 'Allow this operation: Profile changes persist across sessions.',
  })
  const translator = { async translate() { return '已翻译' } }
  const changed = await translateApprovalRequest(request, translator, {
    translateDisplayReason: true,
    translateReason: true,
  })
  assert.equal(changed, false)
  assert.equal(request.displayReason, 'Allow this operation: Profile changes persist across sessions.')
})
