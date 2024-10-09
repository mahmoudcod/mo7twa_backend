const express = require('express');
const Category = require('../models/category');
const Subcategory = require('../models/subcategory');
const router = express.Router();

// Create Category
router.post('/', async (req, res) => {
    try {
        const category = new Category(req.body);
        await category.save();
        res.status(201).json(category);
    } catch (error) {
        res.status(500).json({ message: 'Error creating category', error });
    }
});

// Get All Categories
router.get('/', async (req, res) => {
    try {
        const categories = await Category.find().populate('subcategories');
        res.status(200).json(categories);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching categories', error });
    }
});

// Update Category
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updatedCategory = await Category.findByIdAndUpdate(id, req.body, { new: true });
        res.status(200).json(updatedCategory);
    } catch (error) {
        res.status(500).json({ message: 'Error updating category', error });
    }
});

// Delete Category
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await Category.findByIdAndDelete(id);
        res.status(200).json({ message: 'Category deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting category', error });
    }
});

// Create Subcategory
router.post('/:categoryId/subcategory', async (req, res) => {
    try {
        const { categoryId } = req.params;
        const subcategory = new Subcategory({ ...req.body, category: categoryId });
        await subcategory.save();

        // Add subcategory to parent category
        const category = await Category.findById(categoryId);
        category.subcategories.push(subcategory._id);
        await category.save();

        res.status(201).json(subcategory);
    } catch (error) {
        res.status(500).json({ message: 'Error creating subcategory', error });
    }
});

module.exports = router;
