# frozen_string_literal: true

require "digest/sha2"
require "fileutils"
require "net/http"
require "rbconfig"
require "rubygems/package"
require "stringio"
require "tmpdir"
require "uri"
require "zlib"

require_relative "version"

module Archgate
  # Thin shim that downloads the archgate binary from GitHub Releases on first
  # invocation and then executes it. Zero runtime dependencies -- stdlib only.
  module Shim
    BASE_URL = "https://github.com/archgate/cli/releases/download"

    # Platform mapping: [os_pattern, arch_pattern] => artifact name
    PLATFORM_MAP = [
      [/darwin|mac/i, /arm64|aarch64/i, "archgate-darwin-arm64"],
      [/linux/i, /x86_64|x64|amd64/i, "archgate-linux-x64"],
      [/mswin|mingw|cygwin/i, /x86_64|x64|amd64/i, "archgate-win32-x64"]
    ].freeze

    class << self
      def run(args)
        binary = binary_path

        unless File.exist?(binary)
          begin
            download_binary
          rescue StandardError => e
            $stderr.puts "archgate: failed to download binary: #{e.message}"
            $stderr.puts "Visit https://cli.archgate.dev/getting-started/installation/ for alternative install methods."
            exit 2
          end
        end

        if windows?
          system(binary, *args)
          exit($?.exitstatus || 1)
        else
          Kernel.exec(binary, *args)
        end
      end

      # -- Platform detection --------------------------------------------------

      def host_os
        RbConfig::CONFIG["host_os"]
      end

      def host_cpu
        RbConfig::CONFIG["host_cpu"]
      end

      def detect_artifact
        PLATFORM_MAP.each do |os_pat, arch_pat, artifact|
          return artifact if host_os.match?(os_pat) && host_cpu.match?(arch_pat)
        end

        $stderr.puts "archgate: Unsupported platform: #{host_os}/#{host_cpu}"
        $stderr.puts "archgate supports darwin/arm64, linux/x64, and win32/x64."
        exit 2
      end

      def windows?
        host_os.match?(/mswin|mingw|cygwin/i)
      end

      def binary_name
        windows? ? "archgate.exe" : "archgate"
      end

      def archive_ext
        windows? ? "zip" : "tar.gz"
      end

      def cache_dir
        File.join(Dir.home, ".archgate", "bin")
      end

      def binary_path
        File.join(cache_dir, binary_name)
      end

      # -- Download / verification ---------------------------------------------

      def download_url(artifact, ext)
        "#{BASE_URL}/v#{VERSION}/#{artifact}.#{ext}"
      end

      def checksum_url(artifact, ext)
        "#{download_url(artifact, ext)}.sha256"
      end

      def fetch(url, limit: 10)
        raise "too many HTTP redirects" if limit <= 0

        uri = URI.parse(url)
        http = Net::HTTP.new(uri.host, uri.port)
        http.use_ssl = (uri.scheme == "https")

        request = Net::HTTP::Get.new(uri)
        request["User-Agent"] = "archgate-cli-ruby"

        response = http.request(request)

        case response
        when Net::HTTPSuccess
          response.body
        when Net::HTTPRedirection
          fetch(response["location"], limit: limit - 1)
        else
          raise "GET #{url} returned status #{response.code}"
        end
      end

      def verify_checksum(archive_data, artifact, ext)
        checksum_data = begin
          fetch(checksum_url(artifact, ext))
        rescue StandardError
          $stderr.puts "archgate: warning: checksum file not available, skipping verification"
          return
        end

        expected = checksum_data.strip.split(/\s+/).first
        actual = Digest::SHA256.hexdigest(archive_data)

        return if expected == actual

        raise "checksum verification failed for v#{VERSION} (expected #{expected}, got #{actual})"
      end

      private

      def download_binary
        artifact = detect_artifact
        ext = archive_ext
        url = download_url(artifact, ext)

        $stderr.puts "archgate: binary not found, downloading v#{VERSION}..."

        archive_data = fetch(url)
        verify_checksum(archive_data, artifact, ext)

        FileUtils.mkdir_p(cache_dir)
        dest = binary_path

        if ext == "zip"
          extract_zip(archive_data, dest)
        else
          extract_tar_gz(archive_data, dest)
        end

        File.chmod(0o755, dest) unless windows?

        $stderr.puts "archgate: binary downloaded successfully."
      end

      def extract_tar_gz(archive_data, dest)
        bin_name = binary_name
        found = false

        io = StringIO.new(archive_data)
        Zlib::GzipReader.wrap(io) do |gz|
          Gem::Package::TarReader.new(gz) do |tar|
            tar.each do |entry|
              name = entry.full_name
              if name == bin_name || name.end_with?("/#{bin_name}")
                File.binwrite(dest, entry.read)
                found = true
                break
              end
            end
          end
        end

        raise "binary #{bin_name} not found in archive" unless found
      end

      def extract_zip(archive_data, dest)
        Dir.mktmpdir("archgate-") do |tmp|
          zip_path = File.join(tmp, "archgate-download.zip")
          extract_dir = File.join(tmp, "archgate-extract")

          File.binwrite(zip_path, archive_data)
          FileUtils.mkdir_p(extract_dir)

          system(
            "powershell", "-NoProfile", "-Command",
            "Expand-Archive -Path '#{zip_path}' -DestinationPath '#{extract_dir}' -Force"
          )

          bin = binary_name
          extracted = Dir.glob(File.join(extract_dir, "**", bin)).first
          raise "binary #{bin} not found in zip archive" unless extracted

          FileUtils.cp(extracted, dest)
        end
      end
    end
  end
end
