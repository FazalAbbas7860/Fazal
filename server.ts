import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === "production" ? (process.env.APP_URL || false) : "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // In-memory registry of online translators
  // Key: userId, Value: { socketId, username, currentLanguage }
  const onlineUsers = new Map<string, { socketId: string; username: string; currentLanguage: string }>();

  // Translation proxy API endpoint
  app.get("/api/translate", async (req, res) => {
    const { text, from, to } = req.query;

    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Missing text query parameter" });
      return;
    }

    const fromLang = (from as string) || "ur";
    const toLang = (to as string) || "zh";

    try {
      // Fetch from MyMemory Translation API
      // Standard pair format is: ur|zh, ur|zh-CN, etc.
      const pair = `${fromLang}|${toLang}`;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${pair}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`MyMemory API responded with status ${response.status}`);
      }

      const data = await response.json();
      
      let translatedText = "Translation unavailable";
      if (data && data.responseData && data.responseData.translatedText) {
        translatedText = data.responseData.translatedText;
      }

      res.json({ translatedText });
    } catch (error) {
      console.error("Translation error on backend:", error);
      res.json({ translatedText: "Translation unavailable" });
    }
  });

  // Socket.io signalling logic
  io.on("connection", (socket) => {
    let registeredUserId: string | null = null;

    // Register a new user with ID & Name
    socket.on("register", ({ userId, username, currentLanguage }) => {
      // Validate inputs
      const cleanId = String(userId).trim().toLowerCase();
      const cleanName = String(username).trim();

      if (!cleanId || !cleanName) {
        socket.emit("registration-failed", { error: "User ID and name are required." });
        return;
      }

      // Check if ID is already claimed by an active socket
      const existingUser = onlineUsers.get(cleanId);
      if (existingUser && existingUser.socketId !== socket.id) {
        // ID is in use by another socket
        socket.emit("registration-failed", { error: "This User ID is already in use by another online friend." });
        return;
      }

      // Register or update online list
      onlineUsers.set(cleanId, {
        socketId: socket.id,
        username: cleanName,
        currentLanguage: currentLanguage || "ur-PK"
      });

      registeredUserId = cleanId;

      socket.emit("registered", {
        userId: cleanId,
        username: cleanName,
        currentLanguage
      });

      // Broadcast updated count or list to other rooms if needed
      io.emit("online-count", onlineUsers.size);
    });

    // Check if a friend is online
    socket.on("check-friend", ({ friendId }, ack) => {
      const targetId = String(friendId).trim().toLowerCase();
      const friend = onlineUsers.get(targetId);
      if (friend) {
        ack({ online: true, username: friend.username, language: friend.currentLanguage });
      } else {
        ack({ online: false });
      }
    });

    // Call user: Initiator starts a call request to target callee
    socket.on("call-user", ({ targetUserId, callerId, callerName, callerLang }) => {
      const targetId = String(targetUserId).trim().toLowerCase();
      const target = onlineUsers.get(targetId);

      if (!target) {
        socket.emit("call-error", { error: "Friend is offline or does not exist." });
        return;
      }

      // Forward calling prompt to target Callee
      io.to(target.socketId).emit("incoming-call", {
        callerSocketId: socket.id,
        callerId: callerId,
        callerName: callerName,
        callerLang: callerLang
      });
    });

    // Accept Call: Callee responds positively to Incoming Call
    socket.on("accept-call", ({ callerSocketId, calleeId, calleeName, calleeLang }) => {
      io.to(callerSocketId).emit("call-accepted", {
        calleeSocketId: socket.id,
        calleeId,
        calleeName,
        calleeLang
      });
    });

    // Reject Call: Callee declines call request
    socket.on("reject-call", ({ callerSocketId }) => {
      io.to(callerSocketId).emit("call-rejected");
    });

    // Signal Offer: WebRTC SDP Offer
    socket.on("sdp-offer", ({ targetSocketId, sdp }) => {
      io.to(targetSocketId).emit("sdp-offer", {
        senderSocketId: socket.id,
        sdp
      });
    });

    // Signal Answer: WebRTC SDP Answer
    socket.on("sdp-answer", ({ targetSocketId, sdp }) => {
      io.to(targetSocketId).emit("sdp-answer", {
        sdp
      });
    });

    // ICE Candidate exchange
    socket.on("ice-candidate", ({ targetSocketId, candidate }) => {
      io.to(targetSocketId).emit("ice-candidate", {
        candidate
      });
    });

    // Live speech transcript translation broadcast
    // This allows instant subtitles display even before the remote peer speaks it out
    socket.on("voice-subtitle", ({ targetSocketId, text, translatedText, from, to }) => {
      io.to(targetSocketId).emit("voice-subtitle", {
        text,
        translatedText,
        from,
        to
      });
    });

    // Hangup the ongoing call
    socket.on("hang-up", ({ targetSocketId }) => {
      io.to(targetSocketId).emit("call-hung-up");
    });

    // Handle Connection failure / Disconnect cleanup
    socket.on("disconnect", () => {
      if (registeredUserId) {
        onlineUsers.delete(registeredUserId);
        io.emit("online-count", onlineUsers.size);

        // Notify anyone calling or in active session with this user
        // By broadcasting that they left
        socket.broadcast.emit("peer-disconnected", { userId: registeredUserId });
      }
    });
  });

  // Integration with Vite
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Express and Socket.io server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Server startup failed:", err);
});
