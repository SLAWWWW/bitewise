/**
 * The ONE derivation of a FLO's agreement status at instant T, shared by the FLO directory
 * (src/application/flo/queries.ts) and the Ringkasan dashboard
 * (src/application/dashboard/queries.ts) so both screens always give the same label and
 * count for the same FLO (PRD §16; SC06/AC17 revocation must read REVOKED everywhere).
 *
 * `floAgreementLaterals(f, t)` adds four LEFT JOIN LATERALs to a query over
 * `lumbung.flos <f>` (both identifiers are SQL fragments, never user input):
 *   cur    the APPROVED agreement in force at t (agreement_status = 'ACTIVE'; capped by an
 *          approved successor per migration 0015), latest valid_from first, then id —
 *          the same pick as lumbung.agreement_valid_at_for
 *   sch    the earliest APPROVED agreement starting after t
 *   lastd  the latest started APPROVED|REVOKED record (by effective end)
 *   pend   number of PENDING_VERIFICATION uploads
 * and FLO_AGREEMENT_STATUS_CASE maps them to
 *   ACTIVE | EXPIRING_SOON | SCHEDULED | REVOKED | EXPIRED | PENDING | NONE.
 */
export function floAgreementLaterals(f: string, t: string): string {
  return `
      LEFT JOIN LATERAL (
        SELECT a.id, a.version, a.valid_from_date, a.valid_through_date, a.valid_until_exclusive,
               lumbung.agreement_is_expiring_soon(a, ${t}) AS expiring
          FROM lumbung.agreements a
         WHERE a.tenant_id = ${f}.tenant_id AND a.flo_id = ${f}.id AND lumbung.agreement_status(a, ${t}) = 'ACTIVE'
         ORDER BY a.valid_from DESC, a.id
         LIMIT 1) cur ON true
      LEFT JOIN LATERAL (
        SELECT a.id, a.version, a.valid_from_date, a.valid_through_date, a.valid_until_exclusive
          FROM lumbung.agreements a
         WHERE a.tenant_id = ${f}.tenant_id AND a.flo_id = ${f}.id AND a.review_state = 'APPROVED' AND a.valid_from > ${t}
         ORDER BY a.valid_from, a.id
         LIMIT 1) sch ON true
      LEFT JOIN LATERAL (
        SELECT a.id, a.version, a.review_state, a.valid_from_date, a.valid_through_date, a.valid_until_exclusive
          FROM lumbung.agreements a
         WHERE a.tenant_id = ${f}.tenant_id AND a.flo_id = ${f}.id
           AND a.review_state IN ('APPROVED', 'REVOKED') AND a.valid_from <= ${t}
         ORDER BY a.effective_until DESC, a.valid_from DESC, a.id
         LIMIT 1) lastd ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS cnt FROM lumbung.agreements a
         WHERE a.tenant_id = ${f}.tenant_id AND a.flo_id = ${f}.id AND a.review_state = 'PENDING_VERIFICATION') pend ON true`;
}

export const FLO_AGREEMENT_STATUS_CASE = `CASE
             WHEN cur.id IS NOT NULL THEN CASE WHEN cur.expiring THEN 'EXPIRING_SOON' ELSE 'ACTIVE' END
             WHEN sch.id IS NOT NULL THEN 'SCHEDULED'
             WHEN lastd.review_state = 'REVOKED' THEN 'REVOKED'
             WHEN lastd.review_state = 'APPROVED' THEN 'EXPIRED'
             WHEN pend.cnt > 0 THEN 'PENDING'
             ELSE 'NONE'
           END`;
