using System.Diagnostics;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace Archgate.Tool;

internal static class Program
{
    private const string Version = "0.45.3";

    private static readonly string CacheDir = Path.Join(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".archgate",
        "bin"
    );

    internal static int Main(string[] args)
    {
        string binaryPath = GetBinaryPath();

        if (!File.Exists(binaryPath))
        {
            try
            {
                DownloadBinary(binaryPath).GetAwaiter().GetResult();
            }
            catch (HttpRequestException ex)
            {
                Console.Error.WriteLine(
                    $"archgate: failed to download binary: {ex.Message}\n"
                    + "Visit https://cli.archgate.dev/getting-started/installation/ for alternative install methods."
                );
                return 2;
            }
            catch (IOException ex)
            {
                Console.Error.WriteLine(
                    $"archgate: failed to download binary: {ex.Message}\n"
                    + "Visit https://cli.archgate.dev/getting-started/installation/ for alternative install methods."
                );
                return 2;
            }
            catch (InvalidOperationException ex)
            {
                Console.Error.WriteLine(
                    $"archgate: failed to download binary: {ex.Message}\n"
                    + "Visit https://cli.archgate.dev/getting-started/installation/ for alternative install methods."
                );
                return 2;
            }
            catch (PlatformNotSupportedException ex)
            {
                Console.Error.WriteLine(
                    $"archgate: failed to download binary: {ex.Message}\n"
                    + "Visit https://cli.archgate.dev/getting-started/installation/ for alternative install methods."
                );
                return 2;
            }
        }

        return Execute(binaryPath, args);
    }

    // -------------------------------------------------------------------------
    // Platform detection
    // -------------------------------------------------------------------------

    internal static string GetArtifactName()
    {
        bool isMacOS = RuntimeInformation.IsOSPlatform(OSPlatform.OSX);
        bool isLinux = RuntimeInformation.IsOSPlatform(OSPlatform.Linux);
        bool isWindows = RuntimeInformation.IsOSPlatform(OSPlatform.Windows);
        var arch = RuntimeInformation.ProcessArchitecture;

        if (isMacOS && arch == Architecture.Arm64)
            return "archgate-darwin-arm64";
        if (isLinux && arch == Architecture.X64)
            return "archgate-linux-x64";
        if (isWindows && arch == Architecture.X64)
            return "archgate-win32-x64";

        string os = isMacOS ? "darwin" : isLinux ? "linux" : isWindows ? "win32" : "unknown";
        string archName = arch.ToString().ToLowerInvariant();
        throw new PlatformNotSupportedException(
            $"Unsupported platform: {os}/{archName}\n"
            + "archgate supports darwin/arm64, linux/x64, and win32/x64."
        );
    }

    internal static string GetBinaryName()
    {
        return RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
            ? "archgate.exe"
            : "archgate";
    }

    private static string GetBinaryPath()
    {
        return Path.Join(CacheDir, GetBinaryName());
    }

    // -------------------------------------------------------------------------
    // Download + verify + extract
    // -------------------------------------------------------------------------

    private static async Task DownloadBinary(string destPath)
    {
        string artifactName = GetArtifactName();
        bool isWindows = RuntimeInformation.IsOSPlatform(OSPlatform.Windows);
        string ext = isWindows ? "zip" : "tar.gz";

        string baseUrl = $"https://github.com/archgate/cli/releases/download/v{Version}/{artifactName}";
        string archiveUrl = $"{baseUrl}.{ext}";
        string checksumUrl = $"{baseUrl}.{ext}.sha256";

        Console.Error.WriteLine($"archgate: binary not found, downloading v{Version}...");

        Directory.CreateDirectory(CacheDir);

        using var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("archgate-cli");

        // Download archive
        byte[] archiveBytes = await http.GetByteArrayAsync(archiveUrl);

        // Verify checksum
        await VerifyChecksum(http, archiveBytes, checksumUrl);

        // Extract
        string binaryName = GetBinaryName();

        if (isWindows)
        {
            ExtractFromZip(archiveBytes, binaryName, destPath);
        }
        else
        {
            ExtractFromTarGz(archiveBytes, binaryName, destPath);
        }

        // Set executable permissions on Unix
        if (!isWindows)
        {
            File.SetUnixFileMode(
                destPath,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                | UnixFileMode.GroupRead | UnixFileMode.GroupExecute
                | UnixFileMode.OtherRead | UnixFileMode.OtherExecute
            );
        }

        Console.Error.WriteLine("archgate: binary downloaded successfully.");
    }

    private static async Task VerifyChecksum(HttpClient http, byte[] archiveBytes, string checksumUrl)
    {
        string? expectedHash;
        try
        {
            string checksumContent = await http.GetStringAsync(checksumUrl);
            expectedHash = checksumContent.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)[0];
        }
        catch (HttpRequestException)
        {
            throw new InvalidOperationException(
                $"checksum verification failed for v{Version}: unable to fetch checksum file"
            );
        }

        byte[] hashBytes = SHA256.HashData(archiveBytes);
        string actualHash = Convert.ToHexString(hashBytes).ToLowerInvariant();

        if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"checksum verification failed for v{Version} (expected {expectedHash}, got {actualHash})"
            );
        }
    }

    private static void ExtractFromZip(byte[] archiveBytes, string binaryName, string destPath)
    {
        using var stream = new MemoryStream(archiveBytes);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);

        ZipArchiveEntry? entry = archive.Entries
            .FirstOrDefault(e => string.Equals(e.Name, binaryName, StringComparison.OrdinalIgnoreCase));

        if (entry is null)
        {
            throw new FileNotFoundException($"Binary {binaryName} not found in zip archive");
        }

        using var entryStream = entry.Open();
        using var fileStream = File.Create(destPath);
        entryStream.CopyTo(fileStream);
    }

    private static void ExtractFromTarGz(byte[] archiveBytes, string binaryName, string destPath)
    {
        string tempDir = Path.Join(CacheDir, "archgate-extract");
        Directory.CreateDirectory(tempDir);

        try
        {
            using (var gzStream = new GZipStream(new MemoryStream(archiveBytes), CompressionMode.Decompress))
            {
                System.Formats.Tar.TarFile.ExtractToDirectory(gzStream, tempDir, overwriteFiles: true);
            }

            // Search for the binary in the extracted directory
            string? binaryFile = FindBinary(tempDir, binaryName);

            if (binaryFile is null)
            {
                throw new FileNotFoundException($"Binary {binaryName} not found in tar.gz archive");
            }

            File.Copy(binaryFile, destPath, overwrite: true);
        }
        finally
        {
            try { Directory.Delete(tempDir, recursive: true); } catch (IOException) { /* best-effort cleanup */ }
        }
    }

    private static string? FindBinary(string directory, string binaryName)
    {
        foreach (string file in Directory.EnumerateFiles(directory, binaryName, SearchOption.AllDirectories))
        {
            return file;
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // Execution
    // -------------------------------------------------------------------------

    private static int Execute(string binaryPath, string[] args)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = binaryPath,
            UseShellExecute = false,
            RedirectStandardInput = false,
            RedirectStandardOutput = false,
            RedirectStandardError = false,
        };

        foreach (string arg in args)
        {
            startInfo.ArgumentList.Add(arg);
        }

        using var process = Process.Start(startInfo);
        if (process is null)
        {
            Console.Error.WriteLine("archgate: failed to start process");
            return 2;
        }

        process.WaitForExit();
        return process.ExitCode;
    }
}
