import { applySiteSeo } from './seo.js';
import {
    CALC_TITLE,
    CALC_SHORT_NAME,
    CALC_DESCRIPTION,
    SITE_NAME,
    SITE_DESCRIPTION,
    APP_ICON_192,
    APP_ICON_512,
    APP_FAVICON,
    CALC_ICON_192,
    CALC_ICON_512,
    CALC_FAVICON
} from '../shared/seo-config.js';

const HM_STORAGE_KEY = 'hm_perde';
const HM_PIN_KEY = 'hm_pin';
const DEFAULT_PIN = '1923';

let sessionUnlocked = false;
let calcState = {
    display: '0',
    stored: null,
    operator: null,
    fresh: true
};

export function isHmEnabled() {
    return localStorage.getItem(HM_STORAGE_KEY) === 'true';
}

export function getHmPin() {
    if (!isHmEnabled()) return DEFAULT_PIN;
    const pin = localStorage.getItem(HM_PIN_KEY);
    return pin && /^\d{4,8}$/.test(pin) ? pin : DEFAULT_PIN;
}

function setLinkIcon(rel, href) {
    let link = document.querySelector(`link[rel="${rel}"]`);
    if (!link) {
        link = document.createElement('link');
        link.rel = rel;
        document.head.appendChild(link);
    }
    link.href = href;
    if (rel === 'icon') link.type = 'image/png';
}

export function updatePageIcons(isCalculatorMode) {
    if (isCalculatorMode) {
        setLinkIcon('icon', CALC_FAVICON);
        setLinkIcon('apple-touch-icon', CALC_ICON_192);
    } else {
        setLinkIcon('icon', APP_FAVICON);
        setLinkIcon('apple-touch-icon', APP_ICON_192);
    }
}

export function updatePWAManifest(isCalculatorMode) {
    const manifest = {
        name: isCalculatorMode ? CALC_TITLE : SITE_NAME,
        short_name: isCalculatorMode ? CALC_SHORT_NAME : SITE_NAME,
        description: isCalculatorMode ? CALC_DESCRIPTION : SITE_DESCRIPTION,
        start_url: '/',
        display: 'standalone',
        background_color: isCalculatorMode ? '#000000' : '#fdfbf7',
        theme_color: isCalculatorMode ? '#000000' : '#2077c5',
        icons: [
            {
                src: isCalculatorMode ? CALC_ICON_192 : APP_ICON_192,
                sizes: '192x192',
                type: 'image/png'
            },
            {
                src: isCalculatorMode ? CALC_ICON_512 : APP_ICON_512,
                sizes: '512x512',
                type: 'image/png'
            }
        ]
    };

    let manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
        manifestLink.setAttribute('href', 'data:application/json;base64,' + btoa(JSON.stringify(manifest)));
    }

    applySiteSeo(isCalculatorMode);
    updatePageIcons(isCalculatorMode);

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
        themeColor.setAttribute('content', isCalculatorMode ? '#000000' : '#2077c5');
    }
}

export function saveHmSettings(enabled, pin) {
    if (enabled) {
        localStorage.setItem(HM_STORAGE_KEY, 'true');
        const resolvedPin = pin && /^\d{4,8}$/.test(pin) ? pin : DEFAULT_PIN;
        localStorage.setItem(HM_PIN_KEY, resolvedPin);
    } else {
        localStorage.removeItem(HM_STORAGE_KEY);
        localStorage.removeItem(HM_PIN_KEY);
        sessionUnlocked = false;
        hideHmVeil();
    }

    updatePWAManifest(enabled);
}

function setPinGroupVisible(visible) {
    const pinGroup = document.getElementById('hmPinGroup');
    if (!pinGroup) return;
    pinGroup.hidden = !visible;
    pinGroup.style.display = visible ? 'block' : 'none';
    pinGroup.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

export function syncHmProfileUi() {
    const toggle = document.getElementById('hmPerdeInput');
    const pinInput = document.getElementById('hmPinInput');
    if (!toggle) return;

    const enabled = isHmEnabled();
    toggle.checked = enabled;
    setPinGroupVisible(enabled);

    if (pinInput) {
        if (enabled) {
            pinInput.value = localStorage.getItem(HM_PIN_KEY) ? getHmPin() : DEFAULT_PIN;
        } else {
            pinInput.value = '';
        }
    }
}

function onHmToggleChanged() {
    const toggle = document.getElementById('hmPerdeInput');
    const pinInput = document.getElementById('hmPinInput');
    if (!toggle) return;

    const enabled = toggle.checked;
    setPinGroupVisible(enabled);

    if (enabled && pinInput && !pinInput.value.trim()) {
        pinInput.value = DEFAULT_PIN;
    }

    const pin = pinInput?.value?.trim() || '';
    saveHmSettings(enabled, enabled ? (pin || DEFAULT_PIN) : '');
    syncHmProfileUi();
}

function updateCalcDisplay() {
    const el = document.getElementById('hmDisplay');
    if (!el) return;

    el.textContent = calcState.display;

    const len = calcState.display.replace(/^-/, '').length;
    if (len > 9) el.style.fontSize = 'clamp(2rem, 10vw, 3rem)';
    else if (len > 6) el.style.fontSize = 'clamp(2.5rem, 13vw, 4rem)';
    else el.style.fontSize = '';

    syncOpButtons();
}

function syncOpButtons() {
    document.querySelectorAll('.hm-calc-btn--op[data-hm-action]').forEach((btn) => {
        const op = btn.dataset.hmAction;
        if (!['+', '-', '×', '÷'].includes(op)) return;
        btn.classList.toggle('hm-calc-btn--op-active', calcState.operator === op);
    });
}

function resetCalc() {
    calcState = { display: '0', stored: null, operator: null, fresh: true };
    updateCalcDisplay();
}

function inputDigit(digit) {
    if (calcState.fresh) {
        calcState.display = digit;
        calcState.fresh = false;
    } else {
        calcState.display = calcState.display === '0' ? digit : calcState.display + digit;
    }
    updateCalcDisplay();
}

function inputDecimal() {
    if (calcState.fresh) {
        calcState.display = '0.';
        calcState.fresh = false;
    } else if (!calcState.display.includes('.')) {
        calcState.display += '.';
    }
    updateCalcDisplay();
}

function toggleSign() {
    if (calcState.display === '0') return;
    calcState.display = calcState.display.startsWith('-')
        ? calcState.display.slice(1)
        : `-${calcState.display}`;
    calcState.fresh = false;
    updateCalcDisplay();
}

function applyPercent() {
    const val = parseDisplay() / 100;
    calcState.display = formatCalcNumber(val);
    calcState.fresh = true;
    updateCalcDisplay();
}

function formatCalcNumber(n) {
    if (!Number.isFinite(n)) return '0';
    if (Number.isInteger(n)) return String(n);
    return String(parseFloat(n.toFixed(10)));
}

function parseDisplay() {
    return parseFloat(calcState.display) || 0;
}

function setOperator(op) {
    if (calcState.operator && !calcState.fresh) {
        computeResult();
    } else {
        calcState.stored = parseDisplay();
    }
    calcState.operator = op;
    calcState.fresh = true;
    syncOpButtons();
}

function computeResult() {
    if (calcState.stored === null || !calcState.operator) return;

    const a = calcState.stored;
    const b = parseDisplay();
    let result;

    switch (calcState.operator) {
        case '+': result = a + b; break;
        case '-': result = a - b; break;
        case '×': result = a * b; break;
        case '÷': result = b === 0 ? 0 : a / b; break;
        default: return;
    }

    calcState.display = formatCalcNumber(result);
    calcState.stored = null;
    calcState.operator = null;
    calcState.fresh = true;
    updateCalcDisplay();
}

function tryUnlock() {
    const pin = getHmPin();
    const raw = calcState.display.replace(/\.$/, '');
    if (calcState.operator === null && calcState.stored === null && raw === pin) {
        sessionUnlocked = true;
        hideHmVeil();
        resetCalc();
        return true;
    }
    return false;
}

function handleCalcAction(action) {
    switch (action) {
        case 'C':
            resetCalc();
            break;
        case '±':
            toggleSign();
            break;
        case '%':
            applyPercent();
            break;
        case '.':
            inputDecimal();
            break;
        case '+':
        case '-':
        case '×':
        case '÷':
            setOperator(action);
            break;
        case '=':
            if (tryUnlock()) break;
            computeResult();
            break;
        default:
            if (/^\d$/.test(action)) inputDigit(action);
    }
}

export function showHmVeil() {
    const veil = document.getElementById('hmVeil');
    if (!veil) return;
    sessionUnlocked = false;
    resetCalc();
    veil.classList.add('active');
    veil.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('hm-active');
}

export function hideHmVeil() {
    const veil = document.getElementById('hmVeil');
    if (!veil) return;
    veil.classList.remove('active');
    veil.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('hm-active');
}

function bindCalcButtons() {
    const grid = document.getElementById('hmKeypad');
    if (!grid || grid.dataset.bound) return;
    grid.dataset.bound = '1';

    grid.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-hm-action]');
        if (!btn) return;
        handleCalcAction(btn.dataset.hmAction);
    });
}

function bindProfileControls() {
    const toggle = document.getElementById('hmPerdeInput');
    const pinInput = document.getElementById('hmPinInput');
    if (!toggle || toggle.dataset.hmBound === '1') return;

    toggle.dataset.hmBound = '1';
    toggle.addEventListener('change', onHmToggleChanged);

    pinInput?.addEventListener('change', () => {
        if (!isHmEnabled()) return;
        const pin = pinInput.value.trim();
        if (!/^\d{4,8}$/.test(pin)) {
            pinInput.value = localStorage.getItem(HM_PIN_KEY) || DEFAULT_PIN;
            return;
        }
        localStorage.setItem(HM_PIN_KEY, pin);
    });
}

/** Profil paneli açıldığında çağrılır — toggle bağlantısı kaçırıldıysa telafi eder. */
export function ensureHmProfileControls() {
    bindProfileControls();
    syncHmProfileUi();
}

function bindLeaveGuard() {
    document.addEventListener('visibilitychange', () => {
        if (!isHmEnabled()) return;
        if (document.visibilityState === 'hidden') {
            showHmVeil();
        }
    });

    window.addEventListener('pagehide', () => {
        if (isHmEnabled()) showHmVeil();
    });
}

export function initHmCamouflage() {
    bindCalcButtons();
    bindProfileControls();
    bindLeaveGuard();
    syncHmProfileUi();
    updatePWAManifest(isHmEnabled());

    if (isHmEnabled()) {
        showHmVeil();
    }
}

export function readHmSettingsFromProfile() {
    const toggle = document.getElementById('hmPerdeInput');
    const pinInput = document.getElementById('hmPinInput');
    const enabled = toggle?.checked === true;
    const pin = pinInput?.value?.trim() || '';

    if (enabled && pin && !/^\d{4,8}$/.test(pin)) {
        return { error: 'Kilit PIN 4-8 haneli rakam olmalıdır.' };
    }

    saveHmSettings(enabled, enabled ? (pin || DEFAULT_PIN) : '');
    syncHmProfileUi();
    return { ok: true };
}
