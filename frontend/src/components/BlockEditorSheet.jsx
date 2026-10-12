import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { DAYN, weekOrder, weekStartOf, uid } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import {
  DEFAULT_WEEK, MAX_BLOCK_WEEKS, newBlockDraft, blockOf, blockSlotCandidates, blockProblem, saveBlock, deleteBlock,
} from '../lib/program-block.js'
import { dayAssignSheet, exercisePicker, menuSheet, confirmSheet } from '../sheets.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'
import { Button, NumberField } from './ui.jsx'

const nameOf = id => exerciseNameFor(exOr(id))

// What a refused save says, per blockProblem's code.
function problemText(p, days) {
  switch (p.code) {
    case 'name': return t('Give the block a name.')
    case 'weeks': return t('A block runs from 1 to {0} weeks.', MAX_BLOCK_WEEKS)
    case 'days': return t('Give a routine to exactly {0} days, or change the days per week.', days)
    case 'timed': return t('{0} is timed, and a block can’t hold a timed exercise.', nameOf(p.id))
    default: return t('A block can’t chain into itself.')
  }
}

// Create or edit a Program Block definition (docs/dev/PROGRAM_BLOCKS.md §7.3): name, days and
// duration, which routine trains on which weekday, the Progression Table and the chain. The
// draft is local until Save, so backing out leaves the block as it was.
function BlockEditor({ blockId, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const existing = blockId ? blockOf(S, blockId) : null
  const [draft, setDraft] = useState(() => existing ? structuredClone(existing) : newBlockDraft(uid()))
  const [openSlot, setOpenSlot] = useState(null)
  const [problem, setProblem] = useState(null)

  const patch = p => { setProblem(null); setDraft(d => ({ ...d, ...p })) }
  const weeksN = Math.max(0, Math.min(MAX_BLOCK_WEEKS, Math.round(Number(draft.weeks)) || 0))
  const setCell = (slot, week, p) => patch({
    table: { ...draft.table, [slot]: { ...draft.table[slot], [week]: { ...DEFAULT_WEEK, ...draft.table[slot]?.[week], ...p } } },
  })
  const clearOverride = (slot, week) => {
    const { exerciseId, ...rest } = { ...DEFAULT_WEEK, ...draft.table[slot]?.[week] }
    patch({ table: { ...draft.table, [slot]: { ...draft.table[slot], [week]: rest } } })
  }
  const addSlot = id => {
    patch({ table: { ...draft.table, [id]: Object.fromEntries(Array.from({ length: weeksN }, (_, i) => [i + 1, { ...DEFAULT_WEEK }])) } })
    setOpenSlot(id)
  }
  const removeSlot = id => {
    const { [id]: _gone, ...rest } = draft.table
    patch({ table: rest })
    if (openSlot === id) setOpenSlot(null)
  }
  const pickOverride = (slot, week) => {
    const picker = exercisePicker(ex => { setCell(slot, week, { exerciseId: ex.id }); picker.close() },
      { title: t('Different exercise this week') })
  }

  const routineName = id => (S.routines.find(r => r.id === id)?.name) ?? t('Rest day')
  const others = (S.programBlocks || []).filter(b => b.id !== draft.id)
  const chained = draft.nextBlockId ? others.find(b => b.id === draft.nextBlockId) : null
  const pickChain = () => menuSheet({
    title: t('Then start'),
    items: [
      { icon: 'moon', label: t('Nothing'), on: !chained, onClick: () => patch({ nextBlockId: null }) },
      ...others.map(b => ({ icon: 'calendar', label: b.name, on: chained?.id === b.id, onClick: () => patch({ nextBlockId: b.id }) })),
    ],
  })

  const save = () => {
    const p = blockProblem(S, draft)
    if (p) { setProblem(p); return }
    update(s => { saveBlock(s, draft) })
    close()
  }
  const remove = () => confirmSheet({
    title: t('Delete {0}?', draft.name || t('this block')),
    message: S.activeBlock?.blockId === draft.id
      ? t('It is running now. Your days go back to rest until you stop it.')
      : t('Your logged sessions keep their history.'),
    confirmText: t('Delete block'), danger: true,
    onConfirm: () => { update(s => { deleteBlock(s, draft.id) }); close() },
  })

  const candidates = blockSlotCandidates(S, draft)
  const running = S.activeBlock?.blockId === draft.id

  return <>
    <h3 style={{ marginBottom: 2 }}>{existing ? t('Edit block') : t('New block')}</h3>
    {running && <div className="muted small" style={{ marginBottom: 10 }}>
      {t('This block is running. Changes apply from the next day; a lift added now keeps its own progression until the block ends.')}
    </div>}
    <input className="input" data-field="name" value={draft.name} placeholder={t('Block name')}
      aria-label={t('Block name')} maxLength={60} onChange={e => patch({ name: e.target.value })} />

    <div className="row between" style={{ gap: 10, marginTop: 12 }}>
      <span className="tt">{t('Days per week')}</span>
      <NumberField decimal={false} value={draft.daysPerWeek} aria-label={t('Days per week')} onChange={v => patch({ daysPerWeek: v })} />
    </div>
    <div className="row between" style={{ gap: 10, marginTop: 8 }}>
      <span className="tt">{t('Weeks')}</span>
      <NumberField decimal={false} value={draft.weeks} aria-label={t('Weeks')} onChange={v => patch({ weeks: v })} />
    </div>

    <h4 className="sec">{t('Days')}</h4>
    <div className="list">
      {weekOrder(weekStartOf(S)).map(d => <div key={d} className="item" data-day={d}
        {...tappable(() => dayAssignSheet(d, { current: draft.days[d] || null, onPick: id => {
          const days = { ...draft.days }
          if (id) days[d] = id; else delete days[d]
          patch({ days })
        } }))}>
        <div className="grow"><div className="tt">{t(DAYN[d])}</div>
          <div className="ss">{draft.days[d] ? routineName(draft.days[d]) : t('Rest day')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div>

    <h4 className="sec">{t('Progression table')}</h4>
    {candidates.length === 0
      ? <div className="muted small">{t('Give the days a routine and its lifts show up here.')}</div>
      : <div className="list">
        {candidates.map(c => {
          const inTable = !!draft.table[c.id]
          const open = inTable && openSlot === c.id
          return <div key={c.id} className="item" data-slot={c.id} style={{ display: 'block' }}>
            <div className="row between" style={{ gap: 8 }}>
              <div style={{ minWidth: 0 }} {...(inTable ? tappable(() => setOpenSlot(open ? null : c.id)) : {})}>
                <div className="tt">{nameOf(c.id)}</div>
                <div className="ss dim">{c.timed ? t('Timed, so a block can’t hold it')
                  : inTable ? t('Weeks: {0}', weeksN) : t('Keeps its own progression')}</div>
              </div>
              {inTable
                ? <Button size="sm" variant="ghost" icon="minus" aria-label={t('Take {0} out of the table', nameOf(c.id))} onClick={() => removeSlot(c.id)}>{t('Remove')}</Button>
                : <Button size="sm" variant="tinted" icon="plus" disabled={c.timed || weeksN < 1}
                  aria-label={t('Put {0} in the table', nameOf(c.id))} onClick={() => addSlot(c.id)}>{t('Add')}</Button>}
            </div>
            {open && <div className="block-weeks" style={{ marginTop: 8 }}>
              {Array.from({ length: weeksN }, (_, i) => i + 1).map(w => {
                const e = { ...DEFAULT_WEEK, ...draft.table[c.id][w] }
                return <div key={w} data-week={w} style={{ marginBottom: 10 }}>
                  <div className="small dim" style={{ marginBottom: 4 }}>{t('Week {0}', w)}</div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <NumberField value={e.pct} aria-label={t('Week {0} · % of Training Max', w)} onChange={v => setCell(c.id, w, { pct: v })} />
                    <span className="small dim">%</span>
                    <NumberField decimal={false} value={e.sets} aria-label={t('Week {0} · sets', w)} onChange={v => setCell(c.id, w, { sets: v })} />
                    <span className="small dim">×</span>
                    <NumberField decimal={false} value={e.reps} aria-label={t('Week {0} · reps', w)} onChange={v => setCell(c.id, w, { reps: v })} />
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 4 }}>
                    <Button size="sm" variant="ghost" icon="swap" aria-label={t('Week {0} · different exercise', w)}
                      onClick={() => pickOverride(c.id, w)}>{e.exerciseId ? nameOf(e.exerciseId) : t('Same lift')}</Button>
                    {e.exerciseId && <Button size="sm" variant="ghost" icon="xmark" aria-label={t('Back to the same lift')}
                      onClick={() => clearOverride(c.id, w)} />}
                  </div>
                </div>
              })}
            </div>}
          </div>
        })}
      </div>}

    <h4 className="sec">{t('When it ends')}</h4>
    <div className="list">
      <div className="item" data-field="chain" {...tappable(pickChain)}>
        <div className="grow"><div className="tt">{t('Then start')}</div>
          <div className="ss">{chained ? chained.name : t('Nothing')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>

    {problem && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 12 }}>
      {problemText(problem, draft.daysPerWeek)}
    </div>}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {existing && <><div style={{ height: 10 }} /><Button variant="ghost" icon="trash" onClick={remove}>{t('Delete block')}</Button></>}
  </>
}

/** Opens the editor for a saved block, or a new one when no id is given. */
export function blockEditorSheet(blockId = null) {
  return useUI.getState().openSheet(close => <BlockEditor blockId={blockId} close={close} />)
}
