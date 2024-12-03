const User = require('../models/users');
const Product = require('../models/Product');

const pageAccess = async (req, res, next) => {
    try {
        // Check if user is authenticated and get user data
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        // If user is admin, allow access
        if (req.user.role === 'admin') {
            return next();
        }

        // For GET requests, productId is optional
        if (req.method === 'GET') {
            return next();
        }

        // Get the product ID from the request
        const productId = req.body.productId || req.query.productId;
        if (!productId) {
            return res.status(400).json({ 
                message: 'Product ID is required',
                error: 'No product ID provided in the request'
            });
        }

        // Find the product
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Check if user owns the product
        const userId = req.user._id;
        const accessCheck = await product.checkAndUpdateUsage(userId);
        
        if (!accessCheck.allowed) {
            return res.status(403).json({ 
                message: accessCheck.message || 'Access denied. Product usage limit reached or expired.'
            });
        }

        // If all checks pass, allow access
        next();
    } catch (error) {
        console.error('Page access middleware error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports = pageAccess;
