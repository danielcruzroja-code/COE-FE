<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-control-geocoder'
import 'leaflet-control-geocoder/dist/Control.Geocoder.css'
import { useEmergenciasStore } from '@/stores/emergencias.js'
import { useUnidadesStore } from '@/stores/unidades.js'
import { catalogosService } from '@/services/catalogos.service.js'
import { unidadesService } from '@/services/unidades.service.js'

const emergenciasStore = useEmergenciasStore()
const unidadesStore = useUnidadesStore()

const mapaContainer = ref(null)
let map = null

// Referencias a los markers para actualizarlos en lugar de reconstruir todo
const emergencyMarkers = {}
const unitMarkers = {}
let searchMarker = null // Pin de búsqueda geocodificada única

// Filtros y UI
const verEmergencias = ref(true)
const verUnidades = ref(true)
const filtroPrioridad = ref('todas')
const panelColapsado = ref(false)

// Control de despachos desde el popup
const mostrandoDespacho = ref(false)
const emergenciaParaDespachar = ref(null)
const unidadesDisponibles = ref([])

// Formulario de creación rápida desde búsqueda/geocodificación
const mostrandoFormRapido = ref(false)
const incidentesCat = ref([])
const guardandoIncidente = ref(false)
const formError = ref('')
const form = ref({
  tipo: '',
  subtipo: '',
  catalogoIncidente: null,
  ubicacion: {
    calle: '',
    numeroExterior: '',
    numeroInterior: '',
    colonia: '',
    referencias: '',
    lat: null,
    lng: null,
    direccionCompleta: ''
  },
  prioridad: 'media',
  notas: '',
})

// Capas de control
let emergencyLayer = null
let unitLayer = null

// Inicializar mapa
const initMap = () => {
  if (!mapaContainer.value) return

  // Coordenadas de Zapopan Centro
  map = L.map(mapaContainer.value, {
    center: [20.7204, -103.3919],
    zoom: 13,
    zoomControl: false,
  })

  // Añadir control de zoom en una posición más limpia
  L.control.zoom({ position: 'bottomright' }).addTo(map)

  // Capa oscura de CartoDB (Dark Matter) para encajar con el design system
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map)

  emergencyLayer = L.layerGroup().addTo(map)
  unitLayer = L.layerGroup().addTo(map)

  // ── Configurar leaflet-control-geocoder ──────────────────────────────────────
  const geocoder = L.Control.geocoder({
    defaultMarkGeocode: false,
    placeholder: 'Buscar dirección...',
    errorMessage: 'No se encontraron resultados.'
  })
    .on('markgeocode', function (e) {
      const latlng = e.geocode.center
      const address = e.geocode.name

      // Mapear al objeto form reactivo
      form.value.ubicacion.calle = address.split(',')[0]
      form.value.ubicacion.numeroExterior = ''
      form.value.ubicacion.numeroInterior = ''
      form.value.ubicacion.colonia = 'Zapopan (Búsqueda Geográfica)'
      form.value.ubicacion.referencias = ''
      form.value.ubicacion.lat = latlng.lat
      form.value.ubicacion.lng = latlng.lng
      form.value.ubicacion.direccionCompleta = address
      form.value.prioridad = 'media'
      form.value.tipo = ''
      form.value.subtipo = ''
      form.value.catalogoIncidente = null
      form.value.notas = ''
      formError.value = ''

      // Centrar mapa
      map.setView(latlng, 16)

      // Colocar o mover el pin único de búsqueda
      setSearchPin(latlng, address)

      // Mostrar panel de creación rápida
      mostrandoFormRapido.value = true
    })
    .addTo(map)

  // Modificar clases del geocoder para encajar con Dark Theme
  const geocoderEl = geocoder.getContainer()
  if (geocoderEl) {
    geocoderEl.classList.add('dark-geocoder')
  }

  // ── Escuchar eventos de popupopen para delegar eventos del botón Despachar ───
  map.on('popupopen', (e) => {
    const container = e.popup.getElement()
    if (!container) return
    const btn = container.querySelector('.btn-despachar-map')
    if (btn) {
      const emId = btn.getAttribute('data-id')
      btn.addEventListener('click', () => {
        abrirPanelDespacho(emId)
        e.popup.close()
      })
    }
  })
}

// Colocar pin de búsqueda geocodificada sin duplicados
const setSearchPin = (latlng, address) => {
  if (searchMarker) {
    searchMarker.setLatLng(latlng)
    searchMarker.getPopup().setContent(`
      <div class="map-popup dark-popup">
        <h4 style="margin:0 0 4px;font-size:0.85rem;color:var(--texto-blanco);">Dirección encontrada</h4>
        <p style="margin:0;font-size:0.75rem;color:var(--texto-muted);">${address}</p>
      </div>
    `)
  } else {
    const searchIcon = L.divIcon({
      className: 'custom-search-icon',
      html: `
        <div class="search-marker-wrapper">
          <div class="search-ring"></div>
          <div class="search-dot">📍</div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    })

    searchMarker = L.marker(latlng, { icon: searchIcon })
      .bindPopup(`
        <div class="map-popup dark-popup">
          <h4 style="margin:0 0 4px;font-size:0.85rem;color:var(--texto-blanco);">Dirección encontrada</h4>
          <p style="margin:0;font-size:0.75rem;color:var(--texto-muted);">${address}</p>
        </div>
      `, { className: 'leaflet-dark-popup-theme' })
      .addTo(map)
  }
}

// Remover pin de búsqueda
const clearSearchPin = () => {
  if (searchMarker && map) {
    map.removeLayer(searchMarker)
    searchMarker = null
  }
  mostrandoFormRapido.value = false
}

// ── Crear DivIcon para Emergencias ──────────────────────────────────────────
const getEmergencyIcon = (prioridad, estado) => {
  const colores = {
    critica: '#a855f7', // Purpura
    alta: '#dc2626',    // Rojo
    media: '#f59e0b',   // Ámbar
    baja: '#10b981'     // Verde
  }
  const color = colores[prioridad] || '#f59e0b'
  const isPulsing = prioridad === 'critica' || prioridad === 'alta'

  return L.divIcon({
    className: 'custom-emergency-icon',
    html: `
      <div class="emergency-marker-wrapper">
        ${isPulsing ? `<div class="pulse-ring" style="background-color: ${color}"></div>` : ''}
        <div class="marker-dot" style="background-color: ${color}; border-color: #0f0f0f"></div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  })
}

// ── Crear DivIcon para Unidades ─────────────────────────────────────────────
const getUnitIcon = (tipo, estado, nombre) => {
  const emojis = {
    Bomba: '🚒',
    Ambulancia: '🚑',
    Rescate: '🛠️',
    Pipas: '💧',
    Mando: '🚨'
  }
  const emoji = emojis[tipo] || '🚒'

  const coloresEstado = {
    disponible: '#10b981',       // Verde
    en_camino: '#3b82f6',        // Azul
    en_escena: '#dc2626',        // Rojo
    regresando: '#6366f1',       // Indigo
    fuera_de_servicio: '#6b7280' // Gris
  }
  const color = coloresEstado[estado] || '#10b981'

  return L.divIcon({
    className: 'custom-unit-icon',
    html: `
      <div class="unit-marker-wrapper" style="border-color: ${color}">
        <span class="unit-emoji">${emoji}</span>
        <span class="unit-label">${nombre}</span>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  })
}

// ── Renderizar Emergencias ──────────────────────────────────────────────────
const renderEmergencias = () => {
  if (!map || !emergencyLayer) return

  if (!verEmergencias.value) {
    emergencyLayer.clearLayers()
    Object.keys(emergencyMarkers).forEach(key => delete emergencyMarkers[key])
    return
  }

  const activas = emergenciasStore.emergencias

  // Eliminar markers viejos que ya no están activos
  Object.keys(emergencyMarkers).forEach((id) => {
    if (!activas.find((e) => e._id === id)) {
      emergencyLayer.removeLayer(emergencyMarkers[id])
      delete emergencyMarkers[id]
    }
  })

  // Añadir o actualizar markers
  activas.forEach((em) => {
    const lat = em.ubicacion?.lat || em.coordenadas?.lat
    const lng = em.ubicacion?.lng || em.coordenadas?.lng
    if (!lat || !lng) return

    // Filtro por prioridad
    if (filtroPrioridad.value !== 'todas' && em.prioridad !== filtroPrioridad.value) {
      if (emergencyMarkers[em._id]) {
        emergencyLayer.removeLayer(emergencyMarkers[em._id])
        delete emergencyMarkers[em._id]
      }
      return
    }

    const addressText = em.ubicacion?.direccionCompleta || em.direccion || ''

    const popupContent = `
      <div class="map-popup dark-popup">
        <div class="popup-header">
          <span class="popup-folio">${em.folio}</span>
          <span class="popup-priority-badge priority-${em.prioridad}">${em.prioridad}</span>
        </div>
        <h4 class="popup-title">${em.subtipo || em.tipo}</h4>
        <p class="popup-location"><strong>Dirección:</strong> ${addressText}</p>
        ${em.notes || em.notas ? `<p class="popup-notes"><strong>Notas:</strong> ${em.notes || em.notas}</p>` : ''}
        <div class="popup-status">
          <span><strong>Estado:</strong> ${em.estado === 'nuevo' ? 'Sin asignar' : em.estado}</span>
          ${em.unidadAsignada ? `<span><strong>Unidad:</strong> ${em.unidadAsignada.nombre}</span>` : ''}
        </div>
        ${em.estado === 'nuevo' ? `
          <button class="btn btn-primario btn-xs w-full btn-despachar-map" data-id="${em._id}" style="margin-top:8px;">
            Despachar Unidad
          </button>
        ` : ''}
      </div>
    `

    if (emergencyMarkers[em._id]) {
      // Actualizar posición e ícono si ya existe
      emergencyMarkers[em._id].setLatLng([lat, lng])
      emergencyMarkers[em._id].setIcon(getEmergencyIcon(em.prioridad, em.estado))
      emergencyMarkers[em._id].getPopup().setContent(popupContent)
    } else {
      // Crear nuevo marker
      const marker = L.marker([lat, lng], {
        icon: getEmergencyIcon(em.prioridad, em.estado)
      }).bindPopup(popupContent, { className: 'leaflet-dark-popup-theme' })

      emergencyLayer.addLayer(marker)
      emergencyMarkers[em._id] = marker
    }
  })
}

// ── Renderizar Unidades ─────────────────────────────────────────────────────
const renderUnidades = () => {
  if (!map || !unitLayer) return

  if (!verUnidades.value) {
    unitLayer.clearLayers()
    Object.keys(unitMarkers).forEach(key => delete unitMarkers[key])
    return
  }

  const lista = unidadesStore.unidades

  // Eliminar markers viejos
  Object.keys(unitMarkers).forEach((id) => {
    if (!lista.find((u) => u._id === id)) {
      unitLayer.removeLayer(unitMarkers[id])
      delete unitMarkers[id]
    }
  })

  // Añadir o actualizar markers
  lista.forEach((u) => {
    const lat = u.ultimaUbicacion?.lat
    const lng = u.ultimaUbicacion?.lng
    if (!lat || !lng) return

    const popupContent = `
      <div class="map-popup dark-popup">
        <h4 class="popup-title" style="color: var(--texto-blanco); margin-bottom: 4px;">${u.nombre}</h4>
        <p style="margin: 0; font-size: 0.8rem; color: var(--texto-muted);">
          ${u.tipo} · ${u.base}
        </p>
        <hr style="border: 0; border-top: 1px solid var(--borde); margin: 8px 0;" />
        <div style="font-size: 0.8rem; display: flex; flex-direction: column; gap: 4px;">
          <span><strong>Estado:</strong> ${u.estado}</span>
          ${u.responsable ? `<span><strong>Responsable:</strong> ${u.responsable}</span>` : ''}
          ${u.ultimaUbicacion.actualizadoEn ? `<span style="font-size:0.7rem; color:var(--texto-muted)">Actualizado: ${new Date(u.ultimaUbicacion.actualizadoEn).toLocaleTimeString()}</span>` : ''}
        </div>
      </div>
    `

    if (unitMarkers[u._id]) {
      unitMarkers[u._id].setLatLng([lat, lng])
      unitMarkers[u._id].setIcon(getUnitIcon(u.tipo, u.estado, u.nombre))
      unitMarkers[u._id].getPopup().setContent(popupContent)
    } else {
      const marker = L.marker([lat, lng], {
        icon: getUnitIcon(u.tipo, u.estado, u.nombre)
      }).bindPopup(popupContent, { className: 'leaflet-dark-popup-theme' })

      unitLayer.addLayer(marker)
      unitMarkers[u._id] = marker
    }
  })
}

// ── Centrado suave del mapa ─────────────────────────────────────────────────
const enfocarMarker = (coordenadas) => {
  if (!map || !coordenadas?.lat || !coordenadas?.lng) return
  map.setView([coordenadas.lat, coordenadas.lng], 16, { animate: true })
}

const volarMarker = (coordenadas) => {
  if (!map || !coordenadas?.lat || !coordenadas?.lng) return
  map.flyTo([coordenadas.lat, coordenadas.lng], 17, {
    duration: 1.5,
    easeLinearity: 0.25
  })
}

// ── Control de despacho ─────────────────────────────────────────────────────
const abrirPanelDespacho = async (emId) => {
  const em = emergenciasStore.emergencias.find(e => e._id === emId)
  if (!em) return
  emergenciaParaDespachar.value = em
  mostrandoDespacho.value = true
  try {
    unidadesDisponibles.value = await unidadesService.disponibles()
  } catch (e) {
    console.error('Error cargando unidades disponibles:', e)
  }
}

const despacharUnidad = async (unidadId) => {
  if (!emergenciaParaDespachar.value) return
  const exito = await emergenciasStore.asignarUnidad(emergenciaParaDespachar.value._id, unidadId)
  if (exito) {
    mostrandoDespacho.value = false
    emergenciaParaDespachar.value = null
    unidadesDisponibles.value = []
  }
}

// ── Registro rápido desde mapa ─────────────────────────────────────────────
const seleccionarIncidente = (inc) => {
  if (!inc) return
  form.value.catalogoIncidente = inc._id
  form.value.tipo = inc.categoria
  form.value.subtipo = `${inc.codigo_cnie} ${inc.nombre}`

  const mapaPrioridad = { 'Crítica': 'critica', 'Alta': 'alta', 'Media': 'media', 'Baja': 'baja' }
  form.value.prioridad = mapaPrioridad[inc.prioridadSugerida] || 'media'
}

const guardarIncidenteRapido = async () => {
  formError.value = ''
  if (!form.value.tipo || !form.value.ubicacion.calle || !form.value.ubicacion.colonia) {
    formError.value = 'Completa los campos obligatorios: Tipo de incidente, Calle y Colonia/Zona.'
    return
  }

  // Construir dirección completa manualmente
  const c = form.value.ubicacion.calle
  const ext = form.value.ubicacion.numeroExterior ? ` #${form.value.ubicacion.numeroExterior}` : ''
  const int = form.value.ubicacion.numeroInterior ? ` Int. ${form.value.ubicacion.numeroInterior}` : ''
  const col = form.value.ubicacion.colonia ? `, Col. ${form.value.ubicacion.colonia}` : ''
  const refText = form.value.ubicacion.referencias ? ` (Ref: ${form.value.ubicacion.referencias})` : ''
  
  form.value.ubicacion.direccionCompleta = `${c}${ext}${int}${col}${refText}`

  guardandoIncidente.value = true
  try {
    const res = await emergenciasStore.crear(form.value)
    if (res.exito) {
      clearSearchPin()
    } else {
      formError.value = res.error
    }
  } finally {
    guardandoIncidente.value = false
  }
}

// Ciclo de vida
onMounted(async () => {
  initMap()
  await Promise.all([
    emergenciasStore.cargarActivas(),
    unidadesStore.cargarUnidades()
  ])
  renderEmergencias()
  renderUnidades()

  try {
    incidentesCat.value = await catalogosService.incidentes()
  } catch (e) {
    console.error('Error al precargar incidentes:', e)
  }
})

onUnmounted(() => {
  if (map) {
    map.remove()
    map = null
  }
})

// Watchers
watch(() => emergenciasStore.emergencias, () => renderEmergencias(), { deep: true })
watch(() => unidadesStore.unidades, () => renderUnidades(), { deep: true })
watch([verEmergencias, verUnidades, filtroPrioridad], () => {
  renderEmergencias()
  renderUnidades()
})
</script>

<template>
  <div class="mapa-vista">
    <!-- Panel flotante lateral (Filtros y Listas) -->
    <div class="map-sidebar blur-effect">
      <div class="sidebar-header" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer;" @click="panelColapsado = !panelColapsado">
        <div>
          <h3>Monitoreo COE</h3>
          <p class="texto-muted texto-xs" v-if="!panelColapsado">Zapopan en tiempo real</p>
        </div>
        <button class="btn-icono" style="padding: 4px;">
          <svg v-if="!panelColapsado" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
        </button>
      </div>

      <div v-show="!panelColapsado" style="display: flex; flex-direction: column; overflow: hidden; flex: 1;">

      <!-- Filtros principales -->
      <div class="sidebar-section">
        <label class="section-title">Capas de visualización</label>
        <div class="toggle-control">
          <label class="toggle-item">
            <input type="checkbox" v-model="verEmergencias" />
            <span class="custom-checkbox"></span>
            Emergencias
          </label>
          <label class="toggle-item">
            <input type="checkbox" v-model="verUnidades" />
            <span class="custom-checkbox"></span>
            Unidades en Campo
          </label>
        </div>
      </div>

      <!-- Filtro prioridad -->
      <div v-if="verEmergencias" class="sidebar-section">
        <label class="section-title">Prioridad Emergencia</label>
        <select class="input input-sm" v-model="filtroPrioridad">
          <option value="todas">Todas las prioridades</option>
          <option value="critica">Crítica (Púrpura)</option>
          <option value="alta">Alta (Rojo)</option>
          <option value="media">Media (Ámbar)</option>
          <option value="baja">Baja (Verde)</option>
        </select>
      </div>

      <hr class="divisor" />

      <!-- Lista rápida de emergencias activas -->
      <div class="sidebar-section flex-1 overflow-y">
        <label class="section-title">Incidentes Activos (Doble clic para centrar)</label>
        <div class="mini-lista">
          <div v-if="emergenciasStore.emergencias.length === 0" class="texto-muted texto-xs pad-10 text-center">
            No hay emergencias activas
          </div>
          <div
            v-for="em in emergenciasStore.emergencias"
            :key="em._id"
            class="mini-item card-accion"
            @click="enfocarMarker(em.ubicacion || em.coordenadas)"
            @dblclick="volarMarker(em.ubicacion || em.coordenadas)"
          >
            <div class="mini-item-header">
              <span class="mini-folio">{{ em.folio }}</span>
              <span class="mini-priority dot" :class="`dot-${em.prioridad}`"></span>
            </div>
            <div class="mini-text">{{ em.subtipo || em.tipo }}</div>
            <div class="mini-subtext">{{ em.ubicacion?.colonia || em.zona }}</div>
          </div>
        </div>
      </div>

      <!-- Lista rápida de unidades -->
      <div v-if="verUnidades" class="sidebar-section flex-1 overflow-y">
        <label class="section-title">Unidades Activas</label>
        <div class="mini-lista">
          <div v-if="unidadesStore.unidades.length === 0" class="texto-muted texto-xs pad-10 text-center">
            No hay unidades activas
          </div>
          <div
            v-for="u in unidadesStore.unidades"
            :key="u._id"
            class="mini-item card-accion"
            @click="enfocarMarker(u.ultimaUbicacion)"
            @dblclick="volarMarker(u.ultimaUbicacion)"
          >
            <div class="mini-item-header">
              <span class="mini-folio" style="color: var(--texto-blanco)">{{ u.nombre }}</span>
              <span class="status-indicator" :class="u.estado">{{ u.estado }}</span>
            </div>
            <div class="mini-subtext">{{ u.tipo }} · {{ u.responsable || 'Sin asignar' }}</div>
          </div>
        </div>
      </div>
      </div>
    </div>

    <!-- Panel Flotante Izquierdo Secundario: Despacho / Creación rápida -->
    <div class="floating-panel blur-effect" v-if="mostrandoDespacho || mostrandoFormRapido">
      <!-- Despacho rápido -->
      <div v-if="mostrandoDespacho" class="despacho-form">
        <div class="panel-header">
          <h4>Despachar Incidente</h4>
          <button class="btn-icono" @click="mostrandoDespacho = false">✕</button>
        </div>
        <p class="texto-xs texto-muted" style="margin-bottom: 12px;">
          Asignando unidad para: <strong>{{ emergenciaParaDespachar?.folio }}</strong>
        </p>

        <div v-if="unidadesDisponibles.length === 0" class="texto-xs pad-10 text-center" style="color:#fca5a5; background:#27272a; border-radius:6px; padding:12px; border:1px solid #3f3f46;">
          ⚠️ No hay unidades disponibles en base en este momento.
        </div>
        <div v-else class="unidades-despacho-list" style="display:flex; flex-direction:column; gap:8px; max-height:350px; overflow-y:auto;">
          <button
            v-for="u in unidadesDisponibles"
            :key="u._id"
            class="card-unidad-dispatch-mapa"
            @click="despacharUnidad(u._id)"
            style="background:#27272a; border:1px solid #3f3f46; border-left:4px solid #dc2626; border-radius:6px; padding:10px 14px; text-align:left; cursor:pointer; transition:all 0.2s ease;"
          >
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="color:#ffffff; font-weight:700; font-size:0.95rem;">
                {{ u.tipo === 'Ambulancia' ? '🚑' : u.tipo === 'Bomba' ? '🚒' : u.tipo === 'Rescate' ? '🛟' : '🚓' }} {{ u.nombre }}
              </span>
              <span style="background:#450a0a; color:#fca5a5; border:1px solid #991b1b; font-size:0.65rem; font-weight:700; padding:2px 6px; border-radius:4px; letter-spacing:0.5px;">
                DISPONIBLE
              </span>
            </div>
            
            <div style="display:flex; gap:10px; margin-top:6px; font-size:0.75rem;">
              <span style="background:#18181b; padding:2px 6px; border-radius:4px; color:#e4e4e7; border:1px solid #3f3f46;">
                Tipo: <strong style="color:#ffffff;">{{ u.tipo }}</strong>
              </span>
              <span style="background:#18181b; padding:2px 6px; border-radius:4px; color:#e4e4e7; border:1px solid #3f3f46;">
                Base: <strong style="color:#ffffff;">{{ u.base }}</strong>
              </span>
            </div>
          </button>
        </div>
      </div>

      <!-- Registro rápido desde geocodificación -->
      <div v-if="mostrandoFormRapido" class="creacion-rapida-form">
        <div class="panel-header">
          <h4>Registrar Incidente</h4>
          <button class="btn-icono" @click="clearSearchPin">✕</button>
        </div>
        <div v-if="formError" class="login-error" style="margin-bottom:12px;">{{ formError }}</div>

        <div class="form-emergencia" style="max-height: calc(100vh - 250px); overflow-y: auto; padding-right:4px;">
          <!-- Tipo Incidente -->
          <div class="form-campo">
            <label class="form-label">Tipo de incidente *</label>
            <select class="input input-sm" v-model="form.catalogoIncidente" @change="seleccionarIncidente(incidentesCat.find(i => i._id === form.catalogoIncidente))">
              <option :value="null" disabled>Selecciona del catálogo...</option>
              <option v-for="inc in incidentesCat" :key="inc._id" :value="inc._id">
                {{ inc.codigo_cnie }} — {{ inc.nombre }}
              </option>
            </select>
          </div>

          <!-- Calle auto-llenada -->
          <div class="form-campo">
            <label class="form-label">Calle *</label>
            <input class="input input-sm" v-model="form.ubicacion.calle" />
          </div>

          <!-- Números Ext/Int -->
          <div class="form-fila" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div class="form-campo">
              <label class="form-label">Num Ext *</label>
              <input class="input input-sm" v-model="form.ubicacion.numeroExterior" placeholder="S/N o 123" />
            </div>
            <div class="form-campo">
              <label class="form-label">Num Int</label>
              <input class="input input-sm" v-model="form.ubicacion.numeroInterior" placeholder="A-101" />
            </div>
          </div>

          <!-- Zona/Colonia -->
          <div class="form-campo">
            <label class="form-label">Zona/Colonia *</label>
            <input class="input input-sm" v-model="form.ubicacion.colonia" />
          </div>

          <!-- Prioridad -->
          <div class="form-campo">
            <label class="form-label">Prioridad *</label>
            <div class="prioridad-selector">
              <button type="button" v-for="p in ['baja','media','alta','critica']" :key="p"
                class="chip" :class="[chipClase(p), { seleccionada: form.prioridad === p }]"
                @click="form.prioridad = p"
              >{{ p }}</button>
            </div>
          </div>

          <!-- Notas -->
          <div class="form-campo">
            <label class="form-label">Notas / Reporte inicial</label>
            <textarea class="input input-sm" rows="3" v-model="form.notes" placeholder="Detalles de la emergencia..."></textarea>
          </div>

          <!-- Botones -->
          <div class="form-acciones" style="margin-top:12px;">
            <button class="btn btn-ghost btn-sm" @click="clearSearchPin">Cancelar</button>
            <button class="btn btn-primario btn-sm" :disabled="guardandoIncidente" @click="guardarIncidenteRapido">
              <span v-if="guardandoIncidente" class="spinner"></span>
              <span v-else>Guardar</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Contenedor del mapa de Leaflet -->
    <div ref="mapaContainer" class="mapa-contenedor"></div>
  </div>
</template>

<style>
/* ── Leaflet Dark Theme Overrides ─────────────────────────── */
.leaflet-container {
  background: #0f0f0f !important;
}

/* Custom popup styling matching design system */
.leaflet-popup-content-wrapper {
  background: var(--bg-card) !important;
  color: var(--texto) !important;
  border: 1px solid var(--borde) !important;
  border-radius: var(--radio) !important;
  box-shadow: var(--sombra-lg) !important;
  backdrop-filter: blur(10px);
}
.leaflet-popup-tip {
  background: var(--bg-card) !important;
  border-left: 1px solid var(--borde) !important;
  border-bottom: 1px solid var(--borde) !important;
}
.leaflet-popup-close-button {
  color: var(--texto-dim) !important;
}

/* Popups Internals */
.map-popup {
  padding: 4px;
  font-family: var(--fuente);
  min-width: 180px;
}
.popup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.popup-folio {
  font-weight: 700;
  font-size: 0.72rem;
  color: var(--texto-muted);
}
.popup-priority-badge {
  font-size: 0.65rem;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 700;
  text-transform: uppercase;
}
.popup-priority-badge.priority-critica { background: rgba(168, 85, 247, 0.2); color: #c084fc; }
.popup-priority-badge.priority-alta { background: rgba(220, 38, 38, 0.2); color: #fca5a5; }
.popup-priority-badge.priority-media { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
.popup-priority-badge.priority-baja { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; }

.popup-title {
  font-size: 0.88rem;
  font-weight: 600;
  margin: 0 0 6px 0;
  color: var(--texto-blanco);
}
.popup-location, .popup-notes, .popup-status {
  font-size: 0.78rem;
  margin: 0 0 4px 0;
  color: var(--texto);
}
.popup-status {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  border-top: 1px solid var(--borde);
  padding-top: 6px;
  font-size: 0.75rem;
}

/* Custom Emergency Markers */
.emergency-marker-wrapper {
  position: relative;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.marker-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #0f0f0f;
  box-shadow: 0 0 8px rgba(0,0,0,0.5);
  z-index: 2;
}
.pulse-ring {
  position: absolute;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  opacity: 0.6;
  animation: marker-pulse 1.8s infinite ease-out;
  z-index: 1;
}

@keyframes marker-pulse {
  0% { transform: scale(0.5); opacity: 0.8; }
  100% { transform: scale(2.2); opacity: 0; }
}

/* Custom Unit Markers */
.unit-marker-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border: 2px solid var(--rojo);
  border-radius: 8px;
  width: 42px;
  height: 42px;
  box-shadow: var(--sombra-md);
  position: relative;
}
.unit-emoji {
  font-size: 1.3rem;
  margin-top: -2px;
}
.unit-label {
  position: absolute;
  bottom: -15px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-base);
  border: 1px solid var(--borde);
  color: var(--texto-blanco);
  font-size: 0.62rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 4px;
  white-space: nowrap;
}

/* Search Marker Geocoder styling */
.search-marker-wrapper {
  position: relative;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.search-dot {
  font-size: 1.6rem;
  z-index: 2;
  margin-top: -12px;
}
.search-ring {
  position: absolute;
  width: 20px;
  height: 20px;
  border: 2px dashed var(--rojo);
  border-radius: 50%;
  animation: rotate-search-ring 8s linear infinite;
  z-index: 1;
}

@keyframes rotate-search-ring {
  100% { transform: rotate(360deg); }
}

/* ── Geocoder Dark Theme Overrides ────────────────────────── */
.dark-geocoder.leaflet-control-geocoder {
  background: var(--bg-card) !important;
  border: 1px solid var(--borde) !important;
  border-radius: 8px !important;
  box-shadow: var(--sombra-md) !important;
  overflow: hidden;
}
.dark-geocoder input {
  background: transparent !important;
  color: var(--texto-blanco) !important;
  border: none !important;
  font-family: var(--fuente) !important;
  font-size: 0.8rem !important;
  padding: 6px 10px !important;
  outline: none !important;
}
.dark-geocoder .leaflet-control-geocoder-icon {
  filter: invert(1);
  background-color: transparent !important;
  border-radius: 0 !important;
}
.dark-geocoder .leaflet-control-geocoder-throbber .leaflet-control-geocoder-icon {
  filter: none;
}
.dark-geocoder .leaflet-control-geocoder-results {
  background: var(--bg-card) !important;
  border-top: 1px solid var(--borde) !important;
  font-family: var(--fuente) !important;
}
.dark-geocoder .leaflet-control-geocoder-results li {
  color: var(--texto-dim) !important;
  font-size: 0.78rem !important;
  padding: 8px 12px !important;
}
.dark-geocoder .leaflet-control-geocoder-results li:hover,
.dark-geocoder .leaflet-control-geocoder-results .leaflet-control-geocoder-selected {
  background: var(--bg-card-hover) !important;
  color: var(--texto-blanco) !important;
}
</style>

<style scoped>
.mapa-vista {
  display: flex;
  height: calc(100vh - 57px); /* Restar header */
  position: relative;
}

.mapa-contenedor {
  flex: 1;
  height: 100%;
  z-index: 1;
}

/* Sidebar flotante */
.map-sidebar {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 320px;
  max-height: calc(100% - 32px);
  z-index: 10;
  background: rgba(15, 15, 15, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid var(--borde);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--sombra-lg);
}

/* Panel flotante derecho secundario */
.floating-panel {
  position: absolute;
  top: 16px;
  right: 60px; /* Desplazado para no tapar el zoom de leaflet */
  width: 340px;
  max-height: calc(100% - 32px);
  z-index: 10;
  background: rgba(15, 15, 15, 0.88);
  backdrop-filter: blur(14px);
  border: 1px solid var(--borde);
  border-radius: 12px;
  box-shadow: var(--sombra-lg);
  padding: 20px;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--borde);
  padding-bottom: 8px;
}
.panel-header h4 { margin: 0; color: var(--texto-blanco); font-size: 0.95rem; }

.unidades-despacho-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 250px;
  overflow-y: auto;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--borde);
}
.sidebar-header h3 { margin: 0; font-size: 1rem; color: var(--texto-blanco); }

.sidebar-section {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--texto-dim);
  font-weight: 700;
}

/* Toggle controls */
.toggle-control {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toggle-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.8rem;
  color: var(--texto-blanco);
  cursor: pointer;
  user-select: none;
}
.toggle-item input {
  display: none;
}
.custom-checkbox {
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--borde);
  border-radius: 4px;
  display: inline-block;
  position: relative;
  transition: all var(--trans);
  background: var(--bg-card);
}
.toggle-item input:checked + .custom-checkbox {
  background: var(--rojo);
  border-color: var(--rojo);
}
.toggle-item input:checked + .custom-checkbox::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 2px;
  width: 4px;
  height: 8px;
  border: solid white;
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
}

.flex-1 { flex: 1; }
.overflow-y { overflow-y: auto; }

/* Lista rápida */
.mini-lista {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 180px;
  overflow-y: auto;
  padding-right: 4px;
}

.mini-item {
  background: rgba(255,255,255,0.02);
  border: 1px solid var(--borde);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: all var(--trans);
  user-select: none;
}
.mini-item:hover {
  background: var(--bg-card-hover);
  border-color: var(--rojo-borde);
}
.mini-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}
.mini-folio {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--texto-muted);
}
.mini-text {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--texto-blanco);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mini-subtext {
  font-size: 0.7rem;
  color: var(--texto-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Dots prioritarios */
.dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.dot-critica { background: #a855f7; box-shadow: 0 0 6px #a855f7; }
.dot-alta { background: #dc2626; box-shadow: 0 0 6px #dc2626; }
.dot-media { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
.dot-baja { background: #10b981; box-shadow: 0 0 6px #10b981; }

/* Status indicators */
.status-indicator {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 4px;
}
.status-indicator.disponible { background: rgba(16, 185, 129, 0.2); color: #10b981; }
.status-indicator.en_camino { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
.status-indicator.en_escena { background: rgba(220, 38, 38, 0.2); color: #dc2626; }
.status-indicator.regresando { background: rgba(99, 102, 241, 0.2); color: #6366f1; }
.status-indicator.fuera_de_servicio { background: rgba(107, 114, 128, 0.2); color: #9ca3af; }

.pad-10 { padding: 10px; }
.text-center { text-align: center; }
.text-red { color: #fca5a5; }

/* Prioridad selector */
.prioridad-selector { display: flex; gap: 6px; }
.prioridad-selector .chip { cursor: pointer; opacity: 0.5; transition: opacity var(--trans); font-size: 0.7rem; padding: 4px 8px; }
.prioridad-selector .chip.seleccionada { opacity: 1; transform: scale(1.05); }

.form-campo { margin-bottom: 10px; }
.form-label { font-size: 0.72rem; color: var(--texto-dim); margin-bottom: 4px; display: block; }
.form-acciones { display: flex; gap: 8px; justify-content: flex-end; }
.login-error { background: rgba(220, 38, 38, 0.15); border: 1px solid var(--rojo-borde); padding: 8px 12px; border-radius: 6px; color: #fca5a5; font-size: 0.75rem; }

.card-unidad-dispatch-mapa:hover {
  background: #3f3f46 !important;
  border-color: #ef4444 !important;
  transform: translateY(-1px);
}
</style>
