// DominoEditor V24.5 Weight / Gravity controls
// Adds global domino mass and gravity multipliers without coupling to V24App internals.

const STORAGE_KEY = 'DominoEditorV24WeightGravityDefaults';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v) || 1));
}

function loadDefaults() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      weightScale: clamp(saved.weightScale ?? 1, 0.25, 5),
      gravityScale: clamp(saved.gravityScale ?? 1, 0.25, 3)
    };
  } catch {
    return { weightScale: 1, gravityScale: 1 };
  }
}

const defaults = loadDefaults();
window.DominoPhysicsDefaults = defaults;

function saveDefaults() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
}

function editorEntities() {
  return window.DominoEditorV24?.entities || [];
}

function applyToAllDominoes() {
  let count = 0;
  for (const entity of editorEntities()) {
    if (entity?.type !== 'domino') continue;
    entity.weightScale = defaults.weightScale;
    entity.gravityScale = defaults.gravityScale;
    count++;
  }
  const msg = document.getElementById('message');
  if (msg) msg.textContent = `已把重量 ${defaults.weightScale.toFixed(2)}×、重力 ${defaults.gravityScale.toFixed(2)}× 应用到 ${count} 块牌`;
}

function mountControls() {
  const right = document.getElementById('right');
  if (!right || document.getElementById('dominoWeightGravitySection')) return false;

  const sections = [...right.querySelectorAll('.section')];
  const defaultSection = sections.find(s => s.querySelector('h3')?.textContent.includes('多米诺默认参数'));
  if (!defaultSection) return false;

  const section = document.createElement('div');
  section.className = 'section';
  section.id = 'dominoWeightGravitySection';
  section.innerHTML = `
    <h3>牌的重量 / 重力</h3>
    <div class="field"><label>重量倍率</label><input id="dominoWeightScale" type="number" min="0.25" max="5" step="0.05" value="${defaults.weightScale}"></div>
    <div class="field"><label>重力倍率</label><input id="dominoGravityScale" type="number" min="0.25" max="3" step="0.05" value="${defaults.gravityScale}"></div>
    <div class="row"><button id="applyWeightGravityBtn">应用到全部牌</button><button id="resetWeightGravityBtn">恢复 1×</button></div>
    <div class="hint">重量倍率改变牌的真实质量和惯性；重力倍率只改变该牌受到的向下重力。更重的牌更难被撞飞，也更难被轻碰带走。</div>
  `;

  defaultSection.insertAdjacentElement('afterend', section);

  const weightInput = document.getElementById('dominoWeightScale');
  const gravityInput = document.getElementById('dominoGravityScale');

  const sync = () => {
    defaults.weightScale = clamp(weightInput.value, 0.25, 5);
    defaults.gravityScale = clamp(gravityInput.value, 0.25, 3);
    weightInput.value = defaults.weightScale;
    gravityInput.value = defaults.gravityScale;
    saveDefaults();
  };

  weightInput.addEventListener('change', sync);
  gravityInput.addEventListener('change', sync);
  document.getElementById('applyWeightGravityBtn').addEventListener('click', () => {
    sync();
    applyToAllDominoes();
  });
  document.getElementById('resetWeightGravityBtn').addEventListener('click', () => {
    defaults.weightScale = 1;
    defaults.gravityScale = 1;
    weightInput.value = 1;
    gravityInput.value = 1;
    saveDefaults();
  });

  return true;
}

let attempts = 0;
const timer = setInterval(() => {
  attempts++;
  if (mountControls() || attempts > 100) clearInterval(timer);
}, 50);
