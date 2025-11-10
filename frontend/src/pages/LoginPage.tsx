import React, { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/Card";
import PasswordChangeModal from "@/components/PasswordChangeModal";
import { useAuth } from "../context/AuthContext";

// Inclusive classroom photo from Pexels (free-to-use license).
// const BACKGROUND_IMAGE_URL =
//   "../../public/mixed-races-boy-little-girl-park.jpg";
// Background image served from the app `public/` folder.
// Use an absolute path so the production build (Vite/Netlify) can find it at the site root.
const BACKGROUND_IMAGE_URL = "/mixed-races-boy-little-girl-park.jpg";

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const { login, isAuthenticated, user, requiresPasswordChange } = useAuth();

  useEffect(() => {
    setError("");
  }, [username, password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    if (!username || !password) {
      setError("Please enter both username and password");
      setIsLoading(false);
      return;
    }

    const result = await login({ username, password });

    if (!result.success) {
      setError("Invalid username or password");
    }
    // If login is successful but requires password change, the modal will show automatically

    setIsLoading(false);
  };

  // Show password change modal if required
  if (isAuthenticated && requiresPasswordChange) {
    return (
      <PasswordChangeModal
        isOpen={true}
        onClose={() => {}} // Cannot close until password is changed
      />
    );
  }

  // Redirect based on role after successful login and password change is complete
  if (isAuthenticated && user && !requiresPasswordChange) {
    switch (user.role) {
      case "superadmin":
        return <Navigate to="/superadmin" replace />;
      case "admin":
        return <Navigate to="/admin" replace />;
      case "teacher":
        return <Navigate to="/teacher" replace />;
      case "student":
        return <Navigate to="/student" replace />;
      case "parent":
        return <Navigate to="/parent" replace />;
      case "accountant":
        return <Navigate to="/accountant" replace />;
      default:
        return <Navigate to="/" replace />;
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center px-4 py-8 bg-slate-950">
      <div className="absolute inset-0">
        <img
          src={BACKGROUND_IMAGE_URL}
          alt="children studying together"
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/90 via-slate-900/75 to-blue-900/85" />
      </div>

      <div className="pointer-events-none absolute -top-28 -left-24 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-float-soft" />
      <div className="pointer-events-none absolute bottom-[-6rem] right-[-4rem] h-80 w-80 rounded-full bg-sky-400/20 blur-3xl animate-float-soft-reverse" />
      <div className="pointer-events-none absolute top-1/3 right-1/5 h-24 w-24 rounded-3xl border border-white/30 backdrop-blur-sm animate-pulse" />

      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8 text-white/90">
          <div className="mx-auto w-16 h-16 bg-white/15 border border-white/20 rounded-full flex items-center justify-center mb-4 backdrop-blur-sm shadow-lg">
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold mb-2 drop-shadow-md">
            School Management
          </h1>
          <p className="text-sm text-white/80">
            Sign in to access your dashboard
          </p>
        </div>

        {/* Login Form */}
        <Card className="bg-white/20 backdrop-blur-sm border border-white/25 shadow-[0_18px_45px_rgba(15,23,42,0.35)]">
          <CardHeader className="text-center">
            <CardTitle className="text-4xl">Welcome back</CardTitle>
            <CardDescription className="text-white">
              Enter your credentials to access your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50/90 border border-red-200/80 rounded-lg shadow-sm">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <Input
                label="Username"
                name="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                disabled={isLoading}
                icon={<Mail className="w-4 h-4 text-gray-400" />}
              />

              <div className="relative">
                <Input
                  label="Password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  disabled={isLoading}
                  icon={<Lock className="w-4 h-4 text-gray-400" />}
                />
                <button
                  type="button"
                  className="absolute top-8 right-3 flex items-center justify-center h-10 text-gray-400 hover:text-gray-600 transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              <Button
                type="submit"
                className="w-full shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 transition-shadow"
                disabled={!username || !password || isLoading}
              >
                {isLoading ? "Signing in..." : "Sign in"}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  className="text-sm text-primary-600 hover:text-primary-500 transition-colors"
                  onClick={() => {
                    alert("Forgot password feature coming soon!");
                  }}
                >
                  Forgot your password?
                </button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Help & Contact Information */}
        <Card className="mt-6 bg-white/25 backdrop-blur-2xl border border-white/20 shadow-[0_12px_35px_rgba(15,23,42,0.25)]">
          <CardContent className="pt-6">
            <div className="flex items-center mb-4 text-gray-800">
              <svg
                className="w-5 h-5 text-amber-600 mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h3 className="font-semibold">Need Help with Login?</h3>
            </div>

            <div className="space-y-3 text-gray-700">
              <div className="bg-gradient-to-r from-blue-50/90 to-blue-100/90 p-3 rounded-lg border border-blue-200/70">
                <p className="font-medium text-blue-900 text-sm mb-2">
                  For Password Recovery:
                </p>
                <div className="space-y-1 text-xs text-blue-800">
                  <div className="flex items-start">
                    <span className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 mr-2 flex-shrink-0"></span>
                    <span>
                      <strong>Admins:</strong> Contact your Superadmin for
                      password reset
                    </span>
                  </div>
                  <div className="flex items-start">
                    <span className="w-2 h-2 bg-green-500 rounded-full mt-1.5 mr-2 flex-shrink-0"></span>
                    <span>
                      <strong>Teachers & Students/Parents:</strong> Contact your
                      School Admin
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-amber-50/90 p-3 rounded-lg border border-amber-200/70 text-center">
                <p className="text-amber-800 font-medium text-sm">
                  Login credentials are provided by your school administration
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
