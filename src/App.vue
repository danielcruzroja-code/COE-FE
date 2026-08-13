<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useEmergenciasStore } from '@/stores/emergencias.js'
import { useUnidadesStore } from '@/stores/unidades.js'
import { useAuthStore } from '@/stores/auth.js'
import { emergenciasService } from '@/services/emergencias.service.js'
import { unidadesService } from '@/services/unidades.service.js'

// Polling silencioso cada 30 segundos (Respaldo a Socket.io)
let pollingInterval = null

onMounted(() => {
  const emergenciasStore = useEmergenciasStore()
  const unidadesStore = useUnidadesStore()

  pollingInterval = setInterval(async () => {
    const authStore = useAuthStore()
    if (!authStore.estaAutenticado) return // No hacer peticiones si no hay sesión activa

    try {
      const [nuevasEmergencias, nuevasUnidades] = await Promise.all([
        emergenciasService.activas(),
        unidadesService.listar()
      ])
      emergenciasStore.emergencias = nuevasEmergencias
      unidadesStore.unidades = nuevasUnidades
    } catch (e) {
      console.error('Error en auto-refresco de 30s:', e)
    }
  }, 30000)
})

onUnmounted(() => {
  if (pollingInterval) clearInterval(pollingInterval)
})
</script>

<template>
  <router-view />
</template>
