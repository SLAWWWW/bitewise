import { describe, expect, it } from 'vitest';
import {
  agreementStatus,
  agreementValidAt,
  agreementWasValidAt,
  effectiveUntil,
  lastValidDateFromDocument,
  covers,
  findApprovedOverlaps,
  floAgreementStatus,
  handoverAgreementCheck,
  intervalMatchesLocalDates,
  intervalToLocalDates,
  isExpiringSoon,
  isValidAt,
  localDatesToInterval,
  renewalDueDates,
  type AgreementLike,
} from '@/src/domain/flo/agreement-interval';
import * as statusModule from '@/src/domain/flo/agreement-status';

const T = new Date('2026-10-26T01:00:00Z'); // seed clock: Mon 2026-10-26 08:00 WIB

function agreement(
  id: string,
  review_state: AgreementLike['review_state'],
  from: string,
  through: string,
  extra: Partial<AgreementLike> = {},
): AgreementLike {
  const i = localDatesToInterval({ validFromDate: from, validThroughDate: through });
  return { id, review_state, valid_from_date: from, valid_through_date: through, ...i, ...extra };
}

describe('localDatesToInterval (AC03)', () => {
  it('maps "valid through 2026-10-31 WIB" to an exclusive end of 2026-10-31T17:00:00Z', () => {
    const i = localDatesToInterval({ validFromDate: '2025-11-01', validThroughDate: '2026-10-31' }, 'Asia/Jakarta');
    expect(i.valid_from.toISOString()).toBe('2025-10-31T17:00:00.000Z');
    expect(i.valid_until_exclusive.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('is valid 1 ms before the exclusive end and invalid exactly at it', () => {
    const i = localDatesToInterval({ validFromDate: '2025-11-01', validThroughDate: '2026-10-31' });
    expect(isValidAt(i, new Date('2026-10-31T16:59:59.999Z'))).toBe(true);
    expect(isValidAt(i, new Date('2026-10-31T17:00:00.000Z'))).toBe(false);
    expect(isValidAt(i, '2026-11-01T00:00:00+07:00')).toBe(false);
  });

  it('is start-inclusive', () => {
    const i = localDatesToInterval({ validFromDate: '2026-11-01', validThroughDate: '2026-11-30' });
    expect(isValidAt(i, new Date('2026-10-31T16:59:59.999Z'))).toBe(false);
    expect(isValidAt(i, new Date('2026-10-31T17:00:00.000Z'))).toBe(true);
    // PRD example: valid through 30 November WIB → exclusive end 1 December 00:00 WIB.
    expect(i.valid_until_exclusive.toISOString()).toBe('2026-11-30T17:00:00.000Z');
  });

  it('handles a single-day agreement and other Indonesian zones', () => {
    const wib = localDatesToInterval({ validFromDate: '2026-10-31', validThroughDate: '2026-10-31' });
    expect(wib.valid_until_exclusive.getTime() - wib.valid_from.getTime()).toBe(86_400_000);
    const wit = localDatesToInterval({ validFromDate: '2026-10-31', validThroughDate: '2026-10-31' }, 'Asia/Jayapura');
    expect(wit.valid_until_exclusive.toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });

  it('does not depend on the machine time zone (fixed-offset sanity check)', () => {
    expect(process.env.TZ).toBe('UTC');
    const i = localDatesToInterval({ validFromDate: '2026-01-01', validThroughDate: '2026-12-31' });
    // Asia/Jakarta has no DST: every local midnight is 17:00Z the previous day.
    expect(i.valid_from.getUTCHours()).toBe(17);
    expect(i.valid_until_exclusive.getUTCHours()).toBe(17);
  });

  it('rejects inverted or malformed ranges', () => {
    expect(() => localDatesToInterval({ validFromDate: '2026-11-02', validThroughDate: '2026-11-01' })).toThrow(RangeError);
    expect(() => localDatesToInterval({ validFromDate: '2026-1-2', validThroughDate: '2026-11-01' })).toThrow(RangeError);
  });

  it('round-trips through intervalToLocalDates and detects mismatches', () => {
    const range = { validFromDate: '2025-11-01', validThroughDate: '2026-10-31' };
    const i = localDatesToInterval(range);
    expect(intervalToLocalDates(i)).toEqual(range);
    expect(intervalMatchesLocalDates(i, range)).toBe(true);
    // Stored as UTC midnight instead of WIB midnight → mismatch, not silently accepted.
    const wrong = { valid_from: '2025-11-01T00:00:00Z', valid_until_exclusive: '2026-11-01T00:00:00Z' };
    expect(intervalMatchesLocalDates(wrong, range)).toBe(false);
    expect(intervalToLocalDates(wrong)).toBeNull();
  });
});

describe('agreementStatus (per agreement, SQL parity)', () => {
  const a = agreement('a', 'APPROVED', '2025-11-01', '2026-10-31');

  it('derives SCHEDULED / ACTIVE / EXPIRED for approved agreements', () => {
    expect(agreementStatus(a, '2025-10-31T16:59:59.999Z')).toBe('SCHEDULED');
    expect(agreementStatus(a, T)).toBe('ACTIVE');
    expect(agreementStatus(a, '2026-10-31T16:59:59.999Z')).toBe('ACTIVE');
    expect(agreementStatus(a, '2026-10-31T17:00:00Z')).toBe('EXPIRED');
  });

  it('passes review states through and never activates a pending renewal (AC04)', () => {
    const pending = agreement('p', 'PENDING_VERIFICATION', '2026-11-01', '2027-10-31');
    expect(agreementStatus(pending, '2026-12-01T00:00:00Z')).toBe('PENDING_VERIFICATION');
    expect(covers(pending, '2026-12-01T00:00:00Z')).toBe(false);
    expect(agreementStatus({ ...a, review_state: 'REVOKED' }, T)).toBe('REVOKED');
    expect(agreementStatus({ ...a, review_state: 'SUPERSEDED' }, T)).toBe('SUPERSEDED');
    expect(agreementStatus({ ...a, review_state: 'REJECTED' }, T)).toBe('REJECTED');
  });

  it('EXPIRING_SOON is a badge on ACTIVE with <= 30 days to the exclusive end', () => {
    const end = new Date('2026-10-31T17:00:00Z').getTime();
    expect(isExpiringSoon(a, new Date(end - 30 * 86_400_000))).toBe(true); // exactly 30 days
    expect(isExpiringSoon(a, new Date(end - 30 * 86_400_000 - 1))).toBe(false);
    expect(isExpiringSoon(a, T)).toBe(true); // F_AC03_MONTHEND at the seed clock
    expect(isExpiringSoon(a, new Date(end))).toBe(false); // EXPIRED, not a badge
  });

  it('is re-exported from agreement-status.ts', () => {
    expect(statusModule.agreementStatus).toBe(agreementStatus);
    expect(statusModule.floAgreementStatus).toBe(floAgreementStatus);
  });
});

describe('agreementValidAt / covers', () => {
  it('returns the approved agreement covering the instant (latest valid_from wins)', () => {
    const old = agreement('b-old', 'APPROVED', '2025-01-01', '2026-12-31');
    const renewed = agreement('a-new', 'APPROVED', '2026-10-01', '2027-09-30');
    expect(agreementValidAt([old, renewed], T)?.id).toBe('a-new');
    expect(agreementValidAt([old], '2027-01-01T00:00:00Z')).toBeNull();
  });

  it('ignores non-approved records', () => {
    const revoked = agreement('r', 'REVOKED', '2026-01-01', '2026-12-31', { revoked_at: T });
    expect(agreementValidAt([revoked], T)).toBeNull();
  });
});

describe('findApprovedOverlaps', () => {
  it('flags overlapping approved intervals and ignores adjacent ones', () => {
    const a = agreement('a', 'APPROVED', '2025-11-01', '2026-10-31');
    const b = agreement('b', 'APPROVED', '2026-11-01', '2027-10-31'); // adjacent: no overlap
    const c = agreement('c', 'APPROVED', '2026-10-15', '2027-01-31'); // overlaps a and b
    const p = agreement('p', 'PENDING_VERIFICATION', '2026-10-01', '2027-10-31'); // not approved
    const overlaps = findApprovedOverlaps([b, p, c, a]);
    expect(overlaps.map((o) => [o.a.id, o.b.id])).toEqual([
      ['a', 'c'],
      ['c', 'b'],
    ]);
    expect(overlaps[0].overlap_from.toISOString()).toBe('2026-10-14T17:00:00.000Z');
    expect(overlaps[0].overlap_until_exclusive.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });
});

describe('floAgreementStatus', () => {
  it('ACTIVE with EXPIRING_SOON badge for the AC03 month-end fixture', () => {
    const s = floAgreementStatus([agreement('a', 'APPROVED', '2025-11-01', '2026-10-31')], T);
    expect(s.status).toBe('ACTIVE');
    expect(s.expiring_soon).toBe(true);
    expect(s.eligibility_code).toBeNull();
    expect(s.ms_until_end).toBe(new Date('2026-10-31T17:00:00Z').getTime() - T.getTime());
  });

  it('AC04: expired + pending renewal stays ineligible after expiry', () => {
    const expired = agreement('old', 'APPROVED', '2025-10-01', '2026-10-20');
    const renewal = agreement('new', 'PENDING_VERIFICATION', '2026-10-21', '2027-10-20');
    const s = floAgreementStatus([expired, renewal], T);
    expect(s.status).toBe('EXPIRED');
    expect(s.current).toBeNull();
    expect(s.pending_renewal).toBe(true);
    expect(s.previous?.id).toBe('old');
    expect(s.eligibility_code).toBe('AGREEMENT_UNVERIFIED'); // plannable, not offerable
    // Still not valid at any later instant while the renewal is unreviewed.
    for (const t of ['2026-10-21T00:00:00Z', '2026-12-01T00:00:00Z', '2027-06-01T00:00:00Z']) {
      expect(agreementValidAt([expired, renewal], t)).toBeNull();
      expect(floAgreementStatus([expired, renewal], t).status).toBe('EXPIRED');
    }
  });

  it('AC04 boundary: pending renewal does not extend validity past the exclusive end', () => {
    const current = agreement('cur', 'APPROVED', '2025-11-01', '2026-10-31');
    const renewal = agreement('ren', 'PENDING_VERIFICATION', '2026-11-01', '2027-10-31');
    expect(floAgreementStatus([current, renewal], '2026-10-31T16:59:59.999Z').status).toBe('ACTIVE');
    const after = floAgreementStatus([current, renewal], '2026-10-31T17:00:00Z');
    expect(after.status).toBe('EXPIRED');
    expect(after.eligibility_code).toBe('AGREEMENT_UNVERIFIED');
  });

  it('SCHEDULED when only a future approved renewal exists; it does not activate early', () => {
    const expired = agreement('old', 'APPROVED', '2025-10-01', '2026-10-20');
    const future = agreement('fut', 'APPROVED', '2026-11-01', '2027-10-31');
    const s = floAgreementStatus([expired, future], T);
    expect(s.status).toBe('SCHEDULED');
    expect(s.scheduled?.id).toBe('fut');
    expect(s.eligibility_code).toBe('AGREEMENT_UNVERIFIED');
    expect(floAgreementStatus([expired, future], '2026-10-31T17:00:00Z').status).toBe('ACTIVE');
  });

  it('REVOKED when the latest started record was revoked, even with a pending renewal', () => {
    const revoked = agreement('rev', 'REVOKED', '2026-01-01', '2026-12-31', { revoked_at: T });
    const pending = agreement('pend', 'PENDING_VERIFICATION', '2027-01-01', '2027-12-31');
    const s = floAgreementStatus([revoked, pending], T);
    expect(s.status).toBe('REVOKED');
    expect(s.eligibility_code).toBe('AGREEMENT_REVOKED');
  });

  it('EXPIRED without renewal → AGREEMENT_EXPIRED; nothing → NONE; only pending → PENDING_VERIFICATION', () => {
    expect(floAgreementStatus([agreement('x', 'APPROVED', '2025-08-21', '2026-08-20')], T).eligibility_code).toBe(
      'AGREEMENT_EXPIRED',
    );
    expect(floAgreementStatus([], T).status).toBe('NONE');
    expect(floAgreementStatus([agreement('r', 'REJECTED', '2026-01-01', '2026-12-31', {})], T).status).toBe('NONE');
    const p = floAgreementStatus([agreement('p', 'PENDING_VERIFICATION', '2026-10-01', '2027-09-30')], T);
    expect(p.status).toBe('PENDING_VERIFICATION');
    expect(p.eligibility_code).toBe('AGREEMENT_UNVERIFIED');
  });

  it('ignores superseded versions and reports overlaps', () => {
    const sup = agreement('s', 'SUPERSEDED', '2024-11-01', '2026-12-31');
    const a = agreement('a', 'APPROVED', '2025-11-01', '2026-12-31');
    const b = agreement('b', 'APPROVED', '2026-12-01', '2027-11-30');
    const s = floAgreementStatus([sup, a, b], T);
    expect(s.current?.id).toBe('a');
    expect(s.overlaps).toHaveLength(1);
  });
});

describe('handoverAgreementCheck', () => {
  const current = agreement('cur', 'APPROVED', '2025-11-01', '2026-10-31');

  it('requires validity now and at the planned handover', () => {
    expect(handoverAgreementCheck([current], T, '2026-10-31T16:59:59.999Z')).toBeNull();
    expect(handoverAgreementCheck([current], T, '2026-10-31T17:00:00Z')).toBe('AGREEMENT_EXPIRED');
  });

  it('a pending renewal makes a post-expiry handover plannable but not covered', () => {
    const pending = agreement('ren', 'PENDING_VERIFICATION', '2026-11-01', '2027-10-31');
    expect(handoverAgreementCheck([current, pending], T, '2026-11-02T03:00:00Z')).toBe('AGREEMENT_UNVERIFIED');
  });

  it('an approved scheduled renewal covers a post-expiry handover', () => {
    const renewed = agreement('ren', 'APPROVED', '2026-11-01', '2027-10-31');
    expect(handoverAgreementCheck([current, renewed], T, '2026-11-02T03:00:00Z')).toBeNull();
  });
});

describe('renewalDueDates', () => {
  it('creates 30/14/7-day reminders before the exclusive end, at local midnight', () => {
    const due = renewalDueDates(new Date('2026-10-31T17:00:00Z'));
    expect(due.map((d) => [d.offset_days, d.due_at.toISOString()])).toEqual([
      [30, '2026-10-01T17:00:00.000Z'], // 2026-10-02 00:00 WIB
      [14, '2026-10-17T17:00:00.000Z'],
      [7, '2026-10-24T17:00:00.000Z'],
    ]);
  });

  it('accepts custom offsets and rejects invalid ones', () => {
    expect(renewalDueDates('2026-11-30T17:00:00Z', { offsetsDays: [1] })[0].due_at.toISOString()).toBe(
      '2026-11-29T17:00:00.000Z',
    );
    expect(() => renewalDueDates('2026-11-30T17:00:00Z', { offsetsDays: [0] })).toThrow(RangeError);
  });
});

describe('supersession caps, never erases (0015 parity)', () => {
  // v1 2026-01-01..2027-06-30, renewal v2 from 2027-06-01 approved at T: v1 capped at 2027-06-01 00:00 WIB.
  const cap = '2027-05-31T17:00:00.000Z';
  const v1 = agreement('v1', 'APPROVED', '2026-01-01', '2027-06-30', { superseded_from: cap, superseded_at: T });
  const v2 = agreement('v2', 'APPROVED', '2027-06-01', '2028-05-31');

  it('keeps the current version in force until the successor starts (no gap)', () => {
    expect(effectiveUntil(v1)).toBe(Date.parse(cap));
    expect(agreementValidAt([v1, v2], T)?.id).toBe('v1');
    expect(agreementValidAt([v1, v2], '2027-05-31T16:59:59.999Z')?.id).toBe('v1');
    expect(agreementValidAt([v1, v2], cap)?.id).toBe('v2');
    expect(findApprovedOverlaps([v1, v2])).toEqual([]);
  });

  it('derives SUPERSEDED from the cap on, and no EXPIRING_SOON badge for a renewed version', () => {
    expect(agreementStatus(v1, T)).toBe('ACTIVE');
    expect(agreementStatus(v1, cap)).toBe('SUPERSEDED');
    expect(isExpiringSoon(v1, '2027-05-20T00:00:00Z')).toBe(false);
  });

  it('historical coverage is evaluated as recorded at the time', () => {
    // Before the decision at T, v1 covered its whole legal interval; afterwards only up to the cap.
    const earlyCap = agreement('old', 'APPROVED', '2026-01-01', '2027-06-30', {
      superseded_from: '2026-03-31T17:00:00.000Z',
      superseded_at: '2026-06-01T00:00:00Z',
    });
    expect(agreementWasValidAt([earlyCap], '2026-05-01T00:00:00Z')?.id).toBe('old'); // before superseded_at
    expect(agreementWasValidAt([earlyCap], '2026-07-01T00:00:00Z')).toBeNull(); // after the cap was recorded
    expect(agreementValidAt([earlyCap], '2026-05-01T00:00:00Z')).toBeNull(); // forward-looking view

    const revoked = agreement('r', 'REVOKED', '2026-01-01', '2027-01-31', { revoked_at: '2026-10-25T01:00:00Z' });
    expect(agreementWasValidAt([revoked], '2026-10-19T06:40:00Z')?.id).toBe('r');
    expect(agreementWasValidAt([revoked], '2026-10-25T01:00:00Z')).toBeNull();
    expect(agreementValidAt([revoked], '2026-10-19T06:40:00Z')).toBeNull();
    expect(agreementWasValidAt([agreement('p', 'PENDING_VERIFICATION', '2026-01-01', '2027-01-31')], T)).toBeNull();
  });
});

describe('lastValidDateFromDocument (document interpretation, PRD §5)', () => {
  it('"berlaku sampai dengan 30 Nov" is inclusive; "berakhir 1 Des" is exclusive', () => {
    expect(lastValidDateFromDocument('2026-11-30', 'THROUGH_INCLUSIVE')).toBe('2026-11-30');
    expect(lastValidDateFromDocument('2026-12-01', 'UNTIL_EXCLUSIVE')).toBe('2026-11-30');
    expect(lastValidDateFromDocument('2027-03-01', 'UNTIL_EXCLUSIVE')).toBe('2027-02-28');
    expect(() => lastValidDateFromDocument('1/12/2026', 'THROUGH_INCLUSIVE')).toThrow(RangeError);
  });
});
