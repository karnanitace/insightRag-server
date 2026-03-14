/**
 * Global error-handling middleware.
 * Express recognises a 4-argument function as an error handler.
 */
export const errorHandler = (err, _req, res, _next) => {
    console.error('❌ Error:', err.stack || err.message);

    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        success: false,
        message: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
};
