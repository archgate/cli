"""Unit tests for the archgate PyPI shim.  Uses only the stdlib unittest module."""

from __future__ import annotations

import hashlib
import sys
from unittest import TestCase, main, mock

# ---------------------------------------------------------------------------
# Ensure the package is importable regardless of working directory.
# ---------------------------------------------------------------------------
from pathlib import Path

_PKG_ROOT = str(Path(__file__).resolve().parent.parent)
if _PKG_ROOT not in sys.path:
    sys.path.insert(0, _PKG_ROOT)

from archgate._shim import (  # noqa: E402
    _PLATFORM_MAP,
    _archive_ext,
    _binary_name,
    _detect_artifact,
    _verify_checksum,
)


class TestPlatformDetection(TestCase):
    """Verify the platform → artifact mapping."""

    def test_darwin_arm64(self):
        with mock.patch("archgate._shim.platform") as mp:
            mp.system.return_value = "Darwin"
            mp.machine.return_value = "arm64"
            self.assertEqual(_detect_artifact(), "archgate-darwin-arm64")

    def test_darwin_aarch64(self):
        with mock.patch("archgate._shim.platform") as mp:
            mp.system.return_value = "Darwin"
            mp.machine.return_value = "aarch64"
            self.assertEqual(_detect_artifact(), "archgate-darwin-arm64")

    def test_linux_x86_64(self):
        with mock.patch("archgate._shim.platform") as mp:
            mp.system.return_value = "Linux"
            mp.machine.return_value = "x86_64"
            self.assertEqual(_detect_artifact(), "archgate-linux-x64")

    def test_linux_amd64(self):
        with mock.patch("archgate._shim.platform") as mp:
            mp.system.return_value = "Linux"
            mp.machine.return_value = "AMD64"
            self.assertEqual(_detect_artifact(), "archgate-linux-x64")

    def test_windows_amd64(self):
        with mock.patch("archgate._shim.platform") as mp:
            mp.system.return_value = "Windows"
            mp.machine.return_value = "AMD64"
            self.assertEqual(_detect_artifact(), "archgate-win32-x64")

    def test_windows_x86_64(self):
        with mock.patch("archgate._shim.platform") as mp:
            mp.system.return_value = "Windows"
            mp.machine.return_value = "x86_64"
            self.assertEqual(_detect_artifact(), "archgate-win32-x64")

    def test_unsupported_platform_exits(self):
        with mock.patch("archgate._shim.platform") as mp:
            mp.system.return_value = "FreeBSD"
            mp.machine.return_value = "i386"
            with self.assertRaises(SystemExit) as ctx:
                _detect_artifact()
            self.assertEqual(ctx.exception.code, 2)


class TestArtifactNaming(TestCase):
    """Verify artifact name, binary name, and archive extension."""

    def test_artifact_names_in_platform_map(self):
        expected_artifacts = {
            "archgate-darwin-arm64",
            "archgate-linux-x64",
            "archgate-win32-x64",
        }
        self.assertEqual(set(_PLATFORM_MAP.values()), expected_artifacts)

    def test_binary_name_windows(self):
        with mock.patch("archgate._shim.platform") as mp:
            mp.system.return_value = "Windows"
            self.assertEqual(_binary_name(), "archgate.exe")

    def test_binary_name_unix(self):
        for os_name in ("Darwin", "Linux"):
            with mock.patch("archgate._shim.platform") as mp:
                mp.system.return_value = os_name
                self.assertEqual(_binary_name(), "archgate")

    def test_archive_ext_windows(self):
        with mock.patch("archgate._shim.platform") as mp:
            mp.system.return_value = "Windows"
            self.assertEqual(_archive_ext(), "zip")

    def test_archive_ext_unix(self):
        for os_name in ("Darwin", "Linux"):
            with mock.patch("archgate._shim.platform") as mp:
                mp.system.return_value = os_name
                self.assertEqual(_archive_ext(), "tar.gz")


class TestChecksumVerification(TestCase):
    """Verify SHA256 checksum logic."""

    def test_checksum_pass(self):
        data = b"hello archgate"
        expected_hash = hashlib.sha256(data).hexdigest()
        checksum_content = (expected_hash + "  archgate-linux-x64.tar.gz\n").encode()

        with mock.patch("archgate._shim._fetch", return_value=checksum_content):
            # Should not raise or exit.
            _verify_checksum(data, "archgate-linux-x64", "tar.gz")

    def test_checksum_mismatch_exits(self):
        data = b"hello archgate"
        wrong_hash = hashlib.sha256(b"wrong data").hexdigest()
        checksum_content = (wrong_hash + "  archgate-linux-x64.tar.gz\n").encode()

        with mock.patch("archgate._shim._fetch", return_value=checksum_content):
            with self.assertRaises(SystemExit) as ctx:
                _verify_checksum(data, "archgate-linux-x64", "tar.gz")
            self.assertEqual(ctx.exception.code, 2)

    def test_checksum_unavailable_warns(self):
        """When the checksum file can't be fetched, warn but don't exit."""
        from urllib.error import URLError

        data = b"hello archgate"

        with mock.patch("archgate._shim._fetch", side_effect=URLError("404")):
            # Should not raise or exit.
            _verify_checksum(data, "archgate-linux-x64", "tar.gz")


if __name__ == "__main__":
    main()
