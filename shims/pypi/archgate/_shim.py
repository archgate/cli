"""Thin shim that downloads the archgate binary from GitHub Releases on first
invocation and then executes it.  Zero runtime dependencies — stdlib only."""

from __future__ import annotations

import hashlib
import os
import platform
import stat
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from archgate._version import __version__

# ---------------------------------------------------------------------------
# Platform helpers
# ---------------------------------------------------------------------------

_PLATFORM_MAP = {
    ("Darwin", "arm64"): "archgate-darwin-arm64",
    ("Darwin", "aarch64"): "archgate-darwin-arm64",
    ("Linux", "x86_64"): "archgate-linux-x64",
    ("Linux", "AMD64"): "archgate-linux-x64",
    ("Windows", "AMD64"): "archgate-win32-x64",
    ("Windows", "x86_64"): "archgate-win32-x64",
}


def _detect_artifact():  # type: () -> str
    os_name = platform.system()
    arch = platform.machine()
    key = (os_name, arch)
    artifact = _PLATFORM_MAP.get(key)
    if artifact is None:
        print(
            "archgate: Unsupported platform: {os}/{arch}\n"
            "archgate supports darwin/arm64, linux/x64, and win32/x64.".format(
                os=os_name, arch=arch
            ),
            file=sys.stderr,
        )
        sys.exit(2)
    return artifact


def _binary_name():  # type: () -> str
    return "archgate.exe" if platform.system() == "Windows" else "archgate"


def _archive_ext():  # type: () -> str
    return "zip" if platform.system() == "Windows" else "tar.gz"


# ---------------------------------------------------------------------------
# Download / verification
# ---------------------------------------------------------------------------

_BASE_URL = "https://github.com/archgate/cli/releases/download"


def _download_url(artifact, ext):  # type: (str, str) -> str
    return "{base}/v{ver}/{artifact}.{ext}".format(
        base=_BASE_URL, ver=__version__, artifact=artifact, ext=ext
    )


def _checksum_url(artifact, ext):  # type: (str, str) -> str
    return _download_url(artifact, ext) + ".sha256"


def _fetch(url):  # type: (str) -> bytes
    resp = urlopen(url)  # noqa: S310 — follows redirects automatically
    return resp.read()


def _verify_checksum(archive_bytes, artifact, ext):
    # type: (bytes, str, str) -> None
    """Download the .sha256 companion file and verify the archive."""
    try:
        checksum_bytes = _fetch(_checksum_url(artifact, ext))
    except (URLError, OSError):
        print(
            "archgate: checksum file unavailable, skipping verification.",
            file=sys.stderr,
        )
        return

    expected = checksum_bytes.decode("utf-8").strip()[:64]
    actual = hashlib.sha256(archive_bytes).hexdigest()
    if expected != actual:
        print(
            "archgate: checksum verification failed for v{ver} "
            "(expected {exp}, got {act})".format(
                ver=__version__, exp=expected, act=actual
            ),
            file=sys.stderr,
        )
        sys.exit(2)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------


def _extract(archive_bytes, ext, dest_dir):
    # type: (bytes, str, Path) -> None
    """Extract archive into *dest_dir*."""
    if ext == "tar.gz":
        with tarfile.open(fileobj=BytesIO(archive_bytes), mode="r:gz") as tar:
            tar.extractall(path=str(dest_dir))
    else:
        with zipfile.ZipFile(BytesIO(archive_bytes)) as zf:
            zf.extractall(path=str(dest_dir))


# ---------------------------------------------------------------------------
# Main entry-point
# ---------------------------------------------------------------------------


def main():  # type: () -> None
    cache_dir = Path.home() / ".archgate" / "bin"
    binary = cache_dir / _binary_name()

    if not binary.exists():
        artifact = _detect_artifact()
        ext = _archive_ext()
        url = _download_url(artifact, ext)

        print(
            "archgate: binary not found, downloading v{ver}...".format(
                ver=__version__
            ),
            file=sys.stderr,
        )

        try:
            archive_bytes = _fetch(url)
        except (URLError, OSError) as exc:
            print(
                "archgate: failed to download binary: {detail}\n"
                "Visit https://cli.archgate.dev/getting-started/installation/ "
                "for alternative install methods.".format(detail=exc),
                file=sys.stderr,
            )
            sys.exit(2)

        _verify_checksum(archive_bytes, artifact, ext)

        # Extract into a temporary directory, then move the binary into the
        # cache so we never leave a half-written file in place.
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            _extract(archive_bytes, ext, tmp_path)

            # The binary may sit at the root of the archive or inside a
            # single top-level directory — search for it.
            bin_name = _binary_name()
            candidates = list(tmp_path.rglob(bin_name))
            if not candidates:
                print(
                    "archgate: failed to locate binary inside the archive.",
                    file=sys.stderr,
                )
                sys.exit(2)

            cache_dir.mkdir(parents=True, exist_ok=True)

            src = candidates[0]
            # On Windows, rename requires the destination not to exist.
            if binary.exists():
                binary.unlink()

            # Copy instead of rename to handle cross-device moves.
            import shutil

            shutil.copy2(str(src), str(binary))

            # Set executable permission on Unix.
            if platform.system() != "Windows":
                binary.chmod(binary.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

        print("archgate: binary downloaded successfully.", file=sys.stderr)

    result = subprocess.run([str(binary)] + sys.argv[1:])
    sys.exit(result.returncode)
