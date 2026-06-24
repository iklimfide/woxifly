/**
 * Woxifly üst bar — DOM, stiller ve olaylar tek dosyada.
 */

const PP_GUEST_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4 0-6 2-6 4v1h12v-1c0-2-2-4-6-4Z"/></svg>`;

const TOPBAR_CSS = `
.app-topbar{flex-shrink:0;z-index:300;position:relative;background:linear-gradient(to bottom,var(--gradient-blue-start),var(--gradient-blue-end));border-bottom:1px solid #1a6cb1;color:#fff;min-height:var(--header-h);padding:10px 12px;padding-top:max(10px,env(safe-area-inset-top))}
.app-topbar__inner{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:calc(var(--header-h) - 20px);width:100%}
.app-topbar__start{display:flex;align-items:center;gap:10px;min-width:0;flex:1;overflow:hidden}
.app-topbar__end{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:auto}
.app-topbar__menu-btn{width:40px;height:40px;border:none;border-radius:8px;background:rgba(255,255,255,.18);color:#fff;font-size:1.2rem;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.app-topbar__menu-btn:active{transform:scale(.96)}
body.chats-home-view .app-topbar__menu-btn{display:none!important}
body.chats-home-view .app-topbar__inner{position:relative}
body.chats-home-view #headerTitleChat:not([hidden]){position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);flex:none;width:max-content;max-width:calc(100% - 112px);justify-content:center}
body.chats-home-view #activeChatAvatar{display:none!important}
body.chats-home-view .app-topbar__chat-name{font-size:1.05rem;font-weight:600}
.app-topbar__title{display:flex;align-items:center;min-width:0;flex:1;gap:10px;overflow:hidden}
.app-topbar__title[hidden]{display:none!important}
.app-topbar__avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;flex-shrink:0;overflow:hidden}
.app-topbar__avatar img{width:100%;height:100%;object-fit:cover}
.app-topbar__title-text{min-width:0;overflow:hidden}
.app-topbar__chat-name,.app-topbar__profile-label{font-weight:600;font-size:.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.app-topbar__chat-status{font-size:.75rem;color:#c4f9da;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.app-topbar__chat-status[hidden]{display:none!important}
.app-topbar__icon-btn{width:40px;height:40px;border:none;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;position:relative;overflow:hidden;font-weight:700;font-size:.95rem;font-family:inherit;flex-shrink:0;line-height:1}
.app-topbar__pp-btn{border:2px solid rgba(255,255,255,.95);background:rgba(255,255,255,.22)}
.app-topbar__icon-btn:active{transform:scale(.96)}
.app-topbar__icon-btn img{width:100%;height:100%;object-fit:cover;display:block}
.app-topbar__icon-btn svg{width:20px;height:20px;fill:currentColor;display:block}
.app-topbar__bell,.app-topbar__profile{position:relative;flex-shrink:0}
.app-topbar__badge{position:absolute;top:2px;right:2px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#e53e3e;color:#fff;font-size:.68rem;font-weight:700;line-height:18px;text-align:center;border:2px solid #2077c5;pointer-events:none}
.app-topbar__badge[hidden]{display:none!important}
.app-topbar__menu-panel{position:absolute;top:calc(100% + 8px);right:0;min-width:min(220px,80vw);background:#fff;border:1px solid var(--border-color);border-radius:8px;box-shadow:0 10px 25px rgba(0,0,0,.12);display:none;flex-direction:column;z-index:400;overflow:hidden}
.app-topbar__menu-panel.is-open{display:flex}
.app-topbar__menu-item{padding:14px 16px;font-size:.9rem;color:#334155;cursor:pointer;display:flex;align-items:center;gap:10px;text-align:left;border:none;background:none;width:100%;min-height:48px}
.app-topbar__menu-item:active{background:#f1f5f9;color:var(--accent-color)}
.app-topbar__menu-item--danger{color:#e53e3e}
.app-topbar__menu-divider{height:1px;background:var(--border-color)}
`;

const actions = {
    getIsLoggedIn: () => false,
    getIsCloudAdmin: () => false,
    onLogin: () => {},
    onRegister: () => {},
    onProfileSettings: () => {},
    onCloudPanel: () => {},
    onLogout: () => {},
    onMenuClick: () => {},
    onProfileMenuOpen: null
};

let mounted = false;
let bound = false;

function qs(id) {
    return document.getElementById(id);
}

function ensureTopbarStyles() {
    if (document.getElementById('topbar-styles')) return;
    const style = document.createElement('style');
    style.id = 'topbar-styles';
    style.textContent = TOPBAR_CSS;
    document.head.appendChild(style);
}

function mountTopbar() {
    const root = qs('appTopbar');
    if (!root || mounted) return;

    root.className = 'app-topbar';
    root.setAttribute('role', 'banner');
    root.innerHTML = `
        <div class="app-topbar__inner">
            <div class="app-topbar__start">
                <button type="button" class="app-topbar__menu-btn" id="topbarMenuBtn" aria-label="Menüyü aç">☰</button>
                <div class="app-topbar__title" id="headerTitleChat">
                    <div class="app-topbar__avatar" id="activeChatAvatar">W</div>
                    <div class="app-topbar__title-text">
                        <div class="app-topbar__chat-name" id="activeChatName">Woxifly</div>
                        <div class="app-topbar__chat-status" id="activeChatStatus" hidden></div>
                    </div>
                </div>
                <div class="app-topbar__title" id="headerTitleProfile" hidden>
                    <div class="app-topbar__title-text">
                        <div class="app-topbar__profile-label" id="headerProfileTabTitle">Profil Ayarları</div>
                    </div>
                </div>
            </div>
            <div class="app-topbar__end">
                <div class="app-topbar__bell">
                    <button type="button" class="app-topbar__icon-btn" id="notificationBellBtn" aria-label="Bildirimler">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-14 0v5l-2 2v1h18v-1l-2-2Z"/>
                        </svg>
                    </button>
                    <span class="app-topbar__badge" id="notificationBadge" hidden>0</span>
                    <div class="notification-dropdown" id="notificationDropdown"></div>
                </div>
                <div class="app-topbar__profile">
                    <button type="button" class="app-topbar__icon-btn app-topbar__pp-btn" id="headerProfilePic" aria-label="Profil menüsü" aria-haspopup="true" aria-expanded="false">${PP_GUEST_ICON}</button>
                    <div class="app-topbar__menu-panel" id="profileDropdown" role="menu"></div>
                </div>
            </div>
        </div>
    `;

    mounted = true;
}

function bindTopbarEvents() {
    if (bound) return;

    qs('topbarMenuBtn')?.addEventListener('click', (event) => {
        event.stopPropagation();
        actions.onMenuClick();
    });

    qs('headerProfilePic')?.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleProfileMenu();
    });

    qs('profileDropdown')?.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    document.addEventListener('click', () => {
        closeProfileMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeProfileMenu();
    });

    bound = true;
}

export function configureTopbar(handlers) {
    Object.assign(actions, handlers);
}

export function closeTopbarMenus() {
    closeProfileMenu();
}

export function setTopbarProfileAvatar({ imageUrl = null, letter = 'K', guest = false } = {}) {
    const btn = qs('headerProfilePic');
    if (!btn) return;

    btn.innerHTML = '';

    if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = '';
        img.draggable = false;
        btn.appendChild(img);
        return;
    }

    if (guest) {
        btn.innerHTML = PP_GUEST_ICON;
        return;
    }

    btn.textContent = (letter || 'K').charAt(0).toUpperCase();
}

function closeProfileMenu() {
    const panel = qs('profileDropdown');
    const btn = qs('headerProfilePic');
    if (!panel) return;
    panel.classList.remove('is-open');
    btn?.setAttribute('aria-expanded', 'false');
}

function toggleProfileMenu() {
    const panel = qs('profileDropdown');
    const btn = qs('headerProfilePic');
    if (!panel) return;

    const willOpen = !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', willOpen);
    btn?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');

    if (willOpen) {
        qs('notificationDropdown')?.classList.remove('show');
        void Promise.resolve(actions.onProfileMenuOpen?.()).then(() => {
            if (panel.classList.contains('is-open')) {
                refreshTopbarMenu();
            }
        });
    }
}

export function setTopbarTitleMode(mode) {
    const chat = qs('headerTitleChat');
    const profile = qs('headerTitleProfile');
    const profileLabel = qs('headerProfileTabTitle');
    if (!chat || !profile) return;

    if (mode === 'profile') {
        chat.hidden = true;
        profile.hidden = false;
        if (profileLabel) profileLabel.textContent = 'Profil Ayarları';
        return;
    }

    if (mode === 'bulut') {
        chat.hidden = true;
        profile.hidden = false;
        if (profileLabel) profileLabel.textContent = 'Bulut YP';
        return;
    }

    chat.hidden = false;
    profile.hidden = true;
}

export function syncTopbarMenuIcon() {
    const btn = qs('topbarMenuBtn');
    const sidebar = qs('sidebar');
    if (!btn || !sidebar) return;

    const isOpen = sidebar.classList.contains('open');
    btn.textContent = isOpen ? '×' : '☰';
    btn.setAttribute('aria-label', isOpen ? 'Menüyü kapat' : 'Menüyü aç');
}

function addMenuItem(label, onClick, { danger = false } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-topbar__menu-item' + (danger ? ' app-topbar__menu-item--danger' : '');
    btn.textContent = label;
    btn.setAttribute('role', 'menuitem');
    btn.addEventListener('click', () => {
        closeProfileMenu();
        onClick();
    });
    return btn;
}

function addMenuDivider() {
    const div = document.createElement('div');
    div.className = 'app-topbar__menu-divider';
    div.setAttribute('role', 'separator');
    return div;
}

export function refreshTopbarMenu() {
    const panel = qs('profileDropdown');
    if (!panel) return;

    panel.innerHTML = '';
    panel.setAttribute('role', 'menu');

    if (actions.getIsLoggedIn()) {
        const items = [
            addMenuItem('⚙️ Profil Ayarları', actions.onProfileSettings)
        ];

        if (actions.getIsCloudAdmin()) {
            items.push(addMenuItem('☁️ Bulut YP', actions.onCloudPanel));
        }

        items.push(
            addMenuDivider(),
            addMenuItem('🚪 Çıkış Yap', actions.onLogout, { danger: true })
        );
        panel.append(...items);
        return;
    }

    panel.append(
        addMenuItem('🔑 Giriş Yap', actions.onLogin),
        addMenuDivider(),
        addMenuItem('✨ Kayıt Ol', actions.onRegister)
    );
}

ensureTopbarStyles();
mountTopbar();
bindTopbarEvents();
