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

// Method to check if a user has access to the product
productSchema.methods.hasAccess = function(userId) {
    const userAccess = this.userAccess.find(access => access.userId.toString() === userId.toString());
    if (!userAccess) return false;
    
    const now = new Date();
    return userAccess.endDate > now;
};

// Method to check and update usage limits
productSchema.methods.checkAndUpdateUsage = async function(userId) {
    const userAccess = this.userAccess.find(access => access.userId.toString() === userId.toString());
    if (!userAccess) return { allowed: false, message: 'No access to this product' };
    
    const now = new Date();
    if (userAccess.endDate < now) {
        return { allowed: false, message: 'Access period has expired' };
    }
    
    if (userAccess.usageCount >= this.promptLimit) {
        return { allowed: false, message: 'Usage limit exceeded' };
    }
    
    userAccess.usageCount += 1;
    userAccess.lastUsed = now;
    await this.save();
    
    return { 
        allowed: true, 
        remainingUsage: this.promptLimit - userAccess.usageCount 
    };
};

module.exports = mongoose.model('Product', productSchema);