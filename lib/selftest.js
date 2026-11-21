/**
 * Host half of the plugin self-test.
 *
 * The browser section asks for one check at a time so each row gets its own
 * 2-second budget and a failing check cannot delay the others. Nothing here
 * touches the approval service, so a self-test never writes an audit record and
 * never opens an approval prompt.
 *
 * @module dsh-approval-zh/lib/selftest
 */

/** Same-origin route the detail-page section calls. */
export const SELFTEST_ROUTE = '/approval-zh/selftest'

/** Fixed English sentence the translation probe runs through the real path. */
export const SELFTEST_PROBE_TEXT = 'Allow this operation to use danger-full-access?'

/** Second sentence, used to prove the cache answers the repeat instantly. */
export const SELFTEST_CACHE_TEXT = 'The approval card shows this sentence.'

/** Per-check budget; the browser enforces the same number. */
export const SELFTEST_TIMEOUT_MS = 2000

/** How long a cached answer may take before it counts as a miss. */
export const CACHE_HIT_MS = 100

/** Trim a translation for one row's detail line. */
function excerpt(text, limit = 60) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`
}

/**
 * Build the four checks plus their runner.
 * @param {object} options - wiring.
 * @param {object} options.config - normalized plugin configuration.
 * @param {{ translate: Function, probe: Function }} options.translator - live translator.
 * @param {() => object | undefined} [options.getAgent] - resolves an agent for the model channel.
 * @param {number} [options.timeoutMs] - per-check budget.
 * @returns {{ ids: string[], runOne: Function, runAll: Function }} self-test.
 */
export function createSelfTest({ config, translator, getAgent, timeoutMs = SELFTEST_TIMEOUT_MS }) {
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.trunc(timeoutMs) : SELFTEST_TIMEOUT_MS
  const agentOf = typeof getAgent === 'function' ? getAgent : () => undefined

  const checks = [
    {
      id: 'config',
      label: '配置可读',
      run: async () => {
        const target = typeof config?.target === 'string' ? config.target : ''
        const limit = Number(config?.timeoutMs)
        if (config?.enabled !== true) return { ok: false, detail: '插件已禁用（enabled=false）' }
        if (target === '') return { ok: false, detail: 'target 未配置' }
        if (!Number.isFinite(limit) || limit <= 0) return { ok: false, detail: 'timeoutMs 非法' }
        return { ok: true, detail: `enabled=true · ${target} · ${limit}ms` }
      },
    },
    {
      id: 'probe',
      label: '翻译探针',
      run: async (signal) => {
        const translated = await translator.translate(SELFTEST_PROBE_TEXT, signal, agentOf())
        if (typeof translated !== 'string' || translated.trim() === '') {
          return { ok: false, detail: 'translate 返回空值' }
        }
        if (translated === SELFTEST_PROBE_TEXT) {
          return { ok: false, detail: '两条通道都没有产出译文' }
        }
        return { ok: true, detail: excerpt(translated) }
      },
    },
    {
      id: 'channels',
      label: '两条通道',
      run: async (signal) => {
        // Leave a little room inside the row budget so the report itself lands.
        const report = await translator.probe(
          SELFTEST_PROBE_TEXT,
          signal,
          agentOf(),
          Math.max(100, budget - 150),
        )
        const bing = report?.bing ?? { ok: false, detail: '无结果' }
        const llm = report?.llm ?? { ok: false, detail: '无结果' }
        const describe = (name, entry) => {
          if (entry.skipped === true) return `${name} 跳过（${entry.detail ?? '不可用'}）`
          if (entry.pending === true) return `${name} 未在时限内返回`
          if (entry.ok === true) return `${name} 通过 ${entry.ms ?? '?'}ms`
          return `${name} 失败（${entry.detail ?? '未知原因'}）`
        }
        const detail = [describe('Bing', bing), describe('模型', llm)].join(' · ')
        // One healthy channel is enough: the other may still be streaming.
        return bing.ok === true || llm.ok === true ? { ok: true, detail } : { ok: false, detail }
      },
    },
    {
      id: 'cache',
      label: '缓存命中',
      run: async (signal) => {
        const first = await translator.translate(SELFTEST_CACHE_TEXT, signal, agentOf())
        if (typeof first !== 'string' || first === SELFTEST_CACHE_TEXT) {
          return { ok: false, detail: '首次翻译失败，无法验证缓存' }
        }
        const started = Date.now()
        const second = await translator.translate(SELFTEST_CACHE_TEXT, signal, agentOf())
        const elapsed = Date.now() - started
        if (second !== first) return { ok: false, detail: '第二次结果与第一次不一致' }
        if (elapsed >= CACHE_HIT_MS) return { ok: false, detail: `第二次耗时 ${elapsed}ms，未命中缓存` }
        return { ok: true, detail: `第二次 ${elapsed}ms` }
      },
    },
  ]

  /**
   * Run one check under its own budget; a throw or a timeout becomes a failed row.
   * @param {{ id: string, run: Function }} check - the check to execute.
   * @returns {Promise<object>} one result row.
   */
  async function execute(check) {
    const controller = new AbortController()
    let timer
    // The deadline rejects on its own: a channel that ignores the abort signal
    // must still release this row instead of holding the whole self-test.
    const deadline = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        try {
          controller.abort()
        } catch {
          /* already aborted */
        }
        reject(new Error('self-test check timed out'))
      }, budget)
    })
    const started = Date.now()
    try {
      const outcome = await Promise.race([check.run(controller.signal), deadline])
      return {
        id: check.id,
        ok: outcome?.ok === true,
        detail: typeof outcome?.detail === 'string' ? outcome.detail : '',
        ms: Date.now() - started,
      }
    } catch (error) {
      const timedOut = controller.signal.aborted
      const detail = timedOut
        ? `超时（${budget}ms）`
        : error instanceof Error
          ? error.message
          : String(error)
      return { id: check.id, ok: false, detail, ms: Date.now() - started }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    ids: checks.map((check) => check.id),
    /** Run one check by id; an unknown id fails without touching anything. */
    async runOne(id) {
      const check = checks.find((candidate) => candidate.id === id)
      if (check === undefined) return { id: String(id), ok: false, detail: '未知检查项', ms: 0 }
      return execute(check)
    },
    /** Run every check in order, one result row each. */
    async runAll() {
      const rows = []
      for (const check of checks) rows.push(await execute(check))
      return rows
    },
  }
}

/**
 * Whether a request may reach the route: absent Origin (same-origin fetch,
 * curl) passes; a mismatched origin does not.
 * @param {import('node:http').IncomingMessage} request - inbound request.
 * @returns {boolean} whether the origin is acceptable.
 */
function isAcceptableOrigin(request) {
  const origin = request.headers?.origin
  if (origin === undefined) return true
  if (origin === 'null') return false
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

/** Write one JSON response. */
function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/**
 * Build the HTTP handler behind {@link SELFTEST_ROUTE}.
 * @param {{ selfTest: object }} options - the runner from {@link createSelfTest}.
 * @returns {(request: object, response: object) => Promise<void>} handler.
 */
export function createSelfTestHandler({ selfTest }) {
  return async function handleSelfTest(request, response) {
    try {
      if (!isAcceptableOrigin(request)) {
        sendJson(response, 403, { ok: false, error: 'cross-origin request refused' })
        return
      }
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET', 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const id = url.searchParams.get('id')
      if (id === null || id === '') {
        sendJson(response, 200, { ok: true, rows: await selfTest.runAll() })
        return
      }
      sendJson(response, 200, { ok: true, row: await selfTest.runOne(id) })
    } catch {
      try {
        sendJson(response, 500, { ok: false, error: 'self-test failed' })
      } catch {
        /* the response is already unusable */
      }
    }
  }
}
