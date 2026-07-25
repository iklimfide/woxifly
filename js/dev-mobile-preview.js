/**
 * Yerel geliştirmede masaüstünden mobil görünüm (iframe). WoxiBulkSave DevMobilePreview ile aynı fikir.
 */

const STORAGE_KEY = 'woxifly-dev-mobile-preview';
const EMBED_PARAM = '__mobile_preview';

const DEVICES = [
    { id: 'iphone-se', label: 'iPhone SE', width: 375 },
    { id: 'iphone-14', label: 'iPhone 14', width: 390 },
    { id: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max', width: 430 }
];

function isDevEnvironment() {
    const h = window.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

function isEmbedMode() {
    return new URLSearchParams(window.location.search).get(EMBED_PARAM) === '1';
}

function readStoredState() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { open: false, deviceId: 'iphone-14' };
        const parsed = JSON.parse(raw);
        return {
            open: Boolean(parsed.open),
            deviceId: DEVICES.some((d) => d.id === parsed.deviceId) ? parsed.deviceId : 'iphone-14'
        };
    } catch {
        return { open: false, deviceId: 'iphone-14' };
    }
}

function persistState(open, deviceId) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ open, deviceId }));
}

function buildIframeSrc() {
    const params = new URLSearchParams(window.location.search);
    params.set(EMBED_PARAM, '1');
    const qs = params.toString();
    const path = window.location.pathname || '/';
    return `${path}?${qs}`;
}

function ensureStyles() {
    if (document.getElementById('dev-mobile-preview-styles')) return;
    const style = document.createElement('style');
    style.id = 'dev-mobile-preview-styles';
    style.textContent = `
        .dev-mobile-preview-toggle {
            position: fixed;
            bottom: 16px;
            left: 16px;
            right: auto;
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 8px;
            border: none;
            border-radius: 999px;
            padding: 10px 16px;
            font-size: 0.875rem;
            font-weight: 600;
            font-family: inherit;
            color: #fff;
            background: #0f172a;
            box-shadow: 0 10px 25px rgba(15, 23, 42, 0.25);
            cursor: pointer;
        }
        .dev-mobile-preview-toggle:hover { background: #1e293b; }
        .dev-mobile-preview-toggle:active { transform: scale(0.98); }
        .dev-mobile-preview-panel {
            position: fixed;
            top: 16px;
            right: 16px;
            left: auto;
            bottom: 16px;
            z-index: 9999;
            width: min(calc(100vw - 32px), 28rem);
            max-width: 28rem;
            margin-left: auto;
            display: flex;
            flex-direction: column;
            padding: 12px;
            border-radius: 2rem;
            border: 1px solid #cbd5e1;
            background: #f1f5f9;
            box-shadow: 0 25px 50px rgba(15, 23, 42, 0.2);
        }
        .dev-mobile-preview-panel[hidden] { display: none !important; }
        .dev-mobile-preview-panel__head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px;
            padding: 0 4px 12px;
        }
        .dev-mobile-preview-panel__title {
            margin: 0;
            font-size: 0.7rem;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #64748b;
        }
        .dev-mobile-preview-panel__subtitle {
            margin: 2px 0 0;
            font-size: 0.875rem;
            font-weight: 600;
            color: #1e293b;
        }
        .dev-mobile-preview-panel__close {
            border: none;
            background: transparent;
            border-radius: 8px;
            padding: 4px 8px;
            font-size: 1rem;
            color: #475569;
            cursor: pointer;
        }
        .dev-mobile-preview-panel__close:hover { background: #fff; }
        .dev-mobile-preview-panel__label {
            display: block;
            padding: 0 4px 12px;
            font-size: 0.75rem;
            font-weight: 500;
            color: #475569;
        }
        .dev-mobile-preview-panel__select {
            display: block;
            width: 100%;
            margin-top: 4px;
            padding: 8px 12px;
            border-radius: 8px;
            border: 1px solid #cbd5e1;
            background: #fff;
            font-size: 0.875rem;
            font-family: inherit;
        }
        .dev-mobile-preview-panel__frame-wrap {
            flex: 1;
            min-height: 0;
            display: flex;
            justify-content: center;
            overflow: hidden;
            padding: 8px;
            border-radius: 1.5rem;
            border: 1px solid #cbd5e1;
            background: #fff;
        }
        .dev-mobile-preview-panel__device {
            height: 100%;
            overflow: hidden;
            border-radius: 1.25rem;
            border: 1px solid #e2e8f0;
            box-shadow: inset 0 2px 8px rgba(15, 23, 42, 0.06);
            background: #fff;
        }
        .dev-mobile-preview-panel__iframe {
            display: block;
            width: 100%;
            height: 100%;
            border: 0;
            background: #fff;
        }
        .dev-mobile-preview-panel__hint {
            margin: 12px 4px 0;
            font-size: 11px;
            line-height: 1.4;
            text-align: center;
            color: #64748b;
        }
        html.dev-mobile-preview-host .dev-mobile-preview-toggle {
            bottom: 16px;
            left: 16px;
            right: auto;
        }
        html.dev-mobile-preview-host .dev-mobile-preview-panel {
            right: 16px;
            left: auto;
        }
        @media (max-width: 768px) {
            .dev-mobile-preview-toggle,
            .dev-mobile-preview-panel { display: none !important; }
        }
    `;
    document.head.appendChild(style);
}

export function initDevMobilePreview() {
    if (!isDevEnvironment() || isEmbedMode()) return;

    ensureStyles();
    document.documentElement.classList.add('dev-mobile-preview-host');

    const stored = readStoredState();
    let open = stored.open;
    let deviceId = stored.deviceId;

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'dev-mobile-preview-toggle';
    toggleBtn.setAttribute('aria-controls', 'devMobilePreviewPanel');
    toggleBtn.title = 'Mobil tasarım önizlemesini aç/kapat';

    const panel = document.createElement('aside');
    panel.id = 'devMobilePreviewPanel';
    panel.className = 'dev-mobile-preview-panel';
    panel.setAttribute('aria-label', 'Mobil tasarım önizlemesi');
    panel.hidden = !open;

    panel.innerHTML = `
        <div class="dev-mobile-preview-panel__head">
            <div>
                <p class="dev-mobile-preview-panel__title">Dev only</p>
                <p class="dev-mobile-preview-panel__subtitle">Mobil önizleme</p>
            </div>
            <button type="button" class="dev-mobile-preview-panel__close" aria-label="Mobil önizlemeyi kapat">✕</button>
        </div>
        <label class="dev-mobile-preview-panel__label">
            Cihaz
            <select class="dev-mobile-preview-panel__select"></select>
        </label>
        <div class="dev-mobile-preview-panel__frame-wrap">
            <div class="dev-mobile-preview-panel__device">
                <iframe class="dev-mobile-preview-panel__iframe" title="Mobil önizleme"></iframe>
            </div>
        </div>
        <p class="dev-mobile-preview-panel__hint">Gerçek mobil breakpoint'leri için iframe kullanılır. Rota değişince önizleme güncellenir.</p>
    `;

    const select = panel.querySelector('.dev-mobile-preview-panel__select');
    const deviceWrap = panel.querySelector('.dev-mobile-preview-panel__device');
    const iframe = panel.querySelector('.dev-mobile-preview-panel__iframe');
    const closeBtn = panel.querySelector('.dev-mobile-preview-panel__close');

    for (const d of DEVICES) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.label} (${d.width}px)`;
        select.appendChild(opt);
    }
    select.value = deviceId;

    function getDevice() {
        return DEVICES.find((d) => d.id === deviceId) || DEVICES[1];
    }

    function syncToggleLabel() {
        toggleBtn.innerHTML = open
            ? '<span aria-hidden="true">📱</span> Mobil önizlemeyi kapat'
            : '<span aria-hidden="true">📱</span> Mobil önizleme';
        toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function refreshIframe() {
        const device = getDevice();
        deviceWrap.style.width = `${device.width}px`;
        deviceWrap.style.maxWidth = '100%';
        iframe.style.width = `${device.width}px`;
        iframe.style.maxWidth = '100%';
        iframe.title = `Mobil önizleme - ${device.label}`;
        iframe.src = buildIframeSrc();
    }

    function setOpen(next) {
        open = next;
        panel.hidden = !open;
        syncToggleLabel();
        persistState(open, deviceId);
        if (open) refreshIframe();
    }

    toggleBtn.addEventListener('click', () => setOpen(!open));
    closeBtn.addEventListener('click', () => setOpen(false));
    select.addEventListener('change', () => {
        deviceId = select.value;
        persistState(open, deviceId);
        if (open) refreshIframe();
    });

    let lastPath = `${window.location.pathname}${window.location.search}`;
    const syncOnRouteChange = () => {
        const next = `${window.location.pathname}${window.location.search}`;
        if (!open || next === lastPath) return;
        lastPath = next;
        refreshIframe();
    };

    window.addEventListener('popstate', syncOnRouteChange);
    const origReplace = history.replaceState.bind(history);
    const origPush = history.pushState.bind(history);
    history.replaceState = (...args) => {
        origReplace(...args);
        syncOnRouteChange();
    };
    history.pushState = (...args) => {
        origPush(...args);
        syncOnRouteChange();
    };

    syncToggleLabel();
    document.body.append(panel, toggleBtn);
    if (open) refreshIframe();
}
