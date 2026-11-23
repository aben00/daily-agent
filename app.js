/* DailyAgent frontend — vanilla JS, no dependencies, no backend.
 *
 * Connects only through the injected provider (window.ethereum), e.g.
 * MetaMask or the Binance Wallet in-app browser. NO QR login, NO
 * WalletConnect, NO server sessions, NO credentials collected.
 * Every state-changing action is a normal wallet transaction that the
 * user sees and confirms in their own wallet.
 *
 * Selectors below are taken from the compiled contract ABI
 * (out/DailyAgent.sol/DailyAgent.json) — do not hand-edit them.
 */
"use strict";

/* ============================== CONFIG ============================== */
/* Deployed 2026-11-19 ~14:37 WIB by the user's Binance Wallet account
 * (NOT the baw wallet 0x4dbC…B889 — the in-app browser connected the
 * user's main account, so the address differs from the 0xF664… prediction). */
const CONTRACT_ADDRESS = "0x0EebF5Aca8a2C622f91cD8c816e789579719cf47";
/* First CheckIn was in block 134465382 (badge #1). The deploy itself is
 * in (134465169, 134465382]; using the first check-in block as the scan
 * start loses nothing — no contract events exist before it. */
const DEPLOY_BLOCK = 134465382; // first block of the deployed contract (for badge history)
const REGISTRY_ADDRESS = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"; // SPACE ID Agent ID
const PUBLIC_RPC = "https://bsc-dataseed.binance.org"; // read-only fallback
const BSC_CHAIN_ID = 56;

/* Reward + Market are NOT deployed yet — the art and metadata are live,
 * the contracts deploy next from the owner's phone wallet. Until the
 * addresses below are set, these sections show "not deployed yet". */
const REWARD_ADDRESS = "0x0000000000000000000000000000000000000000";
const MARKET_ADDRESS = "0x0000000000000000000000000000000000000000";
const TIERS = [
  { key: "grandmaster", name: "Grandmaster", cap: 200, armor: "Silver" },
  { key: "epic", name: "Epic", cap: 180, armor: "Green" },
  { key: "legend", name: "Legend", cap: 140, armor: "Gold" },
  { key: "mythic", name: "Mythic", cap: 110, armor: "Gold & Purple" },
  { key: "mythical-honor", name: "Mythical Honor", cap: 70, armor: "Purple, Blue & Gold" },
  { key: "mythical-glory", name: "Mythical Glory", cap: 50, armor: "Diamond Purple & Gold" },
  { key: "mythical-immortal", name: "Mythical Immortal", cap: 27, armor: "Diamond Blue & Purple, Gold, Winged" },
];
const isRewardDeployed = () =>
  REWARD_ADDRESS !== "0x0000000000000000000000000000000000000000";
const isMarketDeployed = () =>
  MARKET_ADDRESS !== "0x0000000000000000000000000000000000000000";

/* Selectors (verified from the compiled ABI) */
const SEL = {
  checkIn: "0x183ff085", // checkIn()
  lastCheckInDay: "0xc483da22", // lastCheckInDay(address)
  totalCheckIns: "0x828e1ffd", // totalCheckIns(address)
  currentStreak: "0x5c45f739", // currentStreak(address)
  totalCheckInsGlobal: "0x0cdbd5f5", // totalCheckInsGlobal()
  balanceOf: "0x70a08231", // balanceOf(address)
  ownerOf: "0x6352211e", // ownerOf(uint256)
  tokenURI: "0xc87b56dd", // tokenURI(uint256)
  nextTokenId: "0x75794a3c", // nextTokenId()
  claim: "0x4e71d92d", // claim()
  claimed: "0xc884ef83", // claimed(address)
  totalMinted: "0xa2309ff8", // totalMinted()
  remaining: "0x55234ec0", // remaining()
  tierOf: "0x53f96df2", // tierOf(uint256)
  tierMinted: "0xb8b1ccc8", // tierMinted(uint256)
  tierCaps: "0x157003d9", // tierCaps(uint256)
  isApprovedForAll: "0xe985e9c5", // isApprovedForAll(address,address)
  setApprovalForAll: "0xa22cb465", // setApprovalForAll(address,bool)
  list: "0x50fd7367", // list(uint256,uint256)
  buy: "0xd96a094a", // buy(uint256)
  cancel: "0x40e58ee5", // cancel(uint256)
  activeCount: "0x4331ed1f", // activeCount()
  activeAt: "0x15d6f71a", // activeAt(uint256)
  listings: "0xde74e57b", // listings(uint256)
};
const CHECKIN_TOPIC =
  "0xf70c8ccfb49937cb9079ffa719be60366bdb8f901313f28dd3da4e482977a7fa"; // CheckIn(address,uint256,uint256,uint256)

/* ============================== helpers ============================== */
const $ = (id) => document.getElementById(id);
const isDeployed = () =>
  CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000";
const shortAddr = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const todayDay = () => Math.floor(Date.now() / 1000 / 86400);

function encodeAddressArg(addr) {
  return "000000000000000000000000" + addr.slice(2).toLowerCase();
}
function decodeUint(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt("0x" + hex.slice(-64));
}
function decodeString(hex) {
  const d = hex.slice(2);
  const off = parseInt(d.slice(0, 64), 16) * 2;
  const len = parseInt(d.slice(off, off + 64), 16);
  const bytes = d.slice(off + 64, off + 64 + len * 2);
  const out = [];
  for (let i = 0; i < bytes.length; i += 2) out.push(parseInt(bytes.slice(i, i + 2), 16));
  return new TextDecoder().decode(new Uint8Array(out));
}
function encodeUintArg(n) {
  return BigInt(n).toString(16).padStart(64, "0");
}
function encodeBoolArg(b) {
  return (b ? "1" : "0").padStart(64, "0");
}
function parseBnbToWei(s) {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(s);
  if (!m) throw new Error("bad price");
  return BigInt(m[1]) * 10n ** 18n + BigInt((m[2] || "").padEnd(18, "0"));
}
function weiToBnb(wei) {
  const w = BigInt(wei);
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? whole.toString() + "." + frac : whole.toString();
}
async function waitReceipt(txHash) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const rc = await rpc("eth_getTransactionReceipt", [txHash]);
    if (rc) return rc;
  }
  return null;
}

/* Read-only JSON-RPC against the public node (no wallet needed). */
async function rpc(method, params) {
  const res = await fetch(PUBLIC_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}
async function publicCall(to, data) {
  return rpc("eth_call", [{ to, data }, "latest"]);
}
async function publicUint(to, data) {
  return decodeUint(await publicCall(to, data));
}

/* ============================== global stats ============================== */
/* Unique holders via an ownerOf scan. eth_getLogs is range-limited on
 * the public nodes (5000 blocks), so counting distinct CheckIn senders
 * from logs is unreliable here — ownerOf calls have no range limit.
 * Badge IDs run 1..nextTokenId; a missing ID is skipped. */
async function refreshProgress(minted) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const total = Number(minted);
      const uniq = new Set();
      const BATCH = 8;
      for (let s = 1; s <= total; s += BATCH) {
        const batch = [];
        for (let id = s; id < Math.min(s + BATCH, total + 1); id++) batch.push(id);
        const results = await Promise.all(
          batch.map((id) =>
            publicCall(CONTRACT_ADDRESS, SEL.ownerOf + id.toString(16).padStart(64, "0"))
              .then((hex) => "0x" + hex.slice(-40).toLowerCase())
              .catch(() => null)
          )
        );
        for (const a of results) if (a) uniq.add(a);
      }
      const n = uniq.size;
      $("uniqueHolders").textContent = n.toString();
      $("hackCount").textContent = n.toString();
      $("hackBar").style.width = Math.min(100, (n / 30) * 100) + "%";
      $("hackNote").textContent =
        n >= 30
          ? "Goal reached — 30 unique Agent IDs checked in. Ready to submit!"
          : 30 - n + " more unique Agent ID check-ins to go · Submit before 9 Dec 2026, 15:00 WIB.";
      return;
    } catch (e) {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  $("uniqueHolders").textContent = "—";
  $("hackCount").textContent = "—";
  $("hackNote").textContent =
    "Live count unavailable right now — check-ins are still safe on-chain.";
}

async function refreshGlobal() {
  $("contractAddr").textContent = isDeployed()
    ? shortAddr(CONTRACT_ADDRESS)
    : "not deployed yet";
  $("bscLink").href = isDeployed()
    ? "https://bscscan.com/address/" + CONTRACT_ADDRESS
    : "https://bscscan.com/";
  if (!isDeployed()) {
    $("globalTotal").textContent = "—";
    $("globalBadges").textContent = "—";
    $("uniqueHolders").textContent = "—";
    $("hackCount").textContent = "—";
    $("hackNote").textContent = "Contract not deployed yet.";
    return;
  }
  try {
    const [total, minted] = await Promise.all([
      publicUint(CONTRACT_ADDRESS, SEL.totalCheckInsGlobal),
      publicUint(CONTRACT_ADDRESS, SEL.nextTokenId),
    ]);
    $("globalTotal").textContent = total.toString();
    $("globalBadges").textContent = minted.toString();
    refreshProgress(minted);
  } catch (e) {
    $("globalTotal").textContent = "unavailable";
    $("globalBadges").textContent = "unavailable";
  }
}

/* ============================== wallet ============================== */
let account = null;

function setStatus(el, html) {
  $(el).innerHTML = html;
}

async function connect() {
  if (!window.ethereum) {
    setStatus(
      "connectStatus",
      "No wallet found in this browser. Open this page in MetaMask or the Binance Wallet in-app browser."
    );
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    account = accounts[0];
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (parseInt(chainId, 16) !== BSC_CHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x38" }],
        });
      } catch (e) {
        setStatus(
          "connectStatus",
          "Please switch your wallet to BNB Chain (chain ID 56) and reconnect."
        );
        return;
      }
    }
    $("walletBox").hidden = true;
    $("accountBox").hidden = false;
    $("myAddr").textContent = shortAddr(account);
    await refreshMy();
    await loadBadges();
    await refreshReward();
    await refreshMarket();
    await loadMyDinos();
  } catch (e) {
    setStatus("connectStatus", "Connection cancelled. Tap Connect to try again.");
  }
}

async function refreshMy() {
  if (!account) return;
  try {
    const [hasId, lastDay, streak, total, badges] = await Promise.all([
      publicUint(REGISTRY_ADDRESS, SEL.balanceOf + encodeAddressArg(account)),
      publicUint(CONTRACT_ADDRESS, SEL.lastCheckInDay + encodeAddressArg(account)),
      publicUint(CONTRACT_ADDRESS, SEL.currentStreak + encodeAddressArg(account)),
      publicUint(CONTRACT_ADDRESS, SEL.totalCheckIns + encodeAddressArg(account)),
      publicUint(CONTRACT_ADDRESS, SEL.balanceOf + encodeAddressArg(account)),
    ]);
    const holdsId = hasId > 0n;
    $("myAgentId").innerHTML = holdsId
      ? '<span class="pill yes">Yes — Agent ID held</span>'
      : '<span class="pill no">No Agent ID on this address</span>';
    const checkedInToday = Number(lastDay) === todayDay();
    $("myToday").innerHTML = checkedInToday
      ? '<span class="pill yes">Checked in today</span>'
      : '<span class="pill idle">Not checked in yet today</span>';
    $("myStreak").textContent = streak.toString() + (streak === 1n ? " day" : " days");
    $("myTotal").textContent = total.toString();
    $("myBadges").textContent = badges.toString();

    const btn = $("checkInBtn");
    if (!isDeployed()) {
      btn.disabled = true;
      btn.textContent = "Contract not deployed yet";
    } else if (!holdsId) {
      btn.disabled = true;
      btn.textContent = "Need an Agent ID to check in";
    } else if (checkedInToday) {
      btn.disabled = true;
      btn.textContent = "Already checked in — come back tomorrow";
    } else {
      btn.disabled = false;
      btn.textContent = "Check in for today";
    }
  } catch (e) {
    setStatus("txStatus", "Could not read your status. Check your connection and refresh.");
  }
}

async function doCheckIn() {
  if (!isDeployed()) return;
  const btn = $("checkInBtn");
  btn.disabled = true;
  btn.textContent = "Waiting for wallet…";
  setStatus("txStatus", "");
  try {
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from: account, to: CONTRACT_ADDRESS, data: SEL.checkIn, value: "0x0" }],
    });
    setStatus(
      "txStatus",
      'Check-in sent. <a href="https://bscscan.com/tx/' +
        txHash +
        '" target="_blank" rel="noopener">View on BscScan</a> — waiting for confirmation…'
    );
    // Poll for the receipt via the public node.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const rc = await rpc("eth_getTransactionReceipt", [txHash]);
      if (rc) {
        if (rc.status === "0x1") {
          setStatus("txStatus", "Checked in! Your badge NFT is in your wallet.");
        } else {
          setStatus("txStatus", "Transaction failed on-chain. Nothing was minted.");
        }
        break;
      }
    }
    await refreshMy();
    await refreshGlobal();
    await loadBadges();
    await refreshReward();
  } catch (e) {
    setStatus(
      "txStatus",
      "Check-in cancelled or rejected in your wallet. Nothing was sent."
    );
    await refreshMy();
  }
}

/* ============================== my badges ============================== */
async function loadBadges() {
  const card = $("badgesCard");
  const grid = $("badgesGrid");
  const note = $("badgesNote");
  if (!account || !isDeployed()) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  if (!DEPLOY_BLOCK) {
    grid.innerHTML = "";
    note.textContent = "Badge history will appear here once the contract is deployed.";
    return;
  }
  grid.innerHTML = "<div class='note'>Loading your badges…</div>";
  try {
    const logs = await rpc("eth_getLogs", [
      {
        address: CONTRACT_ADDRESS,
        fromBlock: "0x" + DEPLOY_BLOCK.toString(16),
        toBlock: "latest",
        topics: [CHECKIN_TOPIC, "0x" + encodeAddressArg(account)],
      },
    ]);
    if (!logs.length) {
      grid.innerHTML = "";
      note.textContent = "No badges yet — check in to mint your first one.";
      return;
    }
    grid.innerHTML = "";
    note.textContent = "";
    for (const log of logs) {
      const tokenId = BigInt(log.topics[2]).toString();
      const day = Number(BigInt("0x" + log.data.slice(2, 66)));
      const date = new Date(day * 86400 * 1000).toISOString().slice(0, 10);
      const div = document.createElement("div");
      div.className = "badge";
      div.innerHTML =
        '<img alt="DailyAgent badge" src="badge.svg">' +
        '<div class="t">Badge #' +
        tokenId +
        "</div>" +
        '<div class="d">Checked in ' +
        date +
        "</div>";
      grid.appendChild(div);
      // Try to load the on-chain metadata name in the background.
      publicCall(CONTRACT_ADDRESS, SEL.tokenURI + tokenId.padStart(64, "0"))
        .then((hex) => fetch(decodeString(hex)))
        .then((r) => r.json())
        .then((meta) => {
          if (meta && meta.name) div.querySelector(".t").textContent = meta.name;
          if (meta && meta.image) div.querySelector("img").src = meta.image;
        })
        .catch(() => {});
    }
  } catch (e) {
    grid.innerHTML = "";
    note.textContent = "Could not load badge history right now. Your badges are still safe on-chain.";
  }
}

/* ============================== reward (7-day Dino) ============================== */
function renderTiers() {
  const grid = $("tierGrid");
  grid.innerHTML = "";
  for (const t of TIERS) {
    const div = document.createElement("div");
    div.className = "tier";
    div.innerHTML =
      '<img loading="lazy" alt="DailyAgent Dino — ' + t.name + '" src="reward/thumb-' + t.key + '.webp">' +
      '<div class="t">' + t.name + "</div>" +
      '<div class="d">' + t.armor + " · " + t.cap + " / 777</div>";
    grid.appendChild(div);
  }
}

async function refreshReward() {
  if (!isRewardDeployed()) {
    $("rewardMinted").textContent = "—";
    $("rewardBar").style.width = "0%";
    $("rewardNote").textContent =
      "The reward contract hasn't been deployed yet — the art is ready, deployment is next.";
    $("rewardStreak").textContent = "—";
    $("rewardClaimed").textContent = "—";
    const btn = $("claimBtn");
    btn.disabled = true;
    btn.textContent = "Reward not deployed yet";
    return;
  }
  try {
    const [minted, remaining] = await Promise.all([
      publicUint(REWARD_ADDRESS, SEL.totalMinted),
      publicUint(REWARD_ADDRESS, SEL.remaining),
    ]);
    $("rewardMinted").textContent = minted.toString();
    $("rewardBar").style.width = ((Number(minted) / 777) * 100).toString() + "%";
    $("rewardNote").textContent =
      remaining === 0n
        ? "All 777 Dinos are claimed — sold out."
        : remaining.toString() + " Dinos left to claim.";
    if (!account) {
      $("rewardStreak").textContent = "Connect your wallet to check";
      $("rewardClaimed").textContent = "—";
      const btn = $("claimBtn");
      btn.disabled = true;
      btn.textContent = "Connect your wallet first";
      return;
    }
    const [streak, claimed] = await Promise.all([
      publicUint(CONTRACT_ADDRESS, SEL.currentStreak + encodeAddressArg(account)),
      publicUint(REWARD_ADDRESS, SEL.claimed + encodeAddressArg(account)),
    ]);
    $("rewardStreak").textContent = streak.toString() + (streak === 1n ? " day" : " days");
    $("rewardClaimed").innerHTML =
      claimed > 0n
        ? '<span class="pill yes">Claimed — see it under List your Dino</span>'
        : '<span class="pill idle">Not claimed yet</span>';
    const btn = $("claimBtn");
    if (claimed > 0n) {
      btn.disabled = true;
      btn.textContent = "Already claimed";
    } else if (remaining === 0n) {
      btn.disabled = true;
      btn.textContent = "Sold out";
    } else if (streak < 7n) {
      btn.disabled = true;
      btn.textContent = "Need a 7-day streak (" + streak.toString() + "/7)";
    } else {
      btn.disabled = false;
      btn.textContent = "Claim your free Dino";
    }
  } catch (e) {
    $("rewardNote").textContent = "Could not read the reward contract right now.";
  }
}

async function doClaim() {
  if (!isRewardDeployed()) return;
  const btn = $("claimBtn");
  btn.disabled = true;
  btn.textContent = "Waiting for wallet…";
  setStatus("claimStatus", "");
  try {
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from: account, to: REWARD_ADDRESS, data: SEL.claim, value: "0x0" }],
    });
    setStatus(
      "claimStatus",
      'Claim sent. <a href="https://bscscan.com/tx/' +
        txHash +
        '" target="_blank" rel="noopener">View on BscScan</a> — waiting for confirmation…'
    );
    const rc = await waitReceipt(txHash);
    if (rc && rc.status === "0x1") {
      setStatus(
        "claimStatus",
        "Your Dino is minted! Find its tier under List your Dino below."
      );
    } else {
      setStatus("claimStatus", "Transaction failed on-chain. Nothing was minted.");
    }
    await refreshReward();
    await refreshMarket();
    await loadMyDinos();
  } catch (e) {
    setStatus("claimStatus", "Claim cancelled or rejected in your wallet. Nothing was sent.");
    await refreshReward();
  }
}

/* ============================== market ============================== */
function decodeListing(hex) {
  // listings(uint256) -> (address seller, uint256 price, bool active)
  const d = hex.slice(2);
  return {
    seller: "0x" + d.slice(24, 64),
    price: BigInt("0x" + d.slice(64, 128)),
    active: BigInt("0x" + d.slice(128, 192)) !== 0n,
  };
}

async function refreshMarket() {
  const grid = $("marketGrid");
  if (!isMarketDeployed()) {
    $("marketNote").textContent =
      "The market hasn't been deployed yet — it goes live with the reward contract.";
    grid.innerHTML = "";
    $("listBtn").disabled = true;
    return;
  }
  try {
    const count = await publicUint(MARKET_ADDRESS, SEL.activeCount);
    if (count === 0n) {
      $("marketNote").textContent = "No Dinos listed yet — be the first to list one below.";
      grid.innerHTML = "";
      $("listBtn").disabled = !account;
      return;
    }
    $("marketNote").textContent =
      count.toString() + (count === 1n ? " Dino listed." : " Dinos listed.");
    grid.innerHTML = "<div class='note'>Loading listings…</div>";
    const ids = [];
    for (let i = 0; i < Number(count); i++) {
      ids.push(Number(await publicUint(MARKET_ADDRESS, SEL.activeAt + encodeUintArg(i))));
    }
    grid.innerHTML = "";
    for (const tokenId of ids) {
      const [listingHex, uriHex] = await Promise.all([
        publicCall(MARKET_ADDRESS, SEL.listings + encodeUintArg(tokenId)),
        publicCall(REWARD_ADDRESS, SEL.tokenURI + encodeUintArg(tokenId)),
      ]);
      const l = decodeListing(listingHex);
      if (!l.active) continue;
      let meta = null;
      try {
        meta = await (await fetch(decodeString(uriHex))).json();
      } catch (e) {}
      const tier = Number(await publicUint(REWARD_ADDRESS, SEL.tierOf + encodeUintArg(tokenId)));
      const div = document.createElement("div");
      div.className = "listing";
      const isMine = account && l.seller.toLowerCase() === account.toLowerCase();
      div.innerHTML =
        '<img loading="lazy" alt="Dino #' +
        tokenId +
        '" src="' +
        (meta && meta.image ? meta.image : "reward/thumb-" + TIERS[tier].key + ".webp") +
        '">' +
        '<div class="t">Dino #' +
        tokenId +
        " · " +
        TIERS[tier].name +
        "</div>" +
        '<div class="price">' +
        weiToBnb(l.price) +
        " BNB</div>" +
        '<div class="s">Seller ' +
        shortAddr(l.seller) +
        "</div>";
      const btn = document.createElement("button");
      if (isMine) {
        btn.textContent = "Cancel listing";
        btn.className = "secondary";
        btn.addEventListener("click", () => doCancel(tokenId));
      } else {
        btn.textContent = "Buy";
        btn.disabled = !account;
        btn.addEventListener("click", () => doBuy(tokenId, l.price));
      }
      div.appendChild(btn);
      grid.appendChild(div);
    }
    $("listBtn").disabled = !account;
  } catch (e) {
    $("marketNote").textContent = "Could not load the market right now.";
  }
}

async function loadMyDinos() {
  const chips = $("myDinosChips");
  const note = $("myDinosNote");
  chips.innerHTML = "";
  if (!account || !isRewardDeployed()) {
    note.textContent = account
      ? "The reward contract hasn't been deployed yet."
      : "Connect your wallet to see your Dinos.";
    return;
  }
  try {
    const minted = Number(await publicUint(REWARD_ADDRESS, SEL.totalMinted));
    const mine = [];
    const BATCH = 8;
    for (let s = 1; s <= minted; s += BATCH) {
      const batch = [];
      for (let id = s; id < Math.min(s + BATCH, minted + 1); id++) batch.push(id);
      const results = await Promise.all(
        batch.map((id) =>
          publicCall(REWARD_ADDRESS, SEL.ownerOf + encodeUintArg(id))
            .then((hex) => ({ id, owner: "0x" + hex.slice(-40).toLowerCase() }))
            .catch(() => null)
        )
      );
      for (const r of results) {
        if (r && r.owner === account.toLowerCase()) mine.push(r.id);
      }
    }
    if (!mine.length) {
      note.textContent = "You don't hold a Dino yet — reach a 7-day streak and claim one above.";
      return;
    }
    note.textContent = "Your Dinos — tap one to fill the listing form:";
    for (const id of mine) {
      const tier = Number(await publicUint(REWARD_ADDRESS, SEL.tierOf + encodeUintArg(id)));
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = "#" + id + " · " + TIERS[tier].name;
      chip.addEventListener("click", () => {
        $("listTokenId").value = String(id);
      });
      chips.appendChild(chip);
    }
  } catch (e) {
    note.textContent = "Could not load your Dinos right now.";
  }
}

async function doList() {
  if (!isMarketDeployed() || !account) return;
  const tokenId = parseInt($("listTokenId").value, 10);
  const priceStr = $("listPrice").value.trim();
  if (!tokenId || tokenId <= 0) {
    setStatus("listStatus", "Enter a Dino token ID first.");
    return;
  }
  let price;
  try {
    price = parseBnbToWei(priceStr);
  } catch (e) {
    setStatus("listStatus", "Enter a valid BNB price, e.g. 0.05.");
    return;
  }
  if (price <= 0n) {
    setStatus("listStatus", "Price must be above 0 BNB.");
    return;
  }
  const btn = $("listBtn");
  btn.disabled = true;
  btn.textContent = "Waiting for wallet…";
  setStatus("listStatus", "");
  try {
    const approved = await publicUint(
      REWARD_ADDRESS,
      SEL.isApprovedForAll + encodeAddressArg(account) + encodeAddressArg(MARKET_ADDRESS)
    );
    if (approved === 0n) {
      setStatus("listStatus", "Step 1 of 2: approve the market to move your Dino…");
      const approveTx = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: REWARD_ADDRESS,
            data:
              SEL.setApprovalForAll +
              encodeAddressArg(MARKET_ADDRESS) +
              encodeBoolArg(true),
            value: "0x0",
          },
        ],
      });
      await waitReceipt(approveTx);
    }
    setStatus("listStatus", "Step 2 of 2: listing your Dino…");
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: MARKET_ADDRESS,
          data: SEL.list + encodeUintArg(tokenId) + encodeUintArg(price),
          value: "0x0",
        },
      ],
    });
    const rc = await waitReceipt(txHash);
    if (rc && rc.status === "0x1") {
      setStatus("listStatus", "Listed! Your Dino is on the market.");
    } else {
      setStatus("listStatus", "Listing failed on-chain. Your Dino was not listed.");
    }
    await refreshMarket();
    await loadMyDinos();
  } catch (e) {
    setStatus("listStatus", "Listing cancelled or rejected in your wallet.");
  }
  btn.disabled = false;
  btn.textContent = "List for sale";
}

async function doBuy(tokenId, priceWei) {
  if (!isMarketDeployed() || !account) return;
  try {
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: MARKET_ADDRESS,
          data: SEL.buy + encodeUintArg(tokenId),
          value: "0x" + priceWei.toString(16),
        },
      ],
    });
    setStatus("marketNote", "Purchase sent — waiting for confirmation…");
    const rc = await waitReceipt(txHash);
    if (rc && rc.status === "0x1") {
      setStatus("marketNote", "You bought Dino #" + tokenId + "! It is in your wallet now.");
    } else {
      setStatus("marketNote", "Purchase failed on-chain. No BNB was taken.");
    }
    await refreshMarket();
    await loadMyDinos();
  } catch (e) {
    setStatus("marketNote", "Purchase cancelled or rejected in your wallet.");
  }
}

async function doCancel(tokenId) {
  if (!isMarketDeployed() || !account) return;
  try {
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: MARKET_ADDRESS,
          data: SEL.cancel + encodeUintArg(tokenId),
          value: "0x0",
        },
      ],
    });
    const rc = await waitReceipt(txHash);
    if (rc && rc.status === "0x1") {
      setStatus(
        "marketNote",
        "Listing cancelled — Dino #" + tokenId + " is back in your wallet."
      );
    } else {
      setStatus("marketNote", "Cancel failed on-chain.");
    }
    await refreshMarket();
    await loadMyDinos();
  } catch (e) {
    setStatus("marketNote", "Cancel rejected in your wallet.");
  }
}

/* ============================== boot ============================== */
$("connectBtn").addEventListener("click", connect);
$("checkInBtn").addEventListener("click", doCheckIn);
$("claimBtn").addEventListener("click", doClaim);
$("listBtn").addEventListener("click", doList);
if (window.ethereum) {
  window.ethereum.on("accountsChanged", (accs) => {
    account = accs.length ? accs[0] : null;
    if (account) {
      $("walletBox").hidden = true;
      $("accountBox").hidden = false;
      $("myAddr").textContent = shortAddr(account);
      refreshMy();
      loadBadges();
      refreshReward();
      refreshMarket();
      loadMyDinos();
    } else {
      $("walletBox").hidden = false;
      $("accountBox").hidden = true;
      $("badgesCard").hidden = true;
    }
  });
  window.ethereum
    .request({ method: "eth_accounts" })
    .then((accs) => {
      if (accs.length) {
        account = accs[0];
        $("walletBox").hidden = true;
        $("accountBox").hidden = false;
        $("myAddr").textContent = shortAddr(account);
        refreshMy();
        loadBadges();
        refreshReward();
        refreshMarket();
        loadMyDinos();
      }
    })
    .catch(() => {});
}
renderTiers();
refreshReward();
refreshMarket();
refreshGlobal();
