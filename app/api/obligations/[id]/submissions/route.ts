import {reportingRoute} from '@/src/application/reporting/routes';
import {submissionBody} from '@/src/contracts/reporting';
export const POST=reportingRoute('submit',submissionBody,'/api/obligations/[id]/submissions');
