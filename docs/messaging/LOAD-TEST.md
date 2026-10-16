# Messaging: realtime load test

How the realtime gateway behaves under load, how to run the test, the targets, and what was found.

## Run it

```
pnpm --filter @crew-deck/api load:realtime
TENANTS=5 USERS=600 RATE=6 SECONDS=30 pnpm --filter @crew-deck/api load:realtime
GATEWAYS=2 TENANTS=8 USERS=750 RATE=4 SECONDS=30 RAMP=400 pnpm --filter @crew-deck/api load:realtime
```

MongoDB and Redis must be running (the same as for the other tests). The script makes its own workspaces, people and
sessions in a throwaway database (`crewdeck_load`), starts its own gateway process or processes, connects every person
with a WebSocket and the session cookie of their workspace, and has a few people in each workspace post into their
#general at a steady rate. It then checks, for every connected person, that **every message of their workspace arrived
exactly once and no message of another workspace ever arrived**, and times delivery (the sender's clock to the receiver's
clock; both are in one process). Everything it made is removed afterwards. The exit code is 1 when a target is missed.
A small run (3 workspaces, 120 people each, 10 seconds) is part of the CI end-to-end job.

| Variable | Meaning | Default |
| --- | --- | --- |
| `TENANTS` | Workspaces | 4 |
| `USERS` | People (sockets) per workspace | 250 |
| `SENDERS` | People posting in each workspace | 3 |
| `RATE` | Messages per second per workspace | 5 |
| `SECONDS` | How long to send | 20 |
| `RAMP` | New connections per second | 150 |
| `GATEWAYS` | Gateway processes (sockets are spread across them) | 1 |
| `TARGET_P95`, `TARGET_P99`, `TARGET_ACK_P95` | Targets in milliseconds | 750, 2000, 500 |

## Targets

These are proposed; agree or change them before relying on them.

| Measure | Target |
| --- | --- |
| Connections that fail | 0 |
| Sends that are not acknowledged | 0 |
| Messages lost, duplicated, or seen by someone in another workspace | 0 |
| Delivery time, sender to receiver, p95 / p99 | under 750 ms / 2000 ms |
| Send acknowledgement, p95 | under 500 ms |

## Results

Measured on one development machine (Windows 11, MongoDB and Redis in Docker on the same machine, the test client and
the gateway sharing its processor), the gateway running from source. A production machine with the client elsewhere will do
better. "Deliveries" is messages times the people in the channel.

| Run | Sockets | Deliveries per second | Delivery p50 / p95 / p99 | Ack p95 | Lost | Gateway processor (cores) |
| --- | --- | --- | --- | --- | --- | --- |
| 4 workspaces x 250, 5 msg/s each | 1,000 | 5,000 | 41 / 61 / 78 ms | 49 ms | 0 | not measured |
| 5 x 600, 6 msg/s each, one gateway | 3,000 | 18,000 | 86 / 250 / 356 ms | 115 ms | 0 | about 1 (full) |
| 8 x 750, 4 msg/s each, one gateway | 6,000 | 24,000 | 1,200 / 9,200 / 16,500 ms | 11,800 ms | 45 to 60 percent not arrived after the 4 s drain | 1.1 (full, saturated) |
| 8 x 750, 4 msg/s each, **two gateways** | 6,000 | 24,000 | 130 / 217 / 276 ms | 169 ms | 0 | 0.58 each |

Cross-workspace deliveries were **0** in every run, and no duplicates were ever seen.

### What this says

- **One gateway process handles about 18,000 deliveries per second** (for example 3,000 connected people with each of five
  workspaces posting six messages a second) well inside the targets. Past that its one event loop is full and delay grows
  quickly.
- **It scales out.** Two processes handled 24,000 deliveries per second with each at about 0.6 of a core. The gateway keeps
  no state of its own (rooms are in Redis through the Socket.IO adapter, clients use WebSocket only), so add instances
  behind the proxy when `rssMb`, processor time or delivery time say so. Roughly: one process per 3,000 to 5,000
  simultaneous people at normal chat rates, which is far lower than 18,000 deliveries a second.
- Connections: one gateway accepts about 220 new connections a second after the fix below (the start of a working day).
- Memory: about 60 MB per 1,000 connected people on top of roughly 330 MB for the process.

## Hot spots found and fixed

1. **Presence announcements were quadratic.** Every person connecting told every other person in the workspace, one message each.
   With 600 people connecting that is 360,000 messages, and it capped connection at 96 per second. Presence changes that
   follow another within 250 ms are now sent together as one `presence:batch` (the first after a quiet moment still goes out
   alone, as `presence:changed`). Connection throughput rose 2.3 times (96 to 225 per second).
2. **Publishing could fail a stored send.** A broken publish after the message was stored turned into an error for the sender.
   Publishing now never throws (failures are logged and the clients catch up through `sync`); the calls that take access away
   are retried (ADR-090).

## Watching a running gateway

`GET /realtime/metrics` on the gateway itself (port 4100, only from the same machine and never through the proxy) returns
`{sockets, rooms, rssMb, heapMb, uptimeSeconds, cpuMs}`. Two readings of `cpuMs` a few seconds apart, divided by the
elapsed time, give the share of one core in use; when that stays above about 0.8, add a gateway instance.
