import {pageOffset,pageToken} from '@/src/ui/pagination';
import {z} from 'zod';
import { handler } from '@/src/http/handler';
import { donationBody } from '@/src/contracts/direct';
import { directCommand } from '@/src/application/direct/commands';
import { listDonations } from '@/src/application/direct/queries';

export const GET = handler({ capability: 'flo.read',query:z.object({cursor:z.string().max(150).optional()}) }, async ctx => {const offset=pageOffset(ctx.query.cursor);const rows=await ctx.tx(c=>listDonations(c,offset));return ctx.ok(rows,{headers:rows.length===50?{'x-next-cursor':pageToken(offset+50)}:{}});});
export const POST = handler({ capability: 'donation.create', body: donationBody, idempotent: true, route: '/api/donations' }, async ctx => {
  const result = await ctx.tx(c => directCommand(c, 'create', null, ctx.body, { idempotencyKey: ctx.idempotencyKey!, requestHash: ctx.requestHash! }));
  return ctx.ok(result, { status: 201, revision: result.revision });
});
