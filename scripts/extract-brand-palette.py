import io
from collections import Counter

import requests
from PIL import Image


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    r, g, b = rgb
    return f"#{r:02x}{g:02x}{b:02x}"


def dominant_palette_from_image_bytes(data: bytes, *, colors: int = 10) -> list[tuple[int, tuple[int, int, int]]]:
    img = Image.open(io.BytesIO(data)).convert("RGBA")

    # Downscale for speed and stability
    img = img.resize((192, 192))

    pixels = [p for p in img.getdata() if p[3] > 20]
    if not pixels:
        return []

    flat = Image.new("RGB", (len(pixels), 1))
    flat.putdata([(r, g, b) for (r, g, b, a) in pixels])

    pal = flat.quantize(colors=colors, method=Image.Quantize.MEDIANCUT).convert("RGB")
    raw = pal.getcolors(maxcolors=100000) or []
    raw.sort(key=lambda x: x[0], reverse=True)
    return raw


def main() -> None:
    # Found in visolux.com.my HTML as the VISOLUX icon/logo.
    url = "https://lh3.googleusercontent.com/LvjLKZYLJuUL0BEr_81HM9GFcdgNiv-f-w1EvWCuz6DIz140lJNScrzUVKtD8hvFYmWOEk3Lh7miicg0UtPVgLti1aXxFZRumaV2z1aVAihErG4h9E0J2yA=s120"

    resp = requests.get(url, timeout=30)
    resp.raise_for_status()

    palette = dominant_palette_from_image_bytes(resp.content, colors=12)

    print(f"Source image: {url}")
    print("Top palette colors (count, hex, rgb):")
    for count, rgb in palette[:12]:
        print(f"{count:6d} {rgb_to_hex(rgb)} {rgb}")

    # Heuristic: exclude near-white and near-black for primary/accents
    def lum(rgb: tuple[int, int, int]) -> float:
        r, g, b = rgb
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    candidates = []
    for count, rgb in palette:
        l = lum(rgb)
        if l > 245 or l < 25:
            continue
        candidates.append((count, rgb, l))

    print("\nCandidate brand colors (non-white/black):")
    for count, rgb, l in candidates[:8]:
        print(f"{count:6d} {rgb_to_hex(rgb)} lum={l:.1f} rgb={rgb}")


if __name__ == "__main__":
    main()
