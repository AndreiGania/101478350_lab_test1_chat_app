const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3
  },
  firstname: {
    type: String,
    required: true,
    trim: true
  },
  lastname: {
    type: String,
    required: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 3
  },
  createon: {
    type: String,
    default: () => new Date().toLocaleString()
  }
});


userSchema.index({ username: 1 }, { unique: true });

module.exports = mongoose.model("User", userSchema);
