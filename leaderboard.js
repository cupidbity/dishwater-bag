// with these two blank there is no name prompt and no board, the game just runs
const SUPABASE_URL = "";
const SUPABASE_PUBLISHABLE_KEY = "";

const PLAYER_ID_STORAGE_KEY = "dishwaterBagPlayerId";
const PLAYER_NAME_STORAGE_KEY = "dishwaterBagPlayerName";
const BOARD_SIZE = 10;
const MAX_NAME_LENGTH = 16;

const leaderboardSection = document.getElementById("leaderboard");
const leaderboardList = document.getElementById("leaderboardList");
const leaderboardNote = document.getElementById("leaderboardNote");
const nameOverlayElement = document.getElementById("nameOverlay");
const nameFormElement = document.getElementById("nameForm");
const nameInputElement = document.getElementById("nameInput");

const isConfigured = SUPABASE_URL !== "" && SUPABASE_PUBLISHABLE_KEY !== "";

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch (storageError) {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (storageError) {
    // private windows and blocked storage just mean a fresh player each visit
  }
}

// this id is what makes someone the same player next time. it lives only in
// this browser, so another device or a cleared cache is a new player
function createPlayerId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let playerId = readStored(PLAYER_ID_STORAGE_KEY);
let playerName = readStored(PLAYER_NAME_STORAGE_KEY);

if (!playerId) {
  playerId = createPlayerId();
  writeStored(PLAYER_ID_STORAGE_KEY, playerId);
}

async function callSupabase(functionName, args) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      // the publishable key goes on apikey, not on authorization
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify(args)
  });

  if (!response.ok) {
    throw new Error(`${functionName} failed: ${response.status} ${await response.text()}`);
  }

  // a function that returns nothing comes back as 204 with an empty body, and
  // calling json() on that throws, so only parse when there is something to parse
  const body = await response.text();
  return body === "" ? null : JSON.parse(body);
}

function setNote(text) {
  leaderboardNote.textContent = text;
  leaderboardNote.classList.toggle("hidden", text === "");
}

function renderRows(rows) {
  leaderboardList.replaceChildren();

  if (rows.length === 0) {
    setNote("nobody has caught anything yet. be first.");
    return;
  }

  let hasHighlightedSelf = false;

  for (const [index, row] of rows.entries()) {
    const item = document.createElement("li");
    item.className = "leaderboard-row";

    // names come from other people, so they only ever go in as text
    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = `${index + 1}`;

    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = row.name;

    const score = document.createElement("span");
    score.className = "leaderboard-score";
    score.textContent = row.best_score;

    if (!hasHighlightedSelf && playerName !== null && row.name === playerName) {
      item.classList.add("is-you");
      hasHighlightedSelf = true;
    }

    item.append(rank, name, score);
    leaderboardList.append(item);
  }

  setNote("");
}

async function refresh() {
  if (!isConfigured) return;

  try {
    const rows = await callSupabase("get_leaderboard", { board_size: BOARD_SIZE });
    renderRows(Array.isArray(rows) ? rows : []);
  } catch (requestError) {
    leaderboardList.replaceChildren();
    setNote("could not reach the leaderboard.");
    console.error(requestError);
  }
}

async function submit(score) {
  if (!isConfigured || playerName === null) return;
  if (!Number.isFinite(score) || score <= 0) return;

  try {
    await callSupabase("submit_score", {
      player: playerId,
      player_name: playerName,
      new_score: Math.floor(score)
    });
  } catch (requestError) {
    setNote(`score could not be saved (${requestError.message}).`);
    console.error(requestError);
    return;
  }

  await refresh();
}

function openNamePrompt() {
  nameOverlayElement.classList.remove("hidden");
  nameInputElement.focus();
}

function handleNameSubmit(event) {
  event.preventDefault();

  const typed = nameInputElement.value.trim().slice(0, MAX_NAME_LENGTH);
  if (typed === "") return;

  playerName = typed;
  writeStored(PLAYER_NAME_STORAGE_KEY, playerName);
  nameOverlayElement.classList.add("hidden");
  refresh();
}

function needsName() {
  return isConfigured && playerName === null;
}

window.Leaderboard = { needsName, submit, refresh };

if (isConfigured) {
  leaderboardSection.classList.remove("hidden");
  nameFormElement.addEventListener("submit", handleNameSubmit);
  nameInputElement.maxLength = MAX_NAME_LENGTH;

  if (playerName === null) {
    openNamePrompt();
  }

  refresh();
}
