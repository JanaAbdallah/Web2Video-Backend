const path = require('path');
require('dotenv').config({path: path.join(__dirname, '.env')});
const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');

const generateRouter = require('./routes/generate');

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
  console.log(`✅ Server bound to 0.0.0.0 and running on port ${PORT}`);
});

app.get('/', (req, res) => {
  res.send('Server is running 🚀');
});
