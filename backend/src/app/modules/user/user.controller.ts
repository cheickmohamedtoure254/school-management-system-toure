import httpStatus from 'http-status';
import { Request, Response } from 'express';
import { catchAsync } from '../../utils/catchAsync';
import { userService } from './user.service';
import { AuthenticatedRequest } from '../../middlewares/auth';

const createUser = catchAsync(async (req: Request, res: Response) => {
  const user = await userService.createUser(req.body);

  res.status(httpStatus.CREATED).json({
    success: true,
    message: 'User created successfully',
    data: user,
  });
});

const getUsers = catchAsync(async (req: Request, res: Response) => {
  const result = await userService.getUsers(req.query as any);

  res.status(httpStatus.OK).json({
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

const getUserById = catchAsync(async (req: Request, res: Response) => {
  const user = await userService.getUserById(req.params.id);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'User fetched successfully',
    data: user,
  });
});

const updateUser = catchAsync(async (req: Request, res: Response) => {
  const user = await userService.updateUser(req.params.id, req.body);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'User updated successfully',
    data: user,
  });
});

const deleteUser = catchAsync(async (req: Request, res: Response) => {
  await userService.deleteUser(req.params.id);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'User deleted successfully',
    data: null,
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  await userService.changePassword(req.params.id, req.body);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Password changed successfully',
    data: null,
  });
});

const forcePasswordChange = catchAsync(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      message: 'Authentication required',
    });
    return;
  }

  await userService.forcePasswordChange(req.user.id, req.body.newPassword);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Password changed successfully',
    data: null,
  });
});

const verify = catchAsync(async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      message: 'Authentication required',
    });
    return;
  }

  // Get user from service to ensure up-to-date data
  const user = await userService.getUserById(req.user.id);
  
  res.status(httpStatus.OK).json({
    success: true,
    message: 'Token verified successfully',
    data: {
      user: user,
      requiresPasswordChange: user.isFirstLogin,
    },
  });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await userService.resetPassword(req.params.id, req.body.newPassword);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Password reset successfully',
    data: null,
  });
});

const login = catchAsync(async (req: Request, res: Response) => {
  const result = await userService.login(req.body);

  // Set httpOnly cookie for authentication
  // For cross-domain (Netlify + Render), we need sameSite: 'none' and secure: true
  res.cookie('token', result.accessToken, {
    httpOnly: true,
    secure: true, // Always true for cross-domain cookies (requires HTTPS)
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-domain in production
    expires: result.tokenExpires,
    path: '/',
  });

  res.status(httpStatus.OK).json({
    success: true,
    message: result.requiresPasswordChange ? 'Login successful. Password change required.' : 'Login successful',
    data: {
      user: result.user,
      token: result.accessToken, // Changed from accessToken to token
      tokenExpires: result.tokenExpires,
      requiresPasswordChange: result.requiresPasswordChange,
    },
  });
});

const logout = catchAsync(async (req: Request, res: Response) => {
  // Clear authentication cookie - must match the same settings as when it was set
  res.clearCookie('token', {
    httpOnly: true,
    secure: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
  });

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Logout successful',
    data: null,
  });
});

const getCurrentUser = catchAsync(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      message: 'Authentication required',
    });
    return;
  }

  const user = await userService.getUserById(req.user.id);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Current user fetched successfully',
    data: user,
  });
});

const getUsersBySchool = catchAsync(async (req: Request, res: Response) => {
  const users = await userService.getUsersBySchool(req.params.schoolId);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'School users fetched successfully',
    data: users,
  });
});

const getUsersByRole = catchAsync(async (req: Request, res: Response) => {
  const users = await userService.getUsersByRole(req.params.role as any);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Users by role fetched successfully',
    data: users,
  });
});

export {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  changePassword,
  forcePasswordChange,
  verify,
  resetPassword,
  login,
  logout,
  getCurrentUser,
  getUsersBySchool,
  getUsersByRole,
};