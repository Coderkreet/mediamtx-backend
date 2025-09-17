// routes/proctors.js
const express = require('express');
const router = express.Router();

// In-memory storage
let proctorsData = {};

// Get all active proctors
router.get('/active', (req, res) => {
  try {
    const proctors = Object.values(req.app.locals.activeProctors || {});
    res.json(proctors);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch proctors' });
  }
});

// Register proctor
router.post('/register', (req, res) => {
  try {
    const { proctorId, name, email, permissions } = req.body;
    
    proctorsData[proctorId] = {
      id: proctorId,
      name: name,
      email: email,
      permissions: permissions || ['monitor', 'flag', 'warning'],
      registeredAt: new Date(),
      status: 'registered'
    };
    
    res.json({
      message: 'Proctor registered successfully',
      proctor: proctorsData[proctorId]
    });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get proctor dashboard data
router.get('/:proctorId/dashboard', (req, res) => {
  try {
    const { proctorId } = req.params;
    const { roomId } = req.query;
    
    const rooms = req.app.locals.rooms || {};
    const roomData = rooms[roomId];
    
    if (!roomData) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    res.json({
      roomId: roomId,
      students: roomData.students || [],
      proctors: roomData.proctors || [],
      totalStudents: roomData.students?.length || 0,
      activeStreams: roomData.students?.filter(s => s.cameraActive || s.screenSharing).length || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

module.exports = router;
