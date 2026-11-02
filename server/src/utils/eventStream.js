import { EventEmitter } from "events";

class EventStreamManager extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // clientId -> { userId, role, res, intervalId }
    this.clientCounter = 0;
  }

  registerClient(userId, role, res) {
    if (userId) {
      const targetUserStr = String(userId);
      for (const [existingId, client] of this.clients.entries()) {
        if (client.userId === targetUserStr) {
          this.removeClient(existingId);
        }
      }
    }

    const clientId = `client_${Date.now()}_${++this.clientCounter}`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });

    res.write(`: connected at ${new Date().toISOString()}\n\n`);

    const intervalId = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch (err) {
        this.removeClient(clientId);
      }
    }, 25000);
    if (intervalId.unref) {
      intervalId.unref();
    }

    const clientRecord = {
      clientId,
      userId: userId ? String(userId) : null,
      role: role ? String(role).toUpperCase() : null,
      res,
      intervalId,
    };

    this.clients.set(clientId, clientRecord);

    res.on("close", () => {
      this.removeClient(clientId);
    });

    res.on("error", () => {
      this.removeClient(clientId);
    });

    return clientId;
  }

  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      if (client.intervalId) {
        clearInterval(client.intervalId);
      }
      try {
        if (!client.res.writableEnded) {
          client.res.end();
        }
      } catch (_) {}
      this.clients.delete(clientId);
    }
  }

  sendToClient(client, event, data) {
    try {
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      client.res.write(`event: ${event}\ndata: ${payload}\n\n`);
    } catch (err) {
      this.removeClient(client.clientId);
    }
  }

  broadcastToUser(userId, event, data) {
    const targetId = String(userId);
    for (const client of this.clients.values()) {
      if (client.userId === targetId) {
        this.sendToClient(client, event, data);
      }
    }
  }

  broadcastToRole(roles, event, data) {
    const targetRoles = (Array.isArray(roles) ? roles : [roles]).map((r) => String(r).toUpperCase());
    for (const client of this.clients.values()) {
      if (client.role && targetRoles.includes(client.role)) {
        this.sendToClient(client, event, data);
      }
    }
  }

  broadcast(event, data) {
    for (const client of this.clients.values()) {
      this.sendToClient(client, event, data);
    }
  }

  closeAll() {
    for (const client of this.clients.values()) {
      if (client.intervalId) {
        clearInterval(client.intervalId);
      }
      try {
        client.res.end();
      } catch (_) {}
    }
    this.clients.clear();
  }
}

export const eventStream = new EventStreamManager();
export default eventStream;
