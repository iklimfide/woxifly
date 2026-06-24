import { ABROAD_LOCATION, isAbroadLocation } from './config.js';
import { sanitizeText } from './utils.js';

export { ABROAD_LOCATION, isAbroadLocation };

export function readAbroadCityInput(inputEl) {
    if (!inputEl) return null;
    const value = sanitizeText(inputEl.value, 80);
    return value || null;
}

export function syncAbroadCityField(selectEl, wrapEl, inputEl) {
    if (!selectEl || !wrapEl) return;
    const abroad = isAbroadLocation(selectEl.value);
    wrapEl.hidden = !abroad;
    if (!abroad && inputEl) {
        inputEl.value = '';
    }
}

export function initAbroadCityField({ selectEl, wrapEl, inputEl, initialDistrict = null, initialCity = null }) {
    if (!selectEl || !wrapEl) return;

    if (initialDistrict && selectEl.querySelector(`option[value="${initialDistrict}"]`)) {
        selectEl.value = initialDistrict;
    }

    if (inputEl && initialCity) {
        inputEl.value = initialCity;
    }

    const sync = () => syncAbroadCityField(selectEl, wrapEl, inputEl);
    if (!selectEl.dataset.abroadBound) {
        selectEl.dataset.abroadBound = '1';
        selectEl.addEventListener('change', sync);
    }

    sync();
}

export function formatRadarDistanceLabel(user) {
    const district = user?.district || '';
    if (user?.distance_km == null || district.startsWith(ABROAD_LOCATION)) {
        return `📍 ${district || ABROAD_LOCATION}`;
    }
    if (user.distance_km === 0) {
        return `📍 Aynı konum · ${district}`;
    }
    return `📍 ${user.distance_km} km · ${district}`;
}
