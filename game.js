const canvas = document.getElementById("gameCanvas");
const drawingContext = canvas.getContext("2d");

// all game logic is in these units, whatever size the canvas ends up drawn at
const VIRTUAL_WIDTH = 640;
const VIRTUAL_HEIGHT = 720;
const RENDER_SCALE = 2;

canvas.width = VIRTUAL_WIDTH * RENDER_SCALE;
canvas.height = VIRTUAL_HEIGHT * RENDER_SCALE;

// resizing the canvas resets the context, so set this after
drawingContext.imageSmoothingEnabled = false;

function loadImage(fileName) {
  const image = new Image();
  image.src = "assets/" + encodeURIComponent(fileName);
  return image;
}

const backgroundImage = loadImage("background.png");
const fallingFrames = [1, 2, 3, 4, 5].map((frameNumber) => loadImage(`falling - ${frameNumber}.png`));
const bagFrames = [1, 2, 3, 4, 5].map((frameNumber) => loadImage(`bag - ${frameNumber}.png`));
const poopFrames = [loadImage("poop.png")];
const idleFrames = [1, 2, 3].map((frameNumber) => loadImage(`idle - ${frameNumber}.png`));

// whole number, so every source pixel stays a crisp square
const BACKGROUND_SCALE = 8;
const FALLING_FRAMES_PER_SECOND = 10;

// a hazard landing this close in time to a cat must not block it
const HAZARD_CLEARANCE_SECONDS = 0.45;

// walked back down so the tail swishes instead of snapping back to the start
const IDLE_FRAMES_PER_SECOND = 4;
const IDLE_FRAME_ORDER = [0, 1, 2, 1];

// the opaque box inside the 640 square frame. centreX is where the cat's weight
// sits, left of the box middle because the tail sticks out to the right
const IDLE_CONTENT = { left: 150, top: 100, width: 450, height: 480, centreX: 337 };
const IDLE_MARGIN = 8;

const BAG_IDLE_FRAMES_PER_SECOND = 2.5;
const BAG_CATCH_SECONDS = 0.45;
const BAG_CATCH_FRAMES = [3, 4];

// derived from the measured art box, these put the bag's mouth on the catch
// line and its body on player.x
const BAG_SPRITE_SIZE = 186;
const BAG_OFFSET_X = -0.4836 * BAG_SPRITE_SIZE;
const BAG_OFFSET_Y = -0.2188 * BAG_SPRITE_SIZE;

const scoreValueElement = document.getElementById("scoreValue");
const bestValueElement = document.getElementById("bestValue");
const livesValueElement = document.getElementById("livesValue");
const overlayElement = document.getElementById("overlay");
const overlayTitleElement = document.getElementById("overlayTitle");
const overlayTextElement = document.getElementById("overlayText");
const startButton = document.getElementById("startButton");

const titleCatCanvas = document.getElementById("titleCat");
const titleCatContext = titleCatCanvas.getContext("2d");
titleCatContext.imageSmoothingEnabled = false;

// sampled from assets/background.png
const PALETTE = {
  sand: "#ddbc94",
  cream: "#f4e6d6",
  barkDeep: "#664230",
  gold: "#f9c05f",
  berry: "#cf5b4b",
  ink: "#36536e"
};

const BEST_SCORE_STORAGE_KEY = "dishwaterBagBestScore";
const STARTING_LIVES = 3;
const PLAYER_SPEED = 560;
const BASE_FALL_SPEED = 170;
const BASE_SPAWN_INTERVAL = 0.85;

const DIFFICULTY_STEP_SECONDS = 45;
const DIFFICULTY_STEP = 0.3;

// a cat falling faster than this clears the whole catch band between two frames
// and is missed through no fault of the player, see the working in the readme
const MAX_DIFFICULTY = 4.5;

// never ask for more than this fraction of top speed between two catches, so a
// perfect run never needs frame perfect movement
const REACH_SAFETY_FACTOR = 0.7;

// spriteSize is drawn, radius is the more forgiving catch box
const FALLING_KINDS = [
  { name: "big cat", frames: fallingFrames, spriteSize: 120, radius: 34,
    points: 1, weight: 6, harmful: false, textColor: PALETTE.barkDeep },
  { name: "medium cat", frames: fallingFrames, spriteSize: 94, radius: 27,
    points: 3, weight: 3, harmful: false, textColor: PALETTE.ink },
  { name: "small cat", frames: fallingFrames, spriteSize: 70, radius: 20,
    points: 6, weight: 1.4, harmful: false, textColor: PALETTE.ink },
  { name: "poop", frames: poopFrames, spriteSize: 72, radius: 16,
    points: 0, weight: 2, harmful: true, textColor: PALETTE.berry }
];

const totalKindWeight = FALLING_KINDS.reduce((runningTotal, kind) => runningTotal + kind.weight, 0);

const player = {
  width: 110,
  height: 26,
  x: VIRTUAL_WIDTH / 2,
  y: VIRTUAL_HEIGHT - 146,
  idleAnimationTime: 0,
  // null except while a catch pose is being held
  catchAnimationTime: null,
  catchFrameIndex: BAG_CATCH_FRAMES[0]
};

const pressedKeys = new Set();

let fallingObjects = [];
let floatingTexts = [];

// where and when the player must be for each cat still in flight, so new spawns
// can be kept within reach
let catchCommitments = [];
let score = 0;
let bestScore = loadBestScore();
let livesLeft = STARTING_LIVES;
let elapsedSeconds = 0;
let timeUntilNextSpawn = 0;
let gameState = "menu"; // menu, playing, paused, over
let lastFrameTimestamp = 0;

let menuAnimationTime = 0;

bestValueElement.textContent = bestScore;

function loadBestScore() {
  try {
    return Number(localStorage.getItem(BEST_SCORE_STORAGE_KEY)) || 0;
  } catch (storageError) {
    return 0;
  }
}

function saveBestScore(value) {
  try {
    localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(value));
  } catch (storageError) {
    // storage may be blocked, the game still works without it
  }
}

function pickFallingKind() {
  let remainingWeight = Math.random() * totalKindWeight;
  for (const kind of FALLING_KINDS) {
    remainingWeight -= kind.weight;
    if (remainingWeight <= 0) return kind;
  }
  return FALLING_KINDS[0];
}

function difficultyMultiplier() {
  const step = Math.floor(elapsedSeconds / DIFFICULTY_STEP_SECONDS);
  return Math.min(1 + step * DIFFICULTY_STEP, MAX_DIFFICULTY);
}

// objects fall at different speeds, so a new spawn can land between two that
// are already in flight, the player must still be able to reach it from the one
// before it and carry on to the one after it
function neighbouringCommitments(arrivalTime) {
  let before = { x: player.x, arrivalTime: elapsedSeconds };
  let after = null;

  for (const commitment of catchCommitments) {
    if (commitment.arrivalTime <= arrivalTime) {
      if (commitment.arrivalTime > before.arrivalTime) before = commitment;
    } else if (after === null || commitment.arrivalTime < after.arrivalTime) {
      after = commitment;
    }
  }

  return { before, after };
}

function pickReachableX(kind, arrivalTime) {
  const { before, after } = neighbouringCommitments(arrivalTime);

  const reachFromBefore = PLAYER_SPEED
    * Math.max(arrivalTime - before.arrivalTime, 0) * REACH_SAFETY_FACTOR;

  let leftLimit = Math.max(kind.radius, before.x - reachFromBefore);
  let rightLimit = Math.min(VIRTUAL_WIDTH - kind.radius, before.x + reachFromBefore);

  if (after !== null) {
    const reachToAfter = PLAYER_SPEED
      * Math.max(after.arrivalTime - arrivalTime, 0) * REACH_SAFETY_FACTOR;
    leftLimit = Math.max(leftLimit, after.x - reachToAfter);
    rightLimit = Math.min(rightLimit, after.x + reachToAfter);
  }

  // no position between these two neighbours is reachable, so rather than drop a
  // cat the player cannot get to, spawn nothing and try again next tick
  if (rightLimit < leftLimit) return null;
  return leftLimit + Math.random() * (rightLimit - leftLimit);
}

function conflictsWithCatch(x, kind, arrivalTime) {
  const blockingDistance = player.width / 2 + kind.radius;
  return catchCommitments.some((commitment) =>
    Math.abs(commitment.arrivalTime - arrivalTime) < HAZARD_CLEARANCE_SECONDS
    && Math.abs(commitment.x - x) < blockingDistance);
}

function pickHazardX(kind, arrivalTime) {
  // retry a few times so the poop rarely sits right on top of a cat
  let x = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    x = kind.radius + Math.random() * (VIRTUAL_WIDTH - kind.radius * 2);
    if (!conflictsWithCatch(x, kind, arrivalTime)) return x;
  }
  return x;
}

function spawnFallingObject() {
  const kind = pickFallingKind();
  const fallSpeed = (BASE_FALL_SPEED + Math.random() * 90) * difficultyMultiplier();
  // start with the whole sprite on screen so no cat pops in mid fall
  const spawnY = kind.spriteSize / 2;
  const arrivalTime = elapsedSeconds + (player.y - spawnY) / fallSpeed;
  const x = kind.harmful
    ? pickHazardX(kind, arrivalTime)
    : pickReachableX(kind, arrivalTime);

  if (x === null) return;

  if (!kind.harmful) {
    catchCommitments.push({ x, arrivalTime });
  }

  fallingObjects.push({
    kind,
    x,
    y: spawnY,
    fallSpeed,
    wobbleOffset: Math.random() * Math.PI * 2,
    // stagger the tumble so a screenful of cats is not in lockstep
    animationTime: Math.random()
  });
}

function addFloatingText(text, x, y, color) {
  floatingTexts.push({ text, x, y, color, lifeLeft: 0.8 });
}

function startGame() {
  if (window.Leaderboard && window.Leaderboard.needsName()) return;

  fallingObjects = [];
  floatingTexts = [];
  catchCommitments = [];
  score = 0;
  livesLeft = STARTING_LIVES;
  elapsedSeconds = 0;
  timeUntilNextSpawn = 0.4;
  player.x = VIRTUAL_WIDTH / 2;
  player.idleAnimationTime = 0;
  player.catchAnimationTime = null;
  gameState = "playing";
  overlayElement.classList.add("hidden");
  updateHud();
}

function endGame() {
  gameState = "over";
  if (score > bestScore) {
    bestScore = score;
    saveBestScore(bestScore);
  }
  updateHud();
  showOverlay("game over", `you caught ${score} point${score === 1 ? "" : "s"}.`, "play again");

  if (window.Leaderboard) window.Leaderboard.submit(score);
}

function showOverlay(title, text, buttonLabel) {
  overlayTitleElement.textContent = title;
  overlayTextElement.textContent = text;
  startButton.textContent = buttonLabel;
  overlayElement.classList.remove("hidden");
}

function updateHud() {
  scoreValueElement.textContent = score;
  bestValueElement.textContent = bestScore;
  livesValueElement.textContent = livesLeft;
}

function losePoint(amount) {
  livesLeft -= amount;
  updateHud();
  if (livesLeft <= 0) {
    livesLeft = 0;
    updateHud();
    endGame();
  }
}

function updatePlayer(deltaSeconds) {
  player.idleAnimationTime += deltaSeconds;

  if (player.catchAnimationTime !== null) {
    player.catchAnimationTime += deltaSeconds;
    if (player.catchAnimationTime >= BAG_CATCH_SECONDS) {
      player.catchAnimationTime = null;
    }
  }

  let direction = 0;
  if (pressedKeys.has("ArrowLeft") || pressedKeys.has("KeyA")) direction -= 1;
  if (pressedKeys.has("ArrowRight") || pressedKeys.has("KeyD")) direction += 1;

  player.x += direction * PLAYER_SPEED * deltaSeconds;

  const halfWidth = player.width / 2;
  player.x = Math.max(halfWidth, Math.min(VIRTUAL_WIDTH - halfWidth, player.x));
}

function isCaught(fallingObject) {
  const halfWidth = player.width / 2;
  const withinX = fallingObject.x > player.x - halfWidth - fallingObject.kind.radius * 0.4
    && fallingObject.x < player.x + halfWidth + fallingObject.kind.radius * 0.4;
  const withinY = fallingObject.y + fallingObject.kind.radius >= player.y
    && fallingObject.y - fallingObject.kind.radius <= player.y + player.height;
  return withinX && withinY;
}

function updateFallingObjects(deltaSeconds) {
  const survivors = [];

  for (const fallingObject of fallingObjects) {
    fallingObject.y += fallingObject.fallSpeed * deltaSeconds;
    fallingObject.animationTime += deltaSeconds;

    if (isCaught(fallingObject)) {
      if (fallingObject.kind.harmful) {
        addFloatingText("ick", fallingObject.x, fallingObject.y, fallingObject.kind.textColor);
        losePoint(1);
      } else {
        score += fallingObject.kind.points;
        player.catchAnimationTime = 0;
        player.catchFrameIndex = BAG_CATCH_FRAMES[Math.floor(Math.random() * BAG_CATCH_FRAMES.length)];
        addFloatingText(`+${fallingObject.kind.points}`, fallingObject.x, fallingObject.y,
          fallingObject.kind.textColor);
        updateHud();
      }
      continue;
    }

    if (fallingObject.y - fallingObject.kind.radius > VIRTUAL_HEIGHT) {
      // the poop is meant to be dodged, only a dropped cat costs a life
      if (!fallingObject.kind.harmful) {
        losePoint(1);
      }
      continue;
    }

    survivors.push(fallingObject);
  }

  fallingObjects = survivors;
}

function updateFloatingTexts(deltaSeconds) {
  for (const floatingText of floatingTexts) {
    floatingText.y -= 42 * deltaSeconds;
    floatingText.lifeLeft -= deltaSeconds;
  }
  floatingTexts = floatingTexts.filter((floatingText) => floatingText.lifeLeft > 0);
}

function update(deltaSeconds) {
  elapsedSeconds += deltaSeconds;
  updatePlayer(deltaSeconds);

  catchCommitments = catchCommitments.filter(
    (commitment) => commitment.arrivalTime > elapsedSeconds);

  timeUntilNextSpawn -= deltaSeconds;
  if (timeUntilNextSpawn <= 0) {
    spawnFallingObject();
    timeUntilNextSpawn = Math.max(0.25, BASE_SPAWN_INTERVAL / difficultyMultiplier());
  }

  updateFallingObjects(deltaSeconds);
  updateFloatingTexts(deltaSeconds);
}

function drawBackground() {
  drawingContext.clearRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

  // plain fill for the frame or two before the png has decoded
  drawingContext.fillStyle = PALETTE.sand;
  drawingContext.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

  if (backgroundImage.complete && backgroundImage.naturalWidth > 0) {
    const drawWidth = backgroundImage.naturalWidth * BACKGROUND_SCALE;
    const drawHeight = backgroundImage.naturalHeight * BACKGROUND_SCALE;
    drawingContext.drawImage(
      backgroundImage,
      Math.round((VIRTUAL_WIDTH - drawWidth) / 2),
      Math.round((VIRTUAL_HEIGHT - drawHeight) / 2),
      drawWidth,
      drawHeight
    );
  }
}

function currentBagFrame() {
  if (player.catchAnimationTime !== null) {
    return bagFrames[player.catchFrameIndex];
  }

  const idleStep = Math.floor(player.idleAnimationTime * BAG_IDLE_FRAMES_PER_SECOND) % 2;
  return bagFrames[idleStep];
}

function drawPlayer() {
  const frame = currentBagFrame();
  if (!frame.complete || frame.naturalWidth === 0) return;

  drawingContext.drawImage(
    frame,
    Math.round(player.x + BAG_OFFSET_X),
    Math.round(player.y + BAG_OFFSET_Y),
    BAG_SPRITE_SIZE,
    BAG_SPRITE_SIZE
  );
}

function drawFallingObjects() {
  for (const fallingObject of fallingObjects) {
    const wobble = Math.sin(elapsedSeconds * 4 + fallingObject.wobbleOffset) * 3;
    const frames = fallingObject.kind.frames;
    const frameIndex = Math.floor(fallingObject.animationTime * FALLING_FRAMES_PER_SECOND)
      % frames.length;
    const frame = frames[frameIndex];

    if (!frame.complete || frame.naturalWidth === 0) continue;

    const size = fallingObject.kind.spriteSize;
    drawingContext.drawImage(
      frame,
      Math.round(fallingObject.x + wobble - size / 2),
      Math.round(fallingObject.y - size / 2),
      size,
      size
    );
  }
}

function drawFloatingTexts() {
  drawingContext.font = "26px rainyhearts, 'Trebuchet MS', sans-serif";
  drawingContext.textAlign = "center";

  drawingContext.lineWidth = 4;
  drawingContext.lineJoin = "round";

  for (const floatingText of floatingTexts) {
    drawingContext.globalAlpha = Math.max(0, floatingText.lifeLeft / 0.8);
    drawingContext.strokeStyle = PALETTE.cream;
    drawingContext.strokeText(floatingText.text, floatingText.x, floatingText.y);
    drawingContext.fillStyle = floatingText.color;
    drawingContext.fillText(floatingText.text, floatingText.x, floatingText.y);
  }

  drawingContext.globalAlpha = 1;
}

function drawTitleCat() {
  const step = Math.floor(menuAnimationTime * IDLE_FRAMES_PER_SECOND) % IDLE_FRAME_ORDER.length;
  const frame = idleFrames[IDLE_FRAME_ORDER[step]];

  titleCatContext.clearRect(0, 0, titleCatCanvas.width, titleCatCanvas.height);
  if (!frame.complete || frame.naturalWidth === 0) return;

  const usableHalfWidth = titleCatCanvas.width / 2 - IDLE_MARGIN;
  const usableHeight = titleCatCanvas.height - IDLE_MARGIN * 2;

  // hanging the art off its centre of weight means whichever side reaches
  // furthest from that point decides how big it can be
  const widestReach = Math.max(
    IDLE_CONTENT.centreX - IDLE_CONTENT.left,
    IDLE_CONTENT.left + IDLE_CONTENT.width - IDLE_CONTENT.centreX
  );
  const scale = Math.min(usableHalfWidth / widestReach, usableHeight / IDLE_CONTENT.height);

  titleCatContext.drawImage(
    frame,
    titleCatCanvas.width / 2 - IDLE_CONTENT.centreX * scale,
    -IDLE_CONTENT.top * scale + (titleCatCanvas.height - IDLE_CONTENT.height * scale) / 2,
    frame.naturalWidth * scale,
    frame.naturalHeight * scale
  );
}

function drawPausedLabel() {
  drawingContext.fillStyle = "rgba(56, 38, 28, 0.66)";
  drawingContext.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
  drawingContext.fillStyle = PALETTE.gold;
  drawingContext.font = "46px rainyhearts, 'Trebuchet MS', sans-serif";
  drawingContext.textAlign = "center";
  drawingContext.fillText("paused", VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2);
}

function draw() {
  drawingContext.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  drawBackground();
  drawFallingObjects();
  drawPlayer();
  drawFloatingTexts();
  if (gameState === "paused") drawPausedLabel();
}

function gameLoop(timestamp) {
  const deltaSeconds = Math.min((timestamp - lastFrameTimestamp) / 1000, 0.05);
  lastFrameTimestamp = timestamp;
  menuAnimationTime += deltaSeconds;

  if (gameState === "playing") update(deltaSeconds);
  draw();

  if (gameState === "menu" || gameState === "over") drawTitleCat();

  requestAnimationFrame(gameLoop);
}

document.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();

  pressedKeys.add(event.code);

  if (event.code === "KeyP") {
    if (gameState === "playing") {
      gameState = "paused";
    } else if (gameState === "paused") {
      gameState = "playing";
    }
  }

  if (event.code === "Space" && (gameState === "menu" || gameState === "over")) {
    startGame();
  }
});

document.addEventListener("keyup", (event) => {
  pressedKeys.delete(event.code);
});

canvas.addEventListener("pointermove", (event) => {
  if (gameState !== "playing") return;
  const bounds = canvas.getBoundingClientRect();
  const scale = VIRTUAL_WIDTH / bounds.width;
  player.x = (event.clientX - bounds.left) * scale;
});

startButton.addEventListener("click", startGame);

// canvas text quietly falls back to the default font unless the face is already
// loaded, so ask for it before the first frame is drawn
if (document.fonts && document.fonts.load) {
  document.fonts.load("26px rainyhearts").catch(() => {});
  document.fonts.load("46px rainyhearts").catch(() => {});
}

requestAnimationFrame((timestamp) => {
  lastFrameTimestamp = timestamp;
  requestAnimationFrame(gameLoop);
});
