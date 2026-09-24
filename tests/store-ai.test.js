import { describe, it, expect } from 'vitest'
import { createMemoryStore, migrateState } from '../src/data/store.js'

describe('schema v10 AI configuration', () => {
  it('new store has a blank key and chat model', () => {
    const state = createMemoryStore().getState()
    expect(state.schemaVersion).toBe(10)
    expect(state.settings.aiConfig).toEqual({ apiKey: '', model: 'deepseek-flash' })
  })

  it('migrates v9 without losing other settings or business data', () => {
    const old = { schemaVersion: 9, settings: { workMinutes: 45, extra: true }, goals: [{ id: 'g' }], sessions: [{ id: 'x' }], activeFocus: { startedAtTs: 1 }, activeTaskId: 't' }
    const next = migrateState(old)
    expect(next.schemaVersion).toBe(10)
    expect(next.settings).toMatchObject({ workMinutes: 45, extra: true, aiConfig: { apiKey: '', model: 'deepseek-flash' } })
    expect(next.goals).toEqual(old.goals)
    expect(next.sessions).toEqual(old.sessions)
    expect(next.activeFocus).toEqual(old.activeFocus)
    expect(next.activeTaskId).toBe('t')
  })

  it('takes a v0 state through the old chain to v10', () => {
    const next = migrateState({ tasks: [{ id: 't', title: 'A' }], sessions: [], settings: { workMinutes: 25 } })
    expect(next.schemaVersion).toBe(10)
    expect(next.tasks[0]).toMatchObject({ id: 't', order: 0, subjectId: null })
    expect(next.plans).toEqual([])
    expect(next.activeFocus).toBeNull()
    expect(next.activeTaskId).toBeNull()
    expect(next.settings.dailyGoalMinutes).toBe(30)
  })

  it.each([undefined, null, 'bad', []])('tolerates invalid settings %s', settings => {
    expect(migrateState({ schemaVersion: 9, settings }).settings.aiConfig).toEqual({ apiKey: '', model: 'deepseek-flash' })
  })

  it.each([undefined, null, 'bad', []])('tolerates invalid AI config %s', aiConfig => {
    expect(migrateState({ schemaVersion: 9, settings: { aiConfig } }).settings.aiConfig).toEqual({ apiKey: '', model: 'deepseek-flash' })
  })

  it('preserves a valid key and reasoner choice', () => {
    const next = migrateState({ schemaVersion: 9, settings: { aiConfig: { apiKey: 'sk-test-12345678', model: 'deepseek-v4-pro', extra: 1 } } })
    expect(next.settings.aiConfig).toEqual({ apiKey: 'sk-test-12345678', model: 'deepseek-v4-pro', extra: 1 })
  })

  it('repairs invalid models even when the state already says v10', () => {
    expect(migrateState({ schemaVersion: 10, settings: { aiConfig: { apiKey: 'sk-test-12345678', model: 'unknown' } } }).settings.aiConfig)
      .toEqual({ apiKey: 'sk-test-12345678', model: 'deepseek-flash' })
  })

  it('repeated migration is stable', () => {
    const once = migrateState({ schemaVersion: 9, settings: { aiConfig: { model: 'unknown' } } })
    expect(migrateState(once)).toEqual(once)
  })
})
