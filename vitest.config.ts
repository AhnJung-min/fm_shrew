import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // 시험의 임시 폴더를 실행마다 한 폴더로 모으고 끝나면 지운다(tests/setup/tempRoot.ts)
    globalSetup: ['tests/setup/tempRoot.ts']
  }
})
