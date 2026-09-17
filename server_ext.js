const http = require('http');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { Filter } = require('bad-words');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const filter = new Filter();

let visitorCount = 0;
const ipRequestCounts = new Map();

const fortunes = [
    "You'll finish your PWD project",
    "Your code will compile without errors",
    "You'll find a bug in your code today",
];

const animals = [
    "Bats aren't blind and actually have good eyesight. The myth that bats are blind probably came about because many species use sound to navigate around their environment at night, a system known as echolocation.",

    "Dolphins sleep with only half of their brain at a time. This is vital to their survival, allowing them to both come to the surface to breathe and remain vigilant.",

    "Octopuses have three hearts, all with slightly different roles.",

    "Brazil is the most biodiverse country on Earth. About 18 per cent of all described bird species are found within its borders, as are 14 per cent of amphibians, 7 per cent of mammals, 14 per cent of reptiles, 12 per cent of fish and 13 per cent of plants.",

    "The animal kingdom’s fastest rodent isn’t a rat or a squirrel – it’s the Patagonian mara, a unique species native to Argentina and Patagonia. With rabbit-like ears, powerful hind legs and impressive top speeds, this mammal thrives in the arid grasslands and scrublands of Patagonia."
];

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.json': 'application/json',
    '.ico': 'image/x-icon'
};

const DATA_FILE = path.join(__dirname, 'messages.json');

function getSavedMessages() {
    if (!fs.existsSync(DATA_FILE)) {
        return ["Server booted up successfully"];
    }

    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (err) {
        console.error('Could not read messages.json:', err);
        return ["Server booted up successfully"];
    }
}

http.createServer((req, res) => {

    const parsedUrl = new URL(
        req.url,
        `http://${req.headers.host || 'localhost'}`
    );

    const reqPath = parsedUrl.pathname;

    const clientIp =
        req.headers['x-forwarded-for'] ||
        req.socket.remoteAddress;


    const logLine =
        `[${new Date().toISOString()}] IP: ${clientIp} | Method: ${req.method} | Path: ${reqPath}\n`;

    fs.appendFile(
        path.join(__dirname, 'server.log'),
        logLine,
        (err) => {
            if (err) {
                console.error('Log write failed:', err);
            }
        }
    );



    const now = Date.now();
    const windowMs = 10000;
    const maxRequests = 10;

    for (const [ip, data] of ipRequestCounts) {
        if (now > data.resetTime) {
            ipRequestCounts.delete(ip);
        }
    }

    const ipData =
        ipRequestCounts.get(clientIp) || {
            count: 0,
            resetTime: now + windowMs
        };

    if (now > ipData.resetTime) {
        ipData.count = 0;
        ipData.resetTime = now + windowMs;
    }

    ipData.count++;
    ipRequestCounts.set(clientIp, ipData);

    if (ipData.count > maxRequests) {
        res.writeHead(429, {
            'Content-Type': 'text/html',
            'Retry-After': '10'
        });

        return res.end(
            '<h1>429 Too Many Requests</h1><p>Please wait 10 seconds.</p>'
        );
    }




    const action = parsedUrl.searchParams.get('action');

    if (action === 'clear') {
        const defaultMsg = ["All messages cleared by Admin."];

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(defaultMsg, null, 2)
        );

        res.writeHead(302, {
            'Location': '/admin'
        });

        return res.end();
    }



    const newMsg = parsedUrl.searchParams.get('msg');

    if (newMsg) {
        const messages = getSavedMessages();

        const cleanedInput = newMsg.replace(/\s+/g, '').trim();
        const compactInput = cleanedInput.replace(/\s/g, '');
        const filteredMsg = filter.isProfane(compactInput)
            ? '[Message removed]'
            : filter.clean(cleanedInput);

        messages.push(filteredMsg);

        // Keep only the most recent 100 messages
        const recentMessages = messages.slice(-100);

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(recentMessages, null, 2)
        );

        res.writeHead(302, {
            'Location': '/shoutbox'
        });

        return res.end();
    }



    if (reqPath === '/coffee') {
        res.writeHead(200, {
            'Content-Type': 'text/html'
        });

        return res.end(
            "<h1>Here's your coffee!</h1>"
        );
    }



    if (reqPath === '/roll') {
        const roll = Math.floor(Math.random() * 6) + 1;

        console.log(`Roll: ${roll}`);

        res.writeHead(200, {
            'Content-Type': 'text/html'
        });

        return res.end(
            `<h1>You rolled a ${roll}!</h1>`
        );
    }



    if (reqPath === '/api/stats') {
        const stats = {
            visitorCount: visitorCount,
            uptimeSeconds: process.uptime()
        };

        res.writeHead(200, {
            'Content-Type': 'application/json'
        });

        return res.end(JSON.stringify(stats));
    }



    let normalizedPath =
        reqPath === '/' ? '/index.html' : reqPath;

    if (!path.extname(normalizedPath)) {
        normalizedPath += '.html';
    }

    const filePath = path.join(
        PUBLIC_DIR,
        normalizedPath
    );

    const ext = path.extname(filePath).toLowerCase();

    const contentType =
        mime.lookup(filePath) ||
        MIME_TYPES[ext] ||
        'text/plain';


    fs.readFile(filePath, (err, content) => {

        if (err) {
            res.writeHead(404, {
                'Content-Type': 'text/html'
            });

            return res.end(
                '<h1>404: Page Not Found</h1>'
            );
        }

        let finalContent = content;



        if (ext === '.html') {

            // Random fortune
            const randomFortune =
                fortunes[
                Math.floor(Math.random() * fortunes.length)
                ];

            // Random animal fact
            const randomAnimal =
                animals[
                Math.floor(Math.random() * animals.length)
                ];

            // Count homepage visits
            if (normalizedPath === '/index.html') {
                visitorCount++;

                console.log(
                    `[VISIT #${visitorCount}] Connection from: ${req.socket.remoteAddress}`
                );
            }

            // Dark/light theme
            const theme =
                parsedUrl.searchParams.get('theme') === 'dark'
                    ? 'dark-mode'
                    : 'light-mode';

            // Saved messages
            const messageListHTML =
                getSavedMessages()
                    .map(msg => `<li>${msg}</li>`)
                    .join('');

            // Replace placeholders
            finalContent = content
                .toString()
                .replace(
                    '{{COUNT}}',
                    String(visitorCount)
                )
                .replace(
                    '{{THEME_CLASS}}',
                    theme
                )
                .replace(
                    '{{FORTUNE}}',
                    randomFortune
                )
                .replace(
                    '{{ANIMAL}}',
                    randomAnimal
                )
                .replace(
                    '{{MESSAGES}}',
                    messageListHTML
                );
        }

        console.log(
            `[REQUEST] ${req.socket.remoteAddress} accessed ${normalizedPath}`
        );

        res.writeHead(200, {
            'Content-Type': contentType
        });

        res.end(finalContent);
    });

}).listen(PORT, () => {
    console.log(
        `Server listening on port ${PORT}`
    );
});