#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mapfile -t PATCHES < <(find "$ROOT/packages/gamescope/patches" -maxdepth 1 -type f -name '*auto-hdr.patch' -print)

if [ "${#PATCHES[@]}" -ne 1 ]; then
    printf 'Expected one Auto HDR Gamescope patch, found %s\n' "${#PATCHES[@]}" >&2
    exit 1
fi

PATCH="${PATCHES[0]}"

require() {
    if ! grep -Eq "$1" "$PATCH"; then
        printf 'Auto HDR Gamescope patch is missing: %s\n' "$2" >&2
        exit 1
    fi
}

require '^\+[[:space:]]*constexpr bool AutoHdrUsesDirectScanout\(' 'direct scanout eligibility gate'
require '^\+[[:space:]]*const bool useAutoHdrLuts = gamescope::AutoHdrUsesDirectScanout\(' 'direct plane LUT selection'
require '^\+[[:space:]]*return g_AutoHdrDirectLuts\.HasLuts\(\) && gamescope::AutoHdrIsEligible\(' 'LUT readiness gate'
require '^\+[[:space:]]*static void update_auto_hdr_luts\( bool force = false \)$' 'lazy LUT update helper'
require '^\+[[:space:]]*const bool enabled = cv_armada_auto_hdr && g_ColorMgmt\.current\.enabled;$' 'toggle-aware LUT activation'
require '^\+[[:space:]]*update_auto_hdr_luts\(\);$' 'live toggle refresh'
require '^\+[[:space:]]*cv_armada_auto_hdr \);$' 'Auto HDR content-driven output'
require '^\+[[:space:]]*frameInfo\.shaperLut\[i\] = g_AutoHdrDirectLuts\.vk_lut1d;$' 'shared shaper LUT binding'
require '^\+[[:space:]]*frameInfo\.lut3D\[i\] = g_AutoHdrDirectLuts\.vk_lut3d;$' 'shared 3D LUT binding'
require '^\+[[:space:]]*bool autoHdrLut = c_auto_hdr_lut_enable && colorspaceLayerIdx == 0;$' 'compositor shared LUT path'
require '^\+[[:space:]]*g_bAutoHdrFramePresented = pConnector && bAutoHdrFrame;$' 'HDR reporting after presentation'

if grep -Eq '^[+-].*(autoHdrItm|auto_hdr_itm|VKR_AUTO_HDR_ITM)' "$PATCH"; then
    printf 'Auto HDR patch has stale ITM-only names\n' >&2
    exit 1
fi

if grep -Eq '^\+.*sdrNits > 99\.0f.*targetNits > 999\.0f' "$PATCH"; then
    printf 'Auto HDR patch has a hardcoded panel mapping\n' >&2
    exit 1
fi

if grep -Eq '^\+.*bNeedsFullComposite.*autoHdr' "$PATCH"; then
    printf 'Auto HDR patch must not force composition\n' >&2
    exit 1
fi

if grep -Eq '^\+.*(g_AutoHdrSourceLuts|map_auto_hdr_sdr_source|sourceWhiteLuminance|flSDROnHDRBrightness)' "$PATCH"; then
    printf 'Auto HDR patch has dynamic source luminance handling\n' >&2
    exit 1
fi

printf 'Auto HDR Gamescope patch test passed\n'
