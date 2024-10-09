const mongoose = require('mongoose');

const SubcategorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' }, // Relation with Category
}, { timestamps: true });

module.exports = mongoose.model('Subcategory', SubcategorySchema);
