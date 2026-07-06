import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile('index.html', 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/);
if (!scriptMatch) throw new Error('inline script not found');

function createElementStub(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    dataset: {},
    style: {},
    value: '',
    innerHTML: '',
    innerText: '',
    textContent: '',
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    addEventListener(){},
    appendChild(){},
    remove(){},
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    getContext(){ return canvasContextStub; },
    getBoundingClientRect(){ return { width: 360, height: 260 }; },
    click(){},
  };
  return el;
}

const canvasContextStub = {
  scale(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fillText(){}, arc(){}, fill(){},
  measureText(text){ return { width: String(text).length * 6 }; },
  set font(v){}, set textAlign(v){}, set fillStyle(v){}, set strokeStyle(v){}, set lineWidth(v){}, set globalAlpha(v){},
};

const elements = new Map();
function el(id) {
  if (!elements.has(id)) {
    const node = createElementStub(id === 'trendChart' ? 'canvas' : 'div');
    node.id = id;
    if (id === 'f-practiced-time') node.hidden = true;
    if (id === 'sync-status') node.querySelector = () => ({ textContent: '', remove(){} });
    elements.set(id, node);
  }
  return elements.get(id);
}

const storage = new Map();
const context = {
  console,
  setTimeout(fn){ if (typeof fn === 'function') fn(); return 1; },
  clearTimeout(){},
  setInterval(){ return 1; },
  Blob: class {},
  URL: Object.assign(URL, { createObjectURL(){ return 'blob:test'; }, revokeObjectURL(){} }),
  FileReader: class {},
  Date,
  Math,
  JSON,
  parseFloat,
  parseInt,
  String,
  Object,
  Array,
  Set,
  Map,
  Error,
  Promise,
  fetch: async () => ({ ok: true, json: async () => [], text: async () => '' }),
  Response,
  AbortController,
  navigator: { onLine: true },
  localStorage: {
    getItem(k){ return storage.has(k) ? storage.get(k) : null; },
    setItem(k, v){ storage.set(k, String(v)); },
    removeItem(k){ storage.delete(k); },
  },
  window: {
    innerWidth: 390,
    devicePixelRatio: 1,
    matchMedia(){ return { addEventListener(){} }; },
  },
  document: {
    documentElement: {},
    body: {},
    createElement: createElementStub,
    getElementById: el,
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
  },
  getComputedStyle(){ return { getPropertyValue(){ return '#000'; }, fontFamily: 'sans-serif' }; },
  confirm(){ return true; },
};
context.window.window = context.window;
context.window.document = context.document;
context.window.navigator = context.navigator;
context.window.localStorage = context.localStorage;
context.globalThis = context;

vm.createContext(context);
const appScript = scriptMatch[1].replace(/\ninit\(\);\s*$/, '\n');
vm.runInContext(appScript, context, { filename: 'index.html' });

function assert(name, condition, detail = '') {
  if (!condition) throw new Error(`${name} failed ${detail}`);
  console.log(`PASS ${name}`);
}

// Static identity checks
assert('submit no date overwrite', !scriptMatch[1].includes('findIndex(r => r.userId === currentUserId && r.date === date)'));
assert('cloud no date lookup', !scriptMatch[1].includes('record_date: `eq.${record.date}`'));
assert('sync no user-date dedupe', !scriptMatch[1].includes('const key = `${r.userId}_${r.date}`'));
assert('chart uses x key', scriptMatch[1].includes('getRecordXKey') && scriptMatch[1].includes('allXKeys'));
assert('uses collision-resistant local id', scriptMatch[1].includes('createRecordId()') && !scriptMatch[1].includes('id: Date.now()'));

// Function-level checks available through vm context
assert('record id is string and unique enough', String(context.createRecordId()).startsWith('local_') && context.createRecordId() !== context.createRecordId());
assert('record x key includes visible time', context.getRecordXKey({id:'a',date:'2026-07-03', time:'16:00'}).startsWith('2026-07-03 16:00#'));
assert('record x key distinguishes same minute entries', context.getRecordXKey({id:'a',date:'2026-07-03', time:'09:00'}) !== context.getRecordXKey({id:'b',date:'2026-07-03', time:'09:00'}));
assert('record x label hides identity suffix', context.getRecordXLabel('2026-07-03 09:00#abc') === '07-03\n09:00');
assert('display cloud user normalizes u_', context.resolveCloudUserName('u_abc') === 'abc');
assert('separate eye test defaults on', html.includes('<div class="chip selected" data-val="yes">分开测（左/右）</div>'));
assert('weather order is 晴多云阴雨', html.indexOf('data-val="晴"') < html.indexOf('data-val="多云"') && html.indexOf('data-val="多云"') < html.indexOf('data-val="阴"') && html.indexOf('data-val="阴"') < html.indexOf('data-val="雨"'));
assert('expanded light options present', ['自然光室内','自然光室外','窗边自然光','阳台自然光','室内灯光','台灯','弱光','夜间灯光','强光/刺眼'].every(v => html.includes(`data-val="${v}"`)));
assert('expanded practice options and time input present', ['早上练了','上午练了','下午练了','傍晚练了','晚上练了','其他时间','没练'].every(v => html.includes(`data-val="${v}"`)) && html.includes('id="f-practiced-time"') && html.includes('type="time"'));
assert('initial separate sections match default', html.includes('id="acuity-section" style="display:none"') && html.includes('id="acuity-left-section">') && html.includes('id="acuity-right-section">'));
assert('other practice time saved through helper', scriptMatch[1].includes('function getPracticedValue()') && scriptMatch[1].includes('practiced: getPracticedValue()'));
assert('separate submit requires both eyes', scriptMatch[1].includes('请选择左眼和右眼视力结果'));
assert('other practice time is required', scriptMatch[1].includes('请选择具体练眼时间'));
assert('submit reset clears practice time and selected practice chip', scriptMatch[1].includes("document.getElementById('f-practiced-time').value = ''") && scriptMatch[1].includes("document.querySelectorAll('#f-practiced .chip').forEach(c => c.classList.remove('selected'))"));

// Function-level form-state checks for the newly added helpers.
elements.clear();
const separateContainer = el('f-separate');
const sepNo = createElementStub('div');
sepNo.dataset.val = 'no';
const sepYes = createElementStub('div');
sepYes.dataset.val = 'yes';
sepYes.classList = { contains(cls){ return cls === 'selected'; }, add(){}, remove(){}, toggle(){} };
separateContainer.querySelectorAll = () => [sepNo, sepYes];
context.document.querySelector = (selector) => selector === '#f-separate .chip.selected' ? sepYes : null;
context.updateSeparateAcuitySections();
assert('default separate hides both-eye section', el('acuity-section').style.display === 'none');
assert('default separate shows left and right sections', el('acuity-left-section').style.display === 'block' && el('acuity-right-section').style.display === 'block');

const practicedOther = createElementStub('div');
practicedOther.dataset.val = '其他时间';
const practicedNight = createElementStub('div');
practicedNight.dataset.val = '晚上练了';
let selectedPractice = practicedOther;
context.document.querySelector = (selector) => {
  if (selector === '#f-practiced .chip.selected') return selectedPractice;
  if (selector === '#f-separate .chip.selected') return sepYes;
  return null;
};
el('f-practiced-time').value = '';
context.updatePracticedTimeVisibility();
assert('other practice time input shows', el('f-practiced-time').hidden === false);
assert('other practice without time stays explicit', context.getPracticedValue() === '其他时间');
el('f-practiced-time').value = '14:30';
assert('other practice value includes time', context.getPracticedValue() === '其他时间 14:30');
selectedPractice = practicedNight;
context.updatePracticedTimeVisibility();
assert('switching away from other practice hides and clears time', el('f-practiced-time').hidden === true && el('f-practiced-time').value === '');
assert('non-other practice value returns selected enum', context.getPracticedValue() === '晚上练了');

// Simulate syncFromCloud with same-day two rows through mocked fetch.
let fetchCalls = [];
context.fetch = async (url, options = {}) => {
  const u = String(url);
  const method = options.method || 'GET';
  fetchCalls.push({ url: u, method, body: options.body || '' });
  if (u.includes('/vision_users') && method === 'GET') {
    return { ok: true, json: async () => [{ id: 1, user_name: '怀木', user_color: '#5b9bf0', created_at: '2026-07-01T00:00:00Z' }] };
  }
  if (u.includes('/vision_records') && method === 'GET') {
    return { ok: true, json: async () => [
      { id: 101, user_name: '怀木', user_color: '#5b9bf0', record_date: '2026-07-03', record_time: '09:00', distance: '1.3', device: 'iPad mini 7', wearing_glasses: true, separate_eyes: false, score: '4.8' },
      { id: 102, user_name: '怀木', user_color: '#5b9bf0', record_date: '2026-07-03', record_time: '16:00', distance: '1.3', device: 'iPad mini 7', wearing_glasses: true, separate_eyes: false, score: '4.9' },
    ] };
  }
  return { ok: true, json: async () => [{ id: 999 }], text: async () => '' };
};
vm.runInContext('records = []; users = []; currentUserId = null;', context);
await context.syncFromCloud(false);
const syncedRecords = vm.runInContext('records.map(r => [r.cloudId, r.date, r.time, r.acuityBoth])', context);
assert('sync keeps same-day cloud rows', syncedRecords.length === 2, JSON.stringify(syncedRecords));

fetchCalls = [];
const newId = await context.pushRecordToCloud({ id: 1, userId: 'u_hm', userName: '怀木', userColor: '#5b9bf0', date: '2026-07-03', time: '20:00', distance: 1.3, device: 'iPad mini 7', glasses: '是', separate: false, acuityBoth: 5.0, reaction: [] });
assert('new cloud record posts', fetchCalls.some(c => c.url.includes('/vision_records') && c.method === 'POST'), JSON.stringify(fetchCalls));
assert('new cloud record does not date-query existing', !fetchCalls.some(c => c.url.includes('/vision_records') && c.method === 'GET' && c.url.includes('record_date')), JSON.stringify(fetchCalls));
assert('new cloud id returned', newId === 999, String(newId));

fetchCalls = [];
await context.pushRecordToCloud({ id: 2, cloudId: 555, userId: 'u_hm', userName: '怀木', userColor: '#5b9bf0', date: '2026-07-03', time: '21:00', distance: 1.3, device: 'iPad mini 7', glasses: '是', separate: false, acuityBoth: 5.1, reaction: [] });
assert('existing cloudId patches', fetchCalls.some(c => c.url.includes('/vision_records') && c.method === 'PATCH' && c.url.includes('id=eq.555')), JSON.stringify(fetchCalls));

console.log('ALL_DIAG_TESTS_PASSED');
