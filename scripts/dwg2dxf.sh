#!/usr/bin/env bash
#
# dwg2dxf.sh — batch-convert .dwg files to ASCII .dxf, locally, with no
# upload anywhere. Wraps GNU LibreDWG's `dwg2dxf` CLI (already installed on
# this machine at /home/artwalk/.local/bin/dwg2dxf).
#
# DWG is Autodesk's closed binary format, so this — like every non-Autodesk
# converter — is on a best-effort basis: LibreDWG reconstructs geometry,
# layers, blocks and text reliably, but silently drops things it doesn't
# model (extended entity data / reactors / xdicts, some proxy/civil objects,
# dynamic-block parameters). It printed harmless "Unknown object, skipping
# eed/reactors/xdic" warnings on the sample file this was tested against —
# that's normal. Spot-check anything geometry-critical in a DXF viewer
# before relying on the output; for drawings that convert badly, the two
# fallbacks are the free ODA File Converter (opendesign.com) or, if you have
# AutoCAD/Civil 3D installed, scripting DXFOUT there instead (native fidelity).
#
# Usage:
#   scripts/dwg2dxf.sh <dir-or-file> [<dir-or-file> ...] [options]
#
# Options:
#   -o, --out DIR       Write .dxf files here instead of next to each .dwg.
#                        Directory structure under each input dir is preserved.
#   -y, --overwrite      Overwrite an existing .dxf (default: skip it).
#       --as VERSION     DXF version to write: r12 r14 r2000 r2004 r2007
#                        r2010 r2013 r2018 (default: r2000 — broadly readable,
#                        and what this app's own DXF tools expect).
#   -v                   Verbose: show dwg2dxf's own per-file warnings too.
#   -h, --help           Show this help.
#
# Examples:
#   scripts/dwg2dxf.sh ~/Downloads/PlanSet.dwg
#   scripts/dwg2dxf.sh ~/Downloads/Project -o ~/Downloads/Project-dxf
#   scripts/dwg2dxf.sh ~/Downloads/*.dwg -y --as r2010
#
usage() { sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'; }

set -u

DWG2DXF_BIN="${DWG2DXF_BIN:-$(command -v dwg2dxf || true)}"
[ -z "$DWG2DXF_BIN" ] && [ -x "$HOME/.local/bin/dwg2dxf" ] && DWG2DXF_BIN="$HOME/.local/bin/dwg2dxf"

OUT_DIR=""
OVERWRITE=0
DXF_VERSION="r2000"
VERBOSE=0
INPUTS=()

while [ $# -gt 0 ]; do
    case "$1" in
        -o|--out) OUT_DIR="$2"; shift 2 ;;
        -y|--overwrite) OVERWRITE=1; shift ;;
        --as) DXF_VERSION="$2"; shift 2 ;;
        -v) VERBOSE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) INPUTS+=("$1"); shift ;;
    esac
done

if [ ${#INPUTS[@]} -eq 0 ]; then
    echo "Usage: $0 <dir-or-file> [<dir-or-file> ...] [-o DIR] [-y] [--as VERSION] [-v]" >&2
    echo "Run '$0 --help' for details." >&2
    exit 2
fi

if [ -z "$DWG2DXF_BIN" ]; then
    cat >&2 <<'EOF'
dwg2dxf not found on PATH.

Install it (Debian/Ubuntu):  sudo apt install libredwg-tools
Or build from source:        https://www.gnu.org/software/libredwg/
Or use the free ODA File Converter instead: https://www.opendesign.com/guestfiles/oda_file_converter
EOF
    exit 1
fi

# ── Collect .dwg files (case-insensitive extension), directories recursed.
# RELDIRS[i] is the path of FILES[i] relative to the directory it was found
# under (empty for a file passed directly on the command line) — used below
# to mirror subfolder structure under -o/--out instead of flattening every
# file into one directory, which would silently collide same-named DWGs
# from different subfolders.
FILES=()
RELDIRS=()
for input in "${INPUTS[@]}"; do
    if [ -d "$input" ]; then
        while IFS= read -r -d '' f; do
            FILES+=("$f")
            reldir="$(dirname "${f#"$input"/}")"
            [ "$reldir" = "." ] && reldir=""
            RELDIRS+=("$reldir")
        done < <(find "$input" -type f \( -iname "*.dwg" \) -print0)
    elif [ -f "$input" ]; then
        FILES+=("$input")
        RELDIRS+=("")
    else
        echo "warn: not found, skipping: $input" >&2
    fi
done

if [ ${#FILES[@]} -eq 0 ]; then
    echo "No .dwg files found in the given input(s)." >&2
    exit 1
fi

converted=0; skipped=0; failed=0
declare -a fail_list=()

for i in "${!FILES[@]}"; do
    src="${FILES[$i]}"
    reldir="${RELDIRS[$i]}"
    base="$(basename "${src%.*}")"
    if [ -n "$OUT_DIR" ]; then
        destdir="$OUT_DIR${reldir:+/$reldir}"
        mkdir -p "$destdir"
        dst="$destdir/$base.dxf"
    else
        dst="$(dirname "$src")/$base.dxf"
    fi

    if [ -f "$dst" ] && [ "$OVERWRITE" -ne 1 ]; then
        echo "skip   (exists): $dst"
        skipped=$((skipped + 1))
        continue
    fi

    args=(--as "$DXF_VERSION" -o "$dst")
    [ "$OVERWRITE" -eq 1 ] && args+=(-y)

    if [ "$VERBOSE" -eq 1 ]; then
        out="$("$DWG2DXF_BIN" "${args[@]}" "$src" 2>&1)"
    else
        out="$("$DWG2DXF_BIN" "${args[@]}" "$src" 2>&1 | grep -v 'Unknown object, skipping eed/reactors/xdic')"
    fi
    rc=$?

    if [ -f "$dst" ]; then
        echo "ok     : $src -> $dst"
        [ -n "$out" ] && [ "$VERBOSE" -eq 1 ] && echo "$out" | sed 's/^/         /'
        converted=$((converted + 1))
    else
        echo "FAILED : $src"
        echo "$out" | sed 's/^/         /'
        failed=$((failed + 1))
        fail_list+=("$src")
    fi
done

echo
echo "════════════════════════════════════════"
echo " converted: $converted   skipped: $skipped   failed: $failed"
echo "════════════════════════════════════════"
if [ ${#fail_list[@]} -gt 0 ]; then
    echo "Files that failed (try the ODA File Converter for these):"
    printf '  %s\n' "${fail_list[@]}"
fi

[ "$failed" -eq 0 ]
