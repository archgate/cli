using System.Runtime.InteropServices;

namespace Archgate.Tool.Tests;

public class ShimTests
{
    [Theory]
    [InlineData("darwin", "Arm64", "archgate-darwin-arm64")]
    [InlineData("linux", "X64", "archgate-linux-x64")]
    [InlineData("win32", "X64", "archgate-win32-x64")]
    public void GetArtifactName_ReturnsPlatformSpecificName(string expectedOs, string arch, string expectedArtifact)
    {
        // We cannot mock RuntimeInformation directly, so we test the actual
        // platform we are running on. This test verifies the current platform
        // produces one of the known artifact names.
        string artifact = Program.GetArtifactName();

        bool isCurrentPlatform =
            (RuntimeInformation.IsOSPlatform(OSPlatform.OSX) && expectedOs == "darwin"
                && RuntimeInformation.ProcessArchitecture.ToString() == arch)
            || (RuntimeInformation.IsOSPlatform(OSPlatform.Linux) && expectedOs == "linux"
                && RuntimeInformation.ProcessArchitecture.ToString() == arch)
            || (RuntimeInformation.IsOSPlatform(OSPlatform.Windows) && expectedOs == "win32"
                && RuntimeInformation.ProcessArchitecture.ToString() == arch);

        if (isCurrentPlatform)
        {
            Assert.Equal(expectedArtifact, artifact);
        }
    }

    [Fact]
    public void GetArtifactName_ReturnsOneOfKnownArtifacts()
    {
        string artifact = Program.GetArtifactName();

        Assert.Contains(artifact, new[]
        {
            "archgate-darwin-arm64",
            "archgate-linux-x64",
            "archgate-win32-x64",
        });
    }

    [Fact]
    public void GetBinaryName_ReturnsCorrectName()
    {
        string name = Program.GetBinaryName();

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            Assert.Equal("archgate.exe", name);
        }
        else
        {
            Assert.Equal("archgate", name);
        }
    }

    [Fact]
    public void ArtifactNameContainsPlatformIdentifier()
    {
        string artifact = Program.GetArtifactName();

        Assert.StartsWith("archgate-", artifact);
        Assert.Contains("-", artifact[9..]); // has os-arch separator after "archgate-"
    }

    [Fact]
    public void ArtifactAndBinaryNamesAreConsistent()
    {
        string artifact = Program.GetArtifactName();
        string binary = Program.GetBinaryName();

        // Windows artifacts produce .exe binaries
        if (artifact.Contains("win32"))
        {
            Assert.Equal("archgate.exe", binary);
        }
        else
        {
            Assert.Equal("archgate", binary);
        }
    }
}
