/** Local DEMO/TEST logical snapshot rehearsal. Restores ONLY into a fresh random
 * database, validates counts and invariants, then drops the scratch database.
 * This supplements, rather than replaces, managed PostgreSQL/PITR backups. */
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createMigratedDatabase,loadLocalEnv,DEFAULT_ADMIN_URL,DEFAULT_OWNER_URL,urlWith} from '@/src/db/migrate-lib';
loadLocalEnv();
// Preserve SQL dates and microsecond timestamps exactly in the backup artifact.
// JS Date would shift local calendar dates and truncate timestamp precision.
for(const oid of [1082,1114,1184])pg.types.setTypeParser(oid,value=>value);
const ident=(value:string)=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw Error('Invalid catalogue identifier');return '"'+value+'"';};
async function main(){
 if(process.env.APP_MODE==='LIVE')throw Error('Demo rehearsal refuses LIVE');
 const source=new pg.Client({connectionString:process.env.DATABASE_OWNER_URL||DEFAULT_OWNER_URL});await source.connect();
 const slug=process.argv[2]??'foodcycle-demo';const snapshot:{tenantId:string;tables:{name:string;columns:{name:string;type:string}[];rows:Record<string,unknown>[]}[]}={tenantId:'',tables:[]};
 try{await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const tenant=(await source.query<{id:string;mode:string;is_demo:boolean}>('SELECT id,mode,is_demo FROM lumbung.tenants WHERE slug=$1',[slug])).rows[0];if(!tenant?.is_demo||!['DEMO','TEST'].includes(tenant.mode))throw Error('Only a synthetic tenant can be rehearsed');snapshot.tenantId=tenant.id;
 const tables=(await source.query<{name:string}>("SELECT tablename name FROM pg_tables WHERE schemaname='lumbung' AND (tablename IN('tenants','users') OR EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='lumbung' AND c.table_name=tablename AND c.column_name='tenant_id')) ORDER BY tablename")).rows;
 for(const table of tables){const columns=(await source.query<{name:string;type:string}>(`SELECT column_name name,udt_name type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND is_generated='NEVER' ORDER BY ordinal_position`,['lumbung',table.name])).rows;
 const scope=table.name==='tenants'?'id=$1':table.name==='users'?'id IN(SELECT user_id FROM lumbung.memberships WHERE tenant_id=$1)':'tenant_id=$1';
 const rows=(await source.query(`SELECT * FROM lumbung.${ident(table.name)} WHERE ${scope}`,[tenant.id])).rows;snapshot.tables.push({name:table.name,columns,rows});}
 await source.query('COMMIT');}finally{await source.end();}
 const dir=path.resolve('.data/backups');await mkdir(dir,{recursive:true,mode:0o700});const filename=path.join(dir,`demo-${Date.now()}.json`);await writeFile(filename,JSON.stringify(snapshot),{mode:0o600,flag:'wx'});
 // Read the artifact back, so this exercises a recoverable on-disk snapshot.
 const saved=JSON.parse(await readFile(filename,'utf8')) as typeof snapshot;
 const admin=process.env.DATABASE_ADMIN_URL||DEFAULT_ADMIN_URL;const scratch=await createMigratedDatabase(admin,`lumbung_restore_${process.pid}_${randomBytes(3).toString('hex')}`);
 const restore=new pg.Client({connectionString:urlWith(admin,{database:scratch.dbName})});await restore.connect();
 try{await restore.query('BEGIN');await restore.query("SET LOCAL session_replication_role='replica'");
 for(const table of saved.tables){const columns=table.columns.map(c=>ident(c.name)).join(',');const placeholders=table.columns.map((_,i)=>`$${i+1}`).join(',');
 for(const row of table.rows){const values=table.columns.map(col=>{const v=row[col.name];if(v===null)return null;if(col.type==='jsonb'||col.type==='json')return JSON.stringify(v);if(col.type==='bytea'&&typeof v==='object'&&v&&'data' in v)return Buffer.from((v as {data:number[]}).data);return v;});await restore.query(`INSERT INTO lumbung.${ident(table.name)}(${columns}) OVERRIDING SYSTEM VALUE VALUES(${placeholders})`,values);}}
 const identities=(await restore.query<{table_name:string;column_name:string}>("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='lumbung' AND is_identity='YES'")).rows;
 for(const col of identities){const sequence=(await restore.query<{seq:string}>('SELECT pg_get_serial_sequence($1,$2) seq',['lumbung.'+col.table_name,col.column_name])).rows[0].seq;
 await restore.query(`SELECT setval($1,greatest(coalesce(max(${ident(col.column_name)}),1),1),count(*)>0) FROM lumbung.${ident(col.table_name)}`,[sequence]);}
 await restore.query("SET LOCAL session_replication_role='origin'");await restore.query('COMMIT');
 for(const table of saved.tables){const scope=table.name==='tenants'?'id=$1':table.name==='users'?'id IN(SELECT user_id FROM lumbung.memberships WHERE tenant_id=$1)':'tenant_id=$1';const n=(await restore.query<{n:number}>(`SELECT count(*)::int n FROM lumbung.${ident(table.name)} WHERE ${scope}`,[saved.tenantId])).rows[0].n;if(n!==table.rows.length)throw Error(`Restored count mismatch: ${table.name}`);}
 const violations=(await restore.query('SELECT * FROM lumbung.verify_tenant_invariants($1)',[saved.tenantId])).rows;if(violations.length)throw Error(`Restored invariant failures: ${JSON.stringify(violations.reduce((counts:Record<string,number>,v)=>{counts[v.code]=(counts[v.code]??0)+1;return counts;},{}))}`);
 console.info(`Backup restored and verified: ${saved.tables.length} tables, ${saved.tables.reduce((n,t)=>n+t.rows.length,0)} rows, zero invariant violations. Artifact: ${filename}`);
 }finally{await restore.end();await scratch.drop();}
}
void main().catch(e=>{console.error(e instanceof Error?e.message:'Backup rehearsal failed');process.exitCode=1;});
