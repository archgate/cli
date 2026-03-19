#!/bin/sh
# Archgate installer for macOS, Linux, and Windows (Git Bash / MSYS2)
# Usage: curl -fsSL https://raw.githubusercontent.com/archgate/cli/main/install.sh | sh
set -eu

REPO="archgate/cli"
INSTALL_DIR="${ARCHGATE_INSTALL_DIR:-$HOME/.archgate/bin}"

# --- Detect platform ---

detect_platform() {
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin)       platform="darwin" ;;
    Linux)        platform="linux" ;;
    MINGW*|MSYS*) platform="win32" ;;
    *)
      echo "Error: unsupported OS: $os" >&2
      echo "archgate supports macOS (ARM64), Linux (x86_64), and Windows (x64)." >&2
      exit 1
      ;;
  esac

  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *)
      echo "Error: unsupported architecture: $arch" >&2
      echo "archgate supports arm64 (macOS) and x64 (Linux, Windows)." >&2
      exit 1
      ;;
  esac

  # Validate supported combinations
  if [ "$platform" = "darwin" ] && [ "$arch" != "arm64" ]; then
    echo "Error: macOS is only supported on ARM64 (Apple Silicon)." >&2
    exit 1
  fi
  if [ "$platform" = "linux" ] && [ "$arch" != "x64" ]; then
    echo "Error: Linux is only supported on x86_64." >&2
    exit 1
  fi
  if [ "$platform" = "win32" ] && [ "$arch" != "x64" ]; then
    echo "Error: Windows is only supported on x86_64." >&2
    exit 1
  fi

  ARTIFACT="archgate-${platform}-${arch}"
}

# --- Resolve version ---

resolve_version() {
  if [ -n "${ARCHGATE_VERSION:-}" ]; then
    VERSION="$ARCHGATE_VERSION"
    return
  fi

  api_url="https://api.github.com/repos/${REPO}/releases/latest"

  if command -v curl >/dev/null 2>&1; then
    response="$(curl -fsSL "$api_url" || true)"
  elif command -v wget >/dev/null 2>&1; then
    response="$(wget -qO- "$api_url" 2>/dev/null || true)"
  else
    echo "Error: curl or wget is required." >&2
    exit 1
  fi

  # Basic sanity check that we got a JSON-like response
  case "$response" in
    \{*)
      ;;
    *)
      echo "Error: unexpected response from GitHub releases API." >&2
      echo "Response (truncated): $(printf '%s' "$response" | cut -c1-200)" >&2
      exit 1
      ;;
  esac

  if command -v jq >/dev/null 2>&1; then
    VERSION="$(printf '%s' "$response" | jq -r '.tag_name // empty')"
  else
    VERSION="$(printf '%s' "$response" | grep "tag_name" | sed 's/.*"tag_name": *"//;s/".*//')"
  fi

  if [ -z "$VERSION" ]; then
    echo "Error: could not determine latest version (empty tag_name)." >&2
    exit 1
  fi

  # Validate that VERSION looks reasonable (non-empty and not an obvious error)
  case "$VERSION" in
    *[!A-Za-z0-9._-]*)
      echo "Error: invalid version tag received: '$VERSION'" >&2
      exit 1
      ;;
  esac
}

# --- Download and install ---

download_and_install() {
  if [ "$platform" = "win32" ]; then
    ext="zip"
  else
    ext="tar.gz"
  fi

  url="https://github.com/${REPO}/releases/download/${VERSION}/${ARTIFACT}.${ext}"

  echo "Installing archgate ${VERSION} (${ARTIFACT})..."

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmpdir/archgate.${ext}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmpdir/archgate.${ext}" "$url"
  else
    echo "Error: neither 'curl' nor 'wget' is installed. Please install one of them to download archgate." >&2
    exit 1
  fi

  mkdir -p "$INSTALL_DIR"

  if [ "$platform" = "win32" ]; then
    unzip -qo "$tmpdir/archgate.zip" -d "$tmpdir"
    mv "$tmpdir/archgate.exe" "$INSTALL_DIR/archgate.exe"
  else
    tar -xzf "$tmpdir/archgate.tar.gz" -C "$tmpdir"
    mv "$tmpdir/archgate" "$INSTALL_DIR/archgate"
    chmod +x "$INSTALL_DIR/archgate"
  fi
}

# --- Update PATH ---

get_shell_profiles() {
  profiles=""

  # Zsh
  for f in "$HOME/.zshrc" "$HOME/.zshenv" "$HOME/.zprofile"; do
    if [ -f "$f" ]; then
      profiles="$profiles $f"
      break
    fi
  done

  # Bash — login vs interactive, Linux vs macOS
  for f in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    if [ -f "$f" ]; then
      profiles="$profiles $f"
      break
    fi
  done

  # Fish
  fish_config="$HOME/.config/fish/config.fish"
  if [ -f "$fish_config" ]; then
    profiles="$profiles $fish_config"
  fi

  # Nushell
  for f in "$HOME/.config/nushell/env.nu" "$HOME/Library/Application Support/nushell/env.nu"; do
    if [ -f "$f" ]; then
      profiles="$profiles $f"
      break
    fi
  done

  # Ion
  if [ -f "$HOME/.config/ion/initrc" ]; then
    profiles="$profiles $HOME/.config/ion/initrc"
  fi

  # Csh / Tcsh
  for f in "$HOME/.cshrc" "$HOME/.tcshrc"; do
    if [ -f "$f" ]; then
      profiles="$profiles $f"
      break
    fi
  done

  echo "$profiles"
}

path_line_for() {
  file="$1"
  case "$file" in
    *.fish)
      echo "fish_add_path ${INSTALL_DIR}" ;;
    *env.nu)
      echo "\$env.PATH = (\$env.PATH | prepend '${INSTALL_DIR}')" ;;
    *initrc)
      echo "let path = [ ${INSTALL_DIR} \$path ]" ;;
    *.cshrc|*.tcshrc)
      echo "set path = ( ${INSTALL_DIR} \$path )" ;;
    *)
      echo "export PATH=\"${INSTALL_DIR}:\$PATH\"" ;;
  esac
}

already_configured() {
  file="$1"
  grep -qF "${INSTALL_DIR}" "$file" 2>/dev/null
}

setup_path() {
  # Already on PATH — nothing to do
  case ":${PATH}:" in
    *":${INSTALL_DIR}:"*) return ;;
  esac

  profiles="$(get_shell_profiles)"

  if [ -z "$profiles" ]; then
    echo ""
    echo "Could not detect any shell profile files."
    echo "Manually add ${INSTALL_DIR} to your PATH."
    return
  fi

  # Collect profiles that still need the PATH line
  needs_update=""
  already_done=""
  for f in $profiles; do
    if already_configured "$f"; then
      already_done="$already_done $f"
    else
      needs_update="$needs_update $f"
    fi
  done

  if [ -n "$already_done" ]; then
    for f in $already_done; do
      echo "  Already configured: $f"
    done
  fi

  if [ -z "$needs_update" ]; then
    echo "PATH is already configured in all detected shell profiles."
    return
  fi

  echo ""
  echo "Detected shell profiles to update:"
  for f in $needs_update; do
    echo "  $f  ->  $(path_line_for "$f")"
  done
  echo ""

  # Prompt requires /dev/tty — available even when stdin is piped (curl | sh)
  if [ ! -r /dev/tty ]; then
    echo "No readable TTY available. To add archgate to your PATH manually, add the lines above to your shell profile."
    return
  fi

  printf "Update these files now? [Y/n] "
  if ! read -r answer </dev/tty; then
    echo ""
    echo "Could not read from terminal. To add archgate to your PATH manually, add the lines above to your shell profile."
    return
  fi
  case "$answer" in
    [nN]*)
      echo ""
      echo "Skipped. To add archgate to your PATH manually, add the lines above to your shell profile."
      return
      ;;
  esac

  for f in $needs_update; do
    line="$(path_line_for "$f")"
    printf '\n# archgate\n%s\n' "$line" >> "$f"
    echo "  Updated: $f"
  done
  echo ""
  echo "Restart your shell or open a new terminal to use archgate."
}

# --- Main ---

main() {
  detect_platform
  resolve_version
  download_and_install

  if [ "$platform" = "win32" ]; then
    echo "archgate ${VERSION} installed to ${INSTALL_DIR}/archgate.exe"
  else
    echo "archgate ${VERSION} installed to ${INSTALL_DIR}/archgate"
  fi
  setup_path

  echo ""
  echo "Run 'archgate --help' to get started."
}

main
