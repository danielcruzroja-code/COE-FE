<script setup>
import { ref, onMounted, computed } from 'vue'
import api from '@/services/api.js'
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  BarElement,
  CategoryScale,
  LinearScale,
  ArcElement
} from 'chart.js'
import { Bar, Doughnut } from 'vue-chartjs'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ArcElement)

const cargando = ref(true)
const stats = ref({
  tacticos: {
    tiempoDespacho: 0,
    tiempoDespachoTrend: 0,
    tiempoRespuesta: 0,
    tiempoRespuestaTrend: 0,
    emergenciasHoy: 0,
    emergenciasTrend: 0,
    flota: { total: 0, disponibles: 0, porcentaje: 0 },
    tasaCierre: 0
  },
  porTipo: [],
  incidentesPorDia: [],
  cargaTrabajoUnidades: []
})

const currentDate = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
const currentTime = ref(new Date().toLocaleTimeString('es-MX'))

// Actualizar reloj
setInterval(() => {
  currentTime.value = new Date().toLocaleTimeString('es-MX')
}, 1000)

const cargarEstadisticas = async () => {
  cargando.value = true
  try {
    const res = await api.get('/emergencias/stats')
    stats.value = res.data
  } catch (error) {
    console.error('Error cargando estadísticas', error)
  } finally {
    cargando.value = false
  }
}

onMounted(() => {
  cargarEstadisticas()
})

// === Cómputos para Gráficos ===
const chartDataTipo = computed(() => {
  const labels = stats.value.porTipo.map(item => item._id || 'Desconocido')
  const data = stats.value.porTipo.map(item => item.count)
  
  return {
    labels,
    datasets: [
      {
        backgroundColor: ['#d32f2f', '#f44336', '#ff7961', '#9a0007', '#ef5350', '#ffffff'],
        data,
        borderWidth: 0,
        cutout: '75%',
      }
    ]
  }
})

const chartDataDia = computed(() => {
  const labels = stats.value.incidentesPorDia.map(item => item.dia)
  const data = stats.value.incidentesPorDia.map(item => item.count)

  return {
    labels,
    datasets: [
      {
        label: 'Incidentes',
        backgroundColor: '#d32f2f',
        borderRadius: 2,
        data,
        barThickness: 12
      }
    ]
  }
})

// Plugin personalizado para texto en el centro de la dona
const centerTextPlugin = {
  id: 'centerText',
  beforeDraw(chart) {
    if (chart.config.type !== 'doughnut') return
    const { width, height, ctx } = chart
    ctx.restore()
    const fontSize = (height / 114).toFixed(2)
    ctx.font = `bold ${fontSize}em Inter, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'

    const text = stats.value.tacticos.emergenciasHoy.toString()
    const textX = Math.round((width - ctx.measureText(text).width) / 2)
    const textY = height / 2 - 10
    ctx.fillText(text, textX, textY)
    
    ctx.font = `600 ${(fontSize / 3).toFixed(2)}em Inter, sans-serif`
    ctx.fillStyle = '#9ca3af'
    const label = 'TOTAL HOY'
    const labelX = Math.round((width - ctx.measureText(label).width) / 2)
    ctx.fillText(label, labelX, textY + 25)
    
    ctx.save()
  }
}

ChartJS.register(centerTextPlugin)

// Opciones globales para Chart.js con diseño oscuro/rojo
const chartOptionsDoughnut = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right',
      labels: { color: '#d1d5db', font: { family: 'Inter', size: 11, weight: '600' }, boxWidth: 12, padding: 20 }
    }
  }
}

const chartOptionsBar = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false }
  },
  scales: {
    y: {
      display: false,
      beginAtZero: true
    },
    x: {
      ticks: { color: '#9ca3af', font: { size: 10, family: 'Inter', weight: '600' } },
      grid: { display: false }
    }
  }
}

// Helpers
const formatearTendencia = (val) => {
  if (val > 0) return `↑ ${val.toFixed(1)}%`
  if (val < 0) return `↓ ${Math.abs(val).toFixed(1)}%`
  return `0%`
}

const tendenciaClase = (val, invertido = false) => {
  // Para tiempos de despacho, bajar es bueno (verde). Para emergencias, depende, lo dejamos neutral o rojo si sube mucho.
  if (val === 0) return 'text-neutral'
  if (invertido) {
    return val < 0 ? 'text-green' : 'text-red'
  }
  return val > 0 ? 'text-red' : 'text-green'
}

const getEstadoUnidadClase = (estado) => {
  if (estado === 'disponible') return 'chip-green'
  if (estado === 'en_camino' || estado === 'en_escena') return 'chip-red'
  return 'chip-gray'
}

const exportarReporte = () => {
  const doc = new jsPDF('landscape')
  doc.setFontSize(16)
  doc.text('Carga de Trabajo por Unidad - COE Zapopan', 14, 22)
  doc.setFontSize(10)
  doc.text(`Fecha: ${currentDate} ${currentTime.value}`, 14, 30)

  const head = [['ID UNIDAD', 'TIPO', 'SERVICIOS (HOY)', 'TIEMPO ACTIVO', 'ESTADO']]
  const body = stats.value.cargaTrabajoUnidades.map(u => [
    u.idUnidad, u.tipo, u.serviciosHoy, u.tiempoActivo, u.estado.toUpperCase()
  ])

  autoTable(doc, {
    startY: 40,
    head: head,
    body: body,
    theme: 'grid',
    headStyles: { fillColor: [211, 47, 47] } // Rojo
  })

  doc.save(`Carga_Unidades_${new Date().getTime()}.pdf`)
}
</script>

<template>
  <div class="tactical-dashboard p-6 fade-in">
    <!-- Encabezado Estilo Táctico -->
  

    <div v-if="cargando" class="flex-center" style="height: 400px;">
      <div class="spinner-tactical"></div>
    </div>

    <div v-else>
      <!-- Fila 1: KPIs Principales -->
      <div class="kpi-grid mb-6">
        
        <!-- KPI 1: Tiempo Promedio Despacho -->
        <div class="t-card kpi-card">
          <div class="t-card-header flex justify-between">
            <span>TIEMPO PROM. DESPACHO</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16" class="text-muted"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div class="t-card-body">
            <div class="t-value">{{ stats.tacticos.tiempoDespacho.toFixed(2) }} <span class="t-unit">min</span></div>
            <div class="t-trend" :class="tendenciaClase(stats.tacticos.tiempoDespachoTrend, true)">
              {{ formatearTendencia(stats.tacticos.tiempoDespachoTrend) }} VS AYER
            </div>
          </div>
        </div>

        <!-- KPI 1b: Tiempo Real de Respuesta (TPR) -->
        <div class="t-card kpi-card">
          <div class="t-card-header flex justify-between">
            <span>TIEMPO RESPUESTA REAL (TPR)</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16" class="text-muted"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          </div>
          <div class="t-card-body">
            <div class="t-value">{{ stats.tacticos.tiempoRespuesta ? stats.tacticos.tiempoRespuesta.toFixed(2) : '0.00' }} <span class="t-unit">min</span></div>
            <div class="t-trend" :class="tendenciaClase(stats.tacticos.tiempoRespuestaTrend, true)">
              {{ formatearTendencia(stats.tacticos.tiempoRespuestaTrend) }} VS AYER
            </div>
          </div>
        </div>

        <!-- KPI 2: Emergencias -->
        <div class="t-card kpi-card">
          <div class="t-card-header flex justify-between">
            <span>EMERGENCIAS HOY</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16" class="text-muted"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <div class="t-card-body">
            <div class="t-value">{{ stats.tacticos.emergenciasHoy }}</div>
            <div class="t-trend" :class="tendenciaClase(stats.tacticos.emergenciasTrend)">
              {{ formatearTendencia(stats.tacticos.emergenciasTrend) }} VS AYER
            </div>
          </div>
        </div>

        <!-- KPI 3: Flota -->
        <div class="t-card kpi-card">
          <div class="t-card-header flex justify-between">
            <span>UNIDADES DISPONIBLES</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16" class="text-muted"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
          <div class="t-card-body">
            <div class="t-value">{{ stats.tacticos.flota.disponibles }} <span class="t-unit">/ {{ stats.tacticos.flota.total }}</span></div>
            <div class="t-progress-container mt-2">
              <div class="t-progress-bar bg-red" :style="{ width: stats.tacticos.flota.porcentaje + '%' }"></div>
            </div>
          </div>
        </div>

        <!-- KPI 4: Tasa Cierre -->
        <div class="t-card kpi-card">
          <div class="t-card-header flex justify-between">
            <span>TASA DE CIERRE</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16" class="text-muted"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div class="t-card-body">
            <div class="t-value">{{ stats.tacticos.tasaCierre.toFixed(1) }} <span class="t-unit">%</span></div>
            <div class="t-trend text-green">OBJETIVO: 95%</div>
          </div>
        </div>

      </div>

      <!-- Fila 2: Gráficos -->
      <div class="charts-grid mb-6">
        <div class="t-card p-5">
          <h3 class="t-section-title mb-4"><span>|</span> EMERGENCIAS POR TIPO</h3>
          <div class="chart-container-dona flex items-center justify-center">
            <Doughnut :data="chartDataTipo" :options="chartOptionsDoughnut" />
          </div>
        </div>

        <div class="t-card p-5">
          <div class="flex justify-between items-center mb-4">
            <h3 class="t-section-title"><span>|</span> INCIDENTES POR DÍA</h3>
            <span class="text-muted text-xs uppercase tracking-widest">Semana Actual</span>
          </div>
          <div class="chart-container-bar">
            <Bar :data="chartDataDia" :options="chartOptionsBar" />
          </div>
        </div>
      </div>

      <!-- Fila 3: Tabla Carga Trabajo -->
      <div class="t-card">
        <div class="p-5 border-b-dark flex justify-between items-center">
          <div class="flex items-center gap-4">
            <h3 class="t-section-title"><span>|</span> CARGA DE TRABAJO POR UNIDAD</h3>
            <div class="filter-pill">HOY: {{ currentDate }}</div>
          </div>
          <button class="btn t-btn-red flex items-center gap-2" @click="exportarReporte">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" width="16" height="16">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            EXPORTAR REPORTE
          </button>
        </div>
        
        <div class="table-responsive">
          <table class="t-table">
            <thead>
              <tr>
                <th>ID UNIDAD</th>
                <th>TIPO</th>
                <th>SERVICIOS (HOY)</th>
                <th>TIEMPO ACTIVO</th>
                <th class="text-right">ESTADO</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="unidad in stats.cargaTrabajoUnidades" :key="unidad.idUnidad">
                <td class="font-bold text-white">{{ unidad.idUnidad }}</td>
                <td class="text-muted">{{ unidad.tipo }}</td>
                <td>{{ String(unidad.serviciosHoy).padStart(2, '0') }}</td>
                <td>{{ unidad.tiempoActivo }}</td>
                <td class="text-right">
                  <span class="t-chip" :class="getEstadoUnidadClase(unidad.estado)">
                    <span class="dot"></span> {{ unidad.estado.toUpperCase().replace('_', ' ') }}
                  </span>
                </td>
              </tr>
              <tr v-if="stats.cargaTrabajoUnidades.length === 0">
                <td colspan="5" class="text-center py-8 text-muted">No hay datos de unidades registrados para hoy.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="t-footer-link p-4 text-center border-t-dark cursor-pointer hover:bg-dark-light transition">
          VER TODA LA FLOTA ({{ stats.tacticos.flota.total }} UNIDADES)
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 
  TEMA TÁCTICO ROJO/OSCURO
*/
.tactical-dashboard {
  background-color: #0d0a0a;
  min-height: 100vh;
  color: #e5e7eb;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* Header */
.logo-text {
  font-size: 1.5rem;
  font-weight: 900;
  color: #ffffff;
  letter-spacing: 2px;
}

.divider { color: #d32f2f; margin: 0 4px; }

.shift-badge {
  background-color: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 1px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot-green {
  width: 8px;
  height: 8px;
  background-color: #10b981;
  border-radius: 50%;
  display: inline-block;
  box-shadow: 0 0 8px #10b981;
}

.time-main { font-size: 1.5rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.date-sub { font-size: 0.7rem; color: #9ca3af; text-transform: uppercase; letter-spacing: 2px; }

/* Cards (Tácticas, esquinas agudas, bordes sutiles) */
.t-card {
  background-color: #171111;
  border: 1px solid #2d1f1f;
  border-radius: 4px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}

.kpi-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.t-card-header {
  font-size: 0.75rem;
  font-weight: 700;
  color: #d1d5db;
  letter-spacing: 1px;
}

.text-muted { color: #9ca3af; }

.t-value {
  font-size: 2.5rem;
  font-weight: 800;
  color: #ffffff;
  margin: 12px 0 4px 0;
  line-height: 1;
}

.t-unit {
  font-size: 1rem;
  font-weight: 600;
  color: #9ca3af;
}

.t-trend {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 1px;
}

.text-green { color: #10b981; }
.text-red { color: #ef4444; }
.text-neutral { color: #9ca3af; }

.t-progress-container {
  width: 100%;
  height: 4px;
  background-color: #2d1f1f;
  border-radius: 2px;
}

.t-progress-bar {
  height: 100%;
  border-radius: 2px;
}
.bg-red { background-color: #d32f2f; }

/* Gráficos */
.charts-grid {
  display: grid;
  grid-template-columns: 4fr 6fr; /* Dona un poco mas pequeña que barras */
  gap: 16px;
}
@media (max-width: 1024px) {
  .charts-grid { grid-template-columns: 1fr; }
}

.t-section-title {
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: #ffffff;
}
.t-section-title span {
  color: #d32f2f;
  font-weight: 900;
  margin-right: 6px;
}

.chart-container-dona { position: relative; height: 260px; width: 100%; }
.chart-container-bar { position: relative; height: 260px; width: 100%; }

/* Tabla */
.border-b-dark { border-bottom: 1px solid #2d1f1f; }
.border-t-dark { border-top: 1px solid #2d1f1f; }

.filter-pill {
  background-color: #241a1a;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: #9ca3af;
  letter-spacing: 1px;
}

.t-btn-red {
  background-color: #d32f2f;
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 8px 16px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: background-color 0.2s;
}
.t-btn-red:hover { background-color: #b71c1c; }

.t-table {
  width: 100%;
  border-collapse: collapse;
}

.t-table th {
  text-align: left;
  font-size: 0.7rem;
  font-weight: 700;
  color: #9ca3af;
  letter-spacing: 1px;
  padding: 16px 20px;
  border-bottom: 1px solid #2d1f1f;
}

.t-table td {
  padding: 16px 20px;
  font-size: 0.85rem;
  border-bottom: 1px solid #2d1f1f;
}

.t-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.t-chip .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.chip-green { background-color: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2); }
.chip-green .dot { background-color: #10b981; }

.chip-red { background-color: rgba(211, 47, 47, 0.1); color: #ef4444; border: 1px solid rgba(211, 47, 47, 0.2); }
.chip-red .dot { background-color: #ef4444; }

.chip-gray { background-color: rgba(156, 163, 175, 0.1); color: #9ca3af; border: 1px solid rgba(156, 163, 175, 0.2); }
.chip-gray .dot { background-color: #9ca3af; }

.t-footer-link {
  font-size: 0.75rem;
  font-weight: 700;
  color: #d1d5db;
  letter-spacing: 1px;
}
.hover\:bg-dark-light:hover { background-color: #241a1a; }

/* Spinner Táctico */
.spinner-tactical {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(211, 47, 47, 0.2);
  border-top-color: #d32f2f;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
</style>
