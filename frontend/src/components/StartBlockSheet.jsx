import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { best1RM } from '../lib/onerm.js'
import { fmtNum, todayISO } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { blockOf, blockExerciseIds, trainingMaxFrom1RM, trainingMaxesFrom, startBlock } from '../lib/program-block.js'
import { Button, NumberField, Segmented } from './ui.jsx'

// Start a Program Block: one row per exercise the block can ever need, all upfront, each with a
// 1RM / Training Max toggle (docs/dev/PROGRAM_BLOCKS.md §7.2). 1RM mode starts from the app's
// estimate and stores 90% of it; Training Max mode starts blank and stores the number as typed.
function StartBlockSheet({ blockId, startsOn, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const block = blockOf(S, blockId)
  const unit = S.unit || 'kg'
  const [rows, setRows] = useState(() => Object.fromEntries(blockExerciseIds(block).map(id => {
    const est = best1RM(S, id)
    return [id, est ? { mode: '1rm', value: Math.round(est.est * 10) / 10 } : { mode: 'tm', value: null }]
  })))
  if (!block) return null

  const setMode = (id, mode) => setRows(r => {
    if (r[id].mode === mode) return r
    const est = mode === '1rm' ? best1RM(S, id) : null
    return { ...r, [id]: { mode, value: est ? Math.round(est.est * 10) / 10 : null } }
  })
  const setValue = (id, value) => setRows(r => ({ ...r, [id]: { ...r[id], value } }))

  const confirm = () => {
    const tm = trainingMaxesFrom(Object.entries(rows).map(([id, r]) => ({ id, ...r })))
    update(s => { startBlock(s, blockId, tm, startsOn) })
    close()
  }

  return <>
    <h3 style={{ marginBottom: 2 }}>{t('Start {0}', block.name)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>
      {t('Set a Training Max for each lift. A lift left blank keeps its normal progression.')}
    </div>
    <div className="list">
      {Object.keys(rows).map(id => {
        const r = rows[id]
        const name = exerciseNameFor(exOr(id))
        const stored = r.mode === '1rm' && r.value > 0 ? trainingMaxFrom1RM(r.value) : null
        return <div key={id} className="item" data-ex={id} style={{ display: 'block' }}>
          <div className="tt" style={{ marginBottom: 6 }}>{name}</div>
          <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Segmented className="seg-inline" value={r.mode} onChange={m => setMode(id, m)}
              options={[{ value: '1rm', label: t('1RM') }, { value: 'tm', label: t('Training Max') }]} />
            <span className="row" style={{ gap: 6 }}>
              <NumberField nullable value={r.value} onChange={v => setValue(id, v)}
                aria-label={name + ' · ' + (r.mode === '1rm' ? t('1RM') : t('Training Max'))} />
              <span className="small dim">{unit}</span>
            </span>
          </div>
          {stored != null && <div className="small dim" style={{ marginTop: 4 }}>{t('Training Max: {0} {1}', fmtNum(stored), unit)}</div>}
        </div>
      })}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={confirm}>{t('Start block')}</Button>
  </>
}

export function startBlockSheet(blockId, startsOn = todayISO()) {
  return useUI.getState().openSheet(close => <StartBlockSheet blockId={blockId} startsOn={startsOn} close={close} />)
}
