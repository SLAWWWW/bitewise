import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function signIn(page:Page,name:string){await page.goto('/masuk');await page.getByRole('button',{name:`Masuk sebagai ${name}`,exact:true}).click();await expect(page).toHaveURL(/ringkasan/);}
async function checkPage(page:Page){await expect(page.locator('body')).not.toContainText('Application error');await expect(page.getByRole('heading',{name:'Terjadi kesalahan'})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const mismatches=await page.evaluate(()=>{const font=getComputedStyle(document.body).fontFamily;return [...document.querySelectorAll<HTMLElement>('h1,h2,h3,p,label,input,select,textarea,button,code')].filter(e=>e.getBoundingClientRect().width>0&&getComputedStyle(e).fontFamily!==font).map(e=>({tag:e.tagName,font:getComputedStyle(e).fontFamily,text:e.textContent?.slice(0,40)}));});expect(mismatches).toEqual([]);}
test('all operations routes render consistently on desktop and mobile',async({page})=>{
 const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));page.on('response',r=>{if(r.status()>=500)failures.push(`${r.status()} ${r.url()}`);});await signIn(page,'Admin Demo');
 for(const path of ['/ringkasan','/flo','/donasi','/rekomendasi','/persetujuan','/persediaan','/pengiriman','/pesan','/pelaporan','/pengaturan','/pengaturan/impor','/audit']){await page.goto(path);await checkPage(page);}
 await page.goto('/persediaan');await page.locator('a[href^="/persediaan/batch/"]').first().click();await checkPage(page);await expect(page.getByRole('heading',{name:'Buku besar stok'})).toBeVisible();
 await page.goto('/pelaporan');await page.locator('a[href^="/pelaporan/"]').first().click();await checkPage(page);const a11y=await new AxeBuilder({page}).include('.direct-page').analyze();expect(a11y.violations).toEqual([]);
 await page.goto('/pesan');await page.locator('a[href^="/pesan/"]').first().click();await checkPage(page);
 expect(failures).toEqual([]);
});
test('warehouse receiving persists inspected stock and a ledger',async({page})=>{
 await signIn(page,'Gudang Demo 1');await page.goto('/persediaan');await page.locator('summary').filter({hasText:'Catat rencana inbound'}).click();
 await page.getByRole('combobox',{name:'Produk',exact:true}).selectOption({label:'Biskuit (Simulasi) (pack)'});await page.getByRole('button',{name:'Catat rencana inbound',exact:true}).click();await expect(page).toHaveURL(/\/persediaan\/inbound\/[0-9a-f-]+$/);
 await page.getByLabel('Jumlah fisik diterima').fill('100');await page.getByLabel('Diterima layak').fill('80');await page.getByLabel('Ditahan karantina').fill('15');await page.getByLabel('Ditolak',{exact:true}).fill('5');
 await page.getByLabel('Lokasi penyimpanan').selectOption({index:0});await page.getByLabel('Kondisi',{exact:true}).selectOption('GOOD');await page.getByLabel('Alasan / catatan').first().fill('Kemasan utuh dan tanggal label diperiksa');await page.getByLabel('Alasan / catatan').last().fill('Penerimaan fisik dan selisih dicatat');
 await page.getByRole('button',{name:'Terima dan inspeksi',exact:true}).click();await expect(page.getByText('CLOSED',{exact:true})).toBeVisible();await page.reload();await checkPage(page);
});
