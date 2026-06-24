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

export const ISTANBUL_ANADOLU = 'İstanbul Anadolu';
export const ISTANBUL_AVRUPA = 'İstanbul Avrupa';
export const ABROAD_LOCATION = 'Yurtdışı';
export const DEFAULT_LOCATION = ISTANBUL_ANADOLU;
export const DEFAULT_DISTRICT = DEFAULT_LOCATION;

export const LOCATION_COORDS = {
    [ISTANBUL_ANADOLU]: { lat: 40.981857142857145, lon: 29.186857142857146 },
    [ISTANBUL_AVRUPA]: { lat: 41.05616, lon: 28.820040000000002 }
};

const LOCATION_SLUG_ALIASES = {
    [ISTANBUL_ANADOLU]: 'istanbul-anadolu',
    [ISTANBUL_AVRUPA]: 'istanbul-avrupa',
    [ABROAD_LOCATION]: 'yurtdisi'
};

const LEGACY_DISTRICT_SLUGS = {
    kadikoy: ISTANBUL_ANADOLU,
    uskudar: ISTANBUL_ANADOLU,
    besiktas: ISTANBUL_AVRUPA,
    istanbulanadolu: ISTANBUL_ANADOLU,
    istanbulavrupa: ISTANBUL_AVRUPA
};

let locationNamesCache = null;
let slugToLocationMap = new Map();

export function formatGroupRoomTitle(location) {
    return `${location} Odası`;
}

export function getLocationCoords(location) {
    if (isAbroadLocation(location)) return null;
    return LOCATION_COORDS[location] || LOCATION_COORDS[DEFAULT_LOCATION];
}

export function isAbroadLocation(location) {
    return location === ABROAD_LOCATION;
}

function ensureAbroadInLocationList(names) {
    const list = names.filter((name) => name !== ABROAD_LOCATION);
    return [ABROAD_LOCATION, ...list];
}

export const getDistrictCoords = getLocationCoords;

export function locationToRoomSlug(location) {
    if (!location) return '';
    if (LOCATION_SLUG_ALIASES[location]) return LOCATION_SLUG_ALIASES[location];
    return location
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export const districtToRoomSlug = locationToRoomSlug;

const LOCATION_SORT_PRIORITY = [
    ISTANBUL_ANADOLU,
    ISTANBUL_AVRUPA,
    'Ankara',
    'İzmir',
    'Antalya',
    'Bursa'
];

function sortLocationNames(names) {
    return [...names].sort((a, b) => {
        const ai = LOCATION_SORT_PRIORITY.indexOf(a);
        const bi = LOCATION_SORT_PRIORITY.indexOf(b);
        if (ai !== -1 || bi !== -1) {
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        }
        return a.localeCompare(b, 'tr');
    });
}

export function registerLocationSlugs(locations) {
    slugToLocationMap = new Map(
        (locations || []).map((location) => [locationToRoomSlug(location), location])
    );
    for (const [slug, location] of Object.entries(LEGACY_DISTRICT_SLUGS)) {
        slugToLocationMap.set(slug, location);
    }
}

export function roomSlugToLocation(slug) {
    if (!slug) return null;
    return slugToLocationMap.get(slug.toLowerCase()) || null;
}

export const roomSlugToDistrict = roomSlugToLocation;

export async function loadLocations(client) {
    if (!client) throw new Error('loadLocations requires a Supabase client');
    const { data, error } = await client
        .from('district_coordinates')
        .select('district,latitude,longitude')
        .order('district');
    if (error) throw error;

    const names = ensureAbroadInLocationList(
        sortLocationNames((data || []).map((row) => row.district))
    );
    locationNamesCache = names;
    for (const row of data || []) {
        LOCATION_COORDS[row.district] = { lat: row.latitude, lon: row.longitude };
    }
    registerLocationSlugs(names);
    return names;
}

export function populateLocationSelect(selectEl, selectedValue = DEFAULT_LOCATION) {
    if (!selectEl) return;
    const base = locationNamesCache?.length
        ? locationNamesCache
        : ensureAbroadInLocationList(LOCATION_SORT_PRIORITY);
    const names = ensureAbroadInLocationList(base);
    const current = selectedValue || selectEl.value || DEFAULT_LOCATION;
    selectEl.innerHTML = '';
    for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (name === current) opt.selected = true;
        selectEl.appendChild(opt);
    }
}

export const populateDistrictSelect = populateLocationSelect;

export const MESSAGE_HISTORY_LIMIT = 20;
