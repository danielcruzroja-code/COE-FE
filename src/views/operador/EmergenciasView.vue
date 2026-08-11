<script setup>
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEmergenciasStore } from '@/stores/emergencias.js'
import { catalogosService } from '@/services/catalogos.service.js'
import { unidadesService } from '@/services/unidades.service.js'

const store = useEmergenciasStore()

const mostrarFormulario = ref(false)
const emergenciaSeleccionada = ref(null)
const filtroEstado = ref('')

// Datos para el formulario
const incidentes = ref([])
const colonias = ref([])
const dependencias = ref([])
const unidadesDisponibles = ref([])
const busquedaColonia = ref('')
const sugerenciasDireccion = ref([])
const buscandoDireccion = ref(false)
const buscandoColonias = ref(false)
const coloniaSeleccionada = ref(false)
let timerDireccion = null
let timerColonia = null
let timerReverseGeo = null

// Validación de campos
const erroresCampos = ref({})

// Minimapa refs
let minimap = null
let minimapMarker = null

// Formulario con nuevo esquema de ubicación
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
  personas: 0,
  animales: 0,
  notas: '',
  telefonoContacto: '',
  nombreContacto: '',
  dependenciasApoyo: [],
})

const formError = ref('')
const guardando = ref(false)

const emergenciasFiltradas = computed(() => {
  if (!filtroEstado.value) return store.emergencias
  return store.emergencias.filter((e) => e.estado === filtroEstado.value)
})

const tiempoTranscurrido = (fecha) => {
  const diff = Date.now() - new Date(fecha).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'Ahora'
  if (min < 60) return `Hace ${min} min`
  const hrs = Math.floor(min / 60)
  return `Hace ${hrs}h ${min % 60}m`
}

const chipClase = (prioridad) => {
  const mapa = { critica: 'chip-critica', alta: 'chip-alta', media: 'chip-media', baja: 'chip-baja' }
  return mapa[prioridad] || 'chip-media'
}

const estadoLabel = {
  nuevo: 'Sin asignar',
  asignado: 'Asignado',
  en_atencion: 'En atención',
  cerrado: 'Cerrado',
}

const bordeEstado = (estado) => {
  const mapa = { nuevo: '3px solid var(--rojo)', asignado: '3px solid var(--en-camino)', en_atencion: '3px solid var(--disponible)' }
  return mapa[estado] || 'none'
}

const formatDireccion = (em) => {
  if (!em.ubicacion) return 'Sin ubicación'
  const { calle, colonia } = em.ubicacion
  if (calle && colonia) return `${calle}, ${colonia}`
  if (calle) return calle
  if (colonia) return colonia
  return 'Ubicación seleccionada'
}

// Cargar catálogos al abrir formulario
const abrirFormulario = async () => {
  mostrarFormulario.value = true
  emergenciaSeleccionada.value = null
  resetForm()
  try {
    const [inc, deps] = await Promise.all([
      catalogosService.incidentes(),
      catalogosService.dependencias(),
    ])
    incidentes.value = inc
    dependencias.value = deps
  } catch (e) {
    console.error('Error cargando catálogos:', e)
  }
}

const buscarColonias = () => {
  if (timerColonia) clearTimeout(timerColonia)
  coloniaSeleccionada.value = false // usuario está editando, resetear flag
  // Limpiar selección si el usuario borra el campo
  if (!busquedaColonia.value) {
    colonias.value = []
    form.value.ubicacion.colonia = ''
    return
  }
  if (busquedaColonia.value.length < 2) return

  timerColonia = setTimeout(async () => {
    buscandoColonias.value = true
    try {
      colonias.value = await catalogosService.colonias(busquedaColonia.value)
    } catch (e) {
      console.error('Error buscando colonias:', e)
    } finally {
      buscandoColonias.value = false
    }
  }, 300)
}

const buscarDirecciones = () => {
  if (timerDireccion) clearTimeout(timerDireccion)
  
  if (form.value.ubicacion.calle.length < 3) {
    sugerenciasDireccion.value = []
    return
  }

  // Debounce de 650ms
  timerDireccion = setTimeout(async () => {
    buscandoDireccion.value = true
    try {
      // Si ya hay colonia seleccionada, incluirla en la búsqueda para mejores resultados
      let queryParts = [form.value.ubicacion.calle]
      if (form.value.ubicacion.colonia) queryParts.push(form.value.ubicacion.colonia)
      queryParts.push('Zapopan')
      const q = encodeURIComponent(queryParts.join(', '))
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${q}&countrycodes=mx&viewbox=-103.55,20.85,-103.25,20.55&bounded=1&addressdetails=1&limit=5&email=rsoto@coe.zapopan.gob.mx`
      
      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'es-MX',
          'User-Agent': 'COE-Zapopan-PWA'
        }
      })
      if (res.ok) {
        const data = await res.json()
        sugerenciasDireccion.value = data
      }
    } catch (e) {
      console.error('Error buscando direcciones Nominatim:', e)
    } finally {
      buscandoDireccion.value = false
    }
    // Si ya hay colonia, intentar geocodificar el domicilio completo
    geocodificarDireccion()
  }, 650)
}

const seleccionarDireccion = (sug) => {
  // Extraer el nombre de la calle de forma limpia o usar la parte principal del display_name
  const streetName = sug.address?.road || sug.address?.pedestrian || sug.display_name.split(',')[0]
  form.value.ubicacion.calle = streetName
  form.value.ubicacion.lat = parseFloat(sug.lat)
  form.value.ubicacion.lng = parseFloat(sug.lon)
  
  // Auto-llenar Colonia (colonia) si Nominatim nos devuelve un suburbio
  if (sug.address) {
    const col = sug.address.suburb || sug.address.neighbourhood || sug.address.village || ''
    if (col) {
      form.value.ubicacion.colonia = col
      busquedaColonia.value = col
      coloniaSeleccionada.value = true
    }
  }

  // Centrar minimapa y mover el marcador
  if (minimap && minimapMarker) {
    const latlng = [parseFloat(sug.lat), parseFloat(sug.lon)]
    minimap.setView(latlng, 16)
    minimapMarker.setLatLng(latlng)
  }
  
  sugerenciasDireccion.value = []
}

const seleccionarColonia = (colonia) => {
  form.value.ubicacion.colonia = colonia.nombre
  busquedaColonia.value = colonia.nombre
  colonias.value = []
  coloniaSeleccionada.value = true
  // Si ya hay calle, geocodificar automáticamente
  geocodificarDireccion()
}

// ── Geocodificación automática: calle + colonia → pin en mapa ───────────────
const geocodificarDireccion = () => {
  const calle = form.value.ubicacion.calle?.trim()
  const colonia = form.value.ubicacion.colonia?.trim()
  if (!calle || calle.length < 3 || !colonia || colonia.length < 2) return

  // Debounce para no saturar Nominatim
  if (timerReverseGeo) clearTimeout(timerReverseGeo)
  timerReverseGeo = setTimeout(async () => {
    try {
      const q = encodeURIComponent(`${calle}, ${colonia}, Zapopan, Jalisco, México`)
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${q}&countrycodes=mx&viewbox=-103.55,20.85,-103.25,20.55&bounded=1&addressdetails=1&limit=1&email=rsoto@coe.zapopan.gob.mx`
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'es-MX', 'User-Agent': 'COE-Zapopan-PWA' }
      })
      if (res.ok) {
        const data = await res.json()
        if (data.length > 0) {
          const lat = parseFloat(data[0].lat)
          const lng = parseFloat(data[0].lon)
          form.value.ubicacion.lat = lat
          form.value.ubicacion.lng = lng
          // Mover el pin del minimapa
          if (minimap && minimapMarker) {
            minimap.setView([lat, lng], 16)
            minimapMarker.setLatLng([lat, lng])
          }
        }
      }
    } catch (e) {
      console.error('Error geocodificando dirección:', e)
    }
  }, 500)
}

// ── Lógica de Minimapa y Reverse Geocoding ──────────────────────────────────
const initMinimap = () => {
  if (minimap) {
    minimap.remove()
    minimap = null
    minimapMarker = null
  }

  const container = document.getElementById('minimap-registro')
  if (!container) return

  // Centro de Zapopan por defecto
  const defaultCenter = [20.7204, -103.3919]
  const initialLat = form.value.ubicacion.lat || defaultCenter[0]
  const initialLng = form.value.ubicacion.lng || defaultCenter[1]

  minimap = L.map('minimap-registro', {
    center: [initialLat, initialLng],
    zoom: 14,
    zoomControl: false
  })

  L.control.zoom({ position: 'bottomright' }).addTo(minimap)

  // Capa oscura CartoDB
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(minimap)

  // Marcador arrastrable
  minimapMarker = L.marker([initialLat, initialLng], {
    draggable: true
  }).addTo(minimap)

  // Evento al arrastrar (dragend)
  minimapMarker.on('dragend', () => {
    const pos = minimapMarker.getLatLng()
    actualizarCoordenadasPin(pos.lat, pos.lng)
  })

  // Evento al dar clic en el mapa
  minimap.on('click', (e) => {
    minimapMarker.setLatLng(e.latlng)
    actualizarCoordenadasPin(e.latlng.lat, e.latlng.lng)
  })
}

const actualizarCoordenadasPin = (lat, lng) => {
  form.value.ubicacion.lat = lat
  form.value.ubicacion.lng = lng

  if (timerReverseGeo) clearTimeout(timerReverseGeo)

  // Debounce de 500ms para reverse geocoding
  timerReverseGeo = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&email=rsoto@coe.zapopan.gob.mx`
      const res = await fetch(url, {
        headers: {
          'Accept-Language': 'es-MX',
          'User-Agent': 'COE-Zapopan-PWA'
        }
      })
      if (res.ok) {
        const data = await res.json()
        if (data && data.address) {
          const street = data.address.road || data.address.pedestrian || data.address.footway || ''
          const col = data.address.suburb || data.address.neighbourhood || data.address.village || ''

          // Autocompletar solo si están vacíos o no modificados manualmente
          if (street && !form.value.ubicacion.calle) {
            form.value.ubicacion.calle = street
          }
          if (col && !form.value.ubicacion.colonia) {
            form.value.ubicacion.colonia = col
            busquedaColonia.value = col
          }
        }
      }
    } catch (e) {
      console.error('Error en reverse geocoding Nominatim:', e)
    }
  }, 500)
}

// Watcher para inicializar minimapa al abrir formulario
watch(mostrarFormulario, async (val) => {
  if (val) {
    await nextTick()
    initMinimap()
  } else {
    if (minimap) {
      minimap.remove()
      minimap = null
      minimapMarker = null
    }
  }
})

const seleccionarIncidente = (incidente) => {
  if (!incidente) return
  form.value.catalogoIncidente = incidente._id
  form.value.tipo = incidente.categoria
  form.value.subtipo = `${incidente.codigo_cnie} ${incidente.nombre}`
  // Auto-sugerir prioridad
  const mapaPrioridad = { 'Crítica': 'critica', 'Alta': 'alta', 'Media': 'media', 'Baja': 'baja' }
  form.value.prioridad = mapaPrioridad[incidente.prioridadSugerida] || 'media'
}

const toggleDependencia = (depId) => {
  const idx = form.value.dependenciasApoyo.indexOf(depId)
  if (idx === -1) form.value.dependenciasApoyo.push(depId)
  else form.value.dependenciasApoyo.splice(idx, 1)
}

const resetForm = () => {
  form.value = {
    tipo: '', subtipo: '', catalogoIncidente: null,
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
    prioridad: 'media', personas: 0, animales: 0,
    notas: '', telefonoContacto: '', nombreContacto: '', dependenciasApoyo: [],
  }
  busquedaColonia.value = ''
  colonias.value = []
  coloniaSeleccionada.value = false
  sugerenciasDireccion.value = []
  formError.value = ''
  erroresCampos.value = {}
}

const guardarEmergencia = async () => {
  if (guardando.value) return // anti double-click
  formError.value = ''
  erroresCampos.value = {}

  // Si el usuario escribió en el campo pero no seleccionó del dropdown, aceptar el texto
  if (!form.value.ubicacion.colonia && busquedaColonia.value) {
    form.value.ubicacion.colonia = busquedaColonia.value
  }

  // ── Validación campo a campo ───────────────────────────────────────
  let hayErrores = false

  if (!form.value.catalogoIncidente) {
    erroresCampos.value.incidente = 'Selecciona el tipo de incidente'
    hayErrores = true
  }
  if (!form.value.ubicacion.colonia) {
    erroresCampos.value.colonia = 'Escribe o selecciona una colonia'
    hayErrores = true
  }
  if (!form.value.ubicacion.calle || form.value.ubicacion.calle.trim().length < 3) {
    erroresCampos.value.calle = 'Ingresa la calle (mínimo 3 caracteres)'
    hayErrores = true
  }
  if (!form.value.prioridad) {
    erroresCampos.value.prioridad = 'Selecciona la prioridad'
    hayErrores = true
  }

  if (hayErrores) {
    formError.value = '⚠ Completa todos los campos obligatorios marcados con *'
    // Hacer scroll al primer error
    await nextTick()
    const primerError = document.querySelector('.campo-error')
    if (primerError) primerError.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }

  // Si no se han definido coordenadas, usar Zapopan Centro por default para evitar nulos
  if (!form.value.ubicacion.lat || !form.value.ubicacion.lng) {
    form.value.ubicacion.lat = 20.7204
    form.value.ubicacion.lng = -103.3919
  }

  // Construir dirección completa manualmente
  const c = form.value.ubicacion.calle
  const ext = form.value.ubicacion.numeroExterior ? ` #${form.value.ubicacion.numeroExterior}` : ''
  const int = form.value.ubicacion.numeroInterior ? ` Int. ${form.value.ubicacion.numeroInterior}` : ''
  const col = form.value.ubicacion.colonia ? `, Col. ${form.value.ubicacion.colonia}` : ''
  const refText = form.value.ubicacion.referencias ? ` (Ref: ${form.value.ubicacion.referencias})` : ''

  form.value.ubicacion.direccionCompleta = `${c}${ext}${int}${col}${refText}`

  guardando.value = true
  try {
    const res = await store.crear(form.value)
    if (res.exito) {
      if (res.offline) {
        alert('📴 Registrado sin conexión. El incidente se sincronizará automáticamente al recuperar internet.')
      } else {
        alert('✅ Incidente registrado correctamente.')
      }
      mostrarFormulario.value = false
      resetForm()
    } else {
      formError.value = res.error
    }
  } finally {
    guardando.value = false
  }
}

const seleccionarEmergencia = (em) => {
  emergenciaSeleccionada.value = emergenciaSeleccionada.value?._id === em._id ? null : em
}

const asignarRapido = async (emergenciaId) => {
  try {
    unidadesDisponibles.value = await unidadesService.disponibles()
  } catch (e) { /* */ }
}

const confirmarAsignacion = async (emergenciaId, unidadId) => {
  await store.asignarUnidad(emergenciaId, unidadId)
  unidadesDisponibles.value = []
}

const cerrarEmergencia = async (id) => {
  await store.cambiarEstado(id, 'cerrado')
  emergenciaSeleccionada.value = null
}

onMounted(async () => {
  store.cargarActivas()
  try {
    const { initOfflineSync } = await import('@/services/offlineSync.js')
    initOfflineSync()
  } catch (e) {}
})

// Mantener emergenciaSeleccionada sincronizada con actualizaciones del store
watch(
  () => store.emergencias,
  (lista) => {
    if (emergenciaSeleccionada.value) {
      const actualizada = lista.find((e) => e._id === emergenciaSeleccionada.value._id)
      if (actualizada) {
        emergenciaSeleccionada.value = actualizada
      } else {
        // Fue cerrada/eliminada
        emergenciaSeleccionada.value = null
      }
    }
  },
  { deep: true }
)
</script>

<template>
  <div class="emergencias-page">
    <!-- ── Panel izquierdo: lista ──────────────────────────────── -->
    <div class="panel-lista">
      <!-- Encabezado -->
      <div class="lista-header">
        <div>
          <h2>Emergencias activas</h2>
          <p class="texto-muted texto-sm">
            {{ store.totalActivas }} en curso · {{ store.sinAsignar }} sin asignar
          </p>
        </div>
        <button class="btn btn-primario" @click="abrirFormulario" id="btn-nueva-emergencia">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="16" height="16">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nueva
        </button>
      </div>

      <!-- Filtros de estado -->
      <div class="filtros-estado">
        <button class="filtro-chip" :class="{ activo: filtroEstado === '' }" @click="filtroEstado = ''">
          Todas <span class="filtro-count">{{ store.totalActivas }}</span>
        </button>
        <button class="filtro-chip" :class="{ activo: filtroEstado === 'nuevo' }" @click="filtroEstado = 'nuevo'">
          Nuevas <span class="filtro-count">{{ store.conteos.nuevo }}</span>
        </button>
        <button class="filtro-chip" :class="{ activo: filtroEstado === 'asignado' }" @click="filtroEstado = 'asignado'">
          Asignadas <span class="filtro-count">{{ store.conteos.asignado }}</span>
        </button>
        <button class="filtro-chip" :class="{ activo: filtroEstado === 'en_atencion' }" @click="filtroEstado = 'en_atencion'">
          En atención <span class="filtro-count">{{ store.conteos.en_atencion }}</span>
        </button>
      </div>

      <!-- Loading -->
      <div v-if="store.cargando" class="lista-cargando">
        <div class="spinner-grande"></div>
        <p class="texto-muted">Cargando emergencias...</p>
      </div>

      <!-- Lista vacía -->
      <div v-else-if="emergenciasFiltradas.length === 0" class="lista-vacia">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor" width="40" height="40" style="color: var(--texto-dim)">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="texto-muted">Sin emergencias activas</p>
      </div>

      <!-- Lista de emergencias -->
      <div v-else class="lista-emergencias">
        <div
          v-for="em in emergenciasFiltradas"
          :key="em._id"
          class="emergencia-item card-accion"
          :class="{ seleccionada: emergenciaSeleccionada?._id === em._id }"
          :style="{ borderLeft: bordeEstado(em.estado) }"
          @click="seleccionarEmergencia(em)"
        >
          <div class="em-header">
            <span class="em-folio texto-xs texto-muted">{{ em.folio }}</span>
            <span class="chip" :class="chipClase(em.prioridad)">{{ em.prioridad }}</span>
          </div>
          <h4 class="em-tipo">{{ em.subtipo || em.tipo }}</h4>
          <div class="em-meta">
            <span class="em-meta-item">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="13" height="13">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              {{ formatDireccion(em) }}
            </span>
          </div>
          <div class="em-footer">
            <span class="texto-xs texto-muted">{{ tiempoTranscurrido(em.tiempoReporte) }}</span>
            <span class="texto-xs texto-muted">· {{ estadoLabel[em.estado] }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Panel derecho: detalle / formulario ──────────────────── -->
    <div class="panel-detalle">
      <!-- Formulario nueva emergencia -->
      <div v-if="mostrarFormulario" class="detalle-form animar-fade">
        <div class="detalle-header">
          <h3>Registrar emergencia</h3>
          <button class="btn-icono" @click="mostrarFormulario = false">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="20" height="20">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Error -->
        <div v-if="formError" class="login-error" style="margin-bottom:12px;">{{ formError }}</div>

        <form @submit.prevent="guardarEmergencia" class="form-emergencia">
          <!-- Tipo de incidente -->
          <div class="form-campo" :class="{ 'campo-error': erroresCampos.incidente }">
            <label class="form-label">Tipo de incidente *</label>
            <select class="input input-select-custom" :class="{ 'input-error': erroresCampos.incidente }" v-model="form.catalogoIncidente" @change="seleccionarIncidente(incidentes.find(i => i._id === form.catalogoIncidente)); erroresCampos.incidente = null">
              <option :value="null" disabled style="background:#1e293b; color:#94a3b8;">Selecciona del catálogo CNIE...</option>
              <option v-for="inc in incidentes" :key="inc._id" :value="inc._id" style="background:#1e293b; color:#ffffff; padding:8px;">
                {{ inc.codigo_cnie }} — {{ inc.nombre }}
              </option>
            </select>
            <span v-if="erroresCampos.incidente" class="mensaje-error">{{ erroresCampos.incidente }}</span>
          </div>

          <!-- Zona / Colonia -->
          <div class="form-campo" :class="{ 'campo-error': erroresCampos.colonia }">
            <label class="form-label">Zona / Colonia *</label>
            <div class="autocomplete-wrap">
              <input
                class="input"
                :class="{ 'input-error': erroresCampos.colonia }"
                v-model="busquedaColonia"
                @input="buscarColonias(); erroresCampos.colonia = null"
                placeholder="Escribe el nombre de la colonia..."
                autocomplete="off"
              />
              <!-- Buscando -->
              <div v-if="buscandoColonias" class="autocomplete-dropdown" style="padding:10px;font-size:0.75rem;color:var(--texto-dim);">
                Buscando colonias...
              </div>
              <!-- Resultados -->
              <div v-else-if="colonias.length > 0" class="autocomplete-dropdown">
                <div
                  v-for="col in colonias"
                  :key="col._id"
                  class="autocomplete-item"
                  @click="seleccionarColonia(col); erroresCampos.colonia = null"
                >
                  {{ col.nombre }} <span class="texto-muted texto-xs">({{ col.tipo }} — CP {{ col.codigoPostal }})</span>
                </div>
              </div>
              <!-- Sin resultados (solo si NO acaba de seleccionar una) -->
              <div v-else-if="busquedaColonia.length >= 2 && !buscandoColonias && colonias.length === 0 && !coloniaSeleccionada" class="autocomplete-dropdown" style="padding:10px;font-size:0.75rem;color:var(--texto-dim);">
                No se encontraron colonias. Puedes escribir el nombre manualmente.
              </div>
            </div>
            <span v-if="erroresCampos.colonia" class="mensaje-error">{{ erroresCampos.colonia }}</span>
          </div>

          <!-- Calle (Autocomplete Nominatim) -->
          <div class="form-campo" :class="{ 'campo-error': erroresCampos.calle }">
            <label class="form-label">Calle *</label>
            <div class="autocomplete-wrap">
              <input
                class="input"
                :class="{ 'input-error': erroresCampos.calle }"
                v-model="form.ubicacion.calle"
                @input="buscarDirecciones(); erroresCampos.calle = null"
                placeholder="Calle / Av..."
                autocomplete="off"
              />
              <div v-if="buscandoDireccion" class="autocomplete-dropdown" style="padding:10px;font-size:0.75rem;color:var(--texto-dim);">
                Buscando calles en tiempo real...
              </div>
              <div v-else-if="sugerenciasDireccion.length > 0" class="autocomplete-dropdown">
                <div
                  v-for="sug in sugerenciasDireccion"
                  :key="sug.place_id"
                  class="autocomplete-item"
                  @click="seleccionarDireccion(sug)"
                >
                  {{ sug.display_name }}
                </div>
              </div>
            </div>
            <span v-if="erroresCampos.calle" class="mensaje-error">{{ erroresCampos.calle }}</span>
          </div>

          <!-- Números Exterior e Interior -->
          <div class="form-fila">
            <div class="form-campo">
              <label class="form-label">Número exterior *</label>
              <input class="input" v-model="form.ubicacion.numeroExterior" placeholder="Ej. 1245 o S/N" />
            </div>
            <div class="form-campo">
              <label class="form-label">Número interior (opcional)</label>
              <input class="input" v-model="form.ubicacion.numeroInterior" placeholder="Ej. A-102" />
            </div>
          </div>

          <!-- Entre calles / Referencias -->
          <div class="form-campo">
            <label class="form-label">Entre calles / Referencias</label>
            <textarea class="input" rows="2" v-model="form.ubicacion.referencias" placeholder="Ej. entre Chopin y Beethoven, frente al parque..."></textarea>
          </div>

          <!-- Minimapa con Pin Arrastrable -->
          <div class="form-campo">
            <label class="form-label" style="margin-bottom:8px;">Ubicación geográfica real (Arrastra el pin o da clic en el mapa) *</label>
            <div id="minimap-registro" style="height: 220px; width: 100%; border-radius: 8px; border: 1px solid var(--borde); position: relative; z-index: 1;"></div>
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

          <!-- Personas / Animales -->
          <div class="form-fila">
            <div class="form-campo">
              <label class="form-label">Personas involucradas</label>
              <input class="input" type="number" min="0" v-model.number="form.personas" />
            </div>
            <div class="form-campo">
              <label class="form-label">Animales</label>
              <input class="input" type="number" min="0" v-model.number="form.animales" />
            </div>
          </div>

          <!-- Contacto -->
          <div class="form-fila">
            <div class="form-campo">
              <label class="form-label">Nombre contacto</label>
              <input class="input" v-model="form.nombreContacto" placeholder="Nombre del reportante" />
            </div>
            <div class="form-campo">
              <label class="form-label">Teléfono</label>
              <input class="input" v-model="form.telefonoContacto" placeholder="10 dígitos" />
            </div>
          </div>

          <!-- Notas -->
          <div class="form-campo">
            <label class="form-label">Notas / Observaciones</label>
            <textarea class="input" rows="3" v-model="form.notas" placeholder="Información adicional..."></textarea>
          </div>

          <!-- Dependencias de apoyo -->
          <div class="form-campo">
            <label class="form-label">Dependencias de apoyo</label>
            <div class="deps-grid">
              <button
                type="button"
                v-for="dep in dependencias"
                :key="dep._id"
                class="dep-chip"
                :class="{ activo: form.dependenciasApoyo.includes(dep._id) }"
                @click="toggleDependencia(dep._id)"
              >{{ dep.nombreCorto }}</button>
            </div>
          </div>

          <!-- Botones -->
          <div class="form-acciones">
            <button type="button" class="btn btn-ghost" @click="mostrarFormulario = false">Cancelar</button>
            <button type="submit" class="btn btn-primario" :disabled="guardando" id="btn-guardar-emergencia">
              <span v-if="guardando" class="spinner"></span>
              <span v-else>Registrar emergencia</span>
            </button>
          </div>
        </form>
      </div>

      <!-- Detalle de emergencia seleccionada -->
      <div v-else-if="emergenciaSeleccionada" class="detalle-info animar-fade">
        <div class="detalle-header">
          <div>
            <span class="texto-xs texto-muted">{{ emergenciaSeleccionada.folio }}</span>
            <h3>{{ emergenciaSeleccionada.subtipo || emergenciaSeleccionada.tipo }}</h3>
          </div>
          <span class="chip" :class="chipClase(emergenciaSeleccionada.prioridad)">
            Prioridad {{ emergenciaSeleccionada.prioridad }}
          </span>
        </div>

        <p class="detalle-direccion">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="14" height="14" style="flex-shrink:0;margin-top:2px;">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
          {{ emergenciaSeleccionada.direccion }}, {{ emergenciaSeleccionada.zona }}
        </p>

        <hr class="divisor" />

        <!-- Métricas rápidas -->
        <div class="metricas-grid">
          <div class="metrica-item">
            <span class="metrica-label">Unidad</span>
            <span class="metrica-valor">{{ emergenciaSeleccionada.unidadAsignada?.nombre || '—' }}</span>
          </div>
          <div class="metrica-item">
            <span class="metrica-label">Estado</span>
            <span class="metrica-valor">{{ estadoLabel[emergenciaSeleccionada.estado] }}</span>
          </div>
          <div class="metrica-item">
            <span class="metrica-label">Personas</span>
            <span class="metrica-valor">{{ emergenciaSeleccionada.personas }}</span>
          </div>
          <div class="metrica-item">
            <span class="metrica-label">Tiempo</span>
            <span class="metrica-valor">{{ tiempoTranscurrido(emergenciaSeleccionada.tiempoReporte) }}</span>
          </div>
        </div>

        <div v-if="emergenciaSeleccionada.notas" class="detalle-notas">
          <span class="form-label">Notas</span>
          <p>{{ emergenciaSeleccionada.notas }}</p>
        </div>

        <hr class="divisor" />

        <!-- Acciones -->
        <div class="detalle-acciones">
          <template v-if="emergenciaSeleccionada.estado === 'nuevo'">
            <button class="btn btn-primario w-full" @click="asignarRapido(emergenciaSeleccionada._id)">
              Asignar unidad
            </button>
            <!-- Selector de unidad con diseño táctico sobrio (Cuerpo de Bomberos) -->
            <div v-if="unidadesDisponibles.length > 0" class="dispatch-unidades-container" style="margin-top:14px; background:#18181b; padding:14px; border-radius:10px; border:1px solid #27272a;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="color:#e4e4e7; font-weight:700; font-size:0.8rem; text-transform:uppercase; letter-spacing:0.8px;">Unidades listas para despacho</span>
                <span style="background:#27272a; color:#a1a1aa; font-size:0.72rem; padding:2px 8px; border-radius:4px; font-weight:600;">{{ unidadesDisponibles.length }} en base</span>
              </div>

              <div class="unidades-grid-cards" style="display:grid; grid-template-columns: 1fr; gap:8px;">
                <button
                  v-for="u in unidadesDisponibles"
                  :key="u._id"
                  class="card-unidad-dispatch"
                  @click="confirmarAsignacion(emergenciaSeleccionada._id, u._id)"
                  style="background:#27272a; border:1px solid #3f3f46; border-left:4px solid #dc2626; border-radius:6px; padding:10px 14px; text-align:left; cursor:pointer; transition:all 0.2s ease;"
                >
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="color:#ffffff; font-weight:700; font-size:0.95rem; letter-spacing:0.3px;">
                      {{ u.tipo === 'Ambulancia' ? '🚑' : u.tipo === 'Bomba' ? '🚒' : u.tipo === 'Rescate' ? '🛟' : '🚓' }} {{ u.nombre }}
                    </span>
                    <span style="background:#450a0a; color:#fca5a5; border:1px solid #991b1b; font-size:0.68rem; font-weight:700; padding:2px 8px; border-radius:4px; letter-spacing:0.5px;">
                      DISPONIBLE
                    </span>
                  </div>
                  
                  <div style="display:flex; gap:12px; margin-top:8px; font-size:0.75rem;">
                    <span style="background:#18181b; padding:3px 8px; border-radius:4px; color:#e4e4e7; border:1px solid #3f3f46;">
                      Tipo: <strong style="color:#ffffff;">{{ u.tipo }}</strong>
                    </span>
                    <span style="background:#18181b; padding:3px 8px; border-radius:4px; color:#e4e4e7; border:1px solid #3f3f46;">
                      Base: <strong style="color:#ffffff;">{{ u.base }}</strong>
                    </span>
                  </div>
                </button>
              </div>
            </div>
          </template>

          <button
            v-if="emergenciaSeleccionada.estado !== 'cerrado'"
            class="btn btn-ghost w-full"
            @click="cerrarEmergencia(emergenciaSeleccionada._id)"
          >
            Cerrar emergencia
          </button>
        </div>
      </div>

      <!-- Sin selección -->
      <div v-else class="detalle-vacio">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor" width="48" height="48" style="color:var(--texto-dim);">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
        </svg>
        <p class="texto-muted">Selecciona una emergencia de la lista<br />o crea una nueva</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.emergencias-page {
  display: flex;
  height: calc(100vh - 57px); /* restar header */
}

/* ── Panel izquierdo ─────────────────────────────────────── */
.panel-lista {
  width: 380px;
  min-width: 320px;
  border-right: 1px solid var(--borde);
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
}

.lista-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 12px;
}
.lista-header h2 { font-size: 1.1rem; margin: 0; }

/* Filtros */
.filtros-estado {
  display: flex;
  gap: 6px;
  padding: 0 20px 12px;
  overflow-x: auto;
}

.filtro-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 20px;
  background: var(--bg-card);
  border: 1px solid var(--borde);
  color: var(--texto-muted);
  font-size: 0.72rem;
  font-family: var(--fuente);
  cursor: pointer;
  transition: all var(--trans);
  white-space: nowrap;
}
.filtro-chip:hover { border-color: var(--rojo-borde); }
.filtro-chip.activo { background: var(--rojo-suave); border-color: var(--rojo-borde); color: var(--rojo); }
.filtro-count {
  background: rgba(255,255,255,0.1);
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
}

/* Lista */
.lista-emergencias {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 12px;
}

.emergencia-item {
  background: var(--bg-card);
  border: 1px solid var(--borde);
  border-radius: var(--radio);
  padding: 14px 16px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all var(--trans);
}
.emergencia-item:hover { background: var(--bg-card-hover); }
.emergencia-item.seleccionada { border-color: var(--rojo); background: var(--rojo-suave); }

.em-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.em-tipo { font-size: 0.88rem; margin: 0 0 6px; color: var(--texto-blanco); }
.em-meta { display: flex; gap: 12px; margin-bottom: 4px; }
.em-meta-item { display: flex; align-items: center; gap: 4px; font-size: 0.78rem; color: var(--texto-muted); }
.em-footer { display: flex; gap: 6px; }

/* Cargando / vacío */
.lista-cargando, .lista-vacia { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; }
.spinner-grande { width:32px; height:32px; border:3px solid var(--borde); border-top-color:var(--rojo); border-radius:50%; animation:girar 0.8s linear infinite; }

/* ── Panel derecho ───────────────────────────────────────── */
.panel-detalle {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-base);
}

.detalle-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}
.detalle-header h3 { margin: 4px 0 0; font-size: 1.1rem; }

.detalle-form, .detalle-info { padding: 24px; }

.detalle-direccion { display:flex; align-items:flex-start; gap:6px; color:var(--texto-muted); font-size:0.88rem; }

/* Formulario */
.form-emergencia { display: flex; flex-direction: column; gap: 4px; }
.form-fila { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-acciones { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; }

.login-error { display:flex; align-items:center; gap:8px; background:var(--alta-bg); border:1px solid var(--rojo-borde); border-radius:var(--radio); padding:10px 14px; color:#fca5a5; font-size:0.82rem; }

/* Prioridad selector */
.prioridad-selector { display: flex; gap: 8px; }
.prioridad-selector .chip { cursor: pointer; opacity: 0.5; transition: opacity var(--trans); }
.prioridad-selector .chip.seleccionada { opacity: 1; transform: scale(1.05); }

.input-select-custom option {
  background-color: #1e293b !important;
  color: #ffffff !important;
  padding: 10px;
}

/* Autocomplete */
.autocomplete-wrap { position: relative; }
.autocomplete-dropdown {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 50;
  background: var(--bg-card); border: 1px solid var(--borde); border-radius: var(--radio);
  max-height: 200px; overflow-y: auto; margin-top: 4px; box-shadow: var(--sombra-lg);
}
.autocomplete-item { padding: 10px 14px; cursor: pointer; font-size: 0.82rem; color: var(--texto); transition: background var(--trans); }
.autocomplete-item:hover { background: var(--bg-card-hover); }

/* Dependencias chips */
.deps-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.dep-chip {
  padding: 5px 12px; border-radius: 20px; font-size: 0.72rem; font-family: var(--fuente);
  background: var(--bg-card); border: 1px solid var(--borde); color: var(--texto-muted);
  cursor: pointer; transition: all var(--trans);
}
.dep-chip:hover { border-color: var(--rojo-borde); }
.dep-chip.activo { background: var(--rojo-suave); border-color: var(--rojo); color: var(--rojo); }

/* Validación de campos */
.input-error { border-color: #ef4444 !important; box-shadow: 0 0 0 2px rgba(239,68,68,0.15) !important; }
.campo-error .form-label { color: #ef4444; }
.mensaje-error {
  display: block;
  font-size: 0.72rem;
  color: #ef4444;
  margin-top: 4px;
  padding-left: 2px;
  animation: shake 0.3s ease;
}
@keyframes shake {
  0%,100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

/* Métricas */
.metricas-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; }
.metrica-item { background: var(--bg-card); border-radius: var(--radio); padding: 12px; text-align: center; border: 1px solid var(--borde); }
.metrica-label { display: block; font-size: 0.68rem; color: var(--texto-dim); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.metrica-valor { display: block; font-size: 0.9rem; font-weight: 600; color: var(--texto-blanco); }

.detalle-notas { margin-top: 16px; }
.detalle-notas p { font-size: 0.85rem; color: var(--texto); }

/* Acciones detalle */
.detalle-acciones { display: flex; flex-direction: column; gap: 10px; }

.unidades-lista { display: flex; flex-direction: column; gap: 6px; }
.unidad-opcion {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 14px; background: var(--bg-card); border: 1px solid var(--borde);
  border-radius: var(--radio); cursor: pointer; transition: all var(--trans); text-align: left;
  font-family: var(--fuente);
}
.unidad-opcion:hover { border-color: var(--rojo); background: var(--rojo-suave); }

/* Sin selección */
.detalle-vacio { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 16px; text-align: center; }

.card-unidad-dispatch:hover {
  background: #3f3f46 !important;
  border-color: #ef4444 !important;
  transform: translateY(-1px);
}

@keyframes girar { to { transform: rotate(360deg); } }

/* Responsive */
@media (max-width: 800px) {
  .emergencias-page { flex-direction: column; height: auto; }
  .panel-lista { width: 100%; min-width: unset; max-height: 50vh; border-right: none; border-bottom: 1px solid var(--borde); }
  .metricas-grid { grid-template-columns: 1fr 1fr; }
}
</style>
