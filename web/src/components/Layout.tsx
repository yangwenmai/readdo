import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api } from '../api/client'
import type { StatusCounts } from '../api/client'
import styles from './Layout.module.css'

export default function Layout() {
  const [counts, setCounts] = useState<StatusCounts | null>(null)
  const location = useLocation()

  useEffect(() => {
    api.getStats().then(setCounts).catch(() => {})
  }, [location.pathname])

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>◆</span>
          <span className={styles.logoText}>Read→Do</span>
        </div>
        <nav className={styles.nav}>
          <NavLink
            to="/inbox"
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <span className={styles.navIcon}>📥</span>
            <span className={styles.navLabel}>Inbox</span>
            {counts !== null && counts.inbox > 0 && (
              <span className={styles.badge}>{counts.inbox}</span>
            )}
          </NavLink>
          <NavLink
            to="/archive"
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            <span className={styles.navIcon}>📦</span>
            <span className={styles.navLabel}>Archive</span>
            {counts !== null && counts.archive > 0 && (
              <span className={`${styles.badge} ${styles.badgeMuted}`}>{counts.archive}</span>
            )}
          </NavLink>
        </nav>
      </aside>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
