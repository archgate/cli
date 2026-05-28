// Command archgate is a thin shim that downloads the archgate CLI platform
// binary from GitHub Releases on first invocation, verifies its SHA256
// checksum, caches it under ~/.archgate/bin, and executes it — forwarding all
// arguments and propagating the exit code.
//
// archgate enforces Architecture Decision Records as executable rules, for both
// humans and AI agents. See https://cli.archgate.dev for documentation.
package main

import (
	"os"

	"github.com/archgate/cli/shims/go/internal/shim"
)

func main() {
	os.Exit(shim.Run(os.Args[1:]))
}
