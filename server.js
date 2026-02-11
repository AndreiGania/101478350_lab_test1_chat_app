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

// =========================
// MongoDB Connection
// =========================
mongoose
  .connect("mongodb://127.0.0.1:27017/comp3133_chatapp")
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log(err));

// =========================
// Serve Pages
// =========================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.get("/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "signup.html"));
});

app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "chat.html"));
});

// =========================
// Signup API
// =========================
app.post("/api/signup", async (req, res) => {
  try {
    const { username, firstname, lastname, password } = req.body;

    const user = await User.create({
      username,
      firstname,
      lastname,
      password
    });

    res.json({ ok: true, user });
  } catch (e) {
    if (e.code === 11000) {
      return res.status(400).json({ ok: false, message: "Username already exists" });
    }
    res.status(400).json({ ok: false, message: e.message });
  }
});

// =========================
// Login API
// =========================
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username, password });

    if (!user) {
      return res.status(401).json({ ok: false, message: "Invalid credentials" });
    }

    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

const server = http.createServer(app);
const io = new Server(server);

// =========================
// Predefined Rooms
// =========================
const ROOMS = ["devops", "cloud computing", "covid19", "sports", "nodeJS"];

// =========================
// Socket.io
// =========================
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Send available rooms
  socket.on("rooms:list", () => {
    socket.emit("rooms:list", ROOMS);
  });

  // Join room
  socket.on("room:join", async ({ room, username }) => {
    if (!ROOMS.includes(room)) return;

    socket.join(room);
    socket.data.username = username;
    socket.data.room = room;

    // Load last 25 messages
    const history = await GroupMessage.find({ room })
      .sort({ _id: -1 })
      .limit(25);

    socket.emit("room:history", history.reverse());

    io.to(room).emit("room:system", {
      message: `${username} joined ${room}`
    });
  });

  // Leave room
  socket.on("room:leave", () => {
    const room = socket.data.room;
    const username = socket.data.username;

    if (room) {
      socket.leave(room);
      io.to(room).emit("room:system", {
        message: `${username} left ${room}`
      });
    }
  });

  // Group message
  socket.on("room:message", async (message) => {
    const room = socket.data.room;
    const username = socket.data.username;

    if (!room || !username) return;

    const newMessage = await GroupMessage.create({
      from_user: username,
      room,
      message
    });

    io.to(room).emit("room:message", newMessage);
  });

  // Typing indicator
  socket.on("typing", () => {
    const room = socket.data.room;
    const username = socket.data.username;

    if (room && username) {
      socket.to(room).emit("typing", `${username} is typing...`);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// =========================
// Start Server
// =========================
server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
