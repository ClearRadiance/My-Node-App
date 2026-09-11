const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

let visitorCount = 0;

const fortunes = ["You'll finish your PWD project",
    "Your code will compile without errors",
    "You'll find a bug in your code today",
];
const animals = ["Bats aren't blind and actually have good eyesight. The myth that bats are blind probably came about because many species use sound to navigate around their environment at night, a system known as echolocation.",
    " Dolphins sleep with only half of their brain at a time. This is vital to their survival, allowing them to both come to the surface to breathe and remain vigilant.",
    " Octopuses have three hearts, all with slightly different roles.",
    " Brazil is the most biodiverse country on Earth. About 18 per cent of all described bird species are found within its borders, as are 14 per cent of amphibians, 7 per cent of mammals, 14 per cent of reptiles, 12 per cent of fish and 13 per cent of plants.",
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

http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const reqPath = parsedUrl.pathname;


    if (reqPath === '/coffee') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<h1>Here\'s your coffee!</h1>');
    }

    if (reqPath === '/roll') {
        const roll = Math.floor(Math.random() * 6) + 1;
        console.log(`Roll: ${roll}`);
        return res.end(`<h1> You rolled a ${roll}!</h1>`);
    }

    if (reqPath === '/api/stats') {
        const stats = {
            visitorCount: visitorCount,
            uptimeSeconds: process.uptime(),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(stats));
    }

    // Route Normalization: Map root to index.html & append .html to extensionless routes
    let normalizedPath = reqPath === '/' ? '/index.html' : reqPath;
    if (!path.extname(normalizedPath)) {
        normalizedPath += '.html';
    }

    const filePath = path.join(PUBLIC_DIR, normalizedPath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            return res.end('<h1>404: Page Not Found</h1>');
        }

        let finalContent = content;

        if (ext === '.html') {
            let randomAnimal = animals[Math.floor(Math.random() * animals.length)];
            let randomFortune = fortunes[Math.floor(Math.random() * fortunes.length)];
            // Track visits to the home page
            if (normalizedPath === '/index.html') {
                visitorCount++;
                console.log(`[VISIT #${visitorCount}] Connection from: ${req.socket.remoteAddress}`);
            }

            // Server-Driven Theme Handling
            const theme = parsedUrl.searchParams.get('theme') === 'dark' ? 'dark-mode' : 'light-mode';

            // Replace template placeholders in HTML files
            finalContent = content.toString()
                .replace('{{COUNT}}', String(visitorCount))
                .replace('{{THEME_CLASS}}', theme)
                .replace('{{FORTUNE}}', randomFortune)
                .replace('{{ANIMAL}}', randomAnimal);
        }

        console.log(`[REQUEST] ${req.socket.remoteAddress} accessed ${normalizedPath}`);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(finalContent);
    });
}).listen(PORT, '0.0.0.0', () => {
    console.log(`Server live! Listening on port http://localhost:${PORT}...`);
});