"""
WebSocket broadcast server for real-time metric and event streaming.

Broadcasts all observations to all connected clients (ADR-003).
"""
import asyncio
import json
from typing import Set
import websockets
from websockets.server import WebSocketServerProtocol


class WebSocketServer:
    """Broadcast server for real-time metrics and events."""
    
    def __init__(self, host: str = "localhost", port: int = 8000):
        """
        Initialize WebSocket server.
        
        Args:
            host: Host to bind to
            port: Port to listen on
        """
        self.host = host
        self.port = port
        self.clients: Set[WebSocketServerProtocol] = set()
        self.server = None
    
    async def register(self, websocket: WebSocketServerProtocol) -> None:
        """Register a new client connection."""
        self.clients.add(websocket)
        print(f"Client connected. Total clients: {len(self.clients)}")
    
    async def unregister(self, websocket: WebSocketServerProtocol) -> None:
        """Unregister a client connection."""
        self.clients.discard(websocket)
        print(f"Client disconnected. Total clients: {len(self.clients)}")
    
    async def handler(self, websocket: WebSocketServerProtocol) -> None:
        """
        Handle WebSocket connection.
        
        Registers client and keeps connection alive.
        """
        await self.register(websocket)
        try:
            # Keep connection alive, wait for client disconnect
            async for message in websocket:
                # We don't expect messages from clients in broadcast model
                # But handle gracefully if received
                pass
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self.unregister(websocket)
    
    async def broadcast_metric(self, observation: dict) -> None:
        """
        Broadcast a metric observation to all clients.
        
        Args:
            observation: Dict with timestamp, metric, value
        """
        if not self.clients:
            return
        
        message = json.dumps({
            "type": "metric",
            **observation
        })
        
        # Broadcast to all clients
        disconnected = set()
        for client in self.clients:
            try:
                await client.send(message)
            except websockets.exceptions.ConnectionClosed:
                disconnected.add(client)
        
        # Clean up disconnected clients
        for client in disconnected:
            await self.unregister(client)
    
    async def broadcast_event(self, event: dict) -> None:
        """
        Broadcast an event to all clients.
        
        Args:
            event: Event dict
        """
        if not self.clients:
            return
        
        message = json.dumps({
            "type": "event",
            **event
        })
        
        # Broadcast to all clients
        disconnected = set()
        for client in self.clients:
            try:
                await client.send(message)
            except websockets.exceptions.ConnectionClosed:
                disconnected.add(client)
        
        # Clean up disconnected clients
        for client in disconnected:
            await self.unregister(client)
    
    async def start(self) -> None:
        """Start the WebSocket server."""
        self.server = await websockets.serve(
            self.handler,
            self.host,
            self.port
        )
        print(f"WebSocket server started on ws://{self.host}:{self.port}")
    
    async def stop(self) -> None:
        """Stop the WebSocket server."""
        if self.server:
            self.server.close()
            await self.server.wait_closed()
            print("WebSocket server stopped")


# Global instance
_server_instance = None

def get_websocket_server(host: str = "localhost", port: int = 8000) -> WebSocketServer:
    """Get or create the global WebSocket server instance."""
    global _server_instance
    if _server_instance is None:
        _server_instance = WebSocketServer(host, port)
    return _server_instance
