# Toolchain container for contracts-solana -- gives you `solana` + `anchor` (via avm,
# pinned to 0.30.1 to match every program's Cargo.toml anchor-lang/anchor-spl version) and
# Node 20 in one place, so `anchor build` / `anchor keys list` / `anchor test` /
# `anchor deploy` don't need a manual local toolchain install (see README.md's "Next steps"
# #1-#2). This is a P0 blocker today precisely because no such toolchain exists in the
# sandbox that wrote this project -- see README.md's "What `cargo check` passed does and
# doesn't prove".
#
# NEVER BUILT OR RUN. This sandbox's own egress policy blocks release.solana.com (Solana's
# installer host) and the usual CDN hosts (see README.md), so this image could not be built
# or smoke-tested from here, and the two `curl | sh` / `cargo install --git` steps below are
# unverified. Build and run it yourself on a machine with normal internet access:
#   docker build -t scp-solana-toolchain .
#   docker run --rm -it -v $(pwd):/workspace -v ~/.config/solana:/root/.config/solana scp-solana-toolchain
# then inside the container:
#   anchor keys list                 # paste real ids into each program's declare_id!() and Anchor.toml
#   anchor build
#   npm install && npm test          # ts-mocha over tests/sho.ts / sso.ts / registry.ts

FROM rust:1.79-bookworm

ENV SOLANA_VERSION=1.18.26
ENV ANCHOR_VERSION=0.30.1
ENV PATH="/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:${PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config libssl-dev libudev-dev clang cmake curl git \
    && rm -rf /var/lib/apt/lists/*

# Node 20 -- needed for this package's own npm/ts-node test suite, and for `anchor test`,
# which Anchor.toml's [scripts] section runs via `yarn run ts-mocha ...`.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g yarn \
    && rm -rf /var/lib/apt/lists/*

# Solana CLI, pinned to the version README.md's "Next steps" #1 names.
RUN sh -c "$(curl -sSfL https://release.solana.com/v${SOLANA_VERSION}/install)"

# Anchor CLI via avm (Anchor's own version manager), pinned to match every program's
# Cargo.toml anchor-lang/anchor-spl = "0.30.1".
RUN cargo install --git https://github.com/coral-xyz/anchor avm --locked --force \
    && avm install ${ANCHOR_VERSION} \
    && avm use ${ANCHOR_VERSION}

WORKDIR /workspace
CMD ["bash"]
