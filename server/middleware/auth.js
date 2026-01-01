/**
 * Authentication Middleware
 * Handles JWT verification and admin authorization
 */

const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, '../../config/admin.json');

// Load JWT secret from config or use default
function getJwtSecret() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
            return config.jwtSecret || 'dev-secret-change-in-production';
        }
    } catch (e) {
        console.warn('No config file found, using default JWT secret');
    }
    return 'dev-secret-change-in-production';
}

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRY = '7d'; // Token valid for 7 days

/**
 * Middleware to verify JWT token
 * Sets req.user with decoded token payload
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({
                success: false,
                error: 'Invalid or expired token'
            });
        }
        req.user = user;
        next();
    });
}

/**
 * Middleware to require admin role
 * Must be used after authenticateToken
 */
function requireAdmin(req, res, next) {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).json({
            success: false,
            error: 'Admin access required'
        });
    }
    next();
}

/**
 * Generate JWT token for user
 */
function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            is_admin: user.is_admin
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
    );
}

module.exports = {
    authenticateToken,
    requireAdmin,
    generateToken,
    JWT_SECRET
};
