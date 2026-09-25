'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { AI_CLIENTS } from '@/lib/onboarding/ai-clients'
import { coworkLink, routinePrompt, routineTime, ROUTINE_DAYS, type RoutineCadence, type RoutineDay } from '@/lib/agent-skills/routine'
import type { ItemKind } from './hues'
import { Field, SubView } from './AgentDetail'
import { trackInstructions } from './track'
import styles from './skills.module.css'

const CLAUDE_DOWNLOAD = 'https://claude.com/download'

/**
 * "Gör till rutin": how often, then Claude Desktop opens a new Cowork task
 * asking Claude to schedule this run. `run` is the page's own start prompt,
 * so a scheduled run is the same job a click starts, told that nobody is
 * there to answer questions while it runs.
 */
export function RoutinePanel({ run, item, kind, onBack }: { run: string; item: string; kind: ItemKind; onBack: () => void }) {
  const t = useTranslations('skills_registry')
  const [cadence, setCadence] = useState<RoutineCadence>('weekly')
  const [day, setDay] = useState<RoutineDay>('mon')
  const [time, setTime] = useState('07:00')
  const at = routineTime(time)
  const when = cadence === 'weekly'
    ? t('routine_when_weekly', { day: t(`routine_days.${day}`), time: at })
    : t(`routine_when_${cadence}`, { time: at })
  const prompt = routinePrompt({ when, run, wrap: (w, r) => t('routine_prompt', { when: w, run: r }) })
  const claude = AI_CLIENTS.find((c) => c.id === 'claude')!

  function open() {
    trackInstructions('instructions_routine_opened', { item, kind, cadence })
    window.location.href = coworkLink(prompt)
  }

  return (
    <SubView title={t('routine_title')} onBack={onBack}>
      <p className={styles.muted}>{t('routine_lede')}</p>
      <Field label={t('routine_how_often')}>
        <SegmentedControl<RoutineCadence>
          aria-label={t('routine_how_often')}
          className={styles.sourceSwitch}
          value={cadence}
          onChange={setCadence}
          options={(['daily', 'weekdays', 'weekly'] as const).map((c) => ({ value: c, label: t(`routine_${c}`) }))}
        />
      </Field>
      <div className={styles.routineRow}>
        {cadence === 'weekly' && (
          <Field label={t('routine_day')}>
            <select className={`${styles.fieldBox} ${styles.fieldInput}`} value={day} onChange={(e) => setDay(e.target.value as RoutineDay)} aria-label={t('routine_day')}>
              {ROUTINE_DAYS.map((d) => <option key={d} value={d}>{t(`routine_days.${d}`)}</option>)}
            </select>
          </Field>
        )}
        <Field label={t('routine_time')}>
          <input type="time" className={`${styles.fieldBox} ${styles.fieldInput}`} value={time} onChange={(e) => setTime(e.target.value)} aria-label={t('routine_time')} />
        </Field>
      </div>
      <Field label={t('routine_preview')}>
        <div className={`${styles.instrBox} ${styles.routinePreview}`}>{prompt}</div>
      </Field>
      <div className="flex flex-col items-start gap-2">
        <Button className="gap-2" onClick={open}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={claude.logo} alt="" width={16} height={16} className={styles.btnLogo} />
          {t('routine_go')}
        </Button>
        <small className={styles.muted}>{t('routine_note')}</small>
        <a className={styles.catLink} href={CLAUDE_DOWNLOAD} target="_blank" rel="noreferrer">{t('routine_download')}</a>
      </div>
    </SubView>
  )
}
