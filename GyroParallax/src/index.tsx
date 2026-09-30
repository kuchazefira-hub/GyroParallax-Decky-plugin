import { definePlugin, ServerAPI, staticClasses } from 'decky-frontend-lib';
// Required even though it's never referenced by name below: tsconfig.json
// uses the classic "react" JSX transform, which compiles every <Tag/> into
// a React.createElement(...) call and therefore needs `React` in scope in
// every file that contains JSX.
import * as React from 'react';
import { VFC } from 'react';
import * as ReactDOM from 'react-dom';

import { ParallaxOverlay, ParallaxOverlayHandle } from './components/ParallaxOverlay';
import { SettingsPanel } from './components/SettingsPanel';
import { Backend } from './hooks/backend';
import { DEFAULT_PROFILE } from './profiles/presets';
import { PluginState } from './state';
import { startGyroLoop } from './gyro/useGyro';
import './styles/overlay.css';

// Matches both the library "game details" page and its Big Picture / Game
// Mode equivalent. We deliberately detect the current page from
// window.location rather than by walking Steam's internal React tree:
// SPA navigation in the Steam client already updates the URL, and reading
// that is far more resilient to Steam client UI changes than depending on
// the exact shape of Valve's own components (which *will* change across
// SteamOS updates and has broken many tree-patching plugins in the past).
const GAME_PAGE_RE = /\/(?:library\/app|appdetails)\/(\d+)/;

function detectAppId(): string | null {
  const match = window.location.pathname.match(GAME_PAGE_RE) || window.location.hash.match(GAME_PAGE_RE);
  return match ? match[1] : null;
}

export default definePlugin((serverApi: ServerAPI) => {
  const state = new PluginState();

  // --- Mount the overlay into its own top-level container -----------------
  const container = document.createElement('div');
  container.id = 'gyroparallax-overlay-container';
  document.body.appendChild(container);

  let overlayHandle: ParallaxOverlayHandle = { background: null, middle: null, foreground: null, logo: null };
  let overlayVisible = false;
  let overlayImages: { background: string | null; foreground: string | null; logo: string | null } = {
    background: null, foreground: null, logo: null,
  };

  // Steam's current client ships React 18, whose 'react-dom' no longer
  // exposes the legacy .render()/.unmountComponentAtNode() API - mounting
  // now goes through ReactDOM.createRoot(). Support both so this keeps
  // working regardless of which React version it's built/loaded against.
  const RD: any = ReactDOM;
  let reactRoot: { render: (el: any) => void; unmount: () => void } | null = null;
  function mountOverlay(element: JSX.Element) {
    if (typeof RD.createRoot === 'function') {
      if (!reactRoot) reactRoot = RD.createRoot(container);
      reactRoot!.render(element);
    } else if (typeof RD.render === 'function') {
      RD.render(element, container);
    }
  }
  function unmountOverlay() {
    if (reactRoot) {
      reactRoot.unmount();
    } else if (typeof RD.unmountComponentAtNode === 'function') {
      RD.unmountComponentAtNode(container);
    }
  }

  function renderOverlay() {
    mountOverlay(
      <ParallaxOverlay
        visible={overlayVisible}
        images={overlayImages}
        logoOpacity={state.currentProfile?.logo?.opacity ?? 1}
        maxDisplacement={state.currentProfile?.maxDisplacement ?? DEFAULT_PROFILE.maxDisplacement}
        onRefsReady={(handle) => { overlayHandle = handle; }}
      />
    );
  }
  renderOverlay();

  // --- Gyro loop ------------------------------------------------------
  const stopLoop = startGyroLoop({
    serverAPI: serverApi,
    getEnabled: () => overlayVisible && !!state.currentProfile?.enabled,
    getActive: () => overlayVisible,
    getSettings: () => ({
      sensitivity: state.currentProfile?.sensitivity ?? DEFAULT_PROFILE.sensitivity,
      maxDisplacement: state.currentProfile?.maxDisplacement ?? DEFAULT_PROFILE.maxDisplacement,
      smoothing: state.currentProfile?.smoothing ?? DEFAULT_PROFILE.smoothing,
      deadZone: state.currentProfile?.deadZone ?? DEFAULT_PROFILE.deadZone,
      invertHorizontal: state.currentProfile?.invertHorizontal ?? false,
      invertVertical: state.currentProfile?.invertVertical ?? false,
    }),
    getCalibration: () => state.currentProfile?.calibration ?? { x: 0, y: 0 },
    getLayerStrengths: () => state.currentProfile?.layerStrengths ?? DEFAULT_PROFILE.layerStrengths,
    getLogoExtra: () => state.currentProfile?.logo ?? DEFAULT_PROFILE.logo,
    getLayers: () => overlayHandle,
    getPreviewNudge: () => state.previewNudge,
    onAvailability: () => {
      /* surfaced to the user via the Debug panel's "Gyroscope" field only */
    },
    onDebugSample: (info) => {
      state.lastRawSample = { x: info.rawX, y: info.rawY };
      if (state.debugEnabled) {
        state.lastDebugSample = info;
        state.notify();
      }
    },
  });

  // --- Game-page detection ---------------------------------------------
  let pollHandle = 0;

  async function enterGame(appid: string) {
    state.currentAppId = appid;
    const [profile, artwork] = await Promise.all([
      Backend.getProfile(serverApi, appid),
      Backend.getArtwork(serverApi, appid),
    ]);
    state.currentProfile = { ...DEFAULT_PROFILE, ...(profile ?? {}) };
    overlayImages = {
      background: artwork?.background ?? null,
      foreground: (state.currentProfile.mode === 'advanced' ? artwork?.foreground : null) ?? null,
      logo: artwork?.logo ?? null,
    };
    overlayVisible = true;
    renderOverlay();
    await Backend.startGyro(serverApi);
    state.notify();
  }

  async function leaveGame() {
    if (!state.currentAppId) return;
    overlayVisible = false;
    state.currentAppId = null;
    renderOverlay();
    await Backend.stopGyro(serverApi);
    const global = await Backend.getGlobalSettings(serverApi);
    state.currentProfile = { ...DEFAULT_PROFILE, ...(global ?? {}) };
    state.notify();
  }

  function pollLocation() {
    const appid = detectAppId();
    if (appid !== state.currentAppId) {
      if (appid) {
        enterGame(appid);
      } else {
        leaveGame();
      }
    }
  }
  pollHandle = window.setInterval(pollLocation, 500);
  pollLocation();

  // --- Load global defaults up front so the QAM panel has something to show
  Backend.getGlobalSettings(serverApi).then((g) => {
    if (!state.currentAppId) {
      state.currentProfile = { ...DEFAULT_PROFILE, ...(g ?? {}) };
      state.notify();
    }
  });

  const Title: VFC = () => <div className={staticClasses.Title}>Gyro Parallax</div>;

  return {
    title: <Title />,
    content: <SettingsPanel serverAPI={serverApi} state={state} />,
    icon: <span style={{ fontSize: '1.1em' }}>{'\u25C7'}</span>,
    onDismount() {
      window.clearInterval(pollHandle);
      stopLoop();
      Backend.stopGyro(serverApi);
      unmountOverlay();
      container.remove();
    },
  };
});
