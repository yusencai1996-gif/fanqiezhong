import { useState, useMemo } from 'react'
import TaskItem from './TaskItem.jsx'
import { collectTags, groupTasks, selectVisibleTasks } from '../features/grouping.js'
import { ListChecks, BookOpen, Briefcase } from 'lucide-react'
import './TaskList.css'

export default function TaskList({ tasks, subjects, activeTaskId, onAdd, onSelect, onToggle, onDelete, onAddTag, onRemoveTag, onMoveTask, onSetSubject }) {
  const [text, setText] = useState('')
  const [filterTag, setFilterTag] = useState(null)  // null=全部
  const [expanded, setExpanded] = useState({})    // {组key: true=展开};默认空=全部折叠(v0.4.0.1 森哥要求默认折叠)

  // 可见任务:剔除"归属已归档科目"的任务(用 grouping.js 的统一口径)
  const visibleTasks = useMemo(() => selectVisibleTasks(tasks, subjects), [tasks, subjects])

  const allTags = useMemo(() => collectTags(visibleTasks), [visibleTasks])
  // 先按标签筛选(基于可见任务),再按科目分组
  const filteredTasks = useMemo(() => {
    const list = filterTag ? visibleTasks.filter(t => (t.tags || []).includes(filterTag)) : visibleTasks
    return [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }, [visibleTasks, filterTag])
  const groups = useMemo(() => groupTasks(filteredTasks, subjects), [filteredTasks, subjects])

  function submit(e) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText('')
  }

  function toggleGroup(key) {
    setExpanded(c => ({ ...c, [key]: !c[key] }))
  }

  return (
    <aside className="task-list">
      <h2 className="task-list__title"><ListChecks size={20} /> 待办清单</h2>

      {/* 标签筛选栏 */}
      {allTags.length > 0 && (
        <div className="task-list__filters">
          <button
            className={'filter-chip' + (filterTag === null ? ' filter-chip--active' : '')}
            onClick={() => setFilterTag(null)}
          >全部</button>
          {allTags.map(tag => (
            <button
              key={tag}
              className={'filter-chip' + (filterTag === tag ? ' filter-chip--active' : '')}
              onClick={() => setFilterTag(filterTag === tag ? null : tag)}
            >#{tag}</button>
          ))}
        </div>
      )}

      <ul className="task-list__items">
        {groups.map(group => {
          const isExpanded = expanded[group.key]
          return (
            <li key={group.key} className="task-group">
              <div className="task-group__head" onClick={() => toggleGroup(group.key)}>
                <span className="task-group__toggle">{isExpanded ? '▾' : '▸'}</span>
                <span className="task-group__name">
                  {group.type === 'subject' ? <BookOpen size={16} /> : <Briefcase size={16} />} {group.name}
                </span>
                <span className="task-group__count">{group.tasks.length}</span>
              </div>
              {isExpanded && group.tasks.map((t, i) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  isActive={t.id === activeTaskId}
                  isFirst={i === 0}
                  isLast={i === group.tasks.length - 1}
                  onSelect={onSelect}
                  onToggle={onToggle}
                  onDelete={onDelete}
                  onAddTag={onAddTag}
                  onRemoveTag={onRemoveTag}
                  onMove={filterTag ? undefined : onMoveTask}
                  subjects={subjects}
                  onSetSubject={onSetSubject}
                />
              ))}
            </li>
          )
        })}
        {groups.length === 0 && (
          <li className="task-list__empty">
            {filterTag ? `没有 #${filterTag} 的任务` : '暂无任务,下面添加一个吧'}
          </li>
        )}
      </ul>

      <form className="task-list__add" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="＋ 新建任务,回车添加"
        />
      </form>
    </aside>
  )
}
