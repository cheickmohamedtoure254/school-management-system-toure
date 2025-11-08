import { NextFunction, Request, Response } from "express";
export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        username: string;
        email?: string;
        role: string;
        schoolId?: string;
        isActive: boolean;
    };
    cookie?: any;
    teacher?: any;
}
export declare const authenticate: (req: Request, res: Response, next: NextFunction) => void;
export declare const optionalAuth: (req: Request, res: Response, next: NextFunction) => void;
export declare const authorize: (...allowedRoles: string[]) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
export declare const enforceSchoolIsolation: (req: Request, res: Response, next: NextFunction) => void;
export declare const rateLimitLogin: (maxAttempts?: number, windowMs?: number) => (req: Request, res: Response, next: NextFunction) => void;
export declare const updateLoginAttempts: (req: Request, success: boolean) => void;
export declare const requireSchoolAdmin: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
export declare const requireTeacher: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
export declare const requireStudentAccess: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
export declare const requireParent: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
export declare const requireSuperadmin: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
export declare const validateOwnership: (userIdField?: string) => (req: Request, res: Response, next: NextFunction) => void;
export declare const authenticateApiKey: (req: Request, res: Response, next: NextFunction) => void;
declare const _default: {
    authenticate: (req: Request, res: Response, next: NextFunction) => void;
    optionalAuth: (req: Request, res: Response, next: NextFunction) => void;
    authorize: (...allowedRoles: string[]) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
    enforceSchoolIsolation: (req: Request, res: Response, next: NextFunction) => void;
    rateLimitLogin: (maxAttempts?: number, windowMs?: number) => (req: Request, res: Response, next: NextFunction) => void;
    updateLoginAttempts: (req: Request, success: boolean) => void;
    requireSchoolAdmin: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
    requireTeacher: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
    requireStudentAccess: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
    requireParent: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
    requireSuperadmin: (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
    validateOwnership: (userIdField?: string) => (req: Request, res: Response, next: NextFunction) => void;
    authenticateApiKey: (req: Request, res: Response, next: NextFunction) => void;
};
export default _default;
//# sourceMappingURL=auth.d.ts.map