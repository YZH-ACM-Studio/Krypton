# Firewall — oj-vigil SRS hardening

PROCTOR_MONITORING_DESIGN §15 (Phase 4 — 运维加固).

## Goal

- Accept RTMP push (port 1935) **only** from lab LAN (10.1.0.0/16).
- Accept HLS reads (port 8080) **only** from oj (10.1.234.2) — students don't
  read HLS, only the proctor's browser via oj's Caddy reverse-proxy does.
- Accept Vigil API (port 8765) on the same allow-list as it already has.

## Implementation (UFW)

The lab uses Ubuntu's UFW for the host firewall. Append to existing rules
(do **not** wipe defaults):

```bash
# RTMP — lab LAN only
ufw allow from 10.1.0.0/16 to any port 1935 proto tcp comment 'SRS RTMP push'

# HLS — oj host only
ufw allow from 10.1.234.2 to any port 8080 proto tcp comment 'SRS HLS read (oj caddy)'

# SRS HTTP API — localhost only (never expose to network)
ufw deny from any to any port 1985 proto tcp comment 'SRS HTTP API — localhost-only'

# Vigil cleanup runs locally, no rule needed.
```

## Implementation (iptables — if UFW is not installed)

```bash
iptables -A INPUT -p tcp -s 10.1.0.0/16 --dport 1935 -j ACCEPT
iptables -A INPUT -p tcp --dport 1935 -j DROP
iptables -A INPUT -p tcp -s 10.1.234.2 --dport 8080 -j ACCEPT
iptables -A INPUT -p tcp --dport 8080 -j DROP
iptables -A INPUT -p tcp --dport 1985 -j DROP
```

Persist via `iptables-save > /etc/iptables/rules.v4` (and `netfilter-persistent
save`).

## SRS-side reinforcement

`/opt/srs/conf/krypton.conf` already declares:

```
vhost live-record {
    refer { enabled on; all 10.1.0.0/16; }
    ...
}
vhost live-nodvr {
    refer { enabled on; all 10.1.0.0/16; }
    ...
}
```

`refer` is SRS's IP allowlist — a second layer of defense in case UFW is
misconfigured. Both layers must agree.

## Test

```bash
# From a lab LAN host (10.1.x.x): should connect
nc -zv 10.1.235.155 1935

# From outside lab LAN: should be refused
nc -zv <oj-vigil-public-ip> 1935 -w 3  # expected: connection refused
```

## Storage expansion (when recordEnabled gets used)

If a contest sets `recordEnabled = true`, expect ~510 GB per 2h × 300 students.
oj-vigil's `/data` is currently a single small partition — expand before any
recordEnabled contest.

```bash
# Step 1: add a new disk (cloud panel or physical install)
# Step 2: format + mount
mkfs.ext4 /dev/vdb
mkdir -p /data/vigil-recordings
mount /dev/vdb /data/vigil-recordings
echo '/dev/vdb /data/vigil-recordings ext4 defaults 0 0' >> /etc/fstab

# Step 3: bind-mount into the SRS expected path
mkdir -p /data/vigil
ln -snf /data/vigil-recordings /data/vigil/recordings

# Step 4: chown so srs user can write
chown -R srs:srs /data/vigil/recordings
```

Recommended capacity: 2 TB minimum, 4 TB for a margin to retain 7 days at
peak. Run `df -h /data/vigil/recordings` daily; alert at 80% full.
