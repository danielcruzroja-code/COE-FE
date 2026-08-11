/**
 * offlineSync.js – Sistema de sincronización offline para reportes de campo
 *
 * Almacena cambios en localStorage cuando no hay internet y los envía
 * automáticamente al servidor cuando la conexión se restablece.
 */
import api from './api.js'

const QUEUE_KEY = 'coe_pending_sync'
const DRAFT_KEY = 'coe_campo_draft'

// ── Estado reactivo ──────────────────────────────────────────────────────────
let _listeners = []

export const offlineState = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  syncing: false,
  pendingCount: 0,
  lastSyncResult: null, // { ok: number, failed: number } | null
}

function notify () {
  _listeners.forEach(fn => fn({ ...offlineState }))
}

export function onOfflineChange (fn) {
  _listeners.push(fn)
  return () => { _listeners = _listeners.filter(l => l !== fn) }
}

// ── Cola de pendientes (localStorage) ────────────────────────────────────────
function getQueue () {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch { return [] }
}

function setQueue (queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  offlineState.pendingCount = queue.length
  notify()
}

/**
 * Encola una petición para enviarla más tarde (o la envía ya si hay red).
 */
export function enqueue (item) {
  // item = { emergenciaId, payload, finalizar, timestamp }
  const queue = getQueue()
  queue.push({ ...item, timestamp: Date.now() })
  setQueue(queue)
}

// ── Borrador local del formulario ────────────────────────────────────────────
export function saveDraft (emergenciaId, formData) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ emergenciaId, data: formData, savedAt: Date.now() }))
  } catch { /* storage full – ignore */ }
}

export function loadDraft (emergenciaId) {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw)
    if (draft.emergenciaId === emergenciaId) return draft.data
    return null
  } catch { return null }
}

export function clearDraft () {
  localStorage.removeItem(DRAFT_KEY)
}

// ── Sincronización ───────────────────────────────────────────────────────────
export async function syncPending () {
  const queue = getQueue()
  if (queue.length === 0) return

  offlineState.syncing = true
  notify()

  let ok = 0
  let failed = 0
  const remaining = []

  for (const item of queue) {
    try {
      if (item.type === 'create-emergencia') {
        await api.post('/emergencias', item.payload)
      } else {
        await api.patch(`/emergencias/${item.emergenciaId}/reporte-campo`, {
          ...item.payload,
          finalizar: item.finalizar || false
        })
      }
      ok++
    } catch (err) {
      // Si el error es un 404 (emergencia cerrada/borrada) descartamos
      if (err.response?.status === 404) {
        ok++ // la consideramos resuelta
      } else {
        failed++
        remaining.push(item)
      }
    }
  }

  setQueue(remaining)
  offlineState.syncing = false
  offlineState.lastSyncResult = { ok, failed }
  notify()

  // Limpiar resultado después de 6 s
  setTimeout(() => {
    offlineState.lastSyncResult = null
    notify()
  }, 6000)
}

// ── Listeners de red (online/offline) ────────────────────────────────────────
function handleOnline () {
  offlineState.isOnline = true
  notify()
  // Intentar sincronizar al reconectar
  syncPending()
}

function handleOffline () {
  offlineState.isOnline = false
  notify()
}

export function initOfflineSync () {
  offlineState.pendingCount = getQueue().length
  offlineState.isOnline = navigator.onLine
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  notify()
}

export function destroyOfflineSync () {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  _listeners = []
}
