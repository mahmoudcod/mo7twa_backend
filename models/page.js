const mongoose = require('mongoose');

const pageSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    category: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
    }],
    products: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    }],
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    userInstructions: {
        type: String
    },
    userInput: {
        type: String,
        required: false
    },
    aiOutput: {
        type: String,
        required: false
    },
    image: {
        type: String
    },
    // Adding publish status
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft'
    }
}, { 
    timestamps: true 
});

// Add an index for the name to help with the cloning functionality
pageSchema.index({ name: 1 }, { unique: false });

module.exports = mongoose.model('Page', pageSchema);
