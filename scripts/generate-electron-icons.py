#!/usr/bin/env python3
"""Build the macOS app icon from genuine high-resolution artwork.

Usage:
  python3 scripts/generate-electron-icons.py [source.png]

The source defaults to electron/assets/app-icon.png. It must be square and at
least 1024×1024 so the script can never silently upscale a tray-sized image.
The 16×16 and 32×32 menu-bar icons are intentionally maintained separately.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


MIN_APP_ICON_SIZE = 1024
ICONSET_SIZES = (
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
)


def validate_dimensions(width: int, height: int) -> None:
    if width != height:
        raise ValueError(f"App icon source must be square; got {width}×{height}")
    if width < MIN_APP_ICON_SIZE:
        raise ValueError(
            f"App icon source must be at least {MIN_APP_ICON_SIZE}×{MIN_APP_ICON_SIZE}; "
            f"got {width}×{height}"
        )


def image_dimensions(source: Path) -> tuple[int, int]:
    result = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(source)],
        check=True,
        capture_output=True,
        text=True,
    )
    width_match = re.search(r"pixelWidth: (\d+)", result.stdout)
    height_match = re.search(r"pixelHeight: (\d+)", result.stdout)
    if not width_match or not height_match:
        raise ValueError(f"Could not read image dimensions from {source}")
    return int(width_match.group(1)), int(height_match.group(1))


def main() -> None:
    if len(sys.argv) > 2:
        print("Usage: python3 scripts/generate-electron-icons.py [source.png]")
        sys.exit(1)

    assets_dir = Path(__file__).resolve().parent.parent / "electron" / "assets"
    source = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else assets_dir / "app-icon.png"
    if not source.exists():
        print(f"Error: file not found: {source}")
        sys.exit(1)

    try:
        width, height = image_dimensions(source)
        validate_dimensions(width, height)
        _generate_app_icons(source, assets_dir)
    except (subprocess.CalledProcessError, ValueError) as error:
        print(f"Error: {error}")
        sys.exit(1)

    print(f"\nApp icons written to {assets_dir}")


def _generate_app_icons(source: Path, assets_dir: Path) -> None:
    """Create the runtime PNG and packaged ICNS with native macOS tools."""
    assets_dir.mkdir(parents=True, exist_ok=True)
    app_icon_png = assets_dir / "app-icon.png"

    with tempfile.TemporaryDirectory() as temporary_dir:
        normalized_icon = Path(temporary_dir) / "app-icon.png"
        subprocess.run(
            [
                "sips",
                "-z",
                str(MIN_APP_ICON_SIZE),
                str(MIN_APP_ICON_SIZE),
                str(source),
                "--out",
                str(normalized_icon),
            ],
            check=True,
            capture_output=True,
        )
        shutil.copyfile(normalized_icon, app_icon_png)

        iconset = Path(temporary_dir) / "app-icon.iconset"
        iconset.mkdir()
        for filename, size in ICONSET_SIZES:
            subprocess.run(
                [
                    "sips",
                    "-z",
                    str(size),
                    str(size),
                    str(app_icon_png),
                    "--out",
                    str(iconset / filename),
                ],
                check=True,
                capture_output=True,
            )

        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(assets_dir / "app-icon.icns")],
            check=True,
        )

    print(f"  ✓  app-icon.png   ({MIN_APP_ICON_SIZE}×{MIN_APP_ICON_SIZE})")
    print("  ✓  app-icon.icns  (complete Retina icon set)")


if __name__ == "__main__":
    main()
