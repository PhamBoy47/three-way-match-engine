const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const documentRoutes = require('./routes/documents');
const matchRoutes = require('./routes/match');

require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// Create uploads directory if missing
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/three-way-match')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/documents', documentRoutes);
app.use('/match', matchRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

module.exports = app;