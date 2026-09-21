# Touchscreen trackpad

In **Armada Control → Compatibility**, select a game and set
**Touchscreen → Mode → Trackpad**. Adjust pointer sensitivity (25–300%) and
**Tap to click** there. Lift your fingers for changes to take effect.
The section appears only when a supported primary touchscreen is detected.

**Use Default** inherits the default game profile and shows the inherited mode.
The factory default is **Direct touch**. Outside a tracked game, normal touch
is restored.

## Gestures

| Gesture | Action |
|---|---|
| One-finger slide | Move the pointer |
| Two-finger slide | Scroll |
| Tap | Left-click |
| Two-finger tap | Right-click |
| Tap, then touch again and hold | Drag until you lift |

Turning off **Tap to click** disables clicks and dragging; movement and scrolling
remain available.

## Limitations

- Only the primary touchscreen is captured. Secondary screens keep direct touch.
- The most recently launched game tracked by Armada controls the mode, including
  while Steam overlays are open. Games launched outside Armada's wrapper are
  not tracked.
- This emits mouse input; it is not a remappable Steam Input touchpad.
- RP6 camera movement needs the [touchscreen sampling-rate fix](https://github.com/armada-os/armada-packages/pull/32).

The service reuses Armada's game profiles and session tracking. It checks settings
once per second; touch events are handled immediately. InputPlumber keeps handling
controllers, while this service captures the touchscreen only for trackpad mode.

For diagnostics, run `journalctl -u armada-touchscreen-trackpad.service -b`.
To return to normal touch immediately:

```sh
sudo systemctl stop armada-touchscreen-trackpad.service
```
