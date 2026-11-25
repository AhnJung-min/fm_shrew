// 브라우저에서 화면만 빠르게 확인하기 위한 설정. Electron 없이 뜨며, 이때는 샘플 데이터(mock)를 쓴다.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react()],
  server: { port: 5273, strictPort: true }
})
