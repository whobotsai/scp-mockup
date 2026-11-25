# Roadmap — Diamond Hand (Solana), dengan penanda siapa yang eksekusi

Ringkasan eksekusi dari `docs/SOLANA_MAINNET_LAUNCH_PLAN.md` (sumber kebenaran lengkap —
baca itu untuk detail/alasan teknis penuh setiap item). File ini hanya menjawab satu
pertanyaan per item: **siapa yang harus menjalankannya**, karena sandbox tempat kode ini
ditulis tidak punya toolchain Solana/Anchor asli, tidak punya akses ke host-host yang
dibutuhkan (`release.solana.com`, `github.com`), dan tidak punya kredensial pihak ketiga
apa pun (RPC provider, Birdeye, X Developer App, VPS/PaaS, dompet mainnet).

**Legenda:**
- **[ANDA]** — hanya bisa dikerjakan Anda: butuh mesin dengan toolchain nyata, akun/kredensial
  pihak ketiga, atau ini keputusan bisnis/legal yang bukan keputusan teknis saya.
- **[GABUNGAN]** — Anda jalankan langkahnya (perlu akses/kredensial yang saya tidak punya),
  lalu kirim hasil/error-nya ke saya — saya lanjutkan dari situ (fix kode, update config,
  tulis script).
- **[SAYA]** — bisa saya kerjakan sendiri dari sini, tanpa menunggu Anda.
- **[SELESAI]** — sudah dikerjakan dan diverifikasi sejauh yang bisa diverifikasi dari sandbox
  (lihat catatan "belum pernah dieksekusi" di masing-masing — selesai ditulis ≠ selesai
  terbukti benar).

---

## P0 — Hard blocker, urutan ini harus jalan duluan

1. **[ANDA]** Install `solana` CLI + `anchor` CLI 0.30.1 di mesin dengan akses internet
   normal. Sandbox ini diblokir policy-nya sendiri ke `release.solana.com`/`github.com` —
   bukan sekadar lambat, benar-benar 403.
2. **[GABUNGAN]** `anchor build` untuk `sho_solana`/`sso_solana`/`registry_solana`. Jalankan
   di mesin Anda → **kirim error-nya ke saya** (terutama kalau soal ukuran akun
   `sso_solana`'s `Campaign.epochs`, sudah saya tandai sebagai risiko tertinggi). Saya
   perbaiki kodenya begitu ada error nyata untuk dilihat.
3. **[GABUNGAN]** `anchor keys list` → kirim 3 program id yang dihasilkan ke saya, saya
   update `declare_id!()` di masing-masing `lib.rs` + `Anchor.toml`'s `[programs.localnet]`
   sendiri (bagian mekanis, tidak perlu Anda edit manual).
4. **[SELESAI]** `tests/sho.ts`/`sso.ts`/`registry.ts` — ditulis, lolos `tsc --noEmit`,
   **belum pernah benar-benar dieksekusi**.
5. **[SELESAI]** Script manual terminal (SHO/SSO/Registry) — sama, ditulis dan
   type-checked, **belum pernah dieksekusi**.
6. **[GABUNGAN]** `anchor test` terhadap local validator. Ini eksekusi pertama yang
   sungguhan dari test suite di atas — **kirim semua yang gagal ke saya**, jangan hanya
   "ini error" tapi paste output lengkapnya supaya saya bisa diagnosa akar masalahnya, bukan
   cuma menebak.
7. **[ANDA]** Deploy ketiga program ke **devnet** + jalankan `scripts/initialize.ts`.
   Butuh wallet devnet yang sudah di-fund (airdrop) — murni langkah operasional Anda.
8. **[ANDA]** Host `api`/`keeper`/`registration-service` di tempat yang publicly
   reachable (VPS atau PaaS: Railway/Render/Fly.io, dkk + Postgres asli). Docker tooling
   (`docker-compose.yml` + `Dockerfile` di tiap service) sudah saya siapkan untuk
   mempermudah ini, tapi **belum pernah berhasil di-build sekali pun** dari sandbox ini
   (kena rate-limit Docker Hub) — jalankan `docker compose up --build` sendiri dan kirim
   error-nya kalau macet, itu bagian yang bisa saya bantu lanjutkan.
9. **[GABUNGAN]** Point semua `.env`/`SCP_CONFIG` ke program id devnet + RPC devnet + URL
   backend yang sudah di-hosting, lalu jalankan **seluruh flow live sekali, end-to-end**
   (SHO dan SSO). Kalau ada langkah yang gagal/aneh, kirim ke saya untuk didiagnosa.

## P1 — Wajib sebelum ada uang sungguhan dipertaruhkan

- **[ANDA] Keputusan sekarang: model signer keeper untuk mainnet.** Single keypair
  (terima risiko + rencana rotasi tertulis) vs multisig (Squads) sebelum launch — ini
  keputusan keamanan/bisnis, bukan sesuatu yang bisa saya putuskan untuk Anda.
- **[ANDA] Keputusan sekarang: allowlist reward-mint.** Ship allowlist token reward
  (stablecoin + token protokol + SOL) sebelum launch, atau terima gap ini secara sadar
  untuk v1. **[SAYA]** bisa implementasikan kodenya begitu arahnya Anda putuskan (sudah
  pernah saya tandai sebagai kandidat P1 sebelumnya, tinggal bilang "lanjutkan").
- **[ANDA]** Provisioning infrastruktur produksi — semuanya butuh akun/kredensial pihak
  ketiga yang hanya Anda yang bisa buat: Postgres asli, RPC provider mainnet-beta
  (Helius/QuickNode/dll.), `BIRDEYE_API_KEY` berbayar, X Developer App dengan OAuth 2.0
  PKCE, `SOLANA_ATTESTOR_PRIVATE_KEY` baru. **[GABUNGAN]** setelah akunnya ada, kirim nilai
  env-nya (bukan secret-nya langsung ke chat kalau sensitif — cukup konfirmasi sudah siap),
  saya bantu wiring konfigurasinya.
- **[SAYA]** Pantau biaya/latency endpoint standings SHO Solana (iterasi semua campaign
  lewat Birdeye per load Profile) — saya optimasi nanti kalau sudah terbukti jadi masalah
  nyata, belum perlu dikerjakan sekarang.
- **[ANDA] Keputusan: advisory `bigint-buffer`.** Terima risikonya untuk sekarang (sudah
  jadi sikap proyek ini), atau minta saya kerjakan migrasi breaking ke `@solana/web3.js`
  v2/v3 (pekerjaan besar, lintas keeper+api+frontend) — **[SAYA]** kerjakan kalau Anda
  minta ini secara eksplisit.
- **[GABUNGAN]** Wire alert `keeper/src/alerts.js` ke Slack/email/pager sungguhan — Anda
  siapkan webhook/kredensial tujuannya, saya wiring kodenya.
- **[ANDA] Legal/regulatory review — mulai dari sekarang, paralel, bukan di akhir.** Tidak
  ada yang bisa saya kerjakan di sini; ini murni di luar scope teknis.

## P2 — Keputusan scope peluncuran

- **[SELESAI]** SHO-only-dulu sudah tidak relevan lagi — SSO sudah feature-complete juga,
  jadi tidak ada lagi alasan teknis untuk menunda salah satu. Pilihan "launch bareng vs
  staged" sekarang murni soal risk-appetite Anda.
- **[GABUNGAN]** Point `SCP_CONFIG` ke nilai mainnet-beta (program id asli dari P0, RPC,
  URL backend yang sudah hosting) lalu **redeploy frontend paling akhir** (setelah backend
  live, bukan sebelumnya). **[SAYA]** bisa update file config dan jalankan deploy-nya kalau
  semua nilai yang dibutuhkan sudah Anda siapkan.

## P3 — Ditunda dengan sengaja, bukan blocker launch

Semua ini **[ANDA]** keputusan kapan mulai, tapi **bukan sesuatu yang perlu dikerjakan
sekarang**:
- EVM/Robinhood Chain — sudah sengaja ditunda per instruksi Anda sendiri.
- Audit keamanan pihak ketiga — jadwalkan sekarang supaya mulai paralel/segera setelah
  launch, bukan "nanti saja".
- Multisig (Squads) kalau P1 memilih terima risiko single-key dulu.
- Kebijakan unclaimed-reward (deadline/sweep).
- CI yang menjalankan test suite di setiap PR, load/chaos testing.

---

## Ringkasan singkat

Dari seluruh P0, **hampir semua langkah teknis murni butuh Anda** karena satu dari tiga
alasan: (1) sandbox ini tidak punya toolchain Solana/Anchor nyata dan diblokir ke host yang
dibutuhkan untuk installnya, (2) langkahnya butuh kredensial/akun pihak ketiga yang hanya
Anda yang bisa buat (RPC, Birdeye, X Developer App, VPS/PaaS, wallet berisi SOL asli), atau
(3) ini keputusan bisnis/keamanan/legal, bukan keputusan teknis.

Peran saya yang sebenarnya di fase ini: **menunggu output nyata** (error `anchor
build`/`anchor test`, hasil `docker compose up`, program id dari `anchor keys list`) lalu
memperbaiki kode berdasarkan itu — bukan menebak-nebak dari sandbox yang tidak bisa
menjalankan toolchain-nya sendiri. Langkah paling pertama yang benar-benar memajukan
proyek ini: **Anda menjalankan `anchor build` di mesin dengan toolchain asli, lalu kirim
hasilnya ke saya** — apa pun hasilnya, sukses atau error.
