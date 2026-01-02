/**
 * Authentication Routes
 * Handles login, logout, and user info
 */

const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { authenticateToken, generateToken } = require('../middleware/auth');

// Will be set by setDatabase
let userOperations = null;

function setDatabase(db) {
    userOperations = {
        getByUsername: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
        getById: db.prepare('SELECT id, username, is_admin, created_at FROM users WHERE id = ?')
    };
}

/**
 * POST /api/auth/login
 * Login with username and password
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password required'
            });
        }

        // Find user
        const user = userOperations.getByUsername.get(username);
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        // Generate token
        const token = generateToken(user);

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                is_admin: user.is_admin ? true : false
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed'
        });
    }
});

/**
 * POST /api/auth/logout
 * Logout (client-side token removal, this is just for completeness)
 */
router.post('/logout', authenticateToken, (req, res) => {
    // JWT is stateless, so we just acknowledge the logout
    // Client should remove the token from localStorage
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

/**
 * GET /api/auth/me
 * Get current user info from token
 */
router.get('/me', authenticateToken, (req, res) => {
    try {
        const user = userOperations.getById.get(req.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                is_admin: user.is_admin ? true : false,
                created_at: user.created_at
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user info'
        });
    }
});

module.exports = router;
module.exports.setDatabase = setDatabase;
