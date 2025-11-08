"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = __importDefault(require("./app/config"));
const globalErrorHandler_1 = require("./app/middlewares/globalErrorHandler");
const notFound_1 = require("./app/middlewares/notFound");
const auth_1 = require("./app/middlewares/auth");
const schoolContext_1 = require("./app/middlewares/schoolContext");
const schoolRateLimiter_1 = require("./app/middlewares/schoolRateLimiter");
const schoolMetrics_1 = require("./app/middlewares/schoolMetrics");
const routes_1 = __importDefault(require("./app/routes"));
const app = (0, express_1.default)();
app.set("trust proxy", 1);
app.use((0, helmet_1.default)());
app.options("*", (req, res) => {
    res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,PATCH,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    res.sendStatus(200);
});
const limiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.default.rate_limit_window_ms,
    max: config_1.default.node_env === "development" ? 1000 : config_1.default.rate_limit_max_requests,
    message: "Too many requests from this IP, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        if (config_1.default.node_env === "development" &&
            (req.url === "/health" || req.url === "/api/docs")) {
            return true;
        }
        return false;
    },
});
app.use("/api/", limiter);
app.use((0, cors_1.default)({
    origin: function (origin, callback) {
        if (config_1.default.node_env === "development") {
            if (!origin ||
                origin.startsWith("http://localhost:") ||
                origin.startsWith("http://127.0.0.1:")) {
                console.log(`[CORS] Allowed dev origin: ${origin || "no-origin"}`);
                return callback(null, true);
            }
        }
        if (!origin) {
            console.log("[CORS] Allowed request with no origin (mobile/curl)");
            return callback(null, true);
        }
        const allowedOrigins = [
            "http://localhost:3000",
            "http://localhost:5173",
            config_1.default.frontend_url,
        ].filter(Boolean);
        console.log(`[CORS] Checking origin: ${origin} against allowed: ${allowedOrigins.join(", ")}`);
        if (allowedOrigins.indexOf(origin) !== -1) {
            console.log(`[CORS] ✓ Origin allowed: ${origin}`);
            callback(null, true);
        }
        else {
            console.warn(`[CORS] ✗ Blocked origin: ${origin}`);
            console.warn(`[CORS] Allowed origins: ${allowedOrigins.join(", ")}`);
            callback(new Error("Not allowed by CORS"));
        }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Accept",
        "Origin",
    ],
    exposedHeaders: ["Set-Cookie"],
    preflightContinue: false,
    optionsSuccessStatus: 200,
}));
app.use(express_1.default.json({ limit: "10mb" }));
app.use(express_1.default.urlencoded({ extended: true, limit: "10mb" }));
app.use((0, cookie_parser_1.default)());
app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "School Management API is running successfully",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        environment: config_1.default.node_env,
    });
});
app.get("/api/docs", (req, res) => {
    res.status(200).json({
        success: true,
        message: "School Management System API Documentation",
        version: "1.0.0",
        baseUrl: "/api",
        endpoints: {
            auth: "/api/auth",
            superadmin: "/api/superadmin",
            admin: "/api/admin",
            teacher: "/api/teacher",
            student: "/api/student",
            parent: "/api/parent",
            accountant: "/api/accountant",
        },
        health: "/health",
    });
});
app.use("/api", auth_1.optionalAuth);
app.use("/api", schoolContext_1.attachSchoolContext);
app.use("/api", schoolMetrics_1.trackSchoolMetrics);
app.use("/api", schoolMetrics_1.trackAggregatedMetrics);
app.use("/api", schoolRateLimiter_1.schoolRateLimiter);
app.use("/api", routes_1.default);
app.use(notFound_1.notFound);
app.use(globalErrorHandler_1.globalErrorHandler);
exports.default = app;
//# sourceMappingURL=app.js.map