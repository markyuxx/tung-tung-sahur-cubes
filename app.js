const COLS = 10;
const ROWS = 18;
const CELL = 36;
const boardCanvas = document.querySelector("#board");
const boardCtx = boardCanvas.getContext("2d");
const nextCanvas = document.querySelector("#next");
const nextCtx = nextCanvas.getContext("2d");

const scoreEl = document.querySelector("#score");
const linesEl = document.querySelector("#lines");
const comboEl = document.querySelector("#combo");
const timeEl = document.querySelector("#time");
const statusEl = document.querySelector("#status");
const startBtn = document.querySelector("#startBtn");
const previewWinBtn = document.querySelector("#previewWinBtn");
const previewLoseBtn = document.querySelector("#previewLoseBtn");
const pauseBtn = document.querySelector("#pauseBtn");
const soundToggle = document.querySelector("#soundToggle");
const celebrationEl = document.querySelector("#sahurCelebration");
const lostCelebrationEl = document.querySelector("#lostCelebration");
const sahurPhotos = document.querySelectorAll(".sahur-photo");
const musicTrack = document.querySelector("#musicTrack");

const COLORS = ["#ffcf4a"];
const PIECES = [
  [[1, 1, 1, 1]],
  [[1, 1], [1, 1]],
  [[0, 1, 0], [1, 1, 1]],
  [[1, 0, 0], [1, 1, 1]],
  [[0, 0, 1], [1, 1, 1]],
  [[1, 1, 0], [0, 1, 1]],
  [[0, 1, 1], [1, 1, 0]]
];

const TARGET = [
  "...1111...",
  "...1111...",
  "...1111...",
  "...1111...",
  "...1111...",
  "...1111...",
  "..111111..",
  "..111111..",
  "...1111...",
  "...1111...",
  "..11..11..",
  "..11..11..",
  "..11..11.."
].map(row => row.split("").map(cell => cell === "1"));

const TARGET_OFFSET_Y = ROWS - TARGET.length;
const TARGET_CELLS = collectTargetCells();
const TARGET_SET = new Set(TARGET_CELLS);
const PLACEMENTS = buildPlacements();
const MAX_SOLVER_VISITS = 30000;

let grid;
let current;
let nextPiece;
let score;
let cubes;
let combo;
let running = false;
let paused = false;
let lastTime = 0;
let dropTimer = 0;
let dropInterval = 720;
let audioCtx = null;
let soundOn = true;
let timeLeftMs = 10 * 60 * 1000;
let musicPrimed = false;
let restartTimeout = null;
let boardTouch = null;

function createGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function randomPiece() {
  const shape = PIECES[Math.floor(Math.random() * PIECES.length)];
  return {
    shape: shape.map(row => [...row]),
    x: Math.floor(COLS / 2) - Math.ceil(shape[0].length / 2),
    y: -1,
    color: COLORS[0]
  };
}

function resetGame() {
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  grid = createGrid();
  score = 0;
  cubes = 0;
  combo = 0;
  timeLeftMs = 10 * 60 * 1000;
  dropInterval = 720;
  dropTimer = 0;
  current = randomPiece();
  nextPiece = randomPiece();
  running = true;
  paused = false;
  statusEl.textContent = "Fill the silhouette. You only lose when no cube combination can finish it.";
  updateHud();
  draw();
}

function updateHud() {
  scoreEl.textContent = score;
  linesEl.textContent = cubes;
  comboEl.textContent = combo;
  timeEl.textContent = formatTime(timeLeftMs);
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString();
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function rotate(shape) {
  return shape[0].map((_, col) => shape.map(row => row[col]).reverse());
}

function collides(piece, offsetX = 0, offsetY = 0, shape = piece.shape) {
  for (let y = 0; y < shape.length; y += 1) {
    for (let x = 0; x < shape[y].length; x += 1) {
      if (!shape[y][x]) continue;
      const boardX = piece.x + x + offsetX;
      const boardY = piece.y + y + offsetY;
      if (boardX < 0 || boardX >= COLS || boardY >= ROWS) return true;
      if (boardY >= 0 && grid[boardY][boardX]) return true;
    }
  }
  return false;
}

function mergePiece() {
  current.shape.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell) return;
      const boardY = current.y + y;
      if (boardY >= 0) {
        grid[boardY][current.x + x] = current.color;
        cubes += 1;
      }
    });
  });
}

function targetComplete() {
  return TARGET_CELLS.every(cell => isOccupiedCell(cell));
}

function impossibleToComplete() {
  return !hasCompletionPlan();
}

function clearForSahur() {
  if (targetComplete()) {
    combo += 1;
    score += 1;
    cubes = 0;
    grid = createGrid();
    dropInterval = Math.max(220, dropInterval - 26);
    statusEl.textContent = combo > 1 ? `TUNG TUNG SAHUR x${combo}!` : "TUNG TUNG SAHUR!";
    showSahurCelebration();
    playChant(combo);
  } else if (impossibleToComplete()) {
    loseGame("No cube combination can finish it. YOU LOST.");
  } else {
    statusEl.textContent = "There are still possible cube combinations.";
  }
}

function collectTargetCells() {
  const cells = [];
  TARGET.forEach((row, y) => {
    row.forEach((needed, x) => {
      if (needed) cells.push(cellId(x, TARGET_OFFSET_Y + y));
    });
  });
  return cells;
}

function cellId(x, y) {
  return y * COLS + x;
}

function cellX(id) {
  return id % COLS;
}

function cellY(id) {
  return Math.floor(id / COLS);
}

function isOccupiedCell(id) {
  return Boolean(grid[cellY(id)][cellX(id)]);
}

function trimShape(shape) {
  const points = [];
  shape.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell) points.push([x, y]);
    });
  });
  const minX = Math.min(...points.map(point => point[0]));
  const minY = Math.min(...points.map(point => point[1]));
  const normalized = points.map(([x, y]) => [x - minX, y - minY]);
  const width = Math.max(...normalized.map(point => point[0])) + 1;
  const height = Math.max(...normalized.map(point => point[1])) + 1;
  return {
    cells: normalized,
    width,
    height,
    key: normalized.map(point => point.join(",")).sort().join(";")
  };
}

function uniqueOrientations(shape) {
  const orientations = [];
  const seen = new Set();
  let currentShape = shape;
  for (let i = 0; i < 4; i += 1) {
    const trimmed = trimShape(currentShape);
    if (!seen.has(trimmed.key)) {
      seen.add(trimmed.key);
      orientations.push(trimmed);
    }
    currentShape = rotate(currentShape);
  }
  return orientations;
}

function buildPlacements() {
  const placements = [];
  PIECES.forEach(shape => {
    uniqueOrientations(shape).forEach(orientation => {
      for (let y = 0; y <= ROWS - orientation.height; y += 1) {
        for (let x = 0; x <= COLS - orientation.width; x += 1) {
          const cells = orientation.cells.map(([offsetX, offsetY]) => cellId(x + offsetX, y + offsetY));
          const coversTarget = cells.filter(cell => TARGET_SET.has(cell));
          if (coversTarget.length > 0) placements.push({ cells, coversTarget });
        }
      }
    });
  });
  return placements;
}

function hasCompletionPlan() {
  const occupied = new Set();
  grid.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (cell) occupied.add(cellId(x, y));
    });
  });

  const emptyTargets = new Set(TARGET_CELLS.filter(cell => !occupied.has(cell)));
  if (emptyTargets.size === 0) return true;

  let visits = 0;
  const memo = new Set();
  return searchCompletion(occupied, emptyTargets, memo, () => {
    visits += 1;
    return visits <= MAX_SOLVER_VISITS;
  });
}

function searchCompletion(occupied, emptyTargets, memo, canContinue) {
  if (emptyTargets.size === 0) return true;
  if (!canContinue()) return true;

  const key = `${[...emptyTargets].sort((a, b) => a - b).join(".")}|${[...occupied].sort((a, b) => a - b).join(".")}`;
  if (memo.has(key)) return false;

  let bestPlacements = null;
  for (const targetCell of emptyTargets) {
    const candidates = PLACEMENTS.filter(placement => {
      return placement.coversTarget.includes(targetCell) && placement.cells.every(cell => !occupied.has(cell));
    });
    if (!bestPlacements || candidates.length < bestPlacements.length) {
      bestPlacements = candidates;
      if (bestPlacements.length === 0) break;
    }
  }

  if (!bestPlacements || bestPlacements.length === 0) {
    memo.add(key);
    return false;
  }

  for (const placement of bestPlacements) {
    const nextOccupied = new Set(occupied);
    const nextEmptyTargets = new Set(emptyTargets);
    placement.cells.forEach(cell => nextOccupied.add(cell));
    placement.coversTarget.forEach(cell => nextEmptyTargets.delete(cell));
    if (searchCompletion(nextOccupied, nextEmptyTargets, memo, canContinue)) return true;
  }

  memo.add(key);
  return false;
}

function showSahurCelebration() {
  celebrationEl.classList.remove("is-active");
  void celebrationEl.offsetWidth;
  celebrationEl.classList.add("is-active");
}

function showLostCelebration() {
  lostCelebrationEl.classList.remove("is-active");
  void lostCelebrationEl.offsetWidth;
  lostCelebrationEl.classList.add("is-active");
}

function loseGame(message) {
  if (restartTimeout) clearTimeout(restartTimeout);
  running = false;
  paused = false;
  statusEl.textContent = message;
  pauseMusic();
  showLostCelebration();
  playGameOver();
  draw();
  restartTimeout = setTimeout(() => {
    if (soundOn) restartMusic();
    resetGame();
  }, 1400);
}

function spawnNext() {
  current = nextPiece;
  nextPiece = randomPiece();
  if (collides(current)) {
    loseGame("No space left. YOU LOST.");
  }
}

function stepDown() {
  if (!running || paused) return;
  if (!collides(current, 0, 1)) {
    current.y += 1;
    return;
  }
  mergePiece();
  clearForSahur();
  if (running) spawnNext();
}

function hardDrop() {
  if (!running || paused) return;
  while (!collides(current, 0, 1)) current.y += 1;
  stepDown();
  draw();
}

function move(dx) {
  if (!running || paused || collides(current, dx, 0)) return;
  current.x += dx;
  draw();
}

function rotateCurrent() {
  if (!running || paused) return;
  const rotated = rotate(current.shape);
  if (!collides(current, 0, 0, rotated)) {
    current.shape = rotated;
  } else if (!collides(current, -1, 0, rotated)) {
    current.x -= 1;
    current.shape = rotated;
  } else if (!collides(current, 1, 0, rotated)) {
    current.x += 1;
    current.shape = rotated;
  }
  draw();
}

function boardPointFromEvent(event) {
  const rect = boardCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * COLS,
    y: ((event.clientY - rect.top) / rect.height) * ROWS
  };
}

function pointHitsCurrentPiece(point) {
  if (!current || !running || paused) return false;
  const cellX = Math.floor(point.x);
  const cellY = Math.floor(point.y);
  return current.shape.some((row, y) => {
    return row.some((cell, x) => cell && current.x + x === cellX && current.y + y === cellY);
  });
}

function moveTowardColumn(targetX) {
  if (!running || paused || !current) return;
  const pieceCenter = current.x + current.shape[0].length / 2;
  const direction = targetX < pieceCenter ? -1 : 1;
  move(direction);
}

function startBoardTouch(event) {
  if (!running || paused) return;
  event.preventDefault();
  boardCanvas.setPointerCapture(event.pointerId);
  const point = boardPointFromEvent(event);
  boardTouch = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    startedOnPiece: pointHitsCurrentPiece(point),
    startedAt: performance.now()
  };
}

function moveBoardTouch(event) {
  if (!boardTouch || boardTouch.pointerId !== event.pointerId) return;
  event.preventDefault();
  const rect = boardCanvas.getBoundingClientRect();
  const cellWidth = rect.width / COLS;
  const cellHeight = rect.height / ROWS;
  let dx = event.clientX - boardTouch.lastX;
  let dy = event.clientY - boardTouch.lastY;

  while (Math.abs(dx) >= cellWidth * 0.58) {
    const direction = dx > 0 ? 1 : -1;
    move(direction);
    boardTouch.lastX += direction * cellWidth * 0.58;
    dx = event.clientX - boardTouch.lastX;
  }

  while (dy >= cellHeight * 0.7) {
    stepDown();
    boardTouch.lastY += cellHeight * 0.7;
    dy = event.clientY - boardTouch.lastY;
  }
}

function endBoardTouch(event) {
  if (!boardTouch || boardTouch.pointerId !== event.pointerId) return;
  event.preventDefault();
  const elapsed = performance.now() - boardTouch.startedAt;
  const totalDx = event.clientX - boardTouch.startX;
  const totalDy = event.clientY - boardTouch.startY;
  const travel = Math.hypot(totalDx, totalDy);
  const rect = boardCanvas.getBoundingClientRect();
  const point = boardPointFromEvent(event);

  if (totalDy > rect.height * 0.14 && Math.abs(totalDy) > Math.abs(totalDx) * 1.45 && elapsed < 420) {
    hardDrop();
  } else if (travel < 12 && boardTouch.startedOnPiece && pointHitsCurrentPiece(point)) {
    rotateCurrent();
  } else if (travel < 12) {
    moveTowardColumn(point.x);
  }

  if (boardCanvas.hasPointerCapture(event.pointerId)) {
    boardCanvas.releasePointerCapture(event.pointerId);
  }
  boardTouch = null;
}

function cancelBoardTouch(event) {
  if (!boardTouch || boardTouch.pointerId !== event.pointerId) return;
  boardTouch = null;
}

function drawCube(ctx, x, y, size, color) {
  const inset = Math.max(2, size * 0.08);
  ctx.fillStyle = color;
  ctx.fillRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.fillRect(x + inset, y + inset, size - inset * 2, Math.max(3, size * 0.16));
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x + inset, y + inset, size - inset * 2, size - inset * 2);
}

function drawGrid() {
  boardCtx.fillStyle = "#0b0d12";
  boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

  boardCtx.strokeStyle = "rgba(255,255,255,0.055)";
  boardCtx.lineWidth = 1;
  for (let x = 0; x <= COLS; x += 1) {
    boardCtx.beginPath();
    boardCtx.moveTo(x * CELL, 0);
    boardCtx.lineTo(x * CELL, ROWS * CELL);
    boardCtx.stroke();
  }
  for (let y = 0; y <= ROWS; y += 1) {
    boardCtx.beginPath();
    boardCtx.moveTo(0, y * CELL);
    boardCtx.lineTo(COLS * CELL, y * CELL);
    boardCtx.stroke();
  }

  TARGET.forEach((row, y) => {
    row.forEach((needed, x) => {
      if (!needed) return;
      const boardY = TARGET_OFFSET_Y + y;
      const filled = Boolean(grid[boardY][x]);
      boardCtx.fillStyle = filled ? "rgba(255, 207, 74, 0.2)" : "rgba(255, 207, 74, 0.09)";
      boardCtx.fillRect(x * CELL + 4, boardY * CELL + 4, CELL - 8, CELL - 8);
      boardCtx.strokeStyle = "rgba(255, 207, 74, 0.42)";
      boardCtx.strokeRect(x * CELL + 4, boardY * CELL + 4, CELL - 8, CELL - 8);
    });
  });
}

function drawPiece(ctx, piece, cellSize, offsetX = 0, offsetY = 0) {
  piece.shape.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell) return;
      const drawY = piece.y + y;
      if (drawY >= 0) {
        drawCube(ctx, (piece.x + x) * cellSize + offsetX, drawY * cellSize + offsetY, cellSize, piece.color);
      }
    });
  });
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  nextCtx.fillStyle = "#12161d";
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  const size = 24;
  const preview = { ...nextPiece, x: 0, y: 0 };
  const width = nextPiece.shape[0].length * size;
  const height = nextPiece.shape.length * size;
  drawPiece(nextCtx, preview, size, (nextCanvas.width - width) / 2, (nextCanvas.height - height) / 2);
}

function draw() {
  drawGrid();
  grid.forEach((row, y) => {
    row.forEach((color, x) => {
      if (color) drawCube(boardCtx, x * CELL, y * CELL, CELL, color);
    });
  });
  if (current) drawPiece(boardCtx, current, CELL);
  if (nextPiece) drawNext();
  updateHud();
}

function tick(time = 0) {
  const delta = time - lastTime;
  lastTime = time;
  if (running && !paused) {
    timeLeftMs -= delta;
    if (timeLeftMs <= 0) {
      timeLeftMs = 0;
      loseGame("Time is up. YOU LOST.");
      requestAnimationFrame(tick);
      return;
    }
    dropTimer += delta;
    if (dropTimer > dropInterval) {
      stepDown();
      dropTimer = 0;
    }
    draw();
  }
  requestAnimationFrame(tick);
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function drum(time, frequency, duration, gain) {
  if (!soundOn) return;
  ensureAudio();
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, time);
  osc.frequency.exponentialRampToValueAtTime(42, time + duration);
  amp.gain.setValueAtTime(gain, time);
  amp.gain.exponentialRampToValueAtTime(0.001, time + duration);
  osc.connect(amp);
  amp.connect(audioCtx.destination);
  osc.start(time);
  osc.stop(time + duration);
}

function playChant(cleared) {
  if (!soundOn) return;
  ensureAudio();
  const now = audioCtx.currentTime;
  drum(now, 150, 0.16, 0.22);
  drum(now + 0.18, 135, 0.16, 0.2);
  drum(now + 0.36, cleared >= 4 ? 210 : 120, 0.2, 0.24);
}

function playGameOver() {
  if (!soundOn) return;
  ensureAudio();
  const now = audioCtx.currentTime;
  drum(now, 110, 0.25, 0.18);
  drum(now + 0.28, 80, 0.32, 0.16);
}

function toggleSound() {
  soundOn = !soundOn;
  soundToggle.classList.toggle("is-on", soundOn);
  soundToggle.setAttribute("aria-label", soundOn ? "Turn sound off" : "Turn sound on");
  if (soundOn) {
    ensureAudio();
    playMusic();
    playChant(1);
  } else {
    pauseMusic();
  }
}

startBtn.addEventListener("click", () => {
  if (soundOn) ensureAudio();
  if (soundOn) restartMusic();
  resetGame();
});

previewWinBtn.addEventListener("click", () => {
  statusEl.textContent = "TUNG TUNG SAHUR!";
  showSahurCelebration();
  playChant(4);
});

previewLoseBtn.addEventListener("click", () => {
  statusEl.textContent = "YOU LOST";
  pauseMusic();
  showLostCelebration();
  playGameOver();
});

pauseBtn.addEventListener("click", () => {
  if (!running) return;
  paused = !paused;
  if (paused) {
    pauseMusic();
  } else if (soundOn) {
    playMusic();
  }
  statusEl.textContent = paused ? "Paused." : "Fill the silhouette. You only lose when no cube combination can finish it.";
});

soundToggle.addEventListener("click", toggleSound);

function playMusic() {
  musicTrack.volume = 0.5;
  return musicTrack.play().then(() => {
    musicPrimed = true;
  }).catch(() => {
    statusEl.textContent = "Music is on. Click once if Brave blocks autoplay.";
  });
}

function pauseMusic() {
  musicTrack.pause();
}

function restartMusic() {
  musicTrack.currentTime = 0;
  playMusic();
}

function preventPageMotion(event) {
  event.preventDefault();
}

window.addEventListener("touchmove", preventPageMotion, { passive: false });
window.addEventListener("wheel", preventPageMotion, { passive: false });
window.addEventListener("scroll", () => window.scrollTo(0, 0));

document.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (["arrowleft", "arrowright", "arrowup", "arrowdown", " ", "pageup", "pagedown", "home", "end"].includes(key)) {
    event.preventDefault();
  }
  if (key === "arrowleft" || key === "a") move(-1);
  if (key === "arrowright" || key === "d") move(1);
  if (key === "arrowup" || key === "w" || key === " ") rotateCurrent();
  if (key === "arrowdown" || key === "s") stepDown();
  if (key === "enter") hardDrop();
  if (key === "p") pauseBtn.click();
  if (key === "m") toggleSound();
});

document.querySelectorAll("[data-action]").forEach(button => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "left") move(-1);
    if (action === "right") move(1);
    if (action === "rotate") rotateCurrent();
    if (action === "drop") hardDrop();
  });
});

boardCanvas.addEventListener("pointerdown", startBoardTouch);
boardCanvas.addEventListener("pointermove", moveBoardTouch);
boardCanvas.addEventListener("pointerup", endBoardTouch);
boardCanvas.addEventListener("pointercancel", cancelBoardTouch);

document.addEventListener("pointerdown", () => {
  if (soundOn && !musicPrimed) playMusic();
}, { once: true });

window.addEventListener("load", () => {
  if (soundOn) playMusic();
});

sahurPhotos.forEach(photo => {
  photo.addEventListener("load", () => {
    const celebration = photo.closest(".celebration");
    if (photo.naturalWidth > 0) celebration.classList.remove("use-fallback");
  });

  photo.addEventListener("error", () => {
    photo.closest(".celebration").classList.add("use-fallback");
  });

  if (photo.complete && photo.naturalWidth > 0) {
    photo.closest(".celebration").classList.remove("use-fallback");
  }
});

grid = createGrid();
current = randomPiece();
nextPiece = randomPiece();
resetGame();
requestAnimationFrame(tick);
