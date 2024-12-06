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
    });

    try {
        const newProduct = await product.save();
        res.status(201).json(newProduct);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Update a product
router.patch('/:id', async (req, res) => {
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
router.get('/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id)
            .populate('userAccess.userId', 'name email');

        res.json(product);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Delete a product
router.delete('/:id', async (req, res) => {
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
module.exports = router;