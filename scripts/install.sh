#!/bin/sh
# Archgate CLI install script
# Usage: curl -fsSL https://archgate.dev/install.sh | sh
# Usage: curl -fsSL https://archgate.dev/install.sh | sh -s -- --version v0.1.0
set -e

REPO="archgate/cli"
INSTALL_DIR="${HOME}/.archgate/bin"
BINARY_NAME="archgate"

# --- Parse arguments ---
VERSION=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# --- Detect OS and architecture ---
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64) ARTIFACT="archgate-darwin-arm64" ;;
      *)
        echo "Unsupported architecture: $ARCH on macOS. Only arm64 is supported." >&2
        exit 1
        ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64) ARTIFACT="archgate-linux-x64" ;;
      *)
        echo "Unsupported architecture: $ARCH on Linux. Only x86_64 is supported." >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS. Archgate supports macOS and Linux only." >&2
    exit 1
    ;;
esac

# --- Resolve version ---
if [ -z "$VERSION" ]; then
  echo "Fetching latest release..."
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    -H "Accept: application/vnd.github+json" \
    | grep '"tag_name"' \
    | head -1 \
    | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"

  if [ -z "$VERSION" ]; then
    echo "Failed to fetch latest version from GitHub." >&2
    exit 1
  fi
fi

echo "Installing Archgate ${VERSION}..."

# --- Download binary ---
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARTIFACT}"
INSTALL_PATH="${INSTALL_DIR}/${BINARY_NAME}"

mkdir -p "$INSTALL_DIR"

if command -v curl > /dev/null 2>&1; then
  curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_PATH"
elif command -v wget > /dev/null 2>&1; then
  wget -qO "$INSTALL_PATH" "$DOWNLOAD_URL"
else
  echo "Error: curl or wget is required to install Archgate." >&2
  exit 1
fi

chmod +x "$INSTALL_PATH"

echo "Archgate ${VERSION} installed to ${INSTALL_PATH}"

# --- Add to PATH ---
add_to_path() {
  PROFILE_FILE="$1"
  EXPORT_LINE='export PATH="$HOME/.archgate/bin:$PATH"'

  if [ -f "$PROFILE_FILE" ] && grep -q '\.archgate/bin' "$PROFILE_FILE" 2>/dev/null; then
    return 0
  fi

  if [ -f "$PROFILE_FILE" ]; then
    printf '\n# Archgate CLI\n%s\n' "$EXPORT_LINE" >> "$PROFILE_FILE"
    echo "Added ~/.archgate/bin to PATH in ${PROFILE_FILE}"
  fi
}

add_to_path "${HOME}/.bashrc"
add_to_path "${HOME}/.zshrc"
add_to_path "${HOME}/.profile"

echo ""
echo "Installation complete."
echo "Restart your shell or run:"
echo '  export PATH="$HOME/.archgate/bin:$PATH"'
echo ""
echo "Then verify with: archgate --version"
