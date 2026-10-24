#!/usr/bin/env python3
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "system_files/usr/lib/armada"
sys.path.insert(0, str(LIB))
sys.path.insert(0, str(ROOT / "decky/armada-control/py_modules"))
os.environ["ARMADA_GAME_TWEAKS_LIB"] = str(LIB)

import armada_game_tweaks
from armada_control import tweaks as plugin_tweaks


class GameProfileSettingsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.defaults = Path(self.directory.name) / "defaults.json"
        self.overrides = Path(self.directory.name) / "overrides.json"
        self.global_settings = {
            "fexProfile": "default", "nice": -2,
            "env": {"GLOBAL": "1", "SHARED": "default"},
            "turnipDriver": "stable", "thunks": {"Vulkan": True},
        }
        self.game = {
            "enabled": False, "name": "Game", "fexProfile": "fast", "nice": -5,
            "env": {"GLOBAL": None, "SHARED": "custom", "LOCAL": "2"},
            "turnipDriver": "user:driver", "thunks": {"Vulkan": False},
            "steamCompatTool": "preview", "steamResolution": "960x540",
        }
        self.defaults.write_text(json.dumps({"global": self.global_settings, "games": {}}))
        self.overrides.write_text(json.dumps({"games": {"620": self.game, "730": {"nice": -8}}}))
        self.patch_defaults = patch.object(armada_game_tweaks, "DEFAULTS_CONFIG", self.defaults)
        self.patch_overrides = patch.object(armada_game_tweaks, "OVERRIDES_CONFIG", self.overrides)
        self.patch_defaults.start()
        self.patch_overrides.start()
        self.addCleanup(self.patch_defaults.stop)
        self.addCleanup(self.patch_overrides.stop)

    def save(self, data):
        def write(_action, **request):
            self.assertEqual(request["name"], "tweaks")
            self.overrides.write_text(request["text"])

        with patch.object(plugin_tweaks, "call", side_effect=write):
            plugin_tweaks.save_tweaks(data)
        return plugin_tweaks.load_tweaks()

    def test_follow_global_ignores_every_override_and_preserves_the_saved_profile(self):
        loaded = plugin_tweaks.load_tweaks()
        self.assertEqual(armada_game_tweaks.merged_settings(loaded, "620"), self.global_settings)
        self.assertEqual(loaded["games"]["620"], self.game)
        self.assertEqual(armada_game_tweaks.merged_settings(loaded, "730")["nice"], -8)

    def test_save_reload_preserves_disabled_profile_and_native_steam_selections(self):
        saved = self.save(plugin_tweaks.load_tweaks())
        self.assertEqual(saved["games"]["620"], self.game)
        self.assertEqual(armada_game_tweaks.merged_settings(saved, "620"), self.global_settings)

    def test_reenabling_restores_overrides_and_environment_tombstones(self):
        settings = plugin_tweaks.load_tweaks()
        settings["games"]["620"]["enabled"] = True
        merged = armada_game_tweaks.merged_settings(self.save(settings), "620")
        self.assertEqual(merged["fexProfile"], "fast")
        self.assertEqual(merged["nice"], -5)
        self.assertEqual(merged["env"], {"SHARED": "custom", "LOCAL": "2"})
        self.assertEqual(merged["thunks"], {"Vulkan": False})
        self.assertEqual(merged["turnipDriver"], "user:driver")

    def test_global_changes_apply_while_disabled_without_replacing_saved_settings(self):
        settings = plugin_tweaks.load_tweaks()
        original = copy.deepcopy(settings["games"]["620"])
        settings["global"].update({"nice": 0, "fexProfile": "new-default"})
        saved = self.save(settings)
        self.assertEqual(saved["games"]["620"], original)
        merged = armada_game_tweaks.merged_settings(saved, "620")
        self.assertEqual(merged["nice"], 0)
        self.assertEqual(merged["fexProfile"], "new-default")

    def test_legacy_override_without_enabled_stays_active(self):
        settings = plugin_tweaks.load_tweaks()
        settings["games"]["620"].pop("enabled")
        self.assertEqual(armada_game_tweaks.merged_settings(self.save(settings), "620")["nice"], -5)

    def test_game_and_all_resets_remove_saved_metadata_and_return_to_globals(self):
        settings = plugin_tweaks.load_tweaks()
        del settings["games"]["620"]
        saved = self.save(settings)
        self.assertNotIn("620", saved["games"])
        self.assertEqual(armada_game_tweaks.merged_settings(saved, "620"), self.global_settings)
        self.assertEqual(saved["games"]["730"], {"nice": -8})
        saved["games"] = {}
        saved = self.save(saved)
        self.assertEqual(saved["games"], {})
        self.assertEqual(saved["global"], self.global_settings)

    def test_factory_defaults_exclude_overrides_and_return_fresh_values(self):
        self.overrides.write_text(json.dumps({"global": {"nice": -10}, "games": {"620": self.game}}))
        defaults = plugin_tweaks.load_tweak_defaults()
        self.assertEqual(defaults, {"global": self.global_settings, "games": {}})
        self.assertEqual(plugin_tweaks.load_tweaks()["global"]["nice"], -10)
        defaults["global"]["thunks"]["Vulkan"] = False
        self.assertEqual(plugin_tweaks.load_tweak_defaults()["global"], self.global_settings)

    def test_missing_or_legacy_factory_defaults_stay_normalized(self):
        self.defaults.write_text(json.dumps({"global": {"nice": -4}}))
        self.assertEqual(plugin_tweaks.load_tweak_defaults(), {"global": {"nice": -4}, "games": {}})
        self.defaults.unlink()
        self.assertEqual(plugin_tweaks.load_tweak_defaults(), {"global": {}, "games": {}})

    @unittest.skipIf(os.name == "nt", "plugin config imports Linux controller support")
    def test_config_exposes_factory_defaults_separately_from_current_settings(self):
        from armada_control import config

        self.overrides.write_text(json.dumps({"global": {"nice": -10}, "games": {"620": self.game}}))
        probes = {
            "load_fex_contract": {"profiles": {}}, "device_env": {},
            "bottom_screen_brightness": None, "parse_power": {"fan": {}},
            "factory_power_defaults": {}, "turnip_drivers": [], "load_env_presets": [],
            "perf_info": {}, "rgb_supported": False, "os_version": "test",
            "abl_version": "test", "bottom_screen_enabled": False,
            "bottom_screen_active": False, "ssh_enabled": False,
            "swipe_gestures_enabled": False, "mtp_enabled": False,
            "desktop_mode": "", "desktop_modes": [], "sleep_modes": [],
            "controller_type": "", "calibrated_at": None, "inputplumber_targets": [],
        }
        with patch.multiple(config, **{name: Mock(return_value=value) for name, value in probes.items()}):
            result = config.build_config(include_games=False)
        self.assertEqual(result["tweaksDefaults"], {"global": self.global_settings, "games": {}})
        self.assertEqual(result["tweaks"]["global"]["nice"], -10)
        self.assertEqual(result["tweaks"]["games"]["620"], self.game)


if __name__ == "__main__":
    unittest.main()
