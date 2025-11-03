// Vue 3 + Vue Router v4
import { onMounted, onBeforeUnmount, watch, ref, getCurrentInstance } from 'vue'
import { useRoute } from 'vue-router'

// ===== Internal state =====
let buffer = []
let meta = {}
let flushTimer
let sessionStartTime
let lastPageViewPath = null
let _recentErrors = new Set()
let _seq = 0

// feature flags / config
let _config = {
  app: '',
  apiKey: '',
  endpoint: '',
  environment: 'prod',
  release: null,
  debug: false,
  flushInterval: 10000,
  // NEW:
  sampleRate: 1.0,            // session sampling (0..1)
  networkSampleRate: 0.1,     // network sampling (0..1)
  enableWebVitals: true,
  autoTrackInitialView: true,
  captureLongTasks: true,
  captureFetch: true,
  captureXHR: true,
  beforeSend: (ev) => ev      // ev -> ev | null
}
let _sessionDropped = false
let _listenersInstalled = false
let _fetchPatched = false
let _xhrPatched = false
let _resObserver = null
let _ltObserver = null

// ===== Helpers =====
const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
function safeWin() { try { return typeof window !== 'undefined' ? window : null } catch { return null } }

function computeNormalizedPath(route) {
  const rec = route?.matched?.[route.matched.length - 1]
  let pattern = rec?.path
  if (!pattern) {
    pattern = route?.path || (safeWin()?.location?.pathname ?? '/')
    const params = route?.params || {}
    Object.entries(params).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(val => { pattern = pattern.replace(String(val), `:${k}`) })
      else if (v != null) pattern = pattern.replace(String(v), `:${k}`)
    })
  }
  return pattern && pattern.startsWith('/') ? pattern : `/${pattern || ''}`
}

const curPath = () => (safeWin()?.location?.pathname || '/')

// ===== Context & Envelope =====
function buildContext(path, normalizedPath) {
  const w = safeWin()
  return {
    apiKey: meta.apiKey,
    app: meta.app,
    sessionId: meta.sessionId,
    deviceId: meta.deviceId ?? null,
    environment: meta.environment ?? null,
    release: meta.release ?? null,
    page: {
      url: w?.location?.href || null,
      path,
      normalizedPath,
      referrer: (typeof document !== 'undefined' ? document.referrer : '') || null,
    },
    client: {
      userAgent: w?.navigator?.userAgent,
      language: w?.navigator?.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  }
}

function makeEnvelope(type, path, normalizedPath, data) {
  return {
    type,
    ts: Date.now(),
    seq: ++_seq,
    context: buildContext(path, normalizedPath),
    data
  }
}

// ===== Buffering =====
function pushBuffered(env) {
  // privacy / beforeSend
  const final = typeof _config.beforeSend === 'function' ? _config.beforeSend(env) : env
  if (final === null) return
  buffer.push(final)
  if (WatchlogRUM.debug) console.log('[Watchlog RUM][vue] buffered:', final)
  if (buffer.length >= 12) flush()
}

function bufferEvent(event) {
  if (_sessionDropped) return
  const { type, path, normalizedPath, ...rest } = event

  if (type === 'error') {
    const key = `${rest.event || 'err'}:${rest.label || ''}:${normalizedPath || ''}`
    if (_recentErrors.has(key)) return
    _recentErrors.add(key)
    setTimeout(() => _recentErrors.delete(key), 3000)
  }

  let data
  switch (type) {
    case 'page_view': data = { name: 'page_view' }; break
    case 'session_start': data = { name: 'session_start' }; break
    case 'session_end': data = { name: 'session_end', duration: rest?.duration ?? null }; break
    case 'performance': data = { name: 'performance', metrics: rest?.metrics || {} }; break
    case 'custom': data = { name: rest.metric, value: rest.value ?? 1, extra: rest.extra ?? null }; break
    case 'error': data = { name: rest.event || 'error', message: rest.label || 'error', stack: rest.stack || null }; break
    // NEW event types:
    case 'network': data = { method: rest.method, url: rest.url, status: rest.status, ok: rest.ok, duration: rest.duration, transferSize: rest.transferSize ?? null }; break
    case 'resource': data = { name: rest.name, initiator: rest.initiator, duration: rest.duration, transferSize: rest.transferSize ?? null }; break
    case 'longtask': data = { duration: rest.duration }; break
    case 'web_vital': data = { name: rest.name, value: rest.value }; break
    default: data = { ...rest }
  }

  const env = makeEnvelope(type, path, normalizedPath, data)
  pushBuffered(env)
}

// ===== Performance =====
function capturePerformance(pathname, normalizedPath) {
  const w = safeWin()
  if (!w || !w.performance) return
  try {
    const nav = w.performance.getEntriesByType?.('navigation')?.[0]
    if (nav) {
      bufferEvent({
        type: 'performance',
        metrics: {
          ttfb: Math.round(nav.responseStart - nav.requestStart),
          domLoad: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
          load: Math.round(nav.loadEventEnd - nav.startTime),
        },
        path: pathname,
        normalizedPath
      })
      return
    }
    const t = w.performance.timing
    if (t && t.navigationStart > 0) {
      bufferEvent({
        type: 'performance',
        metrics: {
          ttfb: t.responseStart - t.requestStart,
          domLoad: t.domContentLoadedEventEnd - t.navigationStart,
          load: t.loadEventEnd - t.navigationStart,
        },
        path: pathname,
        normalizedPath
      })
    }
  } catch { /* ignore */ }
}

// ===== Global/unload handlers =====
function handleBeforeUnload() {
  const w = safeWin()
  if (!w) return
  const duration = sessionStartTime ? Math.round((Date.now() - sessionStartTime) / 1000) : null
  bufferEvent({
    type: 'session_end',
    path: w.location?.pathname || '/',
    normalizedPath: meta.normalizedPath,
    duration,
  })
  flush(true)
  clearInterval(flushTimer)
}

function handlePageHide() {
  // iOS/Safari-friendly
  flush(true)
}

function onErrorGlobal(e) {
  const w = safeWin()
  bufferEvent({
    type: 'error',
    event: 'window_error',
    label: e?.message || 'error',
    stack: e?.error?.stack,
    path: w?.location?.pathname || '/',
    normalizedPath: meta.normalizedPath,
  })
}

function onRejectionGlobal(e) {
  const w = safeWin()
  bufferEvent({
    type: 'error',
    event: 'unhandled_promise',
    label: e?.reason?.message || String(e?.reason),
    path: w?.location?.pathname || '/',
    normalizedPath: meta.normalizedPath,
  })
}

// ===== Observers =====
function observeResources() {
  const w = safeWin()
  if (!w || !('PerformanceObserver' in w) || _resObserver) return
  try {
    _resObserver = new w.PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        // ignore fetch/xhr (network separately)
        const it = entry.initiatorType
        if (!it || it === 'fetch' || it === 'xmlhttprequest') return
        bufferEvent({
          type: 'resource',
          name: entry.name,
          initiator: it,
          duration: Math.round(entry.duration),
          transferSize: entry.transferSize || null,
          path: curPath(),
          normalizedPath: meta.normalizedPath,
        })
      })
    })
    _resObserver.observe({ entryTypes: ['resource'] })
  } catch { /* ignore */ }
}

function observeLongTasks() {
  const w = safeWin()
  if (!_config.captureLongTasks || !w || !('PerformanceObserver' in w) || _ltObserver) return
  try {
    _ltObserver = new w.PerformanceObserver((list) => {
      list.getEntries().forEach((e) => {
        bufferEvent({
          type: 'longtask',
          duration: Math.round(e.duration),
          path: curPath(),
          normalizedPath: meta.normalizedPath,
        })
      })
    })
    _ltObserver.observe({ type: 'longtask', buffered: true })
  } catch { /* ignore */ }
}

async function installWebVitals() {
  if (!_config.enableWebVitals) return
  try {
    const { onCLS, onLCP, onINP, onTTFB } = await import('web-vitals')
    const wrap = (name) => (metric) => {
      bufferEvent({
        type: 'web_vital',
        name,
        value: metric.value,
        path: curPath(),
        normalizedPath: meta.normalizedPath,
      })
    }
    onCLS(wrap('CLS'))
    onLCP(wrap('LCP'))
    onINP(wrap('INP'))
    onTTFB(wrap('TTFB'))
  } catch {
    // web-vitals not installed; ignore
  }
}

// ===== Network (fetch / XHR) =====
function _sampleNetwork() {
  return Math.random() < (_config.networkSampleRate ?? 0.1)
}

function patchFetch() {
  const w = safeWin()
  if (!_config.captureFetch || _fetchPatched || !w || typeof w.fetch !== 'function') return
  const _orig = w.fetch.bind(w)

  w.fetch = async (input, init = {}) => {
    const start = now()
    let method = (init.method || 'GET').toUpperCase()
    let url = typeof input === 'string' ? input : (input?.url || '')
    let send = _sampleNetwork()

    try {
      const res = await _orig(input, init)
      const end = now()
      if (send) {
        // try to get transferSize from performance entries
        let transferSize = null
        try {
          const entries = performance.getEntriesByName(res.url, 'resource')
          if (entries && entries.length) {
            const last = entries[entries.length - 1]
            transferSize = last.transferSize || null
          }
        } catch { /* ignore */ }
        bufferEvent({
          type: 'network',
          method,
          url: res.url || url,
          status: res.status,
          ok: res.ok,
          duration: Math.round(end - start),
          transferSize,
          path: curPath(),
          normalizedPath: meta.normalizedPath
        })
      }
      return res
    } catch (err) {
      const end = now()
      if (send) {
        bufferEvent({
          type: 'network',
          method,
          url,
          status: 0,
          ok: false,
          duration: Math.round(end - start),
          transferSize: null,
          path: curPath(),
          normalizedPath: meta.normalizedPath
        })
      }
      throw err
    }
  }

  _fetchPatched = true
}

function patchXHR() {
  const w = safeWin()
  if (!_config.captureXHR || _xhrPatched || !w || !w.XMLHttpRequest) return

  const X = w.XMLHttpRequest
  function XR() { const xhr = new X(); return xhr }
  XR.prototype = X.prototype

  const _open = X.prototype.open
  const _send = X.prototype.send

  X.prototype.open = function (method, url, ...rest) {
    this.__wl_method = (method || 'GET').toUpperCase()
    this.__wl_url = String(url || '')
    return _open.call(this, method, url, ...rest)
  }

  X.prototype.send = function (body) {
    const start = now()
    const send = _sampleNetwork()
    const onDone = () => {
      if (!send) return
      const end = now()
      bufferEvent({
        type: 'network',
        method: this.__wl_method || 'GET',
        url: this.responseURL || this.__wl_url || '',
        status: this.status,
        ok: (this.status >= 200 && this.status < 400),
        duration: Math.round(end - start),
        transferSize: null, // XHR lacks direct size; could be augmented server-side
        path: curPath(),
        normalizedPath: meta.normalizedPath
      })
    }
    this.addEventListener('load', onDone)
    this.addEventListener('error', onDone)
    this.addEventListener('abort', onDone)
    return _send.call(this, body)
  }

  _xhrPatched = true
}

// ===== Transport (MATCH server) =====
function flush(sync = false) {
  if (!buffer.length) return
  const events = buffer.splice(0, buffer.length)
  const w = safeWin()
  if (!w) return

  const wrapper = {
    apiKey: meta.apiKey,
    app: meta.app,
    sdk: 'watchlog-rum-vue',
    version: '0.2.0',
    sentAt: Date.now(),
    sessionId: meta.sessionId,
    deviceId: meta.deviceId,
    environment: meta.environment || null,
    release: meta.release || null,
    events
  }
  const body = JSON.stringify(wrapper)

  try {
    const headers = {
      'Content-Type': 'application/json',
      'X-Watchlog-Key': meta.apiKey
    }

    if (sync && w.navigator?.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' })
      w.navigator.sendBeacon(WatchlogRUM.endpoint, blob)
    } else if (sync) {
      const xhr = new w.XMLHttpRequest()
      xhr.open('POST', WatchlogRUM.endpoint, false)
      xhr.setRequestHeader('Content-Type', 'application/json')
      xhr.setRequestHeader('X-Watchlog-Key', meta.apiKey)
      xhr.send(body)
    } else {
      w.fetch(WatchlogRUM.endpoint, { method: 'POST', headers, body, keepalive: true })
    }
  } catch (err) {
    if (WatchlogRUM.debug) console.warn('[Watchlog RUM][vue] flush error:', err)
  }
}

// ===== Core SDK =====
function registerListeners(config) {
  const w = safeWin()
  if (!w) return false

  // merge config with defaults
  _config = { ..._config, ...config }

  const {
    apiKey, endpoint, app, debug, flushInterval,
    environment, release, sampleRate
  } = _config

  if (!apiKey || !endpoint || !app) {
    console.warn('[Watchlog RUM] apiKey, endpoint, and app are required.')
    return false
  }

  // session sampling
  _sessionDropped = (typeof sampleRate === 'number' && sampleRate >= 0 && sampleRate <= 1)
    ? (Math.random() > sampleRate)
    : false

  let deviceId = null
  try {
    deviceId = w.localStorage.getItem('watchlog_device_id')
    if (!deviceId) {
      deviceId = 'dev-' + Math.random().toString(36).slice(2, 10)
      w.localStorage.setItem('watchlog_device_id', deviceId)
    }
  } catch { /* ignore */ }

  const initialNormalizedPath = meta.normalizedPath || w.location?.pathname || '/'

  meta = {
    apiKey,
    app,
    environment,
    release,
    sessionId: 'sess-' + Math.random().toString(36).substring(2, 10),
    deviceId,
    normalizedPath: initialNormalizedPath,
  }

  WatchlogRUM.debug = !!debug
  WatchlogRUM.endpoint = endpoint

  if (!_listenersInstalled) {
    w.addEventListener('error', onErrorGlobal)
    w.addEventListener('unhandledrejection', onRejectionGlobal)
    w.addEventListener('beforeunload', handleBeforeUnload)
    w.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') handlePageHide() })
    w.addEventListener('pagehide', handlePageHide)
    _listenersInstalled = true
  }

  // observers / patches
  observeResources()
  observeLongTasks()
  installWebVitals().catch(() => {})
  patchFetch()
  patchXHR()

  clearInterval(flushTimer)
  flushTimer = setInterval(() => flush(), Number(flushInterval) || 10000)

  return true
}

// ===== Public API =====
function custom(metric, value = 1, extra = null) {
  if (typeof metric !== 'string' || _sessionDropped) return
  const path = curPath()
  bufferEvent({ type: 'custom', metric, value, extra, path, normalizedPath: meta.normalizedPath })
  flush()
}

export const WatchlogRUM = {
  init: registerListeners,
  setNormalizedPath: (p) => (meta.normalizedPath = p),
  bufferEvent,
  custom,
  flush,
  debug: false,
  endpoint: '',
}

// ===== Composable =====
export function useWatchlogRUM(config) {
  const w = safeWin()
  const route = useRoute()
  const initialized = ref(false)

  registerListeners(config) // ensure config merged first
  meta.normalizedPath = computeNormalizedPath(route)

  onMounted(() => {
    // auto track initial view (optional)
    if (!initialized.value && !_sessionDropped && (_config.autoTrackInitialView !== false)) {
      sessionStartTime = Date.now()
      const pathname = w?.location?.pathname || route?.path || '/'
      const normalizedPath = meta.normalizedPath
      bufferEvent({ type: 'session_start', path: pathname, normalizedPath })
      bufferEvent({ type: 'page_view', path: pathname, normalizedPath })
      capturePerformance(pathname, normalizedPath)
      initialized.value = true
      lastPageViewPath = normalizedPath
    }
  })

  function handleError(e) {
    const pathname = w?.location?.pathname || route?.path || '/'
    const normalizedPath = meta.normalizedPath
    bufferEvent({
      type: 'error',
      event: 'window_error',
      label: e?.message || 'error',
      stack: e?.error?.stack,
      path: pathname,
      normalizedPath,
    })
  }
  function handleRejection(e) {
    const pathname = w?.location?.pathname || route?.path || '/'
    const normalizedPath = meta.normalizedPath
    bufferEvent({
      type: 'error',
      event: 'unhandled_promise',
      label: e?.reason?.message || String(e?.reason),
      path: pathname,
      normalizedPath,
    })
  }

  onMounted(() => {
    w?.addEventListener?.('error', handleError)
    w?.addEventListener?.('unhandledrejection', handleRejection)
  })
  onBeforeUnmount(() => {
    w?.removeEventListener?.('error', handleError)
    w?.removeEventListener?.('unhandledrejection', handleRejection)
  })

  watch(
    () => [route.fullPath, JSON.stringify(route.params)],
    () => {
      const pathname = w?.location?.pathname || route?.path || '/'
      const normalizedPath = computeNormalizedPath(route)
      meta.normalizedPath = normalizedPath
      if (normalizedPath !== lastPageViewPath) {
        bufferEvent({ type: 'page_view', path: pathname, normalizedPath })
        capturePerformance(pathname, normalizedPath)
        lastPageViewPath = normalizedPath
      }
    },
    { immediate: false }
  )

  const instance = getCurrentInstance()
  if (instance) instance.appContext.provides.__watchlog_rum__ = WatchlogRUM

  return {
    rum: WatchlogRUM,
    custom: WatchlogRUM.custom,
    flush: WatchlogRUM.flush,
    setNormalizedPath: WatchlogRUM.setNormalizedPath,
  }
}

// ===== Plugin (optional) =====
export function createWatchlogRUMPlugin({ router, ...config }) {
  return {
    install(app) {
      registerListeners(config)

      router.isReady().then(() => {
        const r = router.currentRoute.value
        const pathname = safeWin()?.location?.pathname || r.path || '/'
        const normalizedPath = computeNormalizedPath(r)
        meta.normalizedPath = normalizedPath

        if (!_sessionDropped && (_config.autoTrackInitialView !== false)) {
          sessionStartTime = Date.now()
          bufferEvent({ type: 'session_start', path: pathname, normalizedPath })
          bufferEvent({ type: 'page_view', path: pathname, normalizedPath })
          capturePerformance(pathname, normalizedPath)
          lastPageViewPath = normalizedPath
        }
      })

      router.afterEach((to) => {
        const pathname = safeWin()?.location?.pathname || to.path || '/'
        const normalizedPath = computeNormalizedPath(to)
        meta.normalizedPath = normalizedPath
        if (normalizedPath !== lastPageViewPath) {
          bufferEvent({ type: 'page_view', path: pathname, normalizedPath })
          capturePerformance(pathname, normalizedPath)
          lastPageViewPath = normalizedPath
        }
      })

      app.provide('__watchlog_rum__', WatchlogRUM)
    },
  }
}

export default WatchlogRUM
