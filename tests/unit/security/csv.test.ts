import {expect,it} from 'vitest';
import {parseCsv,exportCsv} from '@/src/domain/imports/csv';
it('parses quoted delimiters, escaped quotes and multi-line fields without losing row identity',()=>{
 expect(parseCsv('\ufeffexternal_id,note\r\nA,"hello, ""FLO""\nsecond line"\r\nB,ok\r\n')).toEqual([{external_id:'A',note:'hello, "FLO"\nsecond line'},{external_id:'B',note:'ok'}]);
});
it('rejects ambiguous headers, malformed quotes and invalid row counts',()=>{for(const s of ['id,id\na,b','id\n"unclosed','id\n"closed"oops','id,name\na','../bad\nvalue'])expect(()=>parseCsv(s)).toThrow();});
it('neutralises spreadsheet formulas on export',()=>{expect(exportCsv([{name:'=HYPERLINK("bad")',quantity:'10'}],['name','quantity'])).toContain('"\'=HYPERLINK(""bad"")"');});
