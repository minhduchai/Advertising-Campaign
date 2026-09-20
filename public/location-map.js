const assetLoads = new WeakMap();
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

/** A map survives form rerenders as long as its data-location-map key is stable. */
export function createLocationMapManager({
  document: doc = globalThis.document,
  loadLeaflet = () => loadLocalLeaflet(doc),
  tileUrl = TILE_URL,
  tileAttribution = ATTRIBUTION,
  tileTimeoutMs = 15000
} = {}) {
  const entries = new Map();
  const win = doc.defaultView ?? globalThis;
  const frame = win.requestAnimationFrame?.bind(win) ?? ((callback) => setTimeout(callback, 0));
  const Intersection = win.IntersectionObserver;
  const Resize = win.ResizeObserver;
  const intersection = Intersection ? new Intersection((changes) => {
    for (const change of changes) {
      if (!change.isIntersecting) continue;
      const entry = [...entries.values()].find((candidate) => candidate.canvas === change.target);
      if (entry) start(entry);
    }
  }) : null;

  function setStatus(entry, mode, message = '') {
    entry.mode = mode;
    entry.status.hidden = mode === 'ready';
    entry.message.textContent = message;
    entry.retry.hidden = mode !== 'error';
    entry.host.dataset.mapState = mode;
  }

  function loading(entry) {
    clearTimeout(entry.timer);
    entry.tileErrors = 0;
    setStatus(entry, 'loading', 'Đang tải bản đồ…');
    entry.timer = setTimeout(() => {
      if (!entry.disposed) setStatus(entry, 'error', 'Bản đồ tải chậm. Anh có thể thử lại hoặc mở bản đồ ngoài.');
    }, tileTimeoutMs);
  }

  function fit(entry) {
    if (!entry.map || entry.disposed) return;
    entry.map.invalidateSize({ pan: false, animate: false });
    // ResizeObserver will retry when a hidden editor becomes visible.
    if (!entry.canvas.clientWidth || !entry.canvas.clientHeight) return;
    if (entry.needsFit) {
      if (entry.settings.picker) entry.map.setView(entry.settings.center, entry.settings.zoom, { animate: false });
      else entry.map.fitBounds(entry.circle.getBounds(), { padding: [22, 22], maxZoom: 15, animate: false });
      entry.needsFit = false;
    }
  }

  function update(entry, settings) {
    const previous = entry.settings;
    entry.settings = settings;
    entry.edit.hidden = !settings.editable;
    entry.edit.textContent = entry.picking ? 'Hủy thả ghim' : settings.picker ? 'Thả ghim' : 'Đặt lại ghim';
    entry.edit.setAttribute('aria-pressed', String(entry.picking));
    entry.link.href = externalMapUrl(settings);
    entry.host.classList.toggle('is-picking', entry.picking);
    if (!previous || previous.latitude !== settings.latitude || previous.longitude !== settings.longitude || previous.radius !== settings.radius || previous.picker !== settings.picker) {
      entry.needsFit = true;
      entry.circle?.setLatLng(settings.center).setRadius(settings.radius * 1000);
      entry.marker?.setLatLng(settings.center);
    }
    const color = settings.excluded ? '#e34c68' : '#2563eb';
    entry.circle?.setStyle({ color, fillColor: color });
    entry.marker?.setStyle({ color: '#ffffff', fillColor: color });
    if (entry.map) frame(() => fit(entry));
  }

  async function start(entry) {
    if (entry.pending || entry.map || entry.disposed || !entry.settings) return;
    entry.pending = true;
    setStatus(entry, 'loading', 'Đang tải bản đồ…');
    try {
      const L = await loadLeaflet();
      if (entry.disposed) return;
      const settings = entry.settings;
      entry.map = L.map(entry.canvas, {
        center: settings.center, zoom: settings.picker ? settings.zoom : 12,
        scrollWheelZoom: false, zoomControl: true, attributionControl: true,
        zoomAnimation: false, fadeAnimation: false, minZoom: 2, maxZoom: 19
      });
      const color = settings.excluded ? '#e34c68' : '#2563eb';
      if (!settings.picker) {
        entry.circle = L.circle(settings.center, {
          radius: settings.radius * 1000, color, fillColor: color, fillOpacity: 0.13, weight: 2, interactive: false
        }).addTo(entry.map);
        entry.marker = L.circleMarker(settings.center, {
          radius: 6, color: '#ffffff', fillColor: color, fillOpacity: 1, weight: 2, interactive: false
        }).addTo(entry.map);
      }
      entry.tiles = L.tileLayer(tileUrl, {
        attribution: tileAttribution, maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
        updateWhenIdle: true, keepBuffer: 1
      });
      entry.tiles.on('loading', () => loading(entry));
      entry.tiles.on('tileerror', () => { entry.tileErrors += 1; });
      entry.tiles.on('load', () => {
        clearTimeout(entry.timer);
        if (entry.disposed) return;
        if (entry.tileErrors) setStatus(entry, 'error', 'Một phần bản đồ chưa tải được. Anh thử tải lại nhé.');
        else if (entry.picking) setStatus(entry, 'picking', 'Bấm vào bản đồ để chọn vị trí ghim.');
        else setStatus(entry, 'ready');
      });
      entry.map.on('click', (event) => {
        if (!entry.picking || !entry.settings.editable) return;
        const latitude = Number(event.latlng?.lat);
        const longitude = Number(event.latlng?.lng);
        if (!validCoordinates(latitude, longitude)) return;
        entry.picking = false;
        update(entry, entry.settings);
        setStatus(entry, 'ready');
        entry.host.dispatchEvent(new win.CustomEvent('location-map-select', {
          bubbles: true, detail: { key: entry.key, latitude, longitude }
        }));
      });
      loading(entry);
      entry.tiles.addTo(entry.map);
      frame(() => fit(entry));
      if (Resize) {
        entry.resize = new Resize(() => fit(entry));
        entry.resize.observe(entry.canvas);
      }
    } catch {
      clearTimeout(entry.timer);
      entry.map?.remove();
      entry.map = null;
      entry.tiles = null;
      entry.circle = null;
      entry.marker = null;
      if (!entry.disposed) setStatus(entry, 'error', 'Chưa tải được bản đồ. Anh thử lại hoặc mở bản đồ ngoài nhé.');
    } finally {
      entry.pending = false;
    }
  }

  function create(host, key) {
    const canvas = element(doc, 'div', 'location-map-canvas');
    const status = element(doc, 'div', 'location-map-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const message = element(doc, 'span');
    const retry = element(doc, 'button', 'location-map-retry', 'Thử lại');
    retry.type = 'button';
    retry.hidden = true;
    status.append(message, retry);
    const actions = element(doc, 'div', 'location-map-actions');
    const edit = element(doc, 'button', 'location-map-edit', 'Thả ghim');
    edit.type = 'button';
    const link = element(doc, 'a', 'location-map-link', 'Mở bản đồ');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.append(edit, link);
    const entry = { key, host, canvas, actions, status, message, retry, edit, link, disposed: false, picking: false, tileErrors: 0 };
    retry.addEventListener('click', (event) => {
      event.stopPropagation();
      if (entry.tiles) {
        loading(entry);
        entry.tiles.redraw();
      } else start(entry);
    });
    edit.addEventListener('click', (event) => {
      event.stopPropagation();
      entry.picking = !entry.picking;
      update(entry, entry.settings);
      if (entry.map && entry.mode !== 'error') setStatus(entry, entry.picking ? 'picking' : 'ready', 'Bấm vào bản đồ để chọn vị trí ghim.');
      if (entry.picking) entry.canvas.focus?.();
    });
    setStatus(entry, 'loading', 'Bản đồ sẽ hiển thị tại đây.');
    return entry;
  }

  function dispose(entry) {
    entry.disposed = true;
    clearTimeout(entry.timer);
    entry.resize?.disconnect();
    intersection?.unobserve(entry.canvas);
    entry.map?.remove();
  }

  return {
    sync(root = doc) {
      const active = new Set();
      for (const host of root.querySelectorAll('[data-location-map]')) {
        const key = host.dataset.locationMap;
        if (!key || active.has(key)) continue;
        active.add(key);
        let entry = entries.get(key);
        const settings = readLocationMapSettings(host.dataset);
        if (entry && (!settings || entry.settings?.picker !== settings.picker)) {
          dispose(entry);
          entries.delete(key);
          entry = null;
        }
        if (!settings) {
          host.textContent = 'Vị trí này chưa có tọa độ hợp lệ để hiển thị bản đồ.';
          host.dataset.mapState = 'error';
          continue;
        }
        if (!entry) {
          entry = create(host, key);
          entries.set(key, entry);
        }
        entry.host = host;
        host.dataset.mapState = entry.mode;
        if (entry.canvas.parentNode !== host) host.replaceChildren(entry.canvas, entry.actions, entry.status);
        update(entry, settings);
        if (intersection) intersection.observe(entry.canvas);
        else start(entry);
      }
      for (const [key, entry] of entries) {
        if (active.has(key)) continue;
        dispose(entry);
        entries.delete(key);
      }
    },
    destroy() {
      for (const entry of entries.values()) dispose(entry);
      entries.clear();
      intersection?.disconnect();
    }
  };
}

export function readLocationMapSettings(dataset = {}) {
  const picker = dataset.mapPicker === 'true';
  const latitude = dataset.latitude == null || dataset.latitude === '' ? (picker ? 16 : NaN) : Number(dataset.latitude);
  const longitude = dataset.longitude == null || dataset.longitude === '' ? (picker ? 106 : NaN) : Number(dataset.longitude);
  if (!validCoordinates(latitude, longitude)) return null;
  return {
    latitude, longitude, center: [latitude, longitude],
    radius: dataset.distanceUnit
      ? Math.min(dataset.distanceUnit === 'mile' ? 50 : 80, Math.max(0.01, Number(dataset.radius) || 10)) * (dataset.distanceUnit === 'mile' ? 1.609344 : 1)
      : Math.min(80, Math.max(1, Number(dataset.radius) || 10)),
    zoom: Math.min(19, Math.max(2, Number(dataset.mapZoom) || 5)),
    excluded: dataset.regionTarget === 'exclude', editable: dataset.mapEditable === 'true', picker
  };
}

function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function externalMapUrl(settings) {
  const latitude = settings.latitude.toFixed(6);
  const longitude = settings.longitude.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=${settings.picker ? settings.zoom : 13}/${latitude}/${longitude}`;
}

function element(doc, tag, className = '', text = '') {
  const node = doc.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function loadLocalLeaflet(doc) {
  if (assetLoads.has(doc)) return assetLoads.get(doc);
  const promise = Promise.all([
    loadAsset(doc, 'link', '/vendor/leaflet/leaflet.css'),
    doc.defaultView?.L ? Promise.resolve() : loadAsset(doc, 'script', '/vendor/leaflet/leaflet.js')
  ]).then(() => {
    if (!doc.defaultView?.L) throw new Error('Leaflet is unavailable');
    return doc.defaultView.L;
  }).catch((error) => {
    assetLoads.delete(doc);
    throw error;
  });
  assetLoads.set(doc, promise);
  return promise;
}

function loadAsset(doc, tag, url) {
  const previous = doc.querySelector(`[data-location-map-asset="${tag}"]`);
  if (previous?.dataset.loaded === 'true') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const node = previous ?? doc.createElement(tag);
    node.dataset.locationMapAsset = tag;
    if (tag === 'link') { node.rel = 'stylesheet'; node.href = url; }
    else { node.src = url; node.async = true; }
    let timer;
    const finish = (error) => {
      clearTimeout(timer);
      node.removeEventListener('load', onLoad);
      node.removeEventListener('error', onError);
      if (error) { node.remove(); reject(error); }
      else { node.dataset.loaded = 'true'; resolve(); }
    };
    const onLoad = () => finish();
    const onError = () => finish(new Error(`Unable to load local map ${tag}`));
    node.addEventListener('load', onLoad);
    node.addEventListener('error', onError);
    timer = setTimeout(onError, 15000);
    if (!previous) doc.head.append(node);
  });
}
