const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

/**
 * Advanced logging system with rotation, filtering, and monitoring
 * Provides structured logging with different levels and outputs
 */
class Logger {
    constructor() {
        this.logDir = process.env.LOG_DIR || 'logs';
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.maxLogFiles = process.env.MAX_LOG_FILES || '14d';
        this.maxLogSize = process.env.MAX_LOG_SIZE || '20m';
        
        this.createLogger();
        this.setupMetrics();
    }

    createLogger() {
        // Custom log format
        const logFormat = winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss.SSS'
            }),
            winston.format.errors({ stack: true }),
            winston.format.json(),
            winston.format.prettyPrint()
        );

        // Console format for development
        const consoleFormat = winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({
                format: 'HH:mm:ss'
            }),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
                let metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
                return `${timestamp} [${level}]: ${message} ${metaStr}`;
            })
        );

        this.logger = winston.createLogger({
            level: this.logLevel,
            format: logFormat,
            defaultMeta: {
                service: 'whatsapp-attendance-bot',
                version: process.env.npm_package_version || '1.0.0',
                nodeEnv: process.env.NODE_ENV || 'development'
            },
            transports: [
                // Console output
                new winston.transports.Console({
                    format: process.env.NODE_ENV === 'production' ? logFormat : consoleFormat,
                    level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug'
                }),

                // General application logs
                new DailyRotateFile({
                    filename: path.join(this.logDir, 'application-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxSize: this.maxLogSize,
                    maxFiles: this.maxLogFiles,
                    level: 'info'
                }),

                // Error logs
                new DailyRotateFile({
                    filename: path.join(this.logDir, 'error-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxSize: this.maxLogSize,
                    maxFiles: this.maxLogFiles,
                    level: 'error'
                }),

                // Security logs
                new DailyRotateFile({
                    filename: path.join(this.logDir, 'security-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxSize: this.maxLogSize,
                    maxFiles: this.maxLogFiles,
                    level: 'warn',
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.json(),
                        winston.format.printf((info) => {
                            if (info.type === 'security') {
                                return JSON.stringify(info);
                            }
                            return null;
                        }),
                        winston.format((info) => info.type === 'security' ? info : false)()
                    )
                }),

                // Performance logs
                new DailyRotateFile({
                    filename: path.join(this.logDir, 'performance-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxSize: this.maxLogSize,
                    maxFiles: this.maxLogFiles,
                    level: 'info',
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.json(),
                        winston.format((info) => info.type === 'performance' ? info : false)()
                    )
                })
            ],

            // Handle logger errors
            exceptionHandlers: [
                new DailyRotateFile({
                    filename: path.join(this.logDir, 'exceptions-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxSize: this.maxLogSize,
                    maxFiles: this.maxLogFiles
                })
            ],

            rejectionHandlers: [
                new DailyRotateFile({
                    filename: path.join(this.logDir, 'rejections-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    maxSize: this.maxLogSize,
                    maxFiles: this.maxLogFiles
                })
            ]
        });
    }

    setupMetrics() {
        this.metrics = {
            logCounts: new Map(),
            errorCounts: new Map(),
            performanceMetrics: new Map(),
            securityEvents: new Map()
        };

        // Reset metrics daily
        setInterval(() => {
            this.resetDailyMetrics();
        }, 24 * 60 * 60 * 1000);
    }

    // Standard logging methods
    debug(message, meta = {}) {
        this.incrementMetric('logCounts', 'debug');
        this.logger.debug(message, { ...meta, type: 'debug' });
    }

    info(message, meta = {}) {
        this.incrementMetric('logCounts', 'info');
        this.logger.info(message, { ...meta, type: 'info' });
    }

    warn(message, meta = {}) {
        this.incrementMetric('logCounts', 'warn');
        this.logger.warn(message, { ...meta, type: 'warn' });
    }

    error(message, error = null, meta = {}) {
        this.incrementMetric('logCounts', 'error');
        this.incrementMetric('errorCounts', error?.name || 'unknown');
        
        const errorMeta = {
            ...meta,
            type: 'error',
            error: error ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
                code: error.code
            } : null
        };

        this.logger.error(message, errorMeta);
    }

    // Specialized logging methods
    security(event, details = {}) {
        this.incrementMetric('securityEvents', event);
        
        this.logger.warn(`Security Event: ${event}`, {
            type: 'security',
            event,
            timestamp: Date.now(),
            severity: details.severity || 'medium',
            userId: details.userId,
            ipAddress: details.ipAddress,
            userAgent: details.userAgent,
            details
        });
    }

    performance(operation, duration, details = {}) {
        this.incrementMetric('performanceMetrics', operation);
        
        this.logger.info(`Performance: ${operation}`, {
            type: 'performance',
            operation,
            duration,
            timestamp: Date.now(),
            details
        });

        // Warn on slow operations
        if (duration > 5000) { // 5 seconds
            this.warn(`Slow operation detected: ${operation}`, {
                type: 'performance',
                operation,
                duration,
                threshold: 5000
            });
        }
    }

    userActivity(userId, action, details = {}) {
        this.info(`User Activity: ${action}`, {
            type: 'user_activity',
            userId: this.sanitizeUserId(userId),
            action,
            timestamp: Date.now(),
            details: this.sanitizeDetails(details)
        });
    }

    businessMetric(metric, value, tags = {}) {
        this.info(`Business Metric: ${metric}`, {
            type: 'business_metric',
            metric,
            value,
            tags,
            timestamp: Date.now()
        });
    }

    // Query and analysis methods
    async getLogMetrics(timeRange = '24h') {
        try {
            const metrics = {
                timestamp: Date.now(),
                timeRange,
                logCounts: Object.fromEntries(this.metrics.logCounts),
                errorCounts: Object.fromEntries(this.metrics.errorCounts),
                performanceMetrics: Object.fromEntries(this.metrics.performanceMetrics),
                securityEvents: Object.fromEntries(this.metrics.securityEvents),
                totalLogs: Array.from(this.metrics.logCounts.values()).reduce((a, b) => a + b, 0),
                totalErrors: Array.from(this.metrics.errorCounts.values()).reduce((a, b) => a + b, 0)
            };

            return metrics;
        } catch (error) {
            this.error('Failed to get log metrics', error);
            return null;
        }
    }

    getErrorAnalysis() {
        const errors = Array.from(this.metrics.errorCounts.entries())
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count);

        return {
            topErrors: errors.slice(0, 10),
            totalErrors: errors.reduce((sum, error) => sum + error.count, 0),
            errorTypes: errors.length
        };
    }

    getPerformanceAnalysis() {
        const operations = Array.from(this.metrics.performanceMetrics.entries())
            .map(([operation, count]) => ({ operation, count }))
            .sort((a, b) => b.count - a.count);

        return {
            topOperations: operations.slice(0, 10),
            totalOperations: operations.reduce((sum, op) => sum + op.count, 0)
        };
    }

    // Health check for logging system
    async healthCheck() {
        try {
            // Test log write
            const testMessage = `Health check: ${Date.now()}`;
            this.debug(testMessage, { healthCheck: true });

            // Check log directory accessibility
            const fs = require('fs').promises;
            await fs.access(this.logDir);

            return {
                status: 'healthy',
                logLevel: this.logLevel,
                logDir: this.logDir,
                transports: this.logger.transports.length,
                metrics: await this.getLogMetrics()
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    // Utility methods
    incrementMetric(metricType, key) {
        const metric = this.metrics[metricType];
        if (metric) {
            metric.set(key, (metric.get(key) || 0) + 1);
        }
    }

    resetDailyMetrics() {
        this.info('Resetting daily metrics');
        
        Object.values(this.metrics).forEach(metric => {
            if (metric instanceof Map) {
                metric.clear();
            }
        });
    }

    sanitizeUserId(userId) {
        // Anonymize user ID for privacy
        if (!userId) return 'anonymous';
        return userId.replace(/(.{4}).*(.{4})/, '$1****$2');
    }

    sanitizeDetails(details) {
        // Remove sensitive information from log details
        const sensitiveKeys = ['password', 'token', 'apiKey', 'secret'];
        const sanitized = { ...details };
        
        sensitiveKeys.forEach(key => {
            if (sanitized[key]) {
                sanitized[key] = '[REDACTED]';
            }
        });

        return sanitized;
    }

    // Structured logging for specific events
    logUserRegistration(userId, success, details = {}) {
        this.userActivity(userId, 'REGISTRATION', {
            success,
            ...details
        });
    }

    logAttendanceMarked(userId, subjectId, status, details = {}) {
        this.userActivity(userId, 'ATTENDANCE_MARKED', {
            subjectId: this.sanitizeId(subjectId),
            status,
            ...details
        });
    }

    logCommandExecution(userId, command, success, details = {}) {
        this.userActivity(userId, 'COMMAND_EXECUTED', {
            command,
            success,
            ...details
        });
    }

    logSecurityViolation(userId, violation, severity = 'medium', details = {}) {
        this.security(`SECURITY_VIOLATION_${violation}`, {
            userId,
            violation,
            severity,
            ...details
        });
    }

    logRateLimitExceeded(userId, limitType, details = {}) {
        this.security('RATE_LIMIT_EXCEEDED', {
            userId,
            limitType,
            severity: 'medium',
            ...details
        });
    }

    sanitizeId(id) {
        if (!id) return 'unknown';
        return id.toString().replace(/(.{6}).*(.{6})/, '$1...$2');
    }

    // Emergency logging for critical issues
    critical(message, details = {}) {
        this.logger.error(`CRITICAL: ${message}`, {
            type: 'critical',
            timestamp: Date.now(),
            severity: 'critical',
            ...details
        });

        // Also log to console for immediate visibility
        console.error(`🚨 CRITICAL: ${message}`, details);
    }

    // Context-aware logging
    createContextLogger(context) {
        return {
            debug: (message, meta = {}) => this.debug(message, { ...context, ...meta }),
            info: (message, meta = {}) => this.info(message, { ...context, ...meta }),
            warn: (message, meta = {}) => this.warn(message, { ...context, ...meta }),
            error: (message, error = null, meta = {}) => this.error(message, error, { ...context, ...meta }),
            security: (event, details = {}) => this.security(event, { ...context, ...details }),
            performance: (operation, duration, details = {}) => this.performance(operation, duration, { ...context, ...details })
        };
    }
}

// Singleton instance
let loggerInstance = null;

function getLogger() {
    if (!loggerInstance) {
        loggerInstance = new Logger();
    }
    return loggerInstance;
}

module.exports = { Logger, getLogger };