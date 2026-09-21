-- Asset register and ledger cannot drift apart (issue #2779).
--
-- The anläggningsregister is sidoordnad bokföring (BFL 5 kap. 4 §, BFNAR
-- 2013:2 kap. 4). A depreciation_schedules row with a journal_entry_id is the
-- register's record that a planenlig avskrivning reached the books, and
-- ackumulerade avskrivningar (punkt 4.5) is read from those rows. Two gaps
-- let the register lose that record while the voucher stayed posted; both
-- were reproduced on the schema before this migration:
--
--   1. assets -> depreciation_schedules is ON DELETE CASCADE, and nothing at
--      the database level refused deleting a row that points at a verifikat.
--      The depreciation_schedules_delete RLS policy (journal_entry_id IS
--      NULL) does not apply to a cascade, which runs as table owner, nor to
--      the service role. `DELETE FROM assets` on an asset with a posted row
--      removed the row and left the posted voucher with no register row.
--   2. commitAnnualPostings() committed the voucher and wrote the schedule
--      link in two statements. In between there was no posted row to see,
--      guard or lock, and the link UPDATE could match zero rows silently.
--
-- What this migration does:
--
--   * block_posted_depreciation_schedule_delete: BEFORE DELETE guard on rows
--     with journal_entry_id IS NOT NULL. It fires for the cascade too, so the
--     invariant no longer depends on any caller checking first.
--   * commit_asset_depreciation: voucher commit and register link in one
--     transaction under the asset row lock, in the shape of
--     commit_asset_disposal (20260803226000). Voucher numbering is delegated
--     to commit_journal_entry, so there is still exactly one numbering path.
--   * delete_never_posted_asset: the "never reached the books" rule decided
--     under the SAME asset row lock, so post-versus-delete serialises.
--   * delete_last_voucher: returns the schedule row to unposted when the
--     voucher it points at is lawfully deleted (see section 4).
--
-- Bypass: the guard honours the transaction-local gnubok.allow_delete flag,
-- the same convention enforce_retention_journal_entries and
-- enforce_document_metadata_immutability use. A sweep of every function in
-- `public` on a database with all migrations applied found NO function that
-- deletes from assets or depreciation_schedules: rows only ever leave through
-- the asset delete above or an FK cascade from companies / auth.users. The
-- functions that delete journal_entries (delete_last_voucher,
-- undo_sie_import, replace_sie_import, reset_fiscal_year,
-- cleanup_sandbox_user) are stopped by the RESTRICT foreign key on
-- journal_entry_id before any schedule row is touched, so this guard changes
-- none of them. reset_fiscal_year relies on that refusal by design
-- (FISCAL_YEAR_RESET_LINKED_ENTRIES), which is why the foreign key stays
-- RESTRICT instead of becoming SET NULL.
--
-- Existing data: a BEFORE DELETE trigger constrains no existing row, so there
-- is nothing to validate and nothing to backfill.
--
-- pg-test: tests/pg/asset-depreciation-atomic.pg.test.ts

-- =============================================================================
-- 1. A posted schedule row cannot be deleted
-- =============================================================================

CREATE OR REPLACE FUNCTION public.block_posted_depreciation_schedule_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  -- Unposted proposals are free to go, and never pay for the flag lookup.
  IF OLD.journal_entry_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- Tenant teardown removes the row together with the verifikat it points at.
  IF current_setting('gnubok.allow_delete', true) = 'true' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Cannot delete a posted depreciation schedule (id=%): it is linked to journal entry %',
    OLD.id, OLD.journal_entry_id
    USING ERRCODE = '23514',
          HINT = 'Reverse the depreciation voucher or dispose the asset. The register row is räkenskapsinformation (BFL 7 kap.).';
END;
$function$;

DROP TRIGGER IF EXISTS block_posted_depreciation_schedule_delete ON public.depreciation_schedules;
CREATE TRIGGER block_posted_depreciation_schedule_delete
  BEFORE DELETE ON public.depreciation_schedules
  FOR EACH ROW EXECUTE FUNCTION public.block_posted_depreciation_schedule_delete();

-- =============================================================================
-- 2. The one lawful way back to unposted
-- =============================================================================
--
-- Body otherwise identical to 20260516120000. Inside the gnubok.allow_delete
-- window exactly ONE transition is admitted on a posted row: the full unlink
-- (journal_entry_id and posted_at both to NULL, nothing else changed). The
-- flag does not make a posted row editable: planned_depreciation, asset_id
-- and fiscal_period_id stay frozen even inside the window.

CREATE OR REPLACE FUNCTION public.enforce_depreciation_schedule_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF OLD.journal_entry_id IS NOT NULL THEN
    IF current_setting('gnubok.allow_delete', true) = 'true'
       AND NEW.journal_entry_id IS NULL
       AND NEW.posted_at IS NULL
       AND NEW.planned_depreciation IS NOT DISTINCT FROM OLD.planned_depreciation
       AND NEW.asset_id           IS NOT DISTINCT FROM OLD.asset_id
       AND NEW.fiscal_period_id   IS NOT DISTINCT FROM OLD.fiscal_period_id THEN
      RETURN NEW;
    END IF;

    IF NEW.planned_depreciation IS DISTINCT FROM OLD.planned_depreciation
       OR NEW.asset_id           IS DISTINCT FROM OLD.asset_id
       OR NEW.fiscal_period_id   IS DISTINCT FROM OLD.fiscal_period_id
       OR NEW.journal_entry_id   IS DISTINCT FROM OLD.journal_entry_id THEN
      RAISE EXCEPTION 'Cannot modify a posted depreciation schedule (id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- =============================================================================
-- 3. commit_asset_depreciation: voucher and register link in one transaction
-- =============================================================================

CREATE OR REPLACE FUNCTION public.commit_asset_depreciation(
  p_company_id uuid,
  p_asset_id uuid,
  p_entry_id uuid,
  p_fiscal_period_id uuid,
  p_planned_depreciation numeric,
  p_actor_type text DEFAULT NULL,
  p_actor_label text DEFAULT NULL
)
RETURNS TABLE(voucher_number integer, schedule_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_asset_user_id uuid;
  v_entry_user_id uuid;
  v_draft_debit numeric;
  v_schedule_id uuid;
  v_schedule_entry_id uuid;
  v_voucher_number integer;
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
BEGIN
  -- Same NULL-safe membership guard as commit_asset_disposal.
  IF v_jwt_role IN ('anon', 'authenticated')
     AND (
       NOT public.caller_is_company_member(p_company_id)
       OR NOT public.current_user_can_write()
     ) THEN
    RAISE EXCEPTION 'unauthorized asset depreciation for company %', p_company_id
      USING ERRCODE = '42501';
  END IF;

  IF p_planned_depreciation IS NULL OR p_planned_depreciation <= 0 THEN
    RAISE EXCEPTION 'Planned depreciation must be positive'
      USING ERRCODE = '23514';
  END IF;

  -- The asset row lock is what post-versus-delete serialises on:
  -- delete_never_posted_asset takes the same lock before it decides. A
  -- delete that won the race leaves no row here, and no voucher is posted.
  SELECT a.user_id
    INTO v_asset_user_id
    FROM public.assets a
   WHERE a.id = p_asset_id
     AND a.company_id = p_company_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found: %', p_asset_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Pin what this RPC can post: a year_end draft of this company and period.
  SELECT je.user_id
    INTO v_entry_user_id
    FROM public.journal_entries je
   WHERE je.id = p_entry_id
     AND je.company_id = p_company_id
     AND je.fiscal_period_id = p_fiscal_period_id
     AND je.status = 'draft'
     AND je.source_type = 'year_end'
   FOR UPDATE;

  -- 22023, not P0002: a missing ASSET is an expected outcome of a concurrent
  -- delete that the caller skips, while a bad draft is a caller bug. Distinct
  -- SQLSTATEs let the engine tell them apart without parsing message text.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valid depreciation draft not found: %', p_entry_id
      USING ERRCODE = '22023';
  END IF;

  -- The RPC is independently callable, so the amount the register records
  -- must be the amount the voucher books, not whatever the caller passes.
  SELECT coalesce(sum(l.debit_amount), 0)
    INTO v_draft_debit
    FROM public.journal_entry_lines l
   WHERE l.journal_entry_id = p_entry_id;

  IF abs(v_draft_debit - p_planned_depreciation) > 0.005 THEN
    RAISE EXCEPTION 'Planned depreciation % does not match the draft voucher total %',
      p_planned_depreciation, v_draft_debit
      USING ERRCODE = '23514';
  END IF;

  SELECT ds.id, ds.journal_entry_id
    INTO v_schedule_id, v_schedule_entry_id
    FROM public.depreciation_schedules ds
   WHERE ds.asset_id = p_asset_id
     AND ds.fiscal_period_id = p_fiscal_period_id
   FOR UPDATE;

  -- unique_violation on purpose: it IS the (asset_id, fiscal_period_id)
  -- invariant, met one step earlier than the constraint would meet it.
  IF FOUND AND v_schedule_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'Depreciation is already posted for asset % in this fiscal period', p_asset_id
      USING ERRCODE = '23505';
  END IF;

  -- Voucher first, link second: the order the old two-statement code used,
  -- now inside one transaction, so a failure at the link step takes the
  -- voucher commit (and its sequence increment) down with it.
  SELECT committed.voucher_number
    INTO v_voucher_number
    FROM public.commit_journal_entry(
      p_company_id,
      p_entry_id,
      NULL,
      NULL,
      p_actor_type,
      p_actor_label
    ) AS committed;

  IF v_schedule_id IS NOT NULL THEN
    UPDATE public.depreciation_schedules
       SET planned_depreciation = p_planned_depreciation,
           journal_entry_id = p_entry_id,
           posted_at = now()
     WHERE id = v_schedule_id;
  ELSE
    INSERT INTO public.depreciation_schedules (
      user_id,
      company_id,
      asset_id,
      fiscal_period_id,
      planned_depreciation,
      journal_entry_id,
      posted_at
    ) VALUES (
      coalesce(v_entry_user_id, v_asset_user_id),
      p_company_id,
      p_asset_id,
      p_fiscal_period_id,
      p_planned_depreciation,
      p_entry_id,
      now()
    )
    RETURNING id INTO v_schedule_id;
  END IF;

  RETURN QUERY SELECT v_voucher_number, v_schedule_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_asset_depreciation(
  uuid, uuid, uuid, uuid, numeric, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.commit_asset_depreciation(
  uuid, uuid, uuid, uuid, numeric, text, text
) TO authenticated, service_role;

COMMENT ON FUNCTION public.commit_asset_depreciation(
  uuid, uuid, uuid, uuid, numeric, text, text
) IS 'Atomically posts a planenlig avskrivning voucher and links its depreciation_schedules row, under the asset row lock. Voucher numbering is delegated to commit_journal_entry.';

-- =============================================================================
-- 3b. delete_never_posted_asset: the rule decided under the same lock
-- =============================================================================
--
-- SECURITY INVOKER on purpose: the delete keeps running as the caller, so the
-- assets_delete / depreciation_schedules_delete RLS policies and the
-- company-writer-role trigger apply exactly as they did when this was two
-- PostgREST statements. Expected outcomes are returned, not raised: nothing
-- has been written when the answer is a refusal.

CREATE OR REPLACE FUNCTION public.delete_never_posted_asset(
  p_company_id uuid,
  p_asset_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_disposed_at date;
  v_disposal_entry_id uuid;
BEGIN
  SELECT a.disposed_at, a.disposal_journal_entry_id
    INTO v_disposed_at, v_disposal_entry_id
    FROM public.assets a
   WHERE a.id = p_asset_id
     AND a.company_id = p_company_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_disposed_at IS NOT NULL OR v_disposal_entry_id IS NOT NULL THEN
    RETURN 'disposed';
  END IF;

  -- Read AFTER the lock is held. A posting that was in flight has committed
  -- by now and its link is visible; one that starts later waits on the lock.
  IF EXISTS (
    SELECT 1
      FROM public.depreciation_schedules ds
     WHERE ds.company_id = p_company_id
       AND ds.asset_id = p_asset_id
       AND ds.journal_entry_id IS NOT NULL
  ) THEN
    RETURN 'depreciation_posted';
  END IF;

  DELETE FROM public.depreciation_schedules ds
   WHERE ds.company_id = p_company_id
     AND ds.asset_id = p_asset_id
     AND ds.journal_entry_id IS NULL;

  DELETE FROM public.assets a
   WHERE a.id = p_asset_id
     AND a.company_id = p_company_id;

  RETURN 'deleted';
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_never_posted_asset(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_never_posted_asset(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.delete_never_posted_asset(uuid, uuid)
  IS 'Deletes an asset that never reached the books, deciding under the asset row lock so it serialises with commit_asset_depreciation and commit_asset_disposal. Returns deleted, not_found, disposed or depreciation_posted.';

-- =============================================================================
-- 4. delete_last_voucher: a deleted depreciation voucher unposts its row
-- =============================================================================
--
-- Before this migration, deleting a last-in-series voucher that was a
-- planenlig avskrivning died on depreciation_schedules_journal_entry_id_fkey
-- (ON DELETE RESTRICT) with a raw foreign-key error: the lawful undo was
-- blocked. The register must end up truthful instead: the voucher is gone, so
-- the row goes back to being an unposted proposal (journal_entry_id and
-- posted_at NULL, amount kept), the period is proposed again, and the asset
-- counts as never having reached the books if that was its only posting.
--
-- BUILDS ON 20260920190000 AND MUST APPLY AFTER IT. That migration (PR #2821)
-- made delete_last_voucher find the registers hanging on a verifikat by FK and
-- revert them inside the delete's transaction: refusals first, mutations
-- after, one 'register_effects' key in the audit snapshot. A
-- depreciation_schedules row is one more such register, so this function is
-- 20260920190000's text verbatim with four additions in that structure.
-- Verified by diff against 20260920190000's function: 0 lines removed or
-- changed, 53 added. Both migrations CREATE OR REPLACE the same function, so
-- whichever applies last wins: version order (190000, then 190200) is what
-- keeps both changes. Do not renumber either file.
--
--   1. Refusal, with the others and before any mutation: an avskrivning may
--      not be pulled out from under a DISPOSED asset, whose gain or loss was
--      computed on it. Checked under the asset row lock that
--      commit_asset_disposal takes. This also gives the disposal voucher
--      itself (it carries the disposal-date avskrivning) a named reason
--      instead of a raw assets_disposal_journal_entry_id_fkey error.
--   2. Snapshot: the rows as they were when posted join 'register_effects' as
--      'unposted_depreciation_schedules' (always present, [] when none): one
--      snapshot shape, not two. The description text is untouched.
--   3. Revert: beside the document_attachments unlink, inside the allow_delete
--      window the function already opens. The window is NOT opened earlier
--      for this, so no other statement runs with the flag that did not before.
--      It is the single transition section 2 admits.
--
-- A refusal that fires late (a RESTRICT foreign key at the final DELETE)
-- raises, and the exception rolls back every revert above it.

CREATE OR REPLACE FUNCTION public.delete_last_voucher(p_company_id uuid, p_entry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entry            record;
  v_period           record;
  v_max_voucher      integer;
  v_ref_count        integer;
  v_caller_role      text;
  v_snapshot         jsonb;
  v_lines_snapshot   jsonb;
  v_is_period_ib     boolean := false;
  v_claim_ids        uuid[];
  v_removed_payments jsonb := '[]'::jsonb;
  v_touched_invoices uuid[];
  v_register_effects jsonb := '{}'::jsonb;
  v_unposted_schedules jsonb;
BEGIN
  SELECT cm.role INTO v_caller_role
  FROM company_members cm
  WHERE cm.company_id = p_company_id
    AND cm.user_id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only company owners and admins can delete vouchers';
  END IF;

  SELECT * INTO v_entry
  FROM journal_entries
  WHERE id = p_entry_id
    AND company_id = p_company_id
  FOR UPDATE;

  IF v_entry IS NULL THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;

  IF v_entry.status NOT IN ('posted', 'draft') THEN
    RAISE EXCEPTION 'Only posted or draft entries can be deleted (current status: %)', v_entry.status;
  END IF;

  SELECT jsonb_agg(to_jsonb(l)) INTO v_lines_snapshot
  FROM journal_entry_lines l
  WHERE l.journal_entry_id = p_entry_id;

  v_snapshot := to_jsonb(v_entry) || jsonb_build_object('lines', COALESCE(v_lines_snapshot, '[]'::jsonb));

  IF v_entry.status = 'draft' THEN
    PERFORM set_config('gnubok.allow_delete', 'true', true);

    UPDATE document_attachments
    SET journal_entry_id = NULL
    WHERE journal_entry_id = p_entry_id;

    DELETE FROM journal_entries WHERE id = p_entry_id;

    INSERT INTO audit_log (user_id, company_id, action, table_name, record_id, actor_id, old_state, description)
    VALUES (
      v_entry.user_id,
      p_company_id,
      'DELETE',
      'journal_entries',
      p_entry_id,
      auth.uid(),
      v_snapshot,
      'Deleted draft journal entry (delete_last_voucher RPC, caller: ' || auth.uid() || ')'
    );

    RETURN jsonb_build_object(
      'deleted', true,
      'voucher_series', v_entry.voucher_series,
      'voucher_number', v_entry.voucher_number,
      'was_draft', true
    );
  END IF;

  SELECT * INTO v_period
  FROM fiscal_periods
  WHERE id = v_entry.fiscal_period_id
  FOR UPDATE;

  IF v_period.is_closed THEN
    RAISE EXCEPTION 'Cannot delete voucher in a closed fiscal period';
  END IF;

  IF v_period.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot delete voucher in a locked fiscal period';
  END IF;

  PERFORM 1 FROM voucher_sequences
  WHERE company_id = p_company_id
    AND fiscal_period_id = v_entry.fiscal_period_id
    AND voucher_series = v_entry.voucher_series
  FOR UPDATE;

  SELECT MAX(voucher_number) INTO v_max_voucher
  FROM journal_entries
  WHERE company_id = p_company_id
    AND fiscal_period_id = v_entry.fiscal_period_id
    AND voucher_series = v_entry.voucher_series
    AND status NOT IN ('cancelled', 'draft');

  IF v_entry.voucher_number != v_max_voucher THEN
    RAISE EXCEPTION 'Kan bara radera det sista verifikatet i serien. % har nummer % men senaste är %',
      v_entry.voucher_series, v_entry.voucher_number, v_max_voucher;
  END IF;

  SELECT COUNT(*) INTO v_ref_count
  FROM journal_entries
  WHERE company_id = p_company_id
    AND status != 'cancelled'
    AND (reverses_id = p_entry_id OR correction_of_id = p_entry_id);

  IF v_ref_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete: other entries reference this voucher (% references)',
      v_ref_count;
  END IF;

  -- ===== Registers that hang on this verifikat (see the file header) =====
  -- Refusals first, mutations after: nothing below may change a row before
  -- every reason to refuse the whole delete has been checked.

  -- Utlagg, by the forward FK and by the entry's own source link (covers a
  -- failed back-link write). Locked: create_expense_payout_batch and
  -- settle_expense_claims_via_salary_run lock the same rows, so payout state
  -- cannot appear between this check and the delete.
  SELECT array_agg(c.id) INTO v_claim_ids
  FROM (
    SELECT ec.id
    FROM expense_claims ec
    WHERE ec.company_id = p_company_id
      AND (
        ec.journal_entry_id = p_entry_id
        OR (v_entry.source_type = 'expense_claim' AND ec.id = v_entry.source_id)
      )
    FOR UPDATE
  ) c;

  IF v_claim_ids IS NOT NULL THEN
    -- Money that has moved outranks the delete. Refuse here, while the
    -- verifikat still exists, instead of leaving a paid claim without one.
    IF EXISTS (
      SELECT 1 FROM expense_claims ec
      WHERE ec.id = ANY (v_claim_ids)
        AND (ec.status = 'paid' OR ec.payout_batch_id IS NOT NULL)
    ) THEN
      RAISE EXCEPTION 'Verifikatet kan inte raderas: utlägget är redan utbetalt eller ligger i en utbetalning. Ångra utbetalningen först.';
    END IF;

    -- Any payslip line, draft included: deleting a verifikat is not a request
    -- to change a salary run. The register's own delete handles a draft line.
    IF EXISTS (
      SELECT 1 FROM salary_line_items sli
      WHERE sli.source_expense_claim_id = ANY (v_claim_ids)
    ) THEN
      RAISE EXCEPTION 'Verifikatet kan inte raderas: utlägget ligger på ett lönebesked. Ta bort raden från lönebeskedet först.';
    END IF;
  END IF;

  -- #2779: planenlig avskrivning posted by this verifikat. Its register row
  -- (depreciation_schedules) is one more register hanging on the verifikat by
  -- FK. The refusal sits here with the others; the revert runs further down,
  -- inside the allow_delete window. The asset row lock is the one
  -- commit_asset_disposal and commit_asset_depreciation take, so a disposal
  -- cannot land between this check and the delete.
  PERFORM 1
  FROM assets a
  WHERE a.company_id = p_company_id
    AND a.id IN (
      SELECT ds.asset_id
      FROM depreciation_schedules ds
      WHERE ds.company_id = p_company_id
        AND ds.journal_entry_id = p_entry_id
    )
  FOR UPDATE;

  -- A disposal's gain or loss was computed on the depreciation posted up to
  -- it, so an avskrivning may not be pulled out from under a disposed asset.
  -- This also names the reason for the disposal voucher itself, which carries
  -- the disposal-date avskrivning and would otherwise die on a raw FK error.
  IF EXISTS (
    SELECT 1
    FROM depreciation_schedules ds
    JOIN assets a ON a.id = ds.asset_id
    WHERE ds.company_id = p_company_id
      AND ds.journal_entry_id = p_entry_id
      AND (a.disposed_at IS NOT NULL OR a.disposal_journal_entry_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Verifikatet kan inte raderas: det bokför avskrivning på en tillgång som är avyttrad. Gör en rättelse (storno) i stället.';
  END IF;

  -- Supplier payment rows on this entry, by FK. Removed by id and kept whole
  -- in the snapshot: the table has no audit trigger of its own.
  WITH removed AS (
    DELETE FROM supplier_invoice_payments sip
    WHERE sip.company_id = p_company_id
      AND sip.journal_entry_id = p_entry_id
    RETURNING sip.*
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_removed_payments
  FROM removed r;

  -- Revert each invoice by exactly its removed share. An invoice whose
  -- payment verifikat this is but that has no payment row (cash payment:
  -- always a full payment) is reverted in full, as the TS sync does.
  WITH share AS (
    SELECT (p ->> 'supplier_invoice_id')::uuid AS invoice_id,
           SUM((p ->> 'amount')::numeric)      AS amount
    FROM jsonb_array_elements(v_removed_payments) p
    GROUP BY 1
  ),
  target AS (
    SELECT si.id,
           GREATEST(ROUND(si.paid_amount - COALESCE(s.amount, si.paid_amount), 2), 0) AS new_paid
    FROM supplier_invoices si
    LEFT JOIN share s ON s.invoice_id = si.id
    WHERE si.company_id = p_company_id
      AND (s.invoice_id IS NOT NULL OR si.payment_journal_entry_id = p_entry_id)
    FOR UPDATE OF si
  ),
  reverted AS (
    UPDATE supplier_invoices si
    SET paid_amount      = t.new_paid,
        remaining_amount = ROUND(si.total - t.new_paid, 2),
        -- Back to what the row's own facts say. 'approved' only if someone
        -- attested it: a privately paid invoice is inserted as 'paid' and was
        -- never approved, so claiming 'approved' would invent an attest.
        status = CASE
          WHEN t.new_paid > 0 THEN 'partially_paid'
          WHEN si.due_date IS NOT NULL AND si.due_date < CURRENT_DATE THEN 'overdue'
          WHEN si.approved_at IS NOT NULL THEN 'approved'
          ELSE 'registered'
        END,
        paid_at = CASE WHEN t.new_paid > 0 THEN si.paid_at ELSE NULL END,
        payment_journal_entry_id = CASE
          WHEN si.payment_journal_entry_id = p_entry_id THEN NULL
          ELSE si.payment_journal_entry_id
        END,
        -- "Paid with private funds" describes a payment. With nothing paid
        -- it is no longer true, and the row is an ordinary unpaid invoice.
        paid_with_private_funds = CASE WHEN t.new_paid > 0 THEN si.paid_with_private_funds ELSE false END
    FROM target t
    WHERE si.id = t.id
    RETURNING si.id
  )
  SELECT array_agg(id) INTO v_touched_invoices FROM reverted;

  -- Release the bank lines: the pointer FK clears itself on delete, but
  -- supplier_invoice_id / category / is_business do not, and they keep the
  -- line out of the inbox. Only lines tied to this entry or its payment rows.
  UPDATE transactions t
  SET journal_entry_id    = NULL,
      supplier_invoice_id = NULL,
      is_business         = NULL,
      category            = NULL
  WHERE t.company_id = p_company_id
    AND v_touched_invoices IS NOT NULL
    AND t.supplier_invoice_id = ANY (v_touched_invoices)
    AND (
      t.journal_entry_id = p_entry_id
      OR t.id IN (
        SELECT (p ->> 'transaction_id')::uuid
        FROM jsonb_array_elements(v_removed_payments) p
        WHERE p ->> 'transaction_id' IS NOT NULL
      )
    );

  -- Eligibility was settled above, under lock. salary_line_items is
  -- ON DELETE RESTRICT, so a line that appeared anyway still refuses here.
  IF v_claim_ids IS NOT NULL THEN
    DELETE FROM expense_claims ec
    WHERE ec.company_id = p_company_id
      AND ec.id = ANY (v_claim_ids);
  END IF;

  v_register_effects := jsonb_build_object(
    'removed_expense_claim_ids',       COALESCE(to_jsonb(v_claim_ids), '[]'::jsonb),
    'removed_supplier_payments',       v_removed_payments,
    'reverted_supplier_invoice_ids',   COALESCE(to_jsonb(v_touched_invoices), '[]'::jsonb)
  );

  -- #2779: the rows as they were when posted. Once unlinked, nothing else
  -- records which register row this verifikat had been linked to.
  SELECT jsonb_agg(to_jsonb(ds)) INTO v_unposted_schedules
  FROM depreciation_schedules ds
  WHERE ds.company_id = p_company_id
    AND ds.journal_entry_id = p_entry_id;

  v_register_effects := v_register_effects || jsonb_build_object(
    'unposted_depreciation_schedules', COALESCE(v_unposted_schedules, '[]'::jsonb)
  );
  v_snapshot := v_snapshot || jsonb_build_object('register_effects', v_register_effects);

  IF v_entry.reverses_id IS NOT NULL THEN
    PERFORM set_config('gnubok.allow_delete', 'true', true);
    UPDATE journal_entries
    SET status = 'posted', reversed_by_id = NULL
    WHERE id = v_entry.reverses_id
      AND company_id = p_company_id;
  END IF;

  -- #2364: a correction carries the bank anchors correctEntry moved off the
  -- original. Return them before the FKs drop them with the row (pointer:
  -- ON DELETE SET NULL, junction: ON DELETE CASCADE), so the original, once
  -- its storno is deleted too, still explains its bank rows.
  IF v_entry.correction_of_id IS NOT NULL THEN
    UPDATE transactions
    SET journal_entry_id = v_entry.correction_of_id
    WHERE company_id = p_company_id
      AND journal_entry_id = p_entry_id;

    DELETE FROM transaction_voucher_links l
    WHERE l.company_id = p_company_id
      AND l.journal_entry_id = p_entry_id
      AND EXISTS (
        SELECT 1 FROM transaction_voucher_links x
        WHERE x.transaction_id = l.transaction_id
          AND x.journal_entry_id = v_entry.correction_of_id
      );

    UPDATE transaction_voucher_links
    SET journal_entry_id = v_entry.correction_of_id
    WHERE company_id = p_company_id
      AND journal_entry_id = p_entry_id;
  END IF;

  v_is_period_ib := (v_period.opening_balance_entry_id = p_entry_id);
  IF v_is_period_ib THEN
    UPDATE fiscal_periods
    SET opening_balances_set = false
    WHERE id = v_entry.fiscal_period_id;

    UPDATE fiscal_periods
    SET opening_balance_entry_id = NULL
    WHERE id = v_entry.fiscal_period_id;
  END IF;

  UPDATE sie_imports
  SET opening_balance_entry_id = NULL
  WHERE opening_balance_entry_id = p_entry_id;

  PERFORM set_config('gnubok.allow_delete', 'true', true);

  UPDATE document_attachments
  SET journal_entry_id = NULL
  WHERE journal_entry_id = p_entry_id;

  -- #2779: the avskrivning is no longer on the books, so its register row
  -- goes back to an unposted proposal (amount kept). This is the single
  -- transition enforce_depreciation_schedule_immutability admits, and only
  -- inside this window.
  UPDATE depreciation_schedules
  SET journal_entry_id = NULL, posted_at = NULL
  WHERE company_id = p_company_id
    AND journal_entry_id = p_entry_id;

  DELETE FROM journal_entries WHERE id = p_entry_id;

  UPDATE voucher_sequences
  SET last_number = GREATEST(last_number - 1, 0)
  WHERE company_id = p_company_id
    AND fiscal_period_id = v_entry.fiscal_period_id
    AND voucher_series = v_entry.voucher_series;

  INSERT INTO audit_log (user_id, company_id, action, table_name, record_id, actor_id, old_state, description)
  VALUES (
    v_entry.user_id,
    p_company_id,
    'DELETE',
    'journal_entries',
    p_entry_id,
    auth.uid(),
    v_snapshot,
    'Deleted voucher ' || v_entry.voucher_series || v_entry.voucher_number ||
    CASE WHEN v_is_period_ib THEN ' (was period IB)' ELSE '' END ||
    ' (delete_last_voucher RPC, caller: ' || auth.uid() || ')'
  );

  RETURN jsonb_build_object(
    'deleted', true,
    'voucher_series', v_entry.voucher_series,
    'voucher_number', v_entry.voucher_number,
    'was_period_ib', v_is_period_ib
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';
