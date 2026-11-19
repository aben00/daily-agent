# DailyAgent — daily check-in badges for Agent ID holders

Entry for the **Binance Agent ID Hackathon** (submission period 18 Nov – 9 Dec 2026,
deadline **9 Dec 2026 15:00 WIB**). Total prize pool 60,000 USDC.

DailyAgent is a free daily check-in: any Binance Agent ID holder can check in
once per UTC day and receive a badge NFT. No token, no rewards, no earnings —
the badge is just proof you showed up. The contract has **no owner, no fees,
no pause switch and no admin functions of any kind**.

- Project name: **DailyAgent**
- Chain: BNB Chain (56)
- Deployer: `0x4dbC1aFeDD4424Bf29a09f2477D190A9A709B889` (Agent ID `taitai`)
- Site (after deploy): https://aben00.github.io/daily-agent/
- Source: https://github.com/aben00/daily-agent (to be pushed by the owner)

## Architecture

```
site/                  static frontend (no build step, no backend)
  index.html           page
  app.js               vanilla JS, window.ethereum only
  badge.svg            badge artwork
  meta/1, meta/2, ...  sample badge metadata (extensionless, see below)
src/DailyAgent.sol     the whole dApp: minimal ERC-721 + check-in logic
test/                  forge tests (unit + BSC fork)
script/Deploy.s.sol    deployment script (dry-run only in this repo)
```

### Contract (`src/DailyAgent.sol`, Solidity ^0.8.20)

- `checkIn()` — nonpayable, value 0. Requires `registry.balanceOf(msg.sender) > 0`
  (the caller holds an Agent ID). One check-in per UTC day per wallet
  (`block.timestamp / 1 days`). Mints a badge NFT, sequential tokenIds from 1.
- Tracks per address: `totalCheckIns`, `currentStreak` (consecutive UTC days,
  resets to 1 after a missed day), `lastCheckInDay`; plus `totalCheckInsGlobal()`.
- `tokenURI(tokenId)` = `baseURI` + decimal tokenId, e.g.
  `https://aben00.github.io/daily-agent/meta/1`.
- Minimal ERC-721 written inline (Solmate-style, ~5.2 KB runtime): `balanceOf`,
  `ownerOf`, `transferFrom`, `safeTransferFrom`, `approve`, `setApprovalForAll`,
  `tokenURI`, ERC-165. Badges are normal transferable NFTs.
- `registry` is `immutable`; `baseURI` is set once in the constructor and has
  **no setter**. There is no `owner()`, no pause, no fee, no withdraw.
- Event: `CheckIn(address indexed user, uint256 indexed tokenId, uint256 day, uint256 streak)`.

### How Agent ID is used (identity + access control)

1. **Gate:** `checkIn()` calls `balanceOf` on the SPACE ID Agent ID registry
   (`0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F`). Only Agent ID holders pass.
2. **One human, one check-in:** Agent ID is non-transferable and one per user,
   so one wallet = one identity = one check-in per day. No Sybil farming.
3. **Streaks as reputation:** consecutive-day streaks are stored per address
   and readable by any other dApp — a lightweight, portable proof of
   showing up.

### Frontend (`site/`)

- Static HTML + vanilla JS. Connects only via the injected provider
  (`window.ethereum`: MetaMask / Binance Wallet in-app browser).
- **No QR login, no WalletConnect, no server, no sessions, no credentials.**
  The only transaction is `checkIn()` with value 0, sent through the user's
  own wallet confirmation prompt.
- Shows: Agent ID held?, today's check-in status, streak + total, a Check In
  button, the user's badges (read from `CheckIn` events), and global stats
  (read via the public BSC RPC, no wallet needed).
- Badge history needs `DEPLOY_BLOCK` set in `app.js` after deployment.

### Metadata

`tokenURI` appends the bare tokenId (no extension), so metadata files are
**extensionless**: `site/meta/1`, `site/meta/2`, … (plain JSON). When pushing
to GitHub Pages, keep them extensionless at `meta/` in the repo root.
Sample files for tokens 1–3 are included; later tokens resolve to the same
shape (name `DailyAgent Badge #N`, image `badge.svg`).

## Hackathon red-line compliance

| Rule (from the announcement) | How DailyAgent complies |
|---|---|
| No web-based QR login / stored sessions | Frontend uses only `window.ethereum`; nothing is stored server-side (there is no server) |
| No bypassing user tx confirmation | `checkIn()` is a normal wallet transaction; the user confirms it in their own wallet |
| No unauthorized asset transfers | The contract never moves user funds; `checkIn()` is nonpayable and takes no value |
| Contracts open-source, owner permissions disclosed | Source is MIT (see `LICENSE`); there are **no** owner permissions at all — no owner, no pause, no fee, no withdraw |
| No Binance/BNB brand impersonation | Name `DailyAgent`, token `DailyAgent Badge` / `DAGENT`, domain `aben00.github.io/daily-agent` — no Binance/BNB naming |
| No collection of seeds/keys/API secrets | Nothing is ever asked for or collected |
| No promised returns | Copy says plainly: free, gas only; no token, no rewards, no earnings |
| No "look up other people's wallets by name" | The site never resolves names to wallets; it only checks the *connected* wallet's own Agent ID |
| No fake volume / mass accounts | One Agent ID per human by construction; no incentives to farm |

## Tests

```bash
cd ~/workspace/dailyagent
forge test            # 18 tests: 13 unit (mock registry) + 5 BSC fork (real registry)
```

Unit tests cover: non-holder reverts; same-day second check-in reverts;
next-day check-in succeeds; badge ownership + `tokenURI`; streak increments
on consecutive days and resets after a missed day; per-user and global
counts; event emission; badge transferability; no-owner/no-admin;
`checkIn()` rejects value.

Fork tests (pinned BSC block 134461610, responses cached by Foundry) use the
real registry: the deployer wallet `0x4dbC…B889` (Agent ID `taitai`) holds an
Agent ID and can check in; a random address reverts.

**Results (2026-11-19): 18 passed, 0 failed.**

## Deployment prep (measured, not broadcast)

Measured on a pinned BSC fork (block 134461610) and cross-checked with live
`eth_estimateGas`:

| Item | Value |
|---|---|
| Deploy gas (live estimate) | **1,310,652** (forge dry-run reports 1,688,926 — its estimate × ~1.3 buffer) |
| Deploy cost at 0.05 gwei | ~0.0000655 BNB |
| Deploy cost at 0.08 gwei | ~0.000105 BNB |
| Deployer balance | ~0.000471 BNB (deploy ≈ 22% of it at 0.08 gwei) |
| First `checkIn()` gas | ~171,194 (cold storage) ≈ 0.0000137 BNB at 0.08 gwei |
| Later `checkIn()` gas | ~100,000 est. on mainnet ≈ 0.000008 BNB at 0.08 gwei |
| Contract size | 5,176 bytes runtime / 6,073 bytes init |
| Predicted address (deployer nonce 122) | **`0xF664d692c64d4F45b03e095CCC15a0Bcdd43486c`** |

The predicted address is valid **only if this deployment is the deployer's
next transaction (nonce 122)**. Re-check the nonce before deploying:
`cast nonce 0x4dbC1aFeDD4424Bf29a09f2477D190A9A709B889 --rpc-url https://bsc-dataseed.binance.org`
and recompute with `cast compute-address … --nonce <n>` if it changed.
The prediction was verified three ways (cast, forge dry-run simulation,
independent rlp+keccak) — all agree.

## Deployment steps (for the parent — nothing here broadcasts)

1. **Re-check the nonce** (see above). If it is not 122, the predicted
   address changes — recompute it and update `site/app.js` + this README.
2. **Deploy** (signing goes through the parent's normal wallet flow; this
   script takes no private key):
   ```bash
   forge script script/Deploy.s.sol \
     --rpc-url https://bsc-dataseed.binance.org \
     --broadcast \
     --sender 0x4dbC1aFeDD4424Bf29a09f2477D190A9A709B889
   ```
   Dry-run first (no `--broadcast`) to confirm the simulation, as was done
   for the measurements above.
3. **Verify on BscScan** (needs a free BscScan API key):
   ```bash
   forge verify-contract --chain-id 56 --compiler-version v0.8.24 \
     --num-of-optimizations 200 <DEPLOYED_ADDRESS> \
     src/DailyAgent.sol:DailyAgent \
     --constructor-args 0x00000000000000000000000060b9262456de011f7d15a54cdd8c48baaa8b022f0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000002a68747470733a2f2f7265776172642e6769746875622e696f2f6461696c792d6167656e742f6d6574612f0000000000000000000000000000000000000000000000 \
     --etherscan-api-key $BSCSCAN_API_KEY
   ```
   Constructor args are `(registry, baseURI)` = the registry above and
   `https://aben00.github.io/daily-agent/meta/`.
4. **Publish the site:** push the *contents* of `site/` to the root of the
   `aben00/daily-agent` GitHub repo and enable GitHub Pages. Then set
   `CONTRACT_ADDRESS` and `DEPLOY_BLOCK` at the top of `site/app.js` to the
   real values and push again.
5. **Submit** to the hackathon with the blurb below, then promote the
   check-in in Agent ID groups / on X — the Innovation Award needs **≥ 30
   Agent ID addresses interacting** during the submission period.

## Draft submission blurb

**Project name:** DailyAgent

**Description:** DailyAgent is a free daily check-in for Binance Agent ID
holders. Holders check in once per UTC day and receive a badge NFT; checking
in on consecutive days builds a visible streak. There is no token, no reward
and no fee — just a simple, honest proof of showing up. The contract has no
owner, no pause switch and no admin functions at all.

**How Agent ID is used:** Agent ID is the product's identity and access
control. `checkIn()` requires the caller to hold an Agent ID
(`registry.balanceOf > 0`), and because Agent ID is non-transferable and one
per user, one wallet equals one identity — one check-in per day, no Sybil
farming. Streaks and totals are stored per address and readable by any other
dApp, making DailyAgent a portable proof-of-attendance layer for the Agent ID
ecosystem.

## Files

- `src/DailyAgent.sol` — contract
- `test/DailyAgent.t.sol` — 13 unit tests (mock registry)
- `test/DailyAgentFork.t.sol` — 5 fork tests (real registry, pinned block)
- `script/Deploy.s.sol` — deployment script
- `site/index.html`, `site/app.js` — frontend
- `site/badge.svg`, `site/meta/1`, `site/meta/2`, `site/meta/3` — artwork + metadata
- `foundry.toml`, `lib/forge-std` — build config (forge-std vendored locally)
