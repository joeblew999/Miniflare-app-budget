import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import './styles/themes.css'
import App from './App.tsx'
import { applyTheme, watchSystemMode } from '@/lib/theme'

applyTheme()
watchSystemMode()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
