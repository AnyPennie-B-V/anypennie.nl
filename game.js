const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const scoreVal = document.getElementById('score-val');
const scoreContainer = document.getElementById('score-container');
const livesVal = document.getElementById('lives-val');
const finalScoreVal = document.getElementById('final-score-val');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const submitScoreBtn = document.getElementById('submit-score-btn');
const playerNameInput = document.getElementById('player-name');
const scoreSubmitGroup = document.getElementById('score-submit-group');
const leaderboardList = document.getElementById('leaderboard-list');
const rulesBtn = document.getElementById('rules-btn');
const closeRulesBtn = document.getElementById('close-rules-btn');
const rulesModal = document.getElementById('rules-modal');

// Images
const imgKanon = document.getElementById('img-kanon');
const imgKetel1 = document.getElementById('img-ketel1');
const imgCoin = document.getElementById('img-coin');
const imgCCV = document.getElementById('img-ccv');

// Game State
let isPlaying = false;
let isMenuMode = true;
let score = 0;
let lives = 3;
let items = [];
let particles = [];
let sliceTrail = [];
let mouse = { x: 0, y: 0, isDown: false };
let lastSlicedType = null;
let animationFrameId;

// Difficulty parameters
let spawnRate = 2000; // ms between spawns
let lastSpawnTime = 0;
let gravity = 0.2;

// Resize canvas
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Item Types
const ITEM_TYPES = {
  KANON: { type: 'kanon', img: imgKanon, isGood: true, width: 60, height: 100 },
  KETEL1: { type: 'ketel1', img: imgKetel1, isGood: true, width: 40, height: 120 },
  COIN: { type: 'coin', img: imgCoin, isGood: false, width: 60, height: 60 },
  CCV: { type: 'ccv', img: imgCCV, isGood: false, width: 70, height: 90 }
};

class GameItem {
  constructor() {
    // Pick random type, weighted slightly towards good items
    const rand = Math.random();
    let typeDef;
    if (rand < 0.4) typeDef = ITEM_TYPES.KANON;
    else if (rand < 0.8) typeDef = ITEM_TYPES.KETEL1;
    else if (rand < 0.9) typeDef = ITEM_TYPES.COIN;
    else typeDef = ITEM_TYPES.CCV;

    this.typeDef = typeDef;
    
    // Calculate aspect ratio dynamically to prevent image warping
    const img = typeDef.img;
    const naturalWidth = img.naturalWidth || typeDef.width;
    const naturalHeight = img.naturalHeight || typeDef.height;
    const aspectRatio = naturalWidth / naturalHeight;
    
    // Set size while keeping aspect ratio intact
    const maxDimension = typeDef.type === 'ccv' ? 200 : 150;
    if (aspectRatio > 1) {
      this.width = maxDimension;
      this.height = maxDimension / aspectRatio;
    } else {
      this.height = maxDimension;
      this.width = maxDimension * aspectRatio;
    }
    
    // Spawn at bottom
    this.x = Math.random() * (canvas.width - this.width * 2) + this.width;
    this.y = canvas.height + this.height;
    
    // Calculate velocity to arc across screen
    // Target peak height to be within the upper window (15% to 45% of canvas height)
    const targetY = canvas.height * (0.15 + Math.random() * 0.3);
    const targetX = canvas.width * (0.2 + Math.random() * 0.6);
    
    // Peak height: vy is calculated using kinematic equation: v^2 = u^2 + 2as
    // At peak, vy = 0. So, 0 = vy^2 - 2 * gravity * height
    // vy = -sqrt(2 * gravity * height)
    const heightToPeak = this.y - targetY;
    this.vy = -Math.sqrt(2 * gravity * heightToPeak);
    
    // time to peak = -vy / gravity
    const timeToPeak = -this.vy / gravity;
    
    // vx = distance / time
    this.vx = (targetX - this.x) / timeToPeak;
    
    this.rotation = 0;
    this.rotationSpeed = (Math.random() - 0.5) * 0.1;
    this.isSliced = false;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += gravity;
    this.rotation += this.rotationSpeed;
  }

  draw(ctx) {
    if (this.isSliced) return; // Don't draw if sliced (could add halves later)
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    ctx.drawImage(this.typeDef.img, -this.width / 2, -this.height / 2, this.width, this.height);
    ctx.restore();
  }

  checkSlice(sliceSegment) {
    if (this.isSliced) return false;
    
    // Hitbox is roughly a circle around center
    const radius = Math.max(this.width, this.height) / 2;
    
    // Check distance from slice line segment to center of item
    const dist = pointToLineDistance(this.x, this.y, sliceSegment.p1.x, sliceSegment.p1.y, sliceSegment.p2.x, sliceSegment.p2.y);
    
    if (dist < radius) {
      this.slice();
      return true;
    }
    return false;
  }

  slice() {
    this.isSliced = true;
    createParticles(this.x, this.y, this.typeDef.isGood ? '#E62272' : '#ff3333');
    
    if (isMenuMode) {
      createFloatingText(this.x, this.y, this.typeDef.isGood ? "Slice!" : "Boom!", this.typeDef.isGood ? "#E62272" : "#ff3333");
      return;
    }
    
    if (this.typeDef.isGood) {
      // Combo logic
      let pts = 10;
      if (lastSlicedType === 'kanon' && this.typeDef.type === 'ketel1') {
        pts += 5; // Combo!
        createFloatingText(this.x, this.y, "+15 COMBO!", "#FFD700");
      } else {
        createFloatingText(this.x, this.y, "+10", "#E62272");
      }
      
      score += pts;
      scoreVal.innerText = score;
      lastSlicedType = this.typeDef.type;
      
      // Speed up spawn rate
      spawnRate = Math.max(600, 2000 - (score * 15));
      gravity = Math.min(0.6, 0.2 + (score * 0.004));
      
    } else {
      // Sliced a bad item! Game Over immediately.
      createFloatingText(this.x, this.y, "FATAL ERROR!", "#ff3333");
      endGame();
    }
  }
}

// Visual effects
class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 10;
    this.vy = (Math.random() - 0.5) * 10;
    this.life = 1.0;
    this.color = color;
    this.size = Math.random() * 5 + 2;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life -= 0.02;
  }
  draw(ctx) {
    ctx.globalAlpha = this.life;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }
}

class FloatingText {
  constructor(x, y, text, color) {
    this.x = x;
    this.y = y;
    this.text = text;
    this.color = color;
    this.life = 1.0;
    this.vy = -2;
  }
  update() {
    this.y += this.vy;
    this.life -= 0.02;
  }
  draw(ctx) {
    ctx.globalAlpha = this.life;
    ctx.fillStyle = this.color;
    ctx.font = "bold 24px 'Bebas Neue', sans-serif";
    ctx.fillText(this.text, this.x, this.y);
    ctx.globalAlpha = 1.0;
  }
}

function createParticles(x, y, color) {
  for (let i = 0; i < 15; i++) {
    particles.push(new Particle(x, y, color));
  }
}

function createFloatingText(x, y, text, color) {
  particles.push(new FloatingText(x, y, text, color));
}

// Math util
function pointToLineDistance(x, y, x1, y1, x2, y2) {
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  
  const dot = A * C + B * D;
  const len_sq = C * C + D * D;
  let param = -1;
  if (len_sq != 0) //in case of 0 length line
      param = dot / len_sq;
      
  let xx, yy;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  
  const dx = x - xx;
  const dy = y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Input handling
function handleInputStart(e) {
  if (!isPlaying) return;
  mouse.isDown = true;
  updateMousePos(e);
  sliceTrail = [{x: mouse.x, y: mouse.y}];
}

function handleInputMove(e) {
  if (!isPlaying || !mouse.isDown) return;
  updateMousePos(e);
  sliceTrail.push({x: mouse.x, y: mouse.y});
  
  // Keep trail short
  if (sliceTrail.length > 10) {
    sliceTrail.shift();
  }
  
  // Check for slices using the last segment
  if (sliceTrail.length > 1) {
    const p1 = sliceTrail[sliceTrail.length - 2];
    const p2 = sliceTrail[sliceTrail.length - 1];
    
    // Only register if moved enough
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) > 5) {
      items.forEach(item => {
        item.checkSlice({p1, p2});
      });
    }
  }
}

function handleInputEnd() {
  mouse.isDown = false;
  sliceTrail = [];
}

function updateMousePos(e) {
  if (e.touches) {
    mouse.x = e.touches[0].clientX;
    mouse.y = e.touches[0].clientY;
  } else {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }
}

canvas.addEventListener('mousedown', handleInputStart);
canvas.addEventListener('mousemove', handleInputMove);
window.addEventListener('mouseup', handleInputEnd);

canvas.addEventListener('touchstart', handleInputStart, {passive: false});
canvas.addEventListener('touchmove', handleInputMove, {passive: false});
window.addEventListener('touchend', handleInputEnd);

// Game Loop
function startGame() {
  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  scoreContainer.classList.remove('hidden');
  livesVal.classList.remove('hidden');
  
  isPlaying = true;
  isMenuMode = false;
  score = 0;
  lives = 3;
  items = [];
  particles = [];
  sliceTrail = [];
  lastSlicedType = null;
  spawnRate = 2000;
  gravity = 0.2;
  lastSpawnTime = performance.now();
  
  scoreVal.innerText = score;
  updateLivesDisplay();
  
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  gameLoop(performance.now());
}

function updateLivesDisplay() {
  let hearts = '';
  for(let i=0; i<lives; i++) hearts += '❤️';
  for(let i=lives; i<3; i++) hearts += '🖤';
  livesVal.innerText = hearts;
}

function loseLife() {
  lives--;
  updateLivesDisplay();
  
  // Flash screen red
  ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  if (lives <= 0) {
    endGame();
  }
}

function endGame() {
  isPlaying = false;
  isMenuMode = true;
  gameOverScreen.classList.remove('hidden');
  scoreContainer.classList.add('hidden');
  livesVal.classList.add('hidden');
  finalScoreVal.innerText = score;
  
  scoreSubmitGroup.classList.remove('hidden');
  restartBtn.classList.add('hidden');
  
  const savedName = localStorage.getItem('ninjaPlayerName');
  if (savedName) {
    playerNameInput.value = savedName;
    playerNameInput.readOnly = true;
    playerNameInput.style.opacity = '0.7';
  } else {
    playerNameInput.value = '';
    playerNameInput.readOnly = false;
    playerNameInput.style.opacity = '1';
    playerNameInput.focus();
  }
  
  fetchLeaderboard();
  
  lastSpawnTime = performance.now();
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  gameLoop(performance.now());
}

function gameLoop(timestamp) {
  if (!isPlaying && !isMenuMode) return;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Spawn logic
  const currentSpawnRate = isMenuMode ? 1800 : spawnRate;
  if (timestamp - lastSpawnTime > currentSpawnRate) {
    if (isMenuMode) {
      items.push(new GameItem());
    } else {
      // Spawn 1 to 3 items depending on difficulty
      const numSpawn = Math.min(3, 1 + Math.floor(Math.random() * (score / 100)));
      for(let i=0; i<numSpawn; i++) {
        items.push(new GameItem());
      }
    }
    lastSpawnTime = timestamp;
  }
  
  // Update & Draw Items
  for (let i = items.length - 1; i >= 0; i--) {
    let item = items[i];
    item.update();
    item.draw(ctx);
    
    // Check out of bounds (bottom)
    if (item.y - item.height > canvas.height) {
      if (!isMenuMode && item.typeDef.isGood && !item.isSliced) {
        // Missed a good item!
        loseLife();
      }
      items.splice(i, 1);
    }
  }
  
  // Update & Draw Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    let p = particles[i];
    p.update();
    p.draw(ctx);
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
  
  // Draw Slice Trail
  if (mouse.isDown && sliceTrail.length > 1) {
    ctx.beginPath();
    ctx.moveTo(sliceTrail[0].x, sliceTrail[0].y);
    for (let i = 1; i < sliceTrail.length; i++) {
      ctx.lineTo(sliceTrail[i].x, sliceTrail[i].y);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    
    // Glow
    ctx.strokeStyle = 'rgba(230, 34, 114, 0.5)';
    ctx.lineWidth = 8;
    ctx.stroke();
  }
  
  if (isPlaying || isMenuMode) {
    animationFrameId = requestAnimationFrame(gameLoop);
  }
}

// API Integration
async function fetchLeaderboard() {
  leaderboardList.innerHTML = '<div style="text-align:center; padding: 20px;">Loading scores...</div>';
  try {
    const res = await fetch('/api/data');
    const data = await res.json();
    const scores = data.gameLeaderboard || [];
    
    const uniqueScores = new Map();
    scores.forEach(entry => {
      const key = (entry.playerName || '').toLowerCase();
      if (!key) return;
      if (!uniqueScores.has(key)) {
        uniqueScores.set(key, entry);
      } else {
        const existing = uniqueScores.get(key);
        if (entry.score > existing.score) {
          uniqueScores.set(key, entry);
        } else if (entry.score === existing.score) {
          if (new Date(entry.timestamp) > new Date(existing.timestamp)) {
            uniqueScores.set(key, entry);
          }
        }
      }
    });
    const finalScores = Array.from(uniqueScores.values()).sort((a, b) => b.score - a.score);
    
    renderLeaderboard(finalScores);
  } catch (err) {
    console.error(err);
    leaderboardList.innerHTML = '<div style="text-align:center; padding: 20px; color: #ff3333;">Failed to load leaderboard</div>';
  }
}

function renderLeaderboard(scores) {
  if (scores.length === 0) {
    leaderboardList.innerHTML = '<div style="text-align:center; padding: 20px;">No scores yet! Be the first!</div>';
    return;
  }
  
  leaderboardList.innerHTML = '';
  // Show top 10
  scores.slice(0, 10).forEach((entry, idx) => {
    const div = document.createElement('div');
    div.className = 'leaderboard-item';
    div.innerHTML = `
      <span class="rank">#${idx + 1}</span>
      <span class="name">${escapeHTML(entry.playerName)}</span>
      <span class="score">${entry.score} pts</span>
    `;
    leaderboardList.appendChild(div);
  });
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag]));
}

async function submitScore() {
  const name = playerNameInput.value.trim() || 'Anonymous Ninja';
  
  if (!localStorage.getItem('ninjaPlayerName') && name !== 'Anonymous Ninja') {
    localStorage.setItem('ninjaPlayerName', name);
  }
  
  submitScoreBtn.disabled = true;
  submitScoreBtn.innerText = 'Submitting...';
  
  try {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'log_game_score',
        playerName: name,
        score: score
      })
    });
    
    if (res.ok) {
      scoreSubmitGroup.classList.add('hidden');
      restartBtn.classList.remove('hidden');
      fetchLeaderboard();
    } else {
      alert("Failed to submit score.");
    }
  } catch (err) {
    console.error(err);
    alert("Error submitting score.");
  } finally {
    submitScoreBtn.disabled = false;
    submitScoreBtn.innerText = 'SUBMIT';
  }
}

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
submitScoreBtn.addEventListener('click', submitScore);

rulesBtn.addEventListener('click', () => {
  rulesModal.classList.remove('hidden');
});

closeRulesBtn.addEventListener('click', () => {
  rulesModal.classList.add('hidden');
});

// Allow Enter key to submit
playerNameInput.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    submitScore();
  }
});

const SPLASH_SLOGANS = [
  "Slice the Kanon!",
  "Watch out for the Pin Terminal!",
  "Ketel 1 is life!",
  "More Anys!",
  "Don't slice that Coin!",
  "Grolsch Kanon enjoyer!",
  "Are you Board 34?",
  "Easter Egg Hunter!",
  "No outstanding debts!",
  "Slice, Slice, Baby!",
  "100% Organic Slicing!",
  "Better than a pinbon!",
  "Thalia is not a drinking association!",
  "Consume the liquids!",
  "Slicing in 2D!"
];

function initSplashText() {
  const splashEl = document.getElementById('splash-text');
  if (splashEl) {
    const randomSlogan = SPLASH_SLOGANS[Math.floor(Math.random() * SPLASH_SLOGANS.length)];
    splashEl.innerText = randomSlogan;
  }
}

// Initialize menu mode on page load
function initMenu() {
  isPlaying = false;
  isMenuMode = true;
  scoreContainer.classList.add('hidden');
  livesVal.classList.add('hidden');
  items = [];
  particles = [];
  lastSpawnTime = performance.now();
  initSplashText();
  gameLoop(performance.now());
}

initMenu();
