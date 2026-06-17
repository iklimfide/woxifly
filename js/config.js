import {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    R2_ACCOUNT_ID,
    R2_ENDPOINT,
    R2_BUCKET_NAME,
    R2_PUBLIC_BASE_URL
} from '../shared/public-config.js';

export {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    R2_ACCOUNT_ID,
    R2_ENDPOINT,
    R2_BUCKET_NAME,
    R2_PUBLIC_BASE_URL
};

export const CITY_NAME = 'İstanbul';
export const DEFAULT_DISTRICT = 'Kadıköy';

export const DISTRICT_COORDS = {
    Adalar: { lat: 40.874, lon: 29.094 },
    Arnavutköy: { lat: 41.183, lon: 28.739 },
    Ataşehir: { lat: 40.983, lon: 29.124 },
    Avcılar: { lat: 40.979, lon: 28.722 },
    Bağcılar: { lat: 41.039, lon: 28.856 },
    Bahçelievler: { lat: 41.002, lon: 28.859 },
    Bakırköy: { lat: 40.978, lon: 28.874 },
    Başakşehir: { lat: 41.093, lon: 28.802 },
    Bayrampaşa: { lat: 41.039, lon: 28.914 },
    Beşiktaş: { lat: 41.042, lon: 29.007 },
    Beykoz: { lat: 41.143, lon: 29.091 },
    Beylikdüzü: { lat: 41.002, lon: 28.642 },
    Beyoğlu: { lat: 41.037, lon: 28.985 },
    Büyükçekmece: { lat: 41.021, lon: 28.585 },
    Çatalca: { lat: 41.143, lon: 28.461 },
    Çekmeköy: { lat: 41.033, lon: 29.178 },
    Esenler: { lat: 41.043, lon: 28.876 },
    Esenyurt: { lat: 41.034, lon: 28.680 },
    Eyüpsultan: { lat: 41.171, lon: 28.934 },
    Fatih: { lat: 41.019, lon: 28.940 },
    Gaziosmanpaşa: { lat: 41.064, lon: 28.913 },
    Güngören: { lat: 41.025, lon: 28.872 },
    Kadıköy: { lat: 40.991, lon: 29.028 },
    Kağıthane: { lat: 41.080, lon: 28.975 },
    Kartal: { lat: 40.906, lon: 29.187 },
    Küçükçekmece: { lat: 41.000, lon: 28.799 },
    Maltepe: { lat: 40.934, lon: 29.147 },
    Pendik: { lat: 40.878, lon: 29.234 },
    Sancaktepe: { lat: 41.002, lon: 29.230 },
    Sarıyer: { lat: 41.168, lon: 29.057 },
    Silivri: { lat: 41.073, lon: 28.247 },
    Sultanbeyli: { lat: 40.960, lon: 29.264 },
    Sultangazi: { lat: 41.106, lon: 28.868 },
    Şile: { lat: 41.176, lon: 29.613 },
    Şişli: { lat: 41.060, lon: 28.987 },
    Tuzla: { lat: 40.817, lon: 29.300 },
    Ümraniye: { lat: 41.025, lon: 29.110 },
    Üsküdar: { lat: 41.024, lon: 29.016 },
    Zeytinburnu: { lat: 41.003, lon: 28.907 }
};

export const DISTRICTS = Object.keys(DISTRICT_COORDS).sort((a, b) => a.localeCompare(b, 'tr'));

export const DISTRICT_ROOM_SLUGS = {
    Kadıköy: 'kadikoy',
    Üsküdar: 'uskudar',
    Beşiktaş: 'besiktas'
};

export function districtToRoomSlug(district) {
    return DISTRICT_ROOM_SLUGS[district] || district
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, '');
}

export function getDistrictCoords(district) {
    return DISTRICT_COORDS[district] || DISTRICT_COORDS[DEFAULT_DISTRICT];
}

export function populateDistrictSelect(selectEl, selectedValue = DEFAULT_DISTRICT) {
    if (!selectEl) return;
    const current = selectedValue || selectEl.value || DEFAULT_DISTRICT;
    selectEl.innerHTML = '';
    for (const district of DISTRICTS) {
        const opt = document.createElement('option');
        opt.value = district;
        opt.textContent = district;
        if (district === current) opt.selected = true;
        selectEl.appendChild(opt);
    }
}

export const MESSAGE_HISTORY_LIMIT = 20;
