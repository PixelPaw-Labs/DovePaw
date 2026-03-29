#!/usr/bin/env python3
"""
Extract tray and app icons from an ICO file for the DovePaw A2A menubar app.

Usage:
  python3 scripts/generate-electron-icons.py <source.ico>

Outputs to electron/assets/:
  icon.png          16×16  full-color  (servers healthy)
  icon@2x.png       32×32  full-color  (retina)
  iconError.png     16×16  grayscale   (servers down)
  iconError@2x.png  32×32  grayscale   (retina)
  app-icon.icns             macOS app icon for packaged build

Requires: pip install pillow
"""

import os
import sys
from PIL import Image


def extract(ico: Image.Image, size: int) -> Image.Image:
    ico.size = (size, size)
    return ico.convert("RGBA")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/generate-electron-icons.py <source.ico>")
        sys.exit(1)

    source = sys.argv[1]
    if not os.path.exists(source):
        print(f"Error: file not found: {source}")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    assets_dir = os.path.normpath(os.path.join(script_dir, "..", "electron", "assets"))
    os.makedirs(assets_dir, exist_ok=True)

    # Tray icons — extract directly, no processing
    tray_icons = [
        ("icon.png", 16, False),
        ("icon@2x.png", 32, False),
        ("iconError.png", 16, True),
        ("iconError@2x.png", 32, True),
    ]
    for filename, size, grayscale in tray_icons:
        img = extract(Image.open(source), size)
        if grayscale:
            img = img.convert("LA").convert("RGBA")
        img.save(os.path.join(assets_dir, filename), "PNG")
        print(f"  ✓  {filename}  ({size}×{size}{'  grayscale' if grayscale else ''})")

    # App icon (.icns) — use largest available size, scale up as needed
    _generate_icns(source, assets_dir)

    print(f"\nIcons written to {assets_dir}")


def _generate_icns(source: str, assets_dir: str) -> None:
    """Build app-icon.icns using macOS iconutil."""
    import subprocess, shutil, tempfile

    ico = Image.open(source)
    available = sorted(ico.info.get("sizes", {ico.size}), key=lambda s: s[0])
    largest_size = available[-1][0]
    ico.size = (largest_size, largest_size)
    base = ico.convert("RGBA")

    iconset = tempfile.mkdtemp(suffix=".iconset")
    for size in [16, 32, 64, 128, 256, 512]:
        base.resize((size, size), Image.LANCZOS).save(
            os.path.join(iconset, f"icon_{size}x{size}.png")
        )
        base.resize((size * 2, size * 2), Image.LANCZOS).save(
            os.path.join(iconset, f"icon_{size}x{size}@2x.png")
        )

    icns_path = os.path.join(assets_dir, "app-icon.icns")
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns_path], check=True)
    shutil.rmtree(iconset)
    print(f"  ✓  app-icon.icns  (from {largest_size}×{largest_size})")


if __name__ == "__main__":
    main()
