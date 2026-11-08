/**
 * Live smoke test for the anonymous translation endpoint.
 *
 * Run with `node test/live.mjs`. It makes one real request to
 * edge.microsoft.com and prints the translated approval display text.
 */
import { createTranslator, translateApprovalRequest } from '../lib/translate.js'

const translator = createTranslator({
  target: 'zh-Hans',
  timeoutMs: 8000,
  maxTextChars: 4000,
  debug: true,
  glossary: {},
})

const request = {
  displayReason: {
    zh: '允许本次操作使用 danger-full-access 权限：plugin_manager {"action":"list_plugins","limit":50}. Profile changes persist across sessions; installed Host code runs outside the workspace sandbox.',
  },
  reason:
    'escalate sandbox to danger-full-access: plugin_manager {"action":"list_plugins","limit":50}. Profile changes persist across sessions; installed Host code runs outside the workspace sandbox.',
}

const changed = await translateApprovalRequest(request, translator, {
  translateDisplayReason: true,
  translateReason: true,
})

console.log('changed:', changed)
console.log('display:', request.displayReason)
