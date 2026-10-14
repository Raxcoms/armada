#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH="$(find "$ROOT/packages/gamescope/patches" -maxdepth 1 -type f -name '*auto-hdr.patch' -print -quit)"

if [ -z "$PATCH" ]; then
    printf 'Auto HDR Gamescope patch is missing\n' >&2
    exit 1
fi

require() {
    if ! grep -Eq "$1" "$PATCH"; then
        printf 'Auto HDR Gamescope patch is missing: %s\n' "$2" >&2
        exit 1
    fi
}

require '^\+#define[[:space:]]+VKR_AUTO_HDR_ITM_SPEC_CONSTANT_ID[[:space:]]+[[:digit:]]+$' 'shared specialization constant'
require '^\+layout\(constant_id = VKR_AUTO_HDR_ITM_SPEC_CONSTANT_ID\)[[:space:]]+const bool c_auto_hdr_itm_enable = false;$' 'shader specialization'
require '^\+[[:space:]]*\.constantID = VKR_AUTO_HDR_ITM_SPEC_CONSTANT_ID,' 'Vulkan specialization mapping'
require '^\+[[:space:]]*bool autoHdrItm = c_auto_hdr_itm_enable && colorspaceLayerIdx == 0;' 'base-layer Auto HDR gating'

if grep -Eq '^[+-]layout\(constant_id = .*c_itm_enable' "$PATCH"; then
    printf 'Auto HDR must not rewrite the legacy HDR ITM shader specialization\n' >&2
    exit 1
fi

if grep -Eq '^-[[:space:]]*\.constantID[[:space:]]*=' "$PATCH"; then
    printf 'Auto HDR must not rewrite an existing Vulkan specialization mapping\n' >&2
    exit 1
fi

printf 'Auto HDR Gamescope patch test passed\n'
