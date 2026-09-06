import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves this project from https://islam-backend.github.io/islam-life/,
// so every asset URL needs the "/islam-life/" prefix. Firebase Hosting (and
// `vite dev`) serve from the root — build those with DEPLOY_TARGET unset.
// https://vite.dev/config/
export default defineConfig({
  base: process.env.DEPLOY_TARGET === 'pages' ? '/islam-life/' : '/',
  plugins: [react(), tailwindcss()],
})
