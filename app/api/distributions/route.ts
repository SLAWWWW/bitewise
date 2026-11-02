import {reportingRoute} from '@/src/application/reporting/routes';
import {distributionBody} from '@/src/contracts/reporting';
export const POST=reportingRoute('distribution',distributionBody,'/api/distributions');
