import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron 加载本地文件用相对路径,base 设成 ./
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173 },
})
