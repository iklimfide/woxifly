/** Kaydırınca üst/alt sohbet çubuklarını gizle; visualViewport ile mobil tarayıcı yüksekliği. */

const HIDE_DELTA_PX = 12;
const SHOW_DELTA_PX = 8;
const TOP_REVEAL_PX = 28;

let chromeHidden = false;
let bound = false;

function prefersCompactChrome() {
    return window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)').matches;
}

function shouldAllowChromeHide() {
    if (!prefersCompactChrome()) return false;

    const profileActive = document.getElementById('profile-panel')?.classList.contains('active');
    const chatOpen = document.body.classList.contains('chat-open-view');

    if (!profileActive && !chatOpen) return false;
    if (document.body.classList.contains('chats-home-view') && !profileActive) return false;

    if (!profileActive && document.getElementById('messageInputArea')?.hidden) return false;
    if (!profileActive && document.getElementById('messageContainer')?.hidden) return false;
    if (document.querySelector('.message-container.selection-mode')) return false;
    if (document.activeElement?.id === 'messageInput') return false;
    if (document.body.classList.contains('search-open')) return false;
    if (document.body.classList.contains('voice-call-active')) return false;
    if (document.getElementById('voiceCallOverlay') && !document.getElementById('voiceCallOverlay').hidden) {
        return false;
    }
    return true;
}

export function resetScrollChrome() {
    if (!chromeHidden) return;
    chromeHidden = false;
    document.body.classList.remove('chat-chrome-hidden');
}

function setChromeHidden(hidden) {
    if (!shouldAllowChromeHide()) {
        resetScrollChrome();
        return;
    }
    if (chromeHidden === hidden) return;
    chromeHidden = hidden;
    document.body.classList.toggle('chat-chrome-hidden', hidden);
}

function bindChromeScroll(container) {
    if (!container || container.dataset.chromeScrollBound) return;
    container.dataset.chromeScrollBound = 'true';

    let lastTop = container.scrollTop;

    container.addEventListener('scroll', () => {
        if (!shouldAllowChromeHide()) {
            resetScrollChrome();
            lastTop = container.scrollTop;
            return;
        }

        const top = container.scrollTop;
        const delta = top - lastTop;

        if (top <= TOP_REVEAL_PX) {
            setChromeHidden(false);
        } else if (delta > HIDE_DELTA_PX) {
            setChromeHidden(true);
        } else if (delta < -SHOW_DELTA_PX) {
            setChromeHidden(false);
        }

        lastTop = top;
    }, { passive: true });
}

function bindVisualViewport() {
    const root = document.documentElement;
    const apply = () => {
        const vv = window.visualViewport;
        if (!vv) return;
        root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
        root.style.setProperty('--vv-offset-top', `${Math.round(vv.offsetTop)}px`);
    };

    apply();
    window.visualViewport?.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', () => window.setTimeout(apply, 100));
}

export function initScrollChrome() {
    if (bound) return;
    bound = true;

    bindVisualViewport();
    bindChromeScroll(document.getElementById('messageContainer'));
    bindChromeScroll(document.querySelector('#profile-panel .profile-container'));

    document.getElementById('messageInput')?.addEventListener('focus', resetScrollChrome);
    window.addEventListener('resize', () => {
        if (!prefersCompactChrome()) resetScrollChrome();
    });
}
