#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH="$ROOT/packages/gamescope/patches/0028-steamcompmgr-add-auto-hdr.patch"
PATCHES="$ROOT/packages/gamescope/PATCHES.md"

for needle in \
    'cv_armada_auto_hdr{ "armada_auto_hdr", false' \
    'AutoHdrRequestsOutput(' \
    'AutoHdrUsesContentDrivenOutput(' \
    'AutoHdrUsesItm(' \
    'AutoHdrPresentationWantsHdr(' \
    'AutoHdrUsesContentDrivenOutput( true, false )' \
    'bool autoHdrEligible = false;' \
    '!window_is_steam( w )' \
    'baseCommit && !baseCommit->is_steam' \
    'layout(constant_id = 7) const bool c_itm_enable = false;' \
    'layout(constant_id = 8) const uint c_auto_hdr_itm_layer_mask = 0;' \
    'constantID = 8,' \
    'nitsToScRGB(color)' \
    'steamcompmgr_auto_hdr_itm_layer_mask' \
    'g_bAutoHdrFramePresented' \
    'test_auto_hdr.cpp' \
    "test('auto_hdr', gamescope_tests"; do
    if ! grep -Fq "$needle" "$PATCH"; then
        printf 'Auto HDR Gamescope patch is missing: %s\n' "$needle" >&2
        exit 1
    fi
done

if [ "$(grep -Fc 'outputTF, g_bHDRItmEnable, autoHdrItmLayerMask ))' "$PATCH")" -ne 4 ]; then
    printf 'Auto HDR must cover every final composite path\n' >&2
    exit 1
fi

if grep -Fq 'c_itm_layer_mask' "$PATCH"; then
    printf 'Auto HDR must not alter the legacy HDR ITM specialization\n' >&2
    exit 1
fi

if grep -Fq 'constantID = 7,' "$PATCH"; then
    printf 'Auto HDR must not map the legacy HDR ITM specialization\n' >&2
    exit 1
fi

if grep -Fq 'ENABLE_GAMESCOPE_HDR' "$PATCH"; then
    printf 'Auto HDR must not force Steam HDR output\n' >&2
    exit 1
fi

if ! grep -Fxq -- '- `patches/0028-steamcompmgr-add-auto-hdr.patch`' "$PATCHES"; then
    printf 'Gamescope patch manifest is missing the Auto HDR patch\n' >&2
    exit 1
fi

printf 'Auto HDR Gamescope patch test passed\n'
