import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { TooltipProvider } from '@/components/ui/tooltip'

document.documentElement.classList.add('dark')

ReactDOM.createRoot(document.getElementById('root')).render(
  <TooltipProvider>
    <App />
  </TooltipProvider>
)
