# Tutorial: dari toolchain kosong sampai mainnet (Solana)

Tutorial ini untuk dikerjakan **di luar sandbox ini**, di komputer/VM kamu sendiri yang punya
akses internet normal (sandbox agent ini tidak bisa install `solana`/`anchor` CLI atau
menyentuh devnet/mainnet sama sekali — itu kenapa semua langkah di bawah harus kamu jalankan
sendiri). Urutannya mengikuti P0 di `docs/SOLANA_MAINNET_LAUNCH_PLAN.md`. Jangan lompat
langkah — tiap langkah gagal, kamu akan tahu di sini, bukan setelah mainnet.

Versi yang dipakai kode ini: **anchor-lang 0.30.1**, **solana-program 1.18.26**. Install versi
itu persis, jangan "latest", supaya tidak ada mismatch ABI/IDL yang bikin error aneh.

---

## 0. Install toolchain

Di Linux/macOS:

```bash
# Rust (kalau belum ada)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Solana CLI 1.18.26
sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana --version   # harus muncul "solana-cli 1.18.26 ..."

# AVM (Anchor Version Manager) lalu Anchor CLI 0.30.1
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.30.1
avm use 0.30.1
anchor --version   # harus muncul "anchor-cli 0.30.1"

# Node.js 18+ dan npm (kalau belum ada) -- cek dulu:
node --version
npm --version
```

Kalau pakai Windows, pakai WSL2 (Ubuntu) — Solana CLI tidak disupport native di Windows.

Generate keypair lokal kalau belum punya (ini jadi wallet default Anchor/Solana CLI kamu):

```bash
solana-keygen new --outfile ~/.config/solana/id.json
```

**Simpan seed phrase yang muncul di tempat aman.** Ini bukan hal yang bisa di-skip — kalau
hilang, wallet itu hilang permanen.

---

## 1. Clone repo dan build

```bash
git clone https://github.com/whobotsai/scp-mockup.git
cd scp-mockup/contracts-solana
anchor build
```

`anchor build` akan compile ketiga program (`sho_solana`, `sso_solana`, `registry_solana`) ke
BPF/SBF. **Ini pertama kalinya kode ini pernah di-compile ke target Solana yang sebenarnya** —
`cargo check` yang sudah jalan di sandbox hanya mengecek compile ke target native, bukan BPF.
Ada kemungkinan nyata muncul error baru di sini (terutama soal ukuran account/rent —
`sso_solana`'s `Campaign.epochs: Vec<Epoch>` dengan `MAX_EPOCHS=90` belum pernah benar-benar
diukur terhadap aturan rent Solana yang asli).

**Kalau `anchor build` gagal**: baca error-nya pelan-pelan, biasanya soal account space
(`space = 8 + X::INIT_SPACE` kurang/lebih dari yang dihitung Anchor) atau versi dependency yang
tidak cocok. Laporkan error lengkapnya — itu akan jadi bug report pertama yang nyata dari kode
ini.

---

## 2. Ganti placeholder program ID

Program ID yang ada sekarang (`declare_id!(...)` di tiap `lib.rs`, dan `Anchor.toml`) adalah
**placeholder** — bukan kunci yang dikontrol siapa pun, dan sengaja dibiarkan sama antar semua
clone repo ini. Setelah `anchor build`, Anchor sudah generate keypair asli untuk tiap program di
`target/deploy/*-keypair.json`. Lihat ID aslinya:

```bash
anchor keys list
```

Outputnya tiga baris seperti:
```
sho_solana: <ID_ASLI_1>
sso_solana: <ID_ASLI_2>
registry_solana: <ID_ASLI_3>
```

Ganti placeholder dengan ID asli itu di **4 tempat**:

1. `programs/sho_solana/src/lib.rs` — baris `declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");`
2. `programs/sso_solana/src/lib.rs` — baris `declare_id!("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");`
3. `programs/registry_solana/src/lib.rs` — baris `declare_id!("E6pYGM6cDh1WqLjkDRMfvwMMGBD6CWQSfA3msuNYMy3Y");`
4. `Anchor.toml` — section `[programs.localnet]`, ketiga baris sekaligus.

Cara cepat (jalankan dari `contracts-solana/`, setelah `anchor keys list`):

```bash
SHO_ID=$(anchor keys list | grep sho_solana | awk '{print $2}')
SSO_ID=$(anchor keys list | grep sso_solana | awk '{print $2}')
REGISTRY_ID=$(anchor keys list | grep registry_solana | awk '{print $2}')

sed -i "s/Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS/$SHO_ID/" programs/sho_solana/src/lib.rs Anchor.toml
sed -i "s/9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin/$SSO_ID/" programs/sso_solana/src/lib.rs Anchor.toml
sed -i "s/E6pYGM6cDh1WqLjkDRMfvwMMGBD6CWQSfA3msuNYMy3Y/$REGISTRY_ID/" programs/registry_solana/src/lib.rs Anchor.toml
```

Lalu build ulang (ID program adalah bagian dari binary, jadi harus di-rebuild):

```bash
anchor build
```

**Commit perubahan ini** (`git add -A && git commit -m "..."`) supaya ID asli ini tersimpan di
repo dan tidak perlu diulang tiap kali clone baru — tapi **jangan pernah commit isi file
`target/deploy/*-keypair.json`** (itu private key program; `.gitignore` sudah exclude seluruh
`/target`, jadi otomatis aman asal kamu tidak paksa `git add -f`).

---

## 3. Jalankan TS test suite

Test suite-nya (`tests/sho.ts`, `tests/sso.ts`, `tests/registry.ts`) sudah ditulis lengkap di
sandbox ini dan sudah lolos `tsc --noEmit`, tapi **belum pernah benar-benar dijalankan** — itu
butuh `target/idl/*.json` dan `target/deploy/*.so` hasil `anchor build` di langkah 1-2, yang
tidak bisa dihasilkan di sandbox.

```bash
cd contracts-solana
npm install
anchor test
```

`anchor test` otomatis: compile ulang kalau perlu, start local validator sementara, lalu
jalankan `npm test` (`ts-mocha` atas ketiga file test) terhadap validator itu — ini yang
dimaksud `[scripts] test` di `Anchor.toml`.

**Harapkan ini menemukan bug nyata.** Test ini ditulis dengan membaca source Rust baris demi
baris, tapi belum pernah benar-benar jalan — kemungkinan ada: nama field Anchor-encoded yang
salah tebak (camelCase konversi dari Rust), urutan/nama account di `.accounts({...})` yang
tidak pas sama urutan di `#[derive(Accounts)]`, atau kesalahan logic di program Rust-nya
sendiri yang baru kelihatan sekarang. **Perbaiki semuanya sampai hijau sebelum lanjut ke
langkah 4** — jangan deploy ke devnet dengan test yang masih merah.

Kalau ada test yang gagal dan kamu tidak yakin kenapa, tempel error lengkapnya (termasuk nama
test yang gagal) — itu akan jauh lebih cepat didiagnosis dengan pesan error asli di tangan.

---

## 4. Deploy ke devnet

Setup wallet & cluster:

```bash
solana config set --url devnet
solana config set --keypair ~/.config/solana/id.json
solana airdrop 2   # devnet SOL gratis; ulangi beberapa kali kalau limit rate
solana balance
```

Update `Anchor.toml` supaya provider cluster-nya devnet (atau pass `--provider.cluster devnet`
tiap command):

```toml
[provider]
cluster = "devnet"
wallet = "~/.config/solana/id.json"
```

Deploy ketiga program:

```bash
anchor deploy --provider.cluster devnet
```

Ini butuh SOL devnet lumayan (deploy program ukuran sedang bisa makan 2-5 SOL per program
untuk rent-exempt buffer account) — kalau airdrop kurang, ulangi `solana airdrop 2` beberapa
kali (devnet faucet biasanya rate-limited per alamat per jam).

Setelah sukses, catat tiga program ID yang sama dengan `anchor keys list` di langkah 2 (deploy
tidak mengubah ID, cuma mem-publish binary-nya on-chain di ID itu).

---

## 5. Inisialisasi config tiap program

Belum ada yang pernah memanggil `initialize_config` untuk program mana pun — itu wajib sebelum
`create_campaign_sol`/`register_handle`/dll bisa dipakai (mereka semua butuh PDA `config` yang
sudah ada). Script `scripts/initialize.ts` sudah ditulis untuk ini:

```bash
cd contracts-solana
SOLANA_RPC_URL=https://api.devnet.solana.com \
AUTHORITY_KEYPAIR=$HOME/.config/solana/id.json \
npm run initialize
```

Default-nya, `treasury`/`keeper`/`attestor` di-set ke address kamu sendiri (authority) — ini
cuma placeholder sementara untuk devnet, **sama seperti pola `contracts/scripts/deploy.js` di
sisi EVM**. Kalau sudah punya wallet keeper/attestor/treasury yang sungguhan (lihat
`keeper/.env.example`'s `SOLANA_KEEPER_PRIVATE_KEY` dan
`registration-service/.env.example`'s `SOLANA_ATTESTOR_PRIVATE_KEY`), kasih address publiknya
lewat env:

```bash
SOLANA_RPC_URL=https://api.devnet.solana.com \
AUTHORITY_KEYPAIR=$HOME/.config/solana/id.json \
TREASURY_ADDRESS=<pubkey treasury> \
KEEPER_ADDRESS=<pubkey keeper> \
ATTESTOR_ADDRESS=<pubkey attestor> \
npm run initialize
```

Script ini idempotent — kalau config sudah ada, dia skip (tidak akan error atau double-init).

---

## 6. Live end-to-end smoke test (devnet)

Ini langkah paling penting di P0 — belum ada satu pun bagian dari flow Solana ini yang pernah
benar-benar dicoba hidup-hidup (program on-chain, RPC devnet asli, Birdeye API asli, X API
asli). Set env var berikut di `keeper/.env`, `api/.env`, `registration-service/.env` (lihat
`.env.example` masing-masing untuk nama lengkap):

```
# keeper/.env
SOLANA_RPC_URL=https://api.devnet.solana.com
SHO_SOLANA_PROGRAM_ID=<ID dari anchor keys list>
SSO_SOLANA_PROGRAM_ID=<ID dari anchor keys list>
REGISTRY_SOLANA_PROGRAM_ID=<ID dari anchor keys list>
SOLANA_KEEPER_PRIVATE_KEY=<base58 secret key wallet keeper, format Phantom>
BIRDEYE_API_KEY=<dari birdeye.so>

# api/.env
SOLANA_RPC_URL=https://api.devnet.solana.com
BIRDEYE_API_KEY=<sama>

# registration-service/.env
SOLANA_ATTESTOR_PRIVATE_KEY=<base58 secret key wallet attestor>
```

Lalu jalankan flow SHO secara manual, sekali, end-to-end:

1. Start `keeper`, `api`, `registration-service` (`npm start` masing-masing).
2. Dari frontend (`public/index.html`, atau `firebase serve` di `homepage-sho/`), pilih network
   Solana, connect wallet devnet (Phantom di-set ke devnet), buat campaign SHO baru dengan
   token devnet apa pun yang ada likuiditasnya di Birdeye/DexScreener devnet (**catatan**:
   Birdeye/DexScreener kemungkinan besar datanya minim/tidak ada untuk token devnet acak —
   kalau leaderboard/price sample kosong, itu ekspektasi, bukan bug; validasi flow-nya tetap
   bisa dilakukan dengan root yang di-post manual lewat `post_milestone_root` kalau perlu).
3. Lakukan beberapa swap dari wallet devnet lain supaya ada trader di leaderboard.
4. Tunggu `keeper`'s `solanaOnchainPoster.js` mendeteksi milestone tercapai dan post root
   (atau pakai `anchor run` / script manual kalau mau trigger lebih cepat).
5. Claim dari wallet trader itu lewat UI, pastikan SOL/SPL reward benar-benar masuk.
6. Ulangi pola yang sama untuk SSO: link X account (`/auth/x/start?network=solana`), buat
   campaign SSO, post dari X dengan keyword campaign, tunggu epoch berakhir, `post_epoch_root`,
   claim.

**Catat setiap langkah yang gagal atau berperilaku tidak sesuai ekspektasi** — ini bukan
sekadar smoke test formalitas, ini pertama kalinya seluruh rangkaian ini divalidasi sama
sekali.

---

## 7. Deploy ke mainnet

**Jangan kerjakan ini sampai langkah 1-6 di atas semuanya hijau/berhasil.** Mainnet pakai SOL
asli — kesalahan di sini berarti uang hilang, bukan cuma waktu.

```bash
solana config set --url mainnet-beta
solana config set --keypair ~/.config/solana/id.json   # atau keypair mainnet yang berbeda -- lihat catatan di bawah
```

**Catatan keamanan**: jangan pakai keypair devnet yang sama untuk authority mainnet kalau
keypair itu sempat disimpan di mesin dev/CI/sandbox mana pun selama proses testing. Generate
keypair baru khusus mainnet authority, simpan di tempat paling aman yang kamu punya (hardware
wallet kalau bisa), dan jangan pernah ketik/paste private key-nya ke chat manapun termasuk ke
Claude.

```bash
anchor deploy --provider.cluster mainnet-beta
```

Deploy mainnet makan SOL asli untuk rent program buffer (perkiraan beberapa SOL per program,
cek `solana program show <program-id>` buat lihat ukuran persis setelah build). Pastikan
wallet authority sudah terisi SOL asli sebelum ini (beli dari exchange, bukan airdrop — mainnet
tidak ada faucet).

Lalu inisialisasi config, sama seperti langkah 5 tapi arahkan ke mainnet RPC dan **gunakan
address treasury/keeper/attestor yang sungguhan**, bukan default ke authority:

```bash
SOLANA_RPC_URL=<RPC mainnet, misalnya dari Helius/Triton/QuickNode -- JANGAN pakai
  api.mainnet-beta.solana.com publik untuk produksi, itu rate-limit ketat dan tidak reliable> \
AUTHORITY_KEYPAIR=<path keypair authority mainnet> \
TREASURY_ADDRESS=<treasury sungguhan> \
KEEPER_ADDRESS=<keeper sungguhan> \
ATTESTOR_ADDRESS=<attestor sungguhan> \
npm run initialize
```

Update `keeper/.env`, `api/.env`, `registration-service/.env` di server produksi dengan RPC URL
+ program ID mainnet yang sama, lalu jalankan smoke test kecil sekali lagi dengan dana minimal
sebelum membuka ke publik — persis P0's poin terakhir, tapi di mainnet dengan uang sungguhan
dalam jumlah yang sengaja dibuat kecil.

---

## Ringkasan urutan command (devnet)

Kalau semua langkah di atas sudah jelas, ini ringkasan command-nya saja:

```bash
# 0-1
git clone https://github.com/whobotsai/scp-mockup.git && cd scp-mockup/contracts-solana
anchor build

# 2
anchor keys list
# -- edit declare_id!() x3 + Anchor.toml manual atau pakai sed di atas --
anchor build

# 3
npm install && anchor test
# -- perbaiki semua yang merah --

# 4
solana config set --url devnet
solana airdrop 2
anchor deploy --provider.cluster devnet

# 5
SOLANA_RPC_URL=https://api.devnet.solana.com AUTHORITY_KEYPAIR=$HOME/.config/solana/id.json npm run initialize

# 6 -- jalankan keeper/api/registration-service, tes manual lewat frontend
```

Setelah ini semua hijau, lanjut ke langkah 7 (mainnet) di atas.
