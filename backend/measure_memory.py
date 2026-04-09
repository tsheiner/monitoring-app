"""
Memory baseline measurement for the running monitoring app.

Connects to the running process and measures key memory indicators.
Run this while main.py is running to capture before/after snapshots.

Usage:
    python measure_memory.py          # single snapshot
    python measure_memory.py --watch  # repeat every 30s for 5 minutes
"""
import sys
import os
import time
import json
import psutil

def get_backend_pid():
    """Find the running main.py process."""
    for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            cmdline = proc.info.get('cmdline') or []
            if any('main.py' in arg for arg in cmdline) and any('python' in arg.lower() for arg in cmdline):
                return proc.info['pid']
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return None

def measure_process(pid):
    """Take a memory snapshot of a process."""
    try:
        proc = psutil.Process(pid)
        mem = proc.memory_info()
        return {
            "pid": pid,
            "rss_mb": round(mem.rss / 1024 / 1024, 1),
            "vms_mb": round(mem.vms / 1024 / 1024, 1),
        }
    except psutil.NoSuchProcess:
        return None

def measure_data_files():
    """Measure on-disk data file sizes."""
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    files = {}
    for name in ["metrics.db", "metrics.db-wal", "events.db", "baselines.json",
                  "metrics.csv", "metrics.csv.classifiers.json"]:
        path = os.path.join(data_dir, name)
        if os.path.exists(path):
            size_mb = os.path.getsize(path) / 1024 / 1024
            files[name] = round(size_mb, 2)
    return files

def measure_metrics_db():
    """Count rows in the SQLite metrics database."""
    import sqlite3
    path = os.path.join(os.path.dirname(__file__), "data", "metrics.db")
    if not os.path.exists(path):
        return {"rows": 0, "size_mb": 0}
    size_mb = os.path.getsize(path) / 1024 / 1024
    try:
        conn = sqlite3.connect(path)
        count = conn.execute("SELECT COUNT(*) FROM metrics").fetchone()[0]
        conn.close()
        return {"rows": count, "size_mb": round(size_mb, 2)}
    except Exception:
        return {"rows": -1, "size_mb": round(size_mb, 2)}

def snapshot():
    """Take a complete measurement snapshot."""
    pid = get_backend_pid()
    if pid is None:
        print("ERROR: Could not find running main.py process")
        return None

    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    proc = measure_process(pid)
    metrics_db = measure_metrics_db()
    data_files = measure_data_files()

    result = {
        "timestamp": ts,
        "process": proc,
        "metrics_db": metrics_db,
        "data_files": data_files,
    }

    print(f"\n{'='*60}")
    print(f"  Memory Snapshot at {ts}")
    print(f"{'='*60}")
    print(f"  Process RSS:              {proc['rss_mb']:>8.1f} MB")
    print(f"  Process VMS:              {proc['vms_mb']:>8.1f} MB")
    print(f"  Metrics DB rows:          {metrics_db['rows']:>8,}")
    print(f"  Metrics DB file:          {metrics_db['size_mb']:>8.2f} MB")
    print(f"  Data files on disk:")
    for name, size in data_files.items():
        print(f"    {name:<40s} {size:>8.2f} MB")
    print(f"{'='*60}")

    return result

def watch(interval=30, duration=300):
    """Take repeated snapshots to observe growth."""
    print(f"Watching memory every {interval}s for {duration}s...")
    print(f"(Growth between snapshots shows the leak rate)\n")

    snapshots = []
    start = time.time()

    while time.time() - start < duration:
        s = snapshot()
        if s is None:
            return
        snapshots.append(s)

        if len(snapshots) > 1:
            prev = snapshots[-2]
            curr = snapshots[-1]
            rss_delta = curr["process"]["rss_mb"] - prev["process"]["rss_mb"]
            db_delta = curr["metrics_db"]["rows"] - prev["metrics_db"]["rows"]
            print(f"  DELTA since last: RSS {rss_delta:+.1f} MB, "
                  f"DB {db_delta:+,} rows")

            elapsed_min = (time.time() - start) / 60
            total_rss_delta = curr["process"]["rss_mb"] - snapshots[0]["process"]["rss_mb"]
            if elapsed_min > 0:
                print(f"  RATE:  RSS {total_rss_delta/elapsed_min:+.2f} MB/min")
                print(f"  PROJECTED 24h: RSS {total_rss_delta/elapsed_min*1440:+.0f} MB")

        remaining = duration - (time.time() - start)
        if remaining > interval:
            time.sleep(interval)

    print(f"\n{'='*60}")
    print(f"  SUMMARY over {duration}s")
    print(f"{'='*60}")
    first = snapshots[0]
    last = snapshots[-1]
    print(f"  RSS:    {first['process']['rss_mb']:.1f} MB -> {last['process']['rss_mb']:.1f} MB "
          f"({last['process']['rss_mb'] - first['process']['rss_mb']:+.1f} MB)")
    print(f"  DB:     {first['metrics_db']['rows']:,} -> {last['metrics_db']['rows']:,} "
          f"({last['metrics_db']['rows'] - first['metrics_db']['rows']:+,})")
    print(f"{'='*60}")


if __name__ == "__main__":
    if "--watch" in sys.argv:
        watch(interval=30, duration=300)
    else:
        snapshot()
