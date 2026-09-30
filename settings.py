"""
Minimal JSON-backed settings manager for this plugin.

This is intentionally a small, self-contained module (instead of importing
decky-loader's own internal `decky_loader.settings` module, which is a
private implementation detail of the loader, lives under a different
package path across loader versions, and pulls in loader-only dependencies
like `localplatform`). Every well-behaved third-party Decky plugin vendors
its own copy of something like this.

Public API kept identical to what `main.py` expects:
    SettingsManager(name: str, settings_directory: str)
    .read()                         -> reload from disk
    .commit()                       -> force a write to disk
    .getSetting(key, default=None)  -> read one key
    .setSetting(key, value)         -> write one key + persist immediately
"""

import json
import os
import threading
from typing import Any, Dict, Optional


class SettingsManager:
    def __init__(self, name: str, settings_directory: Optional[str] = None) -> None:
        if not settings_directory:
            raise ValueError("settings_directory is required")

        os.makedirs(settings_directory, exist_ok=True)
        self.path = os.path.join(settings_directory, f"{name}.json")
        self._lock = threading.Lock()
        self.settings: Dict[str, Any] = {}
        self.read()

    def read(self) -> None:
        """(Re)load settings from disk. Missing or corrupt files are
        treated as "no settings yet" rather than crashing the plugin -
        a plugin that can't start because of one bad JSON file is a much
        worse experience than one that silently resets to defaults."""
        with self._lock:
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                self.settings = loaded if isinstance(loaded, dict) else {}
            except FileNotFoundError:
                self.settings = {}
            except (json.JSONDecodeError, OSError):
                self.settings = {}

    def commit(self) -> None:
        """Write the whole settings dict back to disk atomically (write to
        a temp file + rename) so a crash or power loss mid-write can never
        leave behind a half-written, unreadable settings.json."""
        with self._lock:
            tmp_path = f"{self.path}.tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(self.settings, f, indent=4, ensure_ascii=False)
            os.replace(tmp_path, self.path)

    def getSetting(self, key: str, default: Any = None) -> Any:
        return self.settings.get(key, default)

    def setSetting(self, key: str, value: Any) -> None:
        with self._lock:
            self.settings[key] = value
        self.commit()
