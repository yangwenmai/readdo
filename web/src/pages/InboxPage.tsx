import { useEffect, useState, useCallback, useRef } from 'react'
import { api, type Item } from '../api/client'
import ItemCard from '../components/ItemCard'
import Toast from '../components/Toast'
import styles from './InboxPage.module.css'

const PRIORITY_ORDER = ['READ_NEXT', 'WORTH_IT', 'IF_TIME', 'SKIP']
const PRIORITY_LABELS: Record<string, string> = {
  READ_NEXT: '🟢 Read next',
  WORTH_IT: '🔵 Worth it',
  IF_TIME: '⚪ If time',
  SKIP: '🔴 Skip',
}

export default function InboxPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const fetchItems = useCallback(async (query?: string) => {
    try {
      const data = await api.listItems('CAPTURED,PROCESSING,READY,FAILED', query || undefined)
      setItems(data)
    } catch (err) {
      console.error('Failed to fetch items:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems(searchQuery)
    const interval = setInterval(() => fetchItems(searchQuery), 5000)
    return () => clearInterval(interval)
  }, [fetchItems, searchQuery])

  const handleSearchChange = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearchQuery(value), 300)
  }

  const handleRetry = async (id: string) => {
    try {
      await api.retry(id)
      setToast('Retrying...')
      fetchItems(searchQuery)
    } catch {
      setToast('Retry failed')
    }
  }

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBatchArchive = async () => {
    try {
      await api.batchUpdateStatus([...selected], 'ARCHIVED')
      setSelected(new Set())
      setSelectMode(false)
      setToast(`Archived ${selected.size} items`)
      fetchItems(searchQuery)
    } catch {
      setToast('Batch archive failed')
    }
  }

  const handleBatchDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} items? This cannot be undone.`)) return
    try {
      await api.batchDelete([...selected])
      setSelected(new Set())
      setSelectMode(false)
      setToast(`Deleted ${selected.size} items`)
      fetchItems(searchQuery)
    } catch {
      setToast('Batch delete failed')
    }
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelected(new Set())
  }

  // Group items
  const processingItems = items.filter(
    i => i.status === 'CAPTURED' || i.status === 'PROCESSING'
  )
  const failedItems = items.filter(i => i.status === 'FAILED')
  const readyItems = items.filter(i => i.status === 'READY')

  const groupedByPriority: Record<string, Item[]> = {}
  for (const p of PRIORITY_ORDER) {
    const group = readyItems.filter(i => i.priority === p)
    if (group.length > 0) {
      groupedByPriority[p] = group
    }
  }
  // Items without priority
  const ungrouped = readyItems.filter(
    i => !i.priority || !PRIORITY_ORDER.includes(i.priority)
  )

  const isEmpty = items.length === 0

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Inbox</h1>
        <div className={styles.toolbar}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search by title, domain, or intent..."
            defaultValue={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
          />
          <button
            className={`${styles.selectBtn} ${selectMode ? styles.selectBtnActive : ''}`}
            onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
          >
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        </div>
      </div>

      {loading && isEmpty && (
        <div className={styles.loading}>Loading...</div>
      )}

      {!loading && isEmpty && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📭</div>
          <h2>Inbox is empty</h2>
          <p className={styles.emptyText}>
            Capture your first link with the Chrome extension to get started.
          </p>
        </div>
      )}

      {/* Processing items */}
      {processingItems.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>⏳ Processing ({processingItems.length})</h2>
          <div className={styles.grid}>
            {processingItems.map(item => (
              <ItemCard key={item.id} item={item} selectable={selectMode} selected={selected.has(item.id)} onToggle={toggleSelect} />
            ))}
          </div>
        </section>
      )}

      {/* Failed items */}
      {failedItems.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>❌ Failed ({failedItems.length})</h2>
          <div className={styles.grid}>
            {failedItems.map(item => (
              <ItemCard key={item.id} item={item} onRetry={handleRetry} selectable={selectMode} selected={selected.has(item.id)} onToggle={toggleSelect} />
            ))}
          </div>
        </section>
      )}

      {/* Ready items grouped by priority */}
      {PRIORITY_ORDER.map(priority => {
        const group = groupedByPriority[priority]
        if (!group) return null
        return (
          <section key={priority} className={styles.section}>
            <h2 className={styles.sectionTitle}>
              {PRIORITY_LABELS[priority]} ({group.length})
            </h2>
            <div className={styles.grid}>
              {group.map(item => (
                <ItemCard key={item.id} item={item} selectable={selectMode} selected={selected.has(item.id)} onToggle={toggleSelect} />
              ))}
            </div>
          </section>
        )
      })}

      {ungrouped.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Other ({ungrouped.length})</h2>
          <div className={styles.grid}>
            {ungrouped.map(item => (
              <ItemCard key={item.id} item={item} selectable={selectMode} selected={selected.has(item.id)} onToggle={toggleSelect} />
            ))}
          </div>
        </section>
      )}

      {/* Floating batch action bar */}
      {selectMode && selected.size > 0 && (
        <div className={styles.batchBar}>
          <span>{selected.size} selected</span>
          <button className={styles.batchArchiveBtn} onClick={handleBatchArchive}>Archive</button>
          <button className={styles.batchDeleteBtn} onClick={handleBatchDelete}>Delete</button>
        </div>
      )}

      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  )
}
