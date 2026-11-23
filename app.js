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
  } catch (e) {
    $("uniqueHolders").textContent = "—";
    $("hackCount").textContent = "—";
    $("hackNote").textContent =
      "Live count unavailable right now — check-ins are still safe on-chain.";
  }
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

/* ============================== boot ============================== */
$("connectBtn").addEventListener("click", connect);
$("checkInBtn").addEventListener("click", doCheckIn);
if (window.ethereum) {
  window.ethereum.on("accountsChanged", (accs) => {
    account = accs.length ? accs[0] : null;
    if (account) {
      $("walletBox").hidden = true;
      $("accountBox").hidden = false;
      $("myAddr").textContent = shortAddr(account);
      refreshMy();
      loadBadges();
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
      }
    })
    .catch(() => {});
}
refreshGlobal();
