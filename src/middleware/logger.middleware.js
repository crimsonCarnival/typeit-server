/**
 * Request/Response Logger Middleware
 * Logs detailed information about every HTTP request and response
 */

// ANSI color codes for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',

    // Status code colors
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m',
};

/**
 * Sanitize sensitive data from objects
 * @param {Object} obj - Object to sanitize
 * @returns {Object} - Sanitized object
 */
const sanitize = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;

    const sensitiveFields = ['password', 'token', 'authorization', 'secret', 'apiKey', 'api_key'];
    const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };

    for (const key in sanitized) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
            sanitized[key] = '***REDACTED***';
        } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
            sanitized[key] = sanitize(sanitized[key]);
        }
    }

    return sanitized;
};

/**
 * Get color based on HTTP status code
 * @param {number} statusCode - HTTP status code
 * @returns {string} - Color code
 */
const getStatusColor = (statusCode) => {
    if (statusCode >= 500) return colors.red;
    if (statusCode >= 400) return colors.yellow;
    if (statusCode >= 300) return colors.cyan;
    if (statusCode >= 200) return colors.green;
    return colors.gray;
};

/**
 * Format bytes to human readable size
 * @param {number} bytes - Number of bytes
 * @returns {string} - Formatted size
 */
const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Logger middleware
 */
export const logger = (req, res, next) => {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // Log incoming request
    console.log('\n' + colors.bright + colors.cyan + '━'.repeat(80) + colors.reset);
    console.log(`${colors.bright}${colors.magenta}▶ INCOMING REQUEST${colors.reset} ${colors.gray}[${timestamp}]${colors.reset}`);
    console.log(`${colors.bright}Method:${colors.reset} ${colors.cyan}${req.method}${colors.reset}`);
    console.log(`${colors.bright}URL:${colors.reset} ${req.originalUrl || req.url}`);

    // Log query parameters if present
    if (Object.keys(req.query).length > 0) {
        console.log(`${colors.bright}Query:${colors.reset}`, sanitize(req.query));
    }

    // Log request body if present (and not empty)
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`${colors.bright}Body:${colors.reset}`, sanitize(req.body));
    }

    // Log headers (sanitized)
    const sanitizedHeaders = sanitize(req.headers);
    console.log(`${colors.bright}Headers:${colors.reset}`, sanitizedHeaders);

    // Log user info if authenticated
    if (req.user) {
        console.log(`${colors.bright}User:${colors.reset} ${req.user.username || req.user.email || req.userId}`);
    }

    // Store original res.json and res.send methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    // Track if response has been logged
    let responseLogged = false;

    /**
     * Log response details
     */
    const logResponse = (body) => {
        if (responseLogged) return;
        responseLogged = true;

        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;
        const statusColor = getStatusColor(statusCode);

        console.log(`${colors.bright}${statusColor}◀ RESPONSE${colors.reset} ${colors.gray}[${duration}ms]${colors.reset}`);
        console.log(`${colors.bright}Status:${colors.reset} ${statusColor}${statusCode}${colors.reset}`);

        // Log response body
        if (body) {
            try {
                const bodyObj = typeof body === 'string' ? JSON.parse(body) : body;
                const bodyStr = JSON.stringify(sanitize(bodyObj), null, 2);
                const bodySize = Buffer.byteLength(bodyStr, 'utf8');

                console.log(`${colors.bright}Size:${colors.reset} ${formatBytes(bodySize)}`);

                // Only log body if it's not too large (< 10KB)
                if (bodySize < 10240) {
                    console.log(`${colors.bright}Body:${colors.reset}`, sanitize(bodyObj));
                } else {
                    console.log(`${colors.bright}Body:${colors.reset} ${colors.gray}[Too large to display - ${formatBytes(bodySize)}]${colors.reset}`);
                }
            } catch (e) {
                console.log(`${colors.bright}Body:${colors.reset}`, body);
            }
        }

        console.log(colors.cyan + '━'.repeat(80) + colors.reset + '\n');
    };

    // Override res.json
    res.json = function (body) {
        logResponse(body);
        return originalJson(body);
    };

    // Override res.send
    res.send = function (body) {
        logResponse(body);
        return originalSend(body);
    };

    // Handle response end (in case res.json or res.send wasn't called)
    res.on('finish', () => {
        if (!responseLogged) {
            logResponse(null);
        }
    });

    next();
};
