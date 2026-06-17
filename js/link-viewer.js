let historyPushed = false;
let iframeFailTimer = null;
let currentViewerUrl = null;

function trimTrailingUrlPunctuation(url) {
    return url.replace(/[.,;:!?)}\]]+$/g, '');
}

function toSafeHref(rawUrl) {
    const cleaned = trimTrailingUrlPunctuation(rawUrl);
    const href = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

    try {
        const parsed = new URL(href);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        if (!parsed.hostname.includes('.')) return null;
        return parsed.href;
    } catch {
        return null;
    }
}

const IFRAME_BLOCKLIST = new Set([
    'x.com', 'twitter.com', 'mobile.twitter.com', 't.co',
    'facebook.com', 'fb.com', 'm.facebook.com', 'web.facebook.com',
    'instagram.com', 'www.instagram.com',
    'youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com',
    'google.com', 'accounts.google.com', 'mail.google.com',
    'linkedin.com', 'www.linkedin.com',
    'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com',
    'whatsapp.com', 'web.whatsapp.com', 'api.whatsapp.com',
    't.me', 'telegram.me', 'telegram.org',
    'spotify.com', 'open.spotify.com',
    'reddit.com', 'www.reddit.com', 'old.reddit.com',
    'github.com', 'gist.github.com',
    'apple.com', 'apps.apple.com',
    'microsoft.com', 'login.microsoftonline.com',
    'netflix.com', 'discord.com', 'discord.gg',
    'pinterest.com', 'snapchat.com'
]);

const APP_TARGETS = {
    'x.com': { android: 'com.twitter.android', ios: 'twitter' },
    'twitter.com': { android: 'com.twitter.android', ios: 'twitter' },
    'instagram.com': { android: 'com.instagram.android', ios: 'instagram' },
    'youtube.com': { android: 'com.google.android.youtube', ios: 'youtube' },
    'youtu.be': { android: 'com.google.android.youtube', ios: 'youtube' },
    'facebook.com': { android: 'com.facebook.katana', ios: 'fb' },
    'fb.com': { android: 'com.facebook.katana', ios: 'fb' },
    'linkedin.com': { android: 'com.linkedin.android', ios: 'linkedin' },
    'tiktok.com': { android: 'com.zhiliaoapp.musically', ios: 'snssdk1233' },
    'whatsapp.com': { android: 'com.whatsapp', ios: 'whatsapp' },
    'web.whatsapp.com': { android: 'com.whatsapp', ios: 'whatsapp' },
    't.me': { android: 'org.telegram.messenger', ios: 'tg' },
    'telegram.me': { android: 'org.telegram.messenger', ios: 'tg' },
    'spotify.com': { android: 'com.spotify.music', ios: 'spotify' },
    'reddit.com': { android: 'com.reddit.frontpage', ios: 'reddit' },
    'open.spotify.com': { android: 'com.spotify.music', ios: 'spotify' }
};

function getElements() {
    return {
        overlay: document.getElementById('linkViewer'),
        iframe: document.getElementById('linkViewerFrame'),
        urlLabel: document.getElementById('linkViewerUrl'),
        externalBtn: document.getElementById('linkViewerExternal')
    };
}

function normalizeHost(hostname) {
    return hostname.toLowerCase().replace(/^www\./, '');
}

function getHostname(url) {
    try {
        return normalizeHost(new URL(url).hostname);
    } catch {
        return '';
    }
}

function isMobileDevice() {
    return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isAndroid() {
    return /android/i.test(navigator.userAgent);
}

function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function shouldOpenExternally(url) {
    const host = getHostname(url);
    if (!host) return true;

    if (IFRAME_BLOCKLIST.has(host)) return true;

    const parts = host.split('.');
    if (parts.length > 2) {
        const baseDomain = parts.slice(-2).join('.');
        if (IFRAME_BLOCKLIST.has(baseDomain)) return true;
    }

    return false;
}

function getAppTarget(url) {
    const host = getHostname(url);
    return APP_TARGETS[host] || APP_TARGETS[host.split('.').slice(-2).join('.')] || null;
}

function openInSystemBrowser(url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function openAndroidIntent(url, packageName) {
    const parsed = new URL(url);
    const path = `${parsed.host}${parsed.pathname}${parsed.search}`;
    const intent = `intent://${path}#Intent;scheme=https;package=${packageName};S.browser_fallback_url=${encodeURIComponent(url)};end`;
    window.location.href = intent;
}

function openIOSApp(url, scheme) {
    const parsed = new URL(url);
    const appPath = `${parsed.host}${parsed.pathname}${parsed.search}`;
    const appUrl = `${scheme}://${appPath}`;

    let opened = false;
    const onBlur = () => { opened = true; };
    window.addEventListener('blur', onBlur, { once: true });

    window.location.href = appUrl;

    window.setTimeout(() => {
        window.removeEventListener('blur', onBlur);
        if (!opened) openInSystemBrowser(url);
    }, 1500);
}

export function openExternally(url) {
    const safeUrl = toSafeHref(url);
    if (!safeUrl) return;

    const app = getAppTarget(safeUrl);

    if (isMobileDevice() && app) {
        if (isAndroid() && app.android) {
            openAndroidIntent(safeUrl, app.android);
            return;
        }
        if (isIOS() && app.ios) {
            openIOSApp(safeUrl, app.ios);
            return;
        }
    }

    openInSystemBrowser(safeUrl);
}

function clearIframeFailWatch() {
    if (iframeFailTimer) {
        clearTimeout(iframeFailTimer);
        iframeFailTimer = null;
    }
}

function watchIframeForFailure(url) {
    clearIframeFailWatch();
    const { iframe } = getElements();
    if (!iframe) return;

    iframeFailTimer = window.setTimeout(() => {
        try {
            const doc = iframe.contentDocument;
            const text = doc?.body?.innerText || '';
            if (text.includes('refused to connect') || text.includes('bağlanmayı reddetti')) {
                closeInAppLink();
                openExternally(url);
            }
        } catch {
            // Cross-origin: sayfa yüklendi, sorun yok
        }
    }, 1200);
}

export function initLinkViewer() {
    const { overlay, iframe } = getElements();
    if (!overlay) return;

    document.getElementById('linkViewerBack')?.addEventListener('click', () => closeInAppLink());
    document.getElementById('linkViewerClose')?.addEventListener('click', () => closeInAppLink());
    document.getElementById('linkViewerExternal')?.addEventListener('click', (event) => {
        event.preventDefault();
        const target = currentViewerUrl || iframe?.src;
        if (target && target !== 'about:blank') openExternally(target);
    });

    iframe?.addEventListener('load', () => {
        if (currentViewerUrl) watchIframeForFailure(currentViewerUrl);
    });

    window.addEventListener('popstate', () => {
        if (overlay.classList.contains('open')) {
            closeInAppLink(true);
        }
    });
}

export function openLink(url) {
    const safeUrl = toSafeHref(url);
    if (!safeUrl) return;

    if (shouldOpenExternally(safeUrl)) {
        openExternally(safeUrl);
        return;
    }

    openInAppLink(safeUrl);
}

export function openInAppLink(url) {
    const { overlay, iframe, urlLabel, externalBtn } = getElements();
    if (!overlay || !iframe) return;

    const hostname = getHostname(url);
    if (!hostname) return;

    currentViewerUrl = url;
    clearIframeFailWatch();

    urlLabel.textContent = hostname;
    if (externalBtn) externalBtn.href = url;

    iframe.src = url;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('link-viewer-open');

    history.pushState({ linkViewer: true }, '');
    historyPushed = true;
}

export function closeInAppLink(fromPopstate = false) {
    const { overlay, iframe } = getElements();
    if (!overlay) return;

    clearIframeFailWatch();
    currentViewerUrl = null;

    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('link-viewer-open');
    if (iframe) iframe.src = 'about:blank';

    if (historyPushed && !fromPopstate) {
        historyPushed = false;
        history.back();
    } else {
        historyPushed = false;
    }
}
