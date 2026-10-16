import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import './styles/index.css'
import './styles/themes.css'
import App from './App.tsx'
import { applyTheme, watchSystemMode } from '@/lib/theme'

applyTheme()
watchSystemMode()

// TanStack Query assumes it's online until the browser says otherwise; start from the real state,
// so a page opened offline knows it straight away (used by src/hooks/use-budget.ts).
onlineManager.setOnline(navigator.onLine)

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
