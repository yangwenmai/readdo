import { useNavigate } from 'react-router-dom'
import type { Item } from '../api/client'
import { timeAgo } from '../api/client'
import PriorityBadge from './PriorityBadge'
import styles from './ItemCard.module.css'

interface ItemCardProps {
  item: Item
  onRetry?: (id: string) => void
  onRestore?: (id: string) => void
  isArchive?: boolean
  selectable?: boolean
  selected?: boolean
  onToggle?: (id: string) => void
}

export default function ItemCard({ item, onRetry, onRestore, isArchive, selectable, selected, onToggle }: ItemCardProps) {
  const navigate = useNavigate()
  const isProcessing = item.status === 'CAPTURED' || item.status === 'PROCESSING'
  const isFailed = item.status === 'FAILED'

  const handleClick = () => {
    if (selectable && onToggle) {
      onToggle(item.id)
      return
    }
    if (item.status === 'READY' || item.status === 'ARCHIVED') {
      navigate(`/items/${item.id}`)
    }
  }

  // Parse error info for failed items
  let errorMessage = 'Processing failed'
  if (isFailed && item.error_info) {
    try {
      const info = JSON.parse(item.error_info)
      errorMessage = info.message || errorMessage
    } catch { /* ignore */ }
  }

  return (
    <div
      className={`${styles.card} ${isFailed ? styles.failed : ''} ${isProcessing ? styles.processing : ''} ${isArchive ? styles.archive : ''} ${selected ? styles.selected : ''}`}
      onClick={handleClick}
      role={item.status === 'READY' || item.status === 'ARCHIVED' || selectable ? 'button' : undefined}
    >
      {selectable && (
        <div className={styles.checkbox} onClick={e => { e.stopPropagation(); onToggle?.(item.id) }}>
          {selected ? '☑' : '☐'}
        </div>
      )}
      {isProcessing ? (
        <div className={styles.skeleton}>
          <div className={styles.skeletonTitle}>{item.title || 'Processing...'}</div>
          <div className={styles.skeletonBar} />
          <div className={styles.skeletonBar} style={{ width: '60%' }} />
          <div className={styles.spinner} />
        </div>
      ) : (
        <>
          <div className={styles.header}>
            {item.priority && <PriorityBadge priority={item.priority} matchScore={item.match_score} />}
            {item.match_score != null && (
              <span className={styles.score}>{Math.round(item.match_score)}</span>
            )}
          </div>

          <h3 className={styles.title}>{item.title || item.url}</h3>
          <div className={styles.meta}>
            {item.domain} · {item.source_type}
          </div>

          {item.intent_text && (
            <div className={styles.intent}>"{item.intent_text}"</div>
          )}

          {isFailed && (
            <div className={styles.errorRow}>
              <span className={styles.errorMsg}>{errorMessage}</span>
              {onRetry && (
                <button
                  className={styles.retryBtn}
                  onClick={(e) => { e.stopPropagation(); onRetry(item.id) }}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {isArchive && onRestore && (
            <button
              className={styles.restoreBtn}
              onClick={(e) => { e.stopPropagation(); onRestore(item.id) }}
            >
              ↩ Restore
            </button>
          )}

          <div className={styles.footer}>
            <span className={styles.time}>{timeAgo(item.created_at)}</span>
          </div>
        </>
      )}
    </div>
  )
}
