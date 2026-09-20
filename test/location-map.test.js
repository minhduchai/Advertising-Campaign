import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLocationMapManager, readLocationMapSettings } from '../public/location-map.js';

test('validates geographic coordinates and normalizes radius in kilometers', () => {
  assert.equal(readLocationMapSettings({ latitude: '', longitude: '' }), null);
  assert.equal(readLocationMapSettings({ latitude: '91', longitude: '106' }), null);
  assert.equal(readLocationMapSettings({ latitude: '10', longitude: '181' }), null);
  assert.equal(readLocationMapSettings({ latitude: '10', longitude: 'NaN' }), null);
  assert.equal(readLocationMapSettings({ latitude: '0', longitude: '0', radius: '500' }).radius, 80);
  assert.equal(readLocationMapSettings({ latitude: '10', longitude: '106', radius: '-2' }).radius, 1);
  assert.deepEqual(readLocationMapSettings({ mapPicker: 'true' }).center, [16, 106]);
});

test('preserves map, tiles, and pan position across parent rerenders; fits only changed radius', async (t) => {
  const harness = makeHarness();
  t.after(() => harness.manager.destroy());
  const first = harness.host({ radius: '10' });
  harness.sync(first);
  await flush();
  assert.equal(harness.maps.length, 1);
  assert.equal(harness.circles[0].options.radius, 10000);
  assert.deepEqual(harness.maps[0].options.center, [10.8, 106.7]);
  const canvas = first.children[0];
  assert.equal(harness.maps[0].fitCount, 1);
  harness.tiles[0].emit('load');
  const second = harness.host({ radius: '10' });
  harness.sync(second);
  await flush();
  assert.equal(second.children[0], canvas);
  assert.equal(harness.maps.length, 1);
  assert.equal(harness.tiles.length, 1);
  assert.equal(harness.maps[0].fitCount, 1, 'typing elsewhere must not reset map view');
  const third = harness.host({ radius: '23', regionTarget: 'exclude' });
  harness.sync(third);
  assert.equal(harness.circles[0].radius, 23000);
  assert.equal(harness.circles[0].style.color, '#e34c68');
  assert.equal(harness.maps[0].fitCount, 2);
  assert.equal(harness.maps[0].removed, undefined);
});

test('shows tile errors and a retry that recovers without replacing the map', async (t) => {
  const harness = makeHarness();
  t.after(() => harness.manager.destroy());
  const host = harness.host();
  harness.sync(host);
  await flush();
  const status = host.children[2];
  harness.tiles[0].emit('tileerror');
  harness.tiles[0].emit('load');
  assert.equal(host.dataset.mapState, 'error');
  assert.equal(status.hidden, false);
  assert.equal(status.children[1].hidden, false);
  assert.match(status.children[0].textContent, /chưa tải được/);
  status.children[1].emit('click');
  assert.equal(harness.tiles[0].redrawCount, 1);
  assert.equal(host.dataset.mapState, 'loading');
  harness.tiles[0].emit('load');
  assert.equal(host.dataset.mapState, 'ready');
  assert.equal(status.hidden, true);
  assert.equal(harness.maps.length, 1);
  assert.equal(harness.tiles[0].url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(harness.tiles[0].options.referrerPolicy, 'strict-origin-when-cross-origin');
  assert.match(harness.tiles[0].options.attribution, /openstreetmap.org\/copyright/);
});

test('timed-out tiles show a usable retry instead of an endless loading indicator', async (t) => {
  const harness = makeHarness({ tileTimeoutMs: 5 });
  t.after(() => harness.manager.destroy());
  const host = harness.host();
  harness.sync(host);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(host.dataset.mapState, 'error');
  assert.equal(host.children[2].children[1].hidden, false);
});

test('picker has no false radius overlay and places a pin only after user arms it', async (t) => {
  const harness = makeHarness();
  t.after(() => harness.manager.destroy());
  const host = harness.host({ locationMap: 'picker', mapPicker: 'true', mapEditable: 'true' });
  harness.sync(host);
  await flush();
  assert.equal(harness.circles.length, 0);
  assert.equal(harness.markers.length, 0);
  harness.maps[0].emit('click', { latlng: { lat: 10.9, lng: 106.8 } });
  assert.equal(host.events.length, 0);
  const button = host.children[1].children[0];
  assert.equal(button.textContent, 'Thả ghim');
  button.emit('click');
  assert.equal(button.attributes['aria-pressed'], 'true');
  harness.maps[0].emit('click', { latlng: { lat: 10.9, lng: 106.8 } });
  assert.equal(host.events.length, 1);
  assert.equal(host.events[0].type, 'location-map-select');
  assert.deepEqual(host.events[0].detail, { key: 'picker', latitude: 10.9, longitude: 106.8 });
  assert.equal(button.attributes['aria-pressed'], 'false');
  assert.equal(host.events[0].bubbles, true);
});

test('async asset load cannot mount maps removed by later renders', async (t) => {
  let resolveLoader;
  const harness = makeHarness({ pendingLoader: (leaflet) => new Promise((resolve) => { resolveLoader = () => resolve(leaflet); }) });
  t.after(() => harness.manager.destroy());
  harness.sync(harness.host());
  harness.sync();
  resolveLoader();
  await flush();
  assert.equal(harness.maps.length, 0);
});

test('only visible maps load tiles and hidden editors fit when resized into view', async (t) => {
  const harness = makeHarness({ useObservers: true });
  t.after(() => harness.manager.destroy());
  const host = harness.host();
  harness.sync(host);
  await flush();
  assert.equal(harness.maps.length, 0);
  const canvas = host.children[0];
  canvas.clientWidth = 0;
  canvas.clientHeight = 0;
  harness.intersections[0].notify([{ target: canvas, isIntersecting: true }]);
  await flush();
  assert.equal(harness.maps.length, 1);
  assert.equal(harness.maps[0].fitCount, 0);
  canvas.clientWidth = 700;
  canvas.clientHeight = 260;
  harness.resizes[0].notify();
  assert.equal(harness.maps[0].fitCount, 1);
});

test('local library load failure can be retried', async (t) => {
  let attempts = 0;
  const harness = makeHarness({ pendingLoader: (leaflet) => ++attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(leaflet) });
  t.after(() => harness.manager.destroy());
  const host = harness.host();
  harness.sync(host);
  await flush();
  assert.equal(host.dataset.mapState, 'error');
  assert.equal(harness.maps.length, 0);
  host.children[2].children[1].emit('click');
  await flush();
  assert.equal(harness.maps.length, 1);
  harness.tiles[0].emit('load');
  assert.equal(host.dataset.mapState, 'ready');
});

test('removed locations release map resources', async (t) => {
  const harness = makeHarness();
  t.after(() => harness.manager.destroy());
  harness.sync(harness.host());
  await flush();
  harness.sync();
  assert.equal(harness.maps[0].removed, true);
});

test('map library is served locally with its stylesheet and license', async () => {
  const [script, style, license] = await Promise.all([
    readFile(new URL('../public/vendor/leaflet/leaflet.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/vendor/leaflet/leaflet.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/vendor/leaflet/LICENSE', import.meta.url), 'utf8')
  ]);
  assert.match(script, /Leaflet 1\.9\.4/);
  assert.match(style, /\.leaflet-container/);
  assert.match(license, /Copyright/);
});

function makeHarness({ pendingLoader, tileTimeoutMs, useObservers } = {}) {
  const maps = [];
  const circles = [];
  const markers = [];
  const tiles = [];
  const intersections = [];
  const resizes = [];
  const leaflet = {
    map(canvas, options) {
      const map = emitter({
        canvas, options, fitCount: 0,
        invalidateSize() {},
        fitBounds() { this.fitCount += 1; },
        setView(center, zoom) { this.center = center; this.zoom = zoom; },
        remove() { this.removed = true; }
      });
      maps.push(map);
      return map;
    },
    circle(center, options) {
      const circle = layer(center, options);
      circles.push(circle);
      return circle;
    },
    circleMarker(center, options) {
      const marker = layer(center, options);
      markers.push(marker);
      return marker;
    },
    tileLayer(url, options) {
      const tile = emitter({ url, options, redrawCount: 0, addTo(map) { this.map = map; return this; }, redraw() { this.redrawCount += 1; } });
      tiles.push(tile);
      return tile;
    }
  };
  const doc = {
    defaultView: {
      requestAnimationFrame(callback) { callback(); },
      CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } }
    },
    createElement() { return fakeElement(); }
  };
  if (useObservers) {
    doc.defaultView.IntersectionObserver = class {
      constructor(notify) { this.notify = notify; intersections.push(this); }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    doc.defaultView.ResizeObserver = class {
      constructor(notify) { this.notify = notify; resizes.push(this); }
      observe() {}
      disconnect() {}
    };
  }
  const manager = createLocationMapManager({ document: doc, loadLeaflet: () => pendingLoader ? pendingLoader(leaflet) : Promise.resolve(leaflet), tileTimeoutMs });
  return {
    manager, maps, circles, markers, tiles, intersections, resizes,
    host(overrides = {}) { return fakeElement({ locationMap: 'adset:include:pin', latitude: '10.8', longitude: '106.7', radius: '10', ...overrides }); },
    sync(...hosts) { manager.sync({ querySelectorAll: () => hosts }); }
  };
}

function fakeElement(dataset = {}) {
  return emitter({
    dataset, children: [], attributes: {}, events: [], clientWidth: 700, clientHeight: 260,
    classList: { toggle() {} },
    setAttribute(key, value) { this.attributes[key] = value; },
    append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } },
    replaceChildren(...children) { this.children = []; this.append(...children); },
    addEventListener(event, handler) { this.on(event, handler); },
    dispatchEvent(event) { this.events.push(event); },
    focus() {}
  });
}

function emitter(object) {
  const handlers = {};
  object.on = (event, handler) => { handlers[event] = handler; return object; };
  object.emit = (event, data = {}) => handlers[event]?.({ stopPropagation() {}, ...data });
  return object;
}

function layer(center, options) {
  return {
    center, options,
    addTo(map) { this.map = map; return this; },
    setLatLng(value) { this.center = value; return this; },
    setRadius(value) { this.radius = value; return this; },
    setStyle(value) { this.style = value; return this; },
    getBounds() { return this.center; }
  };
}

function flush() { return new Promise((resolve) => setImmediate(resolve)); }
