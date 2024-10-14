const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    subcategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subcategory' }], // List of subcategories
    pages: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Page' }]
}, { timestamps: true });

module.exports = mongoose.model('Category', CategorySchema);
