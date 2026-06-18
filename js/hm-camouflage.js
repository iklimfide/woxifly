import { applySiteSeo } from './seo.js';

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

export function updatePWAManifest(isCalculatorMode) {
    const manifest = {
        name: isCalculatorMode ? 'calculator' : 'woxifly',
        short_name: isCalculatorMode ? 'calculator' : 'woxifly',
        description: isCalculatorMode
            ? 'Hesap makinesi — toplama, çıkarma ve çarpma.'
            : 'Gizliliğe önem veren ilçe bazlı mesajlaşma platformu.',
        start_url: '/',
        display: 'standalone',
        background_color: '#fdfbf7',
        theme_color: '#d97706',
        icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
    };

    let manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
        manifestLink.setAttribute('href', 'data:application/json;base64,' + btoa(JSON.stringify(manifest)));
    }

    applySiteSeo(isCalculatorMode);

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
        themeColor.setAttribute('content', isCalculatorMode ? '#d97706' : '#2077c5');
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

export function syncHmProfileUi() {
    const toggle = document.getElementById('hmPerdeInput');
    const pinInput = document.getElementById('hmPinInput');
    const pinGroup = document.getElementById('hmPinGroup');
    if (!toggle) return;

    const enabled = isHmEnabled();
    toggle.checked = enabled;
    if (pinInput) {
        pinInput.value = enabled && localStorage.getItem(HM_PIN_KEY) ? getHmPin() : '';
    }
    if (pinGroup) pinGroup.hidden = !enabled;
}

function updateCalcDisplay() {
    const el = document.getElementById('hmDisplay');
    if (el) el.textContent = calcState.display;
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
        default: return;
    }

    const str = Number.isInteger(result) ? String(result) : String(parseFloat(result.toFixed(10)));
    calcState.display = str;
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
        case '.':
            inputDecimal();
            break;
        case '+':
        case '-':
        case '×':
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
    if (!toggle) return;

    toggle.addEventListener('change', () => {
        const enabled = toggle.checked;
        const pin = pinInput?.value?.trim() || '';
        saveHmSettings(enabled, enabled ? (pin || DEFAULT_PIN) : '');
        syncHmProfileUi();
    });

    pinInput?.addEventListener('change', () => {
        if (!isHmEnabled()) return;
        const pin = pinInput.value.trim();
        if (!/^\d{4,8}$/.test(pin)) {
            pinInput.value = localStorage.getItem(HM_PIN_KEY) || '';
            return;
        }
        localStorage.setItem(HM_PIN_KEY, pin);
    });
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
