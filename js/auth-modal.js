import { supabase } from './supabase-client.js';
import { getLocationCoords, DEFAULT_LOCATION } from './config.js';
import {
    sanitizeText,
    isValidUsername,
    isValidEmail,
    setButtonLoading,
    showAuthError,
    initPasswordVisibilityToggles
} from './utils.js';
import {
    normalizeLoginUsername,
    resolveAuthLoginEmail,
    isValidLoginPassword
} from './auth-identity.js';
import { openWelcomeModal } from './welcome-modal.js';
import { showToast } from './notify-modal.js';

let onAuthSuccess = null;
let modalElements = null;
let getIsLoggedIn = () => false;
let registerUsernameCheckTimer = null;
let registerUsernameCheckSeq = 0;
let registerUsernameIsTaken = false;

const USERNAME_HINT_NEUTRAL =
    'Kullanıcı adı benzersiz olmalıdır (WoXifly ile woxifly aynı sayılır).';
const USERNAME_HELP =
    'Kullanıcı adı 2–24 karakter; harf, rakam, _ . - kullanılabilir.';
const PASSWORD_HELP = 'Şifre en az 6 karakter olmalıdır.';
const USERNAME_TAKEN_MSG =
    'Bu kullanıcı adı zaten kullanılıyor. Lütfen başka bir ad seçin.';

function readAuthPassword(raw) {
    return String(raw ?? '').slice(0, 72);
}

function setRegisterUsernameFieldStatus(message, variant = 'muted') {
    const el = document.getElementById('register-username-status');
    if (!el) return;
    el.textContent = message || USERNAME_HINT_NEUTRAL;
    el.hidden = false;
    el.className = `auth-field-status auth-field-status--${variant}`;
}

function resetRegisterUsernameFieldStatus() {
    registerUsernameIsTaken = false;
    registerUsernameCheckSeq += 1;
    clearTimeout(registerUsernameCheckTimer);
    setRegisterUsernameFieldStatus(USERNAME_HINT_NEUTRAL, 'muted');
}

async function runRegisterUsernameAvailabilityCheck(username) {
    const seq = ++registerUsernameCheckSeq;
    const trimmed = sanitizeText(username, 24);

    if (!trimmed) {
        resetRegisterUsernameFieldStatus();
        return;
    }

    if (!isValidUsername(trimmed)) {
        registerUsernameIsTaken = false;
        if (trimmed.length >= 2) {
            setRegisterUsernameFieldStatus(USERNAME_HELP, 'error');
        } else {
            setRegisterUsernameFieldStatus(USERNAME_HINT_NEUTRAL, 'muted');
        }
        return;
    }

    setRegisterUsernameFieldStatus('Kontrol ediliyor…', 'pending');
    const available = await isUsernameAvailable(trimmed);
    if (seq !== registerUsernameCheckSeq) return;

    if (!available) {
        setRegisterUsernameFieldStatus(USERNAME_TAKEN_MSG, 'error');
        registerUsernameIsTaken = true;
        return;
    }

    setRegisterUsernameFieldStatus('Bu ad kullanılabilir.', 'ok');
    registerUsernameIsTaken = false;
}

function scheduleRegisterUsernameCheck() {
    clearTimeout(registerUsernameCheckTimer);
    const input = document.getElementById('register-username');
    const username = sanitizeText(input?.value || '', 24);
    registerUsernameCheckTimer = setTimeout(() => {
        runRegisterUsernameAvailabilityCheck(username);
    }, 400);
}

function bindRegisterUsernameLiveCheck() {
    const input = document.getElementById('register-username');
    if (!input || input.dataset.usernameCheckBound) return;
    input.dataset.usernameCheckBound = '1';
    input.addEventListener('input', scheduleRegisterUsernameCheck);
    input.addEventListener('blur', () => {
        clearTimeout(registerUsernameCheckTimer);
        runRegisterUsernameAvailabilityCheck(input.value);
    });
}

export function initAuthModal(successCallback, { isLoggedIn } = {}) {
    onAuthSuccess = successCallback;
    if (isLoggedIn) getIsLoggedIn = isLoggedIn;
    modalElements = {
        overlay: document.getElementById('authModalOverlay'),
        modal: document.getElementById('authModal'),
        loginForm: document.getElementById('login-form'),
        registerForm: document.getElementById('register-form'),
        loginBtn: document.getElementById('login-btn'),
        registerBtn: document.getElementById('register-btn'),
        loginMessage: document.getElementById('login-message'),
        registerMessage: document.getElementById('register-message')
    };

    document.querySelectorAll('.auth-tab').forEach((tab) => {
        tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
    });

    modalElements.loginForm.addEventListener('submit', handleLoginSubmit);
    modalElements.registerForm.addEventListener('submit', handleRegisterSubmit);

    document.getElementById('authModalCloseBtn')?.addEventListener('click', cancelAuthModal);
    bindRegisterUsernameLiveCheck();
    if (modalElements.modal) {
        initPasswordVisibilityToggles(modalElements.modal);
    }
}

export function cancelAuthModal() {
    if (!modalElements) return;

    closeAuthModal();
    modalElements.loginForm.reset();
    modalElements.registerForm.reset();
    resetRegisterUsernameFieldStatus();
    showAuthError(modalElements.loginMessage, '');
    showAuthError(modalElements.registerMessage, '');

    if (!getIsLoggedIn()) {
        openWelcomeModal();
    }
}

export function openAuthModal(tab = 'login') {
    if (!modalElements) return;

    switchAuthTab(tab);
    showAuthError(modalElements.loginMessage, '');
    showAuthError(modalElements.registerMessage, '');
    modalElements.overlay.classList.add('open');
    modalElements.modal.classList.add('open');
    document.body.classList.add('auth-modal-open');

    const firstInput = tab === 'register'
        ? document.getElementById('register-username')
        : document.getElementById('login-username');
    if (firstInput) setTimeout(() => firstInput.focus(), 100);
}

export function closeAuthModal() {
    if (!modalElements) return;

    modalElements.overlay.classList.remove('open');
    modalElements.modal.classList.remove('open');
    document.body.classList.remove('auth-modal-open');
}

function switchAuthTab(tabName) {
    document.querySelectorAll('.auth-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    document.querySelectorAll('.auth-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === `${tabName}-panel`);
    });
    if (modalElements) {
        showAuthError(modalElements.loginMessage, '');
        showAuthError(modalElements.registerMessage, '');
    }
}

export async function isUsernameAvailable(username, excludeUserId = null) {
    const normalized = normalizeLoginUsername(username);
    if (!normalized || !isValidUsername(username)) return false;

    const { data, error } = await supabase.rpc('is_username_available', {
        p_username: username,
        p_exclude: excludeUserId
    });

    if (!error) {
        return data === true || data === 'true';
    }

    console.warn('[auth] rumuz RPC:', error.message);
    return true;
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    const { loginForm, loginBtn, loginMessage } = modalElements;
    showAuthError(loginMessage, '');

    const loginId = sanitizeText(loginForm.username.value, 254);
    const password = readAuthPassword(loginForm.password.value);
    const email = resolveAuthLoginEmail(loginId);

    if (!loginId) {
        showAuthError(loginMessage, 'Kullanıcı adı girin.');
        return;
    }

    if (!email) {
        showAuthError(loginMessage, USERNAME_HELP);
        return;
    }

    if (!isValidLoginPassword(password)) {
        showAuthError(loginMessage, PASSWORD_HELP);
        return;
    }

    if (!loginId.includes('@') && !isValidUsername(loginId)) {
        showAuthError(loginMessage, USERNAME_HELP);
        return;
    }

    if (loginId.includes('@') && !isValidEmail(loginId)) {
        showAuthError(loginMessage, 'Geçerli bir e-posta adresi girin.');
        return;
    }

    setButtonLoading(loginBtn, true, 'Giriş Yap');

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            showAuthError(loginMessage, translateAuthError(error.message, { login: true }));
            return;
        }

        if (data.session) {
            showToast('Giriş başarılı.', { type: 'success' });
            await finishAuth();
        }
    } catch {
        showAuthError(loginMessage, 'Giriş sırasında beklenmeyen bir hata oluştu.');
    } finally {
        setButtonLoading(loginBtn, false, 'Giriş Yap');
    }
}

async function handleRegisterSubmit(event) {
    event.preventDefault();
    const { registerForm, registerBtn, registerMessage } = modalElements;
    showAuthError(registerMessage, '');

    const username = sanitizeText(registerForm.username.value, 24);
    const password = readAuthPassword(registerForm.password.value);
    const passwordConfirm = readAuthPassword(registerForm.elements.passwordConfirm?.value);
    const coords = getLocationCoords();

    if (!isValidUsername(username)) {
        setRegisterUsernameFieldStatus(USERNAME_HELP, 'error');
        registerForm.username.focus();
        return;
    }

    if (registerUsernameIsTaken) {
        setRegisterUsernameFieldStatus(USERNAME_TAKEN_MSG, 'error');
        registerForm.username.focus();
        return;
    }

    if (!isValidLoginPassword(password)) {
        showAuthError(registerMessage, PASSWORD_HELP);
        return;
    }

    if (password !== passwordConfirm) {
        showAuthError(registerMessage, 'Şifre tekrarı eşleşmiyor.');
        return;
    }

    setButtonLoading(registerBtn, true, 'Hesap Oluştur');

    try {
        await runRegisterUsernameAvailabilityCheck(username);
        if (registerUsernameIsTaken) {
            registerForm.username.focus();
            return;
        }

        const email = resolveAuthLoginEmail(username);
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    username,
                    district: DEFAULT_LOCATION,
                    lat: coords.lat,
                    lon: coords.lon
                }
            }
        });

        if (error) {
            showAuthError(registerMessage, translateAuthError(error.message, { register: true }));
            return;
        }

        if (!data.user?.id) {
            showAuthError(registerMessage, 'Kayıt oluşturulamadı.');
            return;
        }

        await ensureProfile(data.user.id, username);

        if (data.session) {
            showToast('Kayıt başarılı.', { type: 'success' });
            await finishAuth();
            return;
        }

        showToast('Kayıt başarılı, giriş yapabilirsiniz.', { type: 'success' });
        registerForm.reset();
        resetRegisterUsernameFieldStatus();
        modalElements.loginForm.username.value = username;
        switchAuthTab('login');
    } catch {
        showAuthError(registerMessage, 'Kayıt sırasında beklenmeyen bir hata oluştu.');
    } finally {
        setButtonLoading(registerBtn, false, 'Hesap Oluştur');
    }
}

async function ensureProfile(userId, username) {
    const { error } = await supabase.from('profiles').upsert({
        id: userId,
        username,
        district: DEFAULT_LOCATION,
        current_district: DEFAULT_LOCATION,
        updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    if (error) throw error;
}

async function finishAuth() {
    closeAuthModal();
    modalElements.loginForm.reset();
    modalElements.registerForm.reset();
    resetRegisterUsernameFieldStatus();
    if (onAuthSuccess) await onAuthSuccess();
}

function translateAuthError(message, { login = false, register = false } = {}) {
    if (register && /database error saving new user/i.test(message)) {
        return (
            'Kayıt veritabanında tamamlanamadı. Kullanıcı adı alınmış olabilir veya ' +
            'Supabase\'te fix-signup-database-error.sql çalıştırılmamış olabilir.'
        );
    }
    const map = {
        'Invalid login credentials': login
            ? 'Kullanıcı adı veya şifre hatalı.'
            : 'E-posta veya şifre hatalı.',
        'User already registered': 'Bu kullanıcı adı zaten kayıtlı.',
        'Email not confirmed': 'Lütfen hesabınızı onaylayın (e-posta doğrulaması açıksa).',
        'Password should be at least 6 characters': PASSWORD_HELP
    };
    return map[message] || message;
}
