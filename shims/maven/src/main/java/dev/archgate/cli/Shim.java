package dev.archgate.cli;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.zip.GZIPInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Thin shim that downloads the archgate platform binary from GitHub Releases
 * on first invocation, caches it locally, and then executes it.
 *
 * <p>Zero external dependencies -- Java 11 standard library only.</p>
 */
public final class Shim {

    private static final String VERSION = "0.45.0";
    private static final String BASE_URL = "https://github.com/archgate/cli/releases/download/v" + VERSION + "/";

    private Shim() {}

    public static void main(String[] args) {
        try {
            Path binary = resolveBinary();
            execute(binary, args);
        } catch (ShimException e) {
            System.err.println(e.getMessage());
            System.exit(2);
        } catch (Exception e) {
            System.err.println("archgate: failed to download binary: " + e.getMessage()
                    + "\nVisit https://cli.archgate.dev/getting-started/installation/ for alternative install methods.");
            System.exit(2);
        }
    }

    // ------------------------------------------------------------------
    // Binary resolution
    // ------------------------------------------------------------------

    static Path resolveBinary() throws Exception {
        Path cacheDir = Platform.getCacheDir();
        String binaryName = Platform.getBinaryName();
        Path binaryPath = cacheDir.resolve(binaryName);

        if (Files.isRegularFile(binaryPath)) {
            return binaryPath;
        }

        System.err.println("archgate: binary not found, downloading v" + VERSION + "...");

        Files.createDirectories(cacheDir);

        String artifactName = Platform.getArtifactName();
        boolean isWindows = Platform.isWindows();
        String ext = isWindows ? "zip" : "tar.gz";
        String archiveUrl = BASE_URL + artifactName + "." + ext;
        String checksumUrl = archiveUrl + ".sha256";

        HttpClient client = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();

        byte[] archiveBytes = download(client, archiveUrl);

        verifySha256(client, checksumUrl, archiveBytes);

        byte[] binaryBytes;
        if (isWindows) {
            binaryBytes = extractFromZip(archiveBytes, binaryName);
        } else {
            binaryBytes = extractFromTarGz(archiveBytes, binaryName);
        }

        Files.write(binaryPath, binaryBytes);

        if (!isWindows) {
            setPosixExecutable(binaryPath);
        }

        System.err.println("archgate: binary downloaded successfully.");
        return binaryPath;
    }

    // ------------------------------------------------------------------
    // HTTP download
    // ------------------------------------------------------------------

    static byte[] download(HttpClient client, String url) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("User-Agent", "archgate-cli-java")
                .GET()
                .build();

        HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
        if (response.statusCode() != 200) {
            throw new IOException("GET " + url + " returned status " + response.statusCode());
        }
        return response.body();
    }

    // ------------------------------------------------------------------
    // SHA-256 verification
    // ------------------------------------------------------------------

    static void verifySha256(HttpClient client, String checksumUrl, byte[] data) throws Exception {
        byte[] checksumBytes;
        try {
            checksumBytes = download(client, checksumUrl);
        } catch (Exception e) {
            System.err.println("archgate: warning: checksum file not available, skipping verification");
            return;
        }

        String checksumContent = new String(checksumBytes, StandardCharsets.UTF_8).trim();
        String expectedHash = checksumContent.split("\\s+")[0];
        String actualHash = sha256Hex(data);

        if (!expectedHash.equals(actualHash)) {
            throw new ShimException(
                    "archgate: checksum verification failed for v" + VERSION
                            + " (expected " + expectedHash + ", got " + actualHash + ")");
        }
    }

    static String sha256Hex(byte[] data) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(data);
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                sb.append(String.format("%02x", b & 0xff));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 algorithm not available", e);
        }
    }

    // ------------------------------------------------------------------
    // tar.gz extraction (inline tar parser)
    // ------------------------------------------------------------------

    static byte[] extractFromTarGz(byte[] archiveBytes, String binaryName) throws IOException {
        byte[] tarBytes;
        try (InputStream bais = new java.io.ByteArrayInputStream(archiveBytes);
             GZIPInputStream gzis = new GZIPInputStream(bais);
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = gzis.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            tarBytes = baos.toByteArray();
        }

        int offset = 0;
        while (offset + 512 <= tarBytes.length) {
            byte[] header = Arrays.copyOfRange(tarBytes, offset, offset + 512);
            offset += 512;

            // All-zero header signals end of archive
            boolean allZero = true;
            for (byte b : header) {
                if (b != 0) {
                    allZero = false;
                    break;
                }
            }
            if (allZero) break;

            // Parse name (bytes 0-100) and prefix (bytes 345-500)
            String name = stripNulls(new String(header, 0, 100, StandardCharsets.UTF_8));
            String prefix = stripNulls(new String(header, 345, 155, StandardCharsets.UTF_8));
            if (!prefix.isEmpty()) {
                name = prefix + "/" + name;
            }

            // Parse size (bytes 124-136, octal)
            String sizeStr = stripNulls(new String(header, 124, 12, StandardCharsets.UTF_8)).trim();
            long size;
            if (sizeStr.isEmpty()) {
                size = 0;
            } else {
                try {
                    size = Long.parseLong(sizeStr, 8);
                } catch (NumberFormatException e) {
                    throw new IOException("Corrupt tar header: invalid octal size '" + sizeStr + "'", e);
                }
            }

            // File data follows, padded to 512-byte boundary
            int blocks = (int) ((size + 511) / 512);
            int dataEnd = offset + (int) size;

            if (name.equals(binaryName) || name.endsWith("/" + binaryName)) {
                return Arrays.copyOfRange(tarBytes, offset, dataEnd);
            }

            offset += blocks * 512;
        }

        throw new IOException("Could not find " + binaryName + " in tar.gz archive");
    }

    // ------------------------------------------------------------------
    // zip extraction
    // ------------------------------------------------------------------

    static byte[] extractFromZip(byte[] archiveBytes, String binaryName) throws IOException {
        try (ZipInputStream zis = new ZipInputStream(new java.io.ByteArrayInputStream(archiveBytes))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                String entryName = entry.getName();
                if (entryName.equals(binaryName) || entryName.endsWith("/" + binaryName)) {
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = zis.read(buf)) != -1) {
                        baos.write(buf, 0, n);
                    }
                    return baos.toByteArray();
                }
                zis.closeEntry();
            }
        }

        throw new IOException("Could not find " + binaryName + " in zip archive");
    }

    // ------------------------------------------------------------------
    // Execution
    // ------------------------------------------------------------------

    private static void execute(Path binary, String[] args) throws Exception {
        List<String> command = new ArrayList<>();
        command.add(binary.toAbsolutePath().toString());
        command.addAll(Arrays.asList(args));

        ProcessBuilder pb = new ProcessBuilder(command);
        pb.inheritIO();
        Process process = pb.start();
        int exitCode = process.waitFor();
        System.exit(exitCode);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static void setPosixExecutable(Path path) {
        try {
            Set<PosixFilePermission> perms = EnumSet.of(
                    PosixFilePermission.OWNER_READ,
                    PosixFilePermission.OWNER_WRITE,
                    PosixFilePermission.OWNER_EXECUTE,
                    PosixFilePermission.GROUP_READ,
                    PosixFilePermission.GROUP_EXECUTE,
                    PosixFilePermission.OTHERS_READ,
                    PosixFilePermission.OTHERS_EXECUTE
            );
            Files.setPosixFilePermissions(path, perms);
        } catch (UnsupportedOperationException | IOException e) {
            // Not a POSIX filesystem -- skip
        }
    }

    private static String stripNulls(String s) {
        int idx = s.indexOf('\0');
        return idx == -1 ? s : s.substring(0, idx);
    }

    // ------------------------------------------------------------------
    // Exception type for controlled exits
    // ------------------------------------------------------------------

    static class ShimException extends RuntimeException {
        ShimException(String message) {
            super(message);
        }
    }
}
