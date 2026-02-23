import styles from './PriorityBadge.module.css'

const PRIORITY_CONFIG: Record<string, { label: string; className: string; description: string }> = {
  DO_FIRST: { label: 'Do first', className: styles.doFirst, description: '综合分 ≥ 80，优先行动' },
  PLAN_IT: { label: 'Plan it', className: styles.planIt, description: '综合分 60–79，纳入计划' },
  SKIM_IT: { label: 'Skim it', className: styles.skimIt, description: '综合分 40–59，快速浏览' },
  LET_GO: { label: 'Let go', className: styles.letGo, description: '综合分 < 40，放心放手' },
}

interface PriorityBadgeProps {
  priority: string
  matchScore?: number
  intentScore?: number
  qualityScore?: number
}

export default function PriorityBadge({ priority, matchScore, intentScore, qualityScore }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.SKIM_IT
  const hasScores = intentScore != null && qualityScore != null

  return (
    <span className={`${styles.badge} ${config.className}`}>
      {config.label}
      <span className={`${styles.tooltip} ${hasScores ? styles.tooltipWide : ''}`}>
        <span className={styles.tooltipHeader}>
          <span className={styles.tooltipLabel}>{config.label}</span>
          {matchScore != null && (
            <span className={styles.tooltipScore}>{Math.round(matchScore)}/100</span>
          )}
        </span>
        <span className={styles.tooltipDesc}>{config.description}</span>
        {hasScores && (
          <span className={styles.tooltipScores}>
            <span className={styles.scoreRow}>
              <span className={styles.scoreLabel}>意图匹配</span>
              <span className={styles.scoreBar}>
                <span className={styles.scoreBarFill} style={{ width: `${intentScore}%` }} />
              </span>
              <span className={styles.scoreValue}>{Math.round(intentScore!)}</span>
            </span>
            <span className={styles.scoreRow}>
              <span className={styles.scoreLabel}>文章质量</span>
              <span className={styles.scoreBar}>
                <span className={styles.scoreBarFill} style={{ width: `${qualityScore}%` }} />
              </span>
              <span className={styles.scoreValue}>{Math.round(qualityScore!)}</span>
            </span>
          </span>
        )}
      </span>
    </span>
  )
}
