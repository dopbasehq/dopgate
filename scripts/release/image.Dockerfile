# The Docker Hub image for a release. It compiles nothing: it copies the
# static musl binary from the verified linux archive for each architecture,
# so the image runs the same bytes as the GitHub release. prepare-image.sh
# lays out the build context as linux/<arch>/dopgate.
#
# A static binary needs no libc, so the base is distroless static: CA
# certificates, tzdata and a nonroot user, no shell. With no RUN steps,
# buildx builds both architectures without emulation.
FROM gcr.io/distroless/static-debian12:nonroot
ARG TARGETARCH
LABEL org.opencontainers.image.title="Dopgate" \
      org.opencontainers.image.description="Modern auth for people and AI agents." \
      org.opencontainers.image.vendor="Dopbase" \
      org.opencontainers.image.source="https://github.com/dopbasehq/dopgate" \
      org.opencontainers.image.licenses="Apache-2.0"
COPY linux/${TARGETARCH}/dopgate /usr/local/bin/dopgate
ENV DOPGATE_HOST=0.0.0.0 \
    DOPGATE_PORT=8850 \
    RUST_LOG=app=info,tower_http=warn
EXPOSE 8850
USER nonroot
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD ["/usr/local/bin/dopgate", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/dopgate"]
CMD ["serve"]
