import type {z} from 'zod';
import {handler} from '@/src/http/handler';
import type {Capability} from '@/src/shared/capabilities';
import {idParam} from '@/src/application/flo/route-helpers';
import {inventoryCommand} from './commands';
export function inventoryRoute(action:string,capability:Capability,body:z.ZodType,route:string,collection=false){
 return handler({capability,body,idempotent:true,route,notFoundOnForbidden:true},async ctx=>ctx.ok(await ctx.tx(c=>inventoryCommand(c,action,collection?null:idParam(ctx.params),ctx.body,{idempotencyKey:ctx.idempotencyKey!,requestHash:ctx.requestHash!}))));
}
