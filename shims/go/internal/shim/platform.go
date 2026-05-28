package shim

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// GetArtifactName returns the platform-specific artifact name for the current OS/arch.
func GetArtifactName() (string, error) {
	key := runtime.GOOS + "/" + runtime.GOARCH

	switch key {
	case "darwin/arm64":
		return "archgate-darwin-arm64", nil
	case "linux/amd64":
		return "archgate-linux-x64", nil
	case "windows/amd64":
		return "archgate-win32-x64", nil
	default:
		return "", fmt.Errorf("unsupported platform: %s/%s", runtime.GOOS, runtime.GOARCH)
	}
}

// GetBinaryName returns the binary filename, with .exe suffix on Windows.
func GetBinaryName() string {
	if IsWindows() {
		return "archgate.exe"
	}
	return "archgate"
}

// GetCacheDir returns the path to the archgate binary cache directory.
func GetCacheDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("unable to determine home directory: %w", err)
	}
	return filepath.Join(home, ".archgate", "bin"), nil
}

// IsWindows returns true if the current OS is Windows.
func IsWindows() bool {
	return runtime.GOOS == "windows"
}
