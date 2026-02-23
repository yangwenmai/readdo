import { useEffect, useState, useCallback, useRef } from 'react'
import { api, type Item } from '../api/client'
import ItemCard from '../components/ItemCard'
import Toast from '../components/Toast'
import styles from './ArchivePage.module.css'

export default function ArchivePage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const fetchItems = useCallback(async (query?: string) => {
    try {
      const data = await api.listItems('ARCHIVED', query || undefined)
      setItems(data)
    } catch (err) {
      console.error('Failed to fetch archived items:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems(searchQuery)
  }, [fetchItems, searchQuery])

  const handleSearchChange = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearchQuery(value), 300)
  }

  const handleRestore = async (id: string) => {
    try {
      await api.updateStatus(id, 'READY')
      setToast('Restored to Inbox')
      fetchItems(searchQuery)
    } catch {
      setToast('Restore failed')
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Archive</h1>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search archived items..."
          defaultValue={searchQuery}
          onChange={e => handleSearchChange(e.target.value)}
        />
      </div>

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
