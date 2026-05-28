package dev.archgate.cli;

import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Platform detection for downloading the correct archgate binary.
 */
public final class Platform {

    private Platform() {}

    /**
     * Returns the platform-specific artifact name used in GitHub Release URLs.
     *
     * @return artifact name such as {@code archgate-darwin-arm64}
     * @throws UnsupportedOperationException if the current platform is not supported
     */
    public static String getArtifactName() {
        String osName = System.getProperty("os.name", "");
        String osArch = System.getProperty("os.arch", "");

        if (osName.startsWith("Mac") && "aarch64".equals(osArch)) {
            return "archgate-darwin-arm64";
        }
        if (osName.startsWith("Linux") && "amd64".equals(osArch)) {
            return "archgate-linux-x64";
        }
        if (osName.startsWith("Windows") && "amd64".equals(osArch)) {
            return "archgate-win32-x64";
        }

        throw new UnsupportedOperationException(
                "Unsupported platform: " + osName + "/" + osArch
                        + "\narchgate supports darwin/arm64, linux/x64, and win32/x64.");
    }

    /**
     * Returns the binary file name for the current platform.
     *
     * @return {@code archgate.exe} on Windows, {@code archgate} otherwise
     */
    public static String getBinaryName() {
        return isWindows() ? "archgate.exe" : "archgate";
    }

    /**
     * Returns the cache directory where the binary is stored.
     *
     * @return path to {@code ~/.archgate/bin}
     */
    public static Path getCacheDir() {
        return Paths.get(System.getProperty("user.home"), ".archgate", "bin");
    }

    /**
     * Returns {@code true} if the current OS is Windows.
     */
    public static boolean isWindows() {
        return System.getProperty("os.name", "").startsWith("Windows");
    }
}
