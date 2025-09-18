// server.js - Complete Railway Ready Version with Alternative Stream Creation
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

// ✅ NEW: Helper function to create stream path in MediaMTX
const createStreamPathIfNeeded = async (streamName, streamType = 'camera') => {
  try {
    console.log(`🔧 Creating/verifying stream path: ${streamName}`);
    
    // First check if path already exists
    const existingPathResponse = await fetch(`http://localhost:9997/v3/paths/get/${streamName}`);
    if (existingPathResponse.ok) {
      const pathData = await existingPathResponse.json();
      console.log(`✅ Stream path already exists: ${streamName}`, pathData);
      return true;
    }

    // Create new path
    const createResponse = await fetch(`http://localhost:9997/v3/paths/add/${streamName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: 'publisher',
        sourceOnDemand: false,
        overridePublisher: true,
        record: false,
        runOnReady: `echo "Stream ${streamName} ready for HLS"`,
        runOnReadyRestart: true
      })
    });

    if (createResponse.ok) {
      const result = await createResponse.json();
      console.log(`✅ Stream path created successfully: ${streamName}`, result);
      
      // Initialize HLS endpoint after path creation
      setTimeout(async () => {
        try {
          console.log(`🔄 Initializing HLS endpoint for: ${streamName}`);
          await fetch(`http://localhost:8888/${streamName}/index.m3u8`);
        } catch (initError) {
          console.log(`⚠️ HLS initialization pending for ${streamName}:`, initError.message);
        }
      }, 2000);
      
      return true;
    } else {
      const errorText = await createResponse.text();
      console.log(`⚠️ Path creation failed: ${createResponse.status} - ${errorText}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Stream path creation error for ${streamName}:`, error);
    return false;
  }
};

// ✅ NEW: Force create stream path API endpoint
app.post('/api/stream/:streamName/create', async (req, res) => {
  try {
    const { streamName } = req.params;
    const { streamType = 'camera' } = req.body;
    
    console.log(`🎯 Force creating stream: ${streamName} (type: ${streamType})`);
    
    const created = await createStreamPathIfNeeded(streamName, streamType);
    
    if (created) {
      res.json({
        success: true,
        streamName,
        streamType,
        message: 'Stream path created/verified successfully',
        viewUrl: `/hls/${streamName}/`,
        hlsUrl: `/hls/${streamName}/index.m3u8`,
        statusUrl: `/api/stream/${streamName}/status`,
        timestamp: new Date()
      });
    } else {
      res.status(500).json({
        success: false,
        streamName,
        error: 'Failed to create stream path',
        message: 'MediaMTX path creation failed'
      });
    }
  } catch (error) {
    console.error('Stream creation API error:', error);
    res.status(500).json({
      success: false,
      error: 'Stream creation failed',
      details: error.message
    });
  }
});

// ✅ ENHANCED WHIP with quick timeout and fallback stream creation
app.post('/:streamName/whip', async (req, res) => {
  const startTime = Date.now();
  try {
    const { streamName } = req.params;
    const sdpOffer = req.body;
    
    console.log(`📤 WHIP proxy request for stream: ${streamName}`);
    console.log('SDP Offer length:', sdpOffer ? sdpOffer.length : 'undefined');
    
    if (!sdpOffer || sdpOffer.trim().length === 0) {
      return res.status(400).json({ error: 'No SDP offer provided or empty SDP' });
    }

    // ✅ CRITICAL: Much shorter timeout for Railway WebRTC (10 seconds only)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // Only 10 seconds

    try {
      console.log(`🔄 Quick WebRTC attempt for ${streamName} (10s timeout)`);
      
      const response = await fetch(`http://localhost:8889/${streamName}/whip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          'Accept': 'application/sdp',
          'User-Agent': 'Railway-MediaMTX-Proxy'
        },
        body: sdpOffer,
        signal: controller.signal
      });

      clearTimeout(timeout);
      const responseTime = Date.now() - startTime;

      console.log(`📥 MediaMTX WHIP response: ${response.status} (${responseTime}ms)`);

      if (response.ok) {
        const answerSdp = await response.text();
        console.log(`✅ WHIP success for ${streamName}, answer length:`, answerSdp.length);
        
        // ✅ Verify and ensure stream path exists
        setTimeout(async () => {
          await createStreamPathIfNeeded(streamName);
        }, 2000);
        
        res.set({
          'Content-Type': 'application/sdp',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.send(answerSdp);
        
      } else {
        const errorText = await response.text();
        console.error(`❌ WHIP failed: ${response.status} - ${errorText}`);
        throw new Error(`WebRTC failed: ${response.status} - ${errorText}`);
      }

    } catch (fetchError) {
      clearTimeout(timeout);
      const responseTime = Date.now() - startTime;
      
      console.log(`⚠️ WebRTC failed for ${streamName} after ${responseTime}ms: ${fetchError.message}`);
      console.log(`🔄 Creating fallback stream path for HLS viewing...`);
      
      // ✅ CRITICAL: Always create stream path for HLS even if WebRTC failed
      try {
        const streamCreated = await createStreamPathIfNeeded(streamName);
        
        if (streamCreated) {
          console.log(`✅ Fallback stream path created for ${streamName}`);
          
          res.status(202).json({ 
            message: 'WebRTC failed but stream path created for HLS viewing',
            webrtcFailed: true,
            webrtcError: fetchError.message,
            hlsUrl: `/hls/${streamName}/index.m3u8`,
            viewUrl: `/hls/${streamName}/`,
            statusUrl: `/api/stream/${streamName}/status`,
            fallbackCreated: true,
            responseTime: responseTime
          });
        } else {
          throw new Error('Both WebRTC and fallback stream creation failed');
        }
        
      } catch (fallbackError) {
        console.error(`❌ Fallback stream creation also failed for ${streamName}:`, fallbackError);
        res.status(503).json({
          error: 'Both WebRTC and fallback stream creation failed',
          webrtcError: fetchError.message,
          fallbackError: fallbackError.message,
          streamName: streamName
        });
      }
    }

  } catch (error) {
    console.error('❌ WHIP proxy error:', error);
    res.status(503).json({ 
      error: 'MediaMTX WHIP service unavailable', 
      details: error.message,
      streamName: req.params.streamName
    });
  }
});

// ✅ WHEP endpoint proxy (unchanged but with timeout)
app.post('/:streamName/whep', async (req, res) => {
  try {
    const { streamName } = req.params;
    const sdpOffer = req.body;
    
    console.log(`📥 WHEP proxy request for stream: ${streamName}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`http://localhost:8889/${streamName}/whep`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        'Accept': 'application/sdp',
        'User-Agent': 'Railway-MediaMTX-Proxy'
      },
      body: sdpOffer,
      signal: controller.signal
    });

    clearTimeout(timeout);

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

// ✅ ENHANCED HLS PROXY with better error handling

// HLS Master Playlist (index.m3u8)
app.get('/hls/:streamName/index.m3u8', async (req, res) => {
  try {
    const { streamName } = req.params;
    const targetUrl = `http://localhost:8888/${streamName}/index.m3u8`;
    
    console.log(`📺 HLS Master playlist request: ${targetUrl}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.apple.mpegurl,*/*',
        'User-Agent': 'Railway-HLS-Proxy'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (response.ok) {
      const playlist = await response.text();
      console.log(`✅ HLS Master playlist success for ${streamName}`);
      console.log('Playlist content length:', playlist.length);
      
      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.send(playlist);
    } else {
      console.error(`❌ HLS Master playlist failed: ${response.status}`);
      
      // ✅ Try to create stream path if playlist not found
      if (response.status === 404) {
        console.log(`🔄 Attempting to create missing stream path: ${streamName}`);
        try {
          await createStreamPathIfNeeded(streamName);
          res.status(404).json({
            error: `HLS stream ${streamName} not available yet`,
            message: 'Stream path created, please try again in a few seconds',
            retryAfter: 5,
            statusUrl: `/api/stream/${streamName}/status`
          });
        } catch (createError) {
          res.status(404).send(`HLS stream ${streamName} not available`);
        }
      } else {
        res.status(response.status).send(`HLS stream ${streamName} error: ${response.status}`);
      }
    }
  } catch (error) {
    console.error('❌ HLS Master playlist error:', error);
    if (error.name === 'AbortError') {
      res.status(408).send('HLS playlist request timeout');
    } else {
      res.status(503).send('HLS service unavailable');
    }
  }
});

// HLS Sub-playlists (segment playlists)
app.get('/hls/:streamName/*.m3u8', async (req, res) => {
  try {
    const { streamName } = req.params;
    const playlistFile = req.path.split('/').pop();
    const targetUrl = `http://localhost:8888/${streamName}/${playlistFile}`;
    
    console.log(`📺 HLS Sub-playlist request: ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.apple.mpegurl,*/*',
        'User-Agent': 'Railway-HLS-Proxy'
      },
      timeout: 6000
    });

    if (response.ok) {
      const playlist = await response.text();
      console.log(`✅ HLS Sub-playlist success: ${playlistFile}`);
      
      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=1'
      });
      res.send(playlist);
    } else {
      console.error(`❌ HLS Sub-playlist failed: ${response.status}`);
      res.status(response.status).send(`Playlist ${playlistFile} not found`);
    }
  } catch (error) {
    console.error('❌ HLS Sub-playlist error:', error);
    res.status(503).send('Sub-playlist unavailable');
  }
});

// HLS Video Segments (.ts files)
app.get('/hls/:streamName/*.ts', async (req, res) => {
  try {
    const { streamName } = req.params;
    const segmentFile = req.path.split('/').pop();
    const targetUrl = `http://localhost:8888/${streamName}/${segmentFile}`;
    
    console.log(`📺 HLS Segment request: ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      method: 'GET',
      timeout: 12000
    });

    if (response.ok) {
      const segment = await response.buffer();
      console.log(`✅ HLS Segment success: ${segmentFile} (${segment.length} bytes)`);
      
      res.set({
        'Content-Type': 'video/MP2T',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=3600',
        'Content-Length': segment.length
      });
      res.send(segment);
    } else {
      console.error(`❌ HLS Segment failed: ${response.status}`);
      res.status(response.status).send(`Segment ${segmentFile} not found`);
    }
  } catch (error) {
    console.error('❌ HLS Segment error:', error);
    res.status(503).send('Segment unavailable');
  }
});

// ✅ Generic HLS catch-all for other files
app.get('/hls/:streamName/*', async (req, res) => {
  try {
    const { streamName } = req.params;
    const filePath = req.path.replace(`/hls/${streamName}/`, '');
    const targetUrl = `http://localhost:8888/${streamName}/${filePath}`;
    
    console.log(`📺 HLS Generic request: ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Accept': req.headers.accept || '*/*',
        'User-Agent': 'Railway-HLS-Proxy'
      }
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const data = await response.buffer();
      
      console.log(`✅ HLS Generic success: ${filePath} (${data.length} bytes)`);
      
      res.set({
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': filePath.endsWith('.m3u8') ? 'no-cache' : 'max-age=3600'
      });
      res.send(data);
    } else {
      console.error(`❌ HLS Generic failed: ${response.status}`);
      res.status(response.status).send(`File ${filePath} not available`);
    }
  } catch (error) {
    console.error('❌ HLS Generic error:', error);
    res.status(503).send('HLS file unavailable');
  }
});

// ✅ ENHANCED Stream Status API
app.get('/api/stream/:streamName/status', async (req, res) => {
  try {
    const { streamName } = req.params;
    
    console.log(`🔍 Stream status check: ${streamName}`);
    
    // Check MediaMTX paths
    const pathsResponse = await fetch('http://localhost:9997/v3/paths/list', { timeout: 5000 });
    if (!pathsResponse.ok) {
      return res.status(503).json({ 
        error: 'MediaMTX API unavailable',
        streamName: streamName
      });
    }
    
    const pathsData = await pathsResponse.json();
    const streamPath = pathsData.items && pathsData.items.find(item => item.name === streamName);
    
    if (streamPath) {
      // Check HLS availability
      try {
        const hlsResponse = await fetch(`http://localhost:8888/${streamName}/index.m3u8`, { 
          method: 'HEAD',
          timeout: 3000 
        });
        const hlsAvailable = hlsResponse.ok;
        
        console.log(`✅ Stream found: ${streamName} - Ready: ${streamPath.ready}, HLS: ${hlsAvailable}`);
        
        res.json({
          exists: true,
          streamName,
          ready: streamPath.ready || false,
          hlsAvailable,
          hlsUrl: `/hls/${streamName}/index.m3u8`,
          viewUrl: `/hls/${streamName}/`,
          pathInfo: {
            name: streamPath.name,
            source: streamPath.source,
            sourceReady: streamPath.sourceReady || false,
            tracks: streamPath.tracks || 0,
            bytesReceived: streamPath.bytesReceived || 0,
            conf: streamPath.conf || {}
          },
          timestamp: new Date()
        });
      } catch (hlsError) {
        console.log(`⚠️ HLS check failed for ${streamName}:`, hlsError.message);
        res.json({
          exists: true,
          streamName,
          ready: streamPath.ready || false,
          hlsAvailable: false,
          hlsError: hlsError.message,
          message: 'Stream exists but HLS not ready',
          timestamp: new Date()
        });
      }
    } else {
      console.log(`❌ Stream not found: ${streamName}`);
      res.json({
        exists: false,
        streamName,
        ready: false,
        hlsAvailable: false,
        message: 'Stream not found in MediaMTX paths',
        createUrl: `/api/stream/${streamName}/create`,
        timestamp: new Date()
      });
    }
  } catch (error) {
    console.error('Stream status check error:', error);
    res.status(500).json({ 
      error: 'Stream status check failed',
      details: error.message,
      streamName: req.params.streamName
    });
  }
});

// MediaMTX API proxy
app.get('/v3/*', async (req, res) => {
  try {
    const apiPath = req.originalUrl;
    const targetUrl = `http://localhost:9997${apiPath}`;
    
    console.log(`🔧 API proxy request: ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      timeout: 5000
    });
    
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

// CORS preflight handling
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

// Socket connection handling
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
    const { studentId, streamType, streamName, viewUrl, hlsUrl, statusUrl } = data;
    const userInfo = socketToRoom[socket.id];
    
    if (userInfo) {
      console.log(`📺 Stream published notification: ${streamName}`);
      socket.to(userInfo.roomId).emit('stream-published', {
        studentId,
        streamType,
        streamName,
        viewUrl: viewUrl || `/hls/${streamName}/`,
        hlsUrl: hlsUrl || `/hls/${streamName}/index.m3u8`,
        statusUrl: statusUrl || `/api/stream/${streamName}/status`,
        timestamp: new Date()
      });
    }
  });

  socket.on('stream-stopped', (data) => {
    const { studentId, streamType } = data;
    const userInfo = socketToRoom[socket.id];
    
    if (userInfo) {
      console.log(`🛑 Stream stopped notification: ${studentId}_${streamType}`);
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
    status: 'MediaMTX Proctoring Backend - Railway with Alternative Stream Creation! 🚀',
    timestamp: new Date(),
    activeStudents: Object.keys(activeStudents).length,
    activeProctors: Object.keys(activeProctors).length,
    environment: process.env.NODE_ENV || 'production',
    mediamtxStatus: mediamtxProcess ? (mediamtxProcess.killed ? 'stopped' : 'running') : 'not started',
    version: '1.2.0',
    ports: {
      main: PORT,
      webrtc: 8889,
      hls: 8888,
      api: 9997
    },
    proxyEndpoints: {
      whip: '/:streamName/whip (10s timeout)',
      whep: '/:streamName/whep',
      hls: '/hls/:streamName/*',
      hlsMaster: '/hls/:streamName/index.m3u8',
      streamStatus: '/api/stream/:streamName/status',
      streamCreate: '/api/stream/:streamName/create',
      api: '/v3/*'
    },
    features: [
      'Enhanced HLS streaming',
      'WebRTC with quick timeout (10s)',
      'Alternative stream creation',
      'Stream path auto-creation',
      'Enhanced error handling',
      'Railway optimized'
    ]
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    server: 'Railway with Alternative Stream Creation',
    activeStudents: Object.keys(activeStudents).length,
    activeProctors: Object.keys(activeProctors).length,
    mediamtxRunning: mediamtxProcess && !mediamtxProcess.killed,
    uptime: process.uptime(),
    proxyStatus: 'Enhanced Active with Fallbacks',
    hlsProxy: 'Enhanced with auto stream creation',
    version: '1.2.0'
  });
});

app.get('/mediamtx/health', async (req, res) => {
  try {
    const response = await fetch(`${MEDIAMTX_HTTP_URL}/v3/config/global/get`, {
      timeout: 5000
    });
    
    if (response.ok) {
      res.json({ 
        status: 'MediaMTX server running with alternative stream creation', 
        url: MEDIAMTX_HTTP_URL,
        mediamtxProcess: mediamtxProcess ? (mediamtxProcess.killed ? 'stopped' : 'running') : 'not started',
        proxyStatus: 'Enhanced Active with Fallbacks',
        endpoints: {
          whip: `${req.protocol}://${req.get('host')}/:streamName/whip (10s timeout)`,
          whep: `${req.protocol}://${req.get('host')}/:streamName/whep`,
          hls: `${req.protocol}://${req.get('host')}/hls/:streamName/index.m3u8`,
          streamStatus: `${req.protocol}://${req.get('host')}/api/stream/:streamName/status`,
          streamCreate: `${req.protocol}://${req.get('host')}/api/stream/:streamName/create`
        },
        version: '1.2.0'
      });
    } else {
      res.status(503).json({ 
        status: 'MediaMTX server not responding',
        url: MEDIAMTX_HTTP_URL,
        error: `HTTP ${response.status}`
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
    details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    timestamp: new Date()
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
  console.log(`🚀 Backend + MediaMTX with alternative stream creation running on Railway port ${PORT}`);
  console.log(`🎥 MediaMTX WebRTC URL (internal): ${MEDIAMTX_HTTP_URL}`);
  console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
  console.log(`📊 Health check: /api/health`);
  console.log(`📺 MediaMTX health: /mediamtx/health`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`🔀 Enhanced proxy endpoints: WHIP (10s timeout), WHEP, HLS, API`);
  console.log(`📺 HLS Master playlist: /hls/:streamName/index.m3u8`);
  console.log(`📊 Stream status API: /api/stream/:streamName/status`);
  console.log(`🎯 Stream creation API: /api/stream/:streamName/create`);
  console.log(`⚡ Features: Quick WebRTC timeout, Alternative stream creation, Auto-fallback to HLS`);
});

module.exports = { app, server, io };
