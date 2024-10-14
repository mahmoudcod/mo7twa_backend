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
    categories: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category'
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
    }
}, { timestamps: true });

module.exports = mongoose.model('Page', pageSchema);