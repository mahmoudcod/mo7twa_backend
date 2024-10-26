
// routes/products.js
const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const User = require('../models/users');

// Get all products with pagination
router.get('/', async (req, res) => {
    try {
        // Get page and limit from query parameters, set defaults
        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        // Convert to numbers
        const pageNum = Number(page);
        const limitNum = Number(limit);

        // Get paginated products
        const products = await Product.find()
            .skip(skip)
            .limit(limitNum)
            // Add any needed populate() calls here
            .populate('category')
            .populate('pages')
            .exec();

        // Get total count for pagination
        const totalCount = await Product.countDocuments();

        // Send paginated response
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
        expirationDate: req.body.expirationDate,
        pages: req.body.pages,
        category: req.body.category
    });

    try {
        const newProduct = await product.save();
        res.status(201).json(newProduct);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Get a specific product
router.get('/:id', getProduct, (req, res) => {
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
    if (req.body.expirationDate != null) {
        res.product.expirationDate = req.body.expirationDate;
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

// Delete a product
router.delete('/:id', getProduct, async (req, res) => {
    try {
        await res.product.remove();
        res.json({ message: 'Product deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
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

        if (!res.product.users.includes(userId)) {
            res.product.users.push(userId);
            user.products.push(res.product._id);
            await res.product.save();
            await user.save();
        }

        res.json({ message: 'Access granted to user' });
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
