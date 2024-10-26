const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const User = require('../models/users');


// Get all products with pagination
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;
        const pageNum = Number(page);
        const limitNum = Number(limit);

        const products = await Product.find()
            .skip(skip)
            .limit(limitNum)
            .exec();

        const totalCount = await Product.countDocuments();

        res.json({
            products,
            currentPage: pageNum,
            totalPages: Math.ceil(totalCount / limitNum),
            totalCount,
            hasNextPage: pageNum * limitNum < totalCount,
            hasPrevPage: pageNum > 1
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Create a new product
router.post('/', async (req, res) => {
    const product = new Product({
        name: req.body.name,
        promptLimit: req.body.promptLimit,
        accessPeriodDays: req.body.accessPeriodDays, // New field instead of expirationDate
        pages: req.body.pages,
        category: req.body.category,
        userAccess: [] // Array to store user-specific access periods
    });

    try {
        const newProduct = await product.save();
        res.status(201).json(newProduct);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Get a specific product
router.get('/:id', getProduct, async (req, res) => {
    // If user ID is provided, include their specific access information
    const userId = req.query.userId;
    if (userId) {
        const userAccess = res.product.userAccess.find(
            access => access.userId.toString() === userId
        );

        const productData = res.product.toObject();
        productData.userAccessInfo = userAccess ? {
            startDate: userAccess.startDate,
            endDate: userAccess.endDate,
            isActive: userAccess.endDate > new Date(),
            remainingDays: Math.ceil((userAccess.endDate - new Date()) / (1000 * 60 * 60 * 24))
        } : null;

        return res.json(productData);
    }

    res.json(res.product);
});

// Update a product
router.patch('/:id', getProduct, async (req, res) => {
    if (req.body.name != null) {
        res.product.name = req.body.name;
    }
    if (req.body.promptLimit != null) {
        res.product.promptLimit = req.body.promptLimit;
    }
    if (req.body.accessPeriodDays != null) {
        res.product.accessPeriodDays = req.body.accessPeriodDays;
    }
    if (req.body.pages != null) {
        res.product.pages = req.body.pages;
    }
    if (req.body.category != null) {
        res.product.category = req.body.category;
    }

    try {
        const updatedProduct = await res.product.save();
        res.json(updatedProduct);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});
// Delete a specific product
router.delete('/:id', getProduct, async (req, res) => {
    try {
        await res.product.remove(); // Delete the product found by middleware
        res.json({ message: 'Product deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error deleting product: ' + err.message });
    }
});


// Grant user access to a product
router.post('/:id/grant-access', getProduct, async (req, res) => {
    const userId = req.body.userId;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if user already has access
        const existingAccess = res.product.userAccess.find(
            access => access.userId.toString() === userId
        );

        if (existingAccess) {
            return res.status(400).json({ message: 'User already has access to this product' });
        }

        // Calculate access period
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + res.product.accessPeriodDays);

        // Add user access record
        res.product.userAccess.push({
            userId: userId,
            startDate: startDate,
            endDate: endDate
        });

        // Add product to user's products array if not already there
        if (!user.products.includes(res.product._id)) {
            user.products.push(res.product._id);
        }

        await res.product.save();
        await user.save();

        res.json({
            message: 'Access granted to user',
            accessPeriod: {
                startDate,
                endDate,
                daysRemaining: res.product.accessPeriodDays
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Check user's access status for a product
router.get('/:id/check-access/:userId', getProduct, async (req, res) => {
    try {
        const userAccess = res.product.userAccess.find(
            access => access.userId.toString() === req.params.userId
        );

        if (!userAccess) {
            return res.json({
                hasAccess: false,
                message: 'User does not have access to this product'
            });
        }

        const now = new Date();
        const isActive = userAccess.endDate > now;
        const remainingDays = Math.ceil((userAccess.endDate - now) / (1000 * 60 * 60 * 24));

        res.json({
            hasAccess: isActive,
            startDate: userAccess.startDate,
            endDate: userAccess.endDate,
            remainingDays: isActive ? remainingDays : 0,
            message: isActive ?
                `Access active with ${remainingDays} days remaining` :
                'Access period has expired'
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Middleware function to get a product by ID
async function getProduct(req, res, next) {
    let product;
    try {
        product = await Product.findById(req.params.id);
        if (product == null) {
            return res.status(404).json({ message: 'Product not found' });
        }
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
    res.product = product;
    next();
}

module.exports = router;