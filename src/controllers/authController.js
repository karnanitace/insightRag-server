import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { sendEmail } from '../services/emailService.js';
import { passwordResetEmail } from '../services/emailTemplates.js';
import { demoEnabled, demoEmail, demoName, isDemoUser } from '../config/demo.js';

/**
 * Generate a signed JWT for the given user ID.
 */
const signToken = (id) =>
    jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email, isDemo: isDemoUser(user) });

/**
 * POST /api/auth/register
 */
export const register = async (req, res, next) => {
    try {
        const { name, email, password } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        const user = await User.create({ name, email, password });
        const token = signToken(user._id);

        res.status(201).json({
            success: true,
            token,
            user: publicUser(user),
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/auth/login
 */
export const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Please provide email and password' });
        }

        // select('+password') because password field has select: false on schema
        const user = await User.findOne({ email }).select('+password');
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        const token = signToken(user._id);

        res.json({
            success: true,
            token,
            user: publicUser(user),
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/auth/demo
 * Signs in to the shared demo account, creating it on first use with a random password
 * (it is only ever entered through this endpoint).
 */
export const demoLogin = async (req, res, next) => {
    try {
        if (!demoEnabled()) {
            return res.status(404).json({ success: false, message: 'The demo account is not available' });
        }

        let user = await User.findOne({ email: demoEmail() });
        if (!user) {
            user = await User.create({
                name: demoName(),
                email: demoEmail(),
                password: crypto.randomBytes(24).toString('hex'),
            });
        }

        res.json({ success: true, token: signToken(user._id), user: publicUser(user) });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/auth/forgot-password
 */
export const forgotPassword = async (req, res, next) => {
    const genericResponse = {
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent',
    };

    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: 'Please provide an email' });
        }

        // Respond identically whether or not the user exists, to avoid email enumeration
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        // The demo account's password is never reset: nobody owns its inbox
        if (!user || isDemoUser(user)) return res.json(genericResponse);

        const resetToken = user.createPasswordResetToken();
        await user.save({ validateBeforeSave: false });

        const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
        const resetUrl = `${clientUrl}/reset-password/${resetToken}`;

        try {
            await sendEmail({ to: user.email, ...passwordResetEmail({ name: user.name, resetUrl }) });
        } catch (emailError) {
            console.error('Password reset email failed:', emailError.message);
            user.resetPasswordToken = undefined;
            user.resetPasswordExpires = undefined;
            await user.save({ validateBeforeSave: false });
            return res.status(500).json({ success: false, message: 'Failed to send reset email. Please try again later.' });
        }

        res.json(genericResponse);
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/auth/reset-password/:token
 */
export const resetPassword = async (req, res, next) => {
    try {
        const { password } = req.body;

        if (!password || password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired' });
        }

        user.password = password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        const token = signToken(user._id);

        res.json({
            success: true,
            token,
            user: publicUser(user),
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/auth/me  (protected)
 */
export const getMe = async (req, res) => {
    res.json({
        success: true,
        user: publicUser(req.user),
    });
};
