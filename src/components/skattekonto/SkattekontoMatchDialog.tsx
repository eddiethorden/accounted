'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/components/ui/use-toast'
import { formatCurrency, formatDate } from '@/lib/utils'
import { formatVoucher } from '@/lib/bookkeeping/voucher-series-resolver'
import type { StoredSkattekontoTransaction } from '@/types/skatteverket'
import { getErrorMessage as getUserErrorMessage } from '@/lib/errors/get-error-message'

interface MatchCandidate {
  journal_entry_id: string
  voucher_number: number | null
  voucher_series: string | null
  entry_date: string
  description: string
  status: 'draft' | 'posted' | 'reversed'
  matched_amount: number
  matched_side: 'debit' | 'credit'
  /** Settles this row only together with other rows (one combined 1630 line). */
  group?: {
    mode: 'new' | 'join'
    link_transaction_ids: string[]
    group_rows: Array<{
      id: string
      transaktionsdatum: string
      transaktionstext: string | null
      belopp_skatteverket: number
    }>
  }
}

/**
 * Shared dialog for linking a skattekonto_transactions row to an existing
 * journal entry. Used by both /skattekonto and /transactions so we don't
 * have two copies of the same dialog drifting apart.
 *
 * The dialog owns its own data fetch: pass the row + open flag and it
 * handles the rest. On successful match it calls onMatched(), letting the
 * caller refresh its data.
 */
export function SkattekontoMatchDialog({
  row,
  open,
  onClose,
  onMatched,
}: {
  row: StoredSkattekontoTransaction | null
  open: boolean
  onClose: () => void
  onMatched: () => void
}) {
  const t = useTranslations('tx_skattekonto_match')
  const { toast } = useToast()
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !row) {
      setCandidates(null)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/extensions/ext/skatteverket/skattekonto/transaktioner/${row.id}/match-candidates`,
        )
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) {
          // Map the parsed body plus the status, never `new Error(json.error)`:
          // the Error constructor stringifies a non-string body field, and the
          // mapper would discard the route's own Swedish reason.
          toast({
            title: t('fetch_candidates_failed_title'),
            description: getUserErrorMessage(json, { statusCode: res.status }),
            variant: 'destructive',
          })
          onClose()
          return
        }
        setCandidates(json.data.candidates as MatchCandidate[])
      } catch (err) {
        if (cancelled) return
        toast({
          title: t('fetch_candidates_failed_title'),
          description: err instanceof Error ? getUserErrorMessage(err) : undefined,
          variant: 'destructive',
        })
        onClose()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, row, toast, onClose, t])

  async function confirmMatch(candidate: MatchCandidate) {
    if (!row) return
    const journalEntryId = candidate.journal_entry_id
    setSubmittingId(journalEntryId)
    try {
      const res = await fetch(
        `/api/extensions/ext/skatteverket/skattekonto/transaktioner/${row.id}/match`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            journal_entry_id: journalEntryId,
            ...(candidate.group ? { transaction_ids: candidate.group.link_transaction_ids } : {}),
          }),
        },
      )
      const json = await res.json()
      if (!res.ok) {
        toast({
          title: t('match_failed_title'),
          description: getUserErrorMessage(json, { statusCode: res.status }),
          variant: 'destructive',
        })
        return
      }
      const linkedCount = candidate.group?.mode === 'new' ? candidate.group.link_transaction_ids.length : 1
      toast({
        title: linkedCount > 1 ? t('match_group_success_title', { count: linkedCount }) : t('match_success_title'),
      })
      onMatched()
      onClose()
    } catch (err) {
      toast({
        title: t('match_failed_title'),
        description: err instanceof Error ? getUserErrorMessage(err) : undefined,
        variant: 'destructive',
      })
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          {/* data-ph-mask: transaction text and amount are user data */}
          <DialogDescription data-ph-mask="">
            {row && (
              <>
                {formatDate(row.transaktionsdatum)} • {row.transaktionstext} •{' '}
                <span className="tabular-nums">
                  {formatCurrency(Number(row.belopp_skatteverket))}
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('searching')}
          </p>
        )}

        {!loading && candidates && candidates.length === 0 && (
          <div className="space-y-2 py-4 text-sm">
            <p>{t('no_candidates_title')}</p>
            <p className="text-muted-foreground">
              {t.rich('no_candidates_help', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          </div>
        )}

        {!loading && candidates && candidates.length > 0 && (
          <div className="max-h-[420px] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('th_date')}</TableHead>
                  <TableHead>{t('th_voucher')}</TableHead>
                  <TableHead>{t('th_description')}</TableHead>
                  <TableHead>{t('th_status')}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map(c => (
                  <TableRow key={c.journal_entry_id}>
                    <TableCell className="tabular-nums">{formatDate(c.entry_date)}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatVoucher(c)}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <div className="truncate">{c.description}</div>
                      {c.group && (
                        /* data-ph-mask: sibling texts and amounts are user data */
                        <div className="mt-1 space-y-0.5 text-xs text-muted-foreground" data-ph-mask="">
                          <div>
                            {c.group.mode === 'new' ? t('group_together_with') : t('group_completes')}
                          </div>
                          {c.group.group_rows.map(g => (
                            <div key={g.id} className="truncate tabular-nums">
                              {g.transaktionstext} {formatCurrency(g.belopp_skatteverket)}
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.status === 'posted' ? (
                        <Badge variant="secondary">{t('status_posted')}</Badge>
                      ) : c.status === 'draft' ? (
                        <Badge variant="outline">{t('status_draft')}</Badge>
                      ) : (
                        <Badge variant="destructive">{t('status_reversed')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => confirmMatch(c)}
                        disabled={submittingId === c.journal_entry_id}
                      >
                        {submittingId === c.journal_entry_id ? t('linking') : t('link')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
