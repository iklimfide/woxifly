/** Mobil: tarayıcı adres çubuğunu küçültmeye çalışır; uygulama üst/alt barları gizlenmez. */

let bound = false;

function isMobileBrowser() {
    return window.matchMedia('(max-width: 768px)').matches;
}

export function resetScrollChrome() {
    /* Uygulama çubukları artık gizlenmiyor — geriye dönük no-op */
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
    window.addEventListener('orientationchange', () => window.setTimeout(apply, 150));
}

function canScrollDocument() {
    return document.documentElement.scrollHeight - window.innerHeight > 1;
}

function nudgeBrowserUrlBar() {
    if (!isMobileBrowser()) return;
    if (!canScrollDocument()) return;
    if (window.scrollY < 2) {
        window.scrollTo(0, 1);
    }
}

function enableMobileBrowserUrlCollapse() {
    if (!isMobileBrowser()) return;

    document.documentElement.classList.add('mobile-browser-chrome');

    window.addEventListener('load', () => {
        window.setTimeout(nudgeBrowserUrlBar, 50);
        window.setTimeout(nudgeBrowserUrlBar, 300);
    }, { once: true });

    document.addEventListener('touchstart', nudgeBrowserUrlBar, { passive: true });

    const messageContainer = document.getElementById('messageContainer');
    messageContainer?.addEventListener('scroll', () => {
        if (messageContainer.scrollTop > 8) nudgeBrowserUrlBar();
    }, { passive: true });

    const chatList = document.querySelector('.chat-list');
    chatList?.addEventListener('scroll', () => {
        if (chatList.scrollTop > 8) nudgeBrowserUrlBar();
    }, { passive: true });
}

export function initScrollChrome() {
    if (bound) return;
    bound = true;

    bindVisualViewport();
    enableMobileBrowserUrlCollapse();

    window.matchMedia('(max-width: 768px)').addEventListener('change', () => {
        if (isMobileBrowser()) {
            document.documentElement.classList.add('mobile-browser-chrome');
            nudgeBrowserUrlBar();
        } else {
            document.documentElement.classList.remove('mobile-browser-chrome');
            window.scrollTo(0, 0);
        }
    });
}
