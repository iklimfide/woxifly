import { supabase } from './supabase-client.js';
import { getLocationCoords, DEFAULT_LOCATION } from './config.js';
import { sanitizeText, isValidUsername, isValidEmail, setButtonLoading, showAuthError } from './utils.js';
import { openWelcomeModal } from './welcome-modal.js';
import { showToast } from './notify-modal.js';
let onAuthSuccess = null;
let modalElements = null;
let getIsLoggedIn = () => false;

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
}

export function cancelAuthModal() {
    if (!modalElements) return;

    closeAuthModal();
    modalElements.loginForm.reset();
    modalElements.registerForm.reset();
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
        : document.getElementById('login-email');
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

async function handleLoginSubmit(event) {
    event.preventDefault();
    const { loginForm, loginBtn, loginMessage } = modalElements;
    showAuthError(loginMessage, '');

    const email = sanitizeText(loginForm.email.value, 254).toLowerCase();
    const password = loginForm.password.value;

    if (!isValidEmail(email)) {
        showAuthError(loginMessage, 'Geçerli bir e-posta adresi girin.');
        return;
    }

    if (password.length < 6) {
        showAuthError(loginMessage, 'Şifre en az 6 karakter olmalıdır.');
        return;
    }

    setButtonLoading(loginBtn, true, 'Giriş Yap');

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            showAuthError(loginMessage, translateAuthError(error.message));
            return;
        }

        if (data.session) {
            showToast('Giriş başarılı, yönlendiriliyorsunuz.', { type: 'success' });
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
    const email = sanitizeText(registerForm.email.value, 254).toLowerCase();
    const password = registerForm.password.value;
    const coords = getLocationCoords();

    if (!isValidUsername(username)) {
        showAuthError(registerMessage, 'Rumuz 2-24 karakter olmalı; harf, rakam, _ . - kullanılabilir.');
        return;
    }

    if (!isValidEmail(email)) {
        showAuthError(registerMessage, 'Geçerli bir e-posta adresi girin.');
        return;
    }

    if (password.length < 6) {
        showAuthError(registerMessage, 'Şifre en az 6 karakter olmalıdır.');
        return;
    }

    setButtonLoading(registerBtn, true, 'Hesap Oluştur');

    try {
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
            showAuthError(registerMessage, translateAuthError(error.message));
            return;
        }

        if (!data.user?.id) {
            showAuthError(registerMessage, 'Kayıt oluşturulamadı.');
            return;
        }

        await ensureProfile(data.user.id, username);

        if (data.session) {
            await supabase.auth.signOut();
        }

        showToast('Kayıt başarılı, giriş ekranına yönlendiriliyorsunuz.', { type: 'success' });
        registerForm.reset();
        modalElements.loginForm.email.value = email;
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
    if (onAuthSuccess) await onAuthSuccess();
}

function translateAuthError(message) {
    const map = {
        'Invalid login credentials': 'E-posta veya şifre hatalı.',
        'User already registered': 'Bu e-posta adresi zaten kayıtlı.',
        'Email not confirmed': 'Lütfen mailinizi onaylayınız.',
        'Password should be at least 6 characters': 'Şifre en az 6 karakter olmalıdır.'
    };
    return map[message] || message;
}
