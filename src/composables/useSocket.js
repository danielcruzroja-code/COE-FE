import { io } from 'socket.io-client'
import { useEmergenciasStore } from '@/stores/emergencias.js'
import { useUnidadesStore } from '@/stores/unidades.js'

let socket = null

export const useSocket = () => {
  const initSocket = () => {
    if (socket) return // Ya está inicializado

    // El proxy de Vite en vite.config.js maneja la ruta /socket.io automáticamente en dev.
    // En producción se usa la variable de entorno VITE_SOCKET_URL.
    const url = import.meta.env.VITE_SOCKET_URL || ''
    socket = io(url)

    socket.on('connect', () => {
      console.log('🔌 Conectado al servidor Socket.io')
      // Nos unimos a la sala de operadores para recibir actualizaciones
      socket.emit('sala:operador')
    })

    const emergenciasStore = useEmergenciasStore()
    const unidadesStore = useUnidadesStore()

    socket.on('emergencia:nueva', (emergencia) => {
      console.log('🔔 Nueva emergencia recibida en tiempo real', emergencia.folio)
      emergenciasStore.agregarNueva(emergencia)
    })

    socket.on('emergencia:actualizada', (emergencia) => {
      console.log('🔔 Emergencia actualizada en tiempo real', emergencia.folio)
      emergenciasStore.aplicarActualizacion(emergencia)
    })

    socket.on('unidad:estado', (data) => {
      console.log('🔔 Estado de unidad actualizado', data)
      unidadesStore.actualizarEstado(data.unidadId, data.estado)
    })

    socket.on('ubicacion:update', (data) => {
      console.log('🔔 Ubicación de unidad recibida en tiempo real', data)
      unidadesStore.actualizarUbicacion(data.unidadId, data.lat, data.lng)
    })

    socket.on('disconnect', () => {
      console.warn('🔌 Desconectado del servidor de Socket.io')
    })
  }

  const disconnectSocket = () => {
    if (socket) {
      socket.disconnect()
      socket = null
    }
  }

  return {
    get socket() { return socket }, // Getter reactivo (más seguro)
    getSocket: () => socket,
    initSocket,
    disconnectSocket
  }
}
