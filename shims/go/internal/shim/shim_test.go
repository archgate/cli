package shim

import (
	"crypto/sha256"
	"encoding/hex"
	"runtime"
	"testing"
)

func TestGetArtifactName(t *testing.T) {
	name, err := GetArtifactName()
	if err != nil {
		t.Fatalf("GetArtifactName() returned unexpected error: %v", err)
	}

	expected := ""
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "darwin/arm64":
		expected = "archgate-darwin-arm64"
	case "linux/amd64":
		expected = "archgate-linux-x64"
	case "windows/amd64":
		expected = "archgate-win32-x64"
	default:
		t.Skipf("skipping: unsupported platform %s/%s", runtime.GOOS, runtime.GOARCH)
	}

	if name != expected {
		t.Errorf("GetArtifactName() = %q, want %q", name, expected)
	}
}

func TestGetArtifactNameMapping(t *testing.T) {
	// Verify the function exists and returns a non-empty string on supported platforms
	name, err := GetArtifactName()
	if err != nil {
		t.Skipf("unsupported platform: %v", err)
	}
	if name == "" {
		t.Error("GetArtifactName() returned empty string")
	}
}

func TestGetBinaryName(t *testing.T) {
	name := GetBinaryName()

	if runtime.GOOS == "windows" {
		if name != "archgate.exe" {
			t.Errorf("GetBinaryName() = %q on Windows, want %q", name, "archgate.exe")
		}
	} else {
		if name != "archgate" {
			t.Errorf("GetBinaryName() = %q on Unix, want %q", name, "archgate")
		}
	}
}

func TestGetCacheDir(t *testing.T) {
	dir, err := GetCacheDir()
	if err != nil {
		t.Fatalf("GetCacheDir() returned unexpected error: %v", err)
	}
	if dir == "" {
		t.Error("GetCacheDir() returned empty string")
	}
}

func TestIsWindows(t *testing.T) {
	got := IsWindows()
	want := runtime.GOOS == "windows"
	if got != want {
		t.Errorf("IsWindows() = %v, want %v", got, want)
	}
}

func TestSha256Verification(t *testing.T) {
	tests := []struct {
		name     string
		data     []byte
		expected string
		match    bool
	}{
		{
			name:     "matching hash",
			data:     []byte("hello world"),
			expected: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
			match:    true,
		},
		{
			name:     "mismatching hash",
			data:     []byte("hello world"),
			expected: "0000000000000000000000000000000000000000000000000000000000000000",
			match:    false,
		},
		{
			name:     "empty data",
			data:     []byte(""),
			expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			match:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hash := sha256.Sum256(tt.data)
			actual := hex.EncodeToString(hash[:])

			if (actual == tt.expected) != tt.match {
				if tt.match {
					t.Errorf("expected hash to match: got %s, want %s", actual, tt.expected)
				} else {
					t.Errorf("expected hash to NOT match but both were %s", actual)
				}
			}
		})
	}
}

func TestVersionIsSet(t *testing.T) {
	if Version == "" {
		t.Error("Version constant is empty")
	}
}
