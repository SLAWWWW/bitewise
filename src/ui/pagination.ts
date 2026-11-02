/** Opaque position token; the tenant and permissions always come from the session. */
export const PAGE_SIZE=50;
export function pageToken(offset:number){return Buffer.from(JSON.stringify({v:1,offset})).toString('base64url');}
export function pageOffset(cursor:unknown){if(typeof cursor!=='string'||cursor.length>150)return 0;try{const value=JSON.parse(Buffer.from(cursor,'base64url').toString());return value.v===1&&Number.isSafeInteger(value.offset)&&value.offset>=0&&value.offset<=100000?value.offset:0;}catch{return 0;}}
export async function readPage(params:Promise<Record<string,string|string[]|undefined>>){return pageOffset((await params).cursor);}
