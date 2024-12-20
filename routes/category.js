// Category Routes (categories.js)
const express = require('express');
const Category = require('../models/category');
const Subcategory = require('../models/sub');
const Page = require('../models/page');
const Product = require('../models/Product');
const router = express.Router();

// Create Category
router.post('/', async (req, res) => {
    try {
        const { pages, ...categoryData } = req.body;  // Extract pages and other category data

        // 1. Create the category
        const newCategory = await Category.create(categoryData);

        // 2. If there are pages to link, update their 'categories' field
        if (pages && pages.length > 0) {
            await Page.updateMany(
                { _id: { $in: pages } },
                { $push: { categories: newCategory._id } }  // Push the new category to the pages
            );
        }

        // 3. Optionally populate the new category with pages and subcategories
        const populatedCategory = await Category.findById(newCategory._id)
            .populate('subcategories')
            .populate('pages');

        res.status(201).json(populatedCategory);
    } catch (error) {
        res.status(500).json({ message: 'Error creating category', error });
    }
});

// Get All Categories with Pagination
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const totalCount = await Category.countDocuments();
        const categories = await Category.find()
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
        res.status(500).json({ message: 'Error fetching categories', error });
    }
});

//update category
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { removedPages, addedPages } = req.body; // Assume we pass pages to add and remove

        // 1. Find and update the category with new pages
        const updatedCategory = await Category.findByIdAndUpdate(id, req.body, { new: true })
            .populate('subcategories')
            .populate('pages');

        // 2. Remove the category reference from the removed pages
        if (removedPages && removedPages.length > 0) {
            await Page.updateMany(
                { _id: { $in: removedPages } },
                { $pull: { categories: id } }  // Pull the category from the pages
            );
        }

        // 3. Add the category reference to the added pages
        if (addedPages && addedPages.length > 0) {
            await Page.updateMany(
                { _id: { $in: addedPages } },
                { $push: { categories: id } }  // Push the category to the pages
            );
        }

        res.status(200).json(updatedCategory);
    } catch (error) {
        res.status(500).json({ message: 'Error updating category', error });
    }
});


// Delete Category
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const category = await Category.findById(id);

        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }

        // Update pages to remove category reference
        await Page.updateMany({ categories: id }, { $pull: { categories: id } });

        // Delete subcategories
        await Subcategory.deleteMany({ category: id });

        // Remove category from products
        await Product.updateMany(
            { category: id },
            { $pull: { category: id } }
        );

        await Category.findByIdAndDelete(id);
        res.status(200).json({ message: 'Category deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting category', error });
    }
});

// Get Single Category by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const category = await Category.findById(id)
            .populate('subcategories')
            .populate('pages');
        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }
        res.status(200).json(category);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching category', error });
    }
});

// Create Subcategory
router.post('/:categoryId/subcategory', async (req, res) => {
    try {
        const { categoryId } = req.params;
        const subcategory = new Subcategory({ ...req.body, category: categoryId });
        await subcategory.save();
        const category = await Category.findById(categoryId);
        category.subcategories.push(subcategory._id);
        await category.save();
        res.status(201).json(subcategory);
    } catch (error) {
        res.status(500).json({ message: 'Error creating subcategory', error });
    }
});

module.exports = router;
