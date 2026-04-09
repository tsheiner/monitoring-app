# Memory Monitoring Guide

This app is designed to run continuously (24/7) as a simulated network data source. It generates metric observations every 10 seconds and stores 30 days of rolling history. This guide explains how to verify it is running within normal memory bounds and how to detect problems early.

## Architecture Summary (Memory-Relevant)

The backend is a single Python process running:

- **FastAPI** HTTP server (port 5011) for historical data queries
- **WebSocket** server (port 5010) for live metric streaming
- **Metric generator** producing 42 observations per tick (7 metrics x 6 APs)
- **SQLite storage** for both metrics and events (disk-backed, bounded memory)
- **Daily cleanup** at 3:00 AM local time, deleting data older than 30 days

Memory usage should be **constant** regardless of how long the app runs. All data is stored in SQLite, which pages to disk rather than holding data in RAM.

## Quick Health Check

From any machine that can reach the VM:

```bash
curl -s http://<vm-host>:5011/debug/memory | python3 -m json.tool
```

Example response:

```json
{
    "rss_mb": 38.9,
    "vms_mb": 408729.1,
    "metrics_rows": 47838,
    "events_rows": 729,
    "data_files_mb": {
        "metrics.db": 25.45,
        "metrics.db-wal": 6.62,
        "events.db": 0.13,
        "baselines.json": 0.45
    },
    "uptime_seconds": 1453
}
```

### What the fields mean

| Field | What it tells you | Normal range |
|-------|-------------------|--------------|
| `rss_mb` | Actual RAM used by the process | 35-50 MB |
| `metrics_rows` | Total metric observations in the database | Grows ~362K/day, drops after 3 AM cleanup |
| `events_rows` | Total events in the database | Grows slowly (~100-200/day) |
| `metrics.db` | Main metrics database file size | 25-40 MB (stabilizes after first cleanup) |
| `metrics.db-wal` | SQLite write-ahead log | Normally under 20 MB |
| `events.db` | Events database file size | Under 1 MB |
| `uptime_seconds` | How long since the process started | Increases continuously unless restarted |

## What to Monitor

### 1. RSS should be flat over time

This is the single most important signal. Check `rss_mb` once a day for the first week.

- **Normal:** 35-50 MB, staying roughly constant day to day.
- **Acceptable:** A slow creep of 1-2 MB/day as SQLite's page cache warms up. This will plateau.
- **Problem:** Sustained growth above 5 MB/day. This indicates a memory leak.

### 2. Row counts should cycle

`metrics_rows` grows by ~362,000 rows per day (42 rows per 10-second tick). The daily 3 AM cleanup deletes everything older than 30 days. After the first cleanup cycle:

- **Normal:** Row count rises during the day, drops after 3 AM, and stabilizes around a steady ceiling.
- **Problem:** Row count only increases and never drops. This means the cleanup loop is not running.

### 3. Database files should stabilize

`metrics.db` will grow during the first 30 days of operation, then stabilize as the cleanup removes old data at the same rate new data is added.

- **Normal:** 25-40 MB for `metrics.db`, under 20 MB for `metrics.db-wal`.
- **Problem:** `metrics.db-wal` growing past 100 MB. This means SQLite's WAL checkpointing is not happening, possibly due to a long-running query holding a read lock.

## Automated Monitoring (Optional)

To log memory stats hourly on the VM for later review:

```bash
# Add to crontab (crontab -e)
0 * * * * curl -s http://localhost:5011/debug/memory >> /var/log/monitoring-memory.log
```

To check the trend over the past day:

```bash
# Show RSS values from the log
grep rss_mb /var/log/monitoring-memory.log | tail -24
```

## pm2 Safety Net

The app includes an `ecosystem.config.js` with `max_memory_restart: "500M"`. If the process ever exceeds 500 MB of memory, pm2 will automatically restart it. This should never trigger under normal operation -- if it does, check `pm2 logs monitoring-backend` for context and report the issue.

Useful pm2 commands:

```bash
pm2 monit                       # Live CPU and memory dashboard
pm2 logs monitoring-backend     # Recent logs
pm2 describe monitoring-backend # Process details including restart count
```

A non-zero restart count (visible in `pm2 describe`) combined with the memory ceiling being hit indicates a regression that needs investigation.

## Troubleshooting

### RSS is climbing steadily

1. Check `metrics_rows` -- if it's growing without the daily drop, the cleanup loop may have crashed. Restart the app.
2. Check if there are many WebSocket clients connected (each holds a small amount of state). A client in a reconnect loop can cause connection churn.
3. Check `metrics.db-wal` size. If it's very large, try restarting the app to force a WAL checkpoint.

### The app restarted unexpectedly

Check `pm2 logs monitoring-backend`. If the log shows the memory ceiling was hit, the app was using more than 500 MB. Capture a `/debug/memory` snapshot shortly after restart for comparison.

### The cleanup didn't run

The cleanup loop schedules itself for 3:00 AM local time. If the VM's clock is wrong or the process was restarted just before 3 AM, it may skip a cycle. It will catch up the next day. You can verify by watching `metrics_rows` -- it should drop once per day.

### Database files are very large

If `metrics.db` grows past 50 MB, check whether VACUUM is running after cleanup. The daily cleanup calls VACUUM automatically, but if the cleanup loop itself isn't running, neither is VACUUM. Restart the app to restore the cleanup loop.
