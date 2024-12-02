const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const User = require('../models/users');

// Middleware to check product access
const checkProductAccess = async (req, res, next) => {
    try {
        const product = await Product.findById(req.params.productId);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const userId = req.user._id; // Assuming you have authentication middleware
        const accessCheck = await product.checkAndUpdateUsage(userId);
        
        if (!accessCheck.allowed) {
            return res.status(403).json({ message: accessCheck.message });
        }

        req.product = product;
        req.remainingUsage = accessCheck.remainingUsage;
        next();
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get all products with pagination
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 10, category } = req.query;
        const skip = (page - 1) * limit;
        const pageNum = Number(page);
        const limitNum = Number(limit);

        const filter = {};
        if (category) {
            filter.category = { $in: Array.isArray(category) ? category : [category] };
        }

        const products = await Product.find(filter)
            .populate('userAccess.userId', 'name email')
            .skip(skip)
            .limit(limitNum)
            .exec();

        const totalCount = await Product.countDocuments(filter);

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
        description: req.body.description,
        promptLimit: req.body.promptLimit,
        accessPeriodDays: req.body.accessPeriodDays,
        pages: req.body.pages,
        category: Array.isArray(req.body.category) ? req.body.category : [req.body.category],
        userAccess: []
    });

    try {
        const newProduct = await product.save();
        res.status(201).json(newProduct);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Update a product
router.patch('/:id', checkProductAccess, async (req, res) => {
    try {
        if (req.body.name != null) {
            req.product.name = req.body.name;
        }
        if (req.body.description != null) {
            req.product.description = req.body.description;
        }
        if (req.body.promptLimit != null) {
            req.product.promptLimit = req.body.promptLimit;
        }
        if (req.body.accessPeriodDays != null) {
            req.product.accessPeriodDays = req.body.accessPeriodDays;
        }
        if (req.body.pages != null) {
            req.product.pages = req.body.pages;
        }
        if (req.body.category != null) {
            req.product.category = Array.isArray(req.body.category)
                ? req.body.category
                : [req.body.category];
        }

        if (req.body.addCategories) {
            const categoriesToAdd = Array.isArray(req.body.addCategories)
                ? req.body.addCategories
                : [req.body.addCategories];
            req.product.category = [...new Set([...req.product.category, ...categoriesToAdd])];
        }

        if (req.body.removeCategories) {
            const categoriesToRemove = Array.isArray(req.body.removeCategories)
                ? req.body.removeCategories
                : [req.body.removeCategories];
            req.product.category = req.product.category.filter(
                cat => !categoriesToRemove.includes(cat)
            );
        }

        const updatedProduct = await req.product.save();
        res.json(updatedProduct);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Get a specific product
router.get('/:id', checkProductAccess, async (req, res) => {
    try {
        const product = await Product.findById(req.params.id)
            .populate('userAccess.userId', 'name email');

        if (req.query.userId) {
            const userAccess = product.userAccess.find(
                access => access.userId._id.toString() === req.query.userId
            );

            const productData = product.toObject();
            productData.userAccessInfo = userAccess ? {
                startDate: userAccess.startDate,
                endDate: userAccess.endDate,
                isActive: userAccess.endDate > new Date(),
                remainingDays: Math.ceil((userAccess.endDate - new Date()) / (1000 * 60 * 60 * 24))
            } : null;

            return res.json(productData);
        }

        res.json(product);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Grant access to a user
router.post('/:id/grant-access', checkProductAccess, async (req, res) => {
    const userId = req.body.userId;
    const accessPeriodDays = req.body.accessPeriodDays || req.product.accessPeriodDays;

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Calculate access period
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + accessPeriodDays);

        // Check if user already has access
        const existingAccess = req.product.userAccess.find(
            access => access.userId.toString() === userId.toString()
        );

        if (existingAccess) {
            existingAccess.startDate = startDate;
            existingAccess.endDate = endDate;
            existingAccess.usageCount = 0; // Reset usage count
        } else {
            req.product.userAccess.push({
                userId,
                startDate,
                endDate,
                usageCount: 0
            });
        }

        await req.product.save();
        res.json({ message: 'Access granted successfully', product: req.product });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get user's access status and usage for a product
router.get('/:id/access-status', checkProductAccess, async (req, res) => {
    try {
        const userId = req.user._id; // Assuming you have authentication middleware
        const userAccess = req.product.userAccess.find(
            access => access.userId.toString() === userId.toString()
        );

        if (!userAccess) {
            return res.status(403).json({ message: 'No access to this product' });
        }

        res.json({
            productId: req.product._id,
            productName: req.product.name,
            accessStatus: {
                startDate: userAccess.startDate,
                endDate: userAccess.endDate,
                usageCount: userAccess.usageCount,
                remainingUsage: req.product.promptLimit - userAccess.usageCount,
                lastUsed: userAccess.lastUsed
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Check user's access status for a product
router.get('/:id/check-access/:userId', checkProductAccess, async (req, res) => {
    try {
        const product = await Product.findById(req.params.id)
            .populate('userAccess.userId', 'name email');

        const userAccess = product.userAccess.find(
            access => access.userId._id.toString() === req.params.userId
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
            user: userAccess.userId,
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

// Delete a product
router.delete('/:id', checkProductAccess, async (req, res) => {
    try {
        await User.updateMany(
            { products: req.product._id },
            { $pull: { products: req.product._id } }
        );

        await req.product.deleteOne();
        res.json({ message: 'Product deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error deleting product: ' + err.message });
    }
});

// Remove user access from a product
router.delete('/:id/remove-access/:userId', checkProductAccess, async (req, res) => {
    const userId = req.params.userId;

    try {
        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if user has access to the product
        const existingAccess = req.product.userAccess.find(
            access => access.userId.toString() === userId
        );

        if (!existingAccess) {
            return res.status(400).json({ message: 'User does not have access to this product' });
        }

        // Remove access from product
        req.product.userAccess = req.product.userAccess.filter(
            access => access.userId.toString() !== userId
        );

        // Remove product from user's products array
        await User.findByIdAndUpdate(userId, {
            $pull: { products: req.product._id }
        });

        // Save the updated product
        await req.product.save();

        const updatedProduct = await Product.findById(req.product._id)
            .populate('userAccess.userId', 'name email');

        res.json({
            message: 'Access removed successfully',
            product: updatedProduct
        });
    } catch (err) {
        console.error("Error in remove-access:", err);
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;