"""Archive release payloads, including dotfiles, without PowerShell archive overhead."""
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import zipfile


def portable(name):
    if not name or "\\" in name or ":" in name or name.startswith("/"):
        raise ValueError(f"Unsafe archive path: {name}")
    if any(part in ("", ".", "..") for part in name.rstrip("/").split("/")):
        raise ValueError(f"Unsafe archive path: {name}")
    return PurePosixPath(name)


def extract(archive, destination):
    if destination.exists():
        raise FileExistsError(destination)
    with zipfile.ZipFile(archive) as package:
        seen = set()
        for entry in package.infolist():
            portable(entry.filename)
            key = entry.filename.rstrip("/").casefold()
            if key in seen or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError(f"Duplicate or linked archive path: {entry.filename}")
            seen.add(key)
        destination.mkdir()
        package.extractall(destination)


def compress(directory, destination):
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError(f"Invalid payload directory: {directory}")
    with zipfile.ZipFile(destination, "x", zipfile.ZIP_DEFLATED, compresslevel=6) as package:
        for root, directories, files in os.walk(directory, followlinks=False):
            directories.sort()
            for name in directories + sorted(files):
                file = Path(root) / name
                if file.is_symlink():
                    raise ValueError(f"Linked payload path: {file}")
                if name in files:
                    if not file.is_file():
                        raise ValueError(f"Invalid payload file: {file}")
                    relative = file.relative_to(directory.parent).as_posix()
                    portable(relative)
                    package.write(file, relative)


if __name__ == "__main__":
    mode, first, second = sys.argv[1:]
    if mode == "zip":
        compress(Path(first), Path(second))
    elif mode == "extract":
        extract(Path(first), Path(second))
    else:
        raise ValueError(f"Unknown archive operation: {mode}")
