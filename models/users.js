const mongoose = require('mongoose');

const userProductSettingsSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    },
    customPromptLimit: Number,
    customPages: [String],
    customAccessPeriodDays: Number,
    startDate: Date,
    endDate: Date,
    isActive: {
        type: Boolean,
        default: true
    }
});

const userProductAccessSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
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
    },
    isActive: {
        type: Boolean,
        default: true
    }
});

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w{2,3})+$/, 'Please fill a valid email address']
    },
    phone: {
        type: String,
        required: true,
        trim: true
    },
    country: {
        type: String,
        required: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    isConfirmed: {
        type: Boolean,
        default: false
    },
    confirmationDate: {
        type: Date,
        default: null
    },
    isAdmin: {
        type: Boolean,
        default: false
    },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    productSettings: [userProductSettingsSchema],
    productAccess: [userProductAccessSchema],
    aiInteractions: [
        {
            userInput: { type: String, required: true },
            aiOutput: { type: String, required: true },
            timestamp: { type: Date, default: Date.now }
        }
    ],
    aiUsageHistory: [{
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product'
        },
        pageName: String,
        category: String,
        timestamp: {
            type: Date,
            default: Date.now
        },
        prompt: String,
        response: String
    }]
}, { timestamps: true });

// Method to check if user has access to a product
userSchema.methods.hasProductAccess = function(productId) {
    const access = this.productAccess.find(
        access => access.productId.toString() === productId.toString() && access.isActive
    );
    
    if (!access) return false;
    
    const now = new Date();
    return access.endDate > now;
};

// Method to get product access details
userSchema.methods.getProductAccess = function(productId) {
    return this.productAccess.find(
        access => access.productId.toString() === productId.toString()
    );
};

// Method to get all products with access details
userSchema.methods.getProductsWithAccessDetails = async function() {
    // Populate the productAccess array with actual product details
    const populatedAccess = await Promise.all(
        this.productAccess.map(async (access) => {
            // Find the full product details
            const product = await mongoose.model('Product').findById(access.productId);
            
            return {
                productId: access.productId,
                productName: product ? product.name : 'Unknown Product',
                startDate: access.startDate,
                endDate: access.endDate,
                usageCount: access.usageCount,
                lastUsed: access.lastUsed,
                isActive: access.isActive,
                remainingUsage: product ? product.promptLimit - access.usageCount : 0,
                isExpired: access.endDate < new Date()
            };
        })
    );

    return populatedAccess;
};

// Method to track AI usage
userSchema.methods.trackAIUsage = async function(productId, pageName, category, prompt, response) {
    this.aiUsageHistory.push({
        productId,
        pageName,
        category,
        prompt,
        response,
        timestamp: new Date()
    });
    
    const access = this.getProductAccess(productId);
    if (access) {
        access.usageCount += 1;
        access.lastUsed = new Date();
    }
    
    await this.save();
};

module.exports = mongoose.model('User', userSchema);
