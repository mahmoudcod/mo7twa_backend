const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true,
        trim: true
    },
    promptLimit: {
        type: Number,
        required: true
    },
    accessPeriodDays: {
        type: Number,
        required: true
    },
    pages: {
        type: [String],
        default: []
    },
    category: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    }]
});

module.exports = mongoose.model('Product', productSchema);
