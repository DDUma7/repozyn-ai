// SYNTHETIC file listings for the built-in demo personas. They are invented to match each
// persona's story and are only ever shown labelled as sample data; they are not, and must never
// be presented as, the result of inspecting a real GitHub repository.
//
// Format: persona login -> repository name -> file paths. "path|bytes" sets a file size.
export const SAMPLE_REPO_LISTINGS: Record<string, Record<string, string[]>> = {
  'alex-tutorial-hoarder': {
    'my-first-portfolio': ['index.html', 'style.css', 'script.js', 'images/profile.jpg'],
    'freecodecamp-challenges': ['README.md|140', 'basic-algorithms/reverse-string.js', 'basic-algorithms/factorialize.js', 'basic-algorithms/palindrome.js'],
  },
  'sarah-oss-architect': {
    'turbocache-rs': [
      'README.md|8200',
      'Cargo.toml',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'Dockerfile',
      'Makefile',
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      'docs/architecture.md',
      'docs/benchmarks.md',
      'src/lib.rs',
      'src/cache/mod.rs',
      'src/server/main.rs',
      'tests/integration_test.rs',
      'benches/throughput.rs',
    ],
    'go-raft-lite': [
      'README.md|5400',
      'go.mod',
      'main.go',
      'Dockerfile',
      '.github/workflows/ci.yml',
      'raft/node.go',
      'raft/node_test.go',
      'raft/log.go',
      'raft/log_test.go',
      'api/handlers.go',
      'docs/protocol.md',
    ],
    'metrics-exporter': [
      'README.md|2100',
      'Cargo.toml',
      'src/main.rs',
      'src/exporter.rs',
      'deploy/k8s/deployment.yaml',
      'deploy/k8s/service.yaml',
      'prometheus.yml',
      '.github/workflows/ci.yml',
    ],
  },
  'devon-shiny-tech': {
    'zig-game-engine-prototype': ['README.md|180', 'build.zig', 'src/main.zig', 'src/renderer.zig'],
    'gleam-chat-server': ['README.md|90', 'gleam.toml', 'src/chat_server.gleam'],
    'elixir-distributed-node': ['mix.exs', 'lib/node.ex'],
    'bun-microservice': ['package.json', 'index.ts', 'bun.lockb'],
  },
};

export function getSampleListings(login: string): Record<string, string[]> | undefined {
  return Object.prototype.hasOwnProperty.call(SAMPLE_REPO_LISTINGS, login) ? SAMPLE_REPO_LISTINGS[login] : undefined;
}

// SYNTHETIC README text for the demo personas, used only when a visitor asks for README content
// analysis on a demo profile. Invented to match each persona; never presented as real GitHub content.
export const SAMPLE_READMES: Record<string, Record<string, string>> = {
  'alex-tutorial-hoarder': {
    'freecodecamp-challenges': '# freecodecamp-challenges\n\nMy solutions.\n',
  },
  'sarah-oss-architect': {
    'turbocache-rs': [
      '# turbocache-rs',
      '',
      'A distributed in-memory cache written in Rust. It keeps hot keys close to the services that read them and',
      'replicates writes across nodes so that a single node failure does not lose data.',
      '',
      '## Installation',
      '',
      '```bash',
      'cargo install turbocache',
      '```',
      '',
      '## Usage',
      '',
      'Start a node and point clients at it:',
      '',
      '```bash',
      'turbocache --listen 0.0.0.0:7000 --peers node-b:7000,node-c:7000',
      '```',
      '',
      '## Benchmarks',
      '',
      'Measured on three 8-core nodes with 1 KB values. Full method is in docs/benchmarks.md.',
      '',
      '| Workload | Throughput |',
      '| --- | --- |',
      '| 90% reads | 410k req/s |',
      '| 50% reads | 240k req/s |',
      '',
      '## Limitations',
      '',
      '- Values larger than 1 MB are rejected.',
      '- Cross-region replication is not supported yet.',
      '',
      '## Deployment',
      '',
      'A Dockerfile is provided:',
      '',
      '```bash',
      'docker build -t turbocache . && docker run -p 7000:7000 turbocache',
      '```',
      '',
    ].join('\n'),
    'go-raft-lite': [
      '# go-raft-lite',
      '',
      'A small, readable implementation of the Raft consensus protocol in Go, written to make leader election and',
      'log replication easy to follow. It is intended for learning and for small embedded clusters.',
      '',
      '## Getting started',
      '',
      '```bash',
      'go build ./... && go test ./...',
      '```',
      '',
      '## Usage',
      '',
      'TODO',
      '',
    ].join('\n'),
    'metrics-exporter': ['# metrics-exporter', '', 'eBPF metrics exporter for Prometheus.', '', '## Install', '', 'Coming soon.', '', '## Roadmap', '', 'TBD', ''].join('\n'),
  },
  'devon-shiny-tech': {
    'zig-game-engine-prototype': '# zig-game-engine-prototype\n\nTrying out Zig.\n',
    'gleam-chat-server': '# gleam-chat-server\n',
  },
};

export function getSampleReadmes(login: string): Record<string, string> {
  return Object.prototype.hasOwnProperty.call(SAMPLE_READMES, login) ? SAMPLE_READMES[login] : {};
}

