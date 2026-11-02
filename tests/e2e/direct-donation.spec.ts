import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function fits(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
async function createAndAccept(page:Page){
  await page.goto('/masuk');await page.getByRole('button',{name:/Koordinator Demo 1/}).click();await expect(page).toHaveURL(/ringkasan/);
  await page.goto('/donasi/baru');await page.getByLabel(/Jumlah \(portion\)/).fill('10');await fits(page);
  await page.getByRole('button',{name:'Simpan donasi',exact:true}).click();await expect(page).toHaveURL(/\/donasi\/[0-9a-f-]+$/);
  await page.getByRole('button',{name:'Validasi keamanan',exact:true}).click();
  await expect(page.getByRole('button',{name:'Hitung rekomendasi',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Hitung rekomendasi',exact:true}).click();await expect(page).toHaveURL(/\/rekomendasi\/[0-9a-f-]+$/);
  await page.getByLabel('Jelaskan alasan persetujuan').fill('Rencana simulasi ditinjau oleh koordinator');
  await page.getByRole('button',{name:'Ajukan outreach',exact:true}).click();await expect(page).toHaveURL(/\/donasi\/[0-9a-f-]+$/);
  await fits(page);
  await page.getByLabel('Jelaskan alasan persetujuan').fill('Cakupan outreach dan jumlah telah ditinjau');
  await page.getByRole('button',{name:'Setujui outreach',exact:true}).click();
  await page.getByRole('button',{name:'Mulai penawaran simulasi',exact:true}).click();
  await page.getByRole('button',{name:'Catat respons',exact:true}).click();
  await page.getByText('Konfirmasi pengambilan dan ongkir',{exact:true}).click();
  await expect(page.getByLabel('Pengatur / rincian pengambilan')).toBeVisible();
  return page.url();
}
test('direct donation persists through both approvals, dispatch and actual receipt',async({page})=>{
  await createAndAccept(page);
  await page.getByLabel('Pengatur / rincian pengambilan').fill('FLO menjemput dengan kendaraan sendiri');
  await page.getByRole('button',{name:'Simpan konfirmasi FLO',exact:true}).click();
  await page.getByLabel('Jelaskan alasan persetujuan').fill('Jumlah dan pengambilan dikonfirmasi FLO');
  await page.getByRole('button',{name:'Setujui pengiriman',exact:true}).click();
  await page.getByRole('link',{name:'Pengiriman →',exact:true}).click();
  await page.getByLabel('Penanggung jawab barang').fill('Pengemudi FLO simulasi');
  await page.getByRole('button',{name:'Catat pengambilan',exact:true}).click();
  await page.getByRole('button',{name:'Catat penerimaan',exact:true}).click();
  await expect(page.getByText(/Bukti serah terima · Terbuka/)).toBeVisible();
  await expect(page.getByText(/Foto penerimaan · Terbuka/)).toBeVisible();
  await page.reload();await expect(page.getByText('Langsung dari donor · Diterima FLO',{exact:true})).toBeVisible();
  await fits(page);
  const a11y=await new AxeBuilder({page}).include('.direct-page').analyze();expect(a11y.violations).toEqual([]);
  await page.locator('summary').filter({hasText:'Buat tautan FLO privat'}).click();
  await page.getByRole('button',{name:'Buat tautan FLO privat',exact:true}).click();
  const floPath=await page.locator('a[href^="/f/"]').getAttribute('href');expect(floPath).toBeTruthy();
  await page.goto(floPath!);await fits(page);await expect(page.getByRole('navigation')).toHaveCount(0);
  const bastSection=page.locator('section').filter({has:page.getByRole('heading',{name:'BAST · OPEN',exact:true})});
  await bastSection.getByLabel('Keterangan bukti / pengakuan digital').fill('FLO mengakui jumlah diterima sesuai catatan penyerahan digital, untuk tinjauan staf.');
  const submission=page.waitForResponse(r=>r.url().includes('/submissions')&&r.request().method()==='POST');
  await bastSection.getByRole('button',{name:'Kirim bukti',exact:true}).click();const result=await (await submission).json();expect(result.error).toBeUndefined();
  await page.reload();await expect(page.getByRole('heading',{name:/BAST · SUBMITTED/})).toBeVisible();
  await page.goto('/masuk');await page.getByRole('button',{name:/Peninjau Bukti Demo/}).click();await expect(page).toHaveURL(/ringkasan/);await page.goto(`/pelaporan/${result.data.id}`);
  await page.getByLabel('Bukti sesuai penerima dan kegiatan').check();await page.getByLabel('Jumlah dan isi masuk akal').check();await page.getByLabel('Privasi orang dalam foto sesuai').check();
  await page.locator('section').filter({has:page.getByRole('heading',{name:'Tinjau bukti',exact:true})}).getByLabel('Alasan / catatan').fill('Pengakuan digital sesuai penyerahan, jumlah cocok, privasi sesuai.');
  await page.getByRole('button',{name:'Tinjau bukti',exact:true}).click();await expect(page.getByText(/Diterima · Batas pelaporan/)).toBeVisible();await fits(page);
  await page.goto('/masuk');await page.getByRole('button',{name:/Koordinator Demo 1/}).click();await expect(page).toHaveURL(/ringkasan/);
  for(const path of ['/donasi','/rekomendasi','/persetujuan','/pengiriman']){await page.goto(path);await fits(page);}
});
test('fee refusal releases the reservation and shows the logistics outcome',async({page})=>{
  await createAndAccept(page);
  await page.getByLabel('Metode',{exact:true}).selectOption('FLO_BOOKED_COURIER');
  await page.getByLabel('Pengatur / rincian pengambilan').fill('Kurir ditolak FLO karena ongkir');
  await page.getByLabel('Ongkir yang disetujui (IDR)').fill('50000');
  await page.getByLabel('Keputusan FLO').selectOption('REFUSE');
  await page.getByRole('button',{name:'Simpan konfirmasi FLO',exact:true}).click();
  await expect(page.getByRole('article').filter({hasText:/AL-/}).getByText(/Dibatalkan/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Setujui pengiriman',exact:true})).toHaveCount(0);await fits(page);
});
