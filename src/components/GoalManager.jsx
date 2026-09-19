import { useState, useEffect } from 'react'
import { planDoneHours, planTodayHours } from '../features/planning.js'
import { fmtHours } from '../features/format.js'
import { Target, Package, BookOpen, ListChecks } from 'lucide-react'
import './GoalManager.css'

export default function GoalManager({ goals, subjects, plans, sessions, onAddGoal, onRenameGoal, onSetGoalDeadline, onArchiveGoal, onUnarchiveGoal, onDeleteGoal, onAddSubject, onRenameSubject, onArchiveSubject, onUnarchiveSubject, onDeleteSubject, onMoveSubject, onAddPlan, onUpdatePlan, onDeletePlan, onClose }) {
  const activeGoals = goals.filter(g => !g.archived)
  const archivedGoals = goals.filter(g => g.archived)
  // 归档计数(归档目标 + 单独归档的科目),用于tab徽标。单独归档科目=归档但归属目标未归档的
  const archivedSubjectIdsOfArchivedGoal = new Set(
    subjects.filter(s => s.archived && goals.some(g => g.id === s.goalId && g.archived)).map(s => s.id)
  )
  const standaloneArchivedSubjects = subjects.filter(s => s.archived && !archivedSubjectIdsOfArchivedGoal.has(s.id))
  const archivedCount = archivedGoals.length + standaloneArchivedSubjects.length
  const [selectedGoalId, setSelectedGoalId] = useState(activeGoals[0]?.id || null)
  const [newGoalName, setNewGoalName] = useState('')
  const [newSubjectName, setNewSubjectName] = useState('')
  // 编辑态:正在编辑的目标名/截止日(inline 编辑)
  const [editingGoal, setEditingGoal] = useState(null)  // {id, name, deadline}
  const [tab, setTab] = useState('main')  // 'main'=目标管理 | 'archive'=归档区

  // 关键修复:selectedGoalId 失效时(目标被删/归档)自动回退到第一个,避免 input 因 selectedGoal 闪烁而 unmount 失焦
  useEffect(() => {
    if (selectedGoalId && !activeGoals.some(g => g.id === selectedGoalId)) {
      setSelectedGoalId(activeGoals[0]?.id || null)
    } else if (!selectedGoalId && activeGoals.length > 0) {
      setSelectedGoalId(activeGoals[0].id)
    }
  }, [activeGoals, selectedGoalId])

  const selectedGoal = activeGoals.find(g => g.id === selectedGoalId) || null  // 只在未归档里找
  const selectedSubjects = selectedGoal
    ? subjects.filter(s => s.goalId === selectedGoal.id && !s.archived)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : []

  function submitGoal(e) {
    e.preventDefault()
    const n = newGoalName.trim()
    if (!n) return
    const g = onAddGoal(n)
    setNewGoalName('')
    setSelectedGoalId(g.id)
  }

  function submitSubject(e) {
    e.preventDefault()
    const n = newSubjectName.trim()
    if (!n || !selectedGoal) return
    onAddSubject(selectedGoal.id, n)
    setNewSubjectName('')
  }

  function saveGoalEdit() {
    if (!editingGoal) return
    if (editingGoal.name.trim()) onRenameGoal(editingGoal.id, editingGoal.name.trim())
    onSetGoalDeadline(editingGoal.id, editingGoal.deadline || null)
    setEditingGoal(null)
  }

  return (
    <div className="goal-overlay" onClick={onClose}>
      <div className="goal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="goal-header">
          <h2><Target size={20} /> 目标与科目</h2>
          <button className="goal-close" onClick={onClose}>×</button>
        </div>

        <div className="goal-tabs">
          <button className={'goal-tab' + (tab === 'main' ? ' goal-tab--active' : '')} onClick={() => setTab('main')}>目标管理</button>
          <button className={'goal-tab' + (tab === 'archive' ? ' goal-tab--active' : '')} onClick={() => setTab('archive')}><Package size={16} /> 归档区{archivedCount > 0 && <span className="goal-tab__badge">{archivedCount}</span>}</button>
        </div>

        {tab === 'archive' ? (
          <ArchiveView
            goals={goals}
            subjects={subjects}
            standaloneArchivedSubjects={standaloneArchivedSubjects}
            onUnarchiveGoal={onUnarchiveGoal}
            onUnarchiveSubject={onUnarchiveSubject}
            onDeleteGoal={onDeleteGoal}
            onDeleteSubject={onDeleteSubject}
          />
        ) : (
        <div className="goal-body">
          {/* 左侧:目标列表 */}
          <div className="goal-list">
            <div className="goal-list__title">目标</div>
            {activeGoals.length === 0 && (
              <div className="goal-empty">还没有目标,下面新建一个</div>
            )}
            {activeGoals.map(g => (
              <div
                key={g.id}
                className={'goal-item' + (g.id === selectedGoalId ? ' goal-item--active' : '')}
                onClick={() => { setSelectedGoalId(g.id); setEditingGoal(null) }}
              >
                <div className="goal-item__name">{g.name}</div>
                {g.deadline && <div className="goal-item__deadline">截止 {g.deadline}</div>}
              </div>
            ))}
            <form className="goal-add" onSubmit={submitGoal}>
              <input
                value={newGoalName}
                onChange={(e) => setNewGoalName(e.target.value)}
                placeholder="＋ 新目标名(如 考研)"
              />
            </form>
          </div>

          {/* 右侧:选中目标的详情 + 科目 */}
          <div className="goal-detail">
            {!selectedGoal ? (
              <div className="goal-empty">← 选择或新建一个目标</div>
            ) : editingGoal ? (
              <div className="goal-edit">
                <div className="goal-edit__title">编辑目标</div>
                <label className="goal-edit__row">
                  <span>名称</span>
                  <input value={editingGoal.name} onChange={(e) => setEditingGoal({ ...editingGoal, name: e.target.value })} />
                </label>
                <label className="goal-edit__row">
                  <span>截止日</span>
                  <input type="date" value={editingGoal.deadline || ''} onChange={(e) => setEditingGoal({ ...editingGoal, deadline: e.target.value })} />
                </label>
                <div className="goal-edit__actions">
                  <button className="goal-btn goal-btn--primary" onClick={saveGoalEdit}>保存</button>
                  <button className="goal-btn" onClick={() => setEditingGoal(null)}>取消</button>
                </div>
              </div>
            ) : (
              <>
                <div className="goal-detail__head">
                  <div>
                    <div className="goal-detail__name">{selectedGoal.name}</div>
                    {selectedGoal.deadline && <div className="goal-detail__deadline">截止日期:{selectedGoal.deadline}</div>}
                  </div>
                  <div className="goal-detail__actions">
                    <button className="goal-btn goal-btn--sm" onClick={() => setEditingGoal({ id: selectedGoal.id, name: selectedGoal.name, deadline: selectedGoal.deadline || '' })}>编辑</button>
                    <button className="goal-btn goal-btn--sm" onClick={() => { if (confirm(`归档目标"${selectedGoal.name}"?其下科目会一起归档(任务保留)`)) { onArchiveGoal(selectedGoal.id); setSelectedGoalId(null) } }}>归档</button>
                    <button className="goal-btn goal-btn--sm goal-btn--danger" onClick={() => { if (confirm(`删除目标"${selectedGoal.name}"?其下科目会一起删除,任务保留(变为自由任务)`)) { onDeleteGoal(selectedGoal.id); setSelectedGoalId(null) } }}>删除</button>
                  </div>
                </div>

                <div className="goal-detail__subtitle">科目</div>
                {selectedSubjects.length === 0 && (
                  <div className="goal-empty">还没有科目,下面新建</div>
                )}
                <ul className="subject-list">
                  {selectedSubjects.map((s, i) => (
                    <SubjectRow
                      key={s.id}
                      subject={s}
                      isFirst={i === 0}
                      isLast={i === selectedSubjects.length - 1}
                      plans={plans}
                      sessions={sessions}
                      onRename={(name) => onRenameSubject(s.id, name)}
                      onMove={(dir) => onMoveSubject(s.id, dir)}
                      onArchive={() => onArchiveSubject(s.id)}
                      onDelete={() => { if (confirm(`删除科目"${s.name}"?其下任务变为自由任务(保留)`)) onDeleteSubject(s.id) }}
                      onAddPlan={(data) => onAddPlan(data)}
                      onUpdatePlan={(id, patch) => onUpdatePlan(id, patch)}
                      onDeletePlan={(id) => onDeletePlan(id)}
                    />
                  ))}
                </ul>
                <form className="goal-add" onSubmit={submitSubject}>
                  <input
                    value={newSubjectName}
                    onChange={(e) => setNewSubjectName(e.target.value)}
                    placeholder="＋ 新科目(如 数学)"
                  />
                </form>
              </>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  )
}

// 科目行(可 inline 改名 + 排序)
function SubjectRow({ subject, isFirst, isLast, plans, sessions, onRename, onMove, onArchive, onDelete, onAddPlan, onUpdatePlan, onDeletePlan }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(subject.name)
  const [showPlans, setShowPlans] = useState(false)   // 展开计划区
  const [newPlan, setNewPlan] = useState({ name: '', totalHours: '', deadline: '' })
  const [editingPlan, setEditingPlan] = useState(null)   // 正在编辑的计划 {id,name,totalHours,deadline}
  function save() {
    if (name.trim()) onRename(name.trim())
    setEditing(false)
  }

  const subjectPlans = (plans || []).filter(p => p.subjectId === subject.id && !p.archived)

  function submitPlan(e) {
    e.preventDefault()
    const h = Number(newPlan.totalHours)
    if (!h || h <= 0) return
    onAddPlan({ subjectId: subject.id, name: newPlan.name.trim() || '复习计划', totalHours: h, deadline: newPlan.deadline || null })
    setNewPlan({ name: '', totalHours: '', deadline: '' })
  }

  // 保存计划编辑:校验时长后调 onUpdatePlan
  function savePlanEdit() {
    if (!editingPlan) return
    const h = Number(editingPlan.totalHours)
    if (!h || h <= 0) return   // 时长必须>0
    onUpdatePlan(editingPlan.id, {
      name: editingPlan.name.trim() || '复习计划',
      totalHours: h,
      deadline: editingPlan.deadline || null,
    })
    setEditingPlan(null)
  }

  return (
    <li className="subject-item subject-item--col">
      <div className="subject-item__head">
        {editing ? (
          <input className="subject-item__input" autoFocus value={name}
            onChange={(e) => setName(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
        ) : (
          <span className="subject-item__name" onDoubleClick={() => setEditing(true)} title="双击改名"><BookOpen size={16} /> {subject.name}</span>
        )}
        <span className="subject-item__sort">
          <button className="goal-btn goal-btn--xs" title="上移" disabled={isFirst} onClick={() => onMove('up')}>▲</button>
          <button className="goal-btn goal-btn--xs" title="下移" disabled={isLast} onClick={() => onMove('down')}>▼</button>
        </span>
        <button className="goal-btn goal-btn--xs" onClick={() => setEditing(true)}>改名</button>
        <button className="goal-btn goal-btn--xs" title="计划" onClick={() => setShowPlans(v => !v)}><ListChecks size={14} />{subjectPlans.length > 0 ? `(${subjectPlans.length})` : ''}</button>
        <button className="goal-btn goal-btn--xs" onClick={onArchive}>归档</button>
        <button className="goal-btn goal-btn--xs goal-btn--danger" onClick={onDelete}>删</button>
      </div>

      {/* 计划展开区 */}
      {showPlans && (
        <div className="plan-area">
          {subjectPlans.map(p => {
            const done = planDoneHours(sessions, p)
            const pct = p.totalHours > 0 ? Math.min(100, Math.round(done / p.totalHours * 100)) : 0
            const today = planTodayHours(sessions, p)
            const isEditing = editingPlan && editingPlan.id === p.id
            // v0.4.0:同科目多计划时,done 是科目总投入(非该计划独占),UI 需标注
            const isSharedSubject = subjectPlans.length > 1
            return (
              <div className="plan-row" key={p.id}>
                {isEditing ? (
                  // 编辑态:行内输入框(改时长/截止日/计划名)
                  <div className="plan-edit">
                    <input value={editingPlan.name} onChange={(e) => setEditingPlan({ ...editingPlan, name: e.target.value })} placeholder="计划名" />
                    <input type="number" min="0" step="0.5" value={editingPlan.totalHours} onChange={(e) => setEditingPlan({ ...editingPlan, totalHours: e.target.value })} placeholder="总时长h" />
                    <input type="date" value={editingPlan.deadline || ''} onChange={(e) => setEditingPlan({ ...editingPlan, deadline: e.target.value })} />
                    <button
                      className="goal-btn goal-btn--xs goal-btn--primary"
                      onClick={savePlanEdit}
                      disabled={!(Number(editingPlan.totalHours) > 0)}
                      title={Number(editingPlan.totalHours) > 0 ? '保存修改' : '总时长必须大于0'}
                    >保存</button>
                    <button className="goal-btn goal-btn--xs" onClick={() => setEditingPlan(null)}>取消</button>
                  </div>
                ) : (
                  <>
                    <div className="plan-row__info">
                      <span className="plan-row__name">{p.name}{isSharedSubject && <span className="plan-row__shared" title="该科目有多个计划,投入时长为科目总计,非此计划独占"> · 共享科目</span>}</span>
                      <span className="plan-row__meta">科目投入 {fmtHours(done)}/{fmtHours(p.totalHours)} · {pct}%{p.deadline ? ` · 截止${p.deadline}` : ''}{today > 0 ? ` · 今天应学${fmtHours(today)}` : ''}</span>
                    </div>
                    <div className="plan-row__bar-bg"><div className="plan-row__bar" style={{ width: `${pct}%` }} /></div>
                    <div className="plan-row__btns">
                      <button className="goal-btn goal-btn--xs" title="修改计划" onClick={() => setEditingPlan({ id: p.id, name: p.name, totalHours: String(p.totalHours), deadline: p.deadline || '' })}>改</button>
                      <button className="goal-btn goal-btn--xs goal-btn--danger" onClick={() => { if (confirm(`删除计划"${p.name}"?`)) onDeletePlan(p.id) }}>删</button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          <form className="plan-add" onSubmit={submitPlan}>
            <input value={newPlan.name} onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })} placeholder="计划名(如 第1轮)" />
            <input type="number" min="0" step="0.5" value={newPlan.totalHours} onChange={(e) => setNewPlan({ ...newPlan, totalHours: e.target.value })} placeholder="总时长h" />
            <input type="date" value={newPlan.deadline} onChange={(e) => setNewPlan({ ...newPlan, deadline: e.target.value })} />
            <button type="submit" className="goal-btn goal-btn--xs goal-btn--primary">＋计划</button>
          </form>
        </div>
      )}
    </li>
  )
}

// 归档区:查看已归档目标/科目,可恢复或彻底删除
function ArchiveView({ goals, subjects, standaloneArchivedSubjects, onUnarchiveGoal, onUnarchiveSubject, onDeleteGoal, onDeleteSubject }) {
  const archivedGoals = goals.filter(g => g.archived)
  // standaloneArchivedSubjects 由父组件算好传入(避免重复计算 + 徽标共享)

  const empty = archivedGoals.length === 0 && standaloneArchivedSubjects.length === 0

  return (
    <div className="archive-view">
      {empty && <div className="goal-empty">没有归档内容。归档的目标/科目会出现在这里,可随时恢复。</div>}

      {archivedGoals.map(g => {
        const subs = subjects.filter(s => s.goalId === g.id && s.archived)
        return (
          <div className="archive-group" key={g.id}>
            <div className="archive-group__head">
              <div className="archive-group__name"><Target size={16} /> {g.name}{g.deadline && <span className="archive-group__deadline">(截止 {g.deadline})</span>}</div>
              <div className="archive-group__actions">
                <button className="goal-btn goal-btn--sm goal-btn--primary" onClick={() => onUnarchiveGoal(g.id)}>恢复</button>
                <button className="goal-btn goal-btn--sm goal-btn--danger" onClick={() => { if (confirm(`彻底删除目标"${g.name}"?其下科目一起删,任务变自由任务(历史统计保留)`)) onDeleteGoal(g.id) }}>删除</button>
              </div>
            </div>
            {subs.map(s => (
              <div className="archive-sub" key={s.id}>
                <span className="archive-sub__name"><BookOpen size={16} /> {s.name}</span>
                <span className="archive-sub__hint">(随目标恢复)</span>
              </div>
            ))}
          </div>
        )
      })}

      {standaloneArchivedSubjects.length > 0 && (
        <div className="archive-group">
          <div className="archive-group__title">单独归档的科目</div>
          {standaloneArchivedSubjects.map(s => {
            const goalName = goals.find(g => g.id === s.goalId)?.name || '(已删目标)'
            return (
              <div className="archive-sub archive-sub--standalone" key={s.id}>
                <span className="archive-sub__name"><BookOpen size={16} /> {s.name}</span>
                <span className="archive-sub__hint">属于:{goalName}</span>
                <div className="archive-group__actions">
                  <button className="goal-btn goal-btn--xs goal-btn--primary" onClick={() => onUnarchiveSubject(s.id)}>恢复</button>
                  <button className="goal-btn goal-btn--xs goal-btn--danger" onClick={() => { if (confirm(`彻底删除科目"${s.name}"?任务变自由任务(历史统计保留)`)) onDeleteSubject(s.id) }}>删</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
