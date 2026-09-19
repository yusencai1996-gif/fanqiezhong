import { useState } from 'react'
import { selectActiveSubjects } from '../features/grouping.js'
import { ChevronUp, ChevronDown, MapPin, Hash, X } from 'lucide-react'

export default function TaskItem({ task, isActive, isFirst, isLast, onSelect, onToggle, onDelete, onAddTag, onRemoveTag, onMove, subjects, onSetSubject }) {
  const [showTagInput, setShowTagInput] = useState(false)
  const [showSubjectSelect, setShowSubjectSelect] = useState(false)
  const [tagText, setTagText] = useState('')
  const tags = task.tags || []
  const allSubjects = subjects || []
  const activeSubjects = selectActiveSubjects(allSubjects)  // P1-5:用 grouping 统一口径
  // mySubject:在全量(含归档)找,用于按钮显示归属状态(归档科目的任务仍显示归属)
  const mySubject = task.subjectId ? allSubjects.find(s => s.id === task.subjectId) : null
  const isArchivedSubject = mySubject && mySubject.archived  // 归属的科目已归档

  function submitTag(e) {
    e.preventDefault()
    e.stopPropagation()
    const t = tagText.trim()
    if (t) onAddTag(task.id, t)
    setTagText('')
    setShowTagInput(false)
  }

  function pickSubject(e) {
    e.stopPropagation()
    const v = e.target.value
    onSetSubject(task.id, v === '__none__' ? null : v)
    setShowSubjectSelect(false)
  }

  return (
    <li
      className={'task-item' + (isActive ? ' task-item--active' : '')}
      onClick={() => onSelect(isActive ? null : task.id)}   // v0.3.12:再点已选中的任务=取消选中(回到自由专注)
    >
      {/*
        v0.3.16 纵向布局:原横向 [checkbox][标题][5按钮] 在300px侧栏太挤。
        现结构:顶部行=checkbox + 标题(独占、自动换行) + 活跃点;
              下方行=标签(左对齐) + 功能按钮(右对齐、平时隐藏不占位)。
      */}
      <div className="task-item__row task-item__row--top">
        <input
          type="checkbox"
          checked={task.completed}
          onChange={(e) => { e.stopPropagation(); onToggle(task.id) }}
        />
        <div className={'task-item__title' + (task.completed ? ' task-item__done' : '')}>
          {task.title}
        </div>
        {isActive && <span className="task-item__dot">●</span>}
      </div>

      {/* 第二行:标签(左)+ 功能按钮(右);按钮平时透明占位、hover整行才亮起 */}
      <div className="task-item__row task-item__row--bottom">
        <div className="task-item__tags">
          {tags.map(t => (
            <span className="tag" key={t} onClick={(e) => { e.stopPropagation(); onRemoveTag(task.id, t) }} title="点击移除">
              #{t}
            </span>
          ))}
        </div>
        <div className="task-item__actions">
          {onMove && (
            <>
              <button
                className="task-item__sort-btn"
                title="上移"
                disabled={isFirst}
                onClick={(e) => { e.stopPropagation(); onMove(task.id, 'up') }}
              ><ChevronUp size={16} /></button>
              <button
                className="task-item__sort-btn"
                title="下移"
                disabled={isLast}
                onClick={(e) => { e.stopPropagation(); onMove(task.id, 'down') }}
              ><ChevronDown size={16} /></button>
            </>
          )}
          {onSetSubject && (
            <button
              className={'task-item__subject-btn' + (mySubject ? ' task-item__subject-btn--set' : '') + (isArchivedSubject ? ' task-item__subject-btn--archived' : '')}
              title={mySubject ? `归属:${mySubject.name}${isArchivedSubject ? '(已归档)' : ''}` : '设置归属科目'}
              onClick={(e) => { e.stopPropagation(); setShowSubjectSelect(v => !v) }}
            ><MapPin size={16} /></button>
          )}
          <button
            className="task-item__tag-btn"
            title="添加标签"
            onClick={(e) => { e.stopPropagation(); setShowTagInput(v => !v) }}
          ><Hash size={16} /></button>
          <button className="task-item__del" onClick={(e) => { e.stopPropagation(); onDelete(task.id) }}><X size={16} /></button>
        </div>
      </div>

      {/* 展开态:标签输入/科目选择,放最下方独立行,不参与左右挤压 */}
      {showTagInput && (
        <form className="tag-input-wrap" onClick={(e) => e.stopPropagation()} onSubmit={submitTag}>
          <input
            className="tag-input"
            autoFocus
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onBlur={() => setShowTagInput(false)}
            placeholder="标签名,回车添加"
          />
        </form>
      )}
      {showSubjectSelect && (
        <div className="subject-select-wrap" onClick={(e) => e.stopPropagation()}>
          <select className="subject-select" autoFocus value={(mySubject && !isArchivedSubject) ? task.subjectId : '__none__'} onChange={pickSubject} onBlur={() => setShowSubjectSelect(false)}>
            <option value="__none__">无(自由任务)</option>
            {activeSubjects.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}
    </li>
  )
}
