const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');

const generateRouter = require('./routes/generate');
const { warmUp } = require('./services/videoService');

const app = express();
const PORT = process.env.PORT || 3008;

// Ensure outputs directory exists
fs.ensureDirSync(path.join(__dirname, 'outputs'));

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve generated videos statically
app.use('/videos', express.static(path.join(__dirname, 'outputs')));

// API Routes
app.use('/api/generate', generateRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);

  // KEY OPTIMISATION: pre-warm the Remotion bundle and Chromium executable
  // in the background right after the server starts — so the FIRST real user
  // request doesn't have to wait an extra ~30s for cold-start bundling.
  warmUp();
});

app.get('/', (req, res) => {
  res.send('Server is running 🚀');
});