/** RFC 4180 subset with bounded input; quoted delimiters, quotes and newlines. */
export function parseCsv(text:string):Record<string,string>[] {
 if(Buffer.byteLength(text,'utf8')>2*1024*1024)throw Error('CSV_TOO_LARGE');
 text=text.replace(/^\uFEFF/,'');const rows:string[][]=[];let row:string[]=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=ch;continue;}
 if(ch==='"'){if(field||closed)throw Error('CSV_QUOTE_INVALID');quoted=true;}
 else if(ch===','||ch==='\n'||ch==='\r'){row.push(field);field='';closed=false;if(ch!==','){if(ch==='\r'&&text[i+1]==='\n')i++;if(row.some(Boolean))rows.push(row);row=[];}}
 else {if(closed)throw Error('CSV_QUOTE_INVALID');field+=ch;}
 }
 if(quoted)throw Error('CSV_QUOTE_UNCLOSED');if(field||row.length){row.push(field);if(row.some(Boolean))rows.push(row);}
 const headers=rows.shift()?.map(s=>s.trim())??[];if(!headers.length||headers.length>50||new Set(headers).size!==headers.length||headers.some(h=>! /^[a-z][a-z0-9_]{0,49}$/.test(h)))throw Error('CSV_HEADERS_INVALID');
 if(rows.length<1||rows.length>2000)throw Error('CSV_ROW_LIMIT');
 return rows.map((values,i)=>{if(values.length!==headers.length)throw Error(`CSV_COLUMNS_ROW_${i+2}`);return Object.fromEntries(headers.map((h,j)=>[h,values[j].trim()]));});
}
export function exportCsv(rows:Record<string,unknown>[],headers:string[]):string{
 const cell=(value:unknown)=>{let v=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);if(/^[\s]*[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
 return '\uFEFF'+[headers.map(cell).join(','),...rows.map(r=>headers.map(h=>cell(r[h])).join(','))].join('\r\n')+'\r\n';
}
