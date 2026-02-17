import { useEffect, useState, useCallback } from 'react'
import { api, type Item } from '../api/client'
import ItemCard from '../components/ItemCard'
import Toast from '../components/Toast'
import styles from './ArchivePage.module.css'

export default function ArchivePage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  const fetchItems = useCallback(async () => {
    try {
      const data = await api.listItems('ARCHIVED')
      setItems(data)
    } catch (err) {
      console.error('Failed to fetch archived items:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const handleRestore = async (id: string) => {
    try {
      await api.updateStatus(id, 'READY')
      setToast('Restored to Inbox')
      fetchItems()
    } catch {
      setToast('Restore failed')
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Archive</h1>

      {loading && items.length === 0 && (
        <div className={styles.loading}>Loading...</div>
      )}

      {!loading && items.length === 0 && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📦</div>
          <h2>No archived items</h2>
          <p className={styles.emptyText}>
            Items you archive or complete will appear here.
          </p>
        </div>
      )}

      <div className={styles.grid}>
        {items.map(item => (
          <ItemCard
            key={item.id}
            item={item}
            isArchive
            onRestore={handleRestore}
          />
        ))}
      </div>

      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  )
}
