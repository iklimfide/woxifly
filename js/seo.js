import {
    SITE_URL,
    SITE_NAME,
    SITE_DESCRIPTION,
    SITE_OG_IMAGE,
    CALC_TITLE,
    CALC_DESCRIPTION
} from '../shared/seo-config.js';

function setMeta(attr, key, value) {
    const el = document.querySelector(`meta[${attr}="${key}"]`);
    if (el) el.setAttribute('content', value);
}

export function applySiteSeo(calculatorMode = false) {
    const title = calculatorMode ? CALC_TITLE : SITE_NAME;
    const description = calculatorMode ? CALC_DESCRIPTION : SITE_DESCRIPTION;
    const robots = calculatorMode ? 'noindex, nofollow' : 'index, follow';

    document.title = title;
    setMeta('name', 'description', description);
    setMeta('name', 'robots', robots);
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);

    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) {
        appleTitle.setAttribute('content', calculatorMode ? CALC_TITLE : SITE_NAME);
    }
}

export function initSeo() {
    const calculatorMode = localStorage.getItem('hm_perde') === 'true';
    applySiteSeo(calculatorMode);
}
