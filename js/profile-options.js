export const PROFILE_UNSET = '';

export const LOCATION_OPTIONS = [
    { label: '🌍 Yurtdışı', value: 'Yurtdışı' },
    { label: 'İstanbul Avrupa', value: 'İstanbul Avrupa' },
    { label: 'İstanbul Anadolu', value: 'İstanbul Anadolu' },
    { label: 'Ankara', value: 'Ankara' },
    { label: 'İzmir', value: 'İzmir' },
    'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Antalya', 'Ardahan',
    'Artvin', 'Aydın', 'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl', 'Bitlis',
    'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Düzce',
    'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane',
    'Hakkari', 'Hatay', 'Iğdır', 'Isparta', 'Kahramanmaraş', 'Karabük', 'Karaman', 'Kars', 'Kastamonu',
    'Kayseri', 'Kırıkkale', 'Kırklareli', 'Kırşehir', 'Kilis', 'Kocaeli', 'Konya', 'Kütahya',
    'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla', 'Muş', 'Nevşehir', 'Niğde', 'Ordu',
    'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Şanlıurfa', 'Şırnak',
    'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak'
].map((item) => (
    typeof item === 'string' ? { label: item, value: item } : item
));

export const JOB_OPTION_GROUPS = [
    {
        label: 'Standart',
        options: [
            { label: '💻 Yazılım Geliştirici', value: '💻 Yazılım Geliştirici' },
            { label: '🎓 Öğrenci', value: '🎓 Öğrenci' },
            { label: '👷 Mühendis', value: '👷 Mühendis' },
            { label: 'Doktor', value: 'Doktor' },
            { label: 'Öğretmen', value: 'Öğretmen' },
            { label: 'Avukat', value: 'Avukat' },
            { label: '🎨 Tasarımcı', value: '🎨 Tasarımcı' },
            { label: '💼 Serbest Meslek', value: '💼 Serbest Meslek' }
        ]
    },
    {
        label: 'Woxi Mood',
        options: [
            { label: '🛌 Profesyonel Uykucu', value: '🛌 Profesyonel Uykucu' },
            { label: '☕ Kahve Tadımcısı', value: '☕ Kahve Tadımcısı' },
            { label: '🦄 Hayalperest', value: '🦄 Hayalperest' },
            { label: '🐱 Kedi Ebeveyni', value: '🐱 Kedi Ebeveyni' },
            { label: '🎮 Oyun Bağımlısı', value: '🎮 Oyun Bağımlısı' },
            { label: '🎬 Dizi/Film Gurmesi', value: '🎬 Dizi/Film Gurmesi' }
        ]
    }
];

export const MARITAL_OPTION_GROUPS = [
    {
        label: 'Standart',
        options: [
            { label: 'Bekar', value: 'Bekar' },
            { label: 'İlişkisi Var', value: 'İlişkisi Var' },
            { label: 'Nişanlı', value: 'Nişanlı' },
            { label: 'Evli', value: 'Evli' }
        ]
    },
    {
        label: 'Woxi Mood',
        options: [
            { label: '🧩 Karmaşık', value: '🧩 Karmaşık' },
            { label: '🧘 Nadasa Bıraktım', value: '🧘 Nadasa Bıraktım' },
            { label: '👑 Yalnızlık Sultanlıktır', value: '👑 Yalnızlık Sultanlıktır' },
            { label: '❄️ Kronik Bekar', value: '❄️ Kronik Bekar' },
            { label: '🔒 Adaylara Kapalı', value: '🔒 Adaylara Kapalı' },
            { label: '🧐 Kimin sorduğuna bağlı', value: '🧐 Kimin sorduğuna bağlı' }
        ]
    }
];

const UNSET_LABEL = 'Belirtmek istemiyorum';

function appendOption(select, { label, value }) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
}

export function populateFlatSelect(select, options, { includeUnset = true } = {}) {
    if (!select) return;
    select.replaceChildren();
    if (includeUnset) {
        appendOption(select, { label: UNSET_LABEL, value: PROFILE_UNSET });
    }
    options.forEach((item) => appendOption(select, item));
}

export function populateGroupedSelect(select, groups, { includeUnset = true } = {}) {
    if (!select) return;
    select.replaceChildren();
    if (includeUnset) {
        appendOption(select, { label: UNSET_LABEL, value: PROFILE_UNSET });
    }
    groups.forEach((group) => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.label;
        group.options.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.value;
            option.textContent = item.label;
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    });
}

export function initProfileDetailSelects() {
    populateFlatSelect(document.getElementById('profileLocationInput'), LOCATION_OPTIONS);
    populateGroupedSelect(document.getElementById('profileJobInput'), JOB_OPTION_GROUPS);
    populateGroupedSelect(document.getElementById('profileMaritalInput'), MARITAL_OPTION_GROUPS);
}

export function readProfileDetailFields() {
    const aboutRaw = document.getElementById('profileAboutInput')?.value ?? '';
    const about = aboutRaw.trim();
    const location = document.getElementById('profileLocationInput')?.value ?? PROFILE_UNSET;
    const job = document.getElementById('profileJobInput')?.value ?? PROFILE_UNSET;
    const marital = document.getElementById('profileMaritalInput')?.value ?? PROFILE_UNSET;

    return {
        about_me: about || null,
        home_location: location || null,
        job: job || null,
        marital_status: marital || null,
        aboutRaw: about
    };
}

function setSelectValue(select, value) {
    if (!select) return;
    const normalized = value || PROFILE_UNSET;
    if (normalized !== PROFILE_UNSET && !Array.from(select.options).some((option) => option.value === normalized)) {
        appendOption(select, { label: normalized, value: normalized });
    }
    select.value = normalized;
}

export function applyProfileDetailFields({ about_me, home_location, job, marital_status } = {}) {
    const aboutEl = document.getElementById('profileAboutInput');
    const locationEl = document.getElementById('profileLocationInput');
    const jobEl = document.getElementById('profileJobInput');
    const maritalEl = document.getElementById('profileMaritalInput');

    if (aboutEl) aboutEl.value = about_me || '';
    setSelectValue(locationEl, home_location);
    setSelectValue(jobEl, job);
    setSelectValue(maritalEl, marital_status);
}

export function validateProfileAbout(about) {
    if (!about) return null;
    if (about.length < 5 || about.length > 160) {
        return 'Hakkımda 5–160 karakter olmalıdır.';
    }
    return null;
}
