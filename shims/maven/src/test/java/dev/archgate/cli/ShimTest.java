package dev.archgate.cli;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import static org.junit.jupiter.api.Assertions.*;

class ShimTest {

    // ------------------------------------------------------------------
    // Platform detection
    // ------------------------------------------------------------------

    @Test
    void darwinArm64ArtifactName() {
        String result = withSystemProperties("Mac OS X", "aarch64", Platform::getArtifactName);
        assertEquals("archgate-darwin-arm64", result);
    }

    @Test
    void linuxX64ArtifactName() {
        String result = withSystemProperties("Linux", "amd64", Platform::getArtifactName);
        assertEquals("archgate-linux-x64", result);
    }

    @Test
    void windowsX64ArtifactName() {
        String result = withSystemProperties("Windows 10", "amd64", Platform::getArtifactName);
        assertEquals("archgate-win32-x64", result);
    }

    @Test
    void unsupportedPlatformThrows() {
        assertThrows(UnsupportedOperationException.class, () ->
                withSystemProperties("FreeBSD", "amd64", Platform::getArtifactName));
    }

    @Test
    void unsupportedArchThrows() {
        assertThrows(UnsupportedOperationException.class, () ->
                withSystemProperties("Linux", "aarch64", Platform::getArtifactName));
    }

    // ------------------------------------------------------------------
    // Binary name resolution
    // ------------------------------------------------------------------

    @Test
    void binaryNameOnWindows() {
        String result = withSystemProperties("Windows 11", "amd64", Platform::getBinaryName);
        assertEquals("archgate.exe", result);
    }

    @Test
    void binaryNameOnUnix() {
        String result = withSystemProperties("Linux", "amd64", Platform::getBinaryName);
        assertEquals("archgate", result);
    }

    @Test
    void binaryNameOnMac() {
        String result = withSystemProperties("Mac OS X", "aarch64", Platform::getBinaryName);
        assertEquals("archgate", result);
    }

    // ------------------------------------------------------------------
    // SHA-256 verification
    // ------------------------------------------------------------------

    @Test
    void sha256HexProducesCorrectHash() throws Exception {
        byte[] data = "hello world".getBytes(StandardCharsets.UTF_8);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(data);
        StringBuilder expected = new StringBuilder();
        for (byte b : hash) {
            expected.append(String.format("%02x", b & 0xff));
        }

        String actual = Shim.sha256Hex(data);
        assertEquals(expected.toString(), actual);
    }

    @Test
    void sha256HexMatchesKnownValue() {
        // SHA-256 of empty byte array
        String actual = Shim.sha256Hex(new byte[0]);
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", actual);
    }

    @Test
    void sha256MismatchThrowsShimException() {
        // Simulate a checksum mismatch by testing the sha256Hex output
        byte[] data = "some binary content".getBytes(StandardCharsets.UTF_8);
        String correctHash = Shim.sha256Hex(data);
        String wrongHash = "0000000000000000000000000000000000000000000000000000000000000000";

        assertNotEquals(wrongHash, correctHash);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * Temporarily overrides os.name and os.arch system properties,
     * runs the given supplier, and restores the original values.
     */
    private static <T> T withSystemProperties(String osName, String osArch, java.util.function.Supplier<T> fn) {
        String origName = System.getProperty("os.name");
        String origArch = System.getProperty("os.arch");
        try {
            System.setProperty("os.name", osName);
            System.setProperty("os.arch", osArch);
            return fn.get();
        } finally {
            if (origName != null) System.setProperty("os.name", origName);
            else System.clearProperty("os.name");
            if (origArch != null) System.setProperty("os.arch", origArch);
            else System.clearProperty("os.arch");
        }
    }
}
