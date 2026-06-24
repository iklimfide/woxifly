/**
 * Kamuflaj durumuna göre PWA manifest, ikon ve başlığı senkronize eder.
 * Modül yüklenmeden önce <head> içinde çalıştırılmalıdır.
 */
(function () {
    var MANIFEST_WOXIFLY = '/manifest.json';
    var MANIFEST_CALC = '/manifest-calc.json';
    var TITLE_WOXIFLY = 'Woxifly';
    var TITLE_CALC = 'Calculator';
    var THEME_WOXIFLY = '#2077c5';
    var THEME_CALC = '#000000';
    var ICON_WOXIFLY = '/favicon.png';
    var ICON_CALC = '/icons/calc-favicon.png';
    var APPLE_WOXIFLY = '/icons/icon-192.png';
    var APPLE_CALC = '/icons/calc-icon-192.png';

    function isCalcMode(explicit) {
        if (typeof explicit === 'boolean') return explicit;
        try {
            return localStorage.getItem('hm_perde') === 'true';
        } catch (_err) {
            return false;
        }
    }

    function setLinkIcon(rel, href, type) {
        var link = document.querySelector('link[rel="' + rel + '"]');
        if (!link) {
            link = document.createElement('link');
            link.rel = rel;
            document.head.appendChild(link);
        }
        link.href = href;
        if (type) link.type = type;
    }

    function setMeta(name, content) {
        var el = document.querySelector('meta[name="' + name + '"]');
        if (el) el.setAttribute('content', content);
    }

    function applyPwaBrand(calcMode) {
        var calc = isCalcMode(calcMode);
        var manifestHref = calc ? MANIFEST_CALC : MANIFEST_WOXIFLY;
        var title = calc ? TITLE_CALC : TITLE_WOXIFLY;

        var manifestLink = document.querySelector('link[rel="manifest"]');
        if (!manifestLink) {
            manifestLink = document.createElement('link');
            manifestLink.rel = 'manifest';
            document.head.appendChild(manifestLink);
        }
        manifestLink.href = manifestHref;

        setLinkIcon('icon', calc ? ICON_CALC : ICON_WOXIFLY, 'image/png');
        setLinkIcon('apple-touch-icon', calc ? APPLE_CALC : APPLE_WOXIFLY);
        setMeta('theme-color', calc ? THEME_CALC : THEME_WOXIFLY);
        setMeta('apple-mobile-web-app-title', title);
        setMeta('application-name', title);
    }

    window.__applyPwaBrand = applyPwaBrand;
    applyPwaBrand();
})();
