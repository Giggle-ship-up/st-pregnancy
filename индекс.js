// ============================================================
//  Pregnancy Tracker v2 — SillyTavern Extension
//  Трекер цикла, беременности, угроз и послеродового периода
//  Привязка к персонажу | Уведомления | История изменений
// ============================================================

import { getContext, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const EXT_NAME = 'pregnancy-tracker';
const EXT_DISPLAY = '🌸 Трекер беременности';

// ── Опасные симптомы (триггерят уведомление) ────────────────
const DANGER_THREATS = [
    'угроза выкидыша', 'кровотечение', 'критическое', 'преэклампсия',
    'отслойка плаценты', 'замершая беременность', 'выкидыш'
];

// ── Дефолтные данные одного персонажа ───────────────────────
function defaultCharData() {
    return {
        mode: 'cycle',          // 'cycle' | 'pregnancy' | 'postpartum'

        // ── Цикл ──
        cycleStartDate: null,   // ISO — начало текущего цикла
        cycleLength: 28,        // длина цикла в днях
        ovulationDay: 14,       // день овуляции от начала цикла
        conceptionAttempts: [], // [{ date, note }]
        cycleDaySymptoms: {},   // { "день_цикла": ["симптом1", ...] }

        // ── Беременность ──
        conceptionDate: null,
        isPostpartum: false,
        birthDate: null,

        // Состояние матери
        mood: 'нейтральное',
        wellbeing: 'хорошее',
        customMood: '',

        // Угрозы
        threats: [],            // [{ date, type, description, resolved, postpartum }]

        // История изменений состояния
        stateHistory: [],       // [{ date, field, oldVal, newVal }]

        // ── Ребёнок ──
        babyName: '',
        babyGender: 'неизвестен',
        babyHealth: 'хорошее',
        babyMood: 'спокойное',
        babyNotes: '',
    };
}

// ── Глобальные настройки ─────────────────────────────────────
const DEFAULT_GLOBAL = {
    injectIntoPrompt: true,
    characters: {},             // { charName: charData }
    activeChar: null,
};

// ── Геттеры ─────────────────────────────────────────────────

function getGlobal() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = Object.assign({}, DEFAULT_GLOBAL);
    }
    return extension_settings[EXT_NAME];
}

function getCurrentCharName() {
    try {
        const ctx = getContext();
        return ctx?.characters?.[ctx?.characterId]?.name || '__global__';
    } catch { return '__global__'; }
}

function getCharData(name) {
    const g = getGlobal();
    if (!name) name = getCurrentCharName();
    if (!g.characters[name]) g.characters[name] = defaultCharData();
    return g.characters[name];
}

// ── Математика ───────────────────────────────────────────────

function daysBetween(a, b) {
    return Math.floor((new Date(b) - new Date(a)) / 86400000);
}

function calcCycleData(cd) {
    if (!cd.cycleStartDate) return null;
    const today = new Date();
    const start = new Date(cd.cycleStartDate);
    const dayOfCycle = Math.floor((today - start) / 86400000) + 1;
    const ovDay = cd.ovulationDay || 14;
    const fertileStart = ovDay - 5;
    const fertileEnd = ovDay + 1;
    const isFertile = dayOfCycle >= fertileStart && dayOfCycle <= fertileEnd;
    const isOvulation = dayOfCycle === ovDay;
    const nextOvulation = new Date(start.getTime() + (ovDay - 1) * 86400000);
    const nextPeriod = new Date(start.getTime() + (cd.cycleLength - 1) * 86400000);
    const daysToOv = daysBetween(today, nextOvulation);
    const daysToPeriod = daysBetween(today, nextPeriod);
    return { dayOfCycle, ovDay, fertileStart, fertileEnd, isFertile, isOvulation, nextOvulation, nextPeriod, daysToOv, daysToPeriod };
}

function calcPregnancyData(cd) {
    if (!cd.conceptionDate) return null;
    const today = new Date();
    const days = daysBetween(cd.conceptionDate, today.toISOString());
    if (days < 0) return null;
    const weeks = Math.floor(days / 7);
    const daysR = days % 7;
    const trimester = weeks < 13 ? 1 : weeks < 27 ? 2 : 3;
    const due = new Date(new Date(cd.conceptionDate).getTime() + 266 * 86400000);
    const daysLeft = daysBetween(today.toISOString(), due.toISOString());
    const pct = Math.min(100, Math.round((weeks / 40) * 100));
    return { days, weeks, daysR, trimester, due, daysLeft, pct };
}

function calcBabyData(cd) {
    if (!cd.birthDate) return null;
    const days = daysBetween(cd.birthDate, new Date().toISOString());
    return { days, weeks: Math.floor(days / 7), months: Math.floor(days / 30.44) };
}

function trimLabel(t) {
    return ['', 'I триместр', 'II триместр', 'III триместр'][t] || '';
}

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('ru-RU');
}

// ── Уведомления ─────────────────────────────────────────────

let _badgeEl = null;

function showToast(msg, type = 'warn') {
    // Используем встроенный toastr СТ если доступен
    if (typeof toastr !== 'undefined') {
        if (type === 'danger') toastr.error(msg, '🌸 Трекер беременности');
        else if (type === 'warn') toastr.warning(msg, '🌸 Трекер беременности');
        else toastr.info(msg, '🌸 Трекер беременности');
        return;
    }
    // Фоллбэк
    const toast = document.createElement('div');
    toast.style.cssText = `
        position:fixed; bottom:24px; right:24px; z-index:99999;
        background:${type === 'danger' ? 'rgba(180,60,60,0.92)' : 'rgba(160,100,110,0.92)'};
        color:#fff; padding:10px 16px; border-radius:10px;
        font-family:Georgia,serif; font-size:13px;
        box-shadow:0 4px 20px rgba(0,0,0,0.4);
        max-width:280px; line-height:1.4;
        animation: ptFadeIn 0.3s ease;
    `;
    toast.innerHTML = `<b>🌸 Трекер</b><br>${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
}

function updateBadge() {
    if (!_badgeEl) return;
    const cd = getCharData();
    const activeThreats = (cd.threats || []).filter(t => !t.resolved && DANGER_THREATS.includes(t.type));
    if (activeThreats.length > 0) {
        _badgeEl.style.display = 'flex';
        _badgeEl.textContent = activeThreats.length;
    } else {
        _badgeEl.style.display = 'none';
    }
}

function checkDangerAndNotify(type) {
    if (DANGER_THREATS.includes(type)) {
        showToast(`⚠️ Опасный симптом: ${type}`, 'danger');
        updateBadge();
    }
}

function checkFertileWindow() {
    const cd = getCharData();
    if (cd.mode !== 'cycle') return;
    const cyc = calcCycleData(cd);
    if (!cyc) return;
    if (cyc.isOvulation) showToast('🌕 Сегодня день овуляции!', 'info');
    else if (cyc.isFertile && cyc.daysToOv === 0) showToast('🌸 Начинается фертильное окно', 'info');
}

// ── История изменений ────────────────────────────────────────

function logChange(cd, field, oldVal, newVal) {
    if (oldVal === newVal) return;
    if (!cd.stateHistory) cd.stateHistory = [];
    cd.stateHistory.unshift({ date: new Date().toISOString(), field, oldVal, newVal });
    if (cd.stateHistory.length > 50) cd.stateHistory = cd.stateHistory.slice(0, 50);
}

// ── Промпт-инъекция ─────────────────────────────────────────

function buildPromptInjection() {
    const g = getGlobal();
    if (!g.injectIntoPrompt) return '';
    const cd = getCharData();
    const lines = ['[Трекер беременности — состояние персонажа]'];

    if (cd.mode === 'cycle') {
        const cyc = calcCycleData(cd);
        if (cyc) {
            lines.push(`Режим: отслеживание цикла`);
            lines.push(`День цикла: ${cyc.dayOfCycle} из ${cd.cycleLength}`);
            lines.push(`Фертильное окно: дни ${cyc.fertileStart}–${cyc.fertileEnd}`);
            if (cyc.isFertile) lines.push(`⚠️ Сейчас фертильный период!`);
            if (cyc.isOvulation) lines.push(`🌕 Сегодня день овуляции`);
            lines.push(`До овуляции: ${cyc.daysToOv > 0 ? cyc.daysToOv + ' дн.' : 'уже прошла'}`);
            const attempts = (cd.conceptionAttempts || []);
            if (attempts.length) lines.push(`Попыток зачатия: ${attempts.length}`);
        }
    } else if (cd.mode === 'pregnancy') {
        const pd = calcPregnancyData(cd);
        if (pd) {
            lines.push(`Беременность: ${pd.weeks} нед. ${pd.daysR} дн. (${trimLabel(pd.trimester)})`);
            lines.push(`ПДР: ${fmtDate(pd.due.toISOString())}, осталось ${pd.daysLeft} дн.`);
        }
    } else if (cd.mode === 'postpartum') {
        const bd = calcBabyData(cd);
        if (bd) {
            const name = cd.babyName || 'ребёнок';
            lines.push(`Послеродовой период. ${name}: ${bd.months} мес. (${bd.days} дн.)`);
            lines.push(`Состояние ${name}: ${cd.babyHealth}, настроение: ${cd.babyMood}`);
        }
    }

    const mood = cd.customMood || cd.mood;
    lines.push(`Настроение: ${mood}, самочувствие: ${cd.wellbeing}`);

    const activeThreats = (cd.threats || []).filter(t => !t.resolved);
    if (activeThreats.length) {
        lines.push('Активные угрозы/симптомы:');
        activeThreats.forEach(t => lines.push(`  - [${t.type}] ${t.description} (с ${fmtDate(t.date)})`));
    }

    lines.push('[конец блока трекера]');
    return lines.join('\n');
}

// ── CSS ─────────────────────────────────────────────────────

const STYLES = `
@keyframes ptFadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
@keyframes ptPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }

#pt-panel {
    font-family: 'Georgia', serif;
    padding: 12px;
    color: #4a3f3f;
    font-size: 13px;
    line-height: 1.6;
    max-height: 82vh;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #d4a0a0 transparent;
}
#pt-panel::-webkit-scrollbar { width: 3px; }
#pt-panel::-webkit-scrollbar-thumb { background: rgba(200,140,160,0.3); border-radius:10px; }

.pt-char-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    padding: 7px 10px;
    background: rgba(255,220,230,0.12);
    border: 1px solid rgba(210,150,170,0.2);
    border-radius: 10px;
    font-size: 11px;
    color: rgba(200,160,175,0.8);
}
.pt-char-name { font-weight: 600; color: #d4a0b0; flex:1; }
.pt-char-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #c98fa0;
    animation: ptPulse 2s infinite;
}

.pt-card {
    background: rgba(255,230,235,0.07);
    border: 1px solid rgba(210,150,170,0.18);
    border-radius: 12px;
    padding: 11px 13px;
    margin-bottom: 9px;
}
.pt-card-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(210,150,170,0.55);
    margin-bottom: 8px;
}

.pt-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 10px;
}
.pt-tab {
    flex: 1;
    padding: 6px 4px;
    border-radius: 10px;
    border: 1px solid rgba(210,150,170,0.2);
    background: rgba(200,130,150,0.08);
    color: rgba(200,160,175,0.55);
    font-size: 10px;
    font-family: inherit;
    cursor: pointer;
    text-align: center;
    transition: all 0.2s;
}
.pt-tab.active {
    background: rgba(200,130,150,0.25);
    border-color: rgba(210,150,170,0.4);
    color: #e0b0c0;
}

.pt-stat {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
    border-bottom: 1px solid rgba(200,150,170,0.08);
    font-size: 12px;
}
.pt-stat:last-child { border-bottom: none; }
.pt-stat-label { color: rgba(200,160,175,0.55); }
.pt-stat-value { color: #d4b0bc; font-weight: 500; }

.pt-badge {
    display: inline-block;
    padding: 2px 9px;
    border-radius: 20px;
    font-size: 10px;
    font-weight: 600;
    background: rgba(200,150,170,0.18);
    color: #d4a0b8;
    border: 1px solid rgba(200,140,165,0.25);
}
.pt-badge.t1 { background:rgba(180,220,200,0.15); color:#90c0a0; border-color:rgba(160,200,180,0.2); }
.pt-badge.t2 { background:rgba(220,200,150,0.15); color:#c8b070; border-color:rgba(200,180,130,0.2); }
.pt-badge.t3 { background:rgba(220,160,180,0.18); color:#d4a0b0; border-color:rgba(200,140,165,0.25); }
.pt-badge.fertile { background:rgba(160,220,180,0.2); color:#80c090; border-color:rgba(140,200,160,0.3); animation:ptPulse 1.5s infinite; }
.pt-badge.ovulation { background:rgba(220,190,100,0.2); color:#c8a840; border-color:rgba(200,170,80,0.3); animation:ptPulse 1s infinite; }
.pt-badge.danger { background:rgba(220,100,100,0.18); color:#e09090; border-color:rgba(200,80,80,0.25); }

.pt-progress-wrap { margin: 8px 0 2px; }
.pt-progress-labels { display:flex; justify-content:space-between; font-size:10px; color:rgba(200,155,170,0.45); margin-bottom:5px; }
.pt-progress-bar { height:5px; background:rgba(200,140,160,0.12); border-radius:10px; overflow:hidden; }
.pt-progress-fill { height:100%; border-radius:10px; background:linear-gradient(90deg,#c98fa0,#e8a0b8); transition:width 0.5s ease; }

.pt-input, .pt-select, .pt-textarea {
    width: 100%;
    background: rgba(255,225,230,0.07);
    border: 1px solid rgba(210,150,170,0.2);
    border-radius: 8px;
    padding: 5px 9px;
    color: rgba(220,180,195,0.85);
    font-size: 11px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
    margin-top: 3px;
    transition: border-color 0.2s;
}
.pt-input:focus, .pt-select:focus, .pt-textarea:focus {
    border-color: rgba(200,130,150,0.45);
}
.pt-textarea { resize:vertical; min-height:48px; }

.pt-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 5px 0;
}
.pt-row label { font-size:11px; color:rgba(200,155,170,0.5); min-width:80px; flex-shrink:0; }

.pt-btn {
    display: inline-block;
    padding: 5px 12px;
    border-radius: 20px;
    border: 1px solid rgba(210,140,160,0.3);
    background: rgba(200,120,145,0.12);
    color: rgba(220,160,180,0.8);
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s;
}
.pt-btn:hover { background:rgba(200,120,145,0.22); }
.pt-btn.small { padding:3px 8px; font-size:10px; }
.pt-btn.success { border-color:rgba(130,200,140,0.3); background:rgba(130,200,140,0.1); color:rgba(130,200,140,0.8); }
.pt-btn.danger { border-color:rgba(200,100,100,0.3); background:rgba(200,100,100,0.1); color:rgba(220,130,130,0.8); }

.pt-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: rgba(210,170,185,0.7);
    cursor: pointer;
    margin-bottom: 5px;
}
.pt-toggle:last-child { margin-bottom:0; }
.pt-toggle input[type=checkbox] { accent-color:#c98fa0; width:14px; height:14px; cursor:pointer; }

.pt-threat-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 9px;
    background: rgba(255,160,160,0.05);
    border-radius: 8px;
    margin: 4px 0;
    border-left: 2px solid rgba(220,120,120,0.35);
    font-size: 11px;
}
.pt-threat-item.resolved { opacity:0.4; border-left-color:rgba(120,200,130,0.4); }
.pt-threat-item.danger-item { border-left-color:rgba(220,80,80,0.6); background:rgba(220,80,80,0.06); }
.pt-threat-desc { flex:1; }
.pt-threat-type { color:rgba(220,160,170,0.9); font-weight:600; }
.pt-threat-note { color:rgba(200,160,170,0.55); font-size:10px; }
.pt-threat-date { color:rgba(180,140,150,0.4); font-size:10px; margin-top:1px; }
.pt-threat-btns { display:flex; gap:3px; flex-shrink:0; }

.pt-attempt-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
    background: rgba(200,180,220,0.07);
    border-radius: 6px;
    margin: 3px 0;
    font-size: 11px;
    color: rgba(200,170,210,0.7);
}

.pt-cycle-day {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 8px;
    font-size: 11px;
    color: rgba(200,165,180,0.75);
    background: rgba(200,150,170,0.06);
    margin-bottom: 4px;
}
.pt-cycle-day-num { font-weight:700; color:#d4a0b8; min-width:24px; }

.pt-history-item {
    padding: 4px 0;
    border-bottom: 1px solid rgba(200,140,160,0.08);
    font-size: 10px;
    color: rgba(200,155,170,0.5);
}
.pt-history-item:last-child { border-bottom:none; }

.pt-divider { border:none; border-top:1px solid rgba(210,150,170,0.1); margin:8px 0; }
.pt-empty { font-size:11px; color:rgba(190,150,165,0.4); font-style:italic; padding:4px 0; }
.pt-section { display:none; }
.pt-section.active { display:block; }

.pt-footer { font-size:10px; color:rgba(180,130,150,0.3); text-align:center; margin-top:4px; padding-bottom:2px; }

/* Бейдж опасности на иконке */
#pt-danger-badge {
    position: absolute;
    top: -4px; right: -4px;
    width: 16px; height: 16px;
    background: #c03040;
    border-radius: 50%;
    font-size: 9px;
    color: white;
    display: none;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    z-index: 10;
    animation: ptPulse 1.2s infinite;
}
`;

// ── HTML ─────────────────────────────────────────────────────

function buildHTML() {
    return `<div id="pt-panel">

    <!-- Текущий персонаж -->
    <div class="pt-char-bar">
        <div class="pt-char-dot"></div>
        <span class="pt-char-name" id="pt-char-name">—</span>
        <span style="opacity:0.4;font-size:10px;">персонаж</span>
    </div>

    <!-- Глобальные опции -->
    <div class="pt-card">
        <label class="pt-toggle">
            <input type="checkbox" id="pt-inject">
            <span>Инъекция в промпт</span>
        </label>
    </div>

    <!-- Режимы -->
    <div class="pt-tabs">
        <button class="pt-tab" id="pt-tab-cycle" data-tab="cycle">🌙 Цикл</button>
        <button class="pt-tab" id="pt-tab-pregnancy" data-tab="pregnancy">🤰 Беременность</button>
        <button class="pt-tab" id="pt-tab-postpartum" data-tab="postpartum">👶 После родов</button>
    </div>

    <!-- ═══ ЦИКЛ ═══ -->
    <div class="pt-section" id="pt-section-cycle">

        <div class="pt-card">
            <div class="pt-card-title">Текущий цикл</div>
            <div class="pt-row">
                <label>Начало цикла</label>
                <input type="date" id="pt-cycle-start" class="pt-input">
            </div>
            <div class="pt-row">
                <label>Длина цикла</label>
                <input type="number" id="pt-cycle-length" class="pt-input" min="21" max="45" value="28" style="width:70px;">
                <span style="font-size:11px;color:rgba(200,155,170,0.5);">дней</span>
            </div>
            <div class="pt-row">
                <label>День овуляции</label>
                <input type="number" id="pt-ovulation-day" class="pt-input" min="1" max="40" value="14" style="width:70px;">
                <span style="font-size:11px;color:rgba(200,155,170,0.5);">от начала</span>
            </div>
            <hr class="pt-divider">
            <div id="pt-cycle-stats"></div>
        </div>

        <!-- Попытки зачатия -->
        <div class="pt-card">
            <div class="pt-card-title">Попытки зачатия</div>
            <div id="pt-attempts-list"></div>
            <hr class="pt-divider">
            <div class="pt-row">
                <label>Дата</label>
                <input type="date" id="pt-attempt-date" class="pt-input">
            </div>
            <div class="pt-row">
                <label>Заметка</label>
                <input type="text" id="pt-attempt-note" class="pt-input" placeholder="необязательно">
            </div>
            <button class="pt-btn" id="pt-add-attempt" style="margin-top:6px;">+ Добавить</button>
        </div>

        <!-- Симптомы по дням -->
        <div class="pt-card">
            <div class="pt-card-title">Симптомы по дням цикла</div>
            <div class="pt-row">
                <label>День цикла</label>
                <input type="number" id="pt-sym-day" class="pt-input" min="1" max="45" placeholder="1–45" style="width:70px;">
            </div>
            <div class="pt-row">
                <label>Симптом</label>
                <input type="text" id="pt-sym-text" class="pt-input" placeholder="описание...">
            </div>
            <button class="pt-btn" id="pt-add-sym" style="margin-top:6px;">+ Добавить</button>
            <div id="pt-sym-list" style="margin-top:8px;"></div>
        </div>

    </div>

    <!-- ═══ БЕРЕМЕННОСТЬ ═══ -->
    <div class="pt-section" id="pt-section-pregnancy">

        <div class="pt-card">
            <div class="pt-card-title">Беременность</div>
            <div class="pt-row">
                <label>Дата зачатия</label>
                <input type="date" id="pt-conception" class="pt-input">
            </div>
            <hr class="pt-divider">
            <div id="pt-pregnancy-stats"></div>
        </div>

        <div class="pt-card">
            <div class="pt-card-title">Состояние персонажа</div>
            <div class="pt-row">
                <label>Настроение</label>
                <select id="pt-mood" class="pt-select">
                    <option>нейтральное</option><option>радостное</option>
                    <option>тревожное</option><option>подавленное</option>
                    <option>раздражённое</option><option>умиротворённое</option>
                    <option>другое</option>
                </select>
            </div>
            <div class="pt-row" id="pt-custom-mood-row" style="display:none;">
                <label>Уточнить</label>
                <input type="text" id="pt-custom-mood" class="pt-input" placeholder="своё настроение">
            </div>
            <div class="pt-row">
                <label>Самочувствие</label>
                <select id="pt-wellbeing" class="pt-select">
                    <option>хорошее</option><option>удовлетворительное</option>
                    <option>плохое</option><option>токсикоз</option>
                    <option>постельный режим</option><option>критическое</option>
                </select>
            </div>
        </div>

        <div class="pt-card">
            <div class="pt-card-title">Угрозы и симптомы</div>
            <div id="pt-threats-list"></div>
            <hr class="pt-divider">
            <div class="pt-card-title">Добавить</div>
            <div class="pt-row">
                <label>Тип</label>
                <select id="pt-threat-type" class="pt-select">
                    <option>угроза выкидыша</option><option>токсикоз</option>
                    <option>кровотечение</option><option>высокое давление</option>
                    <option>преэклампсия</option><option>боли</option>
                    <option>инфекция</option><option>слабость</option>
                    <option>стресс</option><option>замершая беременность</option>
                    <option>другое</option>
                </select>
            </div>
            <div class="pt-row">
                <label>Описание</label>
                <input type="text" id="pt-threat-desc" class="pt-input" placeholder="подробности...">
            </div>
            <button class="pt-btn" id="pt-add-threat" style="margin-top:6px;">+ Добавить</button>
        </div>

    </div>

    <!-- ═══ ПОСЛЕ РОДОВ ═══ -->
    <div class="pt-section" id="pt-section-postpartum">

        <div class="pt-card">
            <div class="pt-card-title">Ребёнок</div>
            <div class="pt-row"><label>Дата рождения</label><input type="date" id="pt-birth-date" class="pt-input"></div>
            <div class="pt-row"><label>Имя</label><input type="text" id="pt-baby-name" class="pt-input" placeholder="имя ребёнка"></div>
            <div class="pt-row">
                <label>Пол</label>
                <select id="pt-baby-gender" class="pt-select">
                    <option>неизвестен</option><option>мальчик</option><option>девочка</option>
                </select>
            </div>
            <hr class="pt-divider">
            <div id="pt-baby-stats"></div>
            <hr class="pt-divider">
            <div class="pt-row">
                <label>Здоровье</label>
                <select id="pt-baby-health" class="pt-select">
                    <option>хорошее</option><option>колики</option><option>болеет</option><option>критическое</option>
                </select>
            </div>
            <div class="pt-row">
                <label>Настроение</label>
                <select id="pt-baby-mood" class="pt-select">
                    <option>спокойное</option><option>плачет</option><option>игривое</option><option>сонное</option>
                </select>
            </div>
            <div style="margin-top:6px;">
                <div class="pt-card-title">Заметки</div>
                <textarea id="pt-baby-notes" class="pt-textarea" placeholder="заметки о ребёнке..."></textarea>
            </div>
        </div>

        <div class="pt-card">
            <div class="pt-card-title">Состояние матери</div>
            <div class="pt-row">
                <label>Настроение</label>
                <select id="pt-mood-post" class="pt-select">
                    <option>нейтральное</option><option>радостное</option><option>тревожное</option>
                    <option>послеродовая депрессия</option><option>подавленное</option><option>умиротворённое</option>
                </select>
            </div>
            <div class="pt-row">
                <label>Самочувствие</label>
                <select id="pt-wellbeing-post" class="pt-select">
                    <option>хорошее</option><option>восстанавливается</option><option>плохое</option><option>осложнения</option>
                </select>
            </div>
        </div>

        <div class="pt-card">
            <div class="pt-card-title">Угрозы (послеродовые)</div>
            <div id="pt-threats-list-post"></div>
            <hr class="pt-divider">
            <div class="pt-row">
                <label>Тип</label>
                <select id="pt-threat-type-post" class="pt-select">
                    <option>кровотечение</option><option>инфекция</option><option>лихорадка</option>
                    <option>мастит</option><option>депрессия</option><option>слабость</option><option>другое</option>
                </select>
            </div>
            <div class="pt-row">
                <label>Описание</label>
                <input type="text" id="pt-threat-desc-post" class="pt-input" placeholder="подробности...">
            </div>
            <button class="pt-btn" id="pt-add-threat-post" style="margin-top:6px;">+ Добавить</button>
        </div>

    </div>

    <!-- История изменений -->
    <div class="pt-card" id="pt-history-card">
        <div class="pt-card-title" style="cursor:pointer;" id="pt-history-toggle">▸ История изменений</div>
        <div id="pt-history-body" style="display:none;"></div>
    </div>

    <div class="pt-footer">данные привязаны к персонажу · v2</div>
</div>`;
}

// ── Рендер ───────────────────────────────────────────────────

function renderCycleStats() {
    const cd = getCharData();
    const el = document.getElementById('pt-cycle-stats');
    if (!el) return;
    const cyc = calcCycleData(cd);
    if (!cyc) { el.innerHTML = '<div class="pt-empty">Укажите начало цикла</div>'; return; }

    let fertileHtml = '';
    if (cyc.isOvulation) fertileHtml = '<span class="pt-badge ovulation">🌕 овуляция сегодня</span>';
    else if (cyc.isFertile) fertileHtml = '<span class="pt-badge fertile">🌿 фертильное окно</span>';

    el.innerHTML = `
        <div class="pt-stat"><span class="pt-stat-label">День цикла</span><span class="pt-stat-value">${cyc.dayOfCycle} / ${cd.cycleLength}</span></div>
        <div class="pt-stat"><span class="pt-stat-label">Фертильное окно</span><span class="pt-stat-value">дни ${cyc.fertileStart}–${cyc.fertileEnd}</span></div>
        <div class="pt-stat"><span class="pt-stat-label">До овуляции</span><span class="pt-stat-value">${cyc.daysToOv > 0 ? cyc.daysToOv + ' дн.' : cyc.isOvulation ? 'сегодня!' : 'прошла'}</span></div>
        <div class="pt-stat"><span class="pt-stat-label">Следующие месячные</span><span class="pt-stat-value">${fmtDate(cyc.nextPeriod.toISOString())} (${Math.max(0,cyc.daysToPeriod)} дн.)</span></div>
        ${fertileHtml ? `<div style="margin-top:6px;">${fertileHtml}</div>` : ''}
    `;
}

function renderAttempts() {
    const cd = getCharData();
    const el = document.getElementById('pt-attempts-list');
    if (!el) return;
    const arr = cd.conceptionAttempts || [];
    if (!arr.length) { el.innerHTML = '<div class="pt-empty">Нет записей</div>'; return; }
    el.innerHTML = arr.map((a, i) => `
        <div class="pt-attempt-item">
            <span>${fmtDate(a.date)}${a.note ? ' — ' + a.note : ''}</span>
            <button class="pt-btn small danger" data-attempt="${i}">✕</button>
        </div>`).join('');
    el.querySelectorAll('[data-attempt]').forEach(btn => {
        btn.addEventListener('click', () => {
            cd.conceptionAttempts.splice(parseInt(btn.dataset.attempt), 1);
            saveSettingsDebounced(); renderAttempts();
        });
    });
}

function renderSymptoms() {
    const cd = getCharData();
    const el = document.getElementById('pt-sym-list');
    if (!el) return;
    const sym = cd.cycleDaySymptoms || {};
    const days = Object.keys(sym).sort((a,b) => +a - +b);
    if (!days.length) { el.innerHTML = '<div class="pt-empty">Нет симптомов</div>'; return; }
    el.innerHTML = days.map(day => `
        <div class="pt-cycle-day">
            <span class="pt-cycle-day-num">${day}</span>
            <span>${sym[day].join(', ')}</span>
        </div>`).join('');
}

function renderPregnancyStats() {
    const cd = getCharData();
    const el = document.getElementById('pt-pregnancy-stats');
    if (!el) return;
    if (!cd.conceptionDate) { el.innerHTML = '<div class="pt-empty">Укажите дату зачатия</div>'; return; }
    const pd = calcPregnancyData(cd);
    if (!pd) { el.innerHTML = '<div class="pt-empty">Дата зачатия в будущем?</div>'; return; }
    el.innerHTML = `
        <div class="pt-stat"><span class="pt-stat-label">Срок</span><span class="pt-stat-value">${pd.weeks} нед. ${pd.daysR} дн.</span></div>
        <div class="pt-stat"><span class="pt-stat-label">Триместр</span><span class="pt-badge t${pd.trimester}">${trimLabel(pd.trimester)}</span></div>
        <div class="pt-stat"><span class="pt-stat-label">ПДР</span><span class="pt-stat-value">${fmtDate(pd.due.toISOString())}</span></div>
        <div class="pt-stat"><span class="pt-stat-label">Осталось</span><span class="pt-stat-value">${pd.daysLeft > 0 ? pd.daysLeft + ' дн.' : 'срок вышел'}</span></div>
        <div class="pt-progress-wrap">
            <div class="pt-progress-labels"><span>Прогресс</span><span>${pd.pct}%</span></div>
            <div class="pt-progress-bar"><div class="pt-progress-fill" style="width:${pd.pct}%"></div></div>
        </div>`;
}

function renderBabyStats() {
    const cd = getCharData();
    const el = document.getElementById('pt-baby-stats');
    if (!el) return;
    if (!cd.birthDate) { el.innerHTML = '<div class="pt-empty">Укажите дату рождения</div>'; return; }
    const bd = calcBabyData(cd);
    if (!bd) return;
    el.innerHTML = `
        <div class="pt-stat"><span class="pt-stat-label">Возраст</span><span class="pt-stat-value">${bd.months} мес. / ${bd.weeks} нед.</span></div>
        <div class="pt-stat"><span class="pt-stat-label">Дней от рождения</span><span class="pt-stat-value">${bd.days}</span></div>`;
}

function renderThreats(isPost = false) {
    const cd = getCharData();
    const id = isPost ? 'pt-threats-list-post' : 'pt-threats-list';
    const el = document.getElementById(id);
    if (!el) return;
    const list = (cd.threats || []).filter(t => !!t.postpartum === isPost);
    if (!list.length) { el.innerHTML = '<div class="pt-empty">Нет записей</div>'; return; }
    el.innerHTML = list.map(t => {
        const ri = cd.threats.indexOf(t);
        const isDanger = DANGER_THREATS.includes(t.type);
        return `<div class="pt-threat-item ${t.resolved ? 'resolved' : ''} ${isDanger && !t.resolved ? 'danger-item' : ''}">
            <div class="pt-threat-desc">
                <div class="pt-threat-type">${isDanger && !t.resolved ? '⚠️ ' : ''}${t.type}</div>
                ${t.description ? `<div class="pt-threat-note">${t.description}</div>` : ''}
                <div class="pt-threat-date">с ${fmtDate(t.date)}</div>
            </div>
            <div class="pt-threat-btns">
                ${!t.resolved ? `<button class="pt-btn small success" data-ri="${ri}" data-action="resolve">✓</button>` : ''}
                <button class="pt-btn small danger" data-ri="${ri}" data-action="del">✕</button>
            </div>
        </div>`;
    }).join('');
    el.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
            const ri = parseInt(btn.dataset.ri);
            if (btn.dataset.action === 'resolve') cd.threats[ri].resolved = true;
            if (btn.dataset.action === 'del') cd.threats.splice(ri, 1);
            saveSettingsDebounced();
            renderThreats(false); renderThreats(true); updateBadge();
        });
    });
}

function renderHistory() {
    const cd = getCharData();
    const el = document.getElementById('pt-history-body');
    if (!el) return;
    const hist = cd.stateHistory || [];
    if (!hist.length) { el.innerHTML = '<div class="pt-empty">История пуста</div>'; return; }
    el.innerHTML = hist.slice(0, 15).map(h => `
        <div class="pt-history-item">${fmtDate(h.date)} · ${h.field}: ${h.oldVal} → ${h.newVal}</div>`).join('');
}

function renderAll() {
    const cd = getCharData();
    const charName = getCurrentCharName();
    const nameEl = document.getElementById('pt-char-name');
    if (nameEl) nameEl.textContent = charName;

    // Tabs
    ['cycle','pregnancy','postpartum'].forEach(tab => {
        document.getElementById(`pt-tab-${tab}`)?.classList.toggle('active', cd.mode === tab);
        document.getElementById(`pt-section-${tab}`)?.classList.toggle('active', cd.mode === tab);
    });

    // Inject toggle
    const inj = document.getElementById('pt-inject');
    if (inj) inj.checked = getGlobal().injectIntoPrompt;

    // Fields
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v ?? ''; };
    set('pt-cycle-start', cd.cycleStartDate?.split('T')[0] || '');
    set('pt-cycle-length', cd.cycleLength || 28);
    set('pt-ovulation-day', cd.ovulationDay || 14);
    set('pt-conception', cd.conceptionDate?.split('T')[0] || '');
    set('pt-mood', cd.mood || 'нейтральное');
    set('pt-wellbeing', cd.wellbeing || 'хорошее');
    set('pt-custom-mood', cd.customMood || '');
    set('pt-birth-date', cd.birthDate?.split('T')[0] || '');
    set('pt-baby-name', cd.babyName || '');
    set('pt-baby-gender', cd.babyGender || 'неизвестен');
    set('pt-baby-health', cd.babyHealth || 'хорошее');
    set('pt-baby-mood', cd.babyMood || 'спокойное');
    set('pt-baby-notes', cd.babyNotes || '');
    set('pt-mood-post', cd.mood || 'нейтральное');
    set('pt-wellbeing-post', cd.wellbeing || 'хорошее');

    const cmr = document.getElementById('pt-custom-mood-row');
    if (cmr) cmr.style.display = cd.mood === 'другое' ? 'flex' : 'none';

    renderCycleStats();
    renderAttempts();
    renderSymptoms();
    renderPregnancyStats();
    renderBabyStats();
    renderThreats(false);
    renderThreats(true);
    updateBadge();
}

// ── Биндинг событий ─────────────────────────────────────────

function bindEvents() {
    // Инъекция
    document.getElementById('pt-inject')?.addEventListener('change', e => {
        getGlobal().injectIntoPrompt = e.target.checked;
        saveSettingsDebounced();
    });

    // Табы
    document.querySelectorAll('.pt-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            const cd = getCharData();
            cd.mode = btn.dataset.tab;
            saveSettingsDebounced();
            renderAll();
            checkFertileWindow();
        });
    });

    // Цикл
    const bindCycle = (id, key, parse) => {
        document.getElementById(id)?.addEventListener('change', e => {
            const cd = getCharData();
            const val = parse ? parse(e.target.value) : e.target.value;
            cd[key] = val;
            saveSettingsDebounced();
            renderCycleStats();
        });
    };
    bindCycle('pt-cycle-start', 'cycleStartDate', v => v ? new Date(v).toISOString() : null);
    bindCycle('pt-cycle-length', 'cycleLength', v => parseInt(v));
    bindCycle('pt-ovulation-day', 'ovulationDay', v => parseInt(v));

    // Попытки зачатия
    document.getElementById('pt-add-attempt')?.addEventListener('click', () => {
        const cd = getCharData();
        const date = document.getElementById('pt-attempt-date').value;
        const note = document.getElementById('pt-attempt-note').value;
        if (!date) return;
        if (!cd.conceptionAttempts) cd.conceptionAttempts = [];
        cd.conceptionAttempts.push({ date: new Date(date).toISOString(), note });
        document.getElementById('pt-attempt-note').value = '';
        saveSettingsDebounced();
        renderAttempts();
    });

    // Симптомы по дням
    document.getElementById('pt-add-sym')?.addEventListener('click', () => {
        const cd = getCharData();
        const day = document.getElementById('pt-sym-day').value;
        const sym = document.getElementById('pt-sym-text').value.trim();
        if (!day || !sym) return;
        if (!cd.cycleDaySymptoms) cd.cycleDaySymptoms = {};
        if (!cd.cycleDaySymptoms[day]) cd.cycleDaySymptoms[day] = [];
        cd.cycleDaySymptoms[day].push(sym);
        document.getElementById('pt-sym-text').value = '';
        saveSettingsDebounced();
        renderSymptoms();
    });

    // Беременность
    document.getElementById('pt-conception')?.addEventListener('change', e => {
        const cd = getCharData();
        cd.conceptionDate = e.target.value ? new Date(e.target.value).toISOString() : null;
        saveSettingsDebounced(); renderPregnancyStats();
    });

    // Настроение / самочувствие
    const bindField = (id, key) => {
        document.getElementById(id)?.addEventListener('change', e => {
            const cd = getCharData();
            logChange(cd, key, cd[key], e.target.value);
            cd[key] = e.target.value;
            if (id === 'pt-mood' || id === 'pt-mood-post') {
                const cmr = document.getElementById('pt-custom-mood-row');
                if (cmr) cmr.style.display = e.target.value === 'другое' ? 'flex' : 'none';
            }
            saveSettingsDebounced();
        });
    };
    bindField('pt-mood', 'mood');
    bindField('pt-wellbeing', 'wellbeing');
    bindField('pt-mood-post', 'mood');
    bindField('pt-wellbeing-post', 'wellbeing');
    bindField('pt-baby-health', 'babyHealth');
    bindField('pt-baby-mood', 'babyMood');
    bindField('pt-baby-gender', 'babyGender');

    document.getElementById('pt-custom-mood')?.addEventListener('input', e => {
        getCharData().customMood = e.target.value; saveSettingsDebounced();
    });
    document.getElementById('pt-birth-date')?.addEventListener('change', e => {
        const cd = getCharData();
        cd.birthDate = e.target.value ? new Date(e.target.value).toISOString() : null;
        saveSettingsDebounced(); renderBabyStats();
    });
    document.getElementById('pt-baby-name')?.addEventListener('input', e => {
        getCharData().babyName = e.target.value; saveSettingsDebounced();
    });
    document.getElementById('pt-baby-notes')?.addEventListener('input', e => {
        getCharData().babyNotes = e.target.value; saveSettingsDebounced();
    });

    // Угрозы
    const addThreat = (typeId, descId, isPost) => {
        const btnId = isPost ? 'pt-add-threat-post' : 'pt-add-threat';
        document.getElementById(btnId)?.addEventListener('click', () => {
            const cd = getCharData();
            const type = document.getElementById(typeId).value;
            const desc = document.getElementById(descId).value;
            if (!cd.threats) cd.threats = [];
            cd.threats.push({ date: new Date().toISOString(), type, description: desc, resolved: false, postpartum: isPost });
            document.getElementById(descId).value = '';
            checkDangerAndNotify(type);
            saveSettingsDebounced();
            renderThreats(false); renderThreats(true);
        });
    };
    addThreat('pt-threat-type', 'pt-threat-desc', false);
    addThreat('pt-threat-type-post', 'pt-threat-desc-post', true);

    // История
    document.getElementById('pt-history-toggle')?.addEventListener('click', () => {
        const body = document.getElementById('pt-history-body');
        if (!body) return;
        const open = body.style.display === 'block';
        body.style.display = open ? 'none' : 'block';
        document.getElementById('pt-history-toggle').textContent = (open ? '▸' : '▾') + ' История изменений';
        if (!open) renderHistory();
    });
}

// ── Инициализация ────────────────────────────────────────────

jQuery(async () => {
    $('head').append(`<style>${STYLES}</style>`);

    // Панель
    const $wrap = $('<div id="pregnancy-tracker-content" class="extension_container"></div>');
    $wrap.html(buildHTML());

    if (typeof addExtensionPanel === 'function') {
        addExtensionPanel(EXT_NAME, EXT_DISPLAY, 'pt-panel');
    } else {
        const $block = $(`
            <div class="extension_block">
                <div class="extension_header" style="position:relative;">
                    <b>🌸 Трекер беременности</b>
                    <div id="pt-danger-badge">0</div>
                </div>
            </div>`);
        $block.append($wrap);
        $('#extensions_settings').append($block);
        _badgeEl = document.getElementById('pt-danger-badge');
    }

    renderAll();
    bindEvents();
    checkFertileWindow();

    // Следим за сменой персонажа
    document.addEventListener('characterSelected', () => {
        renderAll();
        checkFertileWindow();
    });

    // Хук промпта
    document.addEventListener('generate_before_send', (e) => {
        const injection = buildPromptInjection();
        if (!injection) return;
        if (e.detail?.chat) e.detail.chat.unshift({ role: 'system', content: injection });
    });

    console.log(`[${EXT_NAME}] v2 загружен`);
});
