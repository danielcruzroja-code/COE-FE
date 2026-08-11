import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { emergenciasService } from '@/services/emergencias.service.js'

export const useEmergenciasStore = defineStore('emergencias', () => {
  // ── Estado ─────────────────────────────────────────────────────────────────
  const emergencias = ref([])
  const emergenciaActiva = ref(null)
  const cargando = ref(false)
  const error = ref(null)

  // ── Getters ────────────────────────────────────────────────────────────────
  const totalActivas = computed(() => emergencias.value.length)
  const sinAsignar = computed(
    () => emergencias.value.filter((e) => e.estado === 'nuevo').length
  )
  const conteos = computed(() => ({
    nuevo: emergencias.value.filter((e) => e.estado === 'nuevo').length,
    asignado: emergencias.value.filter((e) => e.estado === 'asignado').length,
    en_atencion: emergencias.value.filter((e) => e.estado === 'en_atencion').length,
  }))

  // ── Acciones ───────────────────────────────────────────────────────────────
  const cargarActivas = async () => {
    cargando.value = true
    error.value = null
    try {
      emergencias.value = await emergenciasService.activas()
    } catch (err) {
      error.value = err.response?.data?.mensaje || 'Error al cargar emergencias'
    } finally {
      cargando.value = false
    }
  }

  const obtenerPorId = async (id) => {
    cargando.value = true
    try {
      emergenciaActiva.value = await emergenciasService.obtener(id)
    } catch (err) {
      error.value = err.response?.data?.mensaje || 'Error al cargar emergencia'
    } finally {
      cargando.value = false
    }
  }

  const crear = async (payload) => {
    error.value = null

    // ── Si no hay internet, encolar creación localmente ──
    if (!navigator.onLine) {
      const { enqueue } = await import('@/services/offlineSync.js')
      const localId = 'temp_' + Date.now()
      
      const localEmergencia = {
        _id: localId,
        folio: `TEMP-${Date.now().toString().slice(-4)}`,
        tipo: payload.tipo,
        subtipo: payload.subtipo,
        prioridad: payload.prioridad,
        ubicacion: payload.ubicacion,
        estado: 'nuevo',
        tiempoReporte: new Date().toISOString(),
        personas: payload.personas || 0,
        animales: payload.animales || 0,
        notas: payload.notas || ''
      }
      
      enqueue({
        type: 'create-emergencia',
        payload
      })

      // Agregar a la lista para visualización local
      agregarNueva(localEmergencia)
      return { exito: true, emergencia: localEmergencia, offline: true }
    }

    try {
      const nueva = await emergenciasService.crear(payload)
      agregarNueva(nueva)
      return { exito: true, emergencia: nueva }
    } catch (err) {
      const msg = err.response?.data?.mensaje || 'Error al crear emergencia'
      error.value = msg
      return { exito: false, error: msg }
    }
  }

  const actualizar = async (id, payload) => {
    error.value = null
    try {
      const actualizada = await emergenciasService.actualizar(id, payload)
      const idx = emergencias.value.findIndex((e) => e._id === id)
      if (idx !== -1) emergencias.value[idx] = actualizada
      if (emergenciaActiva.value?._id === id) emergenciaActiva.value = actualizada
      return { exito: true }
    } catch (err) {
      error.value = err.response?.data?.mensaje || 'Error al actualizar'
      return { exito: false }
    }
  }

  const asignarUnidad = async (emergenciaId, unidadId) => {
    try {
      const actualizada = await emergenciasService.asignarUnidad(emergenciaId, unidadId)
      const idx = emergencias.value.findIndex((e) => e._id === emergenciaId)
      if (idx !== -1) emergencias.value[idx] = actualizada
      if (emergenciaActiva.value?._id === emergenciaId) emergenciaActiva.value = actualizada
      return { exito: true }
    } catch (err) {
      return { exito: false, error: err.response?.data?.mensaje }
    }
  }

  const cambiarEstado = async (id, estado) => {
    try {
      const actualizada = await emergenciasService.cambiarEstado(id, estado)
      if (estado === 'cerrado') {
        emergencias.value = emergencias.value.filter((e) => e._id !== id)
      } else {
        const idx = emergencias.value.findIndex((e) => e._id === id)
        if (idx !== -1) emergencias.value[idx] = actualizada
      }
      if (emergenciaActiva.value?._id === id) {
        emergenciaActiva.value = estado === 'cerrado' ? null : actualizada
      }
      return { exito: true }
    } catch (err) {
      return { exito: false, error: err.response?.data?.mensaje }
    }
  }

  // Socket.io — actualizar en tiempo real
  const aplicarActualizacion = (emergencia) => {
    const idx = emergencias.value.findIndex((e) => e._id === emergencia._id)
    if (idx !== -1) {
      emergencias.value.splice(idx, 1, emergencia)
    }
    if (emergenciaActiva.value?._id === emergencia._id) {
      emergenciaActiva.value = { ...emergencia }
    }
  }

  const agregarNueva = (emergencia) => {
    // Guard contra duplicados: solo insertar si no existe
    const existe = emergencias.value.some((e) => e._id === emergencia._id)
    if (!existe) {
      emergencias.value.unshift(emergencia)
    }
  }

  return {
    emergencias,
    emergenciaActiva,
    cargando,
    error,
    totalActivas,
    sinAsignar,
    conteos,
    cargarActivas,
    obtenerPorId,
    crear,
    actualizar,
    asignarUnidad,
    cambiarEstado,
    aplicarActualizacion,
    agregarNueva,
  }
})
