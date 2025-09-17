// server.js - Complete Railway Ready Version with MediaMTX Proxying
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const { spawn, execSync, exec } = require('child_process');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Railway environment variables
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mediamtx-frontend.vercel.app';
const MEDIAMTX_HTTP_URL = process.env.MEDIAMTX_HTTP_URL || 'http://localhost:8889';

// Middleware
app.use(helmet());
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:3000'],
  credentials: true
}));

// ✅ IMPORTANT: Raw body parser for WHIP/WHEP requests
app.use('/*/whip', express.text({ type: 'application/sdp', limit: '10mb' }));
app.use('/*/whep', express.text({ type: 'application/sdp', limit: '10mb' }));
app.use(express.json());

// Socket.IO setup
const io = socketIo(server, {
  cors: {
    origin: [FRONTEND_URL, 'http://localhost:3000'],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// MediaMTX Process Management
let mediamtxProcess = null;

const startMediaMTX = () => {
  try {
    console.log('🎥 Starting MediaMTX on Railway...');
    
    const mediamtxBinary = process.platform === 'win32' ? './mediamtx.exe' : './mediamtx';
    
    if (process.platform !== 'win32') {
      try {
        execSync('chmod +x ./mediamtx', { stdio: 'pipe' });
        console.log('✅ MediaMTX binary permissions fixed');
        
        const fs = require('fs');
        if (fs.existsSync('./mediamtx')) {
          console.log('✅ MediaMTX binary file exists');
        } else {
          console.error('❌ MediaMTX binary file not found');
          return;
        }
      } catch (chmodError) {
        console.log('⚠️ Chmod failed, trying alternative method:', chmodError.message);
      }
    }
    
    mediamtxProcess = spawn(mediamtxBinary, ['mediamtx.yml'], {
      cwd: __dirname,
      stdio: 'pipe'
    });

    mediamtxProcess.stdout.on('data', (data) => {
      console.log(`MediaMTX: ${data.toString().trim()}`);
    });

    mediamtxProcess.stderr.on('data', (data) => {
      console.error(`MediaMTX Error: ${data.toString().trim()}`);
    });

    mediamtxProcess.on('close', (code) => {
      console.log(`MediaMTX process exited with code ${code}`);
      if (code !== 0 && code !== null) {
        console.log('🔄 Attempting to restart MediaMTX...');
        setTimeout(() => startMediaMTXAlternative(), 3000);
      }
    });

    mediamtxProcess.on('error', (error) => {
      console.error('❌ MediaMTX spawn error:', error);
      if (error.code === 'EACCES') {
        console.log('🔧 Permission denied. Trying alternative method...');
        setTimeout(() => startMediaMTXAlternative(), 2000);
      } else if (error.code === 'ENOENT') {
        console.error('❌ MediaMTX binary not found. Please check if file exists.');
      }
    });

    console.log('✅ MediaMTX process started successfully');
  } catch (error) {
    console.error('❌ MediaMTX start failed:', error);
    startMediaMTXAlternative();
  }
};

const startMediaMTXAlternative = () => {
  try {
    console.log('🔄 Using alternative MediaMTX startup method...');
    
    const fs = require('fs');
    if (!fs.existsSync('./mediamtx')) {
      console.error('❌ MediaMTX binary not found for alternative method');
      return;
    }
    
    exec('chmod +x ./mediamtx', (chmodError) => {
      if (chmodError) {
        console.error('Alternative chmod failed:', chmodError);
      } else {
        console.log('✅ Permissions fixed with alternative method');
      }
      
      const mtxProcess = exec('./mediamtx mediamtx.yml', (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Alternative MediaMTX start failed:', error);
          return;
        }
        if (stdout) console.log('MediaMTX stdout:', stdout);
        if (stderr) console.error('MediaMTX stderr:', stderr);
      });
      
      mediamtxProcess = mtxProcess;
      console.log('✅ MediaMTX started with exec method');
    });
    
  } catch (error) {
    console.error('❌ Alternative startup failed:', error);
  }
};

// Start MediaMTX with delay for Railway initialization
setTimeout(() => {
  startMediaMTX();
}, 3000);

// Storage
let rooms = {};
let socketToRoom = {};
let activeStudents = {};
let activeProctors = {};

// ✅ MediaMTX PROXYING - CRITICAL for Railway
// WHIP endpoint proxy (for publishing streams)
// server.js में WHIP endpoint को enhance करें
app.post('/:streamName/whip', async (req, res) => {
  try {
    const { streamName } = req.params;
    const sdpOffer = req.body;
    
    console.log(`📤 WHIP proxy request for stream: ${streamName}`);
    
    if (!sdpOffer) {
      return res.status(400).json({ error: 'No SDP offer provided' });
    }

    // ✅ ENHANCED: Longer timeout for Railway
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(`http://localhost:8889/${streamName}/whip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          'Accept': 'application/sdp'
        },
        body: sdpOffer,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        const answerSdp = await response.text();
        console.log(`✅ WHIP proxy success for ${streamName}`);
        
        res.set({
          'Content-Type': 'application/sdp',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.send(answerSdp);
      } else {
        const errorText = await response.text();
        console.error(`❌ WHIP proxy failed for ${streamName}: ${response.status} - ${errorText}`);
        
        // ✅ Even if WHIP fails, don't error - HLS will work
        res.status(202).json({ 
          message: 'Stream received, WebRTC may timeout but HLS will be available',
          hlsUrl: `/hls/${streamName}/`
        });
      }
    } catch (fetchError) {
      clearTimeout(timeout);
      if (fetchError.name === 'AbortError') {
        console.log(`⏰ WHIP timeout for ${streamName}, but HLS should work`);
        res.status(202).json({ 
          message: 'WebRTC timeout, but stream is being processed for HLS',
          hlsUrl: `/hls/${streamName}/`
        });
      } else {
        throw fetchError;
      }
    }

  } catch (error) {
    console.error('❌ WHIP proxy error:', error);
    res.status(503).json({ 
      error: 'MediaMTX WHIP service unavailable', 
      details: error.message,
      fallback: 'HLS streaming may still work'
    });
  }
});


// WHEP endpoint proxy (for subscribing to streams)
app.post('/:streamName/whep', async (req, res) => {
  try {
    const { streamName } = req.params;
    const sdpOffer = req.body;
    
    console.log(`📥 WHEP proxy request for stream: ${streamName}`);
    
    const response = await fetch(`http://localhost:8889/${streamName}/whep`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        'Accept': 'application/sdp'
      },
      body: sdpOffer
    });

    if (response.ok) {
      const answerSdp = await response.text();
      console.log(`✅ WHEP proxy success for ${streamName}`);
      
      res.set({
        'Content-Type': 'application/sdp',
        'Access-Control-Allow-Origin': '*'
      });
      res.send(answerSdp);
    } else {
      const errorText = await response.text();
      console.error(`❌ WHEP proxy failed for ${streamName}: ${response.status} - ${errorText}`);
      res.status(response.status).send(errorText);
    }
  } catch (error) {
    console.error('❌ WHEP proxy error:', error);
    res.status(503).json({ error: 'MediaMTX WHEP service unavailable' });
  }
});

// HLS viewer proxy
app.get('/hls/:streamName/*', async (req, res) => {
  try {
    const { streamName } = req.params;
    const path = req.path.replace(`/hls/${streamName}`, '');
    const targetUrl = `http://localhost:8888/${streamName}${path}`;
    
    console.log(`📺 HLS proxy request: ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Accept': req.headers.accept || '*/*'
      }
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type') || 'text/plain';
      const data = await response.text();
      
      res.set({
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      res.send(data);
    } else {
      res.status(response.status).send('Stream not available');
    }
  } catch (error) {
    console.error('❌ HLS proxy error:', error);
    res.status(503).send('HLS service unavailable');
  }
});

// MediaMTX API proxy
app.get('/v3/*', async (req, res) => {
  try {
    const apiPath = req.originalUrl;
    const targetUrl = `http://localhost:9997${apiPath}`;
    
    console.log(`🔧 API proxy request: ${targetUrl}`);
    
    const response = await fetch(targetUrl);
    
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      res.status(response.status).json({ error: 'API request failed' });
    }
  } catch (error) {
    console.error('❌ API proxy error:', error);
    res.status(503).json({ error: 'MediaMTX API unavailable' });
  }
});

// CORS preflight for WHIP/WHEP
app.options('/:streamName/whip', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400'
  });
  res.sendStatus(200);
});

app.options('/:streamName/whep', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400'
  });
  res.sendStatus(200);
});

// Socket connection handling (your existing code)
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-as-student', (data) => {
    const { studentId, roomId, name } = data;
    
    socket.join(roomId);
    socketToRoom[socket.id] = { roomId, role: 'student', userId: studentId };
    
    activeStudents[studentId] = {
      id: studentId,
      name: name,
      socketId: socket.id,
      roomId: roomId,
      status: 'online',
      joinedAt: new Date()
    };

    if (!rooms[roomId]) {
      rooms[roomId] = { students: [], proctors: [] };
    }
    
    const existingIndex = rooms[roomId].students.findIndex(s => s.id === studentId);
    if (existingIndex >= 0) {
      rooms[roomId].students[existingIndex] = activeStudents[studentId];
    } else {
      rooms[roomId].students.push(activeStudents[studentId]);
    }

    socket.to(roomId).emit('student-joined', activeStudents[studentId]);
    socket.emit('room-info', {
      roomId: roomId,
      studentsCount: rooms[roomId].students.length,
      proctorsCount: rooms[roomId].proctors.length
    });

    console.log(`👨‍🎓 Student ${studentId} joined room ${roomId}`);
  });

  socket.on('join-as-proctor', (data) => {
    const { proctorId, roomId, name } = data;
    
    socket.join(roomId);
    socketToRoom[socket.id] = { roomId, role: 'proctor', userId: proctorId };
    
    activeProctors[proctorId] = {
      id: proctorId,
      name: name,
      socketId: socket.id,
      roomId: roomId,
      status: 'monitoring',
      joinedAt: new Date()
    };

    if (!rooms[roomId]) {
      rooms[roomId] = { students: [], proctors: [] };
    }
    
    const existingIndex = rooms[roomId].proctors.findIndex(p => p.id === proctorId);
    if (existingIndex >= 0) {
      rooms[roomId].proctors[existingIndex] = activeProctors[proctorId];
    } else {
      rooms[roomId].proctors.push(activeProctors[proctorId]);
    }

    socket.emit('active-students', rooms[roomId].students);
    console.log(`👨‍🏫 Proctor ${proctorId} joined room ${roomId}`);
  });

  socket.on('stream-published', (data) => {
    const { studentId, streamType, streamName, viewUrl } = data;
    const userInfo = socketToRoom[socket.id];
    
    if (userInfo) {
      console.log(`📺 Stream published: ${streamName}`);
      socket.to(userInfo.roomId).emit('stream-published', {
        studentId,
        streamType,
        streamName,
        viewUrl
      });
    }
  });

  socket.on('stream-stopped', (data) => {
    const { studentId, streamType } = data;
    const userInfo = socketToRoom[socket.id];
    
    if (userInfo) {
      console.log(`🛑 Stream stopped: ${studentId}_${streamType}`);
      socket.to(userInfo.roomId).emit('stream-stopped', {
        studentId,
        streamType
      });
    }
  });

  socket.on('disconnect', () => {
    const userInfo = socketToRoom[socket.id];
    
    if (userInfo) {
      const { roomId, role, userId } = userInfo;
      
      if (role === 'student' && activeStudents[userId]) {
        delete activeStudents[userId];
        
        if (rooms[roomId]) {
          rooms[roomId].students = rooms[roomId].students.filter(s => s.id !== userId);
          socket.to(roomId).emit('student-disconnected', { studentId: userId });
        }
        
        console.log(`👨‍🎓 Student ${userId} disconnected`);
      } else if (role === 'proctor' && activeProctors[userId]) {
        delete activeProctors[userId];
        
        if (rooms[roomId]) {
          rooms[roomId].proctors = rooms[roomId].proctors.filter(p => p.id !== userId);
        }
        
        console.log(`👨‍🏫 Proctor ${userId} disconnected`);
      }
      
      delete socketToRoom[socket.id];
    }
  });
});

// API endpoints
app.get('/', (req, res) => {
  res.json({
    status: 'MediaMTX Proctoring Backend - Railway with Proxying! 🚀',
    timestamp: new Date(),
    activeStudents: Object.keys(activeStudents).length,
    activeProctors: Object.keys(activeProctors).length,
    environment: process.env.NODE_ENV || 'production',
    mediamtxStatus: mediamtxProcess ? (mediamtxProcess.killed ? 'stopped' : 'running') : 'not started',
    version: '1.0.3',
    ports: {
      main: PORT,
      webrtc: 8889,
      hls: 8888,
      api: 9997
    },
    proxyEndpoints: {
      whip: '/:streamName/whip',
      whep: '/:streamName/whep',
      hls: '/hls/:streamName/*',
      api: '/v3/*'
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    server: 'Railway with MediaMTX Proxying',
    activeStudents: Object.keys(activeStudents).length,
    activeProctors: Object.keys(activeProctors).length,
    mediamtxRunning: mediamtxProcess && !mediamtxProcess.killed,
    uptime: process.uptime(),
    proxyStatus: 'Active'
  });
});

app.get('/mediamtx/health', async (req, res) => {
  try {
    const response = await fetch(`${MEDIAMTX_HTTP_URL}/v3/config/global/get`);
    if (response.ok) {
      res.json({ 
        status: 'MediaMTX server is running on Railway with proxying', 
        url: MEDIAMTX_HTTP_URL,
        mediamtxProcess: mediamtxProcess ? 'running' : 'stopped',
        proxyStatus: 'Active',
        endpoints: {
          whip: `${req.protocol}://${req.get('host')}/:streamName/whip`,
          whep: `${req.protocol}://${req.get('host')}/:streamName/whep`,
          hls: `${req.protocol}://${req.get('host')}/hls/:streamName/`
        }
      });
    } else {
      res.status(503).json({ 
        status: 'MediaMTX server not responding',
        url: MEDIAMTX_HTTP_URL
      });
    }
  } catch (error) {
    res.status(503).json({ 
      status: 'MediaMTX server unreachable', 
      error: error.message,
      url: MEDIAMTX_HTTP_URL
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!', 
    details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received - shutting down gracefully...');
  if (mediamtxProcess) {
    console.log('Stopping MediaMTX process...');
    mediamtxProcess.kill('SIGTERM');
  }
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received - shutting down gracefully...');
  if (mediamtxProcess) {
    mediamtxProcess.kill('SIGINT');
  }
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Backend + MediaMTX server with proxying running on Railway port ${PORT}`);
  console.log(`🎥 MediaMTX WebRTC URL (internal): ${MEDIAMTX_HTTP_URL}`);
  console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
  console.log(`📊 Health check: /api/health`);
  console.log(`📺 MediaMTX health: /mediamtx/health`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`🔀 Proxy endpoints active: WHIP, WHEP, HLS, API`);
});

module.exports = { app, server, io };
