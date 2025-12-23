// Request Metrics Logger for iRacing Forum Browser Extension
// Tracks concurrent request performance, timing, and success/failure rates per driver
// Implements requirement 6.5: Performance optimization logging and metrics

const RequestMetricsLogger = {
    // Configuration
    config: {
        enableLogging: true,
        enableDetailedLogging: true,
        logLevel: 'info', // 'debug', 'info', 'warn', 'error'
        metricsReportInterval: 30000, // 30 seconds
        maxHistorySize: 1000, // Maximum number of request records to keep
        enablePerformanceComparison: true
    },
    
    // Metrics storage
    metrics: {
        // Request timing and performance
        requests: {
            total: 0,
            successful: 0,
            failed: 0,
            cached: 0,
            concurrent: 0,
            individual: 0,
            batch: 0
        },
        
        // Timing metrics
        timing: {
            totalResponseTime: 0,
            averageResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            responseTimes: [], // Keep last N response times for analysis
            
            // Individual vs batch comparison
            individualRequests: {
                count: 0,
                totalTime: 0,
                averageTime: 0,
                minTime: Infinity,
                maxTime: 0
            },
            
            batchRequests: {
                count: 0,
                totalTime: 0,
                averageTime: 0,
                minTime: Infinity,
                maxTime: 0
            },
            
            performanceImprovement: 0 // Percentage improvement of individual vs batch
        },
        
        // Concurrent execution metrics
        concurrency: {
            maxConcurrent: 0,
            currentConcurrent: 0,
            averageConcurrent: 0,
            concurrencyHistory: [],
            queuedRequests: 0,
            peakQueueSize: 0
        },
        
        // Per-driver success/failure rates
        driverMetrics: new Map(),
        
        // Error breakdown
        errors: {
            network: 0,
            timeout: 0,
            api: 0,
            data: 0,
            unknown: 0,
            retries: 0
        },
        
        // Cache performance
        cache: {
            hits: 0,
            misses: 0,
            hitRate: 0,
            totalCacheChecks: 0
        },
        
        // Session information
        session: {
            startTime: Date.now(),
            totalDriversProcessed: 0,
            uniqueDriversProcessed: new Set(),
            pagesProcessed: 0,
            requestBatches: 0
        }
    },
    
    // Request history for detailed analysis
    requestHistory: [],
    
    // Performance comparison data
    comparisonData: {
        individualVsBatch: [],
        cacheVsApi: [],
        concurrentVsSequential: []
    },
    
    // Initialize the metrics logger
    initialize() {
        this.log('info', 'RequestMetricsLogger: Initializing request metrics and logging system');
        
        // Reset all metrics
        this.resetMetrics();
        
        // Start periodic reporting if enabled
        if (this.config.metricsReportInterval > 0) {
            this.startPeriodicReporting();
        }
        
        // Register cleanup handlers
        this.registerCleanupHandlers();
        
        this.log('info', 'RequestMetricsLogger: Metrics logging system initialized');
    },
    
    // Start tracking a request
    startRequest(driverName, requestType = 'individual', isCached = false) {
        const requestId = this.generateRequestId(driverName);
        const startTime = performance.now();
        
        // Create request record
        const requestRecord = {
            requestId,
            driverName,
            requestType, // 'individual', 'batch', 'cached'
            isCached,
            startTime,
            endTime: null,
            responseTime: null,
            success: null,
            error: null,
            retryCount: 0,
            concurrentCount: this.metrics.concurrency.currentConcurrent
        };
        
        // Update metrics
        this.metrics.requests.total++;
        if (isCached) {
            this.metrics.requests.cached++;
            this.metrics.cache.hits++;
        } else {
            this.metrics.cache.misses++;
            if (requestType === 'individual') {
                this.metrics.requests.individual++;
                this.metrics.concurrency.currentConcurrent++;
            } else if (requestType === 'batch') {
                this.metrics.requests.batch++;
            }
        }
        
        // Update cache metrics
        this.metrics.cache.totalCacheChecks++;
        this.updateCacheHitRate();
        
        // Update concurrency tracking
        this.updateConcurrencyMetrics();
        
        // Initialize driver metrics if not exists
        this.initializeDriverMetrics(driverName);
        const driverMetric = this.metrics.driverMetrics.get(driverName);
        driverMetric.requests++;
        
        // Add to request history
        this.requestHistory.push(requestRecord);
        this.trimRequestHistory();
        
        this.log('debug', `Started ${requestType} request for driver: ${driverName} (ID: ${requestId}, Cached: ${isCached})`);
        
        return requestRecord;
    },
    
    // Complete a successful request
    completeRequest(requestRecord, responseData = null) {
        const endTime = performance.now();
        const responseTime = endTime - requestRecord.startTime;
        
        // Update request record
        requestRecord.endTime = endTime;
        requestRecord.responseTime = responseTime;
        requestRecord.success = true;
        
        // Update metrics
        this.metrics.requests.successful++;
        if (!requestRecord.isCached) {
            if (requestRecord.requestType === 'individual') {
                this.metrics.concurrency.currentConcurrent--;
            }
        }
        
        // Update timing metrics
        this.updateTimingMetrics(responseTime, requestRecord.requestType);
        
        // Update driver metrics
        const driverMetric = this.metrics.driverMetrics.get(requestRecord.driverName);
        if (driverMetric) {
            driverMetric.successes++;
            driverMetric.totalResponseTime += responseTime;
            driverMetric.averageResponseTime = driverMetric.totalResponseTime / driverMetric.successes;
            driverMetric.lastSuccessTime = Date.now();
        }
        
        // Update session metrics
        this.metrics.session.totalDriversProcessed++;
        this.metrics.session.uniqueDriversProcessed.add(requestRecord.driverName);
        
        // Log performance data
        this.logRequestPerformance(requestRecord, responseData);
        
        this.log('info', `Completed ${requestRecord.requestType} request for driver: ${requestRecord.driverName} in ${responseTime.toFixed(2)}ms`);
        
        return requestRecord;
    },
    
    // Record a failed request
    failRequest(requestRecord, error) {
        const endTime = performance.now();
        const responseTime = endTime - requestRecord.startTime;
        
        // Update request record
        requestRecord.endTime = endTime;
        requestRecord.responseTime = responseTime;
        requestRecord.success = false;
        requestRecord.error = error;
        
        // Update metrics
        this.metrics.requests.failed++;
        if (!requestRecord.isCached) {
            if (requestRecord.requestType === 'individual') {
                this.metrics.concurrency.currentConcurrent--;
            }
        }
        
        // Categorize and count error
        const errorType = this.categorizeError(error);
        this.metrics.errors[errorType]++;
        
        // Update driver metrics
        const driverMetric = this.metrics.driverMetrics.get(requestRecord.driverName);
        if (driverMetric) {
            driverMetric.failures++;
            driverMetric.errors.push({
                type: errorType,
                message: error.message || 'Unknown error',
                timestamp: Date.now(),
                responseTime: responseTime
            });
            
            // Keep only last 10 errors per driver
            if (driverMetric.errors.length > 10) {
                driverMetric.errors.shift();
            }
        }
        
        this.log('warn', `Failed ${requestRecord.requestType} request for driver: ${requestRecord.driverName} after ${responseTime.toFixed(2)}ms - ${errorType}: ${error.message}`);
        
        return requestRecord;
    },
    
    // Record a retry attempt
    recordRetry(requestRecord, error, attempt) {
        requestRecord.retryCount = attempt;
        this.metrics.errors.retries++;
        
        const driverMetric = this.metrics.driverMetrics.get(requestRecord.driverName);
        if (driverMetric) {
            driverMetric.retries++;
        }
        
        this.log('warn', `Retry attempt ${attempt} for driver: ${requestRecord.driverName} - ${error.message}`);
    },
    
    // Record batch request for comparison
    recordBatchRequest(driverCount, totalTime, success = true) {
        const batchRecord = {
            requestId: this.generateRequestId('batch'),
            requestType: 'batch',
            driverCount: driverCount,
            startTime: performance.now() - totalTime,
            endTime: performance.now(),
            responseTime: totalTime,
            success: success,
            concurrentCount: 0
        };
        
        // Update batch timing metrics
        this.metrics.timing.batchRequests.count++;
        this.metrics.timing.batchRequests.totalTime += totalTime;
        this.metrics.timing.batchRequests.averageTime = 
            this.metrics.timing.batchRequests.totalTime / this.metrics.timing.batchRequests.count;
        this.metrics.timing.batchRequests.minTime = Math.min(this.metrics.timing.batchRequests.minTime, totalTime);
        this.metrics.timing.batchRequests.maxTime = Math.max(this.metrics.timing.batchRequests.maxTime, totalTime);
        
        // Calculate performance improvement
        this.calculatePerformanceImprovement();
        
        // Add to comparison data
        this.comparisonData.individualVsBatch.push({
            timestamp: Date.now(),
            batchTime: totalTime,
            batchDriverCount: driverCount,
            individualAverageTime: this.metrics.timing.individualRequests.averageTime,
            improvement: this.metrics.timing.performanceImprovement
        });
        
        // Add to request history
        this.requestHistory.push(batchRecord);
        this.trimRequestHistory();
        
        this.log('info', `Recorded batch request: ${driverCount} drivers in ${totalTime.toFixed(2)}ms (Success: ${success})`);
        
        return batchRecord;
    },
    
    // Update timing metrics
    updateTimingMetrics(responseTime, requestType) {
        // Overall timing
        this.metrics.timing.totalResponseTime += responseTime;
        const totalRequests = this.metrics.requests.successful + this.metrics.requests.failed;
        this.metrics.timing.averageResponseTime = this.metrics.timing.totalResponseTime / totalRequests;
        this.metrics.timing.minResponseTime = Math.min(this.metrics.timing.minResponseTime, responseTime);
        this.metrics.timing.maxResponseTime = Math.max(this.metrics.timing.maxResponseTime, responseTime);
        
        // Add to response times history
        this.metrics.timing.responseTimes.push(responseTime);
        if (this.metrics.timing.responseTimes.length > this.config.maxHistorySize) {
            this.metrics.timing.responseTimes.shift();
        }
        
        // Request type specific timing
        if (requestType === 'individual') {
            this.metrics.timing.individualRequests.count++;
            this.metrics.timing.individualRequests.totalTime += responseTime;
            this.metrics.timing.individualRequests.averageTime = 
                this.metrics.timing.individualRequests.totalTime / this.metrics.timing.individualRequests.count;
            this.metrics.timing.individualRequests.minTime = Math.min(this.metrics.timing.individualRequests.minTime, responseTime);
            this.metrics.timing.individualRequests.maxTime = Math.max(this.metrics.timing.individualRequests.maxTime, responseTime);
            
            // Recalculate performance improvement
            this.calculatePerformanceImprovement();
        }
    },
    
    // Update concurrency metrics
    updateConcurrencyMetrics() {
        const currentConcurrent = this.metrics.concurrency.currentConcurrent;
        
        // Update peak concurrency
        this.metrics.concurrency.maxConcurrent = Math.max(this.metrics.concurrency.maxConcurrent, currentConcurrent);
        
        // Add to concurrency history
        this.metrics.concurrency.concurrencyHistory.push({
            timestamp: Date.now(),
            concurrent: currentConcurrent
        });
        
        // Keep only recent history
        if (this.metrics.concurrency.concurrencyHistory.length > 100) {
            this.metrics.concurrency.concurrencyHistory.shift();
        }
        
        // Update average concurrency
        const totalConcurrency = this.metrics.concurrency.concurrencyHistory.reduce(
            (sum, entry) => sum + entry.concurrent, 0
        );
        this.metrics.concurrency.averageConcurrent = 
            totalConcurrency / this.metrics.concurrency.concurrencyHistory.length;
    },
    
    // Update cache hit rate
    updateCacheHitRate() {
        if (this.metrics.cache.totalCacheChecks > 0) {
            this.metrics.cache.hitRate = (this.metrics.cache.hits / this.metrics.cache.totalCacheChecks) * 100;
        }
    },
    
    // Calculate performance improvement of individual vs batch requests
    calculatePerformanceImprovement() {
        if (this.metrics.timing.batchRequests.averageTime > 0 && 
            this.metrics.timing.individualRequests.averageTime > 0) {
            
            const improvement = ((this.metrics.timing.batchRequests.averageTime - 
                                this.metrics.timing.individualRequests.averageTime) / 
                                this.metrics.timing.batchRequests.averageTime) * 100;
            
            this.metrics.timing.performanceImprovement = improvement;
        }
    },
    
    // Initialize driver metrics
    initializeDriverMetrics(driverName) {
        if (!this.metrics.driverMetrics.has(driverName)) {
            this.metrics.driverMetrics.set(driverName, {
                requests: 0,
                successes: 0,
                failures: 0,
                retries: 0,
                totalResponseTime: 0,
                averageResponseTime: 0,
                errors: [],
                firstRequestTime: Date.now(),
                lastSuccessTime: null,
                cacheHits: 0,
                cacheMisses: 0
            });
        }
    },
    
    // Generate comprehensive metrics report
    generateMetricsReport() {
        const sessionDuration = Date.now() - this.metrics.session.startTime;
        const sessionDurationMinutes = sessionDuration / (1000 * 60);
        
        const report = {
            timestamp: new Date().toISOString(),
            session: {
                duration: sessionDurationMinutes.toFixed(2) + ' minutes',
                totalDriversProcessed: this.metrics.session.totalDriversProcessed,
                uniqueDriversProcessed: this.metrics.session.uniqueDriversProcessed.size,
                requestBatches: this.metrics.session.requestBatches
            },
            
            requests: {
                total: this.metrics.requests.total,
                successful: this.metrics.requests.successful,
                failed: this.metrics.requests.failed,
                cached: this.metrics.requests.cached,
                individual: this.metrics.requests.individual,
                batch: this.metrics.requests.batch,
                successRate: this.getSuccessRate()
            },
            
            timing: {
                averageResponseTime: this.metrics.timing.averageResponseTime.toFixed(2) + 'ms',
                minResponseTime: this.metrics.timing.minResponseTime === Infinity ? 
                    'N/A' : this.metrics.timing.minResponseTime.toFixed(2) + 'ms',
                maxResponseTime: this.metrics.timing.maxResponseTime.toFixed(2) + 'ms',
                
                individual: {
                    count: this.metrics.timing.individualRequests.count,
                    averageTime: this.metrics.timing.individualRequests.averageTime.toFixed(2) + 'ms',
                    minTime: this.metrics.timing.individualRequests.minTime === Infinity ? 
                        'N/A' : this.metrics.timing.individualRequests.minTime.toFixed(2) + 'ms',
                    maxTime: this.metrics.timing.individualRequests.maxTime.toFixed(2) + 'ms'
                },
                
                batch: {
                    count: this.metrics.timing.batchRequests.count,
                    averageTime: this.metrics.timing.batchRequests.averageTime.toFixed(2) + 'ms',
                    minTime: this.metrics.timing.batchRequests.minTime === Infinity ? 
                        'N/A' : this.metrics.timing.batchRequests.minTime.toFixed(2) + 'ms',
                    maxTime: this.metrics.timing.batchRequests.maxTime.toFixed(2) + 'ms'
                },
                
                performanceImprovement: this.metrics.timing.performanceImprovement.toFixed(1) + '% improvement'
            },
            
            concurrency: {
                maxConcurrent: this.metrics.concurrency.maxConcurrent,
                averageConcurrent: this.metrics.concurrency.averageConcurrent.toFixed(2),
                currentConcurrent: this.metrics.concurrency.currentConcurrent
            },
            
            cache: {
                hits: this.metrics.cache.hits,
                misses: this.metrics.cache.misses,
                hitRate: this.metrics.cache.hitRate.toFixed(1) + '%',
                totalChecks: this.metrics.cache.totalCacheChecks
            },
            
            errors: {
                ...this.metrics.errors,
                total: Object.values(this.metrics.errors).reduce((sum, count) => sum + count, 0)
            },
            
            topDrivers: this.getTopDriversByRequests(5),
            slowestDrivers: this.getSlowestDrivers(5),
            mostFailedDrivers: this.getMostFailedDrivers(5)
        };
        
        return report;
    },
    
    // Log comprehensive metrics report
    logMetricsReport() {
        const report = this.generateMetricsReport();
        
        this.log('info', '=== iRacing Forum Extension Request Metrics Report ===');
        this.log('info', 'Session:', report.session);
        this.log('info', 'Requests:', report.requests);
        this.log('info', 'Timing:', report.timing);
        this.log('info', 'Concurrency:', report.concurrency);
        this.log('info', 'Cache:', report.cache);
        this.log('info', 'Errors:', report.errors);
        
        if (report.topDrivers.length > 0) {
            this.log('info', 'Top Drivers by Requests:', report.topDrivers);
        }
        
        if (report.slowestDrivers.length > 0) {
            this.log('info', 'Slowest Drivers:', report.slowestDrivers);
        }
        
        if (report.mostFailedDrivers.length > 0) {
            this.log('info', 'Most Failed Drivers:', report.mostFailedDrivers);
        }
        
        this.log('info', '=== End Request Metrics Report ===');
        
        return report;
    },
    
    // Log detailed request performance data
    logRequestPerformance(requestRecord, responseData) {
        if (!this.config.enableDetailedLogging) return;
        
        const details = {
            driver: requestRecord.driverName,
            requestId: requestRecord.requestId,
            type: requestRecord.requestType,
            responseTime: requestRecord.responseTime.toFixed(2) + 'ms',
            cached: requestRecord.isCached,
            concurrent: requestRecord.concurrentCount,
            retries: requestRecord.retryCount,
            timestamp: new Date().toISOString(),
            dataSize: responseData ? JSON.stringify(responseData).length : 0
        };
        
        this.log('debug', 'Request Performance Details:', details);
    },
    
    // Get success rate percentage
    getSuccessRate() {
        const total = this.metrics.requests.total;
        if (total === 0) return '0%';
        
        const successRate = (this.metrics.requests.successful / total) * 100;
        return successRate.toFixed(1) + '%';
    },
    
    // Get top drivers by request count
    getTopDriversByRequests(limit = 5) {
        return Array.from(this.metrics.driverMetrics.entries())
            .sort((a, b) => b[1].requests - a[1].requests)
            .slice(0, limit)
            .map(([driverName, metrics]) => ({
                driver: driverName,
                requests: metrics.requests,
                successRate: metrics.requests > 0 ? ((metrics.successes / metrics.requests) * 100).toFixed(1) + '%' : '0%',
                averageTime: metrics.averageResponseTime.toFixed(2) + 'ms'
            }));
    },
    
    // Get slowest drivers by average response time
    getSlowestDrivers(limit = 5) {
        return Array.from(this.metrics.driverMetrics.entries())
            .filter(([_, metrics]) => metrics.successes > 0)
            .sort((a, b) => b[1].averageResponseTime - a[1].averageResponseTime)
            .slice(0, limit)
            .map(([driverName, metrics]) => ({
                driver: driverName,
                averageTime: metrics.averageResponseTime.toFixed(2) + 'ms',
                requests: metrics.requests,
                successRate: ((metrics.successes / metrics.requests) * 100).toFixed(1) + '%'
            }));
    },
    
    // Get drivers with most failures
    getMostFailedDrivers(limit = 5) {
        return Array.from(this.metrics.driverMetrics.entries())
            .filter(([_, metrics]) => metrics.failures > 0)
            .sort((a, b) => b[1].failures - a[1].failures)
            .slice(0, limit)
            .map(([driverName, metrics]) => ({
                driver: driverName,
                failures: metrics.failures,
                requests: metrics.requests,
                failureRate: ((metrics.failures / metrics.requests) * 100).toFixed(1) + '%'
            }));
    },
    
    // Start periodic metrics reporting
    startPeriodicReporting() {
        this.reportingInterval = setInterval(() => {
            if (this.metrics.requests.total > 0) {
                this.logMetricsReport();
            }
        }, this.config.metricsReportInterval);
        
        this.log('info', `RequestMetricsLogger: Started periodic reporting every ${this.config.metricsReportInterval / 1000} seconds`);
    },
    
    // Stop periodic reporting
    stopPeriodicReporting() {
        if (this.reportingInterval) {
            clearInterval(this.reportingInterval);
            this.reportingInterval = null;
            this.log('info', 'RequestMetricsLogger: Stopped periodic reporting');
        }
    },
    
    // Categorize errors for metrics
    categorizeError(error) {
        if (!error) return 'unknown';
        
        if (error.name === 'TypeError' && error.message && error.message.includes('fetch')) {
            return 'network';
        }
        
        if (error.name === 'AbortError' || (error.message && error.message.includes('timeout'))) {
            return 'timeout';
        }
        
        if (error.status && (error.status >= 400 && error.status < 600)) {
            return 'api';
        }
        
        if (error instanceof SyntaxError || (error.message && error.message.includes('JSON'))) {
            return 'data';
        }
        
        return 'unknown';
    },
    
    // Generate unique request ID
    generateRequestId(driverName) {
        return `${driverName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },
    
    // Trim request history to prevent memory issues
    trimRequestHistory() {
        if (this.requestHistory.length > this.config.maxHistorySize) {
            this.requestHistory = this.requestHistory.slice(-this.config.maxHistorySize);
        }
    },
    
    // Logging with levels
    log(level, message, data = null) {
        if (!this.config.enableLogging) return;
        
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        const configLevel = levels[this.config.logLevel] || 1;
        
        if (levels[level] >= configLevel) {
            const timestamp = new Date().toISOString();
            const prefix = `[${timestamp}] RequestMetricsLogger [${level.toUpperCase()}]:`;
            
            if (data) {
                console[level](prefix, message, data);
            } else {
                console[level](prefix, message);
            }
        }
    },
    
    // Reset all metrics
    resetMetrics() {
        this.metrics = {
            requests: {
                total: 0,
                successful: 0,
                failed: 0,
                cached: 0,
                concurrent: 0,
                individual: 0,
                batch: 0
            },
            
            timing: {
                totalResponseTime: 0,
                averageResponseTime: 0,
                minResponseTime: Infinity,
                maxResponseTime: 0,
                responseTimes: [],
                
                individualRequests: {
                    count: 0,
                    totalTime: 0,
                    averageTime: 0,
                    minTime: Infinity,
                    maxTime: 0
                },
                
                batchRequests: {
                    count: 0,
                    totalTime: 0,
                    averageTime: 0,
                    minTime: Infinity,
                    maxTime: 0
                },
                
                performanceImprovement: 0
            },
            
            concurrency: {
                maxConcurrent: 0,
                currentConcurrent: 0,
                averageConcurrent: 0,
                concurrencyHistory: [],
                queuedRequests: 0,
                peakQueueSize: 0
            },
            
            driverMetrics: new Map(),
            
            errors: {
                network: 0,
                timeout: 0,
                api: 0,
                data: 0,
                unknown: 0,
                retries: 0
            },
            
            cache: {
                hits: 0,
                misses: 0,
                hitRate: 0,
                totalCacheChecks: 0
            },
            
            session: {
                startTime: Date.now(),
                totalDriversProcessed: 0,
                uniqueDriversProcessed: new Set(),
                pagesProcessed: 0,
                requestBatches: 0
            }
        };
        
        this.requestHistory = [];
        this.comparisonData = {
            individualVsBatch: [],
            cacheVsApi: [],
            concurrentVsSequential: []
        };
        
        this.log('info', 'RequestMetricsLogger: All metrics reset');
    },
    
    // Register cleanup handlers
    registerCleanupHandlers() {
        // Generate final report on page unload
        window.addEventListener('beforeunload', () => {
            this.log('info', 'Page unloading - generating final metrics report');
            this.logMetricsReport();
            this.stopPeriodicReporting();
        });
        
        // Handle visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.log('info', 'Page hidden - pausing metrics logging');
            } else {
                this.log('info', 'Page visible - resuming metrics logging');
            }
        });
    },
    
    // Export metrics to JSON
    exportMetrics() {
        const snapshot = {
            timestamp: new Date().toISOString(),
            version: '1.0',
            config: this.config,
            metrics: {
                ...this.metrics,
                driverMetrics: Array.from(this.metrics.driverMetrics.entries()),
                session: {
                    ...this.metrics.session,
                    uniqueDriversProcessed: Array.from(this.metrics.session.uniqueDriversProcessed)
                }
            },
            requestHistory: this.requestHistory.slice(-100), // Last 100 requests
            comparisonData: this.comparisonData,
            report: this.generateMetricsReport()
        };
        
        return JSON.stringify(snapshot, null, 2);
    },
    
    // Get current metrics snapshot
    getMetricsSnapshot() {
        return {
            ...this.metrics,
            driverMetrics: Array.from(this.metrics.driverMetrics.entries()),
            session: {
                ...this.metrics.session,
                uniqueDriversProcessed: Array.from(this.metrics.session.uniqueDriversProcessed)
            }
        };
    },
    
    // Cleanup and finalize
    cleanup() {
        this.log('info', 'RequestMetricsLogger: Cleaning up metrics logger');
        this.stopPeriodicReporting();
        this.logMetricsReport();
        this.log('info', 'RequestMetricsLogger: Cleanup completed');
    }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.RequestMetricsLogger = RequestMetricsLogger;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RequestMetricsLogger };
}