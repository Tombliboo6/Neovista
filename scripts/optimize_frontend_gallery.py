#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional, Tuple

from PIL import Image, ImageOps


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


@dataclass
class OptimizationResult:
    path: Path
    before_bytes: int
    after_bytes: int
    resized_to: Tuple[int, int]

    @property
    def saved_bytes(self) -> int:
        return self.before_bytes - self.after_bytes


def calculate_resize_size(width: int, height: int, max_edge: int) -> Tuple[int, int]:
    if width <= 0 or height <= 0:
        raise ValueError("Image dimensions must be positive")

    longest_edge = max(width, height)
    if longest_edge <= max_edge:
        return width, height

    scale = max_edge / float(longest_edge)
    return max(1, round(width * scale)), max(1, round(height * scale))


def iter_gallery_images(gallery_dir: Path) -> Iterable[Path]:
    for path in sorted(gallery_dir.iterdir()):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
            yield path


def backup_image(path: Path, gallery_dir: Path, backup_dir: Optional[Path]) -> None:
    if backup_dir is None:
        return

    destination = backup_dir / path.relative_to(gallery_dir)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        shutil.copy2(path, destination)


def optimize_image(
    path: Path,
    *,
    gallery_dir: Path,
    max_edge: int,
    jpeg_quality: int,
    png_colors: int,
    backup_dir: Optional[Path],
    dry_run: bool,
) -> OptimizationResult:
    before_bytes = path.stat().st_size

    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        target_size = calculate_resize_size(image.width, image.height, max_edge)
        if target_size != (image.width, image.height):
            image = image.resize(target_size, Image.Resampling.LANCZOS)

        if dry_run:
            return OptimizationResult(path, before_bytes, before_bytes, target_size)

        backup_image(path, gallery_dir, backup_dir)

        suffix = path.suffix.lower()
        if suffix in {".jpg", ".jpeg"}:
            if "A" in image.getbands():
                background = Image.new("RGB", image.size, (255, 255, 255))
                background.paste(image, mask=image.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")
            image.save(path, quality=jpeg_quality, optimize=True, progressive=True)
        elif suffix == ".png":
            if "A" in image.getbands():
                image = image.convert("RGBA").quantize(
                    colors=png_colors,
                    method=Image.Quantize.FASTOCTREE,
                )
            else:
                image = image.convert("RGB").quantize(
                    colors=png_colors,
                    method=Image.Quantize.MEDIANCUT,
                )
            image.save(path, optimize=True)
        else:
            raise ValueError(f"Unsupported image type: {path}")

    return OptimizationResult(path, before_bytes, path.stat().st_size, target_size)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Resize and compress frontend public gallery images.")
    parser.add_argument(
        "--gallery-dir",
        type=Path,
        default=Path("frontend/public/gallery"),
        help="Gallery directory to optimize in place.",
    )
    parser.add_argument("--max-edge", type=int, default=1200, help="Maximum width or height in pixels.")
    parser.add_argument("--jpeg-quality", type=int, default=78, help="JPEG quality, 1-95.")
    parser.add_argument("--png-colors", type=int, default=256, help="PNG adaptive palette size.")
    parser.add_argument("--backup-dir", type=Path, default=None, help="Optional backup directory.")
    parser.add_argument("--dry-run", action="store_true", help="Print planned changes without writing files.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    gallery_dir = args.gallery_dir.resolve()
    if not gallery_dir.is_dir():
        raise SystemExit(f"Gallery directory not found: {gallery_dir}")

    backup_dir = args.backup_dir.resolve() if args.backup_dir else None
    results = [
        optimize_image(
            path,
            gallery_dir=gallery_dir,
            max_edge=args.max_edge,
            jpeg_quality=args.jpeg_quality,
            png_colors=args.png_colors,
            backup_dir=backup_dir,
            dry_run=args.dry_run,
        )
        for path in iter_gallery_images(gallery_dir)
    ]

    before = sum(result.before_bytes for result in results)
    after = sum(result.after_bytes for result in results)
    print(f"processed={len(results)}")
    print(f"before_bytes={before}")
    print(f"after_bytes={after}")
    print(f"saved_bytes={before - after}")
    if backup_dir:
        print(f"backup_dir={backup_dir}")

    largest = sorted(results, key=lambda result: result.after_bytes, reverse=True)[:10]
    for result in largest:
        print(
            f"{result.path.name}: {result.before_bytes} -> {result.after_bytes} "
            f"({result.resized_to[0]}x{result.resized_to[1]})"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
