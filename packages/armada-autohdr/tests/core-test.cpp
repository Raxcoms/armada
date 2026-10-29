#include "armada-autohdr.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <new>

static unsigned checks = 0;
static bool measure_allocations = false;
static unsigned allocations = 0;

void *operator new(std::size_t size)
{
    if (measure_allocations)
        ++allocations;
    if (void *pointer = std::malloc(size))
        return pointer;
    throw std::bad_alloc();
}

void operator delete(void *pointer) noexcept { std::free(pointer); }
void operator delete(void *pointer, std::size_t) noexcept { std::free(pointer); }

#define CHECK(condition) do { \
    ++checks; \
    if (!(condition)) { \
        std::fprintf(stderr, "Check failed at line %d: %s\n", __LINE__, #condition); \
        std::exit(1); \
    } \
} while (false)

static bool finite(float value)
{
    return (std::bit_cast<uint32_t>(value) & 0x7f800000u) != 0x7f800000u;
}

static void check_math()
{
    CHECK(armada_autohdr_abi_version() == ARMADA_AUTOHDR_ABI_VERSION);
    for (float sdr : {80.0f, 100.0f, 203.0f, 400.0f})
        for (float peak : {100.0f, 400.0f, 1000.0f, 2000.0f})
        {
            float previous = 0.0f;
            for (unsigned i = 0; i <= 4096; ++i)
            {
                const float value = armada_autohdr_inverse_tone_map(float(i) / 4096.0f, sdr, peak);
                CHECK(finite(value));
                CHECK(value >= previous);
                CHECK(value >= 0.0f && value <= 1.00001f);
                previous = value;
            }
            CHECK(std::fabs(previous - 1.0f) < 0.00001f);
            CHECK(armada_autohdr_inverse_tone_map(2.0f, sdr, peak) == previous);
        }
    CHECK(armada_autohdr_inverse_tone_map(-1.0f, 100.0f, 1000.0f) == 0.0f);
    CHECK(armada_autohdr_inverse_tone_map(1.0f, 0.0f, 1000.0f) == 0.0f);
    CHECK(armada_autohdr_inverse_tone_map(1.0f, 100.0f, 0.0f) == 0.0f);

    const std::array matrices{
        std::array{1.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 1.0f},
        std::array{1.2f, 0.1f, 0.0f, 0.2f, 1.0f, 0.1f, 0.1f, 0.3f, 0.9f},
    };
    for (const auto &matrix : matrices)
        for (float peak : {100.0f, 400.0f, 1000.0f})
        {
            armada_autohdr_transform transform{{}, 100.0f, peak};
            std::copy(matrix.begin(), matrix.end(), transform.native_from_output);
            for (unsigned r = 0; r <= 8; ++r)
                for (unsigned g = 0; g <= 8; ++g)
                    for (unsigned b = 0; b <= 8; ++b)
                    {
                        const armada_autohdr_rgb input{r * peak / 8.0f, g * peak / 8.0f, b * peak / 8.0f};
                        const auto output = armada_autohdr_apply_transform(&transform, input);
                        CHECK(finite(output.r) && finite(output.g) && finite(output.b));
                        const float tolerance = peak * peak * 0.000001f;
                        CHECK(std::fabs(output.r * input.g - output.g * input.r) <= tolerance);
                        CHECK(std::fabs(output.r * input.b - output.b * input.r) <= tolerance);
                        const float native_r = matrix[0] * output.r + matrix[3] * output.g + matrix[6] * output.b;
                        const float native_g = matrix[1] * output.r + matrix[4] * output.g + matrix[7] * output.b;
                        const float native_b = matrix[2] * output.r + matrix[5] * output.g + matrix[8] * output.b;
                        CHECK(std::max({native_r, native_g, native_b}) <= peak + peak * 0.000001f);
                    }
        }
}

static void check_policy()
{
    for (unsigned bits = 0; bits < 256; ++bits)
    {
        const auto flag = [bits](unsigned index) { return uint32_t((bits >> index) & 1); };
        const armada_autohdr_capabilities caps{
            flag(1), flag(2), flag(3), flag(4), flag(5), flag(6), flag(7) * 1000,
        };
        const bool expected = (bits & 0xe7) == 0xc7 && (bits & 0x38) == 0;
        CHECK(bool(armada_autohdr_available(flag(0), &caps)) == expected);
    }
    for (unsigned bits = 0; bits < 16; ++bits)
    {
        const armada_autohdr_content content{bits & 1u, bits & 2u, bits & 4u};
        CHECK(bool(armada_autohdr_active(bits & 8u, &content)) == (bits == 9));
    }
    for (unsigned bits = 0; bits < 32; ++bits)
        CHECK(bool(armada_autohdr_prepare(bits & 1u, bits & 2u, bits & 4u, bits & 8u, bits & 16u)) == (bits == 13));

    armada_autohdr_state state{};
    CHECK(!armada_autohdr_reconcile(&state, 0));
    CHECK(armada_autohdr_reconcile(&state, 1));
    CHECK(state.requested && !state.luts_enabled);
    armada_autohdr_luts_updated(&state);
    for (unsigned i = 0; i < 3000; ++i)
        CHECK(!armada_autohdr_reconcile(&state, 1));
    CHECK(armada_autohdr_reconcile(&state, 0));
    armada_autohdr_luts_updated(&state);
    CHECK(!state.requested && !state.luts_enabled);
    for (uint32_t initial : {0u, 1u})
        for (uint32_t bits = 0; bits < 8; ++bits)
        {
            state.presented = initial;
            armada_autohdr_presented(&state, bits & 1u, bits & 2u, bits & 4u);
            CHECK(armada_autohdr_hdr_presented(&state) == ((bits & 1u) ? bits == 7 : initial));
        }
}

struct ScanoutFixture
{
    std::array<uint64_t, 8> pipelines{};
    std::array<uint64_t, 32> layers{};
    std::array<uint64_t, 8> applied{};
    std::array<int, 8> results{};
    std::array<uint32_t, 8> composition{};
    size_t pipeline_count = 0;
    size_t layer_count = 4;
    unsigned applies = 0;
    unsigned pipeline_reads = 0;
    unsigned unsets = 0;
    unsigned sets = 0;
    uint32_t game_mask = 1;

    armada_autohdr_scanout_ops ops()
    {
        return {
            this, pipeline_count, layer_count,
            [](void *data, size_t index) {
                auto &self = *static_cast<ScanoutFixture *>(data);
                ++self.pipeline_reads;
                return self.pipelines.at(index);
            },
            [](void *data, size_t index) {
                auto &self = *static_cast<ScanoutFixture *>(data);
                ++self.unsets;
                self.layers.at(index) = 0;
            },
            [](void *data, size_t index, uint64_t pipeline) {
                auto &self = *static_cast<ScanoutFixture *>(data);
                ++self.sets;
                self.layers.at(index) = pipeline;
            },
            [](void *data) {
                auto &self = *static_cast<ScanoutFixture *>(data);
                for (size_t i = 0; i < self.layer_count; ++i)
                    if (self.game_mask & (uint32_t(1) << i))
                    {
                        self.applied.at(self.applies) = self.layers.at(i);
                        break;
                    }
                return self.results.at(self.applies++);
            },
            [](void *data) {
                auto &self = *static_cast<ScanoutFixture *>(data);
                return self.composition.at(self.applies - 1);
            },
        };
    }

    int apply(armada_autohdr_scanout_state &state, uint32_t mask)
    {
        game_mask = mask;
        const auto callbacks = ops();
        const unsigned before = allocations;
        measure_allocations = true;
        const int ret = armada_autohdr_scanout_apply(&state, mask, &callbacks);
        measure_allocations = false;
        CHECK(allocations == before);
        return ret;
    }
};

static void check_scanout()
{
    armada_autohdr_scanout_state state{};
    ScanoutFixture choose;
    choose.pipelines = {0, 11, 11, 22};
    choose.pipeline_count = 4;
    choose.layers.fill(99);
    choose.results = {-EINVAL, 0};
    CHECK(choose.apply(state, 5) == 0);
    CHECK(choose.applies == 2 && choose.applied[0] == 11 && choose.applied[1] == 22);
    CHECK(choose.layers[0] == 22 && choose.layers[2] == 22);
    CHECK(choose.layers[1] == 0 && choose.layers[3] == 0);
    CHECK(choose.unsets == 2 && choose.sets == 4 && state.preferred_pipeline == 22);

    ScanoutFixture preferred;
    preferred.pipelines = {11, 22};
    preferred.pipeline_count = 2;
    CHECK(preferred.apply(state, 1) == 0);
    CHECK(preferred.applies == 1 && preferred.applied[0] == 22);

    ScanoutFixture sdr;
    sdr.layers.fill(99);
    CHECK(sdr.apply(state, 0) == 0);
    CHECK(sdr.applies == 1 && !sdr.pipeline_reads && !sdr.sets && sdr.unsets == 4);
    CHECK(state.preferred_pipeline == 22);
    CHECK(std::all_of(sdr.layers.begin(), sdr.layers.begin() + 4, [](auto value) { return value == 0; }));

    ScanoutFixture disappeared;
    disappeared.pipelines = {11};
    disappeared.pipeline_count = 1;
    CHECK(disappeared.apply(state, 1) == 0);
    CHECK(disappeared.applies == 1 && disappeared.applied[0] == 11 && state.preferred_pipeline == 11);

    ScanoutFixture retry;
    state.preferred_pipeline = 22;
    retry.pipelines = {11, 22, 33};
    retry.pipeline_count = 3;
    retry.results = {-EINVAL, 0, 0};
    retry.composition = {0, 1, 0};
    CHECK(retry.apply(state, 1) == 0);
    CHECK(retry.applies == 3 && retry.applied[0] == 22 && retry.applied[1] == 11 && retry.applied[2] == 33);
    CHECK(state.preferred_pipeline == 33);

    ScanoutFixture fatal;
    fatal.pipelines = {33, 11};
    fatal.pipeline_count = 2;
    fatal.results = {-ENOMEM, 0};
    CHECK(fatal.apply(state, 1) == -ENOMEM);
    CHECK(fatal.applies == 1 && state.preferred_pipeline == 0);

    ScanoutFixture fallback;
    fallback.pipelines = {11, 22};
    fallback.pipeline_count = 2;
    fallback.composition = {1, 1};
    CHECK(fallback.apply(state, 1) == -EINVAL);
    CHECK(fallback.applies == 2 && state.preferred_pipeline == 0);

    ScanoutFixture no_pipeline;
    no_pipeline.pipeline_count = 2;
    no_pipeline.results = {-EAGAIN};
    CHECK(no_pipeline.apply(state, 1) == -EAGAIN);
    CHECK(no_pipeline.applies == 1 && !no_pipeline.sets);

    ScanoutFixture last_layer;
    last_layer.layer_count = 32;
    last_layer.pipelines = {44};
    last_layer.pipeline_count = 1;
    CHECK(last_layer.apply(state, uint32_t(1) << 31) == 0);
    CHECK(last_layer.layers[31] == 44 && last_layer.sets == 1 && last_layer.unsets == 31);

    ScanoutFixture too_many_layers;
    too_many_layers.layer_count = 33;
    CHECK(too_many_layers.apply(state, 1) == -EINVAL);
    CHECK(!too_many_layers.applies && !too_many_layers.sets && !too_many_layers.unsets);
}

int main()
{
    check_math();
    check_policy();
    check_scanout();
    std::printf("Passed %u standalone AutoHDR checks\n", checks);
}
