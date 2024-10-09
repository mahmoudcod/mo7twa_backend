// routes/company.js
const express = require('express');
const multer = require('multer');
const router = express.Router();

// Multer setup for file uploads
const upload = multer({ dest: 'uploads/' });

// Route to handle Copy & Paste prompt
router.post('/prompt', (req, res) => {
    const { companyName, prompt } = req.body;

    if (!companyName || !prompt) {
        return res.status(400).json({ message: 'Company name and prompt are required' });
    }

    // Here you can process the prompt, e.g., send it to an API or store it in a database.
    console.log(`Processing prompt for ${companyName}: ${prompt}`);

    res.status(200).json({ message: 'Prompt processed successfully', companyName, prompt });
});

// Route to handle file upload
router.post('/upload', upload.single('file'), (req, res) => {
    const { companyName } = req.body;
    const file = req.file;

    if (!companyName || !file) {
        return res.status(400).json({ message: 'Company name and file are required' });
    }

    // Here you can process the file, e.g., read its contents or store it.
    console.log(`File uploaded for ${companyName}: ${file.originalname}`);

    res.status(200).json({ message: 'File uploaded successfully', companyName, file: file.originalname });
});

module.exports = router;
