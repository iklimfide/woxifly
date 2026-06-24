let overlay = null;
let modal = null;
let getIsLoggedIn = () => false;
let onLogin = null;
let onRegister = null;

export function closeWelcomeModal() {
    if (!overlay) return;

    overlay.classList.remove('open');
    modal?.classList.remove('open');
    document.body.classList.remove('welcome-modal-open');
}

export function openWelcomeModal() {
    if (!overlay || getIsLoggedIn?.()) return;

    overlay.classList.add('open');
    modal?.classList.add('open');
    document.body.classList.add('welcome-modal-open');
}

export function maybeShowWelcomeModal() {
    if (getIsLoggedIn?.()) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'login' || params.get('auth') === 'register') return;

    openWelcomeModal();
}

export function initWelcomeModal({ isLoggedIn, onLogin: loginHandler, onRegister: registerHandler }) {
    getIsLoggedIn = isLoggedIn;
    onLogin = loginHandler;
    onRegister = registerHandler;

    overlay = document.getElementById('welcomeModalOverlay');
    modal = document.getElementById('welcomeModal');
    if (!overlay || !modal) return;

    modal.addEventListener('click', (event) => event.stopPropagation());

    document.getElementById('welcomeLoginBtn')?.addEventListener('click', () => {
        closeWelcomeModal();
        onLogin?.();
    });

    document.getElementById('welcomeRegisterBtn')?.addEventListener('click', () => {
        closeWelcomeModal();
        onRegister?.();
    });

    modal.querySelectorAll('.welcome-feature-card-cta').forEach((btn) => {
        btn.addEventListener('click', () => {
            closeWelcomeModal();
            onRegister?.();
        });
    });
}
