const path = require('path');
require('dotenv').config({path: path.join(__dirname, '.env')});
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');

const generateRouter = require('./routes/generate');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure outputs directory exists
fs.ensureDirSync(path.join(__dirname, 'outputs'));

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve generated videos statically
app.use('/videos', express.static(path.join(__dirname, 'outputs')));

// API Routes
app.use('/api/generate', generateRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

app.get('/', (req, res) => {
  res.send('Server is running 🚀');
});
