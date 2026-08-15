from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

root = Path(__file__).resolve().parents[1] / "assets" / "expressions"

for path in root.glob("*.png"):
    image = Image.open(path).convert("RGB")
    rgb = np.asarray(image, dtype=np.float32)
    h, w, _ = rgb.shape
    yy, xx = np.mgrid[0:h, 0:w]
    x = xx / max(1, w - 1)
    y = yy / max(1, h - 1)
    terms = np.stack([np.ones_like(x), x, y, x*x, y*y, x*y], axis=-1)
    border = (xx < w*.09) | (xx > w*.91) | (yy < h*.07) | (yy > h*.93)
    design = terms[border]
    fitted = np.empty_like(rgb)
    for channel in range(3):
        coef, *_ = np.linalg.lstsq(design, rgb[..., channel][border], rcond=None)
        fitted[..., channel] = terms @ coef
    difference = np.sqrt(np.mean((rgb - fitted) ** 2, axis=2))
    alpha = np.clip((difference - 17) / 35, 0, 1)
    # The character occupies the central region; suppress uncertain edge haze.
    edge_distance = np.minimum.reduce([xx, yy, w-1-xx, h-1-yy]).astype(np.float32)
    alpha *= np.clip(edge_distance / 14, 0, 1)
    mask = Image.fromarray(np.uint8(alpha * 255), "L")
    mask = mask.filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.GaussianBlur(.65))
    rgba = image.convert("RGBA")
    rgba.putalpha(mask)
    box = mask.getbbox()
    if box:
        pad = 5
        box = (max(0, box[0]-pad), max(0, box[1]-pad), min(w, box[2]+pad), min(h, box[3]+pad))
        rgba = rgba.crop(box)
    rgba.save(path)
    print(path.name, rgba.size, rgba.getchannel("A").getextrema())
