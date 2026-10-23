from threading import RLock


# Decky runs saves in separate worker threads against the same power config.
POWER_CONFIG_LOCK = RLock()
