const express = require('express');
const Page = require('../models/page');
const User = require('../models/users');
const Category = require('../models/category');
const Product = require('../models/Product'); 
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

// Middleware to check product access for a page
const checkProductAccess = async (req, res, next) => {
    try {
        const productId = req.query.productId || req.body.productId;
        if (!productId) {
            return res.status(400).json({ message: 'Product ID is required' });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Get product access details
        const productAccess = user.productAccess.find(
            access => access.productId.toString() === productId && access.isActive
        );

        if (!productAccess) {
            return res.status(403).json({ message: 'No active access to this product' });
        }

        // Check if access period has expired
        if (new Date() > productAccess.endDate) {
            productAccess.isActive = false;
            await user.save();
            return res.status(403).json({ message: 'Product access has expired' });
        }

        // Check usage limit
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // If this is a generate request, check and decrement usage
        if (req.path === '/generate') {
            if (productAccess.usageCount >= product.promptLimit) {
                return res.status(403).json({ message: 'Usage limit exceeded for this product' });
            }

            // Increment usage count
            productAccess.usageCount += 1;
            productAccess.lastUsed = new Date();
            await user.save();

            // Add remaining usage info to request
            req.remainingUsage = product.promptLimit - productAccess.usageCount;
        }

        req.productAccess = productAccess;
        next();
    } catch (error) {
        console.error('Error in checkProductAccess middleware:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Middleware to check page access
const checkPageAccess = async (req, res, next) => {
    try {
        const pageId = req.params.id;
        const page = await Page.findById(pageId).populate('products');
        
        if (!page) {
            return res.status(404).json({ message: 'Page not found' });
        }

        // Get user's active product access
        const user = await User.findById(req.user._id);
        const activeProductIds = user.productAccess
            .filter(access => access.isActive)
            .map(access => access.productId.toString());

        // Admin bypass
        if (user.isAdmin) {
            req.page = page;
            return next();
        }

        // Check if any of the page's products match user's active products
        const pageProductIds = page.products.map(product => product.toString());
        const hasAccess = pageProductIds.some(productId => 
            activeProductIds.includes(productId)
        );

        if (!hasAccess) {
            console.log('Debug - Page Products:', pageProductIds);
            console.log('Debug - User Active Products:', activeProductIds);
            return res.status(403).json({ 
                message: 'Access denied. You do not have access to this page.',
                pageProducts: pageProductIds,
                yourActiveProducts: activeProductIds
            });
        }

        req.page = page;
        next();
    } catch (error) {
        console.error('Page access error:', error);
        res.status(500).json({ message: 'Error checking page access', error: error.message });
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

// Update the page creation route in the backend
router.post('/', authenticateUser, checkProductAccess, upload.single('image'), async (req, res) => {
    try {
        const { name, description, category, instructions, status } = req.body; 

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
            user: req.user._id,
            status: status || 'draft' 
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
        const baseName = originalPage.name.replace(/ c\d+$/, ''); 
        const regex = new RegExp(`^${baseName} c(\\d+)$`); 
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
            category: originalPage.category.map(cat => cat._id), 
            userInstructions: originalPage.userInstructions,
            image: originalPage.image, 
            user: req.user._id, 
            status: originalPage.status 
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
router.post('/generate', authenticateUser, upload.single('file'), checkProductAccess, async (req, res) => {
    try {
        const { userInput = '', instructions } = req.body;

        // If a file is uploaded, extract text from it
        if (req.file) {
            const extractedText = await extractTextFromFile(req.file);
            userInput += ` ${extractedText}`; 
        }

        // Send request to OpenAI API
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ message: 'OpenAI API key is not configured' });
        }

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini-2024-07-18",
            messages: [
                { role: "system", content: instructions || "You are a helpful assistant." },
                { role: "user", content: userInput }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const aiOutput = response.data.choices[0].message.content;

        // Save AI interaction with product usage info
        const aiInteraction = {
            user: req.user._id,
            userInput,
            aiOutput,
            remainingUsage: req.remainingUsage
        };

        res.json({
            output: aiOutput,
            remainingUsage: req.remainingUsage
        });
    } catch (error) {
        console.error('Error generating AI response:', error);
        res.status(500).json({ 
            message: 'Error generating AI response', 
            error: error.message 
        });
    }
});

// Get all pages for a user
router.get('/my-pages', authenticateUser,checkProductAccess, async (req, res) => {
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
            .populate('user', 'email'); 

        const totalCount = await Page.countDocuments();

        res.status(200).json({ pages, totalCount, currentPage: page, totalPages: Math.ceil(totalCount / limit) });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching pages', error: error.message });
    }
});

// Get a single page by ID
router.get('/:id', authenticateUser, checkPageAccess, async (req, res) => {
    res.json(req.page);
});

// Update Page
router.put('/:id', authenticateUser, checkPageAccess, upload.single('image'), async (req, res) => {
    try {
        const { name, description, category, instructions,status } = req.body;

        let page = req.page;

        // Handle category updates (for multiple categories)
        if (category) {
            const newCategories = Array.isArray(category) ? category : [category]; 

            // Remove page from old categories
            const oldCategories = page.category.map(cat => cat._id.toString());  
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
         page.status = status || 'draft' 


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
router.put('/:id/status', authenticateUser, checkPageAccess, async (req, res) => {
    try {
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

        // Validate status transition
        if (!Page.validateStatusTransition(req.page.status, normalizedStatus)) {
            return res.status(400).json({ 
                message: `Invalid status transition from ${req.page.status} to ${normalizedStatus}`
            });
        }

        // Additional validation for publishing
        if (normalizedStatus === 'published' && !req.page.isPublishable()) {
            return res.status(400).json({
                message: 'Cannot publish page: missing required fields'
            });
        }

        // Update status
        req.page.status = normalizedStatus;
        req.page.lastModifiedBy = req.user._id;
        await req.page.save();

        res.status(200).json({
            message: `Page status updated to ${normalizedStatus}`,
            page: {
                id: req.page._id,
                name: req.page.name,
                status: req.page.status,
                statusUpdatedAt: req.page.statusUpdatedAt,
                lastModifiedBy: req.page.lastModifiedBy
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

// Get pages by status with product access check
router.get('/status/:status', authenticateUser, async (req, res) => {
    try {
        const { status } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Get user's active product access
        const user = await User.findById(req.user._id);
        const activeProductIds = user.productAccess
            .filter(access => access.isActive)
            .map(access => access.productId);

        // Build the query
        const query = { status };
        
        // If not admin, filter by accessible products
        if (!user.isAdmin) {
            query.products = { $in: activeProductIds };
        }

        // Find pages with populated products
        const pages = await Page.find(query)
            .populate('products')
            .populate('category')
            .skip(skip)
            .limit(limit)
            .sort({ createdAt: -1 });

        const total = await Page.countDocuments(query);

        res.json({
            pages,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            total,
            debug: {
                activeProductIds: activeProductIds.map(id => id.toString()),
                query
            }
        });
    } catch (error) {
        console.error('Error fetching pages by status:', error);
        res.status(500).json({ message: 'Error fetching pages', error: error.message });
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
router.delete('/:id', authenticateUser, checkPageAccess, async (req, res) => {
    try {
        await Category.findByIdAndUpdate(req.page.category, { $pull: { pages: req.page._id } });

        await Page.findByIdAndDelete(req.page._id);

        await User.findByIdAndUpdate(req.user._id, { $pull: { aiInteractions: req.page._id } });

        res.status(200).json({ message: 'Page deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting page', error: error.message });
    }
});

module.exports = router;
