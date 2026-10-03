"""
GyroParallax - Decky Loader plugin backend.

Responsibilities of this backend (kept intentionally thin, per the project's
performance requirements - all smoothing / dead-zone / sensitivity / clamping
math lives in the frontend, driven off refs + requestAnimationFrame, never
off React state):

  * Persist global settings + one profile per appid (SettingsManager -> JSON).
  * Discover and stream the Steam Deck's motion sensors, throttled, only
    while the frontend has explicitly asked for it (i.e. only while a game
    details page is open).
  * Locate existing Steam / SteamGridDB-style artwork for a given appid so
    the frontend doesn't need filesystem access.
  * Store user-supplied custom layer images.

Nothing here modifies Steam's own files, replaces binaries, or requires
elevated permissions - it only reads standard library-cache image files and
the standard input subsystem device nodes the `deck` user already has
permission to read.
"""

import asyncio
import base64
import glob
import math
import os
import struct
import time
from typing import Optional

import decky
from settings import SettingsManager

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Where Steam keeps per-appid artwork it has already downloaded. We only
# ever *read* from here.
LIBRARYCACHE_DIRS = [
    os.path.expanduser("~/.local/share/Steam/appcache/librarycache"),
    os.path.expanduser("~/.steam/steam/appcache/librarycache"),
    os.path.expanduser("~/.steam/root/appcache/librarycache"),
]

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
MAX_IMAGE_BYTES = 25 * 1024 * 1024

ARTWORK_FILENAME_CANDIDATES = {
    "background": [
        "{appid}_library_hero.jpg",
        "{appid}_library_hero.png",
        "{appid}_hero.jpg",
    ],
    "foreground": [
        "{appid}_library_600x900.jpg",
        "{appid}_library_600x900.png",
        "{appid}p.jpg",
    ],
    "logo": [
        "{appid}_logo.png",
        "{appid}_logo.jpg",
    ],
}

DEFAULT_PROFILE = {
    "enabled": True,
    # Default profile for a brand-new game page == the "Cinema" preset's own
    # values (see PRESETS["cinematic"] below and PRESET_VALUES.cinematic in
    # dist/index.js) - keep these three in sync.
    "preset": "cinematic",
    "sensitivity": 60,
    "maxDisplacement": 50,
    "smoothing": 95,
    "deadZone": 0,
    "invertHorizontal": True,
    "invertVertical": False,
    "layerStrengths": {
        "background": 1.20,
        "middle": 0.70,
        "foreground": 0.40,
        "logo": 0.20,
    },
    "layerOpacity": {"middle": 1.0, "foreground": 1.0, "background2": 1.0},
    "layerTransform": {
        "middle": {"x": 0, "y": 0, "scale": 1.0},
        "foreground": {"x": 0, "y": 0, "scale": 1.0},
        "background2": {"x": 0, "y": 0, "scale": 1.0},
    },
    "logo": {
        "x": 0,
        "y": 0,
        "scale": 1.0,
        "opacity": 1.0,
        "depth": 1.0,
    },
    "calibration": {"x": 0.0, "y": 0.0},
    "mode": "simple",  # "simple" (one image, auto depth) or "advanced" (per-layer images)
    "images": {},  # layer -> "steam" | "custom" ; custom images stored separately
    # When True, a second independent background image ("background2") is
    # rendered between the real page background and the Middle layer, using
    # its own image/opacity/size-position controls in the frontend, and
    # takes over the "background" layerStrengths value instead of the real
    # background getting parallax motion (see dist/index.js applyOffset()).
    "customBackground": False,
}

# NOTE: not currently called by the frontend (dist/index.js keeps its own,
# authoritative copy as PRESET_VALUES, including per-layer strengths this
# dict doesn't carry) - kept here only so get_presets()/this dict don't go
# stale/misleading if something ever does call it. Names: subtle == "Light",
# cinematic == "Cinema", strong == "Extreme" in the UI.
PRESETS = {
    "subtle": {"sensitivity": 30, "maxDisplacement": 25, "smoothing": 80, "deadZone": 5},
    "cinematic": {"sensitivity": 60, "maxDisplacement": 50, "smoothing": 95, "deadZone": 0},
    "strong": {"sensitivity": 90, "maxDisplacement": 50, "smoothing": 87, "deadZone": 0},
}


HID_STEAM_VENDOR = "000028DE"  # Valve
HID_DECK_PRODUCTS = ("00001205",)  # Steam Deck (LCD and OLED) built-in controller
DECK_REPORT_TYPE_STATE = 0x09  # ID_CONTROLLER_DECK_STATE
ACCEL_OFFSET = 24  # int16 x3 little-endian: accel X, Y, Z (16384 LSB per g)


def _find_deck_hidraw_paths() -> list:
    """Return /dev/hidrawN nodes that belong to the Steam Deck controller
    (VID 28DE / PID 1205), found via sysfs so no node number is hardcoded."""
    paths = []
    for uevent in sorted(glob.glob("/sys/class/hidraw/hidraw*/device/uevent")):
        try:
            with open(uevent, "r", errors="ignore") as f:
                text = f.read()
        except OSError:
            continue
        hid_id = ""
        for line in text.splitlines():
            if line.startswith("HID_ID="):
                hid_id = line.split("=", 1)[1].upper()
        parts = hid_id.split(":")
        if len(parts) == 3 and parts[1] == HID_STEAM_VENDOR and parts[2] in HID_DECK_PRODUCTS:
            node = "/dev/" + uevent.split("/")[4]
            if os.path.exists(node):
                paths.append(node)
    return paths


def _parse_deck_report(data: bytes):
    """Parse a Steam Deck state report. Returns (tilt_x, tilt_y, ax, ay, az)
    or None if the report isn't a state report. Tilt is derived from the
    accelerometer (gravity direction), which gives a stable absolute
    orientation with no drift - ideal for a parallax 'card tilt' effect -
    expressed in tenths of a degree."""
    if len(data) < 36 or data[2] != DECK_REPORT_TYPE_STATE:
        return None
    ax, ay, az = struct.unpack_from("<hhh", data, ACCEL_OFFSET)
    roll = math.degrees(math.atan2(ax, math.sqrt(ay * ay + az * az)))
    pitch = math.degrees(math.atan2(ay, az if az != 0 else 1))
    return roll * 10.0, pitch * 10.0, ax, ay, az


class GyroReader:
    """Background task reading the Steam Deck's IMU from its hidraw node
    (the same interface Steam itself reads; hidraw allows multiple readers,
    so this does not interfere with Steam Input). The latest sample is
    cached in `last_sample`; the frontend polls it from its own
    requestAnimationFrame loop."""

    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self.available = False
        self.last_sample = self._blank("not_started")

    @staticmethod
    def _blank(reason, extra=None):
        d = {"available": False, "x": 0, "y": 0, "z": 0, "t": time.time(), "reason": reason}
        if extra:
            d.update(extra)
        return d

    async def start(self):
        if self._task and not self._task.done():
            return
        self._running = True
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        self._running = False
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
            self._task = None

    async def _run(self):
        # Outer loop: (re)discover + (re)open the hidraw node(s), then read
        # from them until they disappear, then retry. This used to be a
        # single attempt - if the device node(s) ever vanished (which some
        # firmware does briefly around a suspend/resume cycle, as opposed
        # to just going quiet), the reader gave up for good and the user
        # had to fully disable/re-enable the gyro to get it working again.
        # Retrying here is cheap and makes the plugin self-heal instead.
        last_logged_reason = None
        while self._running:
            paths = _find_deck_hidraw_paths()
            if not paths:
                self.last_sample = self._blank("no_device")
                if last_logged_reason != "no_device":
                    decky.logger.info("[GyroParallax] No Steam Deck hidraw device found")
                    last_logged_reason = "no_device"
                await asyncio.sleep(1.5)
                continue

            fds = {}
            denied = False
            for p in paths:
                try:
                    fds[p] = os.open(p, os.O_RDONLY | os.O_NONBLOCK)
                except PermissionError:
                    denied = True
                except OSError as e:
                    decky.logger.info(f"[GyroParallax] Could not open {p}: {e}")
            if not fds:
                reason = "permission_denied" if denied else "open_failed"
                self.last_sample = self._blank(reason)
                if last_logged_reason != reason:
                    decky.logger.info(f"[GyroParallax] Gyro unavailable: {reason}")
                    last_logged_reason = reason
                await asyncio.sleep(1.5)
                continue

            last_logged_reason = None
            decky.logger.info(f"[GyroParallax] Gyro initialized ({', '.join(fds)})")
            reports = 0
            started = time.time()
            got_state = False
            try:
                while self._running:
                    progressed = False
                    for p, fd in list(fds.items()):
                        while True:
                            try:
                                data = os.read(fd, 64)
                            except BlockingIOError:
                                break
                            except OSError:
                                # Stale/invalidated fd (e.g. the device was
                                # transiently re-enumerated around a sleep
                                # cycle) - drop it; if every fd ends up
                                # dropped this way we fall through below and
                                # retry discovery instead of ever reading
                                # garbage from a bad fd.
                                fds.pop(p, None)
                                try:
                                    os.close(fd)
                                except OSError:
                                    pass
                                break
                            if not data:
                                break
                            progressed = True
                            reports += 1
                            parsed = _parse_deck_report(data)
                            if parsed:
                                got_state = True
                                tx, ty, ax, ay, az = parsed
                                self.available = True
                                self.last_sample = {
                                    "available": True, "x": tx, "y": ty, "z": 0,
                                    "t": time.time(), "reason": None,
                                    "ax": ax, "ay": ay, "az": az,
                                }
                    if not fds:
                        self.last_sample = self._blank("device_lost")
                        decky.logger.info("[GyroParallax] Gyro device node(s) lost, retrying")
                        break
                    if not got_state and time.time() - started > 3.0:
                        self.last_sample = self._blank(
                            "no_state_reports", {"reports": reports}
                        )
                    await asyncio.sleep(0.004 if progressed else 0.01)
            finally:
                for fd in fds.values():
                    try:
                        os.close(fd)
                    except OSError:
                        pass
            if not self._running:
                break
            await asyncio.sleep(1.5)  # brief backoff before retrying discovery
        decky.logger.info("[GyroParallax] Gyro reader stopped")


class Plugin:
    gyro = GyroReader()

    # -- lifecycle ----------------------------------------------------

    async def _main(self):
        decky.logger.info("[GyroParallax] Plugin initialized")
        settings_dir = getattr(decky, "DECKY_PLUGIN_SETTINGS_DIR", None) or os.path.expanduser("~/.config/GyroParallax")
        self.settings = SettingsManager(
            name="settings", settings_directory=settings_dir
        )
        self.settings.read()
        os.makedirs(self._custom_image_dir(), exist_ok=True)

    async def _unload(self):
        await self.gyro.stop()
        decky.logger.info("[GyroParallax] Plugin unloaded")

    async def _uninstall(self):
        pass

    # -- gyro streaming control (frontend calls these on enter/leave) --

    async def start_gyro(self):
        await self.gyro.start()
        return {"available": self.gyro.available}

    async def stop_gyro(self):
        await self.gyro.stop()
        return {"ok": True}

    async def get_gyro_sample(self):
        """Cheap, non-blocking read of the latest cached sample."""
        return self.gyro.last_sample

    # -- settings / profiles -------------------------------------------

    @staticmethod
    def _custom_image_dir():
        settings_dir = getattr(decky, "DECKY_PLUGIN_SETTINGS_DIR", None) or os.path.expanduser("~/.config/GyroParallax")
        d = os.path.join(settings_dir, "images")
        os.makedirs(d, exist_ok=True)
        return d

    async def get_global_settings(self):
        return dict(self.settings.getSetting("global", DEFAULT_PROFILE))

    async def save_global_settings(self, profile: dict):
        self.settings.setSetting("global", profile)
        return {"ok": True}

    async def get_profile(self, appid: str):
        if not appid or appid == "global":
            return dict(self.settings.getSetting("global", DEFAULT_PROFILE))
        profiles = self.settings.getSetting("profiles", {})
        if appid in profiles:
            merged = dict(DEFAULT_PROFILE)
            merged.update(profiles[appid])
            return merged
        return dict(self.settings.getSetting("global", DEFAULT_PROFILE))

    async def has_profile(self, appid: str):
        if not appid or appid == "global":
            return True
        profiles = self.settings.getSetting("profiles", {})
        return appid in profiles

    async def save_profile(self, appid: str, profile: dict):
        if not appid or appid == "global":
            self.settings.setSetting("global", profile)
        else:
            profiles = dict(self.settings.getSetting("profiles", {}))
            profiles[appid] = profile
            self.settings.setSetting("profiles", profiles)
        return {"ok": True}

    async def delete_profile(self, appid: str):
        if appid and appid != "global":
            profiles = dict(self.settings.getSetting("profiles", {}))
            profiles.pop(appid, None)
            self.settings.setSetting("profiles", profiles)
            self._remove_images(self._safe_key(appid), "middle")
            self._remove_images(self._safe_key(appid), "foreground")
            self._remove_images(self._safe_key(appid), "background2")
        return {"ok": True}

    async def get_presets(self):
        return PRESETS

    async def set_calibration(self, appid: str, x: float, y: float):
        if not appid or appid == "global":
            target = dict(self.settings.getSetting("global", DEFAULT_PROFILE))
            target["calibration"] = {"x": x, "y": y}
            self.settings.setSetting("global", target)
        else:
            profiles = dict(self.settings.getSetting("profiles", {}))
            target = dict(profiles.get(appid) or self.settings.getSetting("global", DEFAULT_PROFILE))
            target["calibration"] = {"x": x, "y": y}
            profiles[appid] = target
            self.settings.setSetting("profiles", profiles)
        return {"ok": True}

    async def reset_calibration(self, appid: str):
        if not appid or appid == "global":
            target = dict(self.settings.getSetting("global", DEFAULT_PROFILE))
            target["calibration"] = {"x": 0.0, "y": 0.0}
            self.settings.setSetting("global", target)
        else:
            profiles = dict(self.settings.getSetting("profiles", {}))
            target = dict(profiles.get(appid) or self.settings.getSetting("global", DEFAULT_PROFILE))
            target["calibration"] = {"x": 0.0, "y": 0.0}
            profiles[appid] = target
            self.settings.setSetting("profiles", profiles)
        return {"ok": True}

    # -- artwork ---------------------------------------------------------

    async def get_artwork(self, appid: str):
        """Look for already-downloaded Steam library artwork for this appid."""
        result = {"background": None, "foreground": None, "logo": None}
        for layer, filenames in ARTWORK_FILENAME_CANDIDATES.items():
            for cache_dir in LIBRARYCACHE_DIRS:
                if result[layer]:
                    break
                for pattern in filenames:
                    path = os.path.join(cache_dir, pattern.format(appid=appid))
                    matches = glob.glob(path)
                    if matches:
                        result[layer] = self._file_to_data_uri(matches[0])
                        break
        return result

    @staticmethod
    def _file_to_data_uri(path: str) -> Optional[str]:
        try:
            ext = os.path.splitext(path)[1].lower().lstrip(".")
            mime = {"png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")
            with open(path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("ascii")
            return f"data:{mime};base64,{encoded}"
        except Exception as e:
            decky.logger.error(f"[GyroParallax] Failed to read artwork {path}: {e}", exc_info=True)
            return None

    async def save_custom_image(self, appid: str, layer: str, data_uri: str):
        try:
            header, encoded = data_uri.split(",", 1)
            ext = "png" if "png" in header else "jpg"
            out_dir = self._custom_image_dir()
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(out_dir, f"{self._safe_key(appid)}_{self._safe_key(layer)}.{ext}")
            with open(out_path, "wb") as f:
                f.write(base64.b64decode(encoded))
            return {"ok": True, "path": out_path}
        except Exception as e:
            decky.logger.info(f"[GyroParallax] Failed to save custom image: {e}")
            return {"ok": False, "error": str(e)}

    async def import_custom_image(self, appid: str, layer: str, path: str):
        try:
            appid = self._safe_key(appid)
            layer = self._safe_key(layer)
            if not os.path.isfile(path):
                return {"ok": False, "error": "file_not_found"}
            ext = os.path.splitext(path)[1].lower().lstrip(".")
            if ext == "jpeg":
                ext = "jpg"
            if ext not in ("png", "jpg", "webp"):
                return {"ok": False, "error": "unsupported_type"}
            if os.path.getsize(path) > MAX_IMAGE_BYTES:
                return {"ok": False, "error": "too_large"}
            out_dir = self._custom_image_dir()
            os.makedirs(out_dir, exist_ok=True)
            self._remove_images(appid, layer)
            out_path = os.path.join(out_dir, f"{appid}_{layer}.{ext}")
            with open(path, "rb") as src, open(out_path, "wb") as dst:
                dst.write(src.read())
            return {"ok": True, "dataUri": self._file_to_data_uri(out_path)}
        except Exception as e:
            decky.logger.error(f"[GyroParallax] Failed to import custom image ({path!r}, layer={layer!r}): {e}", exc_info=True)
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    @staticmethod
    def _safe_key(value: str) -> str:
        return "".join(c for c in str(value) if c.isalnum() or c in "-_") or "global"

    @staticmethod
    def _remove_images(appid: str, layer: str):
        dirs = [Plugin._custom_image_dir()]
        runtime_dir = getattr(decky, "DECKY_PLUGIN_RUNTIME_DIR", None)
        if runtime_dir:
            dirs.append(os.path.join(runtime_dir, "images"))
        for d in dirs:
            for ext in ("png", "jpg", "jpeg", "webp"):
                p = os.path.join(d, f"{appid}_{layer}.{ext}")
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass

    async def remove_custom_image(self, appid: str, layer: str):
        try:
            self._remove_images(self._safe_key(appid), self._safe_key(layer))
            return {"ok": True}
        except Exception as e:
            decky.logger.error(f"[GyroParallax] Failed to remove custom image: {e}", exc_info=True)
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    async def list_dir(self, path: str = ""):
        """List sub-folders and image files of a directory, for the in-panel
        file browser."""
        try:
            home = os.path.expanduser("~")
            if not path or not os.path.isdir(path):
                path = home
                for cand in (os.path.join(home, "Pictures"), os.path.join(home, "Downloads")):
                    if os.path.isdir(cand):
                        path = cand
                        break
            path = os.path.realpath(path)
            parent = os.path.dirname(path) if path != "/" else None
            try:
                entries = sorted(os.scandir(path), key=lambda e: e.name.lower())
            except OSError as e:
                return {"ok": False, "error": str(e), "path": path, "parent": parent}
            dirs, files = [], []
            for e in entries:
                if e.name.startswith("."):
                    continue
                try:
                    if e.is_dir():
                        dirs.append(e.name)
                    elif e.is_file() and os.path.splitext(e.name)[1].lower() in IMAGE_EXTS:
                        files.append(e.name)
                except OSError:
                    continue
            return {"ok": True, "path": path, "parent": parent,
                    "dirs": dirs[:150], "files": files[:150]}
        except Exception as e:
            decky.logger.error(f"[GyroParallax] list_dir failed for {path!r}: {e}", exc_info=True)
            return {"ok": False, "error": f"{type(e).__name__}: {e}", "path": path, "parent": None}

    async def get_custom_image(self, appid: str, layer: str):
        try:
            appid, layer = self._safe_key(appid), self._safe_key(layer)
            dirs = [self._custom_image_dir()]
            runtime_dir = getattr(decky, "DECKY_PLUGIN_RUNTIME_DIR", None)
            if runtime_dir:
                dirs.append(os.path.join(runtime_dir, "images"))
            for d in dirs:
                for ext in ("png", "jpg", "jpeg", "webp"):
                    path = os.path.join(d, f"{appid}_{layer}.{ext}")
                    if os.path.exists(path):
                        return self._file_to_data_uri(path)
            return None
        except Exception as e:
            decky.logger.error(f"[GyroParallax] get_custom_image failed: {e}", exc_info=True)
            return None
