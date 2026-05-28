//go:build windows

package shim

import (
	"os"
	"os/exec"
)

func executeOS(binaryPath string, args []string) int {
	cmd := exec.Command(binaryPath, args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return exitErr.ExitCode()
		}
		return 2
	}
	return 0
}
