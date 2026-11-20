---
title: "Benchmarks"
description: "Requests per second, latency, and memory for sign-in, the agent token trade, refresh, and the key set in Dopgate 0.1.0, with the hardware, the settings, and the script that measured them."
---

# Benchmarks

These numbers are from Dopgate 0.1.0 on two CPU cores that it shares with PostgreSQL 18, measured on 20 November 2026. They describe one machine and one setup, both listed below. Run `bun run bench` to get the numbers for your own hardware.

## Results

| Endpoint | In flight | Requests per second | p50 | p99 | Dopgate CPU | PostgreSQL CPU | Dopgate memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `POST /api/v1/auth/login` | 1 | 55 | 18.1 ms | 21.6 ms | 0.85 cores | 0.03 cores | 31 MiB |
| `POST /api/v1/auth/login` | 32 | 105 | 302 ms | 348 ms | 1.90 cores | 0.08 cores | 50 MiB |
| `POST /api/v1/auth/token` with a `dga_` token | 1 | 2,098 | 0.46 ms | 0.64 ms | 0.30 cores | 0.23 cores | 11 MiB |
| `POST /api/v1/auth/token` with a `dga_` token | 32 | 5,803 | 5.51 ms | 6.76 ms | 0.92 cores | 0.90 cores | 14 MiB |
| `POST /api/v1/auth/refresh` | 1 | 342 | 2.89 ms | 4.66 ms | 0.16 cores | 0.19 cores | 14 MiB |
| `POST /api/v1/auth/refresh` | 32 | 3,159 | 9.66 ms | 19.5 ms | 0.69 cores | 0.88 cores | 13 MiB |
| `GET /.well-known/jwks.json` | 1 | 7,540 | 0.13 ms | 0.17 ms | 0.25 cores | 0.00 cores | 12 MiB |
| `GET /.well-known/jwks.json` | 32 | 34,989 | 0.91 ms | 2.18 ms | 1.08 cores | 0.00 cores | 12 MiB |

"In flight" is how many requests are in progress at once. With 1, the latency is what a single caller sees on a server that does nothing else. With 32, callers wait for each other, and the row shows how much two cores get through. No request failed in any run.

Dopgate holds 14 MiB of memory at rest: 13.6 MiB after startup and 12.2 MiB ten seconds after the last run.

### Reading the rows

Password sign-in is slow on purpose. Each sign-in checks an Argon2id hash that uses 19 MiB of memory, and a whole sign-in takes about 18 ms of one core here, so two cores finish about 105 sign-ins a second however many are waiting. Dopgate runs one hash per CPU at a time and queues the rest. At 32 in flight that queue is why a sign-in takes 302 ms, and why memory stops at 50 MiB.

The token trade reads the agent, records when it was last used, and signs an ES256 token. At 32 in flight Dopgate and PostgreSQL together used 1.82 of the 2 cores, so this row is limited by CPU.

Refresh runs in a transaction that writes the new refresh token and marks the old one used. The two containers used about 1.6 of the 2 cores, and the rest of the time went to waiting for PostgreSQL to commit to disk. This row depends on your storage more than the others do.

The key set is served from memory. At 32 in flight Dopgate used 1.08 of its 2 cores, so the load generator and the container network set that number and Dopgate had room left. The answer tells backends to cache it for five minutes, so in practice this endpoint sees little traffic.

### Memory

The memory column is the resident memory of the Dopgate process, sampled every 250 ms, and each row shows the highest sample during its run.

A password hash frees its 19 MiB when it is done, and Dopgate makes sure the system gets that memory back. The image is built against glibc, which by default keeps such blocks for itself: in the same sign-in test, about 715 MiB stayed with the process for good. Dopgate therefore pins glibc's mmap threshold when it starts. The release archives are built with musl, which returns the memory on its own, and the same test peaked at 51 MiB there.

## Hardware and software

| Part | What was used |
| --- | --- |
| Machine | Apple M3 Pro, 11 cores, 18 GB of memory, macOS 27.2.1 |
| Containers | OrbStack with Docker 29.8.2, Linux 7.2.12, arm64 |
| Dopgate | 0.1.0, the image built from the repository's `Dockerfile` |
| PostgreSQL | 18.6 from `postgres:18-alpine`, default configuration, data inside the container |
| Limits | Both containers pinned to the same two CPUs with `--cpuset-cpus 0,1`, and 2 GB of memory each |
| Load generator | Bun 1.4.0 on the same Mac, outside the containers, on 6 threads |

Dopgate sees two CPUs inside its container, so it runs two worker threads and two password hashes at a time, as it would on a machine with 2 vCPUs.

Two things make these numbers read high next to a small cloud server. An M3 Pro core is faster than a typical cloud vCPU. The load generator also ran on the Mac's other cores, so it took no CPU from the two that were measured. Expect lower numbers on a 2 vCPU virtual machine, and measure there before you plan capacity.

## Method

The load is a closed loop. Each virtual client sends a request, waits for the answer, and sends the next one at once, so the number in flight stays fixed. Every run has 3 seconds of load before measuring starts, then 20 measured seconds. Each row was run three times; the table shows the run with the median requests per second, and the latencies and CPU figures are from that same run.

The instance has 32 users, and each user owns one agent. What a client sends depends on the endpoint:

- For sign-in, it signs in as its own user with the right password.
- For the token trade, it trades its own agent's `dga_` token.
- For refresh, it keeps one session and sends the refresh token from the previous answer, because a refresh token works once.
- For the key set, it sends a plain `GET`.

CPU is the time the Dopgate process and the PostgreSQL container used during the 20 measured seconds, divided by 20.

## Settings during the run

A load test from one address runs into the [rate limits](/guide/rate-limits) long before it reaches the server's capacity, as it should. These settings were changed so the test measures the server while the limits stay on:

| Setting | During the run | Default | Why |
| --- | --- | --- | --- |
| `limits.ipRequestsPerMinute` | 10000, the highest value | 20 | Sign-in and the token trade share one budget per client address |
| `selfService.agents` | on | off | The sample users create the agents whose tokens are traded |
| `password.rejectLeaked` | off | on | Creating the sample users makes no call to the leaked password list. Sign-in never calls it, so no measured request changes. |

Even at 10000 a minute, one address gets 166 requests a second. Every `POST` therefore carried `X-Dopgate-Backend-Key` and an address in `X-Dopgate-Client-IP`, taken in turn from a pool of up to 3,072 addresses, the way a backend [passes on its visitors](/guide/admin-api#passing-on-the-visitor). No address went over its budget.

Account lockout stayed at its default of 5 wrong passwords. It never triggered, because every password was right. Refresh and the key set have no rate limit.

Everything else was left at its default: a pool of 10 database connections, Argon2id with 19 MiB and 2 passes, ES256 signatures, 15-minute access tokens, and the image's log level.

## Run it yourself

You need Docker and Bun.

```bash
bun run bench
```

The script builds the image, starts PostgreSQL and Dopgate, creates the users and agents, prints a table like the one above, and removes the containers. With the defaults it takes about 12 minutes after the image is built.

| Option | Default | Meaning |
| --- | --- | --- |
| `--cpuset <list>` | `0,1` | CPUs both containers are pinned to |
| `--memory <size>` | `2g` | Memory limit of each container |
| `--connections <list>` | `1,32` | Requests in flight, one pass per value |
| `--seconds <n>` | `20` | Measured seconds per run |
| `--runs <n>` | `3` | Runs per pass |
| `--only <list>` | all four | `key-set`, `token-trade`, `refresh`, `sign-in` |
| `--env <KEY=VALUE>` | none | Extra environment for the Dopgate container, such as `DOPGATE_DATABASE_MAX_CONNECTIONS=50` |
| `--json <file>` | none | Write every run to a file |

`bun run bench --help` lists the rest.
