"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateApiKey = exports.validateOwnership = exports.requireSuperadmin = exports.requireParent = exports.requireStudentAccess = exports.requireTeacher = exports.requireSchoolAdmin = exports.updateLoginAttempts = exports.rateLimitLogin = exports.enforceSchoolIsolation = exports.authorize = exports.optionalAuth = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const user_model_1 = require("../modules/user/user.model");
const AppError_1 = require("../errors/AppError");
const catchAsync_1 = require("../utils/catchAsync");
const config_1 = __importDefault(require("../config"));
exports.authenticate = (0, catchAsync_1.catchAsync)(async (req, res, next) => {
    let token;
    if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }
    if (!token && req.headers.cookie) {
        const rawToken = req.headers.cookie
            .split(";")
            .map((cookie) => cookie.trim())
            .find((cookie) => cookie.startsWith("token="));
        if (rawToken) {
            token = decodeURIComponent(rawToken.split("=")[1] || "");
        }
    }
    if (req.cookie && req.cookie.token) {
        token = req.cookie.token;
    }
    if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1];
        }
    }
    if (!token) {
        return next(new AppError_1.AppError(401, "Access denied. No token provided."));
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.default.jwt_secret);
        if (!decoded || !decoded.id) {
            return next(new AppError_1.AppError(401, "Invalid token structure"));
        }
        const user = await user_model_1.User.findById(decoded.id).select("+isActive");
        if (!user) {
            return next(new AppError_1.AppError(401, "The user belonging to this token no longer exists"));
        }
        if (!user.isActive) {
            return next(new AppError_1.AppError(401, "Your account has been deactivated. Please contact support."));
        }
        req.user = {
            id: user._id.toString(),
            username: user.username,
            email: user.email,
            role: user.role,
            schoolId: user.schoolId?.toString(),
            isActive: user.isActive,
        };
        next();
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.default.JsonWebTokenError) {
            return next(new AppError_1.AppError(401, "Invalid token"));
        }
        if (error instanceof jsonwebtoken_1.default.TokenExpiredError) {
            return next(new AppError_1.AppError(401, "Token expired. Please login again."));
        }
        return next(new AppError_1.AppError(401, "Authentication failed"));
    }
});
exports.optionalAuth = (0, catchAsync_1.catchAsync)(async (req, res, next) => {
    let token;
    if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }
    if (!token && req.headers.cookie) {
        const rawToken = req.headers.cookie
            .split(";")
            .map((cookie) => cookie.trim())
            .find((cookie) => cookie.startsWith("token="));
        if (rawToken) {
            token = decodeURIComponent(rawToken.split("=")[1] || "");
        }
    }
    if (!token) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1];
        }
    }
    if (!token) {
        return next();
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.default.jwt_secret);
        if (decoded && decoded.id) {
            const user = await user_model_1.User.findById(decoded.id).select("+isActive");
            if (user && user.isActive) {
                req.user = {
                    id: user._id.toString(),
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    schoolId: user.schoolId?.toString(),
                    isActive: user.isActive,
                };
            }
        }
    }
    catch (error) {
    }
    next();
});
const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return next(new AppError_1.AppError(401, "Authentication required to access this resource"));
        }
        if (!allowedRoles.includes(req.user.role)) {
            return next(new AppError_1.AppError(403, "Access denied. Insufficient permissions."));
        }
        next();
    };
};
exports.authorize = authorize;
exports.enforceSchoolIsolation = (0, catchAsync_1.catchAsync)(async (req, res, next) => {
    if (!req.user) {
        return next(new AppError_1.AppError(401, "Authentication required"));
    }
    if (req.user.role === "superadmin") {
        return next();
    }
    if (!req.user.schoolId) {
        return next(new AppError_1.AppError(403, "No school association found for this user"));
    }
    req.body.schoolId = req.user.schoolId;
    req.query.schoolId = req.user.schoolId;
    next();
});
const loginAttempts = new Map();
const rateLimitLogin = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
    return (req, res, next) => {
        const clientId = req.ip || req.connection.remoteAddress || "unknown";
        const now = new Date();
        const attempts = loginAttempts.get(clientId);
        if (attempts) {
            if (now.getTime() - attempts.lastAttempt.getTime() > windowMs) {
                loginAttempts.delete(clientId);
            }
            else if (attempts.count >= maxAttempts) {
                return next(new AppError_1.AppError(429, `Too many login attempts. Please try again in ${Math.ceil(windowMs / 60000)} minutes.`));
            }
        }
        next();
    };
};
exports.rateLimitLogin = rateLimitLogin;
const updateLoginAttempts = (req, success) => {
    const clientId = req.ip || req.connection.remoteAddress || "unknown";
    const now = new Date();
    if (success) {
        loginAttempts.delete(clientId);
    }
    else {
        const attempts = loginAttempts.get(clientId);
        if (attempts) {
            attempts.count += 1;
            attempts.lastAttempt = now;
        }
        else {
            loginAttempts.set(clientId, { count: 1, lastAttempt: now });
        }
    }
};
exports.updateLoginAttempts = updateLoginAttempts;
const requireSchoolAdmin = (req, res, next) => {
    if (!req.user) {
        return next(new AppError_1.AppError(401, "Authentication required"));
    }
    if (req.user.role !== "admin" && req.user.role !== "superadmin") {
        return next(new AppError_1.AppError(403, "Admin access required"));
    }
    next();
};
exports.requireSchoolAdmin = requireSchoolAdmin;
const requireTeacher = (req, res, next) => {
    if (!req.user) {
        return next(new AppError_1.AppError(401, "Authentication required"));
    }
    const allowedRoles = ["teacher", "admin", "superadmin"];
    if (!allowedRoles.includes(req.user.role)) {
        return next(new AppError_1.AppError(403, "Teacher access required"));
    }
    next();
};
exports.requireTeacher = requireTeacher;
const requireStudentAccess = (req, res, next) => {
    if (!req.user) {
        return next(new AppError_1.AppError(401, "Authentication required"));
    }
    const allowedRoles = ["student", "parent", "teacher", "admin", "superadmin"];
    if (!allowedRoles.includes(req.user.role)) {
        return next(new AppError_1.AppError(403, "Student access required"));
    }
    next();
};
exports.requireStudentAccess = requireStudentAccess;
const requireParent = (req, res, next) => {
    if (!req.user) {
        return next(new AppError_1.AppError(401, "Authentication required"));
    }
    const allowedRoles = ["parent", "admin", "superadmin"];
    if (!allowedRoles.includes(req.user.role)) {
        return next(new AppError_1.AppError(403, "Parent access required"));
    }
    next();
};
exports.requireParent = requireParent;
const requireSuperadmin = (req, res, next) => {
    if (!req.user) {
        return next(new AppError_1.AppError(401, "Authentication required"));
    }
    if (req.user.role !== "superadmin") {
        return next(new AppError_1.AppError(403, "Superadmin access required"));
    }
    next();
};
exports.requireSuperadmin = requireSuperadmin;
const validateOwnership = (userIdField = "userId") => {
    return (0, catchAsync_1.catchAsync)(async (req, res, next) => {
        if (!req.user) {
            return next(new AppError_1.AppError(401, "Authentication required"));
        }
        if (["admin", "superadmin"].includes(req.user.role)) {
            return next();
        }
        const resourceUserId = req.params[userIdField] || req.body[userIdField];
        if (!resourceUserId) {
            return next(new AppError_1.AppError(400, `${userIdField} is required`));
        }
        if (resourceUserId !== req.user.id) {
            return next(new AppError_1.AppError(403, "Access denied. You can only access your own data."));
        }
        next();
    });
};
exports.validateOwnership = validateOwnership;
exports.authenticateApiKey = (0, catchAsync_1.catchAsync)(async (req, res, next) => {
    const apiKey = req.headers["x-api-key"];
    if (!apiKey) {
        return next(new AppError_1.AppError(401, "API key required"));
    }
    if (apiKey !== config_1.default.api_key) {
        return next(new AppError_1.AppError(401, "Invalid API key"));
    }
    next();
});
exports.default = {
    authenticate: exports.authenticate,
    optionalAuth: exports.optionalAuth,
    authorize: exports.authorize,
    enforceSchoolIsolation: exports.enforceSchoolIsolation,
    rateLimitLogin: exports.rateLimitLogin,
    updateLoginAttempts: exports.updateLoginAttempts,
    requireSchoolAdmin: exports.requireSchoolAdmin,
    requireTeacher: exports.requireTeacher,
    requireStudentAccess: exports.requireStudentAccess,
    requireParent: exports.requireParent,
    requireSuperadmin: exports.requireSuperadmin,
    validateOwnership: exports.validateOwnership,
    authenticateApiKey: exports.authenticateApiKey,
};
//# sourceMappingURL=auth.js.map