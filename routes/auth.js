const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/users');
const router = express.Router();

// Middleware to check if user is admin
const isAdmin = async (req, res, next) => {
    try {
        const token = req.header('Authorization').replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findOne({ _id: decoded.id, isAdmin: true });

        if (!user) {
            throw new Error();
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).send({ error: 'Please authenticate as admin.' });
    }
};

// Register
router.post('/register', async (req, res) => {
    const { email, phone, country, password } = req.body;

    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            email,
            phone,
            country,
            password: hashedPassword,
            isConfirmed: false
        });

        await newUser.save();
        res.status(201).json({ message: 'User registered successfully. Waiting for admin confirmation.' });
    } catch (error) {
        res.status(500).json({ message: 'Error registering user', error: error.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'User not found' });

        if (!user.isConfirmed && !user.isAdmin) {
            return res.status(403).json({ message: 'Account not confirmed by admin yet' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user._id, email: user.email, country: user.country, isAdmin: user.isAdmin, isConfirmed: user.isConfirmed } });
    } catch (error) {
        res.status(500).json({ message: 'Error logging in', error: error.message });
    }
});

// Create Admin (this should be a one-time operation or highly restricted)
router.post('/create-admin', async (req, res) => {
    const { email, phone, country, password, adminSecret } = req.body;

    if (adminSecret !== process.env.ADMIN_SECRET) {
        return res.status(403).json({ message: 'Not authorized to create admin' });
    }

    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newAdmin = new User({
            email,
            phone,
            country,
            password: hashedPassword,
            isConfirmed: true,
            isAdmin: true
        });

        await newAdmin.save();
        res.status(201).json({ message: 'Admin created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error creating admin', error: error.message });
    }
});

// Admin: Get all users with pagination
router.get('/admin/users', isAdmin, async (req, res) => {
    const { page = 1, limit = 30 } = req.query;
    const options = {
        page: parseInt(page),
        limit: parseInt(limit),
    };

    try {
        const users = await User.find().select('-password').limit(options.limit).skip((options.page - 1) * options.limit);
        const totalCount = await User.countDocuments();

        res.json({ users, totalCount });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users', error: error.message });
    }
});

// Admin: Get one user by ID
router.get('/admin/users/:userId', isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId).select('-password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user', error: error.message });
    }
});

// NEW ROUTE: Get user's products
router.get('/admin/users/:userId/products', isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId)
            .populate({
                path: 'products',
                populate: {
                    path: 'userAccess.userId',
                    select: 'name email'
                }
            });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Add access status for each product
        const productsWithStatus = user.products.map(product => {
            const userAccess = product.userAccess.find(
                access => access.userId._id.toString() === user._id.toString()
            );

            const now = new Date();
            const isActive = userAccess && userAccess.endDate > now;
            const remainingDays = isActive
                ? Math.ceil((userAccess.endDate - now) / (1000 * 60 * 60 * 24))
                : 0;

            return {
                ...product.toObject(),
                accessStatus: {
                    isActive,
                    startDate: userAccess?.startDate,
                    endDate: userAccess?.endDate,
                    remainingDays
                }
            };
        });

        res.json({
            userId: user._id,
            email: user.email,
            products: productsWithStatus
        });
    } catch (error) {
        res.status(500).json({
            message: 'Error fetching user products',
            error: error.message
        });
    }
});

// Admin: Get unconfirmed users
router.get('/admin/unconfirmed-users', isAdmin, async (req, res) => {
    try {
        const unconfirmedUsers = await User.find({ isConfirmed: false }).select('-password');
        res.json(unconfirmedUsers);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching unconfirmed users', error: error.message });
    }
});

// Admin: Confirm user
router.post('/admin/confirm-user/:userId', isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        user.isConfirmed = true;
        user.confirmationDate = new Date();
        await user.save();
        res.json({ message: 'User confirmed successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error confirming user', error: error.message });
    }
});

// Admin: Delete a user
router.delete('/admin/users/:userId', isAdmin, async (req, res) => {
    try {
        const result = await User.deleteOne({ _id: req.params.userId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting user', error: error.message });
    }
});
// NEW ROUTE: Admin - Revoke product access from user
router.delete('/admin/users/:userId/products/:productId', isAdmin, async (req, res) => {
    const { userId, productId } = req.params;

    try {
        // Fetch the user and the product
        const user = await User.findById(userId).populate('products');
        const product = await Product.findById(productId).populate('userAccess.userId', 'name email');
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Check if the user has access to the product
        const userHasAccess = product.userAccess.some(access => access.userId.toString() === userId);

        if (!userHasAccess) {
            return res.status(400).json({ message: 'User does not have access to this product' });
        }

        // Remove the product from the user's products array
        user.products = user.products.filter(product => 
            product._id.toString() !== productId
        );
        await user.save();

        // Remove the user from the product's userAccess array
        product.userAccess = product.userAccess.filter(access => 
            access.userId.toString() !== userId
        );
        await product.save();

        res.json({ 
            message: 'Product access revoked successfully',
            userId: user._id,
            productId: product._id,
            updatedUser: {
                _id: user._id,
                products: user.products
            },
            updatedProduct: {
                _id: product._id,
                userAccess: product.userAccess
            }
        });
    } catch (error) {
        console.error('Error revoking product access:', error);
        res.status(500).json({ 
            message: 'Error revoking product access', 
            error: error.message 
        });
    }
});

module.exports = router;