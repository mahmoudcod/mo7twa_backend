const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const User = require('../models/users');

// Get all products with pagination
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 10, category } = req.query;
        const skip = (page - 1) * limit;
        const pageNum = Number(page);
        const limitNum = Number(limit);

        // Build query filter
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

// Get a specific product
router.get('/:id', getProduct, async (req, res) => {
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

// Update a product
router.patch('/:id', getProduct, async (req, res) => {
    try {
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
            // Ensure category is always an array
            res.product.category = Array.isArray(req.body.category)
                ? req.body.category
                : [req.body.category];
        }

        // Handle category operations if provided
        if (req.body.addCategories) {
            const categoriesToAdd = Array.isArray(req.body.addCategories)
                ? req.body.addCategories
                : [req.body.addCategories];
            res.product.category = [...new Set([...res.product.category, ...categoriesToAdd])];
        }

        if (req.body.removeCategories) {
            const categoriesToRemove = Array.isArray(req.body.removeCategories)
                ? req.body.removeCategories
                : [req.body.removeCategories];
            res.product.category = res.product.category.filter(
                cat => !categoriesToRemove.includes(cat)
            );
        }

        const updatedProduct = await res.product.save();
        res.json(updatedProduct);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Grant user access to a product
router.post('/:id/grant-access', getProduct, async (req, res) => {
    const userId = req.body.userId;

    try {
        const user = await User.findById(userId).populate('products');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const existingAccess = res.product.userAccess.find(
            access => access.userId.toString() === userId
        );

        if (existingAccess) {
            return res.status(400).json({ message: 'User already has access to this product' });
        }

        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + res.product.accessPeriodDays);

        res.product.userAccess.push({
            userId: userId,
            startDate: startDate,
            endDate: endDate
        });

        if (!user.products.some(p => p._id.toString() === res.product._id.toString())) {
            user.products.push(res.product._id);
        }

        await Promise.all([
            res.product.save(),
            user.save()
        ]);

        const updatedProduct = await Product.findById(res.product._id)
            .populate('userAccess.userId', 'name email');

        res.json({
            message: 'Access granted successfully',
            product: updatedProduct,
            accessPeriod: {
                startDate,
                endDate,
                daysRemaining: res.product.accessPeriodDays
            }
        });
    } catch (err) {
        console.error("Error in grant-access:", err);
        res.status(500).json({ message: err.message });
    }
});

// Check user's access status for a product
router.get('/:id/check-access/:userId', getProduct, async (req, res) => {
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
router.delete('/:id', getProduct, async (req, res) => {
    try {
        await User.updateMany(
            { products: res.product._id },
            { $pull: { products: res.product._id } }
        );

        await res.product.deleteOne();
        res.json({ message: 'Product deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Error deleting product: ' + err.message });
    }
});

async function getProduct(req, res, next) {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.product = product;
        next();
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

module.exports = router;