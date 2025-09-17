// routes/students.js
const express = require('express');
const router = express.Router();

// In-memory storage (production me database use karenge)
let studentsData = {};

// Get all active students
router.get('/active', (req, res) => {
  try {
    const students = Object.values(req.app.locals.activeStudents || {});
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Get specific student details
router.get('/:studentId', (req, res) => {
  try {
    const { studentId } = req.params;
    const student = req.app.locals.activeStudents?.[studentId];
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch student details' });
  }
});

// Register student
router.post('/register', (req, res) => {
  try {
    const { studentId, name, email, roomId } = req.body;
    
    studentsData[studentId] = {
      id: studentId,
      name: name,
      email: email,
      roomId: roomId,
      registeredAt: new Date(),
      status: 'registered'
    };
    
    res.json({
      message: 'Student registered successfully',
      student: studentsData[studentId]
    });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Update student status
router.put('/:studentId/status', (req, res) => {
  try {
    const { studentId } = req.params;
    const { status, cameraActive, screenSharing } = req.body;
    
    if (req.app.locals.activeStudents?.[studentId]) {
      req.app.locals.activeStudents[studentId] = {
        ...req.app.locals.activeStudents[studentId],
        status,
        cameraActive,
        screenSharing
      };
      
      res.json({
        message: 'Student status updated',
        student: req.app.locals.activeStudents[studentId]
      });
    } else {
      res.status(404).json({ error: 'Student not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

module.exports = router;
