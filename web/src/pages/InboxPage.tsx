import { useEffect, useState, useCallback } from 'react'
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

  const fetchItems = useCallback(async () => {
    try {
      const data = await api.listItems('CAPTURED,PROCESSING,READY,FAILED')
      setItems(data)
    } catch (err) {
      console.error('Failed to fetch items:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems()
    const interval = setInterval(fetchItems, 5000)
    return () => clearInterval(interval)
  }, [fetchItems])

  const handleRetry = async (id: string) => {
    try {
      await api.retry(id)
      setToast('Retrying...')
      fetchItems()
    } catch (err) {
      setToast('Retry failed')
    }
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
      <h1 className={styles.pageTitle}>Inbox</h1>

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
              <ItemCard key={item.id} item={item} />
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
              <ItemCard key={item.id} item={item} onRetry={handleRetry} />
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
                <ItemCard key={item.id} item={item} />
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
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  )
}
