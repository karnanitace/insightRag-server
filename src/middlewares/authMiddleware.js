import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { isDemoUser } from '../config/demo.js';

/**
 * JWT authentication middleware.
 * Expects: Authorization: Bearer <token>
 * Attaches the decoded user to req.user
 */
export const protect = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Not authorized — no token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(401).json({ success: false, message: 'User no longer exists' });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Not authorized — invalid token' });
    }
};

/**
 * Keeps the shared demo account intact for the next visitor: blocks destructive actions.
 * Use after `protect`.
 */
export const blockDemo = (req, res, next) => {
    if (isDemoUser(req.user)) {
        return res.status(403).json({
            success: false,
            message: 'The demo account is shared, so deleting is turned off. Create a free account to manage your own library.',
        });
    }
    next();
};
