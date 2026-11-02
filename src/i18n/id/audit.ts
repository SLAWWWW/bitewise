import type { Dict } from '../types';

/** Bahasa Indonesia — 'audit' namespace (owner: W2-SHELL). Page: app/(ops)/audit. */
const audit = {
  title: 'Audit',
  subtitle: 'Jejak audit keputusan dan perubahan. Hanya-tambah: catatan tidak dapat diubah atau dihapus.',
  eyebrow: 'Kepatuhan',

  'filter.legend': 'Saring peristiwa',
  'filter.subjectType': 'Jenis subjek',
  'filter.actor': 'Pelaku',
  'filter.action': 'Tindakan',
  'filter.actorKind': 'Jenis pelaku',
  'filter.from': 'Dari tanggal (WIB)',
  'filter.to': 'Sampai tanggal (WIB)',
  'filter.any': 'Semua',
  'filter.apply': 'Terapkan saringan',
  'filter.clear': 'Hapus saringan',
  'filter.dateHint': 'Tanggal lokal Asia/Jakarta (WIB), termasuk hari terakhir.',
  'filter.invalid': 'Saringan tidak valid: {fields}',
  'filter.active': 'Saringan aktif',

  'col.time': 'Waktu',
  'col.actor': 'Pelaku',
  'col.action': 'Tindakan',
  'col.subject': 'Subjek',
  'col.reason': 'Alasan',
  'col.policy': 'Kebijakan',
  'col.correlation': 'Korelasi',
  'col.payload': 'Muatan',

  'subject.revision': 'rev. {n}',
  'actor.unknownUser': 'Pengguna {id}',
  'actorKind.USER': 'Pengguna',
  'actorKind.WORKER': 'Pekerja latar',
  'actorKind.AGENT': 'Agen AI',
  'actorKind.FLO_LINK': 'Tautan FLO',
  'actorKind.SYSTEM': 'Sistem',
  'payload.show': 'Lihat muatan',

  caption: 'Peristiwa audit, terbaru lebih dulu',
  'page.count': '{count} peristiwa di halaman ini',
  'page.next': 'Halaman berikutnya',
  'page.first': 'Kembali ke terbaru',
  'page.end': 'Akhir jejak audit untuk saringan ini.',
  empty: 'Belum ada peristiwa audit yang cocok dengan saringan ini.',
  emptyAll: 'Belum ada peristiwa audit untuk tenant ini.',
  unauthorised: 'Halaman audit memerlukan izin audit.read.',
  'error.title': 'Jejak audit tidak dapat dimuat',
} satisfies Dict;

export default audit;
