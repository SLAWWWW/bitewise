import {reportingRoute} from '@/src/application/reporting/routes';
import {excuseBody} from '@/src/contracts/reporting';
export const POST=reportingRoute('excuse',excuseBody,'/api/obligations/[id]/excuse');
