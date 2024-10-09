const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
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

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
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
        const totalCount = await User.countDocuments(); // Get total user count

        res.json({ users, totalCount }); // Return users and total count
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users', error: error.message });
    }
});


// Admin: Get one user by ID
router.get('/admin/users/:userId', isAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId).select('-password'); // Exclude the password field for security
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user', error: error.message });
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


module.exports = router;