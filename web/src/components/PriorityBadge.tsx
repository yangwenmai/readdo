import styles from './PriorityBadge.module.css'

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  READ_NEXT: { label: 'Read next', className: styles.readNext },
  WORTH_IT: { label: 'Worth it', className: styles.worthIt },
  IF_TIME: { label: 'If time', className: styles.ifTime },
  SKIP: { label: 'Skip', className: styles.skip },
}

interface PriorityBadgeProps {
  priority: string
}

export default function PriorityBadge({ priority }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.IF_TIME
  return (
    <span className={`${styles.badge} ${config.className}`}>
      {config.label}
    </span>
  )
}
