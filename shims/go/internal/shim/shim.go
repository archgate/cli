package shim

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Version is the archgate CLI version this shim downloads.
const Version = "0.45.4"

const (
	releaseBaseURL = "https://github.com/archgate/cli/releases/download"
	installHelpURL = "https://cli.archgate.dev/getting-started/installation/"
)

// Run is the public entry point. It returns the process exit code.
func Run(args []string) int {
	artifact, err := GetArtifactName()
	if err != nil {
		fmt.Fprintf(os.Stderr, "archgate: %v\n", err)
		return 2
	}

	cacheDir, err := GetCacheDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "archgate: %v\n", err)
		return 2
	}

	binaryPath := filepath.Join(cacheDir, GetBinaryName())

	if _, err := os.Stat(binaryPath); os.IsNotExist(err) {
		if code := download(artifact, cacheDir, binaryPath); code != 0 {
			return code
		}
	}

	return execute(binaryPath, args)
}

func download(artifact, cacheDir, binaryPath string) int {
	fmt.Fprintf(os.Stderr, "archgate: binary not found, downloading v%s...\n", Version)

	// Determine archive extension
	ext := "tar.gz"
	if IsWindows() {
		ext = "zip"
	}

	archiveURL := fmt.Sprintf("%s/v%s/%s.%s", releaseBaseURL, Version, artifact, ext)

	// Download archive
	archiveBytes, err := httpGet(archiveURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "archgate: failed to download binary: %v\n", err)
		fmt.Fprintf(os.Stderr, "Visit %s for alternative install methods.\n", installHelpURL)
		return 2
	}

	// Verify SHA256 checksum
	checksumURL := fmt.Sprintf("%s/v%s/%s.%s.sha256", releaseBaseURL, Version, artifact, ext)
	checksumBytes, checksumErr := httpGet(checksumURL)
	if checksumErr != nil {
		fmt.Fprintf(os.Stderr, "archgate: failed to download checksum file: %v\n", checksumErr)
		fmt.Fprintf(os.Stderr, "archgate: refusing to install without checksum verification.\n")
		fmt.Fprintf(os.Stderr, "Visit %s for alternative install methods.\n", installHelpURL)
		return 2
	}

	expected := strings.TrimSpace(string(checksumBytes))
	if len(expected) >= 64 {
		expected = expected[:64]
	}

	hash := sha256.Sum256(archiveBytes)
	actual := hex.EncodeToString(hash[:])

	if !strings.EqualFold(expected, actual) {
		fmt.Fprintf(os.Stderr, "archgate: checksum verification failed for v%s (expected %s, got %s)\n", Version, expected, actual)
		return 2
	}

	// Ensure cache directory exists
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "archgate: failed to create cache directory: %v\n", err)
		return 2
	}

	// Extract archive
	if ext == "zip" {
		err = extractZip(archiveBytes, cacheDir)
	} else {
		err = extractTarGz(archiveBytes, cacheDir)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "archgate: failed to extract archive: %v\n", err)
		fmt.Fprintf(os.Stderr, "Visit %s for alternative install methods.\n", installHelpURL)
		return 2
	}

	// Set permissions on Unix
	if !IsWindows() {
		if err := os.Chmod(binaryPath, 0o755); err != nil {
			fmt.Fprintf(os.Stderr, "archgate: failed to set binary permissions: %v\n", err)
			return 2
		}
	}

	fmt.Fprintf(os.Stderr, "archgate: binary downloaded successfully.\n")
	return 0
}

func httpGet(url string) ([]byte, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d for %s", resp.StatusCode, url)
	}

	return io.ReadAll(resp.Body)
}

func extractTarGz(data []byte, destDir string) error {
	gr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("gzip open: %w", err)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("tar read: %w", err)
		}

		// Only extract regular files
		if header.Typeflag != tar.TypeReg {
			continue
		}

		// Use only the base name to avoid path traversal
		name := filepath.Base(header.Name)
		outPath := filepath.Join(destDir, name)

		f, err := os.Create(outPath)
		if err != nil {
			return fmt.Errorf("create file %s: %w", name, err)
		}

		if _, err := io.Copy(f, tr); err != nil {
			f.Close()
			return fmt.Errorf("write file %s: %w", name, err)
		}
		f.Close()
	}
	return nil
}

func extractZip(data []byte, destDir string) error {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("zip open: %w", err)
	}

	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}

		// Use only the base name to avoid path traversal
		name := filepath.Base(f.Name)
		outPath := filepath.Join(destDir, name)

		rc, err := f.Open()
		if err != nil {
			return fmt.Errorf("open zip entry %s: %w", name, err)
		}

		outFile, err := os.Create(outPath)
		if err != nil {
			rc.Close()
			return fmt.Errorf("create file %s: %w", name, err)
		}

		if _, err := io.Copy(outFile, rc); err != nil {
			outFile.Close()
			rc.Close()
			return fmt.Errorf("write file %s: %w", name, err)
		}

		outFile.Close()
		rc.Close()
	}
	return nil
}

func execute(binaryPath string, args []string) int {
	return executeOS(binaryPath, args)
}
