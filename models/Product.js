// models/Product.js
const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    promptLimit: { type: Number, required: true },
    expirationDate: { type: Date, required: true },
    pages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'page' }],
    category: [{ type: mongoose.Schema.Types.ObjectId, ref: 'category' }],
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

module.exports = mongoose.model('Product', ProductSchema);