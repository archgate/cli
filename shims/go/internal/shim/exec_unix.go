//go:build !windows

package shim

import (
	"fmt"
	"os"
	"syscall"
)

func executeOS(binaryPath string, args []string) int {
	argv := append([]string{binaryPath}, args...)
	err := syscall.Exec(binaryPath, argv, os.Environ())
	// syscall.Exec only returns on error
	fmt.Fprintf(os.Stderr, "archgate: exec failed: %v\n", err)
	return 2
}
