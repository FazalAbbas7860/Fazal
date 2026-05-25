const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
// Serve static client assets of our beginner project
app.use(express.static(path.join(__dirname, "public")));

// In-Memory User Directory
const onlineUsers = new Map();

// MyMemory Proxy translate endpoint
app.get("/api/translate", async (req, res) => {
  const { text, from, to } = req.query;

  if (!text) {
    return res.status(400).json({ error: "Missing text to translate!" });
  }

  const fromLang = from || "ur";
  const toLang = to || "zh";

  try {
    const pair = `${fromLang}|${toLang}`;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`MyMemory error: status ${response.status}`);
    }

    const data = await response.json();
    let translatedText = "Translation unavailable";
    if (data && data.responseData && data.responseData.translatedText) {
      translatedText = data.responseData.translatedText;
    }

    res.json({ translatedText });
  } catch (err) {
    console.error("Translation proxy error:", err);
    res.json({ translatedText: "Translation unavailable" });
  }
});

// Socket.io signallers
io.on("connection", (socket) => {
  let registeredUserId = null;

  socket.on("register", ({ userId, username, currentLanguage }) => {
    const cleanId = String(userId).trim().toLowerCase();
    const cleanName = String(username).trim();

    if (!cleanId || !cleanName) {
      socket.emit("registration-failed", { error: "User ID and Name are required" });
      return;
    }

    if (onlineUsers.has(cleanId) && onlineUsers.get(cleanId).socketId !== socket.id) {
      socket.emit("registration-failed", { error: "This User ID is already taken by an online friend." });
      return;
    }

    onlineUsers.set(cleanId, {
      socketId: socket.id,
      username: cleanName,
      currentLanguage: currentLanguage || "ur-PK"
    });

    registeredUserId = cleanId;
    socket.emit("registered", { userId: cleanId, username: cleanName, currentLanguage });
    io.emit("online-count", onlineUsers.size);
  });

  socket.on("check-friend", ({ friendId }, callback) => {
    const targetId = String(friendId).trim().toLowerCase();
    const friend = onlineUsers.get(targetId);
    if (friend) {
      callback({ online: true, username: friend.username, language: friend.currentLanguage });
    } else {
      callback({ online: false });
    }
  });

  socket.on("call-user", ({ targetUserId, callerId, callerName, callerLang }) => {
    const targetId = String(targetUserId).trim().toLowerCase();
    const target = onlineUsers.get(targetId);
    if (target) {
      io.to(target.socketId).emit("incoming-call", {
        callerSocketId: socket.id,
        callerId,
        callerName,
        callerLang
      });
    } else {
      socket.emit("call-error", { error: "Friend offline or does not exist." });
    }
  });

  socket.on("accept-call", ({ callerSocketId, calleeId, calleeName, calleeLang }) => {
    io.to(callerSocketId).emit("call-accepted", {
      calleeSocketId: socket.id,
      calleeId,
      calleeName,
      calleeLang
    });
  });

  socket.on("reject-call", ({ callerSocketId }) => {
    io.to(callerSocketId).emit("call-rejected");
  });

  socket.on("sdp-offer", ({ targetSocketId, sdp }) => {
    io.to(targetSocketId).emit("sdp-offer", {
      senderSocketId: socket.id,
      sdp
    });
  });

  socket.on("sdp-answer", ({ targetSocketId, sdp }) => {
    io.to(targetSocketId).emit("sdp-answer", { sdp });
  });

  socket.on("ice-candidate", ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit("ice-candidate", { candidate });
  });

  socket.on("voice-subtitle", ({ targetSocketId, text, translatedText, from, to }) => {
    io.to(targetSocketId).emit("voice-subtitle", { text, translatedText, from, to });
  });

  socket.on("hang-up", ({ targetSocketId }) => {
    io.to(targetSocketId).emit("call-hung-up");
  });

  socket.on("disconnect", () => {
    if (registeredUserId) {
      onlineUsers.delete(registeredUserId);
      io.emit("online-count", onlineUsers.size);
      socket.broadcast.emit("peer-disconnected", { userId: registeredUserId });
    }
  });
});

// Fallback HTML router
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Vanilla Realtime Voice Translator running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browsers`);
});
