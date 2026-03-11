const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

const allowedOrigins = [
  "https://watchyparty.netlify.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
  "http://localhost:5500"
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Watchy Party server is running");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 3000;

const rooms = {};

function ensureRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      hostSocketId: null,
      privacy: "public",
      participants: {},
      pending: {}
    };
  }
  return rooms[roomId];
}

function safeParticipants(room) {
  return Object.fromEntries(
    Object.entries(room.participants).map(([id, value]) => [
      id,
      { userName: value.userName, role: value.role }
    ])
  );
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("host-create-room", ({ roomId, userName, privacy }) => {
    if (!roomId) return;

    const room = ensureRoom(roomId);

    room.hostSocketId = socket.id;
    room.privacy = privacy === "private" ? "private" : "public";
    room.participants[socket.id] = {
      userName: userName || "Host",
      role: "host"
    };

    socket.join(roomId);

    socket.emit("room-created", {
      roomId,
      privacy: room.privacy
    });

    io.to(roomId).emit("participants-update", safeParticipants(room));
    console.log("Room created:", roomId, room.privacy);
  });

  socket.on("guest-join-request", ({ roomId, userName }) => {
    const room = rooms[roomId];

    if (!room) {
      socket.emit("join-denied", { reason: "Room not found" });
      return;
    }

    if (room.privacy === "public") {
      room.participants[socket.id] = {
        userName: userName || "Guest",
        role: "guest"
      };

      socket.join(roomId);

      socket.emit("join-approved", {
        roomId,
        privacy: room.privacy
      });

      if (room.hostSocketId) {
        io.to(room.hostSocketId).emit("guest-approved", {
          targetSocketId: socket.id,
          userName: userName || "Guest"
        });
      }

      io.to(roomId).emit("participants-update", safeParticipants(room));
      return;
    }

    room.pending[socket.id] = {
      userName: userName || "Guest"
    };

    if (room.hostSocketId) {
      io.to(room.hostSocketId).emit("join-request", {
        targetSocketId: socket.id,
        userName: userName || "Guest"
      });
    }
  });

  socket.on("approve-join", ({ roomId, targetSocketId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.hostSocketId !== socket.id) return;

    const request = room.pending[targetSocketId];
    if (!request) return;

    room.participants[targetSocketId] = {
      userName: request.userName,
      role: "guest"
    };

    delete room.pending[targetSocketId];

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.join(roomId);
      io.to(targetSocketId).emit("join-approved", {
        roomId,
        privacy: room.privacy
      });
    }

    io.to(socket.id).emit("guest-approved", {
      targetSocketId,
      userName: request.userName
    });

    io.to(roomId).emit("participants-update", safeParticipants(room));
  });

  socket.on("reject-join", ({ roomId, targetSocketId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.hostSocketId !== socket.id) return;

    delete room.pending[targetSocketId];

    io.to(targetSocketId).emit("join-denied", {
      reason: "Admin rejected your request"
    });
  });

  socket.on("set-room-privacy", ({ roomId, privacy }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.hostSocketId !== socket.id) return;

    room.privacy = privacy === "private" ? "private" : "public";
    io.to(roomId).emit("room-privacy-updated", room.privacy);
  });

  socket.on("offer", ({ targetSocketId, offer }) => {
    io.to(targetSocketId).emit("offer", {
      fromSocketId: socket.id,
      offer
    });
  });

  socket.on("answer", ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit("answer", {
      fromSocketId: socket.id,
      answer
    });
  });

  socket.on("ice-candidate", ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit("ice-candidate", {
      fromSocketId: socket.id,
      candidate
    });
  });

  socket.on("chat-message", ({ roomId, sender, text }) => {
    if (!roomId || !text) return;

    io.to(roomId).emit("chat-message", {
      sender: sender || "User",
      text,
      time: new Date().toLocaleTimeString()
    });
  });

  socket.on("disconnect", () => {
    for (const roomId of Object.keys(rooms)) {
      const room = rooms[roomId];
      const wasHost = room.hostSocketId === socket.id;

      delete room.participants[socket.id];
      delete room.pending[socket.id];

      if (wasHost) {
        io.to(roomId).emit("room-closed");
        delete rooms[roomId];
      } else {
        io.to(roomId).emit("participant-left", { socketId: socket.id });
        io.to(roomId).emit("participants-update", safeParticipants(room));
      }
    }

    console.log("Disconnected:", socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

