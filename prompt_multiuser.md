# Multi-User System Implementation Prompt

## Overview

Transform the single-user vocab-trainer application into a multi-user system where multiple students can simultaneously study vocabulary with individual progress tracking.

---

## Requirements Summary

### Authentication & Users
- **Authentication method**: JWT tokens (stored in localStorage)
- **User registration**: Admin creates accounts only (no self-registration)
- **User fields**: username + password (minimal)
- **Admin account**: username `admin`, password from config file (default: `admin` for dev)
- **Password storage**: bcrypt hashed
- **Password reset**: Admin can reset any student's password

### Data Model
- **Vocabulary**: Shared across all users (words table unchanged)
- **Progress**: Per-user (each user has their own learning progress)
- **Settings**: Global (admin settings apply to all users)

### Features
- **Leaderboard**: Simple ranking by stars/streaks visible to students
- **Admin visibility**: Full access to individual student progress and stats
- **User management**: Admin tab to create/edit/delete users and reset passwords

### Migration
- Create user `nursi` and migrate all existing progress data to this user
- Preserve all existing learning progress, achievements, streaks, and stats

---

## Database Schema Changes

### New Table: `users`

```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Modified Table: `progress`

Add `user_id` column and update unique constraint:

```sql
-- Add column
ALTER TABLE progress ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Update unique constraint (requires table recreation in SQLite)
-- New constraint: UNIQUE(user_id, word_id, direction)
```

### Modified Table: `sessions`

```sql
ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
```

### Modified Table: `achievements`

```sql
ALTER TABLE achievements ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Remove UNIQUE on type, add UNIQUE on (user_id, type)
```

### Modified Table: `daily_activity`

Change from single primary key to composite:

```sql
-- Requires table recreation
-- Old: PRIMARY KEY (date)
-- New: PRIMARY KEY (user_id, date)

CREATE TABLE daily_activity_new (
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    sessions_completed INTEGER DEFAULT 0,
    words_introduced INTEGER DEFAULT 0,
    stars_earned INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### Modified Table: `learner_stats`

Complete redesign - remove `id = 1` constraint:

```sql
-- Requires table recreation
CREATE TABLE learner_stats_new (
    user_id INTEGER PRIMARY KEY,
    total_stars INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_active_date TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### Unchanged Tables
- `words` - Shared vocabulary, no changes needed
- `settings` - Global settings, no changes needed

---

## Migration Script Requirements

Create a migration script (`server/db/migrate-to-multiuser.js`) that:

1. **Backs up the database** before any changes
2. **Creates the `users` table**
3. **Creates user `nursi`** with a default password (e.g., `nursi123`)
4. **Creates admin user** with password from config
5. **Recreates tables** with new schema (SQLite doesn't support all ALTER operations):
   - `progress` → add user_id, set all existing to nursi's id
   - `sessions` → add user_id, set all existing to nursi's id
   - `achievements` → add user_id, set all existing to nursi's id
   - `daily_activity` → recreate with composite PK, migrate data to nursi
   - `learner_stats` → recreate without id=1 constraint, migrate to nursi
6. **Adds indexes** for performance:
   - `CREATE INDEX idx_progress_user ON progress(user_id);`
   - `CREATE INDEX idx_sessions_user ON sessions(user_id);`
   - `CREATE INDEX idx_achievements_user ON achievements(user_id);`
7. **Validates migration** - checks data integrity after migration

---

## API Changes

### New Endpoints

#### Authentication
- `POST /api/auth/login` - Login with username/password, returns JWT
- `POST /api/auth/logout` - Invalidate token (optional, mainly for frontend state)
- `GET /api/auth/me` - Get current user info from token

#### Leaderboard
- `GET /api/leaderboard` - Get ranking of all users by stars/streaks

#### Admin User Management
- `GET /admin/api/users` - List all users
- `POST /admin/api/users` - Create new user
- `PUT /admin/api/users/:id` - Update user (username, reset password)
- `DELETE /admin/api/users/:id` - Delete user and all their progress
- `GET /admin/api/users/:id/progress` - View specific user's progress

### Modified Endpoints (add auth + user context)

All existing `/api/*` endpoints need:
1. JWT verification middleware
2. Extract `user_id` from token
3. Pass `user_id` to all database operations

All existing `/admin/api/*` endpoints need:
1. JWT verification middleware
2. Check `is_admin` flag
3. Return 403 if not admin

---

## Backend Implementation Details

### Authentication Middleware

```javascript
// server/middleware/auth.js
const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'dev-secret', (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (!req.user || !req.user.is_admin) {
        return res.status(403).json({ success: false, error: 'Admin access required' });
    }
    next();
}
```

### Config File for Admin Password

Create `config/admin.json` (or read from Docker volume):

```json
{
    "adminPassword": "admin"
}
```

For Docker, mount as volume: `-v /path/to/config:/app/config`

For development, default to `admin` if file not found.

### JWT Secret

- **Development**: Use hardcoded fallback `'dev-secret'`
- **Production**: Set `JWT_SECRET` environment variable or in config file

---

## Frontend Implementation Details

### New Pages/Components

#### Login Page (`public/login.html` or section in `index.html`)

- Username input
- Password input
- Login button
- Error message display
- Redirect to dashboard on success
- Show after splash screen if not authenticated

#### User Management Tab (in `admin.html`)

- List of all users with:
  - Username
  - Created date
  - Total stars
  - Current streak
  - Actions: Edit, Reset Password, Delete
- "Add User" form:
  - Username input
  - Password input
  - Create button
- Confirmation dialogs for delete/reset

#### Leaderboard Component (in dashboard)

- Ranking table showing:
  - Rank (#1, #2, etc.)
  - Username
  - Total stars
  - Current streak
- Highlight current user's row
- Update on dashboard load

### Auth Token Management

```javascript
// In app.js - add to all fetch calls
function authFetch(url, options = {}) {
    const token = localStorage.getItem('authToken');
    return fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });
}

// On login success
localStorage.setItem('authToken', response.token);

// On logout or 401/403 response
localStorage.removeItem('authToken');
window.location.href = '/'; // Redirect to login
```

### Login Flow

1. App loads → splash screen (2s)
2. Check `localStorage.getItem('authToken')`
3. If no token → show login screen
4. If token exists → verify with `GET /api/auth/me`
   - If valid → show dashboard
   - If invalid → clear token, show login screen
5. On login success → store token, redirect based on `is_admin`:
   - Admin → `/admin`
   - Student → dashboard

---

## File Changes Summary

### New Files
- `server/middleware/auth.js` - Authentication middleware
- `server/routes/auth.js` - Auth endpoints (login, logout, me)
- `server/db/migrate-to-multiuser.js` - Migration script
- `config/admin.json` - Admin password config (template)
- `public/css/login.css` - Login page styles (or add to style.css)

### Modified Files

#### Backend
- `server/index.js` - Add auth routes, middleware setup
- `server/db/schema.sql` - Updated schema with users table
- `server/db/database.js` - Add user operations, update all queries with user_id
- `server/routes/api.js` - Add auth middleware, pass user_id to services
- `server/routes/admin.js` - Add admin auth, user management endpoints
- `server/services/leitner.js` - Add user_id parameter to all functions
- `server/services/session.js` - Add user_id to session operations
- `package.json` - Add dependencies: `jsonwebtoken`, `bcrypt`

#### Frontend
- `public/index.html` - Add login section/screen
- `public/admin.html` - Add user management tab
- `public/js/app.js` - Add auth handling, login flow, leaderboard
- `public/js/admin.js` - Add user management functions
- `public/css/style.css` - Add login and leaderboard styles
- `public/css/admin.css` - Add user management styles

#### Docker
- `Dockerfile` - Potentially add config volume documentation
- Add `docker-compose.yml` (optional) for easier deployment with volumes

---

## Testing Checklist

### Authentication
- [ ] Login with valid credentials works
- [ ] Login with invalid credentials shows error
- [ ] JWT token is stored in localStorage
- [ ] Protected routes return 401 without token
- [ ] Protected routes return 403 with invalid token
- [ ] Admin routes return 403 for non-admin users
- [ ] Token expiration works correctly

### User Management
- [ ] Admin can create new users
- [ ] Admin can reset user passwords
- [ ] Admin can delete users
- [ ] Deleting user removes all their progress
- [ ] Cannot delete admin account
- [ ] Username uniqueness enforced

### Multi-User Progress
- [ ] Each user has separate progress
- [ ] User A's progress doesn't affect User B
- [ ] Leaderboard shows all users correctly
- [ ] Admin can view individual user progress

### Migration
- [ ] Existing database migrates successfully
- [ ] User `nursi` created with all existing progress
- [ ] Admin account created with config password
- [ ] No data loss during migration
- [ ] Backup created before migration

### Leaderboard
- [ ] Shows all users ranked by stars
- [ ] Current user highlighted
- [ ] Updates after sessions

---

## Security Considerations

1. **Password hashing**: Use bcrypt with salt rounds >= 10
2. **JWT expiration**: Set reasonable expiry (e.g., 7 days)
3. **JWT secret**: Use strong secret in production (min 32 chars)
4. **Input validation**: Sanitize username input
5. **SQL injection**: Use parameterized queries (already done with better-sqlite3)
6. **Rate limiting**: Consider adding for login endpoint (optional)
7. **HTTPS**: Recommend HTTPS in production for token security

---

## Implementation Order

1. **Database & Migration** (Phase 1)
   - Create migration script
   - Test migration on backup database
   - Update schema.sql for new installations

2. **Authentication Backend** (Phase 2)
   - Add auth middleware
   - Create auth routes
   - Add user management endpoints

3. **Update Existing Backend** (Phase 3)
   - Add user_id to all queries
   - Protect all routes with auth
   - Add leaderboard endpoint

4. **Frontend Auth** (Phase 4)
   - Add login page/screen
   - Implement token management
   - Add auth headers to all API calls

5. **Frontend Features** (Phase 5)
   - Add user management UI
   - Add leaderboard component
   - Update admin with user progress view

6. **Testing & Polish** (Phase 6)
   - Full integration testing
   - Error handling improvements
   - UI polish

---

## Notes

- SQLite limitations require table recreation for some schema changes
- Migration script should be idempotent (safe to run multiple times)
- Consider adding a schema version table for future migrations
- JWT tokens don't require server-side storage (stateless)
- Bcrypt is CPU-intensive; consider async hashing for better performance
