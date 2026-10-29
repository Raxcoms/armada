#ifndef ARMADA_AUTO_HDR_GLSL
#define ARMADA_AUTO_HDR_GLSL

uint auto_hdr_lut_index(uint originalLayer, uint inputEotf) {
    // RCAS remaps offset slots; only the original game layer uses the extra LUT.
    return originalLayer == 0 && textureQueryLevels(s_shaperLut[EOTF_Count]) != 0
        ? EOTF_Count : inputEotf;
}

vec3 apply_layer_color_mgmt(vec3 color, uint offsetLayerIdx, uint colorspaceLayerIdx, uint colorspace);

vec3 apply_layer_color_mgmt(vec3 color, uint layerIdx, uint colorspace) {
    return apply_layer_color_mgmt(color, layerIdx, layerIdx, colorspace);
}

#endif
