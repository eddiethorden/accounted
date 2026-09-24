'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { ItemKind } from './hues'
import styles from './skills.module.css'

/**
 * "Skriv själv": an own flow, knowledge or analysis written or pasted by
 * hand, no AI needed. A flow is its steps, one per line; knowledge and an
 * analysis are free text (Markdown is fine). Saved under Egna, private to the
 * company until someone shares it.
 */
export function WriteYourself({ open, onOpenChange, initialKind, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialKind: ItemKind
  onSaved: (saved: { id: string; kind: ItemKind }) => void
}) {
  const t = useTranslations('skills_registry')
  const [kind, setKind] = useState<ItemKind>(initialKind)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [problem, setProblem] = useState<string | null>(null)

  const steps = text.split('\n').map((line) => line.replace(/^\s*(\d+[.)]|[-*])\s*/, '').trim()).filter(Boolean)
  const ready = name.trim() && description.trim() && (kind === 'workflow' ? steps.length > 0 : text.trim())

  function body(): string {
    const head = `# ${name.trim()}\n\n${description.trim()}\n\n`
    return kind === 'workflow'
      ? `${head}## ${t('write_steps_heading')}\n\n${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n`
      : `${head}${text.trim()}\n`
  }

  async function save() {
    setState('saving')
    setProblem(null)
    try {
      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'own', item_kind: kind, name: name.trim(), description: description.trim(), body: body() }),
      })
      if (!response.ok) {
        const json = await response.json().catch(() => null) as { error?: { code?: string } } | null
        setProblem(json?.error?.code === 'VALIDATION_ERROR' ? t('write_invalid') : t('write_failed'))
        setState('failed')
        return
      }
      const { data } = await response.json() as { data: { id: string } }
      setName(''); setDescription(''); setText(''); setState('idle')
      onSaved({ id: data.id, kind })
    } catch {
      setProblem(t('write_failed'))
      setState('failed')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('write_title')}</DialogTitle>
          <DialogDescription>{t('write_lede')}</DialogDescription>
        </DialogHeader>
        <div className={styles.writeForm}>
          <SegmentedControl<ItemKind>
            aria-label={t('kinds_label')}
            value={kind}
            onChange={setKind}
            options={(['workflow', 'rules', 'analysis'] as const).map((k) => ({ value: k, label: t(`kind_one_${k}`) }))}
          />
          <div className={styles.writeField}>
            <Label htmlFor="write-name">{t('field_name')}</Label>
            <Input id="write-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t(`write_name_${kind}`)} />
          </div>
          <div className={styles.writeField}>
            <Label htmlFor="write-description">{t('write_description')}</Label>
            <Input id="write-description" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder={t(`write_description_${kind}`)} />
          </div>
          <div className={styles.writeField}>
            <Label htmlFor="write-text">{t(kind === 'workflow' ? 'write_steps' : 'write_text')}</Label>
            <Textarea id="write-text" value={text} rows={kind === 'workflow' ? 6 : 10} onChange={(e) => setText(e.target.value)} placeholder={t(`write_text_${kind}`)} />
            <small className={styles.writeHint}>{t(kind === 'workflow' ? 'write_steps_hint' : 'write_text_hint')}</small>
          </div>
          {problem && <p role="alert" className={styles.writeProblem}>{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button disabled={!ready} loading={state === 'saving'} onClick={() => void save()}>{t('write_save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
