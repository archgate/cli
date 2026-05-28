# frozen_string_literal: true

require_relative "lib/archgate/version"

Gem::Specification.new do |spec|
  spec.name = "archgate"
  spec.version = Archgate::VERSION
  spec.authors = ["Archgate"]
  spec.email = ["hello@archgate.dev"]

  spec.summary = "Enforce Architecture Decision Records as executable rules"
  spec.description = "Enforce Architecture Decision Records as executable rules — for both humans and AI agents"
  spec.homepage = "https://cli.archgate.dev"
  spec.license = "Apache-2.0"
  spec.required_ruby_version = ">= 2.7.0"

  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = "https://github.com/archgate/cli"
  spec.metadata["bug_tracker_uri"] = "https://github.com/archgate/cli/issues"
  spec.metadata["documentation_uri"] = "https://cli.archgate.dev"
  spec.metadata["changelog_uri"] = "https://github.com/archgate/cli/blob/main/CHANGELOG.md"
  spec.metadata["rubygems_mfa_required"] = "true"

  spec.files = Dir["lib/**/*.rb", "exe/*", "README.md", "LICENSE.md"]
  spec.bindir = "exe"
  spec.executables = ["archgate"]
  spec.require_paths = ["lib"]
end
