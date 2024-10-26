// models/Product.js
const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    promptLimit: { type: Number, required: true },
    accessPeriodDays: {
        type: Number,
        required: true
    },
    pages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'page' }],
    category: [{ type: mongoose.Schema.Types.ObjectId, ref: 'category' }],
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    startDate: {
        type: Date,
    },
    endDate: {
        type: Date,
    }
});

module.exports = mongoose.model('Product', ProductSchema);