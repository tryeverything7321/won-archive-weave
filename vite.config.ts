import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/@firebase/firestore/')) return 'firebase-firestore'
          if (id.includes('/node_modules/@firebase/auth/')) return 'firebase-auth'
          if (id.includes('/node_modules/@firebase/functions/')) return 'firebase-functions'
          if (id.includes('/node_modules/@firebase/storage/')) return 'firebase-storage'
          if (id.includes('/node_modules/firebase/') || id.includes('/node_modules/@firebase/')) return 'firebase-core'
          if (id.includes('/node_modules/motion')) return 'motion-runtime'
          if (id.includes('/node_modules/gsap')) return 'scroll-runtime'
          if (id.includes('/node_modules/lucide-react')) return 'icon-runtime'
          if (/\/node_modules\/(?:react|react-dom|react-router|react-router-dom)\//.test(id)) return 'react-runtime'
          return undefined
        },
      },
    },
  },
})
