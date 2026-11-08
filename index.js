/**
 * dsh-approval-zh — translate DeepSeek Harness approval prompt text to Chinese.
 *
 * Scope: display text only. The approval waterfall still receives the same
 * request, the same answerers, and the same decision. The plugin mutates the
 * user-visible `displayReason` (or `reason` fallback) before the browser bridge
 * forwards it, so no approval is approved, denied, or delayed beyond the
 * translation timeout.
 *
 * @module dsh-approval-zh
 */

import { createTranslator, translateApprovalRequest } from './lib/translate.js'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-approval-zh'

/** The approval waterfall is the only required host service. */
export const inject = ['approval']

const DEFAULTS = Object.freeze({
  enabled: true,
  target: 'zh-Hans',
  timeoutMs: 3000,
  maxTextChars: 4000,
  translateReason: true,
  translateDisplayReason: true,
  debug: false,
})

/**
 * Normalize user configuration without trusting its runtime shape.
 * @param {unknown} input - raw Cordis config.
 * @returns {object} complete configuration.
 */
export function normalizeConfig(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  return {
    enabled: source.enabled !== false,
    target:
      typeof source.target === 'string' && source.target.trim().length > 0
        ? source.target.trim()
        : DEFAULTS.target,
    timeoutMs: clamp(Number(source.timeoutMs), 500, 15000, DEFAULTS.timeoutMs),
    maxTextChars: clamp(Number(source.maxTextChars), 200, 12000, DEFAULTS.maxTextChars),
    translateReason: source.translateReason !== false,
    translateDisplayReason: source.translateDisplayReason !== false,
    debug: source.debug === true,
    glossary:
      source.glossary !== null && typeof source.glossary === 'object' && !Array.isArray(source.glossary)
        ? source.glossary
        : {},
  }
}

/**
 * Install the display-only translation listener.
 *
 * The listener always calls `next()`, including after a translation failure.
 * A thrown listener would fail the approval waterfall closed and reject the
 * operation, which this plugin must never do.
 * @param {object} ctx - Cordis plugin context.
 * @param {unknown} input - raw Cordis config.
 */
export function apply(ctx, input) {
  const config = normalizeConfig(input)
  if (!config.enabled) return
  const translator = createTranslator(config)
  ctx.on(
    'approval/request',
    async (request, next) => {
      try {
        await translateApprovalRequest(request, translator, config)
      } catch (error) {
        if (config.debug) {
          console.warn('[dsh-approval-zh] translation skipped:', error?.message ?? error)
        }
      }
      return next()
    },
    { prepend: true },
  )
  if (config.debug) {
    console.log(`[dsh-approval-zh] loaded; target=${config.target}, timeout=${config.timeoutMs}ms`)
  }
}

/**
 * Clamp a numeric setting.
 * @param {number} value - candidate.
 * @param {number} minimum - inclusive lower bound.
 * @param {number} maximum - inclusive upper bound.
 * @param {number} fallback - default.
 * @returns {number} clamped value.
 */
function clamp(value, minimum, maximum, fallback) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}
