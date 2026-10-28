require('dotenv').config();

const db = require('./db.js');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { Filter } = require('bad-words');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');

// Required environment variables
const REQUIRED_ENV = [
    'SESSION_SECRET',
    'NASA_API_KEY',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD'
];

for (const name of REQUIRED_ENV) {
    if (!process.env[name]) {
        console.error(
            `Missing ${name} in .env (or in Render's Environment settings)`
        );
        process.exit(1);
    }
}

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOG_FILE = path.join(__dirname, 'server.log');
const isProduction = process.env.NODE_ENV === 'production';
const filter = new Filter();

let visitorCount = 0;
let MAINTENANCE_MODE = false;

const apodCache = new Map();
const TODAY_MAX_AGE = 60 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

// Trust proxy for hosting services such as Render
app.set('trust proxy', 1);

// Parse request bodies BEFORE routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            imgSrc: [
                "'self'",
                'data:',
                'https://assets.science.nasa.gov'
            ]
        }
    }
}));

// Session middleware MUST run before routes
app.use(session({
    name: 'station.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 15 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction
    }
}));

// Trim the log file if it gets too large
if (
    fs.existsSync(LOG_FILE) &&
    fs.statSync(LOG_FILE).size > 128 * 1024
) {
    const recentLines = fs.readFileSync(LOG_FILE, 'utf8')
        .split('\n')
        .slice(-10);

    fs.writeFileSync(LOG_FILE, recentLines.join('\n'));
}

// Log requests
app.use((req, res, next) => {
    const logLine =
        `[${new Date().toISOString()}] ${req.method} ${req.path}\n`;

    console.log(logLine.trim());

    fs.appendFile(LOG_FILE, logLine, err => {
        if (err) console.error('Log write failed:', err);
    });

    next();
});

// General rate limiter
const limiter = rateLimit({
    windowMs: 10 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many requests. Please wait 10 seconds.'
    }
});
const postLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 3,
    keyGenerator: (req) => req.session.userId,
    message: {
        error: 'Too many posts. Please wait a minute.'
    }
})

app.use(limiter);

// Login and registration rate limiter
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many attempts. Please try again later.'
    }
});

// Maintenance mode
app.use((req, res, next) => {
    if (MAINTENANCE_MODE) {
        return res.status(503).send('Maintenance Mode.');
    }

    next();
});

// Validate username and password
function validateCredentials(username, password) {
    if (
        typeof username !== 'string' ||
        typeof password !== 'string'
    ) {
        return 'Username and password must be text.';
    }

    if (!/^[a-z0-9_]{3,20}$/i.test(username.trim())) {
        return 'Username must be 3 to 20 letters, numbers or underscores.';
    }

    if (password.length < 8 || password.length > 72) {
        return 'Password must be 8 to 72 characters.';
    }

    return null;
}

// Validate guestbook entries
function validateEntry(name, msg) {
    if (
        typeof name !== 'string' ||
        typeof msg !== 'string'
    ) {
        return 'Name and message must be text.';
    }

    if (name.trim().length < 1 || name.trim().length > 40) {
        return 'Name must be 1 to 40 characters.';
    }

    if (msg.trim().length < 1 || msg.trim().length > 280) {
        return 'Message must be 1 to 280 characters.';
    }

    return null;
}

// Create a fresh session after login or registration
function startSession(req, user, rememberMe = false) {
    return new Promise((resolve, reject) => {
        if (!req.session) {
            return reject(new Error(
                'Session middleware is not configured correctly.'
            ));
        }

        req.session.regenerate(err => {
            if (err) return reject(err);

            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.role = user.role || 'user';
            req.session.isAuthenticated = true;

            if (
                rememberMe === true ||
                rememberMe === 'true'
            ) {
                req.session.cookie.maxAge =
                    7 * 24 * 60 * 60 * 1000;
            } else {
                req.session.cookie.maxAge =
                    15 * 60 * 1000;
            }

            req.session.save(saveError => {
                if (saveError) return reject(saveError);
                resolve();
            });
        });
    });
}

// Authentication middleware for APIs
function requireAuth(req, res, next) {
    if (!req.session || !req.session.isAuthenticated) {
        return res.status(401).json({
            error: 'Please log in first.'
        });
    }

    next();
}

// Authentication middleware for pages
function requireLoginPage(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.redirect('/');
    }

    next();
}

// Admin-only page middleware
function requireAdminPage(req, res, next) {
    if (!req.session || req.session.role !== 'admin') {
        return res.redirect('/');
    }

    next();
}

// ==========================================
// REGISTRATION
// ==========================================

app.post('/register', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body || {};

        if (!username || !password) {
            return res.status(400).json({
                message: 'Username and password are required.'
            });
        }

        const validationError =
            validateCredentials(username, password);

        if (validationError) {
            return res.status(400).json({
                error: validationError
            });
        }

        const cleanName = username.trim().toLowerCase();

        const existingUser =
            await db.getUserByUsername(cleanName);

        if (existingUser) {
            return res.status(409).json({
                error: 'That username is already taken.'
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const user = await db.addUser({
            username: cleanName,
            passwordHash
        });

        await startSession(req, user, false);

        return res.status(201).json({
            success: true,
            username: user.username
        });
    } catch (err) {
        console.error('Registration error:', err);

        if (!res.headersSent) {
            return res.status(500).json({
                error: 'Registration failed. Please try again.'
            });
        }
    }
});

// ==========================================
// LOGIN
// ==========================================

app.post('/login', authLimiter, async (req, res) => {
    try {
        const { username, password, rememberMe } = req.body || {};

        if (
            typeof username !== 'string' ||
            typeof password !== 'string' ||
            !username.trim() ||
            !password
        ) {
            return res.status(400).json({
                error: 'Username and password are required.'
            });
        }

        const user = await db.getUserByUsername(
            username.trim().toLowerCase()
        );

        const passwordOk =
            user && await bcrypt.compare(
                password,
                user.passwordHash
            );

        if (!passwordOk) {
            return res.status(401).json({
                error: 'Incorrect username or password.'
            });
        }

        await startSession(req, user, rememberMe);

        return res.json({
            success: true,
            username: user.username
        });
    } catch (err) {
        console.error('Login error:', err);

        if (!res.headersSent) {
            return res.status(500).json({
                error: 'Login failed. Please try again.'
            });
        }
    }
});

// ==========================================
// LOGOUT
// ==========================================

app.post('/logout', (req, res) => {
    if (!req.session) {
        return res.json({ success: true });
    }

    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);

            return res.status(500).json({
                error: 'Could not log out.'
            });
        }

        res.clearCookie('station.sid');

        return res.json({ success: true });
    });
});

// ==========================================
// GENERAL ROUTES
// ==========================================

app.get('/api/hello', (req, res) => {
    res.json({ message: 'Hello, world!' });
});

app.get('/api/stats', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ visitorCount });
});

app.get('/api/whoami', (req, res) => {
    if (!req.session || !req.session.userId) {
        return res.json({ loggedIn: false });
    }

    res.json({
        loggedIn: true,
        userId: req.session.userId,
        username: req.session.username,
        role: req.session.role
    });
});

// Local practice route
if (!isProduction) {
    app.get('/api/headers-demo', (req, res) => {
        res.set('X-Student-Name', 'Katz Paniagua');

        res.json({
            browser: req.get('User-Agent'),
            languages: req.get('Accept-Language'),
            allRequestHeaders: req.headers
        });
    });
}

// ==========================================
// DASHBOARD
// ==========================================

app.get('/dashboard', requireLoginPage, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
});

// ==========================================
// GUESTBOOK PAGE
// ==========================================

app.get('/guestbook', requireLoginPage, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'guestbook.html'));
});

// Read all guestbook entries
app.get('/api/guestbook', requireAuth, async (req, res) => {
    try {
        const entries = await db.getAllEntries();
        res.json(entries);
    } catch (err) {
        console.error('Guestbook read error:', err);

        res.status(500).json({
            error: 'Could not load guestbook.'
        });
    }
});

// Read one guestbook entry
app.get('/api/guestbook/:id', requireAuth, async (req, res) => {
    try {
        const entry = await db.getEntryById(req.params.id);

        if (!entry) {
            return res.status(404).json({
                error: 'Entry not found.'
            });
        }

        res.json(entry);
    } catch (err) {
        console.error('Guestbook entry error:', err);

        res.status(500).json({
            error: 'Could not load entry.'
        });
    }
});

// Create a guestbook entry
app.post('/api/guestbook', requireAuth, async (req, res) => {
    try {
        const { name, msg } = req.body || {};

        const validationError = validateEntry(name, msg);

        if (validationError) {
            return res.status(400).json({
                error: validationError
            });
        }

        if (filter.isProfane(msg)) {
            return res.status(400).json({
                error: 'Please keep your message friendly.'
            });
        }

        const entry = await db.addEntry({
            name: name.trim(),
            msg: msg.trim(),
            userId: req.session.userId
        });

        return res.status(201).json(entry);
    } catch (err) {
        console.error('Guestbook create error:', err);

        return res.status(500).json({
            error: 'Could not create entry.'
        });
    }
});

// Delete a guestbook entry
app.delete('/api/guestbook/:id', requireAuth, async (req, res) => {
    try {
        const entry = await db.getEntryById(req.params.id);

        if (!entry) {
            return res.status(404).json({
                error: 'Entry not found.'
            });
        }

        const isAdmin = req.session.role === 'admin';

        const ownsEntry =
            String(entry.userId) === String(req.session.userId);

        if (!isAdmin && !ownsEntry) {
            return res.status(403).json({
                error: 'You can only delete your own messages.'
            });
        }

        const deleted = await db.deleteEntry(req.params.id);

        if (!deleted) {
            return res.status(404).json({
                error: 'Entry not found.'
            });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error('Guestbook delete error:', err);

        return res.status(500).json({
            error: 'Could not delete entry.'
        });
    }
});

// Update a guestbook entry
app.put('/api/guestbook/:id', requireAuth, async (req, res) => {
    try {
        const { msg } = req.body || {};

        if (
            typeof msg !== 'string' ||
            msg.trim().length < 1 ||
            msg.trim().length > 280
        ) {
            return res.status(400).json({
                error: 'Message must be between 1 and 280 characters.'
            });
        }

        const entry = await db.getEntryById(req.params.id);

        if (!entry) {
            return res.status(404).json({
                error: 'Entry not found.'
            });
        }

        const isAdmin = req.session.role === 'admin';

        const ownsEntry =
            String(entry.userId) === String(req.session.userId);

        if (!isAdmin && !ownsEntry) {
            return res.status(403).json({
                error: 'You can only edit your own messages.'
            });
        }

        const updated = await db.updateEntry(req.params.id, {
            name: entry.name,
            msg: msg.trim()
        });

        if (!updated) {
            return res.status(404).json({
                error: 'Entry not found.'
            });
        }

        return res.json(updated);
    } catch (err) {
        console.error('Guestbook update error:', err);

        return res.status(500).json({
            error: 'Could not update entry.'
        });
    }
});

// ==========================================
// LANDING PAGE AND PROJECTS
// ==========================================

app.get('/', (req, res) => {
    visitorCount++;

    console.log(
        `Visit #${visitorCount}: someone viewed the landing page`
    );

    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/projects', (req, res) => {
    visitorCount++;

    console.log(
        `Visit #${visitorCount}: someone viewed the projects page`
    );

    res.sendFile(path.join(PUBLIC_DIR, 'projects.html'));
});

// ==========================================
// NASA SPACE / APOD
// ==========================================

function validateApodDate(date) {
    if (date === undefined) return null;

    if (
        typeof date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
        return 'Date must look like YYYY-MM-DD.';
    }

    const parsed = new Date(date + 'T00:00:00Z');

    if (
        isNaN(parsed) ||
        parsed.toISOString().slice(0, 10) !== date
    ) {
        return 'That is not a real date.';
    }

    if (date < '1995-06-16') {
        return 'The first picture is from 1995-06-16.';
    }

    const today = new Date().toISOString().slice(0, 10);

    if (date > today) {
        return 'That date is in the future.';
    }

    return null;
}

app.get('/api/space', async (req, res) => {
    try {
        const { date } = req.query;

        const dateError = validateApodDate(date);

        if (dateError) {
            return res.status(400).json({
                error: dateError
            });
        }

        const cacheKey = date || 'today';
        const cached = apodCache.get(cacheKey);

        const isFresh =
            cacheKey !== 'today' ||
            (
                cached &&
                Date.now() - cached.savedAt < TODAY_MAX_AGE
            );

        if (cached && isFresh) {
            console.log('Cache hit:', cacheKey);
            return res.json(cached.data);
        }

        let address =
            'https://science.nasa.gov/wp-json/wp/v2/apod-basic/';

        if (date) {
            const shortDate = date.slice(2).replaceAll('-', '');
            address += shortDate;
        }

        const nasaUrl = new URL(address);

        nasaUrl.searchParams.set(
            'api_key',
            process.env.NASA_API_KEY
        );

        const nasaResponse = await fetch(nasaUrl, {
            signal: AbortSignal.timeout(8000)
        });

        if (nasaResponse.status === 404) {
            return res.status(404).json({
                error: 'NASA has no picture for that date.'
            });
        }

        if (!nasaResponse.ok) {
            console.error('NASA error:', nasaResponse.status);

            return res.status(502).json({
                error: 'NASA could not send a picture right now.'
            });
        }

        const data = await nasaResponse.json();
        const picture = Array.isArray(data) ? data[0] : data;

        if (!picture) {
            return res.status(502).json({
                error: 'NASA returned no picture.'
            });
        }

        const result = {
            title: picture.title,
            date: picture.date,
            imageUrl: picture.hdurl || picture.url,
            description: picture.alt || picture.explanation,
            nasaPage: picture.permalink || picture.url
        };

        apodCache.set(cacheKey, {
            data: result,
            savedAt: Date.now()
        });

        if (apodCache.size > MAX_CACHE_SIZE) {
            const oldestKey = apodCache.keys().next().value;
            apodCache.delete(oldestKey);
        }

        return res.json(result);
    } catch (err) {
        console.error('NASA request error:', err);

        return res.status(502).json({
            error: 'Could not retrieve NASA picture. Try again later.'
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// ==========================================
// STATIC FILES AND 404
// ==========================================

app.use(express.static(PUBLIC_DIR, {
    extensions: ['html']
}));

app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            error: 'Not found'
        });
    }

    res.status(404).sendFile(
        path.join(PUBLIC_DIR, '404.html')
    );
});

// ==========================================
// ERROR HANDLER
// ==========================================

app.use((err, req, res, next) => {
    const time = new Date().toISOString();

    console.error(
        `[${time}] ERROR ${req.method} ${req.path}`,
        err
    );

    fs.appendFile(
        LOG_FILE,
        `[${time}] ERROR ${req.method} ${req.path}: ${err.message}\n`,
        () => { }
    );

    if (res.headersSent) {
        return next(err);
    }

    const status = err.status || 500;

    const message = status < 500
        ? err.message
        : 'Something went wrong on our end.';

    if (req.path.startsWith('/api/')) {
        return res.status(status).json({
            error: message
        });
    }

    res.status(status).send(
        '<h1>Something went wrong</h1>' +
        '<p>Please try again later.</p>' +
        '<a href="/">Back to home</a>'
    );
});

// ==========================================
// CREATE ADMIN ACCOUNT AND START SERVER
// ==========================================

async function ensureAdmin() {
    const adminUsername =
        process.env.ADMIN_USERNAME.trim().toLowerCase();

    const existing = await db.getUserByUsername(adminUsername);

    if (existing) return;

    const passwordHash = await bcrypt.hash(
        process.env.ADMIN_PASSWORD,
        12
    );

    await db.addUser({
        username: adminUsername,
        passwordHash,
        role: 'admin'
    });

    console.log('Created admin account');
}

ensureAdmin()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server live on http://localhost:${PORT}`);
        });
    })
    .catch(err => {
        console.error('Could not start server:', err);
        process.exit(1);
    });