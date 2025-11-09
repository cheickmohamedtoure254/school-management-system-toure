"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsersByRole = exports.getUsersBySchool = exports.getCurrentUser = exports.logout = exports.login = exports.resetPassword = exports.verify = exports.forcePasswordChange = exports.changePassword = exports.deleteUser = exports.updateUser = exports.getUserById = exports.getUsers = exports.createUser = void 0;
const http_status_1 = __importDefault(require("http-status"));
const catchAsync_1 = require("../../utils/catchAsync");
const user_service_1 = require("./user.service");
const createUser = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const user = await user_service_1.userService.createUser(req.body);
    res.status(http_status_1.default.CREATED).json({
        success: true,
        message: 'User created successfully',
        data: user,
    });
});
exports.createUser = createUser;
const getUsers = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const result = await user_service_1.userService.getUsers(req.query);
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'Users fetched successfully',
        data: result.users,
        pagination: {
            totalCount: result.totalCount,
            currentPage: result.currentPage,
            totalPages: result.totalPages,
            hasNextPage: result.hasNextPage,
            hasPrevPage: result.hasPrevPage,
        },
    });
});
exports.getUsers = getUsers;
const getUserById = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const user = await user_service_1.userService.getUserById(req.params.id);
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'User fetched successfully',
        data: user,
    });
});
exports.getUserById = getUserById;
const updateUser = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const user = await user_service_1.userService.updateUser(req.params.id, req.body);
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'User updated successfully',
        data: user,
    });
});
exports.updateUser = updateUser;
const deleteUser = (0, catchAsync_1.catchAsync)(async (req, res) => {
    await user_service_1.userService.deleteUser(req.params.id);
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'User deleted successfully',
        data: null,
    });
});
exports.deleteUser = deleteUser;
const changePassword = (0, catchAsync_1.catchAsync)(async (req, res) => {
    await user_service_1.userService.changePassword(req.params.id, req.body);
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'Password changed successfully',
        data: null,
    });
});
exports.changePassword = changePassword;
const forcePasswordChange = (0, catchAsync_1.catchAsync)(async (req, res) => {
    if (!req.user) {
        res.status(http_status_1.default.UNAUTHORIZED).json({
            success: false,
            message: 'Authentication required',
        });
        return;
    }
    await user_service_1.userService.forcePasswordChange(req.user.id, req.body.newPassword);
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'Password changed successfully',
        data: null,
    });
});
exports.forcePasswordChange = forcePasswordChange;
const verify = (0, catchAsync_1.catchAsync)(async (req, res) => {
    if (!req.user) {
        res.status(http_status_1.default.UNAUTHORIZED).json({
            success: false,
            message: 'Authentication required',
        });
        return;
    }
    const user = await user_service_1.userService.getUserById(req.user.id);
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'Token verified successfully',
        data: {
            user: user,
            requiresPasswordChange: user.isFirstLogin,
        },
    });
});
exports.verify = verify;
const resetPassword = (0, catchAsync_1.catchAsync)(async (req, res) => {
    await user_service_1.userService.resetPassword(req.params.id, req.body.newPassword);
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'Password reset successfully',
        data: null,
    });
});
exports.resetPassword = resetPassword;
const login = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const result = await user_service_1.userService.login(req.body);
    const isCrossSite = true;
    res.cookie("token", result.accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: isCrossSite ? "none" : "lax",
        expires: result.tokenExpires,
        path: "/",
    });
    res.status(http_status_1.default.OK).json({
        success: true,
        message: result.requiresPasswordChange ? 'Login successful. Password change required.' : 'Login successful',
        data: {
            user: result.user,
            token: result.accessToken,
            tokenExpires: result.tokenExpires,
            requiresPasswordChange: result.requiresPasswordChange,
        },
    });
});
exports.login = login;
const logout = (0, catchAsync_1.catchAsync)(async (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
    });
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'Logout successful',
        data: null,
    });
});
exports.logout = logout;
const getCurrentUser = (0, catchAsync_1.catchAsync)(async (req, res) => {
    if (!req.user) {
        res.status(http_status_1.default.UNAUTHORIZED).json({
            success: false,
            message: 'Authentication required',
        });
        return;
    }
    const user = await user_service_1.userService.getUserById(req.user.id);
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'Current user fetched successfully',
        data: user,
    });
});
exports.getCurrentUser = getCurrentUser;
const getUsersBySchool = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const users = await user_service_1.userService.getUsersBySchool(req.params.schoolId);
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'School users fetched successfully',
        data: users,
    });
});
exports.getUsersBySchool = getUsersBySchool;
const getUsersByRole = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const users = await user_service_1.userService.getUsersByRole(req.params.role);
    res.status(http_status_1.default.OK).json({
        success: true,
        message: 'Users by role fetched successfully',
        data: users,
    });
});
exports.getUsersByRole = getUsersByRole;
//# sourceMappingURL=user.controller.js.map