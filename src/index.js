// src/lib/watchlog-rum-vue/index.js
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

// ===== Helpers =====
const now = () => Date.now()
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
  return pattern.startsWith('/') ? pattern : `/${pattern}`
}

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
    ts: now(),
    seq: ++_seq,
    context: buildContext(path, normalizedPath),
    data
  }
}

// ===== Buffering (envelope with context/data) =====
function bufferEvent(event) {
  const { type, path, normalizedPath, ...rest } = event

  if (type === 'error') {
    const key = `${rest.event || 'err'}:${rest.label || ''}:${normalizedPath || ''}`
    if (_recentErrors.has(key)) return
    _recentErrors.add(key)
    setTimeout(() => _recentErrors.delete(key), 3000)
  }

  // map to data payload
  let data
  switch (type) {
    case 'page_view':
      data = { name: 'page_view' }
      break
    case 'session_start':
      data = { name: 'session_start' }
      break
    case 'session_end':
      data = { name: 'session_end', duration: rest?.duration ?? null }
      break
    case 'performance':
      data = { name: 'performance', metrics: rest?.metrics || {} }
      break
    case 'custom':
      data = { name: rest.metric, value: rest.value ?? 1, extra: rest.extra ?? null }
      break
    case 'error':
      data = {
        name: rest.event || 'error',
        message: rest.label || 'error',
        stack: rest.stack || null,
      }
      break
    default:
      data = { ...rest }
  }

  const env = makeEnvelope(type, path, normalizedPath, data)
  buffer.push(env)

  if (WatchlogRUM.debug) console.log('[Watchlog RUM][vue] buffered:', env)
  if (buffer.length >= 10) flush()
}

// ===== Performance =====
function capturePerformance(pathname, normalizedPath) {
  const w = safeWin()
  if (!w || !w.performance) return
  try {
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
      return
    }
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
    }
  } catch { /* ignore */ }
}

// ===== Global/unload handlers =====
function handleBeforeUnload() {
  const w = safeWin()
  if (!w) return
  const duration = sessionStartTime ? Math.round((now() - sessionStartTime) / 1000) : null
  bufferEvent({
    type: 'session_end',
    path: w.location?.pathname || '/',
    normalizedPath: meta.normalizedPath,
    duration,
  })
  flush(true)
  clearInterval(flushTimer)
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

// ===== Transport (MATCH server) =====
// Server expects wrapper with {apiKey, app, sdk, version, sentAt, sessionId, deviceId, environment, release, events}
function flush(sync = false) {
  if (!buffer.length) return
  const events = buffer.splice(0, buffer.length)
  const w = safeWin()
  if (!w) return

  const wrapper = {
    apiKey: meta.apiKey,                // for requireKeyAndApp
    app: meta.app,                      // for requireKeyAndApp
    sdk: 'watchlog-rum-vue',
    version: '0.2.0',
    sentAt: now(),
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
      'X-Watchlog-Key': meta.apiKey // هم هدر، هم بدنه
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
      w.fetch(WatchlogRUM.endpoint, {
        method: 'POST',
        headers,
        body,
        keepalive: true
      })
    }
  } catch (err) {
    if (WatchlogRUM.debug) console.warn('[Watchlog RUM][vue] flush error:', err)
  }
}

// ===== Core SDK =====
function registerListeners(config) {
  const w = safeWin()
  if (!w) return false

  const {
    apiKey, endpoint, app,
    debug = false, flushInterval = 10000,
    environment, release
  } = config || {}

  if (!apiKey || !endpoint || !app) {
    console.warn('[Watchlog RUM] apiKey, endpoint, and app are required.')
    return false
  }

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

  WatchlogRUM.debug = debug
  WatchlogRUM.endpoint = endpoint

  if (!w.__watchlog_listeners_registered) {
    w.addEventListener('error', onErrorGlobal)
    w.addEventListener('unhandledrejection', onRejectionGlobal)
    w.addEventListener('beforeunload', handleBeforeUnload)
    w.__watchlog_listeners_registered = true
  }

  clearInterval(flushTimer)
  flushTimer = setInterval(() => flush(), flushInterval)

  return true
}

// ===== Public API =====
function custom(metric, value = 1, extra = null) {
  if (typeof metric !== 'string') return
  const w = safeWin()
  const path = w?.location?.pathname || '/'
  const normalizedPath = meta.normalizedPath
  bufferEvent({ type: 'custom', metric, value, extra, path, normalizedPath })
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

  meta.normalizedPath = computeNormalizedPath(route)

  onMounted(() => {
    registerListeners(config)

    if (!initialized.value) {
      sessionStartTime = now()
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
        sessionStartTime = now()
        bufferEvent({ type: 'session_start', path: pathname, normalizedPath })
        bufferEvent({ type: 'page_view', path: pathname, normalizedPath })
        capturePerformance(pathname, normalizedPath)
        lastPageViewPath = normalizedPath
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
