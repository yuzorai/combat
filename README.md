# Server-authoritative combat

### Guide

- src for typescript code
- out for compiled typescript code/luau

## Demo videos

- Playtest recording — https://youtu.be/b50KLsry2d8

## Test notes

### 2026-09-16 00-00-29 playtest

- This video shows the player dashing under a 300+ ms network delay. The Combat Debug Menu displays the dash cooldown plus approved, rejected, and executed dash counts.

- While the player repeatedly presses Ctrl during the 1.5-second cooldown, those extra dash requests are rejected by the server instead of being queued or causing delayed/double dashes. This demonstrates that the dash remains server-authoritative under latency.

- The menu also tracks the server-validated 3-hit punch combo. Each landed hit advances through a different punch variation: Punch V1, Punch V2, then Punch V3.

- >A = Accepted — server approved the dash request.
- >R = Rejected — server denied it, usually due to cooldown, stale/invalid nonce, or an action already running.
- >E = Executed — the accepted dash reached its finish handler.
