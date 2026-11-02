import {expect,it} from 'vitest';
import {inspectUpload,readUpload,UPLOAD_LIMIT} from '@/src/security/upload-guards';
it('rejects disguised executable, oversized and active PDF content',async()=>{
 expect(()=>inspectUpload(Buffer.from('<script>bad</script>'),'image/png')).toThrow();
 expect(()=>inspectUpload(Buffer.alloc(UPLOAD_LIMIT+1),'image/jpeg')).toThrow();
 expect(()=>inspectUpload(Buffer.from('%PDF-1.7 /OpenAction /JavaScript'),'application/pdf')).toThrow();
 await expect(readUpload(new Request('http://localhost',{method:'POST',headers:{'content-type':'image/png','content-length':String(UPLOAD_LIMIT+1)},body:'x'}))).rejects.toMatchObject({code:'UPLOAD_TOO_LARGE'});
});
it('strips JPEG APP1 metadata without changing compressed image bytes',()=>{
 const bytes=Buffer.from([255,216,255,225,0,5,69,88,73,255,218,0,2,1,2,3,255,217]);
 const clean=inspectUpload(bytes,'image/jpeg');expect([...clean.bytes]).toEqual([255,216,255,218,0,2,1,2,3,255,217]);expect(clean.sha256).toMatch(/^[a-f0-9]{64}$/);
});
