/**
 * dsh-approval-zh — browser half.
 *
 * Adds the「自检」section to this plugin's own detail page
 * (`plugins.detail.section`, id `dsh-approval-zh.selftest`, order 90).
 *
 * It runs only when the user presses 运行自检: every check is one
 * `GET /approval-zh/selftest?id=<check>` call with its own 2-second budget, so a
 * slow or failing check cannot delay the others. Results live in component
 * memory and can be copied as Markdown.
 */
window.__ModuleLoader__.load({
  id: 'dsh-approval-zh',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState } = React

    const NS = 'approval-zh'
    const ENDPOINT = '/approval-zh/selftest'
    const TIMEOUT_MS = 2000
    const PACKAGE_NAME = 'dsh-approval-zh'
    const CHECK_IDS = ['config', 'probe', 'channels', 'cache']

    /** The slot cell this half owns. */
    const REGISTRATION = Object.freeze({
      name: 'plugins.detail.section',
      id: 'dsh-approval-zh.selftest',
      order: 90,
    })

    const ZH = {
      'selftest.title': '自检',
      'selftest.run': '运行自检',
      'selftest.running': '运行中…',
      'selftest.idle': '未运行',
      'selftest.summary': '{pass} 通过 · {fail} 失败',
      'selftest.pass': '通过',
      'selftest.fail': '失败',
      'selftest.timeout': '超时',
      'selftest.noAnswer': '无响应',
      'selftest.copy': '复制结果',
      'selftest.copied': '已复制',
      'selftest.copyFailed': '复制失败',
      'selftest.colon': '：',
      'check.config': '配置可读',
      'check.probe': '翻译探针',
      'check.channels': '两条通道',
      'check.cache': '缓存命中',
    }

    const EN = {
      'selftest.title': 'Self-test',
      'selftest.run': 'Run self-test',
      'selftest.running': 'Running…',
      'selftest.idle': 'Not run yet',
      'selftest.summary': '{pass} passed · {fail} failed',
      'selftest.pass': 'passed',
      'selftest.fail': 'failed',
      'selftest.timeout': 'timed out',
      'selftest.noAnswer': 'no response',
      'selftest.copy': 'Copy results',
      'selftest.copied': 'Copied',
      'selftest.copyFailed': 'Copy failed',
      'selftest.colon': ': ',
      'check.config': 'Configuration readable',
      'check.probe': 'Translation probe',
      'check.channels': 'Both channels',
      'check.cache': 'Cache hit',
    }

    /**
     * Decide whether the detail page belongs to this plugin.
     *
     * A bundle page carries `kind: 'bundle'` with its package, while a row page
     * carries `kind: 'item'` with the loader id — both must open the section.
     * @param {object | undefined} subject - detail-page subject.
     * @returns {string | undefined} the owning package name.
     */
    function selfTestSubject(subject) {
      if (subject?.kind === 'bundle') return subject?.pkg?.name
      if (subject?.kind === 'item') {
        return subject.id === PACKAGE_NAME || subject.id === `include:${PACKAGE_NAME}`
          ? PACKAGE_NAME
          : undefined
      }
      return undefined
    }

    /** Localized badge text for one row status. */
    function statusText(status, t) {
      if (status === 'pass') return t('selftest.pass')
      if (status === 'fail') return t('selftest.fail')
      if (status === 'run') return t('selftest.running')
      return t('selftest.idle')
    }

    /** Summary line above the rows. */
    function summaryOf(rows, t) {
      if (!Array.isArray(rows) || rows.length === 0) return t('selftest.idle')
      let pass = 0
      let fail = 0
      for (const row of rows) {
        if (row.status === 'pass') pass += 1
        else if (row.status === 'fail') fail += 1
      }
      return t('selftest.summary', { pass, fail })
    }

    /**
     * Render the copied report.
     * @param {object[]} rows - settled rows.
     * @param {Function} t - bound translator.
     * @returns {string} Markdown lines.
     */
    function markdownOf(rows, t) {
      return rows
        .map((row) => {
          if (row.status === 'pass') return `- [x] ${row.label} — ${t('selftest.pass')}`
          const reason = row.detail === '' ? '' : t('selftest.colon') + row.detail
          return `- [ ] ${row.label} — ${statusText(row.status, t)}${reason}`
        })
        .join('\n')
    }

    /**
     * Ask the Host for one check with its own cancellation budget.
     * @param {string} id - check id.
     * @param {Function} t - bound translator.
     * @returns {Promise<{ ok: boolean, detail: string }>} one outcome.
     */
    async function runOneCheck(id, t) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller === null
        ? null
        : window.setTimeout(() => {
          try {
            controller.abort()
          } catch {
            /* already aborted */
          }
        }, TIMEOUT_MS)
      try {
        const response = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, {
          signal: controller === null ? undefined : controller.signal,
          headers: { accept: 'application/json' },
          cache: 'no-store',
        })
        let json
        try {
          json = await response.json()
        } catch {
          json = undefined
        }
        if (response.status !== 200) return { ok: false, detail: `HTTP ${response.status}` }
        const row = json?.row
        if (row === null || typeof row !== 'object') return { ok: false, detail: t('selftest.noAnswer') }
        return { ok: row.ok === true, detail: typeof row.detail === 'string' ? row.detail : '' }
      } catch {
        const timedOut = controller !== null && controller.signal.aborted
        return { ok: false, detail: timedOut ? t('selftest.timeout') : t('selftest.noAnswer') }
      } finally {
        if (timer !== null) window.clearTimeout(timer)
      }
    }

    const STYLE = {
      root: { display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0' },
      head: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      title: { margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      button: {
        height: 26,
        padding: '0 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        cursor: 'pointer',
      },
      summary: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      row: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '6px 0',
        borderTop: '1px solid var(--dsw-alias-border-tertiary, rgba(127,127,127,.18))',
      },
      label: { fontSize: 12, color: 'var(--dsw-alias-label-primary)' },
      detail: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', marginTop: 2 },
      badge: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
    }

    /**
     * The section rendered under this plugin's detail page.
     * @param {{ ctx: object, subject: object, t?: Function }} props - slot props.
     * @returns {object | null} a React element or null for other subjects.
     */
    function SelfTestSection(props) {
      const locale = props?.ctx?.locale ?? null
      const t = typeof props?.t === 'function'
        ? props.t
        : typeof locale?.bind === 'function'
          ? locale.bind(NS)
          : (key) => key
      const [rows, setRows] = useState([])
      const [running, setRunning] = useState(false)
      const [note, setNote] = useState('')

      if (selfTestSubject(props?.subject) !== PACKAGE_NAME) return null

      const labels = {
        config: t('check.config'),
        probe: t('check.probe'),
        channels: t('check.channels'),
        cache: t('check.cache'),
      }
      const summary = summaryOf(rows, t)

      const run = async () => {
        if (running) return
        setRunning(true)
        setNote('')
        setRows(CHECK_IDS.map((id) => ({ id, label: labels[id], status: 'idle', detail: '' })))
        for (const id of CHECK_IDS) {
          setRows((previous) =>
            previous.map((row) => (row.id === id ? { ...row, status: 'run' } : row)))
          const outcome = await runOneCheck(id, t)
          setRows((previous) =>
            previous.map((row) => (row.id === id
              ? { ...row, status: outcome.ok ? 'pass' : 'fail', detail: outcome.detail }
              : row)))
        }
        setRunning(false)
      }

      const copy = async () => {
        const text = rows.length === 0 ? t('selftest.idle') : markdownOf(rows, t)
        try {
          if (typeof navigator === 'undefined' || navigator.clipboard === undefined) throw new Error('no clipboard')
          await navigator.clipboard.writeText(text)
          setNote(t('selftest.copied'))
        } catch {
          setNote(t('selftest.copyFailed'))
        }
      }

      return h('div', { style: STYLE.root, 'data-selftest': PACKAGE_NAME },
        h('div', { style: STYLE.head },
          h('h3', { style: STYLE.title }, t('selftest.title')),
          h('button', {
            type: 'button',
            style: STYLE.button,
            'data-selftest-action': 'run',
            disabled: running,
            onClick: () => {
              void run()
            },
          }, running ? t('selftest.running') : t('selftest.run')),
          h('span', { style: STYLE.summary, 'data-selftest-summary': summary }, summary),
          h('button', {
            type: 'button',
            style: STYLE.button,
            'data-selftest-action': 'copy',
            disabled: rows.length === 0,
            onClick: () => {
              void copy()
            },
          }, t('selftest.copy'))),
        note === '' ? null : h('p', { style: STYLE.detail, 'data-selftest-note': note }, note),
        h('div', null, rows.map((row) => h('div', {
          key: row.id,
          style: STYLE.row,
          'data-check': row.id,
          'data-status': row.status,
        },
        h('div', null,
          h('div', { style: STYLE.label }, row.label),
          row.detail === '' || row.status === 'run'
            ? null
            : h('div', { style: STYLE.detail }, row.detail)),
        h('span', { style: STYLE.badge, 'data-status': row.status }, statusText(row.status, t))))))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register(NS, {
            zh: ZH,
            en: EN,
            ja: EN,
            es: EN,
            fr: EN,
            de: EN,
            ru: EN,
            pt: EN,
          }),
          'dsh-approval-zh: dictionaries',
        )
        ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
          ...REGISTRATION,
          locale: NS,
        }, SelfTestSection))
      },
      /** Pure helpers exercised by the tests; the loader ignores this key. */
      __selftest: {
        registration: REGISTRATION,
        packageName: PACKAGE_NAME,
        checkIds: [...CHECK_IDS],
        dictionaries: { zh: ZH, en: EN },
        timeoutMs: TIMEOUT_MS,
        subject: selfTestSubject,
        summary: summaryOf,
        markdown: markdownOf,
        statusText,
        runOneCheck,
      },
    }
  },
})
