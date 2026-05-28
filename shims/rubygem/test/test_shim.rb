# frozen_string_literal: true

require "minitest/autorun"
require "digest/sha2"

# Ensure the gem's lib/ is on the load path regardless of working directory.
$LOAD_PATH.unshift(File.expand_path("../lib", __dir__))

require "archgate/shim"

class TestPlatformDetection < Minitest::Test
  # Helper: stub host_os and host_cpu on the Shim module, call detect_artifact.
  def detect_with(os, cpu)
    Archgate::Shim.stub(:host_os, os) do
      Archgate::Shim.stub(:host_cpu, cpu) do
        Archgate::Shim.detect_artifact
      end
    end
  end

  def test_darwin_arm64
    assert_equal "archgate-darwin-arm64", detect_with("darwin23", "arm64")
  end

  def test_darwin_aarch64
    assert_equal "archgate-darwin-arm64", detect_with("darwin23", "aarch64")
  end

  def test_linux_x86_64
    assert_equal "archgate-linux-x64", detect_with("linux-gnu", "x86_64")
  end

  def test_linux_amd64
    assert_equal "archgate-linux-x64", detect_with("linux-gnu", "AMD64")
  end

  def test_windows_x86_64
    assert_equal "archgate-win32-x64", detect_with("mingw32", "x86_64")
  end

  def test_windows_amd64
    assert_equal "archgate-win32-x64", detect_with("mswin64", "AMD64")
  end

  def test_windows_cygwin_x64
    assert_equal "archgate-win32-x64", detect_with("cygwin", "x86_64")
  end

  def test_unsupported_platform_exits
    err = assert_raises(SystemExit) do
      detect_with("freebsd13", "i386")
    end
    assert_equal 2, err.status
  end
end

class TestArtifactNaming < Minitest::Test
  def test_artifact_name_construction
    artifact = "archgate-linux-x64"
    ext = "tar.gz"
    url = Archgate::Shim.download_url(artifact, ext)
    expected = "https://github.com/archgate/cli/releases/download/v#{Archgate::VERSION}/archgate-linux-x64.tar.gz"
    assert_equal expected, url
  end

  def test_checksum_url_construction
    artifact = "archgate-darwin-arm64"
    ext = "tar.gz"
    url = Archgate::Shim.checksum_url(artifact, ext)
    assert url.end_with?(".tar.gz.sha256")
  end
end

class TestBinaryName < Minitest::Test
  def test_binary_name_windows
    Archgate::Shim.stub(:windows?, true) do
      assert_equal "archgate.exe", Archgate::Shim.binary_name
    end
  end

  def test_binary_name_unix
    Archgate::Shim.stub(:windows?, false) do
      assert_equal "archgate", Archgate::Shim.binary_name
    end
  end
end

class TestArchiveExt < Minitest::Test
  def test_archive_ext_windows
    Archgate::Shim.stub(:windows?, true) do
      assert_equal "zip", Archgate::Shim.archive_ext
    end
  end

  def test_archive_ext_unix
    Archgate::Shim.stub(:windows?, false) do
      assert_equal "tar.gz", Archgate::Shim.archive_ext
    end
  end
end

class TestChecksumVerification < Minitest::Test
  def test_checksum_pass
    data = "hello archgate"
    expected_hash = Digest::SHA256.hexdigest(data)
    checksum_content = "#{expected_hash}  archgate-linux-x64.tar.gz\n"

    Archgate::Shim.stub(:fetch, ->(_url) { checksum_content }) do
      # Should not raise
      Archgate::Shim.verify_checksum(data, "archgate-linux-x64", "tar.gz")
    end
  end

  def test_checksum_mismatch_raises
    data = "hello archgate"
    wrong_hash = Digest::SHA256.hexdigest("wrong data")
    checksum_content = "#{wrong_hash}  archgate-linux-x64.tar.gz\n"

    Archgate::Shim.stub(:fetch, ->(_url) { checksum_content }) do
      err = assert_raises(RuntimeError) do
        Archgate::Shim.verify_checksum(data, "archgate-linux-x64", "tar.gz")
      end
      assert_match(/checksum verification failed/, err.message)
    end
  end

  def test_checksum_unavailable_warns_and_continues
    data = "hello archgate"

    Archgate::Shim.stub(:fetch, ->(_url) { raise StandardError, "404" }) do
      # Should not raise -- just warns and returns
      Archgate::Shim.verify_checksum(data, "archgate-linux-x64", "tar.gz")
    end
  end
end
