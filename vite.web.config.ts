// 브라우저에서 화면만 빠르게 확인하기 위한 설정. Electron 없이 뜨며, 이때는 샘플 데이터(mock)를 쓴다.
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 글꼴(Pretendard) 패키지가 실제로 있는 폴더.
 * worktree(.claude/worktrees 아래)에서 켜면 node_modules는 메인 체크아웃에 있어 vite의 기본 허용 범위 밖이 되고, 글꼴 파일이 403으로 막혀 대체 글꼴로 그려진다.
 */
const fontDir = dirname(createRequire(resolve(__dirname, 'package.json')).resolve('pretendard/package.json'))

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react()],
  server: {
    port: 5273,
    strictPort: true,
    // fs.allow를 적으면 기본 허용 범위가 꺼지므로 저장소 폴더도 함께 적는다
    fs: { allow: [searchForWorkspaceRoot(__dirname), fontDir] }
  }
})
