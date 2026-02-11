require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const User = require("./models/User");
const GroupMessage = require("./models/GroupMessage");
const PrivateMessage = require("./models/PrivateMessage");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/comp3133_chatapp";

mongoose.connection.on("connected", () =>
  console.log("MongoDB connected:", MONGODB_URI)
);
mongoose.connection.on("error", (err) =>
  console.log("MongoDB connection error:", err.message)
);
mongoose.connection.on("disconnected", () =>
  console.log("MongoDB disconnected")
);

mongoose.set("bufferCommands", false);

(async () => {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  } catch (err) {
    console.log("Failed to connect to MongoDB:", err.message);
    console.log(
      "Fix: Start MongoDB service (local) OR set MONGODB_URI in .env (Atlas) + whitelist your IP."
    );
  }
})();

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});
app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "signup.html"));
});
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "chat.html"));
});

// --------------------
// APIs
// --------------------

// Signup
app.post("/api/signup", async (req, res) => {
  try {
    const { username, firstname, lastname, password } = req.body;

    const user = await User.create({ username, firstname, lastname, password });

    res.json({
      ok: true,
      user: { username: user.username, firstname: user.firstname, lastname: user.lastname },
    });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(400).json({ ok: false, message: "Username already exists" });
    }
    res.status(400).json({ ok: false, message: e.message });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username, password });
    if (!user) return res.status(401).json({ ok: false, message: "Invalid credentials" });

    res.json({
      ok: true,
      user: { username: user.username, firstname: user.firstname, lastname: user.lastname },
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// List users
app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find({}, { username: 1, _id: 0 }).sort({ username: 1 });
    res.json({ ok: true, users });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// --------------------
// Socket.io
// --------------------
const server = http.createServer(app);
const io = new Server(server);

const ROOMS = ["devops", "cloud computing", "covid19", "sports", "nodeJS"];
const onlineUsers = new Map();

const nowStamp = () => new Date().toISOString();

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Register online user for private messaging delivery
  socket.on("user:online", ({ username }) => {
    if (!username) return;
    socket.data.username = username;

    if (!onlineUsers.has(username)) onlineUsers.set(username, new Set());
    onlineUsers.get(username).add(socket.id);
  });

  socket.on("rooms:list", () => {
    socket.emit("rooms:list", ROOMS);
  });

  // Join room + load history
  socket.on("room:join", async ({ room, username }) => {
    try {
      if (!ROOMS.includes(room)) return;

      // leave previous room first
      if (socket.data.room) socket.leave(socket.data.room);

      socket.join(room);
      socket.data.room = room;

      if (username && !socket.data.username) {
        socket.data.username = username;
        if (!onlineUsers.has(username)) onlineUsers.set(username, new Set());
        onlineUsers.get(username).add(socket.id);
      }

      const history = await GroupMessage.find({ room })
        .sort({ _id: -1 })
        .limit(25);

      socket.emit("room:history", history.reverse());

      io.to(room).emit("room:system", {
        message: `${socket.data.username || "User"} joined ${room}`,
      });
    } catch (err) {
      console.error("room:join error:", err.message);
      socket.emit("room:history", []);
    }
  });

  socket.on("room:leave", () => {
    const room = socket.data.room;
    const username = socket.data.username;

    if (room) {
      socket.leave(room);
      io.to(room).emit("room:system", { message: `${username || "User"} left ${room}` });
      socket.data.room = null;
    }
  });

  // Room message: save to DB + emit to room
  socket.on("room:message", async (message) => {
    try {
      const room = socket.data.room;
      const username = socket.data.username;

      if (!room || !username || !message?.trim()) return;

      const saved = await GroupMessage.create({
        from_user: username,
        room,
        message: message.trim(),
        date_sent: nowStamp(), // ✅ add timestamp
      });

      io.to(room).emit("room:message", saved);
    } catch (err) {
      console.error("room:message error:", err.message);
    }
  });

  // Room typing indicator
  socket.on("typing", () => {
    const room = socket.data.room;
    const username = socket.data.username;
    if (room && username) {
      socket.to(room).emit("typing", `${username} is typing...`);
    }
  });

  // -------------------------
  // Private chat
  // -------------------------
  socket.on("pm:open", async ({ to_user }) => {
    try {
      const from_user = socket.data.username;
      if (!from_user || !to_user) return;

      const history = await PrivateMessage.find({
        $or: [
          { from_user, to_user },
          { from_user: to_user, to_user: from_user },
        ],
      })
        .sort({ _id: -1 })
        .limit(30);

      socket.emit("pm:history", { with_user: to_user, messages: history.reverse() });
    } catch (err) {
      console.error("pm:open error:", err.message);
      socket.emit("pm:history", { with_user: to_user, messages: [] });
    }
  });

  socket.on("pm:send", async ({ to_user, message }) => {
    try {
      const from_user = socket.data.username;
      if (!from_user || !to_user || !message?.trim()) return;

      const saved = await PrivateMessage.create({
        from_user,
        to_user,
        message: message.trim(),
        date_sent: nowStamp(), // ✅ add timestamp
      });

      const senderSockets = onlineUsers.get(from_user) || new Set();
      senderSockets.forEach((sid) => io.to(sid).emit("pm:message", saved));

      const receiverSockets = onlineUsers.get(to_user) || new Set();
      receiverSockets.forEach((sid) => io.to(sid).emit("pm:message", saved));
    } catch (err) {
      console.error("pm:send error:", err.message);
    }
  });

  // Typing indicator for private chat
  socket.on("pm:typing", ({ to_user }) => {
    const from_user = socket.data.username;
    if (!from_user || !to_user) return;

    const receiverSockets = onlineUsers.get(to_user) || new Set();
    receiverSockets.forEach((sid) => io.to(sid).emit("pm:typing", { from_user }));
  });

  socket.on("disconnect", () => {
    const username = socket.data.username;
    if (username && onlineUsers.has(username)) {
      onlineUsers.get(username).delete(socket.id);
      if (onlineUsers.get(username).size === 0) onlineUsers.delete(username);
    }
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
