#include "armada-autohdr.h"

int main(void)
{
    const armada_autohdr_transform transform = {
        {1.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 1.0f},
        100.0f, 1000.0f,
    };
    const armada_autohdr_capabilities caps = {1, 1, 0, 0, 0, 1, 1000};
    const armada_autohdr_content content = {1, 0, 0};
    const armada_autohdr_rgb input = {100.0f, 50.0f, 25.0f};
    armada_autohdr_state state = {0};
    armada_autohdr_rgb output = armada_autohdr_apply_transform(&transform, input);
    if (armada_autohdr_abi_version() != ARMADA_AUTOHDR_ABI_VERSION ||
        !armada_autohdr_available(1, &caps) || !armada_autohdr_active(1, &content) ||
        !armada_autohdr_reconcile(&state, 1) || !(output.r > output.g && output.g > output.b))
        return 1;
    armada_autohdr_luts_updated(&state);
    armada_autohdr_presented(&state, 1, 1, armada_autohdr_prepare(1, 0, 1, 1, 0));
    return !state.luts_enabled || !armada_autohdr_hdr_presented(&state);
}
