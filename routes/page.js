const express = require('express');
const Page = require('../models/page');
const User = require('../models/User');
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

//create page 
router.post('/', authenticateUser, upload.single('image'), async (req, res) => {
    try {
        const { name, description, category, instructions } = req.body;

        // Upload image to Cloudinary if image file is provided
        let imageUrl = null;
        if (req.file) {
            const result = await cloudinary.uploader.upload(req.file.path);
            imageUrl = result.secure_url; // Get the uploaded image's URL
        }

        // Create and save the page
        const page = new Page({
            name,
            description,
            category,
            userInstructions: instructions,
            image: imageUrl,  // Store the Cloudinary image URL
            user: req.user._id
        });
        await page.save();

        res.status(201).json(page);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ message: 'Error creating page', error: error.message });
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
        const pages = await Page.find({ user: req.user._id }).populate('category');
        res.status(200).json(pages);
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
        if (page.user._id.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({ message: 'Access denied' });
        }

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

        let page = await Page.findById(id);

        if (!page) {
            return res.status(404).json({ message: 'Page not found' });
        }

        // Check if the user is the owner of the page or an admin
        if (page.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({ message: 'Access denied' });
        }

        // Upload new image to Cloudinary if a new one is provided
        let imageUrl = page.image;
        if (req.file) {
            const result = await cloudinary.uploader.upload(req.file.path);
            imageUrl = result.secure_url; // Get the new image's Cloudinary URL
        }

        // Update the page
        page = await Page.findByIdAndUpdate(id, {
            name,
            description,
            category,
            userInstructions: instructions,
            image: imageUrl,  // Update the image URL if a new one is provided
        }, { new: true });

        res.status(200).json(page);
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ message: 'Error updating page', error: error.message });
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

        // Check if the user is the owner of the page or an admin
        if (page.user.toString() !== req.user._id.toString() && !req.user.isAdmin) {
            return res.status(403).json({ message: 'Access denied' });
        }

        await Page.findByIdAndDelete(id);

        // Remove the page reference from the user's aiInteractions
        await User.findByIdAndUpdate(req.user._id, { $pull: { aiInteractions: id } });

        res.status(200).json({ message: 'Page deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting page', error: error.message });
    }
});

module.exports = router;
