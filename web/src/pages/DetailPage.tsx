import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  api,
  parseArtifact,
  timeAgo,
  type ItemWithArtifacts,
  type SummaryPayload,
  type ScorePayload,
  type TodosPayload,
  type TodoItem,
} from '../api/client'
import PriorityBadge from '../components/PriorityBadge'
import Toast from '../components/Toast'
import styles from './DetailPage.module.css'

export default function DetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [item, setItem] = useState<ItemWithArtifacts | null>(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  // Edit state
  const [editingSummary, setEditingSummary] = useState(false)
  const [editingTodos, setEditingTodos] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState<SummaryPayload | null>(null)
  const [todosDraft, setTodosDraft] = useState<TodosPayload | null>(null)

  const fetchItem = useCallback(async () => {
    if (!id) return
    try {
      const data = await api.getItem(id)
      setItem(data)
    } catch {
      navigate('/inbox')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => {
    fetchItem()
  }, [fetchItem])

  if (loading) return <div className={styles.loading}>Loading...</div>
  if (!item) return null

  const summary = parseArtifact<SummaryPayload>(item.artifacts, 'summary')
  const score = parseArtifact<ScorePayload>(item.artifacts, 'score')
  const todos = parseArtifact<TodosPayload>(item.artifacts, 'todos')

  // --- Handlers ---

  const handleArchive = async () => {
    try {
      await api.updateStatus(item.id, 'ARCHIVED')
      setToast('Archived')
      setTimeout(() => navigate('/inbox'), 500)
    } catch {
      setToast('Archive failed')
    }
  }

  // Summary edit
  const startEditSummary = () => {
    setSummaryDraft(summary ? { ...summary, bullets: [...summary.bullets] } : null)
    setEditingSummary(true)
  }

  const saveSummary = async () => {
    if (!summaryDraft) return
    try {
      await api.editArtifact(item.id, 'summary', summaryDraft)
      setEditingSummary(false)
      setToast('Saved ✓')
      fetchItem()
    } catch {
      setToast('Save failed')
    }
  }

  // Todos edit
  const startEditTodos = () => {
    setTodosDraft(todos ? { todos: todos.todos.map(t => ({ ...t })) } : null)
    setEditingTodos(true)
  }

  const saveTodos = async () => {
    if (!todosDraft) return
    try {
      await api.editArtifact(item.id, 'todos', todosDraft)
      setEditingTodos(false)
      setToast('Saved ✓')
      fetchItem()
    } catch {
      setToast('Save failed')
    }
  }

  const toggleTodo = async (index: number) => {
    if (!todos) return
    const updated = {
      todos: todos.todos.map((t, i) =>
        i === index ? { ...t, done: !t.done } : { ...t }
      ),
    }
    try {
      await api.editArtifact(item.id, 'todos', updated)
      fetchItem()
    } catch {
      setToast('Save failed')
    }
  }

  const addTodo = () => {
    if (!todosDraft) return
    setTodosDraft({
      todos: [...todosDraft.todos, { title: '', eta: '20m', type: 'READ' }],
    })
  }

  const allDone = todos?.todos.every(t => t.done) && (todos?.todos.length ?? 0) > 0

  // Compute total ETA
  const etaMinutes = (todoList: TodoItem[]) => {
    const map: Record<string, number> = {
      '10m': 10, '20m': 20, '30m': 30, '45m': 45, '1h': 60, '2h': 120, '3h+': 180,
    }
    return todoList.reduce((sum, t) => sum + (map[t.eta] || 0), 0)
  }

  const formatEta = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }

  return (
    <div className={styles.page}>
      {/* Back button */}
      <button className={styles.back} onClick={() => navigate('/inbox')}>
        ← Back to Inbox
      </button>

      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title || item.url}
          </a>
        </h1>
        <div className={styles.meta}>
          {item.domain}
        </div>
        {item.intent_text && (
          <div className={styles.intent}>"{item.intent_text}"</div>
        )}
        <div className={styles.badges}>
          {item.priority && <PriorityBadge priority={item.priority} />}
          {item.match_score != null && (
            <span className={styles.score}>{Math.round(item.match_score)}/100</span>
          )}
          <span className={styles.time}>{timeAgo(item.created_at)}</span>
        </div>
      </div>

      {/* Why Read This */}
      {score && score.reasons.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Why Read This</h2>
          <div className={styles.sectionContent}>
            <ul className={styles.reasons}>
              {score.reasons.map((reason, i) => (
                <li key={i} className={styles.reason}>
                  <span className={styles.reasonIcon}>✦</span>
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Summary */}
      {summary && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Summary</h2>
            {!editingSummary ? (
              <button className={styles.editBtn} onClick={startEditSummary}>Edit</button>
            ) : (
              <div className={styles.editActions}>
                <button className={styles.saveBtn} onClick={saveSummary}>Save</button>
                <button className={styles.cancelBtn} onClick={() => setEditingSummary(false)}>Cancel</button>
              </div>
            )}
          </div>
          <div className={styles.sectionContent}>
            {!editingSummary ? (
              <>
                <ul className={styles.bullets}>
                  {summary.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
                <div className={styles.insight}>
                  <span className={styles.insightIcon}>💡</span>
                  {summary.insight}
                </div>
              </>
            ) : (
              <div className={styles.editArea}>
                {summaryDraft?.bullets.map((b, i) => (
                  <div key={i} className={styles.editRow}>
                    <span className={styles.bulletDot}>•</span>
                    <input
                      className={styles.editInput}
                      value={b}
                      onChange={e => {
                        const updated = [...(summaryDraft?.bullets || [])]
                        updated[i] = e.target.value
                        setSummaryDraft({ ...summaryDraft!, bullets: updated })
                      }}
                    />
                  </div>
                ))}
                <div className={styles.editRow}>
                  <span className={styles.insightIcon}>💡</span>
                  <input
                    className={styles.editInput}
                    value={summaryDraft?.insight || ''}
                    onChange={e => setSummaryDraft({ ...summaryDraft!, insight: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Todos */}
      {todos && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Todos</h2>
            {!editingTodos ? (
              <button className={styles.editBtn} onClick={startEditTodos}>Edit</button>
            ) : (
              <div className={styles.editActions}>
                <button className={styles.saveBtn} onClick={saveTodos}>Save</button>
                <button className={styles.cancelBtn} onClick={() => setEditingTodos(false)}>Cancel</button>
              </div>
            )}
          </div>
          <div className={styles.sectionContent}>
            {!editingTodos ? (
              <>
                <ul className={styles.todoList}>
                  {todos.todos.map((todo, i) => (
                    <li
                      key={i}
                      className={`${styles.todoItem} ${todo.done ? styles.todoDone : ''}`}
                      onClick={() => toggleTodo(i)}
                    >
                      <span className={styles.checkbox}>
                        {todo.done ? '☑' : '☐'}
                      </span>
                      <span className={styles.todoTitle}>{todo.title}</span>
                      <span className={styles.todoEta}>{todo.eta}</span>
                    </li>
                  ))}
                </ul>
                <div className={styles.todoTotal}>
                  Total ~{formatEta(etaMinutes(todos.todos))}
                </div>
                {allDone && (
                  <div className={styles.allDone}>
                    All done! <button className={styles.archiveLink} onClick={handleArchive}>Archive this item?</button>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.editArea}>
                {todosDraft?.todos.map((todo, i) => (
                  <div key={i} className={styles.todoEditRow}>
                    <input
                      className={styles.editInput}
                      value={todo.title}
                      placeholder="Task title (start with a verb)"
                      onChange={e => {
                        const updated = [...(todosDraft?.todos || [])]
                        updated[i] = { ...updated[i], title: e.target.value }
                        setTodosDraft({ todos: updated })
                      }}
                    />
                    <select
                      className={styles.etaSelect}
                      value={todo.eta}
                      onChange={e => {
                        const updated = [...(todosDraft?.todos || [])]
                        updated[i] = { ...updated[i], eta: e.target.value }
                        setTodosDraft({ todos: updated })
                      }}
                    >
                      <option value="10m">10m</option>
                      <option value="20m">20m</option>
                      <option value="30m">30m</option>
                      <option value="45m">45m</option>
                      <option value="1h">1h</option>
                      <option value="2h">2h</option>
                      <option value="3h+">3h+</option>
                    </select>
                    <button
                      className={styles.removeBtn}
                      onClick={() => {
                        const updated = todosDraft?.todos.filter((_, idx) => idx !== i) || []
                        setTodosDraft({ todos: updated })
                      }}
                    >✕</button>
                  </div>
                ))}
                <button className={styles.addBtn} onClick={addTodo}>+ Add</button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Actions */}
      <div className={styles.actions}>
        <button className={styles.archiveBtn} onClick={handleArchive}>
          Archive
        </button>
        <a
          className={styles.originalBtn}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Original ↗
        </a>
      </div>

      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  )
}
