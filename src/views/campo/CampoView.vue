<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, watch } from 'vue'
import { useAuthStore } from '@/stores/auth.js'
import { useGeolocalizacion } from '@/composables/useGeolocalizacion.js'
import { useSocket } from '@/composables/useSocket.js'
import api from '@/services/api.js'
import {
  offlineState,
  onOfflineChange,
  initOfflineSync,
  destroyOfflineSync,
  enqueue,
  saveDraft,
  loadDraft,
  clearDraft,
  syncPending
} from '@/services/offlineSync.js'

// ── Estado de conexión reactivo ──────────────────────────────────────────────
const conexion = reactive({
  isOnline: navigator.onLine,
  syncing: false,
  pendingCount: 0,
  lastSyncResult: null
})

const auth = useAuthStore()
const { getSocket, initSocket, disconnectSocket } = useSocket()
const { rastreando, latitud, longitud, error: gpsError, iniciarRastreo, detenerRastreo } = useGeolocalizacion()

const cargando = ref(false)
const enviandoReporte = ref(false)
const unidadInfo = ref(null)
const emergenciaAsignada = ref(null)

// Estatus de la unidad
const estadoActual = computed(() => unidadInfo.value?.estado || 'disponible')

const estadoLabel = {
  disponible: 'Disponible en Base',
  en_camino: 'En Camino al Incidente',
  en_escena: 'Trabajando en Escena',
  regresando: 'Retornando a Base',
  fuera_de_servicio: 'Fuera de Servicio',
}

const estadoClase = {
  disponible: 'bg-verde',
  en_camino: 'bg-azul',
  en_escena: 'bg-rojo',
  regresando: 'bg-indigo',
  fuera_de_servicio: 'bg-gris',
}

// ── Determinar Categoría Dinámica de Emergencia ──────────────────────────────
const tipoCategoria = computed(() => {
  if (!emergenciaAsignada.value) return 'general'
  const texto = `${emergenciaAsignada.value.tipo || ''} ${emergenciaAsignada.value.subtipo || ''}`.toLowerCase()

  if (texto.includes('choque') || texto.includes('accidente') || texto.includes('vehicular') || texto.includes('atropellamiento') || texto.includes('volcadura')) {
    return 'vehicular'
  }
  if (texto.includes('abeja') || texto.includes('panal') || texto.includes('enjambre') || texto.includes('fauna')) {
    return 'fauna'
  }
  if (texto.includes('incendio') || texto.includes('fuego') || texto.includes('humo') || texto.includes('explosion')) {
    return 'incendio'
  }
  if (texto.includes('gas') || texto.includes('fuga') || texto.includes('quimico') || texto.includes('hazmat') || texto.includes('toxico')) {
    return 'gas'
  }
  return 'general'
})

// ── Formulario Dinámico de Campo ──────────────────────────────────────────────
const formReporte = ref({
  oficialCargo: '',
  descripcionLlegada: '',
  entrevistado: { nombre: '', tipo: '', refiere: '' },
  planAccion: '',
  objetivos: '',
  estrategias: '',
  tacticas: '',
  mando: { cmdteIncidente: '', seguridad: '', operaciones: '', planificacion: '', logistica: '' },
  recursosNecesarios: '',
  mensajeSeguridad: '',
  posiblesCausas: '',
  danosVisibles: '',
  perdidasEvitadas: false,
  victimasTotal: 0,
  lesionados: 0,
  lesionadosDetalle: {
    ilesos: 0,
    leves: 0,
    regulares: 0,
    graves: 0,
    prensados: 0
  },
  fallecidos: 0,
  rescatados: 0,
  observacionesVictimas: '',
  trasladadosPor: '',
  dependenciasPresentes: [],
  primerRespondiente: '',
  primerInterviniente: '',
  personalAsistente: '',
  consumoTotal: '',
  aCargoAlRetiro: '',
  bienesEntregadosA: '',
  observacionesGenerales: '',
  detallesEspecificos: {},
  vehiculosInvolucrados: [],
  imagenEscenaUrl: '',
})

// Opciones de dependencias para el array "dependenciasPresentes"
const dependenciasOpciones = [
  'Policía Municipal de Zapopan',
  'Policía Vial / Tránsito Jalisco',
  'Comisaría General / C4',
  'Servicios Médicos Municipales (Cruz Verde)',
  'Inspección y Vigilancia',
  'Servicio Médicos Forenses (SEMEFO)',
  'Guardia Nacional / Ejército',
  'CFE',
  'SIAPA'
]

const nuevaDependencia = ref({ nombre: '', unidad: '', aCargo: '' })
const agregarDependencia = () => {
  if (!nuevaDependencia.value.nombre) return
  formReporte.value.dependenciasPresentes.push({ ...nuevaDependencia.value })
  nuevaDependencia.value = { nombre: '', unidad: '', aCargo: '' }
}
const eliminarDependencia = (idx) => {
  formReporte.value.dependenciasPresentes.splice(idx, 1)
}

// Agregar vehículo en caso vehicular
const nuevoVehiculo = ref({ tipo: 'Automóvil', marca: '', modelo: '', placas: '', color: '', conductor: '', impactoCon: '' })
const agregarVehiculo = () => {
  if (!nuevoVehiculo.value.placas && !nuevoVehiculo.value.marca) return
  formReporte.value.vehiculosInvolucrados.push({ ...nuevoVehiculo.value })
  nuevoVehiculo.value = { tipo: 'Automóvil', marca: '', modelo: '', placas: '', color: '', conductor: '', impactoCon: '' }
}

const eliminarVehiculo = (idx) => {
  formReporte.value.vehiculosInvolucrados.splice(idx, 1)
}

// Cargar información de la unidad y su emergencia asignada
const cargarDatos = async () => {
  if (!auth.usuario?.unidadAsignada) return
  cargando.value = true
  try {
    const resUnidad = await api.get(`/unidades/${auth.usuario.unidadAsignada}`)
    unidadInfo.value = resUnidad.data

    const resEmergencias = await api.get('/emergencias/activas')
    const asignada = resEmergencias.data.find(
      (e) => e.unidadAsignada?._id === auth.usuario.unidadAsignada
    )
    emergenciaAsignada.value = asignada || null

    if (asignada?.reporteCampo) {
      const rc = asignada.reporteCampo
      formReporte.value = {
        ...formReporte.value,
        ...rc,
        entrevistado: rc.entrevistado || { nombre: '', tipo: '', refiere: '' },
        lesionadosDetalle: rc.lesionadosDetalle || { ilesos: 0, leves: 0, regulares: 0, graves: 0, prensados: 0 },
        mando: rc.mando || { cmdteIncidente: '', seguridad: '', operaciones: '', planificacion: '', logistica: '' },
        dependenciasPresentes: rc.dependenciasPresentes || [],
        vehiculosInvolucrados: rc.vehiculosInvolucrados || [],
        detallesEspecificos: rc.detallesEspecificos || {}
      }
    }
  } catch (e) {
    console.error('Error cargando datos de campo:', e)
  } finally {
    cargando.value = false
  }
}

// Acciones del Servicio
const aceptarServicio = async () => {
  if (!emergenciaAsignada.value?._id) return
  if ('vibrate' in navigator) navigator.vibrate([60, 40, 60])

  try {
    cargando.value = true
    const res = await api.patch(`/emergencias/${emergenciaAsignada.value._id}/aceptar`)
    emergenciaAsignada.value = res.data
    await cambiarEstado('en_camino')
  } catch (e) {
    console.error('Error al aceptar servicio:', e)
  } finally {
    cargando.value = false
  }
}

// Cambiar estado operativo de la unidad
const cambiarEstado = async (nuevoEstado) => {
  if (!auth.usuario?.unidadAsignada) return
  if ('vibrate' in navigator) navigator.vibrate(40)

  try {
    const res = await api.patch(`/unidades/${auth.usuario.unidadAsignada}/estado`, {
      estado: nuevoEstado
    })
    unidadInfo.value = res.data

    const socket = getSocket()
    if (socket) {
      socket.emit('unidad:estado', {
        unidadId: auth.usuario.unidadAsignada,
        estado: nuevoEstado
      })
    }

    if (nuevoEstado === 'en_escena' && emergenciaAsignada.value?._id) {
      try {
        const resEm = await api.patch(`/emergencias/${emergenciaAsignada.value._id}/estado`, {
          estado: 'en_atencion'
        })
        emergenciaAsignada.value = resEm.data
      } catch (emErr) {
        console.warn('Error al actualizar a en_atencion:', emErr)
      }
    }

    if (nuevoEstado === 'disponible' || nuevoEstado === 'regresando') {
      await cargarDatos()
    }
  } catch (e) {
    console.error('Error al cambiar de estado:', e)
  }
}

// Carga de Fotografía en Base64
const manejarCargaImagen = (event) => {
  const file = event.target.files[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    formReporte.value.imagenEscenaUrl = e.target.result
  }
  reader.readAsDataURL(file)
}

// Guardar el reporte de campo y opcionalmente finalizar (con soporte offline)
const guardarReporteCampo = async (finalizar = false) => {
  if (!emergenciaAsignada.value?._id) return
  if ('vibrate' in navigator) navigator.vibrate(80)

  const payload = { ...formReporte.value }
  const emId = emergenciaAsignada.value._id

  // ── SIN CONEXIÓN: guardar en cola local ──
  if (!navigator.onLine) {
    enqueue({ emergenciaId: emId, payload, finalizar })
    saveDraft(emId, payload)

    if (finalizar) {
      alert('📴 Sin conexión. El reporte final se enviará automáticamente cuando recuperes la señal.')
    } else {
      alert('📴 Sin conexión. Los datos se guardaron en tu dispositivo y se enviarán al reconectar.')
    }
    enviandoReporte.value = false
    return
  }

  // ── CON CONEXIÓN: enviar normalmente ──
  try {
    enviandoReporte.value = true
    await api.patch(`/emergencias/${emId}/reporte-campo`, {
      ...payload,
      finalizar
    })

    clearDraft()

    if (finalizar) {
      await cambiarEstado('disponible')
      emergenciaAsignada.value = null
      await cargarDatos()
    } else {
      alert('✅ Reporte de campo guardado correctamente')
    }
  } catch (e) {
    console.error('Error al guardar reporte de campo:', e)
    // Si falla la red durante el envío, encolar
    if (!navigator.onLine || e.code === 'ERR_NETWORK') {
      enqueue({ emergenciaId: emId, payload, finalizar })
      saveDraft(emId, payload)
      alert('📴 Se perdió la conexión. Los datos se guardaron localmente y se enviarán al reconectar.')
    } else {
      alert('❌ Error al guardar el reporte de campo')
    }
  } finally {
    enviandoReporte.value = false
  }
}

// Transmitir coordenadas GPS por socket
const transmitirUbicacion = (coords) => {
  const socket = getSocket()
  if (!auth.usuario?.unidadAsignada || !socket) return
  socket.emit('ubicacion:update', {
    unidadId: auth.usuario.unidadAsignada,
    lat: coords.lat,
    lng: coords.lng
  })
}

// Google Maps Route URL helper
const googleMapsUrl = computed(() => {
  if (!emergenciaAsignada.value?.ubicacion) return '#'
  const u = emergenciaAsignada.value.ubicacion
  if (u.lat && u.lng) {
    return `https://www.google.com/maps/search/?api=1&query=${u.lat},${u.lng}`
  }
  const query = encodeURIComponent(u.direccionCompleta || `${u.calle}, Zapopan, Jalisco`)
  return `https://www.google.com/maps/search/?api=1&query=${query}`
})

const formatearHora = (isoStr) => {
  if (!isoStr) return '--:--'
  const d = new Date(isoStr)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Auto-guardar borrador local cada 30s mientras hay emergencia
let draftInterval = null

onMounted(async () => {
  // Iniciar sistema offline
  initOfflineSync()
  const unsubOffline = onOfflineChange((state) => {
    conexion.isOnline = state.isOnline
    conexion.syncing = state.syncing
    conexion.pendingCount = state.pendingCount
    conexion.lastSyncResult = state.lastSyncResult
  })

  initSocket()
  await cargarDatos()
  iniciarRastreo(transmitirUbicacion)

  // Restaurar borrador local si existe
  if (emergenciaAsignada.value?._id) {
    const draft = loadDraft(emergenciaAsignada.value._id)
    if (draft) {
      formReporte.value = { ...formReporte.value, ...draft }
      console.log('📋 Borrador local restaurado')
    }
  }

  // Auto-save draft cada 30s
  draftInterval = setInterval(() => {
    if (emergenciaAsignada.value?._id) {
      saveDraft(emergenciaAsignada.value._id, { ...formReporte.value })
    }
  }, 30000)

  // Si hay pendientes y estamos online, sincronizar
  if (navigator.onLine) {
    syncPending()
  }

  const socket = getSocket()
  if (socket) {
    socket.on('emergencia:actualizada', async (em) => {
      if (em.unidadAsignada?._id === auth.usuario.unidadAsignada) {
        emergenciaAsignada.value = em
      } else if (emergenciaAsignada.value?._id === em._id) {
        emergenciaAsignada.value = null
      }
    })
    socket.on('emergencia:nueva', async () => {
      await cargarDatos()
    })
  }
})

onUnmounted(() => {
  detenerRastreo()
  destroyOfflineSync()
  if (draftInterval) clearInterval(draftInterval)
  
  const socket = getSocket()
  if (socket) {
    socket.off('emergencia:actualizada')
    socket.off('emergencia:nueva')
  }
  disconnectSocket()
})
</script>

<template>
  <div class="campo-view">
    <!-- ══ Banner de Conexión Offline/Online ══ -->
    <transition name="banner-slide">
      <div v-if="!conexion.isOnline" class="offline-banner offline">
        <div class="offline-banner-icon">📴</div>
        <div class="offline-banner-text">
          <strong>Sin conexión a internet</strong>
          <span>Los cambios se guardarán en tu dispositivo y se enviarán automáticamente cuando recuperes la señal.</span>
        </div>
      </div>

      <div v-else-if="conexion.syncing" class="offline-banner syncing">
        <div class="offline-banner-icon spinner-sync">⟳</div>
        <div class="offline-banner-text">
          <strong>Sincronizando reportes pendientes...</strong>
          <span>Enviando {{ conexion.pendingCount }} reporte(s) guardados localmente.</span>
        </div>
      </div>

      <div v-else-if="conexion.lastSyncResult" class="offline-banner success">
        <div class="offline-banner-icon">✅</div>
        <div class="offline-banner-text">
          <strong>Sincronización completada</strong>
          <span>{{ conexion.lastSyncResult.ok }} reporte(s) enviados correctamente{{ conexion.lastSyncResult.failed > 0 ? `, ${conexion.lastSyncResult.failed} fallido(s)` : '' }}.</span>
        </div>
      </div>

      <div v-else-if="conexion.pendingCount > 0 && conexion.isOnline" class="offline-banner pending">
        <div class="offline-banner-icon">⏳</div>
        <div class="offline-banner-text">
          <strong>{{ conexion.pendingCount }} reporte(s) pendientes de envío</strong>
          <span>Se sincronizarán en breve.</span>
        </div>
      </div>
    </transition>

    <!-- Estatus GPS -->
    <div class="gps-card" :class="{ 'gps-error': gpsError }">
      <div class="gps-status-indicator">
        <span class="ping-dot" :class="{ running: rastreando && !gpsError, error: gpsError }"></span>
        <span class="texto-xs font-bold uppercase letter-spacing">
          {{ gpsError ? 'Error GPS' : (rastreando ? 'Transmitiendo ubicación' : 'GPS inactivo') }}
        </span>
      </div>
      <div v-if="gpsError" class="gps-error-msg texto-xs">
        {{ gpsError }}
      </div>
      <div v-else-if="latitud && longitud" class="gps-coords texto-xs">
        <span>Lat: {{ latitud.toFixed(5) }}</span>
        <span>Lng: {{ longitud.toFixed(5) }}</span>
      </div>
    </div>

    <!-- Estatus Actual -->
    <div class="status-indicator-hero" :class="estadoClase[estadoActual]">
      <span class="indicator-label">Estado Actual de la Unidad</span>
      <h2 class="indicator-value">{{ estadoLabel[estadoActual] }}</h2>
    </div>

    <!-- Secciones de emergencia asignada -->
    <div class="emergencia-card blur-effect" v-if="emergenciaAsignada">
      <div class="card-tag alert-red">SERVICIO ASIGNADO</div>
      <div class="card-header">
        <span class="folio-tag">{{ emergenciaAsignada.folio }}</span>
        <span class="chip chip-critica uppercase">{{ emergenciaAsignada.prioridad }}</span>
      </div>
      <h3 class="emergencia-tipo">{{ emergenciaAsignada.subtipo || emergenciaAsignada.tipo }}</h3>
      
      <div class="info-block">
        <span class="label">Dirección</span>
        <p class="value">{{ emergenciaAsignada.ubicacion?.direccionCompleta || emergenciaAsignada.ubicacion?.calle || 'Sin dirección' }}</p>
      </div>

      <div v-if="emergenciaAsignada.ubicacion?.referencias" class="info-block">
        <span class="label">Referencias</span>
        <p class="value text-amber">{{ emergenciaAsignada.ubicacion.referencias }}</p>
      </div>

      <!-- Timestamps de Atención -->
      <div class="timestamps-grid">
        <div class="ts-box">
          <span class="ts-label">Reportado</span>
          <span class="ts-val">{{ formatearHora(emergenciaAsignada.tiempoReporte) }}</span>
        </div>
        <div class="ts-box">
          <span class="ts-label">Aceptado</span>
          <span class="ts-val text-green">{{ formatearHora(emergenciaAsignada.tiempoAceptacion) }}</span>
        </div>
      </div>

      <!-- BOTÓN DE ACEPTAR SERVICIO -->
      <button 
        v-if="!emergenciaAsignada.tiempoAceptacion"
        @click="aceptarServicio"
        class="btn btn-aceptar w-full"
        :disabled="cargando"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="20" height="20">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        ACEPTAR Y ATENDER EMERGENCIA
      </button>

      <!-- Botón de navegación Google Maps -->
      <a :href="googleMapsUrl" target="_blank" class="btn btn-primario btn-maps w-full text-center">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
        Navegar con Google Maps
      </a>

      <!-- ── FORMULARIO DINÁMICO DE CAMPO ──────────────────────────────────── -->
      <div class="formulario-campo-box" v-if="emergenciaAsignada.tiempoAceptacion">
        <div class="form-title">
          <span class="badge-cat">{{ tipoCategoria.toUpperCase() }}</span>
          <h4>Reporte Novedades en Escena</h4>
        </div>

        <div class="form-sections-container">
          
          <!-- SECCIÓN 1: LLEGADA Y EVALUACIÓN -->
          <details class="form-accordion" open>
            <summary>1. Llegada y Evaluación Inicial</summary>
            <div class="accordion-content">
              <div class="form-group">
                <label>Oficial a Cargo de la Unidad</label>
                <input type="text" v-model="formReporte.oficialCargo" class="input-campo" placeholder="Ej. 2do Of. Héctor González" />
              </div>
              <div class="form-group margin-top-sm">
                <label>A su llegada se trataba de:</label>
                <textarea v-model="formReporte.descripcionLlegada" rows="2" class="input-campo" placeholder="Breve descripción de lo encontrado al arribo"></textarea>
              </div>
              
              <div class="sub-box margin-top-sm">
                <label class="font-bold text-xs uppercase text-dim">Entrevista (Quien reporta o atiende)</label>
                <div class="grid-2 margin-top-xs">
                  <input type="text" v-model="formReporte.entrevistado.nombre" class="input-sm" placeholder="Nombre completo" />
                  <input type="text" v-model="formReporte.entrevistado.tipo" class="input-sm" placeholder="Se ostenta como (Propietaria, etc.)" />
                </div>
                <div class="margin-top-xs">
                  <input type="text" v-model="formReporte.entrevistado.refiere" class="input-sm" placeholder="Quien refiere que..." />
                </div>
              </div>
            </div>
          </details>

          <!-- SECCIÓN 2: DATOS ESPECÍFICOS POR CATEGORÍA -->
          <details class="form-accordion" open>
            <summary>2. Datos Específicos ({{ tipoCategoria.toUpperCase() }})</summary>
            <div class="accordion-content">
              
              <!-- CATEGORÍA: VEHICULAR -->
              <div v-if="tipoCategoria === 'vehicular'" class="cat-section">
                <div class="form-group margin-bottom-sm">
                  <label>Tipo de Impacto / Situación</label>
                  <select v-model="formReporte.detallesEspecificos.tipoImpacto" class="input-campo">
                    <option value="Choque entre vehículos">Choque entre vehículos</option>
                    <option value="Choque contra objeto fijo">Choque contra objeto fijo</option>
                    <option value="Volcadura">Volcadura</option>
                    <option value="Atropellado">Atropellado</option>
                  </select>
                </div>

                <div class="vehiculos-box margin-bottom-sm">
                  <label class="font-bold text-xs uppercase text-dim">Vehículos Involucrados</label>
                  <div v-for="(v, idx) in formReporte.vehiculosInvolucrados" :key="idx" class="vehiculo-item">
                    <div style="flex:1">
                      <div>🚘 {{ v.tipo }} — {{ v.marca }} {{ v.modelo }} ({{ v.placas || 'S/P' }}) [{{ v.color }}]</div>
                      <div class="text-xs text-dim">Conductor: {{ v.conductor || 'No especificado' }} | Chocó con: {{ v.impactoCon || 'N/A' }}</div>
                    </div>
                    <button type="button" @click="eliminarVehiculo(idx)" class="btn-del" style="margin-left: 10px;">✕</button>
                  </div>
                  
                  <div class="add-vehiculo-form">
                    <div class="grid-2">
                      <input type="text" placeholder="Marca (ej. Nissan)" v-model="nuevoVehiculo.marca" class="input-sm" />
                      <input type="text" placeholder="Modelo (ej. Versa)" v-model="nuevoVehiculo.modelo" class="input-sm" />
                    </div>
                    <div class="grid-2">
                      <input type="text" placeholder="Placas" v-model="nuevoVehiculo.placas" class="input-sm" />
                      <input type="text" placeholder="Color" v-model="nuevoVehiculo.color" class="input-sm" />
                    </div>
                    <div class="grid-2">
                      <input type="text" placeholder="Nombre Conductor" v-model="nuevoVehiculo.conductor" class="input-sm" />
                      <input type="text" placeholder="Chocó contra..." v-model="nuevoVehiculo.impactoCon" class="input-sm" />
                    </div>
                    <button type="button" @click="agregarVehiculo" class="btn-add w-full">+ Añadir Vehículo</button>
                  </div>
                </div>

                <div class="sub-box margin-bottom-sm">
                  <label class="font-bold text-xs uppercase text-dim">Personas y Lesionados</label>
                  <div class="grid-4 text-center">
                    <div class="stat-box"><label class="text-xs">Ilesos</label><input type="number" min="0" v-model.number="formReporte.lesionadosDetalle.ilesos" class="input-campo text-center"/></div>
                    <div class="stat-box"><label class="text-xs text-green">Leves</label><input type="number" min="0" v-model.number="formReporte.lesionadosDetalle.leves" class="input-campo text-center"/></div>
                    <div class="stat-box"><label class="text-xs text-amber">Regulares</label><input type="number" min="0" v-model.number="formReporte.lesionadosDetalle.regulares" class="input-campo text-center"/></div>
                    <div class="stat-box"><label class="text-xs text-rojo">Graves</label><input type="number" min="0" v-model.number="formReporte.lesionadosDetalle.graves" class="input-campo text-center"/></div>
                  </div>
                  <div class="grid-2 text-center margin-top-xs">
                    <div class="stat-box"><label class="text-xs">Prensados/Rescatados</label><input type="number" min="0" v-model.number="formReporte.lesionadosDetalle.prensados" class="input-campo text-center"/></div>
                    <div class="stat-box"><label class="text-xs text-rojo">Fallecidos</label><input type="number" min="0" v-model.number="formReporte.fallecidos" class="input-campo text-center"/></div>
                  </div>
                </div>
                
                <div class="form-group">
                  <label>Riesgos Adicionales (Ej. Derrame de combustible)</label>
                  <input type="text" v-model="formReporte.detallesEspecificos.riesgosAdicionales" class="input-campo" placeholder="Derrame de aceite, postes caídos..." />
                </div>
              </div>

              <!-- CATEGORÍA: FAUNA -->
              <div v-else-if="tipoCategoria === 'fauna'" class="cat-section">
                <div class="form-group">
                  <label>Tipo de Fauna</label>
                  <input type="text" v-model="formReporte.detallesEspecificos.tipoFauna" class="input-campo" placeholder="Ej. Abejas, Serpiente, Perro" />
                </div>
                <div class="form-row margin-top-sm">
                  <div class="form-group">
                    <label>Altura aprox (m)</label>
                    <input type="number" min="0" step="0.5" v-model.number="formReporte.detallesEspecificos.alturaMetros" class="input-campo" />
                  </div>
                  <div class="form-group">
                    <label>Ubicación</label>
                    <select v-model="formReporte.detallesEspecificos.ubicacionPanal" class="input-campo">
                      <option value="Árbol">Árbol</option>
                      <option value="Poste / Cableado">Poste / Cableado</option>
                      <option value="Fachada / Marquesina">Fachada / Marquesina</option>
                      <option value="Interior de Finca">Interior de Finca</option>
                      <option value="Vehículo">Vehículo</option>
                    </select>
                  </div>
                </div>
                <div class="form-group margin-top-sm">
                  <label>Nivel de Agresividad / Riesgo</label>
                  <select v-model="formReporte.detallesEspecificos.agresividad" class="input-campo">
                    <option value="Bajo (Enjambre viajero posado)">Bajo (Enjambre viajero posado)</option>
                    <option value="Medio (Actividad moderada)">Medio (Actividad moderada)</option>
                    <option value="Alto (Ataque activo)">Alto (Ataque activo)</option>
                  </select>
                </div>
                <div class="form-group margin-top-sm">
                  <label>Personas Picadas / Lesionadas</label>
                  <input type="number" min="0" v-model.number="formReporte.lesionados" class="input-campo" />
                </div>
              </div>

              <!-- CATEGORÍA: INCENDIO -->
              <div v-else-if="tipoCategoria === 'incendio'" class="cat-section">
                <div class="form-row">
                  <div class="form-group">
                    <label>Inmueble Afectado</label>
                    <select v-model="formReporte.detallesEspecificos.inmuebleAfectado" class="input-campo">
                      <option value="Casa Habitacional">Casa Habitacional</option>
                      <option value="Comercio / Local">Comercio / Local</option>
                      <option value="Terreno Baldío / Pastizal">Terreno Baldío / Pastizal</option>
                      <option value="Fábrica / Bodega">Fábrica / Bodega</option>
                      <option value="Vehículo">Vehículo</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>¿Requiere Dictamen Técnico?</label>
                    <select v-model="formReporte.detallesEspecificos.requiereDictamen" class="input-campo">
                      <option :value="true">Sí</option>
                      <option :value="false">No</option>
                    </select>
                  </div>
                </div>
                <div class="form-group margin-top-sm">
                  <label>Material / Área Consumida</label>
                  <input type="text" v-model="formReporte.detallesEspecificos.materialConsumido" class="input-campo" placeholder="Ej. 50m2 de maleza seca / Muebles" />
                </div>
                <div class="form-row margin-top-sm">
                  <div class="form-group">
                    <label>Lesionados</label>
                    <input type="number" min="0" v-model.number="formReporte.lesionados" class="input-campo" />
                  </div>
                  <div class="form-group">
                    <label>Fallecidos</label>
                    <input type="number" min="0" v-model.number="formReporte.fallecidos" class="input-campo" />
                  </div>
                  <div class="form-group">
                    <label>Evacuados</label>
                    <input type="number" min="0" v-model.number="formReporte.detallesEspecificos.evacuados" class="input-campo" />
                  </div>
                </div>
              </div>

              <!-- CATEGORÍA: FUGA DE GAS / HAZMAT -->
              <div v-else-if="tipoCategoria === 'gas'" class="cat-section">
                <div class="form-row">
                  <div class="form-group">
                    <label>Sustancia / Producto</label>
                    <select v-model="formReporte.detallesEspecificos.tipoSustancia" class="input-campo">
                      <option value="Gas LP">Gas LP</option>
                      <option value="Gas Natural">Gas Natural</option>
                      <option value="Amoniaco">Amoniaco</option>
                      <option value="Material Peligroso (Otro)">Material Peligroso (Otro)</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Tipo de Contenedor</label>
                    <select v-model="formReporte.detallesEspecificos.tipoContenedor" class="input-campo">
                      <option value="Cilindro (Ej. 30kg)">Cilindro (Ej. 30kg)</option>
                      <option value="Tanque Estacionario">Tanque Estacionario</option>
                      <option value="Tubería / Línea">Tubería / Línea</option>
                      <option value="Pipa / Autotanque">Pipa / Autotanque</option>
                    </select>
                  </div>
                </div>
                
                <div class="form-group margin-top-sm">
                  <label>Causa Probable de la Fuga</label>
                  <select v-model="formReporte.detallesEspecificos.causaFuga" class="input-campo">
                    <option value="Sobre llenado">Sobre llenado</option>
                    <option value="Válvula dañada">Válvula dañada</option>
                    <option value="Manguera rota/dañada">Manguera rota/dañada</option>
                    <option value="Corrosión / Picado">Corrosión / Picado</option>
                    <option value="Desconocido / Otro">Desconocido / Otro</option>
                  </select>
                </div>

                <div class="form-row margin-top-sm">
                  <div class="form-group">
                    <label>Capacidad (L / Kg)</label>
                    <input type="number" min="0" v-model.number="formReporte.detallesEspecificos.capacidadTanque" class="input-campo" placeholder="Ej. 300" />
                  </div>
                  <div class="form-group">
                    <label>Porcentaje (%) al arribo</label>
                    <input type="number" min="0" max="100" v-model.number="formReporte.detallesEspecificos.porcentajeTanque" class="input-campo" placeholder="Ej. 80" />
                  </div>
                </div>

                <div class="form-row margin-top-sm">
                  <div class="form-group">
                    <label>Radio Evacuado (m)</label>
                    <input type="number" min="0" v-model.number="formReporte.detallesEspecificos.radioEvacuacion" class="input-campo" placeholder="Ej. 50" />
                  </div>
                  <div class="form-group">
                    <label>Personas Evacuadas</label>
                    <input type="number" min="0" v-model.number="formReporte.detallesEspecificos.personasEvacuadas" class="input-campo" />
                  </div>
                </div>
                
                <div class="form-group margin-top-sm">
                  <label>Personas Intoxicadas / Lesionadas</label>
                  <input type="number" min="0" v-model.number="formReporte.lesionados" class="input-campo" />
                </div>
              </div>
              
              <!-- GENERAL / OTROS -->
              <div v-else class="cat-section">
                <p class="texto-sm texto-dim">Esta categoría es de propósito general. Por favor, utilice las secciones de abajo para reportar la información (SCI, Víctimas, Daños).</p>
              </div>
            </div>
          </details>

          <!-- SECCIÓN 3: SCI Y TÁCTICAS (Solo para Incendios, Fugas y General - no aplica en choques/fauna rápidos) -->
          <details v-if="tipoCategoria === 'incendio' || tipoCategoria === 'gas' || tipoCategoria === 'general'" class="form-accordion">
            <summary>3. Plan de Acción y SCI (Avanzado)</summary>
            <div class="accordion-content">
              <div class="form-group">
                <label>Plan de Acción como Incidente</label>
                <input type="text" v-model="formReporte.planAccion" class="input-campo" placeholder="Ej. Aseguramiento de la escena y control de riesgos" />
              </div>
              <div class="form-group margin-top-sm">
                <label>Objetivos</label>
                <input type="text" v-model="formReporte.objetivos" class="input-campo" placeholder="Ej. Eliminar fuente de peligro, atención de lesionados" />
              </div>
              <div class="form-group margin-top-sm">
                <label>Estrategias</label>
                <textarea v-model="formReporte.estrategias" rows="2" class="input-campo" placeholder="Ej. Se realiza evaluación física, acordonamiento..."></textarea>
              </div>
              <div class="form-group margin-top-sm">
                <label>Tácticas</label>
                <textarea v-model="formReporte.tacticas" rows="2" class="input-campo" placeholder="Ej. Cierre de vialidades, despliegue de líneas..."></textarea>
              </div>

              <div class="sub-box margin-top-sm">
                <label class="font-bold text-xs uppercase text-dim">Funciones de Mando (SCI)</label>
                <div class="grid-2 margin-top-xs">
                  <div class="form-group"><label>Cmdte. Incidente</label><input type="text" v-model="formReporte.mando.cmdteIncidente" class="input-sm"/></div>
                  <div class="form-group"><label>Seguridad</label><input type="text" v-model="formReporte.mando.seguridad" class="input-sm"/></div>
                  <div class="form-group"><label>Operaciones</label><input type="text" v-model="formReporte.mando.operaciones" class="input-sm"/></div>
                  <div class="form-group"><label>Planificación</label><input type="text" v-model="formReporte.mando.planificacion" class="input-sm"/></div>
                </div>
              </div>
              <div class="form-group margin-top-sm">
                <label>Mensaje de Seguridad / Observaciones</label>
                <input type="text" v-model="formReporte.mensajeSeguridad" class="input-campo" placeholder="Ej. Riesgo de explosión, intoxicación" />
              </div>
            </div>
          </details>

          <!-- SECCIÓN: VÍCTIMAS Y TRASLADOS (Solo para categorías que NO manejan víctimas en su propia sección) -->
          <details v-if="tipoCategoria !== 'vehicular' && tipoCategoria !== 'fauna'" class="form-accordion">
            <summary>{{ tipoCategoria === 'incendio' || tipoCategoria === 'gas' ? '4' : '3' }}. Víctimas y Traslados</summary>
            <div class="accordion-content">
              <div class="grid-4 margin-bottom-sm text-center" style="gap:5px">
                <div class="stat-box">
                  <label class="text-xs">Total</label>
                  <input type="number" min="0" v-model.number="formReporte.victimasTotal" class="input-campo text-center font-bold" />
                </div>
                <div class="stat-box">
                  <label class="text-xs text-amber">Lesionados</label>
                  <input type="number" min="0" v-model.number="formReporte.lesionados" class="input-campo text-center font-bold" />
                </div>
                <div class="stat-box">
                  <label class="text-xs text-green">Rescatados</label>
                  <input type="number" min="0" v-model.number="formReporte.rescatados" class="input-campo text-center font-bold" />
                </div>
                <div class="stat-box">
                  <label class="text-xs" style="color:var(--rojo)">Fallecidos</label>
                  <input type="number" min="0" v-model.number="formReporte.fallecidos" class="input-campo text-center font-bold" />
                </div>
              </div>
              
              <div class="form-group margin-top-sm">
                <label>Observaciones y datos de víctimas</label>
                <textarea v-model="formReporte.observacionesVictimas" rows="2" class="input-campo" placeholder="Nombres, estado, etc."></textarea>
              </div>
              <div class="form-group margin-top-sm">
                <label>Fueron trasladadas por:</label>
                <input type="text" v-model="formReporte.trasladadosPor" class="input-campo" placeholder="Ej. Cruz Verde Unidad 34" />
              </div>
            </div>
          </details>

          <!-- Para VEHICULAR: Observaciones de víctimas y traslado (los números ya están arriba) -->
          <details v-if="tipoCategoria === 'vehicular'" class="form-accordion">
            <summary>3. Traslados y Observaciones</summary>
            <div class="accordion-content">
              <div class="form-group">
                <label>Observaciones y datos de víctimas</label>
                <textarea v-model="formReporte.observacionesVictimas" rows="2" class="input-campo" placeholder="Nombres completos de lesionados, estado, hospital destino..."></textarea>
              </div>
              <div class="form-group margin-top-sm">
                <label>Fueron trasladados por:</label>
                <input type="text" v-model="formReporte.trasladadosPor" class="input-campo" placeholder="Ej. Cruz Verde Unidad 34 / Cruz Roja" />
              </div>
            </div>
          </details>

          <!-- SECCIÓN: DAÑOS Y CAUSAS (Solo para Incendio y Gas, no aplica en choques ni fauna) -->
          <details v-if="tipoCategoria === 'incendio' || tipoCategoria === 'gas' || tipoCategoria === 'general'" class="form-accordion">
            <summary>{{ tipoCategoria === 'incendio' || tipoCategoria === 'gas' ? '5' : '4' }}. Daños y Posibles Causas</summary>
            <div class="accordion-content">
              <div class="form-group">
                <label>Las posibles causas se debieron a:</label>
                <input type="text" v-model="formReporte.posiblesCausas" class="input-campo" :placeholder="tipoCategoria === 'gas' ? 'Ej. Válvula en mal estado, manguera rota' : 'Ej. Cortocircuito, descuido'" />
              </div>
              <div class="form-group margin-top-sm">
                <label>Los daños visibles fueron:</label>
                <textarea v-model="formReporte.danosVisibles" rows="2" class="input-campo" placeholder="Daños estructurales, pérdida total, etc."></textarea>
              </div>
            </div>
          </details>

          <!-- SECCIÓN: CIERRE DEL SERVICIO (Siempre visible para todas las categorías) -->
          <details class="form-accordion">
            <summary>{{ tipoCategoria === 'vehicular' ? '4' : tipoCategoria === 'fauna' ? '3' : '6' }}. Cierre del Servicio</summary>
            <div class="accordion-content">
              <div class="form-group">
                <label>Quedando a cargo del servicio a nuestro retiro:</label>
                <input type="text" v-model="formReporte.aCargoAlRetiro" class="input-campo" :placeholder="tipoCategoria === 'vehicular' ? 'Ej. Policía Vial / Seguro' : 'Ej. Nadie a cargo / Policía Municipal'" />
              </div>
              <div class="form-group margin-top-sm">
                <label>Le fue entregado los bienes muebles o inmuebles a:</label>
                <input type="text" v-model="formReporte.bienesEntregadosA" class="input-campo" placeholder="Nombre de la persona que recibe" />
              </div>

              <!-- Dependencias Presentes -->
              <div class="sub-box margin-top-sm">
                <label class="font-bold text-xs uppercase text-dim">Dependencias presentes en el lugar</label>
                <div v-for="(dep, idx) in formReporte.dependenciasPresentes" :key="idx" class="vehiculo-item">
                  <span>🏛️ {{ dep.nombre }} | Unid: {{ dep.unidad || 'N/A' }} | A cargo: {{ dep.aCargo || 'N/A' }}</span>
                  <button type="button" @click="eliminarDependencia(idx)" class="btn-del">✕</button>
                </div>
                <div class="add-vehiculo-form">
                  <select v-model="nuevaDependencia.nombre" class="input-sm margin-bottom-xs" style="background:#1e293b; color:#ffffff; font-size:0.82rem;">
                    <option value="" disabled style="background:#1e293b; color:#94a3b8;">Seleccione dependencia...</option>
                    <option v-for="opt in dependenciasOpciones" :key="opt" :value="opt" style="background:#1e293b; color:#ffffff;">{{ opt }}</option>
                  </select>
                  <div class="grid-2 margin-bottom-xs">
                    <input type="text" placeholder="Unidad(es)" v-model="nuevaDependencia.unidad" class="input-sm" />
                    <input type="text" placeholder="A cargo de" v-model="nuevaDependencia.aCargo" class="input-sm" />
                  </div>
                  <button type="button" @click="agregarDependencia" class="btn-add w-full">+ Añadir Dependencia</button>
                </div>
              </div>

              <div class="form-group margin-top-sm">
                <label>📷 Evidencia / Fotografía de la Escena (Opcional)</label>
                <input type="file" accept="image/*" capture="environment" @change="manejarCargaImagen" class="file-input" />
                <div v-if="formReporte.imagenEscenaUrl" class="img-preview-box">
                  <img :src="formReporte.imagenEscenaUrl" alt="Vista previa de la escena" />
                  <button type="button" @click="formReporte.imagenEscenaUrl = ''" class="btn-remove-img">Quitar Imagen</button>
                </div>
              </div>
            </div>
          </details>

        </div>

        <!-- ACCIONES DE GUARDADO -->
        <div class="grid-2 margin-top-md">
          <button @click="guardarReporteCampo(false)" class="btn btn-secundario" :disabled="enviandoReporte">
            💾 Guardar Avance
          </button>
          <button @click="guardarReporteCampo(true)" class="btn btn-cerrar" :disabled="enviandoReporte">
            🏁 Finalizar y Cerrar Servicio
          </button>
        </div>
      </div>
    </div>

    <div class="emergencia-card-vacia blur-effect text-center" v-else>
      <div class="icon-sleep">💤</div>
      <h4>Sin servicios pendientes</h4>
      <p class="texto-sm texto-muted">Mantente en tu base o zona asignada. El COE te notificará cuando se registre un reporte.</p>
    </div>

    <!-- Botones táctiles grandes para transición de estados -->
    <div class="btn-grid-campo">
      <button 
        class="btn-control disponible" 
        :class="{ active: estadoActual === 'disponible' }"
        @click="cambiarEstado('disponible')"
      >
        <span class="btn-icon">🟢</span>
        <span class="btn-text">Disponible</span>
      </button>

      <button 
        class="btn-control en-camino" 
        :class="{ active: estadoActual === 'en_camino' }"
        @click="cambiarEstado('en_camino')"
      >
        <span class="btn-icon">🔵</span>
        <span class="btn-text">En Camino</span>
      </button>

      <button 
        class="btn-control en-escena" 
        :class="{ active: estadoActual === 'en_escena' }"
        @click="cambiarEstado('en_escena')"
      >
        <span class="btn-icon">🔴</span>
        <span class="btn-text">En Escena</span>
      </button>

      <button 
        class="btn-control regresando" 
        :class="{ active: estadoActual === 'regresando' }"
        @click="cambiarEstado('regresando')"
      >
        <span class="btn-icon">🟣</span>
        <span class="btn-text">Regresando</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.campo-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
}

/* Tarjeta de GPS */
.gps-card {
  background: var(--bg-card);
  border: 1px solid var(--borde);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.gps-card.gps-error {
  border-color: #ef4444;
  background: rgba(239, 68, 68, 0.05);
}

.gps-status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ping-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--texto-dim);
}

.ping-dot.running {
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: gps-ping 1.6s infinite ease-in-out;
}

.ping-dot.error {
  background: #ef4444;
  box-shadow: 0 0 8px #ef4444;
}

@keyframes gps-ping {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.gps-error-msg {
  color: #fca5a5;
  font-weight: 500;
}

.gps-coords {
  display: flex;
  gap: 12px;
  color: var(--texto-blanco);
  font-family: monospace;
}

/* Indicador de estado actual */
.status-indicator-hero {
  border-radius: 12px;
  padding: 16px;
  text-align: center;
  transition: background 0.3s;
}

.indicator-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.7);
  display: block;
  margin-bottom: 2px;
}

.indicator-value {
  font-size: 1.2rem;
  margin: 0;
  color: #fff;
  font-weight: 800;
}

.bg-verde { background: #10b981; }
.bg-azul { background: #3b82f6; }
.bg-rojo { background: #dc2626; }
.bg-indigo { background: #6366f1; }
.bg-gris { background: #6b7280; }

/* Tarjeta emergencia */
.emergencia-card {
  background: var(--bg-card);
  border: 1px solid var(--borde);
  border-radius: 16px;
  padding: 20px;
  position: relative;
  overflow: hidden;
}

.card-tag {
  position: absolute;
  top: 0;
  right: 0;
  font-size: 0.6rem;
  font-weight: 800;
  padding: 4px 10px;
  border-bottom-left-radius: 8px;
}

.alert-red {
  background: #dc2626;
  color: #fff;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.folio-tag {
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--texto-dim);
}

.emergencia-tipo {
  margin: 0 0 16px 0;
  font-size: 1.15rem;
  color: var(--texto-blanco);
  line-height: 1.3;
}

.info-block {
  margin-bottom: 14px;
}

.info-block .label {
  font-size: 0.65rem;
  text-transform: uppercase;
  color: var(--texto-dim);
  display: block;
  margin-bottom: 2px;
}

.info-block .value {
  margin: 0;
  font-size: 0.88rem;
  color: var(--texto-blanco);
  line-height: 1.4;
}

.text-amber {
  color: #fcd34d !important;
}

.timestamps-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 12px 0;
  background: rgba(0, 0, 0, 0.2);
  padding: 10px;
  border-radius: 10px;
}

.ts-box {
  display: flex;
  flex-direction: column;
}

.ts-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  color: var(--texto-dim);
}

.ts-val {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--texto-blanco);
}

.text-green { color: #10b981 !important; }

.btn-aceptar {
  background: #10b981;
  color: #fff;
  font-weight: 800;
  border: none;
  padding: 14px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
  transition: transform 0.2s;
  margin-bottom: 10px;
}
.btn-aceptar:active { transform: scale(0.98); }

.btn-maps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 0.88rem;
  padding: 12px;
}

/* Formulario Dinámico de Campo */
.formulario-campo-box {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--borde);
}

.form-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}

.badge-cat {
  background: #3b82f6;
  color: #fff;
  font-size: 0.6rem;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 6px;
}

.form-title h4 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--texto-blanco);
}

.cat-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group label {
  font-size: 0.72rem;
  color: var(--texto-dim);
  font-weight: 600;
}

.input-campo {
  background: var(--bg-input, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--borde);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--texto-blanco);
  font-size: 0.88rem;
}

.input-campo, select, option {
  color-scheme: dark;
}

select option {
  background-color: #1e293b !important;
  color: #ffffff !important;
}

.highlight-select {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.08);
}

/* Acordeones del formulario FO-DO-03 */
.form-sections-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-accordion {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--borde);
  border-radius: 10px;
  overflow: hidden;
}

.form-accordion summary {
  padding: 12px 16px;
  font-weight: 700;
  font-size: 0.9rem;
  color: #fff;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.05);
  list-style: none; /* Hide default arrow in some browsers */
  position: relative;
  border-bottom: 1px solid transparent;
}

.form-accordion[open] summary {
  border-bottom-color: var(--borde);
  background: rgba(255, 255, 255, 0.08);
}

.form-accordion summary::after {
  content: "▼";
  position: absolute;
  right: 16px;
  font-size: 0.7rem;
  color: var(--texto-dim);
  transition: transform 0.2s;
}

.form-accordion[open] summary::after {
  transform: rotate(180deg);
}

.accordion-content {
  padding: 16px;
}

/* Sub-cajas dentro de las secciones */
.sub-box {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--borde);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }

.stat-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--borde);
}
.stat-box input {
  margin-top: 4px;
  width: 100%;
}

.vehiculos-box {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--borde);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vehiculo-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  background: rgba(255, 255, 255, 0.05);
  padding: 6px 10px;
  border-radius: 6px;
}

.btn-del {
  background: none;
  border: none;
  color: #ef4444;
  font-weight: bold;
  cursor: pointer;
}

.add-vehiculo-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }

.input-sm {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--borde);
  border-radius: 6px;
  padding: 6px 8px;
  color: #fff;
  font-size: 0.75rem;
}

.btn-add {
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 6px;
  font-weight: bold;
  font-size: 0.75rem;
  cursor: pointer;
}

.file-input {
  background: rgba(255, 255, 255, 0.05);
  border: 1px dashed var(--borde);
  border-radius: 8px;
  padding: 8px;
  color: var(--texto-dim);
  font-size: 0.78rem;
}

.img-preview-box {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.img-preview-box img {
  width: 100%;
  max-height: 180px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--borde);
}

.btn-remove-img {
  background: #ef4444;
  color: #fff;
  border: none;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.72rem;
  cursor: pointer;
  align-self: flex-start;
}

.margin-top-sm { margin-top: 10px; }
.margin-top-md { margin-top: 16px; }

/* Tarjeta Vacía */
.emergencia-card-vacia {
  background: var(--bg-card);
  border: 1px dashed var(--borde);
  border-radius: 16px;
  padding: 32px 20px;
}

.icon-sleep {
  font-size: 2.2rem;
  margin-bottom: 12px;
}

.emergencia-card-vacia h4 {
  margin: 0 0 8px 0;
  font-size: 0.95rem;
  color: var(--texto-blanco);
}

.emergencia-card-vacia p {
  margin: 0;
  line-height: 1.4;
}

/* Botones de control táctil gigante */
.btn-grid-campo {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: auto;
  padding-bottom: 12px;
}

.btn-control {
  border: 1px solid var(--borde);
  background: var(--bg-card);
  border-radius: 16px;
  padding: 24px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: all var(--trans);
  color: var(--texto);
}

.btn-control .btn-icon {
  font-size: 1.6rem;
}

.btn-control .btn-text {
  font-size: 0.82rem;
  font-weight: 700;
  font-family: var(--fuente);
}

/* Estados activos en botones */
.btn-control.disponible.active {
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.08);
  color: #10b981;
  transform: scale(0.97);
}

.btn-control.en-camino.active {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.08);
  color: #3b82f6;
  transform: scale(0.97);
}

.btn-control.en-escena.active {
  border-color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
  color: #dc2626;
  transform: scale(0.97);
}

.btn-control.regresando.active {
  border-color: #6366f1;
  background: rgba(99, 102, 241, 0.08);
  color: #6366f1;
  transform: scale(0.97);
}

.btn-cerrar {
  background: #dc2626;
  color: #fff;
  font-weight: 700;
  border: 1px solid #2d1f1f;
  padding: 12px;
  border-radius: 12px;
  transition: all var(--trans);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
}
.btn-cerrar:hover {
  background: #b91c1c;
  box-shadow: 0 0 12px rgba(220, 38, 38, 0.4);
}

.btn-secundario {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: 1px solid var(--borde);
  padding: 12px;
  border-radius: 12px;
  font-weight: 600;
  font-size: 0.85rem;
}

/* ── Banner de conexión offline/online ──────────────────────────── */
.offline-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  margin-bottom: 12px;
  border: 1px solid;
  animation: banner-appear 0.3s ease-out;
}

.offline-banner.offline {
  background: #451a03;
  border-color: #92400e;
  color: #fbbf24;
}
.offline-banner.syncing {
  background: #1e293b;
  border-color: #334155;
  color: #93c5fd;
}
.offline-banner.success {
  background: #052e16;
  border-color: #166534;
  color: #4ade80;
}
.offline-banner.pending {
  background: #27272a;
  border-color: #3f3f46;
  color: #a1a1aa;
}

.offline-banner-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.offline-banner-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.offline-banner-text strong {
  font-size: 0.82rem;
  font-weight: 700;
}
.offline-banner-text span {
  font-size: 0.72rem;
  opacity: 0.85;
}

.spinner-sync {
  animation: spin-sync 1s linear infinite;
}
@keyframes spin-sync {
  to { transform: rotate(360deg); }
}

@keyframes banner-appear {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Transition vue */
.banner-slide-enter-active { transition: all 0.3s ease-out; }
.banner-slide-leave-active { transition: all 0.2s ease-in; }
.banner-slide-enter-from { opacity: 0; transform: translateY(-10px); }
.banner-slide-leave-to { opacity: 0; transform: translateY(-10px); }
</style>
