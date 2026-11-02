/**
 * Agreement lifecycle entry point (architecture D/S1-C names this file). The
 * implementation lives in ./agreement-interval so interval math and status share one
 * definition of the half-open interval; this module re-exports the status API.
 */
export {
  EXPIRING_SOON_MS,
  agreementStatus,
  agreementValidAt,
  covers,
  findApprovedOverlaps,
  floAgreementStatus,
  handoverAgreementCheck,
  isExpiringSoon,
  type AgreementEligibilityCode,
  type AgreementLike,
  type AgreementOverlap,
  type FloAgreementStatus,
  type FloAgreementSummary,
} from './agreement-interval';
