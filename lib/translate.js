/**
 * dsh-approval-zh translation core.
 *
 * This module changes display text only. It never returns, rewrites, or derives
 * an approval outcome, so a translated prompt still asks the user exactly the
 * same question.
 */

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/
const LATIN_WORD = /[A-Za-z]{2,}/

/**
 * Source spans that must survive translation verbatim: fenced code, inline
 * code, URLs, Windows paths, JSON records, bracketed argument fragments, tool
 * names with underscores, and sandbox mode names.
 */
const TECHNICAL_RE =
  /```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>()"']+|[A-Za-z]:\\[^\s,;)\]}]+|\s*\{[\s\S]{0,1200}?\}|\[[^\]\n]{0,400}?\]|\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b|\b(?:danger-full-access|workspace-write|read-only)\b/g

/**
 * Repair common machine-translation choices without touching technical spans
 * (those are restored after this pass).
 */
const DEFAULT_GLOSSARY = {
  '自动审核': '自动审查',
  '自动审查拒绝了这个呼叫': '自动审查拒绝了此调用',
  '呼叫': '调用',
  '配置文件的变更会在不同会话间持续存在': '配置文件更改会在会话之间保留',
  '安装的主机代码运行在工作区沙箱之外': '已安装的 Host 代码在工作区沙箱之外运行',
  '主机代码': 'Host 代码',
}

const LOCALIZED_KEYS = ['zh', 'zh-cn', 'zh-hans', 'zh-hant', 'en']

/**
 * Read the best Chinese (then English) string from a LocalizedText value.
 * @param {unknown} value - a plain string or a locale-to-string record.
 * @returns {string | undefined} the selected display text.
 */
export function pickLocalized(value) {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const lower = new Map()
  for (const [key, text] of Object.entries(value)) {
    if (typeof text === 'string') lower.set(key.toLowerCase(), text)
  }
  for (const key of LOCALIZED_KEYS) {
    const text = lower.get(key)
    if (typeof text === 'string' && text.trim().length > 0) return text
  }
  for (const text of lower.values()) {
    if (text.trim().length > 0) return text
  }
  return undefined
}

/**
 * Split a localized prompt into its stable prefix and translatable tail.
 *
 * The sandbox and auto-review prompts look like
 * `允许本次操作使用 danger-full-access 权限：<English justification>` and
 * `Auto review 拒绝了此调用：<English reason>`. Keeping the prefix preserves
 * the Chinese frame, the mode name, and the product label.
 * @param {string} text - one display string.
 * @returns {{ prefix: string, tail: string }} prefix (possibly empty) and tail.
 */
export function splitDisplayText(text) {
  if (typeof text !== 'string' || text.length === 0) return { prefix: '', tail: '' }
  const candidates = []
  const fullWidth = text.indexOf('：')
  if (fullWidth !== -1) candidates.push({ index: fullWidth, width: 1 })
  const ascii = text.indexOf(': ')
  if (ascii !== -1) candidates.push({ index: ascii, width: 2 })
  if (candidates.length === 0) return { prefix: '', tail: text }
  candidates.sort((left, right) => left.index - right.index)
  const first = candidates[0]
  const prefix = text.slice(0, first.index + first.width)
  const tail = text.slice(prefix.length)
  if (CJK.test(prefix)) return { prefix, tail }
  return { prefix: '', tail: text }
}

/**
 * Whether a fragment already reads mainly in Chinese. A pure technical term
 * such as `Host` or `danger-full-access` does not make Chinese text
 * translatable.
 * @param {string} text - candidate fragment.
 * @returns {boolean} true when Chinese characters dominate Latin letters.
 */
function mostlyChinese(text) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return cjk > 0 && cjk >= latin
}

/**
 * Replace technical spans with stable placeholders before sending text to the
 * translation endpoint.
 * @param {string} text - source text.
 * @returns {{ text: string, slots: string[] }} protected text and stashed spans.
 */
export function protectTechnical(text) {
  const slots = []
  const protectedText = text.replace(TECHNICAL_RE, (match) => {
    const token = `[[Z7Q${slots.length}]]`
    slots.push(match)
    return token
  })
  return { text: protectedText, slots }
}

/**
 * Put protected spans back. Returns undefined when the provider dropped or
 * rewrote a placeholder, so the caller can fall back to the original text.
 * @param {string} text - translated text carrying placeholders.
 * @param {string[]} slots - stashed spans in insertion order.
 * @returns {string | undefined} restored text.
 */
export function restoreTechnical(text, slots) {
  if (!Array.isArray(slots) || slots.length === 0) return text
  for (let index = 0; index < slots.length; index += 1) {
    if (!text.includes(`[[Z7Q${index}]]`)) return undefined
  }
  return text.replace(/\[\[Z7Q(\d+)\]\]/g, (match, index) => slots[Number(index)] ?? match)
}

/**
 * Build the ordered glossary, longest source phrase first so a short entry
 * cannot pre-empt its longer variant.
 * @param {Record<string, string> | undefined} extra - user additions.
 * @returns {Array<[string, string]>} ordered replacement pairs.
 */
function buildGlossary(extra) {
  const merged = { ...DEFAULT_GLOSSARY }
  if (extra !== null && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [from, to] of Object.entries(extra)) {
      if (typeof from === 'string' && from.length > 0 && typeof to === 'string' && to.length > 0) {
        merged[from] = to
      }
    }
  }
  return Object.entries(merged).sort((left, right) => right[0].length - left[0].length)
}

/**
 * Apply the glossary and normalize Chinese punctuation in translated text.
 * Technical placeholders contain no CJK, so this pass cannot alter them.
 * @param {string} text - raw translated text.
 * @param {Array<[string, string]>} glossary - ordered replacements.
 * @returns {string} polished text.
 */
export function polishTranslation(text, glossary) {
  let result = text
  for (const [from, to] of glossary) {
    if (result.includes(from)) result = result.split(from).join(to)
  }
  result = result.replace(/;/g, '；')
  result = result.replace(/,(?=[\u3400-\u9fff])/g, '，')
  result = result.replace(/\s+([。；，：！？])/g, '$1')
  return result.trim()
}

/**
 * Translate one display string while keeping a localized prefix.
 * @param {string} text - source display string.
 * @param {{ translate(text: string, signal?: AbortSignal): Promise<string> }} translator - translator.
 * @param {AbortSignal | undefined} signal - caller cancellation.
 * @returns {Promise<string>} translated display string, or the input.
 */
async function translateDisplayText(text, translator, signal) {
  if (typeof text !== 'string' || text.trim().length === 0) return text
  if (!LATIN_WORD.test(text)) return text
  const { prefix, tail } = splitDisplayText(text)
  if (tail.length === 0 || !LATIN_WORD.test(tail) || mostlyChinese(tail)) return text
  const translatedTail = await translator.translate(tail, signal)
  if (typeof translatedTail !== 'string' || translatedTail.trim().length === 0) return text
  if (translatedTail === tail) return text
  return `${prefix}${translatedTail}`
}

/**
 * Mutate the display-only fields of one approval request in place.
 *
 * `displayReason` is what the browser approval card renders; when it is absent,
 * `reason` is the fallback title. The request object is owned by the approval
 * waterfall and forwarded to the browser immediately after `next()`, so an
 * in-place display update is the supported surface. A frozen or sealed request
 * is left untouched rather than risking the approval path.
 * @param {Record<string, unknown>} request - approval request borrowed by the waterfall.
 * @param {{ translate(text: string, signal?: AbortSignal): Promise<string> }} translator - translator.
 * @param {{ translateReason?: boolean, translateDisplayReason?: boolean }} config - switches.
 * @returns {Promise<boolean>} whether a field changed.
 */
export async function translateApprovalRequest(request, translator, config) {
  if (request === null || typeof request !== 'object') return false
  if (config.translateDisplayReason !== false && request.displayReason !== undefined) {
    const text = pickLocalized(request.displayReason)
    if (text !== undefined) {
      const translated = await translateDisplayText(text, translator, request.signal)
      if (translated !== text) return assignField(request, 'displayReason', translated)
      return false
    }
  }
  if (config.translateReason !== false && typeof request.reason === 'string') {
    const translated = await translateDisplayText(request.reason, translator, request.signal)
    if (translated !== request.reason) return assignField(request, 'reason', translated)
  }
  return false
}

/**
 * Assign one display field without throwing on a frozen request.
 * @param {Record<string, unknown>} target - request object.
 * @param {string} key - field name.
 * @param {string} value - translated text.
 * @returns {boolean} whether the write took effect.
 */
function assignField(target, key, value) {
  try {
    if (Object.isFrozen(target)) return false
    target[key] = value
    return target[key] === value
  } catch {
    return false
  }
}

/**
 * Build the cached anonymous translation client.
 * @param {object} config - normalized plugin configuration.
 * @returns {{ translate(text: string, signal?: AbortSignal): Promise<string> }} client.
 */
export function createTranslator(config) {
  const target = typeof config.target === 'string' && config.target.length > 0 ? config.target : 'zh-Hans'
  const timeoutMs = clampNumber(config.timeoutMs, 500, 15000, 3000)
  const maxTextChars = clampNumber(config.maxTextChars, 200, 12000, 4000)
  const debug = config.debug === true
  const glossary = buildGlossary(config.glossary)
  const cache = new Map()
  const failures = new Map()
  const inflight = new Map()

  async function requestTranslation(source, signal) {
    const { text, slots } = protectTechnical(source)
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const combined =
      signal !== undefined && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal
    const url = new URL('https://edge.microsoft.com/translate/translatetext')
    url.searchParams.set('to', target)
    url.searchParams.set('isEnterpriseClient', 'false')
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([text]),
      redirect: 'error',
      credentials: 'omit',
      signal: combined,
    })
    if (!response.ok) {
      try {
        await response.body?.cancel()
      } catch {
        // The body is already unusable; the status is the useful failure.
      }
      throw new Error(`translation endpoint returned HTTP ${response.status}`)
    }
    const payload = await response.json()
    const raw = payload?.[0]?.translations?.[0]?.text
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new Error('translation endpoint returned no text')
    }
    const restored = restoreTechnical(raw, slots)
    if (restored === undefined) throw new Error('translation dropped a protected placeholder')
    const polished = polishTranslation(restored, glossary)
    return polished.length > 0 ? polished : source
  }

  /**
   * Translate one non-empty string, caching successful results and briefly
   * suppressing repeated failures.
   * @param {string} text - source text.
   * @param {AbortSignal | undefined} signal - caller cancellation.
   * @returns {Promise<string>} translated text, or the source on any failure.
   */
  async function translate(text, signal) {
    if (typeof text !== 'string' || text.length === 0) return text
    const source = text.trim()
    if (source.length === 0 || source.length > maxTextChars) return text
    if (!LATIN_WORD.test(source)) return text
    if (signal?.aborted) return text
    const cached = cache.get(source)
    if (cached !== undefined) return cached
    const failedAt = failures.get(source)
    if (failedAt !== undefined && Date.now() - failedAt < 60_000) return text
    const running = inflight.get(source)
    if (running !== undefined) return running
    const promise = requestTranslation(source, signal)
      .then((result) => {
        cache.set(source, result)
        if (cache.size > 256) cache.delete(cache.keys().next().value)
        return result
      })
      .catch((error) => {
        failures.set(source, Date.now())
        if (failures.size > 128) failures.delete(failures.keys().next().value)
        if (debug) console.warn('[dsh-approval-zh] translation failed:', error?.message ?? error)
        return text
      })
      .finally(() => {
        inflight.delete(source)
      })
    inflight.set(source, promise)
    return promise
  }

  return { translate }
}

/**
 * Clamp a numeric setting.
 * @param {unknown} value - candidate.
 * @param {number} minimum - inclusive lower bound.
 * @param {number} maximum - inclusive upper bound.
 * @param {number} fallback - default.
 * @returns {number} clamped value.
 */
function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)))
}
