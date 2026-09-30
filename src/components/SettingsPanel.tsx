import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
  SliderField,
  DropdownItem,
  ButtonItem,
  ServerAPI,
} from 'decky-frontend-lib';
// Required by the classic "react" JSX transform (see index.tsx for details);
// also needed here for the React.ReactNode type reference below.
import * as React from 'react';
import { VFC, useEffect, useState } from 'react';
import { ParallaxProfile, PRESET_VALUES, DEFAULT_PROFILE } from '../profiles/presets';
import { Backend } from '../hooks/backend';
import { PluginState } from '../state';

// Stand-in for decky-frontend-lib's "Field" component: a simple
// label/value row, built from plain elements so it doesn't depend on that
// export existing under that exact name in whatever decky-frontend-lib
// build is actually loaded at runtime.
const InfoField: VFC<{ label: string; children?: React.ReactNode }> = ({ label, children }) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    padding: '4px 0', gap: '12px', fontSize: '0.85em', opacity: 0.85, lineHeight: 1.35,
  }}>
    <span style={{ flexShrink: 0, opacity: 0.7 }}>{label}</span>
    <span style={{ textAlign: 'right' }}>{children}</span>
  </div>
);

interface Props {
  serverAPI: ServerAPI;
  state: PluginState;
}

const PRESET_OPTIONS = [
  { data: 'subtle', label: 'Subtle' },
  { data: 'cinematic', label: 'Cinematic' },
  { data: 'strong', label: 'Strong' },
  { data: 'custom', label: 'Custom' },
];

export const SettingsPanel: VFC<Props> = ({ serverAPI, state }) => {
  const [profile, setProfile] = useState<ParallaxProfile>(state.currentProfile ?? DEFAULT_PROFILE);
  const [appid, setAppid] = useState<string | null>(state.currentAppId);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrateProgress, setCalibrateProgress] = useState(0);
  const [debug, setDebug] = useState(state.debugEnabled);
  const [debugSample, setDebugSample] = useState(state.lastDebugSample);
  const [previewNudge, setPreviewNudge] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const unsub = state.subscribe(() => {
      setAppid(state.currentAppId);
      setProfile(state.currentProfile ?? DEFAULT_PROFILE);
      setDebugSample(state.lastDebugSample);
    });
    return unsub;
  }, [state]);

  const activeAppId = appid ?? 'global';
  const isGameScoped = appid !== null;

  async function persist(next: ParallaxProfile) {
    setProfile(next);
    state.currentProfile = next;
    if (isGameScoped && appid) {
      await Backend.saveProfile(serverAPI, appid, next);
    } else {
      await Backend.saveGlobalSettings(serverAPI, next);
    }
    state.notify();
  }

  function update<K extends keyof ParallaxProfile>(key: K, value: ParallaxProfile[K]) {
    persist({ ...profile, [key]: value });
  }

  function applyPreset(preset: string) {
    if (preset === 'custom') {
      update('preset', 'custom' as ParallaxProfile['preset']);
      return;
    }
    const values = PRESET_VALUES[preset] ?? {};
    persist({ ...profile, ...values, preset: preset as ParallaxProfile['preset'] });
  }

  async function calibrate() {
    setCalibrating(true);
    setCalibrateProgress(0);
    const start = state.lastRawSample;
    const duration = 1400;
    const startedAt = performance.now();
    const timer = setInterval(() => {
      const elapsed = performance.now() - startedAt;
      setCalibrateProgress(Math.min(100, Math.round((elapsed / duration) * 100)));
      if (elapsed >= duration) {
        clearInterval(timer);
        const sample = state.lastRawSample ?? start ?? { x: 0, y: 0 };
        Backend.setCalibration(serverAPI, activeAppId, sample.x, sample.y).then(() => {
          persist({ ...profile, calibration: { x: sample.x, y: sample.y } });
          setCalibrating(false);
        });
      }
    }, 50);
  }

  async function resetCalibration() {
    await Backend.resetCalibration(serverAPI, activeAppId);
    persist({ ...profile, calibration: { x: 0, y: 0 } });
  }

  async function resetGameProfile() {
    if (!appid) return;
    await Backend.deleteProfile(serverAPI, appid);
    const global = (await Backend.getGlobalSettings(serverAPI)) ?? DEFAULT_PROFILE;
    setProfile(global);
    state.currentProfile = global;
    state.notify();
  }

  const advanced = profile.mode === 'advanced';

  return (
    <>
      <PanelSection title={isGameScoped ? 'GyroParallax - this game' : 'GyroParallax - global default'}>
        <PanelSectionRow>
          <ToggleField
            label="Enable Parallax"
            checked={profile.enabled}
            onChange={(v) => update('enabled', v)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <DropdownItem
            label="Profile"
            rgOptions={PRESET_OPTIONS}
            selectedOption={profile.preset}
            onChange={(opt) => applyPreset(String(opt.data))}
          />
        </PanelSectionRow>
        {!isGameScoped && (
          <PanelSectionRow>
            <InfoField label="Scope">
              Open a game's page to set a profile just for that game - it will
              load automatically whenever you return to it.
            </InfoField>
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title="Tuning">
        <PanelSectionRow>
          <SliderField
            label="Sensitivity"
            value={profile.sensitivity}
            min={0}
            max={100}
            step={1}
            showValue
            onChange={(v) => update('sensitivity', v)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField
            label="Maximum displacement"
            description="px"
            value={profile.maxDisplacement}
            min={0}
            max={50}
            step={1}
            showValue
            onChange={(v) => update('maxDisplacement', v)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField
            label="Smoothing"
            value={profile.smoothing}
            min={0}
            max={100}
            step={1}
            showValue
            onChange={(v) => update('smoothing', v)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField
            label="Dead zone"
            value={profile.deadZone}
            min={0}
            max={20}
            step={1}
            showValue
            onChange={(v) => update('deadZone', v)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Invert horizontal"
            checked={profile.invertHorizontal}
            onChange={(v) => update('invertHorizontal', v)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Invert vertical"
            checked={profile.invertVertical}
            onChange={(v) => update('invertVertical', v)}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Layers">
        <PanelSectionRow>
          <ToggleField
            label="Advanced mode (separate image per layer)"
            checked={advanced}
            onChange={(v) => update('mode', (v ? 'advanced' : 'simple') as ParallaxProfile['mode'])}
          />
        </PanelSectionRow>
        {(['background', 'middle', 'foreground', 'logo'] as const).map((layer) => (
          <PanelSectionRow key={layer}>
            <SliderField
              label={layer[0].toUpperCase() + layer.slice(1)}
              value={Math.round(profile.layerStrengths[layer] * 100)}
              min={0}
              max={120}
              step={1}
              showValue
              disabled={!advanced && layer !== 'logo' && layer !== 'background'}
              onChange={(v) =>
                update('layerStrengths', { ...profile.layerStrengths, [layer]: v / 100 })
              }
            />
          </PanelSectionRow>
        ))}
      </PanelSection>

      <PanelSection title="Calibration">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={calibrate} disabled={calibrating}>
            {calibrating ? `Calibrating... ${calibrateProgress}%` : 'Calibrate'}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <InfoField label="Tip">Hold Steam Deck in your normal gaming position, then press Calibrate.</InfoField>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={resetCalibration}>
            Reset Calibration
          </ButtonItem>
        </PanelSectionRow>
        {isGameScoped && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={resetGameProfile}>
              Reset Game Profile
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title="Preview">
        <PanelSectionRow>
          <InfoField label="Nudge">
            Use these while the gyroscope is unavailable (or you just want a
            quick look) to preview the tuning above without tilting the Deck.
          </InfoField>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
            <ButtonItem
              layout="inline"
              onClick={() => {
                const n = { x: previewNudge.x - 6, y: previewNudge.y };
                setPreviewNudge(n);
                state.previewNudge = n;
                state.notify();
              }}
            >
              {'\u2190'}
            </ButtonItem>
            <ButtonItem
              layout="inline"
              onClick={() => {
                const n = { x: previewNudge.x + 6, y: previewNudge.y };
                setPreviewNudge(n);
                state.previewNudge = n;
                state.notify();
              }}
            >
              {'\u2192'}
            </ButtonItem>
            <ButtonItem
              layout="inline"
              onClick={() => {
                const n = { x: previewNudge.x, y: previewNudge.y - 6 };
                setPreviewNudge(n);
                state.previewNudge = n;
                state.notify();
              }}
            >
              {'\u2191'}
            </ButtonItem>
            <ButtonItem
              layout="inline"
              onClick={() => {
                const n = { x: previewNudge.x, y: previewNudge.y + 6 };
                setPreviewNudge(n);
                state.previewNudge = n;
                state.notify();
              }}
            >
              {'\u2193'}
            </ButtonItem>
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Debug">
        <PanelSectionRow>
          <ToggleField
            label="Debug overlay"
            checked={debug}
            onChange={(v) => {
              setDebug(v);
              state.debugEnabled = v;
              state.notify();
            }}
          />
        </PanelSectionRow>
        {debug && (
          <PanelSectionRow>
            <InfoField label="Gyro X">{debugSample?.rawX?.toFixed(3) ?? '-'}</InfoField>
          </PanelSectionRow>
        )}
        {debug && (
          <PanelSectionRow>
            <InfoField label="Gyro Y">{debugSample?.rawY?.toFixed(3) ?? '-'}</InfoField>
          </PanelSectionRow>
        )}
        {debug && (
          <PanelSectionRow>
            <InfoField label="Filtered">
              {debugSample ? `${debugSample.filteredX.toFixed(2)}, ${debugSample.filteredY.toFixed(2)}` : '-'}
            </InfoField>
          </PanelSectionRow>
        )}
        {debug && (
          <PanelSectionRow>
            <InfoField label="FPS">{debugSample?.fps ?? '-'}</InfoField>
          </PanelSectionRow>
        )}
        {debug && (
          <PanelSectionRow>
            <InfoField label="Current game">{appid ?? 'none'}</InfoField>
          </PanelSectionRow>
        )}
        {debug && (
          <PanelSectionRow>
            <InfoField label="Gyroscope">{debugSample?.available ? 'available' : 'unavailable'}</InfoField>
          </PanelSectionRow>
        )}
      </PanelSection>
    </>
  );
};
