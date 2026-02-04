# Event Schema

Discrete events that occur in the network, overlaid on metric timeseries for correlation analysis.

## Event Format

All events follow this consistent schema:

```javascript
{
    "timestamp": 1234567890,           // Unix timestamp (seconds)
    "event_type": "device_restart",    // Event category
    "severity": "warning",             // Optional: info|warning|critical
    "entity": "AP-Floor3-02",          // Affected device/system
    "message": "Access point rebooted unexpectedly",
    "metadata": {                      // Event-specific fields
        "previous_uptime": 86400,
        "reason": "watchdog_timeout",
        "firmware_version": "2.4.1"
    }
}
```

## Field Definitions

### timestamp

**Type**: Integer (Unix seconds)

**Required**: Yes

**Description**: When the event occurred (not when it was recorded)

---

### event_type

**Type**: String

**Required**: Yes

**Description**: Category of event for filtering and correlation

**Valid values**: See Event Types section below

---

### severity

**Type**: String | null

**Required**: No

**Description**: Impact level, when applicable. Nullable because not all events have inherent severity (e.g., routine config changes).

**Valid values**:

- `"info"` - Informational, no action required
- `"warning"` - Potential issue, monitor
- `"critical"` - Urgent, likely causing user impact
- `null` - Not applicable

**Source**: Typically from originating system (syslog level, SNMP trap severity). Not interpreted/assigned by us.

---

### entity

**Type**: String | null

**Required**: No

**Description**: Specific device, system, or component affected. Enables per-entity filtering.

**Examples**:

- `"AP-Floor3-02"` (specific access point)
- `"WAN-link-1"` (network link)
- `"controller"` (system-wide)
- `null` (no specific entity)

---

### message

**Type**: String

**Required**: Yes

**Description**: Human-readable description of what happened

**Guidelines**:

- Past tense ("rebooted", not "reboot")
- Concise (< 200 chars)
- Actionable when possible

---

### metadata

**Type**: Object

**Required**: No

**Description**: Event-specific structured data. Schema varies by event_type.

**Purpose**: Enable programmatic analysis, correlation, and filtering beyond simple text search.

---

## Event Types

### Device Lifecycle

**Event Type**: `device_restart`

**Severity**: Typically `warning` (unexpected) or `info` (scheduled)

**Common metadata**:

```javascript
{
    "previous_uptime": 86400,        // seconds
    "reason": "watchdog_timeout",    // or "manual", "scheduled", "power_loss"
    "initiated_by": "system"         // or "admin", "automation"
}
```

**Event Type**: `device_crash`

**Severity**: `critical`

**Common metadata**:

```javascript
{
    "crash_reason": "kernel_panic",
    "uptime_at_crash": 432000,
    "last_error": "..."
}
```

**Event Type**: `firmware_update`

**Severity**: `info`

**Common metadata**:

```javascript
{
    "from_version": "2.3.5",
    "to_version": "2.4.1",
    "update_method": "auto" | "manual"
}
```

---

### Configuration Changes

**Event Type**: `config_change`

**Severity**: Usually `null` (routine operation)

**Common metadata**:

```javascript
{
    "changed_by": "admin_user",      // or "automation", "ai_agent"
    "change_type": "channel_switch", // or "power_adjust", "policy_update"
    "old_value": "6",
    "new_value": "11"
}
```

---

### AI Agent Actions

**Event Type**: `ai_action`

**Severity**: `info` or `null`

**Common metadata**:

```javascript
{
    "action_type": "channel_optimization",
    "reasoning": "Detected interference on channel 6, moved to channel 11",
    "confidence": 0.87,              // AI confidence score
    "expected_impact": "+15% throughput"
}
```

**Note**: AI actions are just another event type. No special treatment in data layer. Interpretation/visualization layer can highlight them.

---

### Security Events (BONUS)

**Event Type**: `security_incident`

**Severity**: `warning` or `critical`

**Common metadata**:

```javascript
{
    "incident_type": "unauthorized_access_attempt",
    "source_ip": "192.168.1.105",
    "blocked": true,
    "rule_triggered": "rate_limit_exceeded"
}
```

---

## Storage Schema (SQLite)

```sql
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    severity TEXT,                  -- Nullable
    entity TEXT,                    -- Nullable
    message TEXT NOT NULL,
    metadata TEXT                   -- JSON string, nullable
);

CREATE INDEX idx_events_timestamp ON events(timestamp);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_entity ON events(entity);
CREATE INDEX idx_events_severity ON events(severity);
```

**Query patterns**:

```sql
-- Events in time range
SELECT * FROM events WHERE timestamp BETWEEN ? AND ?;

-- Events by type
SELECT * FROM events WHERE event_type = ? AND timestamp BETWEEN ? AND ?;

-- Critical events only
SELECT * FROM events WHERE severity = 'critical' AND timestamp BETWEEN ? AND ?;

-- Events for specific entity
SELECT * FROM events WHERE entity = ? AND timestamp BETWEEN ? AND ?;
```

---

## WebSocket Stream Format

```javascript
{
    "type": "event",
    "data": {
        "timestamp": 1234567890,
        "event_type": "device_restart",
        "severity": "warning",
        "entity": "AP-Floor3-02",
        "message": "Access point rebooted unexpectedly",
        "metadata": {
            "previous_uptime": 86400,
            "reason": "watchdog_timeout"
        }
    }
}
```

**Broadcasting**: All events broadcast to all clients. Client-side filtering by event_type.

---

## Event-Metric Correlation

Events often cause observable changes in metrics:

### Example: Device Restart

**Event**:

```javascript
{
    "timestamp": 1000,
    "event_type": "device_restart",
    "entity": "AP-Floor3-02"
}
```

**Expected metric changes** (for this entity):

- `ap_health`: Drop to 0 → recover to ~80 over 30-60s
- `capacity`: Drop to 0 → gradual recovery as clients reconnect
- `successful_connects`: Spike in failures during restart
- `time_to_connect`: Spike as clients re-authenticate

**Visualization**: Event marker on chart aligns with metric changes, enabling visual correlation.

---

## Event Generation Strategy

For simulator:

### Background Events (Random)

- Device restarts: 1-3 per day per AP (random timing)
- Config changes: 5-10 per day (clustered in business hours)
- Firmware updates: 1-2 per week (scheduled, low-traffic hours)

### Triggered Events (On Demand)

- AI actions: Triggered when metric crosses threshold
- Security incidents: Injected via API/UI for demo

### Correlation

- Event timestamp → metric change with small delay (1-10s)
- Magnitude based on event severity
- Recovery curve (spike → gradual return to baseline)

---

## Extensibility

Future event types to consider:

- `client_roam` - Track individual roaming events
- `alert_triggered` - When alerting system fires
- `threshold_breach` - Metric crosses user-defined threshold
- `anomaly_detected` - Statistical anomaly detection
- `capacity_warning` - Predictive capacity alert
- `user_intervention` - Manual admin action

Schema is flexible - add new event_types without schema changes, just document metadata structure.
