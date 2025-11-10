import React from "react";
import { Link } from "react-router-dom";
import { School, Users, Activity, UserCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { SuperadminHomeProps } from "./types";

const SuperadminHome: React.FC<SuperadminHomeProps> = ({
  stats,
  schools,
  loading,
  user,
}) => {
  // Ensure schools is always an array for safe operations
  const safeSchools = Array.isArray(schools) ? schools : [];
  const pendingSchools = safeSchools.filter(
    (school) => school.status === "pending_approval"
  );
  const statCards = [
    {
      title: "Total Schools",
      value: stats?.totalSchools || 0,
      icon: School,
      description: "Schools in the system",
      color: "text-blue-600",
      bgColor: "bg-blue-100",
    },
    {
      title: "Total Students",
      value: stats?.totalStudents || 0,
      icon: Users,
      description: "Enrolled students",
      color: "text-green-600",
      bgColor: "bg-green-100",
    },
    {
      title: "Total Teachers",
      value: stats?.totalTeachers || 0,
      icon: UserCheck,
      description: "Teaching staff",
      color: "text-purple-600",
      bgColor: "bg-purple-100",
    },
    {
      title: "Active Schools",
      value: stats?.activeSchools || 0,
      icon: Activity,
      description: "Currently operational",
      color: "text-emerald-600",
      bgColor: "bg-emerald-100",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Welcome Header with Role Guidance */}
        <div className="bg-gradient-to-r from-purple-600 via-blue-600 to-indigo-600 rounded-2xl shadow-2xl p-8 text-white">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between">
            <div className="mb-4 lg:mb-0">
              <h1 className="text-3xl sm:text-4xl font-bold mb-3">
                System Control Center
              </h1>
              <p className="text-purple-100 text-lg mb-4">
                Welcome back, {user?.username || "Admin"}! Manage schools,
                organizations, and oversee the entire SMS platform
              </p>
              <div className="flex items-center space-x-6">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-green-400 rounded-full mr-2 animate-pulse"></div>
                  <span className="text-sm">All Systems Operational</span>
                </div>
                <div className="text-sm opacity-90">
                  Last updated: {new Date().toLocaleString()}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="bg-white/20 px-2 py-1 rounded-full">
                  🏢 Manage Organizations
                </span>
                <span className="bg-white/20 px-2 py-1 rounded-full">
                  🏫 Oversee Schools
                </span>
                <span className="bg-white/20 px-2 py-1 rounded-full">
                  👥 Monitor Admins
                </span>
              </div>
            </div>
            <div className="bg-white/10 rounded-lg p-4 backdrop-blur-sm">
              <div className="flex items-center text-sm">
                <svg
                  className="w-5 h-5 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 12l2 2 4-4m5.992-4.502a9 9 0 11-3.15 3.15l1.67-1.676zm0 0L13.5 7.5"
                  />
                </svg>
                <span>System Administrator</span>
              </div>
            </div>
          </div>
        </div>

        {/* Statistics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((stat) => (
            <Card
              key={stat.title}
              className="bg-white/80 backdrop-blur-sm border-0 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-sm font-semibold text-gray-700">
                  {stat.title}
                </CardTitle>
                <div className={`p-3 rounded-xl ${stat.bgColor} shadow-lg`}>
                  <stat.icon className={`h-6 w-6 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-gray-900 mb-2">
                  {loading
                    ? "..."
                    : typeof stat.value === "number"
                    ? stat.value.toLocaleString()
                    : stat.value}
                </div>
                <p className="text-sm text-gray-600">{stat.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Data Flow Visualization */}
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 mb-8">
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-4 flex items-center">
            <svg
              className="w-6 h-6 mr-2 text-purple-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            System Setup Workflow
          </h3>
          <div className="flex flex-col lg:flex-row items-center justify-between space-y-4 lg:space-y-0 lg:space-x-4">
            {/* Step 1: Organization */}
            <div className="flex-1 bg-white rounded-lg p-4 shadow-sm border-2 border-purple-200 hover:border-purple-300 transition-colors">
              <div className="text-center">
                <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-white font-bold">1</span>
                </div>
                <h4 className="font-semibold text-gray-900 text-sm">
                  Create Organization
                </h4>
                <p className="text-xs text-gray-600 mt-1">
                  Educational institution setup
                </p>
                <div className="mt-2 text-xs text-purple-600 font-medium">
                  Your First Step
                </div>
              </div>
            </div>

            <div className="text-gray-400">
              <svg
                className="w-6 h-6 rotate-90 lg:rotate-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>

            {/* Step 2: School */}
            <div className="flex-1 bg-white rounded-lg p-4 shadow-sm border-2 border-blue-200 hover:border-blue-300 transition-colors">
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-white font-bold">2</span>
                </div>
                <h4 className="font-semibold text-gray-900 text-sm">
                  Add School
                </h4>
                <p className="text-xs text-gray-600 mt-1">Under organization</p>
                <div className="mt-2 text-xs text-blue-600 font-medium">
                  Physical Locations
                </div>
              </div>
            </div>

            <div className="text-gray-400">
              <svg
                className="w-6 h-6 rotate-90 lg:rotate-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>

            {/* Step 3: Admin */}
            <div className="flex-1 bg-white rounded-lg p-4 shadow-sm border-2 border-green-200 hover:border-green-300 transition-colors">
              <div className="text-center">
                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-white font-bold">3</span>
                </div>
                <h4 className="font-semibold text-gray-900 text-sm">
                  Assign Admin
                </h4>
                <p className="text-xs text-gray-600 mt-1">
                  School administrator
                </p>
                <div className="mt-2 text-xs text-green-600 font-medium">
                  Local Management
                </div>
              </div>
            </div>

            <div className="text-gray-400">
              <svg
                className="w-6 h-6 rotate-90 lg:rotate-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>

            {/* Step 4: Management */}
            <div className="flex-1 bg-white rounded-lg p-4 shadow-sm border-2 border-orange-200 hover:border-orange-300 transition-colors">
              <div className="text-center">
                <div className="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-white font-bold">4</span>
                </div>
                <h4 className="font-semibold text-gray-900 text-sm">
                  Admin Manages
                </h4>
                <p className="text-xs text-gray-600 mt-1">
                  Teachers & Students
                </p>
                <div className="mt-2 text-xs text-orange-600 font-medium">
                  Daily Operations
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-800 text-center">
              <strong>Key:</strong> You create the foundation (Organizations &
              Schools), then Admins handle day-to-day operations
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pending Schools */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <svg
                  className="w-5 h-5 mr-2 text-amber-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Pending Schools
                {pendingSchools.length > 0 && (
                  <span className="ml-2 bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">
                    {pendingSchools.length}
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                Schools awaiting approval - requires immediate attention
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pendingSchools.length > 0 ? (
                <div className="space-y-4">
                  {pendingSchools.slice(0, 5).map((school, index) => (
                    <div
                      key={school.id || index}
                      className="flex items-center justify-between p-4 border-2 border-amber-200 bg-amber-50 rounded-lg hover:border-amber-300 hover:bg-amber-100 transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      <div className="flex items-center">
                        <div className="relative w-12 h-12 bg-amber-200 rounded-full flex items-center justify-center mr-4 border-2 border-amber-300">
                          <svg
                            className="w-6 h-6 text-amber-700"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2"
                              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5"
                            />
                          </svg>
                          <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center animate-pulse">
                            <span className="text-white text-xs font-bold">
                              !
                            </span>
                          </div>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {school.name || "School Name"}
                          </p>
                          <p className="text-sm text-gray-500">
                            {typeof school.address === "string"
                              ? school.address
                              : school.address
                              ? `${school.address.street}, ${school.address.city}`
                              : "Location"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end space-y-2">
                        <div className="flex items-center space-x-2">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 animate-pulse">
                            <svg
                              className="w-3 h-3 mr-1"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2"
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            Pending Approval
                          </span>
                        </div>
                        <p className="text-xs text-gray-400">
                          Submitted:{" "}
                          {school.createdAt
                            ? new Date(school.createdAt).toLocaleDateString()
                            : "N/A"}
                        </p>
                        <div className="flex space-x-1">
                          <button
                            className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded transition-colors duration-200 font-medium"
                            onClick={() => {
                              // TODO: Implement approve functionality
                            }}
                          >
                            ✓ Approve
                          </button>
                          <button
                            className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors duration-200 font-medium"
                            onClick={() => {
                              // TODO: Implement reject functionality
                            }}
                          >
                            ✗ Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  {loading ? (
                    <div className="flex flex-col items-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mb-2"></div>
                      <p className="text-gray-500">Loading schools...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <svg
                        className="w-12 h-12 text-green-400 mb-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <p className="text-green-600 font-medium mb-2">
                        All caught up!
                      </p>
                      <p className="text-xs text-gray-400">
                        No schools pending approval at the moment.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {pendingSchools.length > 5 && (
                <div className="mt-4 text-center">
                  <Link
                    to="/superadmin/schools?filter=pending"
                    className="inline-flex items-center px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors duration-200"
                  >
                    View All Pending Schools
                    <svg
                      className="w-4 h-4 ml-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>{" "}
          {/* System Health with Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <svg
                  className="w-5 h-5 mr-2 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                System Health & Quick Actions
              </CardTitle>
              <CardDescription>
                Overall system performance metrics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    Server Status
                  </span>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    <span className="w-2 h-2 bg-green-500 rounded-full mr-1"></span>
                    Online
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    Database
                  </span>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    <span className="w-2 h-2 bg-green-500 rounded-full mr-1"></span>
                    Connected
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    Active Schools
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {stats?.activeSchools || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    Pending Schools
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {stats?.pendingSchools || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    Total Parents
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {stats?.totalParents || 0}
                  </span>
                </div>
              </div>

              {/* Quick Action Buttons */}
              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                  Quick Actions
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Link
                    to="/superadmin/schools"
                    className="group bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white p-4 rounded-xl text-sm font-semibold transition-all duration-300 shadow-md hover:shadow-xl active:scale-95 hover:scale-105 text-center block"
                  >
                    <div className="flex flex-col items-center">
                      <School className="w-6 h-6 mb-2 group-hover:scale-110 transition-transform duration-300" />
                      Manage Schools
                    </div>
                  </Link>

                  <Link
                    to="/superadmin/reports"
                    className="group bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white p-4 rounded-xl text-sm font-semibold transition-all duration-300 shadow-md hover:shadow-xl active:scale-95 hover:scale-105 text-center block"
                  >
                    <div className="flex flex-col items-center">
                      <svg
                        className="w-6 h-6 mb-2 group-hover:scale-110 transition-transform duration-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      View Reports
                    </div>
                  </Link>

                  <Link
                    to="/superadmin/system-config"
                    className="group bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white p-4 rounded-xl text-sm font-semibold transition-all duration-300 shadow-md hover:shadow-xl active:scale-95 hover:scale-105 text-center block"
                  >
                    <div className="flex flex-col items-center">
                      <svg
                        className="w-6 h-6 mb-2 group-hover:scale-110 transition-transform duration-300"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      System Settings
                    </div>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SuperadminHome;
