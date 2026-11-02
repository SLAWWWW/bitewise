export interface TourStep {
  id: string;
  href: string;
  requiresHref?: string;
  selectors: readonly string[];
  title: readonly [string, string];
  body: readonly [string, string];
  action: readonly [string, string];
}

/** Stable IDs persist the explanation being read, never operational completion. */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'clock', href: '/ringkasan', selectors: ['[data-tour="clock"]'],
    title: ['Periksa waktu operasi', 'Check the operational clock'],
    body: ['Tanggal ini dipakai untuk tenggat, masa berlaku perjanjian, dan keamanan pangan. Pada demo, waktu dapat dibekukan; tanggal di komputer Anda bisa berbeda.', 'This clock controls deadlines, agreement validity, and food safety. Demo time can be frozen and may differ from your computer’s date.'],
    action: ['Baca tanggal dan status waktu di area yang disorot.', 'Read the date and clock status in the highlighted area.'],
  },
  {
    id: 'queue', href: '/ringkasan', requiresHref: '/donasi', selectors: ['[data-tour="queue-link"]'],
    title: ['Buka pekerjaan dari angka ini', 'Open work from this count'],
    body: ['Kartu ini menghitung donasi yang masih perlu informasi atau validasi. Klik kartu untuk membuka daftar donasi; angka nol berarti antrean itu kosong.', 'This card counts donations needing details or validation. Select it to open the donation list; zero means that queue is empty.'],
    action: ['Klik kartu untuk mencoba, atau pilih Berikutnya untuk melanjutkan tur.', 'Select the card to explore, or choose Next to continue the tour.'],
  },
  {
    id: 'flo-search', href: '/flo', selectors: ['#f-q'],
    title: ['Cari organisasi penerima', 'Find a recipient organisation'],
    body: ['Ketik nama atau kode FLO di sini. Pilih filter wilayah atau status perjanjian bila perlu, lalu tekan Terapkan untuk memperbarui daftar.', 'Enter a FLO name or code here. Add an area or agreement filter if needed, then select Apply to update the directory.'],
    action: ['Kolom yang disorot dapat langsung diketik.', 'You can type directly into the highlighted field.'],
  },
  {
    id: 'flo-profile', href: '/flo', selectors: ['#main a[href^="/flo/"]'],
    title: ['Buka profil FLO ini', 'Open this FLO profile'],
    body: ['Klik nama atau kode ini untuk melihat kebutuhan pangan, kapasitas, jadwal, dan perjanjian. Periksa kelayakannya sebelum mengalokasikan donasi.', 'Select this name or code to inspect food needs, capacity, schedules, and agreements. Check eligibility before allocating a donation.'],
    action: ['Klik tautan untuk melihat profil. Tur akan dijeda selama Anda menjelajah.', 'Select the link to inspect the profile. The tour pauses while you explore.'],
  },
  {
    id: 'donation-search', href: '/donasi', selectors: ['.record-search input'],
    title: ['Temukan donasi yang ingin diproses', 'Find a donation to work on'],
    body: ['Cari kode donasi, nama donor, atau produk di sini. Pencarian hanya menyaring halaman ini; gunakan Berikutnya di bawah daftar untuk halaman data lainnya.', 'Search by donation code, donor, or product here. Search filters this page only; use the pagination below the list to browse more records.'],
    action: ['Coba ketik nama donor, lalu hapus pencarian untuk menampilkan semua baris.', 'Try a donor name, then clear the search to show all rows.'],
  },
  {
    id: 'donation-record', href: '/donasi', selectors: ['.record-heading a'],
    title: ['Buka rincian donasi', 'Open the donation details'],
    body: ['Klik nama donor ini. Di rincian, periksa jumlah, jadwal pengambilan, dan keamanan pangan. Donasi yang siap dapat dihitung rekomendasi penerimanya.', 'Select this donor name. In the details, check quantity, pickup times, and food safety. A ready donation can be used to calculate recipient recommendations.'],
    action: ['Buka donasi untuk melihat tindakan yang tersedia bagi peran Anda.', 'Open the donation to see actions available to your role.'],
  },
  {
    id: 'recommendation', href: '/rekomendasi', selectors: ['#main a[href^="/rekomendasi/"]'],
    title: ['Baca alasan rekomendasi ini', 'Read this recommendation’s reasons'],
    body: ['Tautan ini membuka hasil perhitungan: FLO terpilih, jumlah, alternatif, dan alasan pengecualian. Tinjau hasilnya sebelum mengajukan outreach.', 'This link opens the calculation: selected FLOs, quantities, alternatives, and exclusions. Review the result before proposing outreach.'],
    action: ['Klik untuk melihat rincian skor dan rencana alokasi.', 'Select it to inspect scores and the allocation plan.'],
  },
  {
    id: 'approval', href: '/persetujuan', selectors: ['[data-tour="outreach-approval"] button:not(:disabled)', '[data-tour="dispatch-approval"] button:not(:disabled)'],
    title: ['Tinjau sebelum menyetujui', 'Review before approving'],
    body: ['Ini tombol persetujuan yang tersedia. Lengkapi alasan dan periksa jumlah serta penerima terlebih dahulu. Outreach mengizinkan penawaran; persetujuan akhir mengizinkan pengiriman setelah FLO mengonfirmasi logistik.', 'This approval action is available to you. Enter a reason and verify quantities and recipients first. Outreach permits offers; final approval permits dispatch after the FLO confirms logistics.'],
    action: ['Tur tidak perlu menekan tombol ini. Pilih Berikutnya untuk melanjutkan.', 'You do not need to approve anything for the tour. Choose Next to continue.'],
  },
  {
    id: 'delivery', href: '/pengiriman', selectors: ['.record-heading a'],
    title: ['Periksa pengiriman ini', 'Inspect this delivery'],
    body: ['Klik nama FLO untuk membuka pengiriman. Catat pengambilan saat barang berangkat, lalu jumlah yang benar-benar diterima. Gunakan jumlah fisik bila ada selisih.', 'Select the FLO name to open the delivery. Record collection when goods leave, then the quantity actually received. Use physical quantities if there is a discrepancy.'],
    action: ['Buka pengiriman untuk melihat status dan tindakan berikutnya.', 'Open the delivery to see its status and next action.'],
  },
  {
    id: 'report-deadline', href: '/pelaporan', selectors: ['.record-row .record-facts'],
    title: ['Perhatikan batas pelaporan ini', 'Check this reporting deadline'],
    body: ['Tanggal ini adalah tenggat bukti pada baris tersebut. Jenis bukti ada di atas nama FLO. Klik nama FLO untuk mengunggah bukti atau meninjaunya sesuai peran Anda.', 'This is the evidence deadline for this row. The evidence type appears above the FLO name. Select the FLO name to upload or review evidence, depending on your role.'],
    action: ['Cocokkan jenis bukti dan tenggat sebelum membuka laporan.', 'Match the evidence type and deadline before opening the report.'],
  },
  {
    id: 'stock-balances', href: '/persediaan', selectors: ['.stock-totals'],
    title: ['Bedakan tiga saldo ini', 'Distinguish these three balances'],
    body: ['Tersedia adalah saldo yang belum direservasi; direservasi sudah dialokasikan; karantina ditahan untuk pemeriksaan. Periksa juga status keamanan dan tanggal batch sebelum pelepasan.', 'Available is unreserved stock; reserved is already allocated; quarantine is held for inspection. Also check the safety status and batch dates before release.'],
    action: ['Baca tiap label; saldo tersedia belum tentu lolos keamanan.', 'Read each label; an available balance still needs safety clearance.'],
  },
  {
    id: 'stock-details', href: '/persediaan', selectors: ['.record-more summary'],
    title: ['Buka rincian saldo di sini', 'Expand the balances here'],
    body: ['Klik untuk melihat semua akun, termasuk stok dalam perjalanan dan penyesuaian. Membuka rincian ini hanya menampilkan data. Klik nama produk untuk membuka buku besar batch.', 'Expand this to see all accounts, including stock in transit and adjustments. Expanding it only reveals data. Select the product name to open the batch ledger.'],
    action: ['Klik Lihat semua saldo untuk mencoba membuka dan menutup rinciannya.', 'Select View all balances to expand and collapse the details.'],
  },
  {
    id: 'conversation', href: '/pesan', selectors: ['.record-heading a'],
    title: ['Buka percakapan FLO ini', 'Open this FLO conversation'],
    body: ['Klik nama FLO untuk membaca pesan. Jika perlu membantu, gunakan Ambil alih percakapan di rincian. Kembalikan ke asisten dengan ringkasan setelah selesai. Pesan demo disimulasikan.', 'Select the FLO name to read messages. To help, use Take over conversation in the details. Hand it back to the assistant with a summary when finished. Demo messages are simulated.'],
    action: ['Ini akhir tur. Anda dapat mengulangnya kapan saja.', 'This is the end of the tour. You can restart it at any time.'],
  },
];
