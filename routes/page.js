const express = require('express');
const Page = require('../models/page');
const User = require('../models/users');
const Category = require('../models/category'); // Assuming you have a Category model
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { Configuration, OpenAIApi } = require("openai");
const jwt = require('jsonwebtoken');
const fs = require('fs');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;




// Middleware to authenticate user
const authenticateUser = async (req, res, next) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findOne({ _id: decoded.id });

        if (!user) {
            throw new Error();
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).send({ error: 'Please authenticate.' });
    }
};

// Helper function to extract text from various file types
async function extractTextFromFile(file) {
    const fileExtension = file.originalname.split('.').pop().toLowerCase();
    let text = '';

    switch (fileExtension) {
        case 'txt':
            text = fs.readFileSync(file.path, 'utf8');
            break;
        case 'pdf':
            const dataBuffer = fs.readFileSync(file.path);
            const pdfData = await pdf(dataBuffer);
            text = pdfData.text;
            break;
        case 'docx':
            const result = await mammoth.extractRawText({ path: file.path });
            text = result.value;
            break;
        default:
            throw new Error('Unsupported file type');
    }

    return text;
}

// Create page
router.post('/', authenticateUser, upload.single('image'), async (req, res) => {
    try {
        const { name, description, category, instructions } = req.body;

        let imageUrl = null;
        if (req.file) {
            const result = await cloudinary.uploader.upload(req.file.path);
            imageUrl = result.secure_url;
        }

        // Validate categories
        const categoryIds = Array.isArray(category) ? category : [category];
        const validCategories = await Category.find({ _id: { $in: categoryIds } });

        if (validCategories.length !== categoryIds.length) {
            return res.status(400).json({ message: 'One or more invalid categories' });
        }

        const page = new Page({
            name,
            description,
            category: validCategories.map(cat => cat._id),
            userInstructions: instructions,
            image: imageUrl,
            user: req.user._id
        });
        await page.save();

        // Add page to each category
        await Promise.all(validCategories.map(category =>
            Category.findByIdAndUpdate(category._id, { $push: { pages: page._id } })
        ));

        res.status(201).json(page);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ message: 'Error creating page', error: error.message });
    }
});
// clone page
router.post('/:id/clone', authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;

        // Fetch the page to be cloned
        const originalPage = await Page.findById(id).populate('category');

        if (!originalPage) {
            return res.status(404).json({ message: 'Page to clone not found' });
        }

        // Generate a base name for cloning
        const baseName = originalPage.name.replace(/ c\d+$/, ''); // Remove any existing clone suffix
        const regex = new RegExp(`^${baseName} c(\\d+)$`); // Match names like 'PageName c<number>'
        const allPages = await Page.find({ name: { $regex: regex } });

        // Determine the next suffix
        let maxSuffix = 0;
        allPages.forEach(page => {
            const match = page.name.match(regex);
            if (match && match[1]) {
                maxSuffix = Math.max(maxSuffix, parseInt(match[1]));
            }
        });

        const nextSuffix = maxSuffix + 1;
        const newName = `${baseName} c${nextSuffix}`;

        // Create a cloned page
        const clonedPage = new Page({
            name: newName,
            description: originalPage.description,
            category: originalPage.category.map(cat => cat._id), // Keep the same categories
            userInstructions: originalPage.userInstructions,
            image: originalPage.image, // Use the same image
            user: req.user._id, // Associate with the user performing the clone
            status: originalPage.status // Preserve publish/draft status
        });

        await clonedPage.save();

        // Add the cloned page to associated categories
        await Promise.all(
            originalPage.category.map(category =>
                Category.findByIdAndUpdate(category._id, { $push: { pages: clonedPage._id } })
            )
        );

        res.status(201).json(clonedPage);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ message: 'Error cloning page', error: error.message });
    }
});




// Generate AI response for user input and optional file
router.post('/generate', authenticateUser, upload.single('file'), async (req, res) => {
    try {
        let userInput = req.body.userInput || '';

        // If a file is uploaded, extract text from it
        if (req.file) {
            const extractedText = await extractTextFromFile(req.file);
            userInput += ` ${extractedText}`; // Append extracted text to user input
        }

        const instructions = req.body.instructions;

        if (!userInput) {
            return res.status(400).json({ message: 'No user input provided' });
        }

        // Send request to OpenAI API
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini-2024-07-18", // Specify your model
            messages: [
                { role: "system", content: instructions || "You are a helpful assistant." },
                { role: "user", content: userInput }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, // Pass OpenAI API key
                'Content-Type': 'application/json'
            }
        });

        const aiOutput = response.data.choices[0].message.content;

        // Save AI interaction
        const aiInteraction = {
            user: req.user._id,
            userInput,
            aiOutput
        };

        // Save interaction in User model
        await User.findByIdAndUpdate(req.user._id, { $push: { aiInteractions: aiInteraction } });

        res.status(200).json({ userInput, aiOutput });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ message: 'Error processing AI request', error: error.message });
    }
});

// Get all pages for a user
router.get('/my-pages', authenticateUser, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ message: 'Access denied. Admin only.' });
        }
        res.status(200).json(req.body)
    } catch (error) {
        res.status(500).json({ message: 'Error fetching pages', error: error.message });
    }
});

// Get All Pages with Pagination (Admin only)
router.get('/all', authenticateUser, async (req, res) => {
    try {
        if (!req.user.isAdmin) {
            return res.status(403).json({ message: 'Access denied. Admin only.' });
        }

        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        const pages = await Page.find()
            .skip(skip)
            .limit(Number(limit))
            .populate('category')
            .populate('user', 'email'); // Only populate email from user

        const totalCount = await Page.countDocuments();

        res.status(200).json({ pages, totalCount, currentPage: page, totalPages: Math.ceil(totalCount / limit) });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching pages', error: error.message });
    }
});

// Get a single page by ID
router.get('/:id', authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const page = await Page.findById(id).populate('category').populate('user', 'email');

        if (!page) {
            return res.status(404).json({ message: 'Page not found' });
        }

        // Check if the user is the owner of the page or an admin
        // if (page.user._id.toString() !== req.user._id.toString() && !req.user.isAdmin) {
        //     return res.status(403).json({ message: 'Access denied' });
        // }

        res.status(200).json(page);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ message: 'Error fetching page', error: error.message });
    }
});
// Update Page
router.put('/:id', authenticateUser, upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, category, instructions } = req.body;

        let page = await Page.findById(id).populate('category');  // Make sure to populate category for proper comparison

        if (!page) {
            return res.status(404).json({ message: 'Page not found' });
        }

        // Ensure only the user who owns the page or admin can update it
        if (page.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Handle category updates (for multiple categories)
        if (category) {
            const newCategories = Array.isArray(category) ? category : [category]; // Ensure it's an array

            // Remove page from old categories
            const oldCategories = page.category.map(cat => cat._id.toString());  // Array of old category IDs
            for (const oldCatId of oldCategories) {
                if (!newCategories.includes(oldCatId)) {
                    await Category.findByIdAndUpdate(oldCatId, { $pull: { pages: page._id } });
                }
            }

            // Add page to new categories
            for (const newCatId of newCategories) {
                if (!oldCategories.includes(newCatId)) {
                    const newCategory = await Category.findById(newCatId);
                    if (!newCategory) {
                        return res.status(400).json({ message: 'Invalid category' });
                    }
                    newCategory.pages.push(page._id);
                    await newCategory.save();
                }
            }

            // Update page category
            page.category = newCategories;
        }

        // Handle image upload with Cloudinary
        let imageUrl = page.image;
        if (req.file) {
            const result = await cloudinary.uploader.upload(req.file.path);
            imageUrl = result.secure_url;
        }

        // Update page fields
        page.name = name;
        page.description = description;
        page.userInstructions = instructions;
        page.image = imageUrl;

        // Save the updated page
        await page.save();

        // Return updated page data
        res.status(200).json(page);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ message: 'Error updating page', error: error.message });
    }
});
// Update page status (publish/draft)
router.put('/:id/status', authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        // Validate status input
        if (!status) {
            return res.status(400).json({ 
                message: 'Status is required',
                validStatuses: ['published', 'draft']
            });
        }

        const normalizedStatus = status.toLowerCase();
        if (!['published', 'draft'].includes(normalizedStatus)) {
            return res.status(400).json({ 
                message: 'Invalid status. Must be "published" or "draft"'
            });
        }

        // Find and validate page
        const page = await Page.findById(id)
            .populate('category')
            .populate('user', 'email');

        if (!page) {
            return res.status(404).json({ message: 'Page not found' });
        }

        // Check authorization
        if (page.user._id.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Validate status transition
        if (!Page.validateStatusTransition(page.status, normalizedStatus)) {
            return res.status(400).json({ 
                message: `Invalid status transition from ${page.status} to ${normalizedStatus}`
            });
        }

        // Additional validation for publishing
        if (normalizedStatus === 'published' && !page.isPublishable()) {
            return res.status(400).json({
                message: 'Cannot publish page: missing required fields'
            });
        }

        // Update status
        page.status = normalizedStatus;
        page.lastModifiedBy = req.user._id;
        await page.save();

        res.status(200).json({
            message: `Page status updated to ${normalizedStatus}`,
            page: {
                id: page._id,
                name: page.name,
                status: page.status,
                statusUpdatedAt: page.statusUpdatedAt,
                lastModifiedBy: page.lastModifiedBy
            }
        });

    } catch (error) {
        console.error('Status update error:', error);
        res.status(500).json({ 
            message: 'Error updating page status',
            error: error.message 
        });
    }
});

// Get pages by status
router.get('/status/:status', authenticateUser, async (req, res) => {
    try {
        const { status } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const sort = req.query.sort || '-updatedAt';

        // Validate status
        if (!['published', 'draft'].includes(status.toLowerCase())) {
            return res.status(400).json({ 
                message: 'Invalid status. Must be "published" or "draft"'
            });
        }

        // Build query
        const query = { status: status.toLowerCase() };
        
        // Add user filter for non-admin users
        if (!req.user.isAdmin) {
            query.user = req.user._id;
        }

        // Execute paginated query
        const pages = await Page.find(query)
            .populate('category')
            .populate('user', 'email')
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        // Get total count for pagination
        const totalCount = await Page.countDocuments(query);

        res.status(200).json({
            pages,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalCount / limit),
                totalItems: totalCount,
                itemsPerPage: limit
            }
        });

    } catch (error) {
        console.error('Status retrieval error:', error);
        res.status(500).json({ 
            message: 'Error fetching pages',
            error: error.message 
        });
    }
});

// Get published pages (public route, no auth required)
router.get('/published', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;

        const pages = await Page.find({ status: 'published' })
            .populate('category')
            .populate('user', 'email')
            .sort('-updatedAt')
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        const totalCount = await Page.countDocuments({ status: 'published' });

        res.status(200).json({
            pages,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalCount / limit),
                totalItems: totalCount,
                itemsPerPage: limit
            }
        });

    } catch (error) {
        console.error('Published pages retrieval error:', error);
        res.status(500).json({ 
            message: 'Error fetching published pages',
            error: error.message 
        });
    }
});

// Delete Page
router.delete('/:id', authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const page = await Page.findById(id);

        if (!page) {
            return res.status(404).json({ message: 'Page not found' });
        }

        if (page.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({ message: 'Access denied' });
        }

        await Category.findByIdAndUpdate(page.category, { $pull: { pages: page._id } });

        await Page.findByIdAndDelete(id);

        await User.findByIdAndUpdate(req.user._id, { $pull: { aiInteractions: id } });

        res.status(200).json({ message: 'Page deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting page', error: error.message });
    }
});


module.exports = router;
