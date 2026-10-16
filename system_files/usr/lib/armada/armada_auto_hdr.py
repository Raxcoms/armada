import re
import subprocess

import armada_game_tweaks


CONTROL = "armada_auto_hdr"


class AutoHdrController:
    def __init__(self, env, command):
        self.supported = armada_game_tweaks.auto_hdr_supported(env)
        self.command = command
        self.available = None
        self.active = False

    def restore(self, enabled):
        self.active = False
        return self.apply(enabled)

    def apply(self, enabled, force=False):
        enabled = bool(enabled)
        if not self.supported or (not force and enabled == self.active):
            return self.active
        if not self.control_available():
            return self.active
        try:
            self.command(CONTROL, str(int(enabled)))
        except (OSError, subprocess.SubprocessError):
            pass
        else:
            self.active = enabled
        return self.active

    def clear(self, force=False):
        return self.apply(False, force)

    def control_available(self):
        if self.available is True:
            return True
        try:
            result = self.command("help")
        except (OSError, subprocess.SubprocessError):
            return False
        output = (result.stdout or "") + (result.stderr or "")
        self.available = bool(re.search(r"\barmada_auto_hdr:", output))
        return self.available
