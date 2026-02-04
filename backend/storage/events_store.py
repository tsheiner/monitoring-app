"""
SQLite wrapper for events storage.

Stores discrete events with metadata and provides filtering/correlation queries.
"""
import sqlite3
import json
from typing import List, Dict, Optional
from pathlib import Path


class EventsStore:
    """Store and query events using SQLite."""
    
    def __init__(self, db_path: str = "data/events.db"):
        """
        Initialize events store.
        
        Args:
            db_path: Path to SQLite database file
        """
        # Ensure directory exists
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._create_schema()
    
    def _create_schema(self) -> None:
        """Create events table and indexes."""
        cursor = self.conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                severity TEXT,
                entity TEXT,
                message TEXT NOT NULL,
                metadata TEXT
            )
        """)
        
        # Create indexes for common queries
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_timestamp 
            ON events(timestamp)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_type 
            ON events(event_type)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_entity 
            ON events(entity)
        """)
        
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_severity 
            ON events(severity)
        """)
        
        self.conn.commit()
    
    def insert_event(self, event: Dict) -> int:
        """
        Insert a single event.
        
        Args:
            event: Event dict
            
        Returns:
            ID of inserted event
        """
        cursor = self.conn.cursor()
        
        metadata_json = json.dumps(event.get("metadata")) if event.get("metadata") else None
        
        cursor.execute("""
            INSERT INTO events (timestamp, event_type, severity, entity, message, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            event["timestamp"],
            event["event_type"],
            event.get("severity"),
            event.get("entity"),
            event["message"],
            metadata_json
        ))
        
        self.conn.commit()
        return cursor.lastrowid
    
    def insert_batch(self, events: List[Dict]) -> None:
        """
        Insert multiple events efficiently.
        
        Args:
            events: List of event dicts
        """
        cursor = self.conn.cursor()
        
        rows = [
            (
                event["timestamp"],
                event["event_type"],
                event.get("severity"),
                event.get("entity"),
                event["message"],
                json.dumps(event.get("metadata")) if event.get("metadata") else None
            )
            for event in events
        ]
        
        cursor.executemany("""
            INSERT INTO events (timestamp, event_type, severity, entity, message, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        """, rows)
        
        self.conn.commit()
    
    def query_range(
        self,
        start: int,
        end: int,
        event_type: Optional[str] = None,
        entity: Optional[str] = None,
        severity: Optional[str] = None
    ) -> List[Dict]:
        """
        Query events in a time range with optional filters.
        
        Args:
            start: Start timestamp
            end: End timestamp
            event_type: Filter by event type
            entity: Filter by entity
            severity: Filter by severity
            
        Returns:
            List of event dicts sorted by timestamp
        """
        cursor = self.conn.cursor()
        
        query = "SELECT * FROM events WHERE timestamp BETWEEN ? AND ?"
        params = [start, end]
        
        if event_type:
            query += " AND event_type = ?"
            params.append(event_type)
        
        if entity:
            query += " AND entity = ?"
            params.append(entity)
        
        if severity:
            query += " AND severity = ?"
            params.append(severity)
        
        query += " ORDER BY timestamp ASC"
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
        events = []
        for row in rows:
            event = {
                "id": row["id"],
                "timestamp": row["timestamp"],
                "event_type": row["event_type"],
                "severity": row["severity"],
                "entity": row["entity"],
                "message": row["message"],
                "metadata": json.loads(row["metadata"]) if row["metadata"] else None
            }
            events.append(event)
        
        return events
    
    def get_latest(self, limit: int = 100) -> List[Dict]:
        """
        Get most recent events.
        
        Args:
            limit: Max number of events
            
        Returns:
            List of latest events, newest first
        """
        cursor = self.conn.cursor()
        
        cursor.execute("""
            SELECT * FROM events 
            ORDER BY timestamp DESC 
            LIMIT ?
        """, (limit,))
        
        rows = cursor.fetchall()
        
        events = []
        for row in rows:
            event = {
                "id": row["id"],
                "timestamp": row["timestamp"],
                "event_type": row["event_type"],
                "severity": row["severity"],
                "entity": row["entity"],
                "message": row["message"],
                "metadata": json.loads(row["metadata"]) if row["metadata"] else None
            }
            events.append(event)
        
        return events
    
    def count_events(self, event_type: Optional[str] = None) -> int:
        """
        Count total events, optionally filtered by type.
        
        Args:
            event_type: Optional event type filter
            
        Returns:
            Count of events
        """
        cursor = self.conn.cursor()
        
        if event_type:
            cursor.execute("SELECT COUNT(*) FROM events WHERE event_type = ?", (event_type,))
        else:
            cursor.execute("SELECT COUNT(*) FROM events")
        
        return cursor.fetchone()[0]
    
    def delete_all(self) -> None:
        """Delete all events from the store."""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM events")
        self.conn.commit()
    
    def close(self) -> None:
        """Close database connection."""
        self.conn.close()


# Singleton instance
_store_instance = None

def get_events_store(db_path: str = "data/events.db") -> EventsStore:
    """Get or create the global events store instance."""
    global _store_instance
    if _store_instance is None:
        _store_instance = EventsStore(db_path)
    return _store_instance
