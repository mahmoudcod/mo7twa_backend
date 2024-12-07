// Category Routes (categories.js)
const express = require('express');
const Category = require('../models/category');
const Subcategory = require('../models/sub');
const Page = require('../models/page');
const User = require('../models/users');
const Product = require('../models/Product');
const router = express.Router();
const jwt = require('jsonwebtoken');

// Middleware to check if user is admin
// Middleware to check if user is admin
const isAdmin = async (req, res, next) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findOne({ _id: decoded.id, isAdmin: true });

        if (!user) {
            throw new Error();
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).send({ error: 'Please authenticate as admin.' });
    }
};


// Middleware to check category access for reading
const checkCategoryAccess = async (req, res, next) => {
    try {
        // First authenticate the user
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            return res.status(401).json({ message: 'No authentication token provided' });
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findOne({ _id: decoded.id });

        if (!user) {
            return res.status(401).json({ message: 'Authentication failed' });
        }

        req.user = user;

        const categoryId = req.params.categoryId || req.params.id;
        const category = await Category.findById(categoryId);
        
        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }

        // If user is admin, grant access
        if (user.isAdmin) {
            req.category = category;
            return next();
        }

        // For regular users, check if they have access through their products
        const userActiveProductIds = user.productAccess
            .filter(access => access.isActive)
            .map(access => access.productId);

        const product = await Product.findOne({
            _id: { $in: userActiveProductIds },
            category: category.name
        });

        if (!product) {
            return res.status(403).json({ 
                message: 'Access denied. This category is not included in any of your active products.'
            });
        }

        req.category = category;
        next();
    } catch (error) {
        console.error('Error in checkCategoryAccess:', error);
        res.status(401).json({ message: 'Authentication failed', error: error.message });
    }
};

// Create Category (Admin Only)
router.post('/', isAdmin, async (req, res) => {
    try {
        const { pages, ...categoryData } = req.body;
        const newCategory = await Category.create(categoryData);

        if (pages && pages.length > 0) {
            await Page.updateMany(
                { _id: { $in: pages } },
                { $push: { categories: newCategory._id } }
            );
        }

        const populatedCategory = await Category.findById(newCategory._id)
            .populate('subcategories')
            .populate('pages');

        res.status(201).json(populatedCategory);
    } catch (error) {
        console.error('Error creating category:', error);
        res.status(500).json({ message: 'Error creating category', error: error.message });
    }
});

// Get All Categories (Filtered by user's product access)
router.get('/', async (req, res) => {
    try {
        // First authenticate the user
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            return res.status(401).json({ message: 'No authentication token provided' });
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findOne({ _id: decoded.id });

        if (!user) {
            return res.status(401).json({ message: 'Authentication failed' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        let categoryQuery = {};

        // If not admin, filter categories based on user's product access
        if (!user.isAdmin) {
            const userActiveProductIds = user.productAccess
                .filter(access => access.isActive)
                .map(access => access.productId);

            const products = await Product.find({
                _id: { $in: userActiveProductIds }
            });

            const accessibleCategories = [...new Set(products.flatMap(product => product.category))];
            categoryQuery.name = { $in: accessibleCategories };
        }

        const totalCount = await Category.countDocuments(categoryQuery);
        const categories = await Category.find(categoryQuery)
            .populate('subcategories')
            .populate('pages')
            .skip(skip)
            .limit(limit);

        res.status(200).json({
            categories,
            totalCount,
            currentPage: page,
            totalPages: Math.ceil(totalCount / limit)
        });
    } catch (error) {
        console.error('Error in get categories:', error);
        res.status(401).json({ message: 'Authentication failed', error: error.message });
    }
});

// Get Single Category
router.get('/:id', checkCategoryAccess, async (req, res) => {
    try {
        const category = await Category.findById(req.params.id)
            .populate('subcategories')
            .populate('pages');
        res.status(200).json(category);
    } catch (error) {
        console.error('Error fetching category:', error);
        res.status(500).json({ message: 'Error fetching category', error: error.message });
    }
});

// Update Category (Admin Only)
router.put('/:id', isAdmin, async (req, res) => {
    try {
        const updatedCategory = await Category.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        ).populate('subcategories').populate('pages');

        if (!updatedCategory) {
            return res.status(404).json({ message: 'Category not found' });
        }

        res.status(200).json(updatedCategory);
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({ message: 'Error updating category', error: error.message });
    }
});

// Delete Category (Admin Only)
router.delete('/:id', isAdmin, async (req, res) => {
    try {
        const deletedCategory = await Category.findByIdAndDelete(req.params.id);
        if (!deletedCategory) {
            return res.status(404).json({ message: 'Category not found' });
        }

        // Remove category reference from pages
        await Page.updateMany(
            { categories: deletedCategory._id },
            { $pull: { categories: deletedCategory._id } }
        );

        res.status(200).json({ message: 'Category deleted successfully' });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ message: 'Error deleting category', error: error.message });
    }
});

// Create Subcategory (Admin Only)
router.post('/:categoryId/subcategory', isAdmin, async (req, res) => {
    try {
        const { categoryId } = req.params;
        const subcategory = new Subcategory({ ...req.body, category: categoryId });
        await subcategory.save();

        // Update the parent category
        await Category.findByIdAndUpdate(categoryId, {
            $push: { subcategories: subcategory._id }
        });

        res.status(201).json(subcategory);
    } catch (error) {
        console.error('Error creating subcategory:', error);
        res.status(500).json({ message: 'Error creating subcategory', error: error.message });
    }
});

module.exports = router;