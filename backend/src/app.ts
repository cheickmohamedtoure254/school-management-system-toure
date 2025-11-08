import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import config from "./app/config";
import { globalErrorHandler } from "./app/middlewares/globalErrorHandler";
import { notFound } from "./app/middlewares/notFound";
import { optionalAuth } from "./app/middlewares/auth";
import { attachSchoolContext } from "./app/middlewares/schoolContext";
import {
  schoolRateLimiter,
  strictRateLimiter,
} from "./app/middlewares/schoolRateLimiter";
import {
  trackSchoolMetrics,
  trackAggregatedMetrics,
} from "./app/middlewares/schoolMetrics";
import router from "./app/routes";

const app: Application = express();

// Render & other hosting providers sit behind proxies; trust the first proxy so
// secure cookies (with the Secure flag) and req.secure are handled correctly.
app.set("trust proxy", 1);

// Security middleware
app.use(helmet());

// Handle preflight requests before rate limiting
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,PUT,POST,DELETE,PATCH,OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept, Origin"
  );
  res.header("Access-Control-Allow-Credentials", "true");
  res.sendStatus(200);
});

// Rate limiting - more permissive in development
const limiter = rateLimit({
  windowMs: config.rate_limit_window_ms,
  max:
    config.node_env === "development" ? 1000 : config.rate_limit_max_requests, // 1000 requests in dev, 100 in prod
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks and docs in development
    if (
      config.node_env === "development" &&
      (req.url === "/health" || req.url === "/api/docs")
    ) {
      return true;
    }
    return false;
  },
});
app.use("/api/", limiter);

// CORS configuration - more permissive in development
app.use(
  cors({
    origin: function (origin, callback) {
      // In development, allow all localhost origins
      if (config.node_env === "development") {
        if (
          !origin ||
          origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:")
        ) {
          console.log(`[CORS] Allowed dev origin: ${origin || "no-origin"}`);
          return callback(null, true);
        }
      }

      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        console.log("[CORS] Allowed request with no origin (mobile/curl)");
        return callback(null, true);
      }

      const allowedOrigins = [
        "http://localhost:3000",
        "http://localhost:5173", // Vite dev server
        config.frontend_url,
      ].filter(Boolean); // Remove undefined values

      console.log(
        `[CORS] Checking origin: ${origin} against allowed: ${allowedOrigins.join(
          ", "
        )}`
      );

      if (allowedOrigins.indexOf(origin) !== -1) {
        console.log(`[CORS] ✓ Origin allowed: ${origin}`);
        callback(null, true);
      } else {
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
    exposedHeaders: ["Set-Cookie"], // Important for cross-domain cookies
    preflightContinue: false,
    optionsSuccessStatus: 200,
  })
);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "School Management API is running successfully",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    environment: config.node_env,
  });
});

// API documentation endpoint
app.get("/api/docs", (req: Request, res: Response) => {
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

// API routes with multi-tenancy middlewares
// Apply optional auth + school context before metrics/rate limiting so schoolId is available
app.use("/api", optionalAuth);
app.use("/api", attachSchoolContext);
app.use("/api", trackSchoolMetrics); // Track all API requests per school
app.use("/api", trackAggregatedMetrics); // Aggregate metrics for dashboard
app.use("/api", schoolRateLimiter); // Per-school rate limiting (after context attachment)
app.use("/api", router);

// 404 handler
app.use(notFound);

// Global error handler
app.use(globalErrorHandler);

export default app;
