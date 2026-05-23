'use client'

import { useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'

export default function Header() {
  const pathname = usePathname()
  
  // Create a nice title from the pathname
  const getPageTitle = () => {
    const path = pathname.split('/')[1]
    if (!path) return 'Dashboard'
    return path.charAt(0).toUpperCase() + path.slice(1)
  }

  const currentDate = useSyncExternalStore(
    () => () => undefined,
    getFormattedToday,
    () => ''
  )

  return (
    <header className="header">
      <div className="header-content">
        <div className="page-info">
          <h1>{getPageTitle()}</h1>
          <span className="date">{currentDate || 'Today'}</span>
        </div>
        
        <div className="header-actions">
          <div className="search-bar">
            <span className="search-icon">🔍</span>
            <input type="text" placeholder="Search..." className="search-input" aria-label="Search" />
          </div>
          <button className="notification-btn" aria-label="Notifications">
            🔔
            <span className="notification-badge" aria-hidden="true"></span>
          </button>
        </div>
      </div>

      
    </header>
  )
}

function getFormattedToday() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}
