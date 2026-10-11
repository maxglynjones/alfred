"""Build a reproducible install archive containing only Alfred HA source."""

from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1] / "integrations/home-assistant"
with zipfile.ZipFile(root / "alfred-ha.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for path in sorted((root / "custom_components/alfred").rglob("*")):
        if (
            path.is_file()
            and path.suffix
            in (
                ".py",
                ".json",
                ".js",
                ".css",
                ".html",
                ".svg",
                ".png",
                ".ttf",
                ".webmanifest",
                ".md",
                ".txt",
            )
            and "__pycache__" not in path.parts
        ):
            info = zipfile.ZipInfo(str(path.relative_to(root)), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
print("Built integrations/home-assistant/alfred-ha.zip")
