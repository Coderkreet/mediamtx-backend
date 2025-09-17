// server.js - Railway compatible (existing code को replace करें)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Railway environment variables
const PORT = process.env.PORT || 3000; // Railway automatically sets PORT
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mediamtx-frontend.vercel.app';

// Middleware
app.use(helmet());
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Socket.IO setup
const io = socketIo(server, {
  cors: {
    origin: [FRONTEND_URL, 'http://localhost:3000'],
    methods: ["GET", "POST"]
  }
});

// MediaMTX को Railway में start करें
let mediamtxProcess = null;

const startMediaMTX = () => {
  try {
    console.log('🎥 Starting MediaMTX on Railway...');
    
    // Windows .exe को Linux environment के लिए adjust करना होगा
    // Railway Linux environment है, .exe नहीं चलेगा
    const mediamtxBinary = process.platform === 'win32' ? './mediamtx.exe' : './mediamtx';
    
    mediamtxProcess = spawn(mediamtxBinary, ['mediamtx.yml'], {
      cwd: __dirname,
      stdio: 'pipe'
    });

    mediamtxProcess.stdout.on('data', (data) => {
      console.log(`MediaMTX: ${data}`);
    });

    mediamtxProcess.stderr.on('data', (data) => {
      console.error(`MediaMTX Error: ${data}`);
    });

    console.log('✅ MediaMTX process started');
  } catch (error) {
    console.error('❌ MediaMTX start failed:', error);
  }
};

// Start MediaMTX
startMediaMTX();

// Your existing socket code (storage)
let rooms = {};
let socketToRoom = {};
let activeStudents = {};
let activeProctors = {};

// Socket connection handling (your existing code)
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Student join
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

    console.log(`Student ${studentId} joined room ${roomId}`);
  });

  // Proctor join
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
    console.log(`Proctor ${proctorId} joined room ${roomId}`);
  });

  // Stream events (your existing code)
  socket.on('stream-published', (data) => {
    const { studentId, streamType, streamName, viewUrl } = data;
    const userInfo = socketToRoom[socket.id];
    
    if (userInfo) {
      console.log(`Stream published: ${streamName}`);
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
      console.log(`Stream stopped: ${studentId}_${streamType}`);
      socket.to(userInfo.roomId).emit('stream-stopped', {
        studentId,
        streamType
      });
    }
  });

  // Disconnect
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
      } else if (role === 'proctor' && activeProctors[userId]) {
        delete activeProctors[userId];
        
        if (rooms[roomId]) {
          rooms[roomId].proctors = rooms[roomId].proctors.filter(p => p.id !== userId);
        }
      }
      
      delete socketToRoom[socket.id];
    }
  });
});

// API endpoints
app.get('/', (req, res) => {
  res.json({
    status: 'MediaMTX Proctoring Backend - Railway Deployed! 🚀',
    timestamp: new Date(),
    activeStudents: Object.keys(activeStudents).length,
    activeProctors: Object.keys(activeProctors).length,
    environment: process.env.NODE_ENV || 'production',
    mediamtxStatus: mediamtxProcess ? 'running' : 'stopped'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    server: 'Railway',
    activeStudents: Object.keys(activeStudents).length,
    activeProctors: Object.keys(activeProctors).length,
    mediamtxRunning: mediamtxProcess && !mediamtxProcess.killed
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!', details: err.message });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down server...');
  if (mediamtxProcess) {
    mediamtxProcess.kill();
  }
  server.close();
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Backend server running on Railway port ${PORT}`);
  console.log(`🌐 Frontend URL: ${FRONTEND_URL}`);
  console.log(`📊 Health check: /api/health`);
});
