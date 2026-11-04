"""Copy local product evidence and convert the app's font for video rendering."""
from pathlib import Path
import hashlib
import json
import shutil

PROJECT = Path(__file__).resolve().parent
REPO = PROJECT.parents[1]
ASSETS = PROJECT / "assets"
ASSETS.mkdir(exist_ok=True)

sources = {
    "logo-mark-white.png": "public/brand/logo-mark-white.png",
    "logo-wordmark-black.png": "public/brand/logo-wordmark-black.png",
    "donation.webp": "public/landing/donation.webp",
    "recommendation.webp": "public/landing/recommendation.webp",
    "operations.webp": "public/landing/operations.webp",
    "geist-latin.woff2": "node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
}
manifest = []
for name, relative in sources.items():
    source = REPO / relative
    destination = ASSETS / name
    shutil.copy2(source, destination)
    manifest.append({
        "file": f"assets/{name}",
        "source": relative,
        "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        "kind": "font" if name.endswith("woff2") else "existing product asset",
    })

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
font = TTFont(ASSETS / "geist-latin.woff2")
font.flavor = None
font.save(ASSETS / "Geist.ttf")
for weight, label in [(400, "Regular"), (550, "Medium"), (650, "Bold")]:
    instance = instantiateVariableFont(font, {"wght": weight}, inplace=False)
    instance.save(ASSETS / f"Geist-{label}.ttf")
license_notes = []
for name in font["name"].names:
    if name.nameID in (0, 13, 14):
        value = name.toUnicode()
        if value not in license_notes:
            license_notes.append(value)
(ASSETS / "FONT-LICENSE.txt").write_text("\n\n".join(license_notes) + "\n")
(PROJECT / "asset-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Prepared {len(sources)} source assets and the rendering font.")
