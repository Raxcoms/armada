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
require '^\+[[:space:]]*const bool useAutoHdrLuts = drm_layer_uses_auto_hdr_luts\( drm, \*pLayer \);$' 'direct plane LUT selection'
require '^\+[[:space:]]*return g_AutoHdrLuts\.HasLuts\(\) && gamescope::AutoHdrIsEligible\(' 'LUT readiness gate'
require '^\+[[:space:]]*static void update_auto_hdr_luts\( bool force = false \)$' 'lazy LUT update helper'
require '^\+[[:space:]]*const bool enabled = !g_sDrmLeaseClientSocket && cv_armada_auto_hdr && g_ColorMgmt\.current\.enabled;$' 'primary-output LUT activation'
require '^\+[[:space:]]*!g_sDrmLeaseClientSocket,$' 'primary-output eligibility gate'
require '^\+[[:space:]]*const bool hdrOutputCapable = g_bSupportsHDR_CachedValue \|\| g_bForceHDR10OutputDebug;$' 'HDR capability gate'
require '^\+[[:space:]]*for \( uint64_t pipeline : autoHdrPipelines \)$' 'plane-aware LUT selection'
require '^\+[[:space:]]*uint64_t auto_hdr_lut_pipeline = 0;$' 'cached Auto HDR plane pipeline'
require '^\+[[:space:]]*autoHdrPipelines\.push_back\( drm->auto_hdr_lut_pipeline \);$' 'cached pipeline preferred'
require '^\+[[:space:]]*drm->auto_hdr_lut_pipeline = pipeline;$' 'successful pipeline cached'
require '^\+[[:space:]]*drm->auto_hdr_lut_pipeline = 0;$' 'stale pipeline cache cleared'
require '^\+[[:space:]]*update_auto_hdr_luts\(\);$' 'live toggle refresh'
require '^\+[[:space:]]*cv_armada_auto_hdr \);$' 'Auto HDR content-driven output'
require '^\+[[:space:]]*cmdBuffer->bindColorMgmtLuts\(EOTF_Count, frameInfo->autoHdrShaperLut, frameInfo->autoHdrLut3D\);$' 'dedicated Auto HDR LUT binding'
require '^\+[[:space:]]*frameInfo\.autoHdrShaperLut = g_AutoHdrLuts\.vk_lut1d;$' 'dedicated Auto HDR shaper LUT'
require '^\+[[:space:]]*frameInfo\.autoHdrLut3D = g_AutoHdrLuts\.vk_lut3d;$' 'dedicated Auto HDR 3D LUT'
require '^\+[[:space:]]*bool autoHdrLut = c_auto_hdr_lut_enable && colorspaceLayerIdx == 0;$' 'base-layer Auto HDR LUT path'
require '^\+[[:space:]]*g_bAutoHdrFramePresented = pConnector && bAutoHdrFrame;$' 'HDR reporting after presentation'
require '^\+[[:space:]]*const glm::vec3 linearInput\{$' 'linear-light LUT input'
require '^\+[[:space:]]*buildSDRColorimetry\( &autoHdrInputColorimetry, &autoHdrInputMapping,$' 'existing SDR gamut policy'
require '^\+[[:space:]]*const glm::mat3 autoHdrInputToPq = k_2020_from_xyz \* normalised_primary_matrix\($' 'SDR gamut to Rec.2020 conversion'
require '^\+[[:space:]]*autoHdrInputToPq \* linearInput,$' 'SDR gamut primary conversion'
require '^\+[[:space:]]*const float targetNits = g_ColorMgmt\.current\.flInternalDisplayBrightness;$' 'active display peak target'
require '^\+[[:space:]]*g_flHDRItmSdrNits, targetNits \);$' 'peak-aware inverse tone mapping'

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

if grep -Eq '^\+[[:space:]]*g_bOutputHDREnabled,$' "$PATCH"; then
    printf 'Auto HDR eligibility must not depend on active HDR output\n' >&2
    exit 1
fi

if grep -Eq '^\+.*std::find_if\( drm->planes\.begin\(\), drm->planes\.end\(\)' "$PATCH"; then
    printf 'Auto HDR patch must not select an arbitrary plane LUT pipeline\n' >&2
    exit 1
fi

if grep -Eq '^\+.*(g_AutoHdrSourceLuts|map_auto_hdr_sdr_source|sourceWhiteLuminance|flSDROnHDRBrightness)' "$PATCH"; then
    printf 'Auto HDR patch has dynamic source luminance handling\n' >&2
    exit 1
fi

printf 'Auto HDR Gamescope patch test passed\n'
