<script setup>
import { ref, onMounted, computed } from 'vue'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import api from '@/services/api.js'

const emergencias = ref([])
const stats = ref(null)
const cargando = ref(false)
const filtroActivo = ref('TODOS')

// Modal de documento
const documentoVisible = ref(false)
const emergenciaDetalle = ref(null)
const cargandoDetalle = ref(false)

const cargarDatos = async () => {
  cargando.value = true
  try {
    const [resEmergencias, resStats] = await Promise.all([
      api.get('/emergencias?limite=500'),
      api.get('/emergencias/stats')
    ])
    emergencias.value = resEmergencias.data.emergencias || []
    stats.value = resStats.data
  } catch (error) {
    console.error('Error cargando datos de auditoría', error)
  } finally {
    cargando.value = false
  }
}

onMounted(() => {
  cargarDatos()
})

// === Filtros ===
const tabs = ['TODOS', 'CERRADOS', 'EN ATENCIÓN', 'NUEVOS']

const emergenciasFiltradas = computed(() => {
  if (filtroActivo.value === 'TODOS') return emergencias.value
  if (filtroActivo.value === 'CERRADOS') return emergencias.value.filter(em => em.estado === 'cerrado')
  if (filtroActivo.value === 'EN ATENCIÓN') return emergencias.value.filter(em => em.estado === 'en_atencion' || em.estado === 'asignado')
  if (filtroActivo.value === 'NUEVOS') return emergencias.value.filter(em => em.estado === 'nuevo')
  return emergencias.value
})

// === Helpers visuales ===
const getIconForType = (tipo) => {
  const t = (tipo || '').toLowerCase()
  if (t.includes('médica') || t.includes('salud')) return '🚑'
  if (t.includes('fuego') || t.includes('incendio')) return '🔥'
  if (t.includes('accidente') || t.includes('choque')) return '🚓'
  if (t.includes('rescate')) return '🧗'
  if (t.includes('abeja') || t.includes('fauna')) return '🐝'
  if (t.includes('gas') || t.includes('fuga')) return '⚠️'
  return '🚨'
}

const formatFechaHora = (isoDate) => {
  if (!isoDate) return { fecha: '--', hora: '--' }
  const d = new Date(isoDate)
  const fecha = d.toLocaleDateString('es-MX', { month: 'short', day: '2-digit', year: 'numeric' })
  const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return { fecha, hora: `${hora} CST` }
}

const formatFechaCompleta = (isoDate) => {
  if (!isoDate) return 'No registrado'
  const d = new Date(isoDate)
  return d.toLocaleString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

const calcularTiempoRespuestaFormateado = (em) => {
  if (!em.tiempoReporte || !em.tiempoAsignacion) return '--:--'
  const diffMs = new Date(em.tiempoAsignacion) - new Date(em.tiempoReporte)
  const totalSecs = Math.floor(diffMs / 1000)
  const min = Math.floor(totalSecs / 60)
  const sec = totalSecs % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const calcularDuracionTotal = (em) => {
  if (!em.tiempoReporte || !em.tiempoCierre) return 'N/A'
  const diffMs = new Date(em.tiempoCierre) - new Date(em.tiempoReporte)
  const totalMin = Math.floor(diffMs / 60000)
  const horas = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (horas > 0) return `${horas}h ${min}m`
  return `${min} min`
}

const estadoLabel = (estado) => {
  const labels = {
    nuevo: 'NUEVO',
    asignado: 'ASIGNADO',
    en_atencion: 'EN ATENCIÓN',
    cerrado: 'FINALIZADO'
  }
  return labels[estado] || estado?.toUpperCase() || '--'
}

const estadoClase = (estado) => {
  const clases = {
    nuevo: 'status-nuevo',
    asignado: 'status-asignado',
    en_atencion: 'status-atencion',
    cerrado: 'status-cerrado'
  }
  return clases[estado] || ''
}

// === Abrir documento detalle ===
const verDocumento = async (em) => {
  cargandoDetalle.value = true
  documentoVisible.value = true
  try {
    const { data } = await api.get(`/emergencias/${em._id}`)
    emergenciaDetalle.value = data
  } catch (e) {
    console.error('Error cargando detalle:', e)
    emergenciaDetalle.value = em
  } finally {
    cargandoDetalle.value = false
  }
}

const cerrarDocumento = () => {
  documentoVisible.value = false
  emergenciaDetalle.value = null
}

const copiarFolio = (folio) => {
  navigator.clipboard?.writeText(folio)
}

// === Exportar PDF Global ===
const generarPDF = () => {
  const doc = new jsPDF('landscape')
  doc.setFontSize(18)
  doc.text('Historial de Emergencias y Auditoría', 14, 22)
  doc.setFontSize(11)
  doc.text(`Reporte Global COE Zapopan - Generado: ${new Date().toLocaleString()}`, 14, 30)

  const head = [['Folio ID', 'Prioridad', 'Estado', 'Tipo', 'Ubicación', 'Tiempo Resp.']]
  const body = emergenciasFiltradas.value.map(em => {
    let ubiStr = 'Desconocida'
    if (em.ubicacion) {
      if (em.ubicacion.colonia && em.ubicacion.calle) {
        ubiStr = `${em.ubicacion.calle}, ${em.ubicacion.colonia}`
      } else {
        ubiStr = em.ubicacion.colonia || em.ubicacion.calle || 'Desconocida'
      }
    }
    return [
      em.folio,
      em.prioridad.toUpperCase(),
      em.estado.toUpperCase(),
      em.tipo,
      ubiStr,
      calcularTiempoRespuestaFormateado(em)
    ]
  })

  autoTable(doc, {
    startY: 40,
    head: head,
    body: body,
    theme: 'grid',
    headStyles: { fillColor: [211, 47, 47] },
    styles: { fontSize: 8, cellPadding: 3 }
  })

  doc.save(`Auditoria_COE_${new Date().getTime()}.pdf`)
}

// === Exportar PDF Individual (Documento de Novedades) ===
const exportarDocumentoPDF = (em) => {
  if (!em) return

  const doc = new jsPDF('portrait')
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14
  let y = 20

  // Header institucional
  doc.setFillColor(211, 47, 47)
  doc.rect(0, 0, pageWidth, 35, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont(undefined, 'bold')
  doc.text('DOCUMENTO DE NOVEDADES EN ESCENA', margin, 15)
  doc.setFontSize(10)
  doc.setFont(undefined, 'normal')
  doc.text(`Folio: ${em.folio || 'S/F'}  |  COE Zapopan  |  ${new Date().toLocaleDateString('es-MX')}`, margin, 25)
  doc.text(`Estado: ${estadoLabel(em.estado)}  |  Prioridad: ${(em.prioridad || '').toUpperCase()}`, margin, 31)

  y = 45
  doc.setTextColor(0, 0, 0)

  // ── Sección Helper ──
  const seccion = (titulo) => {
    if (y > 265) { doc.addPage(); y = 20 }
    doc.setFillColor(40, 40, 40)
    doc.rect(margin, y - 5, pageWidth - margin * 2, 8, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(10)
    doc.setFont(undefined, 'bold')
    doc.text(titulo, margin + 4, y + 1)
    doc.setTextColor(60, 60, 60)
    doc.setFont(undefined, 'normal')
    y += 10
  }

  const campo = (label, valor) => {
    if (y > 275) { doc.addPage(); y = 20 }
    doc.setFontSize(8)
    doc.setFont(undefined, 'bold')
    doc.setTextColor(100, 100, 100)
    doc.text(`${label}:`, margin, y)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(30, 30, 30)
    const textoVal = String(valor || 'N/A')
    const lines = doc.splitTextToSize(textoVal, pageWidth - margin * 2 - 50)
    doc.text(lines, margin + 50, y)
    y += Math.max(6, lines.length * 5)
  }

  // ── 1. INFORMACIÓN GENERAL ──
  seccion('1. INFORMACIÓN GENERAL DEL INCIDENTE')
  campo('Folio', em.folio)
  campo('Tipo', em.tipo)
  campo('Subtipo', em.subtipo)
  campo('Prioridad', (em.prioridad || '').toUpperCase())
  campo('Estado', estadoLabel(em.estado))

  const dir = em.ubicacion?.direccionCompleta ||
    [em.ubicacion?.calle, em.ubicacion?.numeroExterior, em.ubicacion?.colonia].filter(Boolean).join(', ')
  campo('Dirección', dir)
  if (em.ubicacion?.referencias) campo('Referencias', em.ubicacion.referencias)
  if (em.ubicacion?.lat && em.ubicacion?.lng) campo('Coordenadas', `${em.ubicacion.lat}, ${em.ubicacion.lng}`)
  campo('Notas iniciales', em.notas)

  // ── 2. CRONOLOGÍA ──
  seccion('2. CRONOLOGÍA DE ATENCIÓN')
  campo('Reportado', formatFechaCompleta(em.tiempoReporte))
  campo('Asignado', formatFechaCompleta(em.tiempoAsignacion))
  campo('Aceptado (Campo)', formatFechaCompleta(em.tiempoAceptacion))
  campo('Llegada Escena', formatFechaCompleta(em.tiempoEscena))
  campo('Cierre', formatFechaCompleta(em.tiempoCierre))
  campo('T. Respuesta', calcularTiempoRespuestaFormateado(em))
  campo('Duración Total', calcularDuracionTotal(em))

  // ── 3. UNIDAD Y OPERADOR ──
  seccion('3. RECURSOS ASIGNADOS')
  campo('Unidad', em.unidadAsignada?.nombre || 'Sin asignar')
  campo('Tipo Unidad', em.unidadAsignada?.tipo || 'N/A')
  campo('Responsable', em.unidadAsignada?.responsable || 'N/A')
  campo('Operador COE', em.operadorId?.nombre || 'N/A')

  // ── 4. REPORTE DE CAMPO ──
  const rc = em.reporteCampo
  if (rc) {
    seccion('4. REPORTE DE NOVEDADES EN ESCENA')
    if (rc.oficialCargo) campo('Oficial a Cargo', rc.oficialCargo)
    if (rc.descripcionLlegada) campo('Descripción Llegada', rc.descripcionLlegada)

    if (rc.entrevistado?.nombre) {
      campo('Entrevistado', rc.entrevistado.nombre)
      if (rc.entrevistado.tipo) campo('Se ostenta como', rc.entrevistado.tipo)
      if (rc.entrevistado.refiere) campo('Refiere que', rc.entrevistado.refiere)
    }

    // Plan de Acción / SCI
    if (rc.planAccion || rc.objetivos || rc.estrategias || rc.tacticas) {
      seccion('5. PLAN DE ACCIÓN / SCI')
      if (rc.planAccion) campo('Plan de Acción', rc.planAccion)
      if (rc.objetivos) campo('Objetivos', rc.objetivos)
      if (rc.estrategias) campo('Estrategias', rc.estrategias)
      if (rc.tacticas) campo('Tácticas', rc.tacticas)

      if (rc.mando) {
        if (rc.mando.cmdteIncidente) campo('Cmdte. Incidente', rc.mando.cmdteIncidente)
        if (rc.mando.seguridad) campo('Seguridad', rc.mando.seguridad)
        if (rc.mando.operaciones) campo('Operaciones', rc.mando.operaciones)
        if (rc.mando.planificacion) campo('Planificación', rc.mando.planificacion)
        if (rc.mando.logistica) campo('Logística', rc.mando.logistica)
      }
      if (rc.mensajeSeguridad) campo('Mensaje Seguridad', rc.mensajeSeguridad)
    }

    // Víctimas
    const tieneVictimas = rc.victimasTotal || rc.lesionados || rc.fallecidos || rc.rescatados
    if (tieneVictimas) {
      seccion('6. VÍCTIMAS Y TRASLADOS')
      campo('Total Víctimas', rc.victimasTotal)
      if (rc.lesionadosDetalle) {
        campo('Ilesos', rc.lesionadosDetalle.ilesos)
        campo('Leves', rc.lesionadosDetalle.leves)
        campo('Regulares', rc.lesionadosDetalle.regulares)
        campo('Graves', rc.lesionadosDetalle.graves)
        campo('Prensados', rc.lesionadosDetalle.prensados)
      }
      campo('Fallecidos', rc.fallecidos)
      campo('Rescatados', rc.rescatados)
      if (rc.observacionesVictimas) campo('Observaciones', rc.observacionesVictimas)
      if (rc.trasladadosPor) campo('Trasladados por', rc.trasladadosPor)
    }

    // Vehículos involucrados
    if (rc.vehiculosInvolucrados?.length > 0) {
      seccion('7. VEHÍCULOS INVOLUCRADOS')
      rc.vehiculosInvolucrados.forEach((v, i) => {
        campo(`Vehículo ${i + 1}`, `${v.tipo} ${v.marca} ${v.modelo} | Placas: ${v.placas || 'S/P'} | Color: ${v.color || 'N/A'} | Conductor: ${v.conductor || 'N/A'} | Chocó con: ${v.impactoCon || 'N/A'}`)
      })
    }

    // Detalles específicos
    if (rc.detallesEspecificos && Object.keys(rc.detallesEspecificos).length > 0) {
      seccion('8. DETALLES ESPECÍFICOS DEL INCIDENTE')
      Object.entries(rc.detallesEspecificos).forEach(([key, val]) => {
        const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())
        campo(label, val)
      })
    }

    // Causas y Daños
    if (rc.posiblesCausas || rc.danosVisibles) {
      seccion('9. CAUSAS Y DAÑOS')
      if (rc.posiblesCausas) campo('Posibles Causas', rc.posiblesCausas)
      if (rc.danosVisibles) campo('Daños Visibles', rc.danosVisibles)
      campo('Pérdidas Evitadas', rc.perdidasEvitadas ? 'Sí' : 'No')
    }

    // Dependencias presentes
    if (rc.dependenciasPresentes?.length > 0) {
      seccion('10. DEPENDENCIAS PRESENTES')
      rc.dependenciasPresentes.forEach((dep, i) => {
        campo(`Dependencia ${i + 1}`, `${dep.nombre} | Unidad: ${dep.unidad || 'N/A'} | A cargo: ${dep.aCargo || 'N/A'}`)
      })
    }

    // Cierre
    if (rc.primerRespondiente || rc.consumoTotal || rc.observacionesGenerales) {
      seccion('11. CIERRE Y OBSERVACIONES')
      if (rc.primerRespondiente) campo('Primer Respondiente', rc.primerRespondiente)
      if (rc.primerInterviniente) campo('Primer Interviniente', rc.primerInterviniente)
      if (rc.personalAsistente) campo('Personal Asistente', rc.personalAsistente)
      if (rc.consumoTotal) campo('Consumo Total', rc.consumoTotal)
      if (rc.aCargoAlRetiro) campo('A Cargo al Retiro', rc.aCargoAlRetiro)
      if (rc.bienesEntregadosA) campo('Bienes Entregados a', rc.bienesEntregadosA)
      if (rc.observacionesGenerales) campo('Observaciones Generales', rc.observacionesGenerales)
    }
  }

  // Footer
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(150, 150, 150)
    doc.text(`COE Zapopan — Documento generado automáticamente — Página ${i} de ${pageCount}`, margin, doc.internal.pageSize.getHeight() - 8)
  }

  doc.save(`Novedades_${em.folio || 'SinFolio'}_${new Date().getTime()}.pdf`)
}
</script>

<template>
  <div class="auditoria-view p-6 fade-in">
    <!-- Header -->
    <div class="header-section mb-8">
      <div class="header-text">
        <h1 class="page-title">Historial de Emergencias y Auditoría</h1>
        <p class="page-subtitle">Registros de incidentes, documentos de novedades en escena y exportación de reportes.</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-red export-btn flex items-center gap-2" @click="generarPDF" :disabled="cargando">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
          EXPORTAR REPORTE GLOBAL
        </button>
      </div>
    </div>

    <div v-if="cargando" class="flex-center py-12">
      <div class="spinner-tactical"></div>
    </div>
    
    <div v-else>
      <!-- KPI Top Left -->
      <div class="kpi-totales mb-6" v-if="stats">
        <div class="kpi-label uppercase">INCIDENTES TOTALES (24H)</div>
        <div class="kpi-value-row">
          <span class="kpi-numero">{{ stats.tacticos.emergenciasHoy }}</span>
          <span class="kpi-trend" :class="stats.tacticos.emergenciasTrend >= 0 ? 'trend-up' : 'trend-down'">
            {{ stats.tacticos.emergenciasTrend >= 0 ? '+' : '' }}{{ stats.tacticos.emergenciasTrend.toFixed(1) }}%
          </span>
        </div>
      </div>

      <!-- Main Panel (Tabs + Table) -->
      <div class="main-panel">
        
        <!-- Controls Bar -->
        <div class="controls-bar">
          <div class="tabs-container">
            <button 
              v-for="tab in tabs" 
              :key="tab"
              class="tab-btn"
              :class="{ 'active': filtroActivo === tab }"
              @click="filtroActivo = tab"
            >
              {{ tab }}
            </button>
          </div>
          <div class="sort-container">
            <span class="sort-label uppercase">MOSTRANDO:</span>
            <span class="sort-value uppercase">{{ emergenciasFiltradas.length }} REGISTROS</span>
          </div>
        </div>

        <!-- Table -->
        <div class="table-container">
          <table class="a-table">
            <thead>
              <tr>
                <th>Folio ID</th>
                <th>Tipo de Incidente</th>
                <th>Fecha / Hora</th>
                <th>T. Respuesta</th>
                <th>Ubicación</th>
                <th>Estatus</th>
                <th class="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="em in emergenciasFiltradas" :key="em._id">
                <td class="font-bold text-white">{{ em.folio }}</td>
                <td>
                  <div class="tipo-cell">
                    <span class="tipo-icon">{{ getIconForType(em.tipo) }}</span>
                    <span class="tipo-text">{{ em.subtipo || em.tipo }}</span>
                  </div>
                </td>
                <td>
                  <div class="fecha-cell">
                    <div class="fecha-main">{{ formatFechaHora(em.tiempoReporte).fecha }}</div>
                    <div class="fecha-sub">{{ formatFechaHora(em.tiempoReporte).hora }}</div>
                  </div>
                </td>
                <td>
                  <span class="tiempo-badge">{{ calcularTiempoRespuestaFormateado(em) }}</span>
                </td>
                <td class="ubicacion-cell">
                  {{ em.ubicacion?.calle ? em.ubicacion.calle + ', ' : '' }}{{ em.ubicacion?.colonia || 'Desconocida' }}
                </td>
                <td>
                  <span class="status-chip" :class="estadoClase(em.estado)">
                    <span class="dot"></span> {{ estadoLabel(em.estado) }}
                  </span>
                </td>
                <td class="text-right">
                  <div class="actions-cell">
                    <button class="action-btn" title="Copiar Folio" @click="copiarFolio(em.folio)">
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    </button>
                    <button class="action-btn action-doc" title="Ver Documento" @click="verDocumento(em)">
                      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      <span class="action-doc-label">Documento</span>
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="emergenciasFiltradas.length === 0">
                <td colspan="7" class="text-center py-12 text-muted">No se encontraron registros para esta categoría.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ MODAL: Documento de Novedades ═══ -->
    <teleport to="body">
      <transition name="modal-fade">
        <div v-if="documentoVisible" class="doc-overlay" @click.self="cerrarDocumento">
          <div class="doc-modal">
            <!-- Header del modal -->
            <div class="doc-modal-header">
              <div class="doc-modal-header-left">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="22" height="22"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <div>
                  <h3>Documento de Novedades</h3>
                  <span class="doc-folio" v-if="emergenciaDetalle">{{ emergenciaDetalle.folio }}</span>
                </div>
              </div>
              <div class="doc-modal-header-right">
                <button class="btn btn-export-pdf" @click="exportarDocumentoPDF(emergenciaDetalle)" :disabled="cargandoDetalle">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Exportar PDF
                </button>
                <button class="btn-cerrar-doc" @click="cerrarDocumento">✕</button>
              </div>
            </div>

            <!-- Cargando -->
            <div v-if="cargandoDetalle" class="doc-loading">
              <div class="spinner-tactical"></div>
              <p>Cargando documento...</p>
            </div>

            <!-- Contenido del documento -->
            <div v-else-if="emergenciaDetalle" class="doc-body">
              <!-- Banner institucional -->
              <div class="doc-banner">
                <div class="doc-banner-left">
                  <h2>{{ emergenciaDetalle.subtipo || emergenciaDetalle.tipo }}</h2>
                  <div class="doc-banner-meta">
                    <span class="doc-badge-prioridad" :class="`prioridad-${emergenciaDetalle.prioridad}`">
                      {{ (emergenciaDetalle.prioridad || '').toUpperCase() }}
                    </span>
                    <span class="doc-badge-estado" :class="estadoClase(emergenciaDetalle.estado)">
                      {{ estadoLabel(emergenciaDetalle.estado) }}
                    </span>
                  </div>
                </div>
                <div class="doc-banner-right">
                  <div class="doc-stat">
                    <span class="doc-stat-label">Duración Total</span>
                    <span class="doc-stat-value">{{ calcularDuracionTotal(emergenciaDetalle) }}</span>
                  </div>
                  <div class="doc-stat">
                    <span class="doc-stat-label">T. Respuesta</span>
                    <span class="doc-stat-value">{{ calcularTiempoRespuestaFormateado(emergenciaDetalle) }}</span>
                  </div>
                </div>
              </div>

              <!-- Secciones del documento -->
              <div class="doc-sections">
                <!-- 1. Información General -->
                <details class="doc-section" open>
                  <summary class="doc-section-title">
                    <span class="doc-section-num">01</span> Información General
                  </summary>
                  <div class="doc-section-content">
                    <div class="doc-grid">
                      <div class="doc-field">
                        <span class="doc-field-label">Dirección</span>
                        <span class="doc-field-value">{{ emergenciaDetalle.ubicacion?.direccionCompleta || [emergenciaDetalle.ubicacion?.calle, emergenciaDetalle.ubicacion?.colonia].filter(Boolean).join(', ') || 'Sin dirección' }}</span>
                      </div>
                      <div class="doc-field" v-if="emergenciaDetalle.ubicacion?.referencias">
                        <span class="doc-field-label">Referencias</span>
                        <span class="doc-field-value text-amber">{{ emergenciaDetalle.ubicacion.referencias }}</span>
                      </div>
                      <div class="doc-field" v-if="emergenciaDetalle.ubicacion?.lat">
                        <span class="doc-field-label">Coordenadas</span>
                        <span class="doc-field-value">{{ emergenciaDetalle.ubicacion.lat }}, {{ emergenciaDetalle.ubicacion.lng }}</span>
                      </div>
                      <div class="doc-field" v-if="emergenciaDetalle.notas">
                        <span class="doc-field-label">Notas Iniciales</span>
                        <span class="doc-field-value">{{ emergenciaDetalle.notas }}</span>
                      </div>
                      <div class="doc-field" v-if="emergenciaDetalle.nombreContacto">
                        <span class="doc-field-label">Contacto</span>
                        <span class="doc-field-value">{{ emergenciaDetalle.nombreContacto }} {{ emergenciaDetalle.telefonoContacto ? `(${emergenciaDetalle.telefonoContacto})` : '' }}</span>
                      </div>
                    </div>
                  </div>
                </details>

                <!-- 2. Cronología -->
                <details class="doc-section" open>
                  <summary class="doc-section-title">
                    <span class="doc-section-num">02</span> Cronología de Atención
                  </summary>
                  <div class="doc-section-content">
                    <div class="timeline">
                      <div class="timeline-item" v-if="emergenciaDetalle.tiempoReporte">
                        <div class="timeline-dot dot-rojo"></div>
                        <div class="timeline-content">
                          <span class="timeline-label">Reporte Recibido</span>
                          <span class="timeline-time">{{ formatFechaCompleta(emergenciaDetalle.tiempoReporte) }}</span>
                        </div>
                      </div>
                      <div class="timeline-item" v-if="emergenciaDetalle.tiempoAsignacion">
                        <div class="timeline-dot dot-azul"></div>
                        <div class="timeline-content">
                          <span class="timeline-label">Unidad Asignada</span>
                          <span class="timeline-time">{{ formatFechaCompleta(emergenciaDetalle.tiempoAsignacion) }}</span>
                        </div>
                      </div>
                      <div class="timeline-item" v-if="emergenciaDetalle.tiempoAceptacion">
                        <div class="timeline-dot dot-ambar"></div>
                        <div class="timeline-content">
                          <span class="timeline-label">Aceptado por Campo</span>
                          <span class="timeline-time">{{ formatFechaCompleta(emergenciaDetalle.tiempoAceptacion) }}</span>
                        </div>
                      </div>
                      <div class="timeline-item" v-if="emergenciaDetalle.tiempoEscena">
                        <div class="timeline-dot dot-indigo"></div>
                        <div class="timeline-content">
                          <span class="timeline-label">Llegada a Escena</span>
                          <span class="timeline-time">{{ formatFechaCompleta(emergenciaDetalle.tiempoEscena) }}</span>
                        </div>
                      </div>
                      <div class="timeline-item" v-if="emergenciaDetalle.tiempoCierre">
                        <div class="timeline-dot dot-verde"></div>
                        <div class="timeline-content">
                          <span class="timeline-label">Incidente Cerrado</span>
                          <span class="timeline-time">{{ formatFechaCompleta(emergenciaDetalle.tiempoCierre) }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </details>

                <!-- 3. Recursos Asignados -->
                <details class="doc-section" open>
                  <summary class="doc-section-title">
                    <span class="doc-section-num">03</span> Recursos Asignados
                  </summary>
                  <div class="doc-section-content">
                    <div class="doc-grid">
                      <div class="doc-field">
                        <span class="doc-field-label">Unidad</span>
                        <span class="doc-field-value font-bold">{{ emergenciaDetalle.unidadAsignada?.nombre || 'Sin asignar' }}</span>
                      </div>
                      <div class="doc-field">
                        <span class="doc-field-label">Tipo Unidad</span>
                        <span class="doc-field-value">{{ emergenciaDetalle.unidadAsignada?.tipo || 'N/A' }}</span>
                      </div>
                      <div class="doc-field">
                        <span class="doc-field-label">Responsable</span>
                        <span class="doc-field-value">{{ emergenciaDetalle.unidadAsignada?.responsable || 'N/A' }}</span>
                      </div>
                      <div class="doc-field">
                        <span class="doc-field-label">Operador COE</span>
                        <span class="doc-field-value">{{ emergenciaDetalle.operadorId?.nombre || 'N/A' }}</span>
                      </div>
                    </div>
                  </div>
                </details>

                <!-- 4. Reporte de Campo -->
                <template v-if="emergenciaDetalle.reporteCampo">
                  <details class="doc-section" open>
                    <summary class="doc-section-title">
                      <span class="doc-section-num">04</span> Reporte de Novedades en Escena
                    </summary>
                    <div class="doc-section-content">
                      <div class="doc-grid">
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.oficialCargo">
                          <span class="doc-field-label">Oficial a Cargo</span>
                          <span class="doc-field-value font-bold">{{ emergenciaDetalle.reporteCampo.oficialCargo }}</span>
                        </div>
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.descripcionLlegada">
                          <span class="doc-field-label">A su llegada se trataba de</span>
                          <span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.descripcionLlegada }}</span>
                        </div>
                      </div>

                      <!-- Entrevistado -->
                      <div v-if="emergenciaDetalle.reporteCampo.entrevistado?.nombre" class="doc-sub-box">
                        <h5 class="doc-sub-title">Entrevistado</h5>
                        <div class="doc-grid">
                          <div class="doc-field">
                            <span class="doc-field-label">Nombre</span>
                            <span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.entrevistado.nombre }}</span>
                          </div>
                          <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.entrevistado.tipo">
                            <span class="doc-field-label">Se ostenta como</span>
                            <span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.entrevistado.tipo }}</span>
                          </div>
                          <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.entrevistado.refiere">
                            <span class="doc-field-label">Refiere que</span>
                            <span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.entrevistado.refiere }}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </details>

                  <!-- 5. Plan de Acción / SCI -->
                  <details class="doc-section" v-if="emergenciaDetalle.reporteCampo.planAccion || emergenciaDetalle.reporteCampo.estrategias">
                    <summary class="doc-section-title">
                      <span class="doc-section-num">05</span> Plan de Acción / SCI
                    </summary>
                    <div class="doc-section-content">
                      <div class="doc-grid">
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.planAccion">
                          <span class="doc-field-label">Plan de Acción</span>
                          <span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.planAccion }}</span>
                        </div>
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.objetivos">
                          <span class="doc-field-label">Objetivos</span>
                          <span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.objetivos }}</span>
                        </div>
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.estrategias">
                          <span class="doc-field-label">Estrategias</span>
                          <span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.estrategias }}</span>
                        </div>
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.tacticas">
                          <span class="doc-field-label">Tácticas</span>
                          <span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.tacticas }}</span>
                        </div>
                      </div>
                      <div v-if="emergenciaDetalle.reporteCampo.mando" class="doc-sub-box">
                        <h5 class="doc-sub-title">Funciones de Mando</h5>
                        <div class="doc-grid doc-grid-2">
                          <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.mando.cmdteIncidente"><span class="doc-field-label">Cmdte. Incidente</span><span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.mando.cmdteIncidente }}</span></div>
                          <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.mando.seguridad"><span class="doc-field-label">Seguridad</span><span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.mando.seguridad }}</span></div>
                          <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.mando.operaciones"><span class="doc-field-label">Operaciones</span><span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.mando.operaciones }}</span></div>
                          <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.mando.planificacion"><span class="doc-field-label">Planificación</span><span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.mando.planificacion }}</span></div>
                        </div>
                      </div>
                    </div>
                  </details>

                  <!-- 6. Víctimas -->
                  <details class="doc-section" v-if="emergenciaDetalle.reporteCampo.victimasTotal || emergenciaDetalle.reporteCampo.lesionados || emergenciaDetalle.reporteCampo.fallecidos">
                    <summary class="doc-section-title">
                      <span class="doc-section-num">06</span> Víctimas y Traslados
                    </summary>
                    <div class="doc-section-content">
                      <div class="victimas-grid" v-if="emergenciaDetalle.reporteCampo.lesionadosDetalle">
                        <div class="victima-stat">
                          <span class="victima-num">{{ emergenciaDetalle.reporteCampo.lesionadosDetalle.ilesos || 0 }}</span>
                          <span class="victima-label">Ilesos</span>
                        </div>
                        <div class="victima-stat victima-verde">
                          <span class="victima-num">{{ emergenciaDetalle.reporteCampo.lesionadosDetalle.leves || 0 }}</span>
                          <span class="victima-label">Leves</span>
                        </div>
                        <div class="victima-stat victima-ambar">
                          <span class="victima-num">{{ emergenciaDetalle.reporteCampo.lesionadosDetalle.regulares || 0 }}</span>
                          <span class="victima-label">Regulares</span>
                        </div>
                        <div class="victima-stat victima-rojo">
                          <span class="victima-num">{{ emergenciaDetalle.reporteCampo.lesionadosDetalle.graves || 0 }}</span>
                          <span class="victima-label">Graves</span>
                        </div>
                        <div class="victima-stat victima-morado">
                          <span class="victima-num">{{ emergenciaDetalle.reporteCampo.lesionadosDetalle.prensados || 0 }}</span>
                          <span class="victima-label">Prensados</span>
                        </div>
                        <div class="victima-stat victima-negro">
                          <span class="victima-num">{{ emergenciaDetalle.reporteCampo.fallecidos || 0 }}</span>
                          <span class="victima-label">Fallecidos</span>
                        </div>
                      </div>
                      <div class="doc-grid" style="margin-top: 12px;">
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.observacionesVictimas">
                          <span class="doc-field-label">Observaciones</span>
                          <span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.observacionesVictimas }}</span>
                        </div>
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.trasladadosPor">
                          <span class="doc-field-label">Trasladados por</span>
                          <span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.trasladadosPor }}</span>
                        </div>
                      </div>
                    </div>
                  </details>

                  <!-- 7. Vehículos -->
                  <details class="doc-section" v-if="emergenciaDetalle.reporteCampo.vehiculosInvolucrados?.length">
                    <summary class="doc-section-title">
                      <span class="doc-section-num">07</span> Vehículos Involucrados
                    </summary>
                    <div class="doc-section-content">
                      <div class="vehiculo-card" v-for="(v, idx) in emergenciaDetalle.reporteCampo.vehiculosInvolucrados" :key="idx">
                        <div class="vehiculo-header">🚘 Vehículo {{ idx + 1 }}</div>
                        <div class="doc-grid doc-grid-2">
                          <div class="doc-field"><span class="doc-field-label">Tipo</span><span class="doc-field-value">{{ v.tipo }}</span></div>
                          <div class="doc-field"><span class="doc-field-label">Marca / Modelo</span><span class="doc-field-value">{{ v.marca }} {{ v.modelo }}</span></div>
                          <div class="doc-field"><span class="doc-field-label">Placas</span><span class="doc-field-value">{{ v.placas || 'S/P' }}</span></div>
                          <div class="doc-field"><span class="doc-field-label">Color</span><span class="doc-field-value">{{ v.color || 'N/A' }}</span></div>
                          <div class="doc-field"><span class="doc-field-label">Conductor</span><span class="doc-field-value">{{ v.conductor || 'No especificado' }}</span></div>
                          <div class="doc-field"><span class="doc-field-label">Chocó con</span><span class="doc-field-value">{{ v.impactoCon || 'N/A' }}</span></div>
                        </div>
                      </div>
                    </div>
                  </details>

                  <!-- 8. Detalles Específicos -->
                  <details class="doc-section" v-if="emergenciaDetalle.reporteCampo.detallesEspecificos && Object.keys(emergenciaDetalle.reporteCampo.detallesEspecificos).length">
                    <summary class="doc-section-title">
                      <span class="doc-section-num">08</span> Detalles Específicos del Incidente
                    </summary>
                    <div class="doc-section-content">
                      <div class="doc-grid">
                        <div class="doc-field" v-for="(val, key) in emergenciaDetalle.reporteCampo.detallesEspecificos" :key="key">
                          <span class="doc-field-label">{{ key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()) }}</span>
                          <span class="doc-field-value">{{ val }}</span>
                        </div>
                      </div>
                    </div>
                  </details>

                  <!-- 9. Dependencias Presentes -->
                  <details class="doc-section" v-if="emergenciaDetalle.reporteCampo.dependenciasPresentes?.length">
                    <summary class="doc-section-title">
                      <span class="doc-section-num">09</span> Dependencias Presentes
                    </summary>
                    <div class="doc-section-content">
                      <div class="dep-card" v-for="(dep, idx) in emergenciaDetalle.reporteCampo.dependenciasPresentes" :key="idx">
                        <span class="dep-nombre">{{ dep.nombre }}</span>
                        <span class="dep-meta" v-if="dep.unidad">Unidad: {{ dep.unidad }}</span>
                        <span class="dep-meta" v-if="dep.aCargo">A cargo: {{ dep.aCargo }}</span>
                      </div>
                    </div>
                  </details>

                  <!-- 10. Cierre -->
                  <details class="doc-section" v-if="emergenciaDetalle.reporteCampo.observacionesGenerales || emergenciaDetalle.reporteCampo.consumoTotal || emergenciaDetalle.reporteCampo.primerRespondiente">
                    <summary class="doc-section-title">
                      <span class="doc-section-num">10</span> Cierre y Observaciones
                    </summary>
                    <div class="doc-section-content">
                      <div class="doc-grid">
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.primerRespondiente"><span class="doc-field-label">Primer Respondiente</span><span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.primerRespondiente }}</span></div>
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.primerInterviniente"><span class="doc-field-label">Primer Interviniente</span><span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.primerInterviniente }}</span></div>
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.personalAsistente"><span class="doc-field-label">Personal Asistente</span><span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.personalAsistente }}</span></div>
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.consumoTotal"><span class="doc-field-label">Consumo Total</span><span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.consumoTotal }}</span></div>
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.aCargoAlRetiro"><span class="doc-field-label">A Cargo al Retiro</span><span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.aCargoAlRetiro }}</span></div>
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.bienesEntregadosA"><span class="doc-field-label">Bienes Entregados a</span><span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.bienesEntregadosA }}</span></div>
                        <div class="doc-field" v-if="emergenciaDetalle.reporteCampo.observacionesGenerales"><span class="doc-field-label">Observaciones Generales</span><span class="doc-field-value">{{ emergenciaDetalle.reporteCampo.observacionesGenerales }}</span></div>
                      </div>
                    </div>
                  </details>
                  <!-- 11. Evidencia Fotográfica -->
                  <details class="doc-section" v-if="emergenciaDetalle.reporteCampo.imagenEscenaUrl">
                    <summary class="doc-section-title">
                      <span class="doc-section-num">11</span> Evidencia Fotográfica
                    </summary>
                    <div class="doc-section-content text-center">
                      <div class="doc-img-container">
                        <img :src="emergenciaDetalle.reporteCampo.imagenEscenaUrl" alt="Fotografía de la Escena" class="doc-evidencia-img" />
                      </div>
                    </div>
                  </details>
                </template>

                <!-- Sin reporte de campo -->
                <div v-if="!emergenciaDetalle.reporteCampo" class="doc-empty-report">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="40" height="40"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  <p>Esta emergencia no tiene reporte de campo.<br>El reporte se genera cuando la unidad en campo llena y finaliza el formulario de novedades.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </transition>
    </teleport>
  </div>
</template>

<style scoped>
/* TEMA ROJO/OSCURO TÁCTICO (Auditoría) */
.auditoria-view {
  background-color: #0d0a0a;
  min-height: 100vh;
  color: #e5e7eb;
  font-family: 'Inter', system-ui, sans-serif;
}

/* Header */
.header-section {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.page-title {
  font-size: 2.2rem;
  font-weight: 900;
  color: #ffffff;
  letter-spacing: -0.5px;
  line-height: 1.1;
  margin-bottom: 8px;
}

.page-subtitle {
  font-size: 0.9rem;
  color: #d32f2f;
  max-width: 600px;
  line-height: 1.4;
}

.header-actions {
  display: flex;
  gap: 16px;
}

.btn-red {
  background-color: #d32f2f;
  color: #ffffff;
  border: none;
  box-shadow: 0 4px 14px rgba(211, 47, 47, 0.4);
}
.btn-red:hover { background-color: #b71c1c; }

.export-btn {
  padding: 10px 20px;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 1px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* KPI Top Left */
.kpi-totales {
  background-color: #1a1212;
  border: 1px solid #2d1f1f;
  border-radius: 8px;
  padding: 16px 24px;
  display: inline-block;
}

.kpi-label {
  font-size: 0.7rem;
  color: #9ca3af;
  font-weight: 700;
  letter-spacing: 1px;
  margin-bottom: 8px;
}

.kpi-value-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.kpi-numero {
  font-size: 1.8rem;
  font-weight: 900;
  color: #ffffff;
}

.kpi-trend {
  font-size: 0.75rem;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
}
.trend-up { background-color: rgba(156, 163, 175, 0.1); color: #d1d5db; }
.trend-down { background-color: rgba(156, 163, 175, 0.1); color: #d1d5db; }

/* Main Panel */
.main-panel {
  background-color: #1a1212;
  border: 1px solid #2d1f1f;
  border-radius: 8px;
  overflow: hidden;
}

.controls-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid #2d1f1f;
}

.tabs-container {
  display: flex;
  background-color: #0d0a0a;
  border-radius: 6px;
  padding: 4px;
  border: 1px solid #2d1f1f;
}

.tab-btn {
  background: transparent;
  color: #9ca3af;
  border: none;
  padding: 6px 16px;
  font-size: 0.75rem;
  font-weight: 800;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  letter-spacing: 0.5px;
}

.tab-btn:hover { color: #ffffff; }

.tab-btn.active {
  background-color: #d32f2f;
  color: #ffffff;
}

.sort-container {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 1px;
}

.sort-label { color: #9ca3af; margin-right: 8px; }
.sort-value { color: #ffffff; }

/* Table */
.table-container {
  overflow-x: auto;
}

.a-table {
  width: 100%;
  border-collapse: collapse;
}

.a-table th {
  text-align: left;
  font-size: 0.7rem;
  font-weight: 700;
  color: #9ca3af;
  letter-spacing: 1px;
  padding: 16px 24px;
  border-bottom: 1px solid #2d1f1f;
}

.a-table td {
  padding: 20px 24px;
  font-size: 0.85rem;
  border-bottom: 1px solid #2d1f1f;
  color: #d1d5db;
}

.a-table tr:hover {
  background-color: rgba(255,255,255,0.02);
}

.tipo-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.tipo-icon {
  background-color: #241a1a;
  padding: 6px;
  border-radius: 6px;
  font-size: 1rem;
}

.tipo-text { font-weight: 600; color: #ffffff; }

.fecha-main { font-weight: 600; color: #ffffff; }
.fecha-sub { font-size: 0.7rem; color: #9ca3af; margin-top: 4px; }

.tiempo-badge {
  background-color: rgba(211, 47, 47, 0.15);
  color: #ff8a80;
  padding: 4px 10px;
  border-radius: 4px;
  font-weight: 700;
  letter-spacing: 1px;
}

.ubicacion-cell {
  font-style: italic;
  color: #d1d5db;
}

/* Status chips */
.status-chip {
  background-color: #241a1a;
  color: #9ca3af;
  border: 1px solid #3d2a2a;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 1px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.status-chip .dot {
  width: 6px;
  height: 6px;
  background-color: #9ca3af;
  border-radius: 50%;
}
.status-cerrado { border-color: #10b981; color: #6ee7b7; }
.status-cerrado .dot { background-color: #10b981; }
.status-atencion { border-color: #f59e0b; color: #fcd34d; }
.status-atencion .dot { background-color: #f59e0b; }
.status-asignado { border-color: #3b82f6; color: #93c5fd; }
.status-asignado .dot { background-color: #3b82f6; }
.status-nuevo { border-color: #ef4444; color: #fca5a5; }
.status-nuevo .dot { background-color: #ef4444; }

.actions-cell {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.action-btn {
  background: transparent;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  padding: 4px;
  transition: color 0.2s;
}
.action-btn:hover { color: #ffffff; }

.action-doc {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(211, 47, 47, 0.1);
  border: 1px solid rgba(211, 47, 47, 0.3);
  padding: 4px 10px;
  border-radius: 6px;
  color: #ff8a80;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  transition: all 0.2s;
}
.action-doc:hover {
  background: rgba(211, 47, 47, 0.2);
  color: #ffffff;
}

/* Spinner */
.spinner-tactical {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(211, 47, 47, 0.2);
  border-top-color: #d32f2f;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ═══════════════════════════════════════════════════════════════
   MODAL: Documento de Novedades
   ═══════════════════════════════════════════════════════════════ */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.doc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(6px);
  z-index: 9000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 30px;
  overflow-y: auto;
}

.doc-modal {
  background: #141010;
  border: 1px solid #2d1f1f;
  border-radius: 12px;
  width: 100%;
  max-width: 900px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7);
  animation: doc-slide-up 0.35s ease;
}

@keyframes doc-slide-up {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.doc-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 28px;
  border-bottom: 1px solid #2d1f1f;
  background: #1a1212;
  border-radius: 12px 12px 0 0;
}

.doc-modal-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #ffffff;
}
.doc-modal-header-left h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}
.doc-folio {
  font-size: 0.75rem;
  color: #d32f2f;
  font-weight: 700;
  letter-spacing: 1px;
}

.doc-modal-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-export-pdf {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #d32f2f;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  letter-spacing: 0.5px;
}
.btn-export-pdf:hover { background: #b71c1c; }

.btn-cerrar-doc {
  background: none;
  border: 1px solid #3d2a2a;
  color: #9ca3af;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.btn-cerrar-doc:hover {
  background: #3d2a2a;
  color: #fff;
}

.doc-loading {
  padding: 60px;
  text-align: center;
  color: #9ca3af;
}
.doc-loading p {
  margin-top: 16px;
}

.doc-body {
  padding: 0;
  max-height: calc(100vh - 160px);
  overflow-y: auto;
}

/* Banner del documento */
.doc-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 28px;
  background: linear-gradient(135deg, #1a1010 0%, #2d1414 100%);
  border-bottom: 2px solid #d32f2f;
}

.doc-banner-left h2 {
  margin: 0 0 8px;
  font-size: 1.3rem;
  font-weight: 800;
  color: #ffffff;
}

.doc-banner-meta {
  display: flex;
  gap: 8px;
}

.doc-badge-prioridad {
  font-size: 0.65rem;
  font-weight: 800;
  padding: 3px 10px;
  border-radius: 4px;
  letter-spacing: 1px;
}
.prioridad-critica { background: rgba(168, 85, 247, 0.2); color: #c084fc; }
.prioridad-alta { background: rgba(220, 38, 38, 0.2); color: #fca5a5; }
.prioridad-media { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
.prioridad-baja { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; }

.doc-badge-estado {
  font-size: 0.65rem;
  font-weight: 800;
  padding: 3px 10px;
  border-radius: 4px;
  letter-spacing: 1px;
  border: 1px solid;
}

.doc-banner-right {
  display: flex;
  gap: 20px;
}

.doc-stat {
  text-align: center;
}
.doc-stat-label {
  display: block;
  font-size: 0.65rem;
  color: #9ca3af;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 4px;
}
.doc-stat-value {
  display: block;
  font-size: 1.3rem;
  font-weight: 900;
  color: #ffffff;
}

/* Secciones del documento */
.doc-sections {
  padding: 16px 0;
}

.doc-section {
  border-bottom: 1px solid #2d1f1f;
}
.doc-section[open] {
  padding-bottom: 4px;
}

.doc-section-title {
  padding: 14px 28px;
  font-size: 0.82rem;
  font-weight: 800;
  color: #ffffff;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  letter-spacing: 0.5px;
  transition: background 0.2s;
  list-style: none;
}
.doc-section-title::-webkit-details-marker { display: none; }
.doc-section-title:hover {
  background: rgba(255, 255, 255, 0.02);
}

.doc-section-num {
  background: #d32f2f;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 900;
  padding: 3px 8px;
  border-radius: 4px;
  letter-spacing: 1px;
}

.doc-section-content {
  padding: 4px 28px 20px 28px;
}

.doc-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.doc-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.doc-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.doc-field-label {
  font-size: 0.68rem;
  font-weight: 700;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.doc-field-value {
  font-size: 0.88rem;
  color: #e5e7eb;
  line-height: 1.4;
}
.doc-field-value.text-amber {
  color: #fcd34d;
}
.doc-field-value.font-bold {
  font-weight: 700;
  color: #ffffff;
}

.doc-sub-box {
  margin-top: 14px;
  padding: 14px;
  background: #1a1212;
  border: 1px solid #2d1f1f;
  border-radius: 8px;
}
.doc-sub-title {
  font-size: 0.72rem;
  font-weight: 800;
  color: #d32f2f;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0 0 10px;
}

/* Timeline */
.timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
  padding-left: 20px;
}
.timeline::before {
  content: '';
  position: absolute;
  left: 6px;
  top: 10px;
  bottom: 10px;
  width: 2px;
  background: #2d1f1f;
}
.timeline-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 8px 0;
  position: relative;
}
.timeline-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 3px;
  z-index: 1;
  border: 2px solid #141010;
}
.dot-rojo { background: #ef4444; }
.dot-azul { background: #3b82f6; }
.dot-ambar { background: #f59e0b; }
.dot-indigo { background: #6366f1; }
.dot-verde { background: #10b981; }

.timeline-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.timeline-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: #ffffff;
}
.timeline-time {
  font-size: 0.75rem;
  color: #9ca3af;
}

/* Víctimas */
.victimas-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}
.victima-stat {
  text-align: center;
  padding: 12px 8px;
  background: #1a1212;
  border: 1px solid #2d1f1f;
  border-radius: 8px;
}
.victima-num {
  display: block;
  font-size: 1.4rem;
  font-weight: 900;
  color: #ffffff;
}
.victima-label {
  display: block;
  font-size: 0.65rem;
  color: #9ca3af;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 4px;
}
.victima-verde { border-color: #10b981; }
.victima-verde .victima-num { color: #6ee7b7; }
.victima-ambar { border-color: #f59e0b; }
.victima-ambar .victima-num { color: #fcd34d; }
.victima-rojo { border-color: #ef4444; }
.victima-rojo .victima-num { color: #fca5a5; }
.victima-morado { border-color: #a855f7; }
.victima-morado .victima-num { color: #c084fc; }
.victima-negro { border-color: #6b7280; }
.victima-negro .victima-num { color: #d1d5db; }

/* Vehículos */
.vehiculo-card {
  background: #1a1212;
  border: 1px solid #2d1f1f;
  border-left: 3px solid #d32f2f;
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 10px;
}
.vehiculo-header {
  font-size: 0.82rem;
  font-weight: 800;
  color: #ffffff;
  margin-bottom: 10px;
}

/* Dependencias */
.dep-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #1a1212;
  border: 1px solid #2d1f1f;
  border-radius: 6px;
  margin-bottom: 8px;
}
.dep-nombre {
  font-weight: 700;
  color: #ffffff;
  font-size: 0.85rem;
}
.dep-meta {
  font-size: 0.75rem;
  color: #9ca3af;
}

/* Sin reporte */
.doc-empty-report {
  text-align: center;
  padding: 60px 28px;
  color: #6b7280;
}
.doc-empty-report svg {
  margin: 0 auto 16px;
  color: #3d2a2a;
}
.doc-empty-report p {
  font-size: 0.88rem;
  line-height: 1.5;
}

/* Evidencia fotográfica */
.doc-img-container {
  display: flex;
  justify-content: center;
  padding: 10px 0;
}
.doc-evidencia-img {
  max-width: 100%;
  max-height: 400px;
  border-radius: 8px;
  border: 1px solid #2d1f1f;
  box-shadow: 0 10px 25px rgba(0,0,0,0.5);
  object-fit: contain;
}
</style>
