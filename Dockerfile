# dopgate: one binary with the admin console built in.
#
#   docker build -t dopgate .
#   docker run -p 8850:8850 -e DOPGATE_DATABASE_URL=postgres://... dopgate
#
# The image needs nothing but a PostgreSQL URL. See docker-compose.yml for
# PostgreSQL and dopgate together.

# 1. The admin console, built to ui/dist. vue-tsc needs Node itself, so
#    this is a Node image with Bun added.
FROM node:22-bookworm-slim AS console
COPY --from=oven/bun:1.4 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /src/ui
COPY ui/package.json ui/bun.lock ./
RUN bun install --frozen-lockfile
COPY ui/ ./
RUN bun run build

# 2. The binary. It embeds ui/dist, so the console comes first.
FROM rust:1.89-bookworm AS server
WORKDIR /src/app
COPY app/Cargo.toml app/Cargo.lock ./
# Fetch dependencies in their own layer so code changes rebuild faster.
RUN mkdir src && echo 'fn main() {}' > src/main.rs && touch src/lib.rs \
  && cargo fetch --locked \
  && rm -rf src
COPY app/ ./
COPY --from=console /src/ui/dist /src/ui/dist
RUN cargo build --release --locked --bin dopgate

# 3. A small runtime: glibc and CA certificates, no shell, no root.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=server /src/app/target/release/dopgate /usr/local/bin/dopgate
ENV DOPGATE_HOST=0.0.0.0 \
    DOPGATE_PORT=8850 \
    RUST_LOG=app=info,tower_http=warn
EXPOSE 8850
USER nonroot
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD ["/usr/local/bin/dopgate", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/dopgate"]
CMD ["serve"]
