import re
import subprocess


CONTROL = "armada_auto_hdr"


def supported(env):
    try:
        return int(env.get("ARMADA_HDR_NITS", "0")) > 0
    except (TypeError, ValueError):
        return False


class AutoHdrController:
    def __init__(self, env, command):
        self.supported = supported(env)
        self.command = command
        self.available = None
        self.active = None  # None means Gamescope state is unknown.

    def apply(self, enabled):
        enabled = bool(enabled)
        if not self.supported or (not enabled and self.active is False):
            return
        if not self.control_available():
            return
        try:
            self.command(CONTROL, str(int(enabled)))
        except (OSError, subprocess.SubprocessError):
            pass
        else:
            self.active = enabled

    def clear(self):
        self.apply(False)

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
