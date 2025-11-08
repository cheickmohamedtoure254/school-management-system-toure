import { Request, Response } from "express";
declare const createUser: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const getUsers: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const getUserById: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const updateUser: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const deleteUser: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const changePassword: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const forcePasswordChange: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const verify: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const resetPassword: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const login: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const logout: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const getCurrentUser: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const getUsersBySchool: (req: Request, res: Response, next: import("express").NextFunction) => void;
declare const getUsersByRole: (req: Request, res: Response, next: import("express").NextFunction) => void;
export { createUser, getUsers, getUserById, updateUser, deleteUser, changePassword, forcePasswordChange, verify, resetPassword, login, logout, getCurrentUser, getUsersBySchool, getUsersByRole, };
//# sourceMappingURL=user.controller.d.ts.map