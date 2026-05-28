package main

import (
	"os"

	"github.com/archgate/cli/shims/go/internal/shim"
)

func main() {
	os.Exit(shim.Run(os.Args[1:]))
}
