import { createHash } from 'node:crypto';
import { DomainError } from '@/src/db/errors';

export const UPLOAD_LIMIT = 10 * 1024 * 1024;
const png = Buffer.from([137,80,78,71,13,10,26,10]);
export function inspectUpload(bytes: Buffer, declared: string) {
  if (!bytes.length || bytes.length > UPLOAD_LIMIT) throw new DomainError({code:'UPLOAD_TOO_LARGE',http:400});
  const mime = bytes.subarray(0,8).equals(png) ? 'image/png' : bytes.subarray(0,3).equals(Buffer.from([255,216,255])) ? 'image/jpeg'
    : bytes.subarray(0,5).toString('ascii') === '%PDF-' ? 'application/pdf' : null;
  if (!mime || declared.split(';')[0].trim().toLowerCase() !== mime) throw new DomainError({code:'UPLOAD_UNSUPPORTED',http:400});
  // Preserve image data while discarding EXIF/location metadata. Reject malformed
  // segments; never pass a partially parsed image to a model or public directory.
  let clean = bytes;
  if (mime === 'image/jpeg') {
    const parts: Buffer[] = [bytes.subarray(0,2)]; let offset=2;
    while (offset<bytes.length) {
      if(bytes[offset]!==255)throw new DomainError({code:'UPLOAD_INVALID',http:400});
      const marker=bytes[offset+1];
      if(marker===0xda || marker===0xd9){parts.push(bytes.subarray(offset));offset=bytes.length;break;}
      if(marker==null||offset+4>bytes.length)throw new DomainError({code:'UPLOAD_INVALID',http:400});
      const len=bytes.readUInt16BE(offset+2);if(len<2||offset+2+len>bytes.length)throw new DomainError({code:'UPLOAD_INVALID',http:400});
      if(marker!==0xe1)parts.push(bytes.subarray(offset,offset+2+len));offset+=2+len;
    }
    clean=Buffer.concat(parts);
  } else if (mime === 'image/png') {
    const parts:Buffer[]=[png];let offset=8;let end=false;
    while(offset+12<=bytes.length){
      const len=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
      if(offset+12+len>bytes.length)throw new DomainError({code:'UPLOAD_INVALID',http:400});
      if(type!=='eXIf'&&type!=='tEXt'&&type!=='iTXt'&&type!=='zTXt')parts.push(bytes.subarray(offset,offset+12+len));
      offset+=12+len;if(type==='IEND'){end=true;break;}
    }
    if(!end||offset!==bytes.length)throw new DomainError({code:'UPLOAD_INVALID',http:400});
    clean=Buffer.concat(parts);
  } else if (/\/JavaScript\b|\/JS\b|\/Launch\b|\/EmbeddedFile\b|\/OpenAction\b/i.test(bytes.toString('latin1'))) {
    throw new DomainError({code:'UPLOAD_UNSUPPORTED',http:400});
  }
  return {bytes:clean,mime,sha256:createHash('sha256').update(clean).digest('hex')};
}
export async function readUpload(request:Request) {
  const size=Number(request.headers.get('content-length'));
  if(size>UPLOAD_LIMIT)throw new DomainError({code:'UPLOAD_TOO_LARGE',http:400});
  const reader=request.body?.getReader();if(!reader)throw new DomainError({code:'UPLOAD_INVALID',http:400});
  const chunks:Buffer[]=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;
    if(total>UPLOAD_LIMIT){await reader.cancel();throw new DomainError({code:'UPLOAD_TOO_LARGE',http:400});}chunks.push(Buffer.from(value));}}
  finally{reader.releaseLock();}
  return inspectUpload(Buffer.concat(chunks),request.headers.get('content-type')??'');
}
