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
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft'
    },
    statusUpdatedAt: {
        type: Date,
        default: Date.now
    },
    lastModifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Index for name (helpful for cloning functionality)
pageSchema.index({ name: 1 }, { unique: false });

// Pre-save middleware to update statusUpdatedAt
pageSchema.pre('save', function(next) {
    if (this.isModified('status')) {
        this.statusUpdatedAt = new Date();
    }
    next();
});

// Static method to validate status transition
pageSchema.statics.validateStatusTransition = function(oldStatus, newStatus) {
    const validTransitions = {
        draft: ['published'],
        published: ['draft']
    };
    return validTransitions[oldStatus]?.includes(newStatus);
};

// Method to check if page is publishable
pageSchema.methods.isPublishable = function() {
    const requiredFields = ['name', 'description', 'category'];
    return requiredFields.every(field => {
        const value = this[field];
        return value && (Array.isArray(value) ? value.length > 0 : true);
    });
};

module.exports = mongoose.model('Page', pageSchema);