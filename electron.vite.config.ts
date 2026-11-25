import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    // chokidar와 papaparse는 번들에 넣어 런타임 모듈 해석 문제를 피한다
    build: { externalizeDeps: { exclude: ['chokidar', 'papaparse'] } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    resolve: {
      alias: { '@shared': shared, '@': resolve(__dirname, 'src/renderer/src') }
    },
    plugins: [react()]
  }
})
