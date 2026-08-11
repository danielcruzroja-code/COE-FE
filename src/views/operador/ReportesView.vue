<script setup>
import { ref, onMounted, computed } from 'vue'
import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import api from '@/services/api.js'

const emergencias = ref([])
const stats = ref(null)
const cargando = ref(false)
const filtroActivo = ref('TODOS')

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
const tabs = ['TODOS', 'MÉDICAS / PC', 'PROTECCIÓN CIVIL', 'OTROS']

const emergenciasFiltradas = computed(() => {
  if (filtroActivo.value === 'TODOS') return emergencias.value
  return emergencias.value.filter(em => {
    const tipo = em.tipo ? em.tipo.toUpperCase() : ''
    if (filtroActivo.value === 'MÉDICAS / PC') return tipo.includes('MÉDICA') || tipo.includes('PC')
    if (filtroActivo.value === 'PROTECCIÓN CIVIL') return tipo.includes('PROTECCIÓN') || tipo.includes('PROTECCION')
    return !tipo.includes('MÉDICA') && !tipo.includes('PC') && !tipo.includes('PROTECCIÓN')
  })
})

// === Helpers visuales ===
const getIconForType = (tipo) => {
  const t = (tipo || '').toLowerCase()
  if (t.includes('médica') || t.includes('salud')) return '🚑'
  if (t.includes('fuego') || t.includes('incendio')) return '🔥'
  if (t.includes('accidente') || t.includes('choque')) return '🚓'
  if (t.includes('rescate')) return '🧗'
  return '🚨'
}

const formatFechaHora = (isoDate) => {
  if (!isoDate) return { fecha: '--', hora: '--' }
  const d = new Date(isoDate)
  const fecha = d.toLocaleDateString('es-MX', { month: 'short', day: '2-digit', year: 'numeric' })
  const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return { fecha, hora: `${hora} CST` }
}

const calcularTiempoRespuestaFormateado = (em) => {
  if (!em.tiempoReporte || !em.tiempoAsignacion) return '--:--'
  const diffMs = new Date(em.tiempoAsignacion) - new Date(em.tiempoReporte)
  const totalSecs = Math.floor(diffMs / 1000)
  const min = Math.floor(totalSecs / 60)
  const sec = totalSecs % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

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

  doc.autoTable({
    startY: 40,
    head: head,
    body: body,
    theme: 'grid',
    headStyles: { fillColor: [211, 47, 47] },
    styles: { fontSize: 8, cellPadding: 3 }
  })

  doc.save(`Auditoria_COE_${new Date().getTime()}.pdf`)
}

// Iconos SVG para botones
const IconoFiltro = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>`
const IconoDescarga = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>`
const IconoOjo = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>`
const IconoCopiar = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>`
</script>

<template>
  <div class="auditoria-view p-6 fade-in">
    <!-- Header -->
    <div class="header-section mb-8">
      <div class="header-text">
        <h1 class="page-title">Historial de Emergencias y Auditoría</h1>
        <p class="page-subtitle">Acceso centralizado a registros de incidentes clausurados, métricas de respuesta y documentación de auditoría técnica.</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-dark filter-btn flex items-center gap-2">
          <span v-html="IconoFiltro"></span> FILTRAR RESULTADOS
        </button>
        <button class="btn btn-red export-btn flex items-center gap-2" @click="generarPDF" :disabled="cargando">
          <span v-html="IconoDescarga"></span> EXPORTAR REPORTE GLOBAL
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
            <span class="sort-label uppercase">ORDENAR POR:</span>
            <span class="sort-value uppercase">FECHA RECIENTE <span class="caret">▼</span></span>
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
                    <span class="tipo-text">{{ em.tipo }}</span>
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
                  <span class="status-chip">
                    <span class="dot"></span> {{ em.estado === 'cerrado' ? 'AUDITADO' : em.estado.toUpperCase() }}
                  </span>
                </td>
                <td class="text-right">
                  <div class="actions-cell">
                    <button class="action-btn" title="Copiar Folio" v-html="IconoCopiar"></button>
                    <button class="action-btn" title="Ver Detalles" v-html="IconoOjo"></button>
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

.btn-dark {
  background-color: #241a1a;
  color: #e5e7eb;
  border: 1px solid #3d2a2a;
}
.btn-dark:hover { background-color: #3d2a2a; }

.btn-red {
  background-color: #d32f2f;
  color: #ffffff;
  border: none;
  box-shadow: 0 4px 14px rgba(211, 47, 47, 0.4);
}
.btn-red:hover { background-color: #b71c1c; }

.filter-btn, .export-btn {
  padding: 10px 20px;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 1px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
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
.sort-value { color: #ffffff; cursor: pointer; }
.caret { font-size: 0.6rem; margin-left: 4px; color: #9ca3af; }

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
</style>
