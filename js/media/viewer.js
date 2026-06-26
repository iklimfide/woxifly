import { displayMediaUrl } from './urls.js';

let historyPushed = false;

function els() {
    return {
        root: document.getElementById('mediaViewer'),
        image: document.getElementById('mediaViewerImage'),
        video: document.getElementById('mediaViewerVideo'),
        title: document.getElementById('mediaViewerTitle'),
        external: document.getElementById('mediaViewerExternal')
    };
}

export function initViewer() {
    const { root } = els();
    if (!root) return;

    document.getElementById('mediaViewerClose')?.addEventListener('click', closeViewer);
    document.getElementById('mediaViewerBack')?.addEventListener('click', closeViewer);

    root.addEventListener('click', (event) => {
        if (event.target === root || event.target.classList.contains('media-viewer-body')) {
            closeViewer();
        }
    });

    window.addEventListener('popstate', (event) => {
        if (!event.state?.mediaViewer) closeViewer(true);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && root.classList.contains('open')) closeViewer();
    });
}

export function openViewer(url, kind = 'image', mediaR2Key = null) {
    const { root, image, video, title, external } = els();
    if (!root || !url) return;

    const resolved = displayMediaUrl(url, mediaR2Key) || url;
    const isVideo = kind === 'video';

    if (image) {
        image.hidden = isVideo;
        image.src = isVideo ? '' : resolved;
    }

    if (video) {
        video.hidden = !isVideo;
        if (isVideo) {
            video.src = resolved;
            video.load();
        } else {
            video.pause();
            video.removeAttribute('src');
            video.load();
        }
    }

    if (title) title.textContent = isVideo ? 'Video önizleme' : 'Görsel önizleme';
    if (external) external.href = resolved;

    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('media-viewer-open');

    history.pushState({ mediaViewer: true }, '');
    historyPushed = true;
}

function closeViewer(fromPopstate = false) {
    const { root, image, video } = els();
    if (!root) return;

    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('media-viewer-open');

    if (image) {
        image.removeAttribute('src');
        image.hidden = false;
    }

    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.hidden = true;
    }

    if (historyPushed && !fromPopstate) {
        historyPushed = false;
        history.back();
    } else {
        historyPushed = false;
    }
}
