const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
const PIECES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const SCORE_TABLE = [0, 100, 300, 500, 800];
const BASE_SHAPES = {
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
};

const boardElement = document.querySelector('#board');
const nextPreviewElement = document.querySelector('#nextPreview');
const stateOverlay = document.querySelector('#stateOverlay');
const pauseOverlay = document.querySelector('#pauseOverlay');
const overlayTitle = document.querySelector('#overlayTitle');
const overlayMessage = document.querySelector('#overlayMessage');
const overlayButton = document.querySelector('#overlayButton');
const statusText = document.querySelector('#statusText');
const scoreElement = document.querySelector('#score');
const bestScoreElement = document.querySelector('#bestScore');
const levelElement = document.querySelector('#level');
const linesElement = document.querySelector('#lines');

let board = createEmptyBoard();
let activePiece = null;
let nextPiece = null;
let bag = [];
let score = 0;
let bestScore = Number(localStorage.getItem('neon-stack-best') || 0);
let linesCleared = 0;
let level = 1;
let gameState = 'start';
let lastFrameTime = 0;
let dropTimer = 0;
let softDropActive = false;
let animationFrame;

function createEmptyBoard() {
  return Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(null));
}

function rotateMatrix(matrix) {
  return matrix[0].map((_, column) => matrix.map(row => row[column]).reverse());
}

function trimMatrix(matrix) {
  const rows = matrix.filter(row => row.some(Boolean));
  const columns = [];
  for (let column = 0; column < matrix[0].length; column += 1) {
    if (rows.some(row => row[column])) columns.push(column);
  }
  return rows.map(row => columns.map(column => row[column]));
}

function getShape(type, rotation = 0) {
  let shape = BASE_SHAPES[type].map(row => [...row]);
  for (let index = 0; index < rotation; index += 1) shape = trimMatrix(rotateMatrix(shape));
  return shape;
}

function refillBag() {
  bag = [...PIECES];
  for (let index = bag.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [bag[index], bag[randomIndex]] = [bag[randomIndex], bag[index]];
  }
}

function drawPieceType() {
  if (!bag.length) refillBag();
  return bag.pop();
}

function makePiece(type) {
  const shape = getShape(type);
  return {
    type,
    rotation: 0,
    x: Math.floor((BOARD_WIDTH - shape[0].length) / 2),
    y: 0,
  };
}

function collides(piece, x = piece.x, y = piece.y, rotation = piece.rotation) {
  const shape = getShape(piece.type, rotation);
  return shape.some((row, rowIndex) => row.some((filled, columnIndex) => {
    if (!filled) return false;
    const boardX = x + columnIndex;
    const boardY = y + rowIndex;
    return boardX < 0 || boardX >= BOARD_WIDTH || boardY >= BOARD_HEIGHT || (boardY >= 0 && board[boardY][boardX]);
  }));
}

function spawnNextPiece() {
  activePiece = makePiece(nextPiece);
  nextPiece = drawPieceType();
  if (collides(activePiece)) {
    endGame();
    return false;
  }
  return true;
}

function startGame() {
  board = createEmptyBoard();
  bag = [];
  score = 0;
  linesCleared = 0;
  level = 1;
  dropTimer = 0;
  softDropActive = false;
  nextPiece = drawPieceType();
  gameState = 'playing';
  spawnNextPiece();
  hideStateOverlay();
  setPaused(false);
  updateStatus('LIVE');
  render();
}

function endGame() {
  gameState = 'gameover';
  softDropActive = false;
  updateBestScore();
  updateStatus('GAME OVER');
  showStateOverlay('GAME OVER', `최종 점수 ${formatNumber(score)}점 · ${linesCleared}줄 제거`, '다시 시작');
  render();
}

function togglePause() {
  if (gameState !== 'playing' && gameState !== 'paused') return;
  setPaused(gameState === 'playing');
}

function setPaused(shouldPause) {
  if (shouldPause) {
    gameState = 'paused';
    softDropActive = false;
    pauseOverlay.classList.add('visible');
    pauseOverlay.setAttribute('aria-hidden', 'false');
    updateStatus('PAUSED');
  } else if (gameState === 'paused') {
    gameState = 'playing';
    pauseOverlay.classList.remove('visible');
    pauseOverlay.setAttribute('aria-hidden', 'true');
    updateStatus('LIVE');
  } else {
    pauseOverlay.classList.remove('visible');
    pauseOverlay.setAttribute('aria-hidden', 'true');
  }
}

function movePiece(horizontalDirection) {
  if (gameState !== 'playing' || !activePiece) return;
  const nextX = activePiece.x + horizontalDirection;
  if (!collides(activePiece, nextX, activePiece.y, activePiece.rotation)) {
    activePiece.x = nextX;
    render();
  }
}

function rotatePiece(direction = 1) {
  if (gameState !== 'playing' || !activePiece) return;
  const nextRotation = (activePiece.rotation + direction + 4) % 4;
  const offsets = [0, -1, 1, -2, 2];
  for (const offset of offsets) {
    if (!collides(activePiece, activePiece.x + offset, activePiece.y, nextRotation)) {
      activePiece.rotation = nextRotation;
      activePiece.x += offset;
      render();
      return;
    }
  }
}

function moveDown(isSoftDrop = false) {
  if (gameState !== 'playing' || !activePiece) return false;
  if (!collides(activePiece, activePiece.x, activePiece.y + 1, activePiece.rotation)) {
    activePiece.y += 1;
    if (isSoftDrop) score += 1;
    render();
    return true;
  }
  lockPiece();
  return false;
}

function hardDrop() {
  if (gameState !== 'playing' || !activePiece) return;
  let distance = 0;
  while (!collides(activePiece, activePiece.x, activePiece.y + 1, activePiece.rotation)) {
    activePiece.y += 1;
    distance += 1;
  }
  score += distance * 2;
  lockPiece();
}

function lockPiece() {
  const shape = getShape(activePiece.type, activePiece.rotation);
  shape.forEach((row, rowIndex) => row.forEach((filled, columnIndex) => {
    const boardY = activePiece.y + rowIndex;
    const boardX = activePiece.x + columnIndex;
    if (filled && boardY >= 0) board[boardY][boardX] = activePiece.type;
  }));

  const cleared = clearCompletedLines();
  if (cleared > 0) {
    score += SCORE_TABLE[cleared] * level;
    linesCleared += cleared;
    level = Math.floor(linesCleared / 10) + 1;
  }
  spawnNextPiece();
  dropTimer = 0;
  updateBestScore();
  render();
}

function clearCompletedLines() {
  const remainingRows = board.filter(row => row.some(cell => !cell));
  const cleared = BOARD_HEIGHT - remainingRows.length;
  while (remainingRows.length < BOARD_HEIGHT) remainingRows.unshift(Array(BOARD_WIDTH).fill(null));
  board = remainingRows;
  return cleared;
}

function getDropInterval() {
  return Math.max(90, 800 - (level - 1) * 70);
}

function getGhostY() {
  let ghostY = activePiece.y;
  while (!collides(activePiece, activePiece.x, ghostY + 1, activePiece.rotation)) ghostY += 1;
  return ghostY;
}

function render() {
  const cells = boardElement.children;
  for (const cell of cells) cell.className = 'cell';

  board.forEach((row, rowIndex) => row.forEach((type, columnIndex) => {
    if (type) {
      const cell = cells[rowIndex * BOARD_WIDTH + columnIndex];
      cell.classList.add('filled', `piece-${type}`);
    }
  }));

  if (activePiece) {
    const shape = getShape(activePiece.type, activePiece.rotation);
    const ghostY = getGhostY();
    shape.forEach((row, rowIndex) => row.forEach((filled, columnIndex) => {
      if (!filled) return;
      const ghostCell = cells[(ghostY + rowIndex) * BOARD_WIDTH + activePiece.x + columnIndex];
      const activeCell = cells[(activePiece.y + rowIndex) * BOARD_WIDTH + activePiece.x + columnIndex];
      if (ghostCell && !ghostCell.classList.contains('filled')) ghostCell.classList.add('ghost', `piece-${activePiece.type}`);
      if (activeCell) activeCell.classList.add('filled', 'active', `piece-${activePiece.type}`);
    }));
  }

  scoreElement.textContent = formatNumber(score);
  bestScoreElement.textContent = formatNumber(bestScore);
  levelElement.textContent = String(level).padStart(2, '0');
  linesElement.textContent = String(linesCleared).padStart(3, '0');
  renderNextPiece();
}

function renderNextPiece() {
  nextPreviewElement.innerHTML = '';
  const shape = nextPiece ? getShape(nextPiece) : [];
  for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < 4; columnIndex += 1) {
      const cell = document.createElement('span');
      cell.className = 'preview-cell';
      if (shape[rowIndex]?.[columnIndex]) cell.classList.add('filled', `piece-${nextPiece}`);
      nextPreviewElement.appendChild(cell);
    }
  }
}

function formatNumber(value) {
  return String(value).padStart(6, '0');
}

function updateBestScore() {
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('neon-stack-best', String(bestScore));
  }
}

function updateStatus(text) {
  statusText.textContent = text;
}

function showStateOverlay(title, message, buttonText) {
  overlayTitle.textContent = title;
  overlayMessage.textContent = message;
  overlayButton.textContent = buttonText;
  stateOverlay.classList.add('visible');
}

function hideStateOverlay() {
  stateOverlay.classList.remove('visible');
}

function handleAction(action) {
  if (action === 'left') movePiece(-1);
  if (action === 'right') movePiece(1);
  if (action === 'rotate') rotatePiece();
  if (action === 'down') moveDown(true);
  if (action === 'drop') hardDrop();
}

function gameLoop(timestamp = 0) {
  const elapsed = Math.min(timestamp - lastFrameTime, 100);
  lastFrameTime = timestamp;
  if (gameState === 'playing') {
    dropTimer += elapsed;
    const interval = softDropActive ? 55 : getDropInterval();
    if (dropTimer >= interval) {
      dropTimer = 0;
      moveDown(softDropActive);
    }
  }
  animationFrame = requestAnimationFrame(gameLoop);
}

function initializeBoard() {
  boardElement.innerHTML = '';
  for (let index = 0; index < BOARD_WIDTH * BOARD_HEIGHT; index += 1) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.setAttribute('role', 'gridcell');
    boardElement.appendChild(cell);
  }
}

function handleKeyDown(event) {
  const key = event.key.toLowerCase();
  const handledKeys = ['arrowleft', 'arrowright', 'arrowdown', 'arrowup', ' ', 'a', 'd', 's', 'w', 'q', 'p', 'escape', 'r'];
  if (handledKeys.includes(key)) event.preventDefault();

  if (key === 'r') {
    startGame();
    return;
  }
  if (key === 'p' || key === 'escape') {
    togglePause();
    return;
  }
  if (gameState !== 'playing') return;
  if (key === 'arrowleft' || key === 'a') movePiece(-1);
  if (key === 'arrowright' || key === 'd') movePiece(1);
  if (key === 'arrowup' || key === 'w') rotatePiece();
  if (key === 'q') rotatePiece(-1);
  if (key === ' ') hardDrop();
  if (key === 'arrowdown' || key === 's') {
    softDropActive = true;
    if (!event.repeat) moveDown(true);
  }
}

function handleKeyUp(event) {
  const key = event.key.toLowerCase();
  if (key === 'arrowdown' || key === 's') softDropActive = false;
}

initializeBoard();
nextPiece = drawPieceType();
render();

overlayButton.addEventListener('click', startGame);
document.querySelector('#restartButton').addEventListener('click', startGame);
document.addEventListener('keydown', handleKeyDown);
document.addEventListener('keyup', handleKeyUp);
document.querySelectorAll('[data-action]').forEach(button => {
  const action = button.dataset.action;
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    handleAction(action);
    if (action === 'down') softDropActive = true;
  });
  button.addEventListener('pointerup', () => {
    if (action === 'down') softDropActive = false;
  });
  button.addEventListener('pointerleave', () => {
    if (action === 'down') softDropActive = false;
  });
});

animationFrame = requestAnimationFrame(gameLoop);
