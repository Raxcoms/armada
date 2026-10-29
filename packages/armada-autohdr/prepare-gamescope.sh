#!/usr/bin/env bash
set -euo pipefail

component_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
spec=$(realpath -- "${1:?usage: prepare-gamescope.sh <gamescope-spec>}")
package_dir=$(dirname -- "$spec")

tar -C "$component_dir" -cf "$package_dir/armada-autohdr-adapter.tar" armada_autohdr.h armada_autohdr.glsl
install -m0644 "$component_dir/gamescope.patch" "$package_dir/"

# Register AutoHDR after Gamescope's ordinary patch stack.
awk '
    !added && /^BuildRequires:/ {
        print "Source:        armada-autohdr-adapter.tar"
        print "Patch:         gamescope.patch"
        print "BuildRequires: pkgconfig(armada-autohdr) >= 0.1.0"
        print ""
        added = 1
    }
    { print }
    /^%auto(patch|setup)([[:space:]]|$)/ {
        print "tar -xf %{_sourcedir}/armada-autohdr-adapter.tar -C src"
        prepared = 1
    }
    END {
        if (!added || !prepared) {
            print "Unsupported Gamescope spec: missing build requirements or prep command" > "/dev/stderr"
            exit 1
        }
    }
' "$spec" >"$spec.autohdr"
mv -- "$spec.autohdr" "$spec"
