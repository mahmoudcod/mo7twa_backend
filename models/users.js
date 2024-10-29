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
    aiInteractions: [
        {
            userInput: { type: String, required: true },
            aiOutput: { type: String, required: true },
            timestamp: { type: Date, default: Date.now }
        }
    ]
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
