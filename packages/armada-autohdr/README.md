`armada-autohdr` builds an independent shared library with a C API. The runtime
RPM installs `libarmada-autohdr.so.1`; the development RPM installs its header,
linker symlink and pkg-config metadata.

```sh
just package armada-autohdr
just package gamescope
```

The core in `src/` accepts plain matrices, luminance values and frame facts.
It owns inverse tone mapping, eligibility, presentation state and pipeline
retry policy. It has no Gamescope, Vulkan or DRM header dependency.

The adapter in `armada_autohdr.h` connects the library to Gamescope's existing SDR
color mapping, LUT builder, frame resources and libliftoff allocation. Its
shader hook selects the converted game's LUT while overlays retain their
standard mapping. Hardware applies the LUT during scanout, with the same
mapping used when Gamescope needs composition.

Gamescope's build installs the library's development RPM and calls
`prepare-gamescope.sh` to register `gamescope.patch` and
the adapter source archive. Only the adapter is compiled into Gamescope.
The integration patch follows Gamescope's numbered patches under its own name.
Changes to the adapter, LUT stage order, layer identity and shader slots still
need review when Gamescope changes.

The disabled setting bypasses library presentation and allocation processing.
Switching it off clears the previous frame's constraints once. Color generation,
allocation and shader selection use separate hooks at their existing stages;
combining them at presentation would replace more of Gamescope's pipeline.

Build and test the library without Gamescope:

```sh
cmake -S packages/armada-autohdr -B /tmp/armada-autohdr-build
cmake --build /tmp/armada-autohdr-build
ctest --test-dir /tmp/armada-autohdr-build --output-on-failure
```

The production build enables fast math to match Gamescope. Configure with
`-DARMADA_AUTOHDR_FAST_MATH=OFF` to test the strict floating-point build.
Compatible updates keep the version 1 C ABI; breaking changes need a new soname.
Gamescope's package hash follows the public header, adapter and integration
hooks. Core-only updates can reuse the existing Gamescope binary.

Run the integration color tests against a fully prepared Gamescope source tree
with the library's development files installed:

```sh
bash packages/armada-autohdr/tests/gamescope-auto-hdr-test.sh /path/to/gamescope
CXXFLAGS='-O2 -ffast-math' bash packages/armada-autohdr/tests/gamescope-auto-hdr-test.sh /path/to/gamescope
```

These tests use the compiler, Catch2 and GLM already required by Gamescope.
They do not verify hardware presentation. Device checks must cover direct
scanout, composition, SDR overlays, native HDR, the disabled setting and a
leased secondary screen.
