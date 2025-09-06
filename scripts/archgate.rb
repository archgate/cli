# Homebrew formula for Archgate CLI
# Hosted in archgate/homebrew-tap
# https://github.com/archgate/homebrew-tap
class Archgate < Formula
  desc "AI governance for software development"
  homepage "https://archgate.dev"
  version "PLACEHOLDER_VERSION"
  license "FSL-1.1-ALv2"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/archgate/cli/releases/download/vPLACEHOLDER_VERSION/archgate-darwin-arm64"
      sha256 "PLACEHOLDER_SHA256_DARWIN_ARM64"

      def install
        bin.install "archgate-darwin-arm64" => "archgate"
      end
    end
  end

  on_linux do
    if Hardware::CPU.intel?
      url "https://github.com/archgate/cli/releases/download/vPLACEHOLDER_VERSION/archgate-linux-x64"
      sha256 "PLACEHOLDER_SHA256_LINUX_X64"

      def install
        bin.install "archgate-linux-x64" => "archgate"
      end
    end
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/archgate --version")
  end
end
