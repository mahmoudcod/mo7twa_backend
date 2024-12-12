const mongoose = require('mongoose');

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
userSchema.methods.hasProductAccess = async function(productId) {
    const access = this.productAccess.find(
        access => access.productId.toString() === productId.toString()
    );
    
    if (!access) return false;
    
    const now = new Date();
    const isExpired = access.endDate <= now;
    
    // If expired, update isActive to false and save
    if (isExpired && access.isActive) {
        access.isActive = false;
        await this.save();
    }
    
    return !isExpired && access.isActive;
};

// Method to get product access details
userSchema.methods.getProductAccess = function(productId) {
    return this.productAccess.find(
        access => access.productId.toString() === productId.toString()
    );
};

// Method to revoke product access
userSchema.methods.revokeProductAccess = async function(productId) {
    // Remove from productAccess array
    this.productAccess = this.productAccess.filter(
        access => access.productId.toString() !== productId.toString()
    );
    
    // Remove from products array if it exists
    if (this.products) {
        this.products = this.products.filter(
            pid => pid.toString() !== productId.toString()
        );
    }
    
    // Save the changes
    await this.save();
    
    return {
        success: true,
        remainingAccess: this.productAccess.length
    };
};

// Method to get all products with access details
userSchema.methods.getProductsWithAccessDetails = async function() {
    // Populate the productAccess array with actual product details
    const populatedAccess = await Promise.all(
        this.productAccess.map(async (access) => {
            // Find the full product details
            const product = await mongoose.model('Product').findById(access.productId);
            const now = new Date();
            const isExpired = access.endDate <= now;
            
            // Update isActive if expired
            if (isExpired && access.isActive) {
                access.isActive = false;
                await this.save();
            }
            
            return {
                productId: access.productId,
                productName: product ? product.name : 'Unknown Product',
                startDate: access.startDate,
                endDate: access.endDate,
                usageCount: access.usageCount,
                lastUsed: access.lastUsed,
                isActive: access.isActive,
                remainingUsage: product ? product.promptLimit - access.usageCount : 0,
                isExpired: isExpired
            };
        })
    );

    return populatedAccess;
};

// Method to track AI usage
userSchema.methods.trackAIUsage = async function(productId, pageName, category, prompt, response) {
    // First check if product access is still valid
    const hasAccess = await this.hasProductAccess(productId);
    if (!hasAccess) {
        throw new Error('Product access has expired or is inactive');
    }
    
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
