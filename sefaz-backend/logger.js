const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[LOG_LEVEL] ?? 1;

function formatLog(level, context, message, data) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        context,
        message,
    };
    if (data !== undefined) entry.data = data;
    return JSON.stringify(entry);
}

export function createLogger(context) {
    return {
        debug: (msg, data) => { if (currentLevel <= 0) console.log(formatLog('debug', context, msg, data)); },
        info: (msg, data) => { if (currentLevel <= 1) console.log(formatLog('info', context, msg, data)); },
        warn: (msg, data) => { if (currentLevel <= 2) console.warn(formatLog('warn', context, msg, data)); },
        error: (msg, data) => { if (currentLevel <= 3) console.error(formatLog('error', context, msg, data)); },
    };
}
