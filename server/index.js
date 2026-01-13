const express = require('express');
const path = require('path');
const { initializeDatabase, db } = require('./db/database');
const { startBackupScheduler } = require('./services/backup');

// Initialize database
initializeDatabase();

// Clean up orphaned sessions on startup
const { sessionOperations } = require('./db/database');
try {
    const info = sessionOperations.abandonOrphaned.run();
    if (info.changes > 0) {
        console.log(`Abandoned ${info.changes} orphaned sessions.`);
    }
} catch (error) {
    console.error('Error abandoning orphaned sessions:', error);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// API routes
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');

// Initialize auth routes with database
authRoutes.setDatabase(db);

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/admin/api', adminRoutes);

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Serve learner page (default)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start server
app.listen(PORT, () => {
    console.log(`Vocabulary Trainer running on http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
    startBackupScheduler(db);
});
