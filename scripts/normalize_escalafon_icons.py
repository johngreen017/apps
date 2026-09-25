#!/usr/bin/env python3
"""Reencuadra el icono existente del Escalafón sin alterar su diseño interno.

Fuente: icons-v2/icon-512.png (la imagen oficial ya publicada).
El marco verde queda algo más próximo a la máscara redondeada de iOS, sin
introducir márgenes blancos, ni cortar el escudo, el texto o el marco.
"""
from pathlib import Path
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "escalafon-online"
SOURCE = ROOT / "icons-v2" / "icon-512.png"
DEST = ROOT / "icons-v3"
SIZES = (64, 120, 152, 167, 180, 192, 512)
CROP = 16  # 512 px -> 480 px: conserva la zona segura para el recorte de iOS.
GREEN = (15, 87, 59, 255)

def make_opaque_green(image):
    image = image.convert("RGBA")
    background = Image.new("RGBA", image.size, GREEN)
    background.alpha_composite(image)
    return background.convert("RGB")

def main():
    original = Image.open(SOURCE)
    if original.size != (512, 512):
        raise ValueError(f"Se esperaba una fuente 512x512, se recibió {original.size}")
    base = make_opaque_green(original)
    framed = base.crop((CROP, CROP, 512 - CROP, 512 - CROP))
    DEST.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        icon = framed.resize((size, size), Image.Resampling.LANCZOS)
        out = DEST / f"icon-{size}.png"
        icon.save(out, "PNG", optimize=True)
        assert Image.open(out).size == (size, size)

    # La máscara recortable debe disponer de una zona segura adicional. No se
    # reutiliza la imagen de iPhone como icono maskable de Android.
    safe = Image.new("RGB", (512, 512), GREEN[:3])
    inner = framed.resize((410, 410), Image.Resampling.LANCZOS)
    safe.paste(inner, (51, 51))
    safe.save(DEST / "icon-512-maskable.png", "PNG", optimize=True)

    html_file = ROOT / "index.html"
    html = html_file.read_text(encoding="utf-8")
    assert "icons-v2/" in html or "icons-v3/" in html
    html = html.replace("icons-v2/", "icons-v3/")
    html = html.replace("manifest.webmanifest?v=2", "manifest.webmanifest?v=3")
    import re
    html = re.sub(r"(icons-v3/icon-\d+\.png)\?v=2", r"\1?v=3", html)
    html_file.write_text(html, encoding="utf-8")

    manifest_file = ROOT / "manifest.webmanifest"
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    assert all(icon["src"].startswith(("icons-v2/", "icons-v3/")) for icon in manifest["icons"])
    for icon in manifest["icons"]:
        icon["src"] = icon["src"].replace("icons-v2/", "icons-v3/").replace("?v=2", "?v=3")
        if icon.get("purpose") == "maskable":
            icon["src"] = "icons-v3/icon-512-maskable.png?v=3"
    manifest_file.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # Comprobación de iconos reales y del código que Safari/Android consumen.
    for size in SIZES:
        with Image.open(DEST / f"icon-{size}.png") as icon:
            assert icon.size == (size, size)
            assert icon.mode == "RGB"
    for icon in manifest["icons"]:
        file_path = ROOT / icon["src"].split("?")[0]
        assert file_path.exists()
        with Image.open(file_path) as image:
            assert f"{image.width}x{image.height}" == icon["sizes"]
    assert "icons-v2/" not in html
    assert "icons-v3/icon-180.png?v=3" in html
    print("OK: 7 tamaños, máscara segura, referencias iOS y manifiesto v3.")

if __name__ == "__main__":
    main()
