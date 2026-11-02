import {reportingRoute} from '@/src/application/reporting/routes';
import {reviewBody} from '@/src/contracts/reporting';
export const POST=reportingRoute('review',reviewBody,'/api/submissions/[id]/review');
