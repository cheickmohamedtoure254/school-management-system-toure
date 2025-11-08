import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User } from "../modules/user/user.model";
import { AppError } from "../errors/AppError";
import { catchAsync } from "../utils/catchAsync";
import config from "../config";

// Extended Request interface to include user data
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    email?: string;
    role: string;
    schoolId?: string;
    isActive: boolean;
  };
  cookie?: any; // For compatibility with some clients
  teacher?: any; // Teacher document for teacher-specific routes
}

/**
 * JWT Authentication Middleware
 * Verifies JWT token and attaches user data to request
 */
export const authenticate = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // 1) Get token from cookies first, then headers as fallback
    let token: string | undefined;

    // Check for token in cookies (more secure)
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    // Fallback: Parse raw cookie header when cookie-parser fails to populate
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

    // Fallback to Authorization header for API clients
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      }
    }

    if (!token) {
      // // Temporary debug log to see which client/route is triggering this
      // console.warn(
      //   `[AUTH] Missing token - ${req.method} ${req.originalUrl} from ${
      //     req.ip
      //   } referer=${req.get("referer")} user-agent=${req.get("user-agent")}`
      // );
      return next(new AppError(401, "Access denied. No token provided."));
    }

    try {
      // 2) Verify token
      const decoded = jwt.verify(
        token,
        config.jwt_secret as string
      ) as jwt.JwtPayload;

      if (!decoded || !decoded.id) {
        return next(new AppError(401, "Invalid token structure"));
      }

      // 3) Check if user still exists
      const user = await User.findById(decoded.id).select("+isActive");

      if (!user) {
        return next(
          new AppError(401, "The user belonging to this token no longer exists")
        );
      }

      // 4) Check if user is active
      if (!user.isActive) {
        return next(
          new AppError(
            401,
            "Your account has been deactivated. Please contact support."
          )
        );
      }

      // 5) Check if password was changed after token was issued
      // Note: This check is currently disabled as the User model doesn't implement isPasswordChangedAfter method
      // if (user.isPasswordChangedAfter && user.isPasswordChangedAfter(decoded.iat)) {
      //   return next(new AppError(401, 'Password was recently changed. Please login again.'));
      // }

      // 6) Attach user to request object
      req.user = {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        role: user.role,
        schoolId: user.schoolId?.toString(),
        isActive: user.isActive,
      };

      next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        return next(new AppError(401, "Invalid token"));
      }
      if (error instanceof jwt.TokenExpiredError) {
        return next(new AppError(401, "Token expired. Please login again."));
      }
      return next(new AppError(401, "Authentication failed"));
    }
  }
);

/**
 * Optional Authentication Middleware
 * Like authenticate but doesn't fail if no token provided
 */
export const optionalAuth = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    let token: string | undefined;

    // Check for token in cookies first, then headers as fallback
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
      return next(); // Continue without authentication
    }

    try {
      const decoded = jwt.verify(
        token,
        config.jwt_secret as string
      ) as jwt.JwtPayload;

      if (decoded && decoded.id) {
        const user = await User.findById(decoded.id).select("+isActive");

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
    } catch (error) {
      // Silently continue without authentication if token is invalid
    }

    next();
  }
);

/**
 * Role-based Authorization Middleware
 * Restricts access based on user roles
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(
        new AppError(401, "Authentication required to access this resource")
      );
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(403, "Access denied. Insufficient permissions.")
      );
    }

    next();
  };
};

/**
 * School Isolation Middleware
 * Ensures users can only access data from their own school
 */
export const enforceSchoolIsolation = catchAsync(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError(401, "Authentication required"));
    }

    // Superadmin can access all schools
    if (req.user.role === "superadmin") {
      return next();
    }

    // All other users must have a schoolId
    if (!req.user.schoolId) {
      return next(
        new AppError(403, "No school association found for this user")
      );
    }

    // Add schoolId to request for queries to use
    req.body.schoolId = req.user.schoolId;
    req.query.schoolId = req.user.schoolId;

    next();
  }
);

/**
 * Rate Limiting Middleware (Simple implementation)
 */
const loginAttempts = new Map<string, { count: number; lastAttempt: Date }>();

export const rateLimitLogin = (
  maxAttempts: number = 5,
  windowMs: number = 15 * 60 * 1000
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientId = req.ip || req.connection.remoteAddress || "unknown";
    const now = new Date();

    const attempts = loginAttempts.get(clientId);

    if (attempts) {
      // Reset counter if window has passed
      if (now.getTime() - attempts.lastAttempt.getTime() > windowMs) {
        loginAttempts.delete(clientId);
      } else if (attempts.count >= maxAttempts) {
        return next(
          new AppError(
            429,
            `Too many login attempts. Please try again in ${Math.ceil(
              windowMs / 60000
            )} minutes.`
          )
        );
      }
    }

    next();
  };
};

/**
 * Update login attempts counter
 */
export const updateLoginAttempts = (req: Request, success: boolean) => {
  const clientId = req.ip || req.connection.remoteAddress || "unknown";
  const now = new Date();

  if (success) {
    // Clear attempts on successful login
    loginAttempts.delete(clientId);
  } else {
    // Increment failed attempts
    const attempts = loginAttempts.get(clientId);
    if (attempts) {
      attempts.count += 1;
      attempts.lastAttempt = now;
    } else {
      loginAttempts.set(clientId, { count: 1, lastAttempt: now });
    }
  }
};

/**
 * School Admin Authorization
 * Ensures only school admins can access admin resources
 */
export const requireSchoolAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return next(new AppError(401, "Authentication required"));
  }

  if (req.user.role !== "admin" && req.user.role !== "superadmin") {
    return next(new AppError(403, "Admin access required"));
  }

  next();
};

/**
 * Teacher Authorization
 * Ensures only teachers can access teacher resources
 */
export const requireTeacher = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return next(new AppError(401, "Authentication required"));
  }

  const allowedRoles = ["teacher", "admin", "superadmin"];
  if (!allowedRoles.includes(req.user.role)) {
    return next(new AppError(403, "Teacher access required"));
  }

  next();
};

/**
 * Student Authorization
 * Ensures only students (or their parents/teachers) can access student resources
 */
export const requireStudentAccess = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return next(new AppError(401, "Authentication required"));
  }

  const allowedRoles = ["student", "parent", "teacher", "admin", "superadmin"];
  if (!allowedRoles.includes(req.user.role)) {
    return next(new AppError(403, "Student access required"));
  }

  next();
};

/**
 * Parent Authorization
 * Ensures only parents can access parent resources
 */
export const requireParent = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return next(new AppError(401, "Authentication required"));
  }

  const allowedRoles = ["parent", "admin", "superadmin"];
  if (!allowedRoles.includes(req.user.role)) {
    return next(new AppError(403, "Parent access required"));
  }

  next();
};

/**
 * Superadmin Authorization
 * Ensures only superadmins can access superadmin resources
 */
export const requireSuperadmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return next(new AppError(401, "Authentication required"));
  }

  if (req.user.role !== "superadmin") {
    return next(new AppError(403, "Superadmin access required"));
  }

  next();
};

/**
 * Validate User Ownership
 * Ensures users can only access their own data (except admins/superadmins)
 */
export const validateOwnership = (userIdField: string = "userId") => {
  return catchAsync(
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      if (!req.user) {
        return next(new AppError(401, "Authentication required"));
      }

      // Admins and superadmins can access any data
      if (["admin", "superadmin"].includes(req.user.role)) {
        return next();
      }

      const resourceUserId = req.params[userIdField] || req.body[userIdField];

      if (!resourceUserId) {
        return next(new AppError(400, `${userIdField} is required`));
      }

      if (resourceUserId !== req.user.id) {
        return next(
          new AppError(403, "Access denied. You can only access your own data.")
        );
      }

      next();
    }
  );
};

/**
 * API Key Authentication (for external integrations)
 */
export const authenticateApiKey = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers["x-api-key"] as string;

    if (!apiKey) {
      return next(new AppError(401, "API key required"));
    }

    // In a real application, you'd validate this against a database
    // For now, using a simple environment variable
    if (apiKey !== config.api_key) {
      return next(new AppError(401, "Invalid API key"));
    }

    next();
  }
);

// Export all middleware functions
export default {
  authenticate,
  optionalAuth,
  authorize,
  enforceSchoolIsolation,
  rateLimitLogin,
  updateLoginAttempts,
  requireSchoolAdmin,
  requireTeacher,
  requireStudentAccess,
  requireParent,
  requireSuperadmin,
  validateOwnership,
  authenticateApiKey,
};
