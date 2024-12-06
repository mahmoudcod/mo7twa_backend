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
    category: {
        type: [String],
        default: [],
        required: true
    },
    userAccess: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        startDate: {
            type: Date,
            required: true
        },
        endDate: {
            type: Date,
            required: true
        },
        usageCount: {
            type: Number,
            default: 0
        },
        lastUsed: {
            type: Date,
            default: Date.now
        }
    }]
});




module.exports = mongoose.model('Product', productSchema);