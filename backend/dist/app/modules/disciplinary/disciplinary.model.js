"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedWarrant = exports.Punishment = exports.DisciplinaryAction = void 0;
const mongoose_1 = require("mongoose");
const punishmentSchema = new mongoose_1.Schema({
    disciplinaryActionId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "DisciplinaryAction",
        required: true,
        index: true,
    },
    punishmentType: {
        type: String,
        enum: [
            "detention",
            "suspension",
            "community_service",
            "restriction",
            "counseling",
        ],
        required: true,
    },
    duration: {
        type: Number,
        min: 1,
        max: 365,
    },
    startDate: {
        type: Date,
        required: true,
    },
    endDate: {
        type: Date,
        validate: {
            validator: function (endDate) {
                return !endDate || endDate >= this.startDate;
            },
            message: "End date must be after or equal to start date",
        },
    },
    details: {
        type: String,
        required: true,
        maxlength: 1000,
    },
    location: {
        type: String,
        maxlength: 200,
    },
    supervisor: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Teacher",
    },
    conditions: [
        {
            type: String,
            maxlength: 500,
        },
    ],
    isCompleted: {
        type: Boolean,
        default: false,
    },
    completionDate: Date,
    completionNotes: {
        type: String,
        maxlength: 1000,
    },
}, {
    timestamps: true,
});
const redWarrantSchema = new mongoose_1.Schema({
    disciplinaryActionId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "DisciplinaryAction",
        required: true,
        index: true,
    },
    warrantNumber: {
        type: String,
        required: true,
        unique: true,
    },
    urgencyLevel: {
        type: String,
        enum: ["high", "critical"],
        required: true,
    },
    immediateAction: {
        type: Boolean,
        default: true,
    },
    parentMeetingRequired: {
        type: Boolean,
        default: true,
    },
    parentMeetingDate: Date,
    principalNotified: {
        type: Boolean,
        default: true,
    },
    principalNotificationDate: Date,
    escalationPath: [
        {
            type: String,
            required: true,
        },
    ],
    additionalAuthorities: [String],
}, {
    timestamps: true,
});
const disciplinaryActionSchema = new mongoose_1.Schema({
    schoolId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "School",
        required: true,
        index: true,
    },
    studentId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Student",
        required: true,
        index: true,
    },
    teacherId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "Teacher",
        required: true,
        index: true,
    },
    actionType: {
        type: String,
        enum: ["warning", "punishment", "suspension", "detention", "red_warrant"],
        required: true,
        index: true,
    },
    severity: {
        type: String,
        enum: ["low", "medium", "high", "critical"],
        required: true,
        index: true,
    },
    category: {
        type: String,
        enum: [
            "behavior",
            "attendance",
            "academic",
            "discipline",
            "uniform",
            "other",
        ],
        required: true,
        index: true,
    },
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200,
    },
    description: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000,
    },
    reason: {
        type: String,
        required: true,
        trim: true,
        maxlength: 500,
    },
    incidentDate: {
        type: Date,
        required: true,
        index: true,
    },
    issuedDate: {
        type: Date,
        default: Date.now,
        index: true,
    },
    status: {
        type: String,
        enum: ["active", "acknowledged", "resolved", "appealed"],
        default: "active",
        index: true,
    },
    actionTaken: {
        type: String,
        maxlength: 1000,
    },
    followUpRequired: {
        type: Boolean,
        default: false,
    },
    followUpDate: {
        type: Date,
        index: true,
    },
    parentNotified: {
        type: Boolean,
        default: false,
    },
    parentNotificationDate: Date,
    parentResponse: {
        type: String,
        maxlength: 1000,
    },
    studentAcknowledged: {
        type: Boolean,
        default: false,
    },
    studentAcknowledgmentDate: Date,
    studentResponse: {
        type: String,
        maxlength: 1000,
    },
    witnesses: [String],
    evidenceAttachments: [String],
    academicYear: {
        type: String,
        required: true,
        match: /^\d{4}-\d{4}$/,
        index: true,
    },
    term: {
        type: String,
        enum: ["first", "second", "third", "annual"],
    },
    points: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
    },
    isAppealable: {
        type: Boolean,
        default: true,
    },
    appealDeadline: Date,
    resolvedDate: Date,
    resolvedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
    },
    resolutionNotes: {
        type: String,
        maxlength: 1000,
    },
    relatedIncidents: [
        {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: "DisciplinaryAction",
        },
    ],
    isRedWarrant: {
        type: Boolean,
        default: false,
        index: true,
    },
    warrantLevel: {
        type: String,
        enum: ["yellow", "orange", "red"],
    },
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    updatedBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
    },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
disciplinaryActionSchema.methods.escalate =
    async function () {
        const currentSeverity = this.severity;
        const escalationMap = {
            low: "medium",
            medium: "high",
            high: "critical",
        };
        if (escalationMap[currentSeverity]) {
            this.severity = escalationMap[currentSeverity];
            this.followUpRequired = true;
            this.followUpDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            if (this.severity === "critical") {
                this.isRedWarrant = true;
                this.warrantLevel = "red";
                this.actionType = "red_warrant";
            }
            return await this.save();
        }
        return this;
    };
disciplinaryActionSchema.methods.acknowledge = async function (acknowledgedBy, response) {
    if (acknowledgedBy === "student") {
        this.studentAcknowledged = true;
        this.studentAcknowledgmentDate = new Date();
        if (response)
            this.studentResponse = response;
    }
    else {
        this.parentNotified = true;
        this.parentNotificationDate = new Date();
        if (response)
            this.parentResponse = response;
    }
    if (this.studentAcknowledged && this.parentNotified) {
        this.status = "acknowledged";
    }
    return await this.save();
};
disciplinaryActionSchema.methods.resolve = async function (resolvedBy, resolutionNotes) {
    this.status = "resolved";
    this.resolvedDate = new Date();
    this.resolvedBy = resolvedBy;
    this.resolutionNotes = resolutionNotes;
    return await this.save();
};
disciplinaryActionSchema.methods.isOverdue = function () {
    if (!this.followUpRequired || !this.followUpDate)
        return false;
    return new Date() > this.followUpDate && this.status !== "resolved";
};
disciplinaryActionSchema.methods.canAppeal = function () {
    if (!this.isAppealable || !this.appealDeadline)
        return false;
    return new Date() < this.appealDeadline && this.status !== "resolved";
};
disciplinaryActionSchema.methods.getEscalationLevel = function () {
    const escalationLevels = {
        low: "Level 1",
        medium: "Level 2",
        high: "Level 3",
        critical: "Level 4 (Critical)",
    };
    return (escalationLevels[this.severity] ||
        "Unknown");
};
disciplinaryActionSchema.methods.notifyParents =
    async function () {
        return true;
    };
disciplinaryActionSchema.methods.notifyStudent =
    async function () {
        return true;
    };
disciplinaryActionSchema.methods.addFollowUp = async function (followUpNotes) {
    this.resolutionNotes =
        (this.resolutionNotes || "") + "\n\nFollow-up: " + followUpNotes;
    this.followUpDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    return await this.save();
};
disciplinaryActionSchema.statics.findByStudent = function (studentId, filters = {}) {
    const query = { studentId, ...filters };
    return this.find(query)
        .populate("teacherId", "userId teacherId designation")
        .populate("studentId", "userId rollNumber grade section")
        .populate("resolvedBy", "firstName lastName")
        .sort({ issuedDate: -1 });
};
disciplinaryActionSchema.statics.findByTeacher = function (teacherId, filters = {}) {
    const query = { teacherId, ...filters };
    return this.find(query)
        .populate("teacherId", "userId teacherId designation")
        .populate("studentId", "userId rollNumber grade section")
        .populate("resolvedBy", "firstName lastName")
        .sort({ issuedDate: -1 });
};
disciplinaryActionSchema.statics.findBySchool = function (schoolId, filters = {}) {
    const query = { schoolId, ...filters };
    return this.find(query)
        .populate("teacherId", "userId teacherId designation")
        .populate("studentId", "userId rollNumber grade section")
        .populate("resolvedBy", "firstName lastName")
        .sort({ issuedDate: -1 });
};
disciplinaryActionSchema.statics.getStudentDisciplinaryHistory =
    async function (studentId) {
        const actions = await this.find({ studentId })
            .populate("teacherId", "userId teacherId designation")
            .sort({ issuedDate: -1 });
        const totalPoints = actions.reduce((sum, action) => sum + (action.points || 0), 0);
        const activeActions = actions.filter((action) => action.status === "active").length;
        const redWarrants = actions.filter((action) => action.isRedWarrant).length;
        return {
            totalActions: actions.length,
            activeActions,
            resolvedActions: actions.filter((action) => action.status === "resolved").length,
            totalPoints,
            redWarrants,
            recentActions: actions.slice(0, 5),
            severityBreakdown: {
                low: actions.filter((a) => a.severity === "low").length,
                medium: actions.filter((a) => a.severity === "medium").length,
                high: actions.filter((a) => a.severity === "high").length,
                critical: actions.filter((a) => a.severity === "critical").length,
            },
            categoryBreakdown: {
                behavior: actions.filter((a) => a.category === "behavior").length,
                attendance: actions.filter((a) => a.category === "attendance")
                    .length,
                academic: actions.filter((a) => a.category === "academic").length,
                discipline: actions.filter((a) => a.category === "discipline")
                    .length,
                uniform: actions.filter((a) => a.category === "uniform").length,
                other: actions.filter((a) => a.category === "other").length,
            },
        };
    };
disciplinaryActionSchema.statics.getClassDisciplinaryStats = async function (schoolId, grade, section) {
    const matchQuery = { schoolId };
    const studentQuery = { schoolId, grade };
    if (section)
        studentQuery.section = section;
    const { Student } = await Promise.resolve().then(() => __importStar(require("../student/student.model")));
    const students = await Student.find(studentQuery);
    const studentIds = students.map((s) => s._id);
    matchQuery.studentId = { $in: studentIds };
    const stats = await this.aggregate([
        { $match: matchQuery },
        {
            $group: {
                _id: null,
                totalActions: { $sum: 1 },
                activeActions: {
                    $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
                },
                redWarrants: {
                    $sum: { $cond: [{ $eq: ["$isRedWarrant", true] }, 1, 0] },
                },
                totalPoints: { $sum: "$points" },
                severityBreakdown: {
                    $push: "$severity",
                },
                categoryBreakdown: {
                    $push: "$category",
                },
            },
        },
    ]);
    return (stats[0] || {
        totalActions: 0,
        activeActions: 0,
        redWarrants: 0,
        totalPoints: 0,
        severityBreakdown: [],
        categoryBreakdown: [],
    });
};
disciplinaryActionSchema.statics.issueRedWarrant = async function (data) {
    const actions = [];
    for (const studentId of data.studentIds || []) {
        const action = await this.create({
            studentId,
            actionType: "red_warrant",
            severity: "critical",
            category: data.category || "behavior",
            title: data.title,
            description: data.description,
            reason: data.reason,
            isRedWarrant: true,
            warrantLevel: "red",
            status: "active",
            issuedDate: new Date(),
        });
        actions.push(action);
    }
    return { redWarrants: actions };
};
disciplinaryActionSchema.statics.escalateWarning = async function (actionId, escalationReason) {
    const action = await this.findById(actionId);
    if (!action)
        throw new Error("Disciplinary action not found");
    return action;
};
disciplinaryActionSchema.statics.getDisciplinaryStats = async function (schoolId, filters = {}) {
    const mongoose = require("mongoose");
    const matchQuery = {
        schoolId: new mongoose.Types.ObjectId(schoolId),
        ...filters,
    };
    const [stats] = await this.aggregate([
        { $match: matchQuery },
        {
            $group: {
                _id: null,
                totalActions: { $sum: 1 },
                activeActions: {
                    $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
                },
                resolvedActions: {
                    $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] },
                },
                pendingAcknowledgment: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ["$status", "active"] },
                                    { $eq: ["$studentAcknowledged", false] },
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
                redWarrants: {
                    $sum: { $cond: [{ $eq: ["$isRedWarrant", true] }, 1, 0] },
                },
                severityBreakdown: {
                    $push: "$severity",
                },
                categoryBreakdown: {
                    $push: "$category",
                },
            },
        },
    ]);
    const overdueFollowUps = await this.countDocuments({
        schoolId: new mongoose.Types.ObjectId(schoolId),
        ...filters,
        followUpRequired: true,
        followUpDate: { $lt: new Date() },
        status: { $ne: "resolved" },
    });
    return {
        totalActions: stats?.totalActions || 0,
        activeActions: stats?.activeActions || 0,
        resolvedActions: stats?.resolvedActions || 0,
        pendingAcknowledgment: stats?.pendingAcknowledgment || 0,
        overdueFollowUps,
        redWarrants: stats?.redWarrants || 0,
        bySeverity: {
            low: stats?.severityBreakdown.filter((s) => s === "low").length || 0,
            medium: stats?.severityBreakdown.filter((s) => s === "medium").length ||
                0,
            high: stats?.severityBreakdown.filter((s) => s === "high").length ||
                0,
            critical: stats?.severityBreakdown.filter((s) => s === "critical")
                .length || 0,
        },
        byCategory: {
            behavior: stats?.categoryBreakdown.filter((c) => c === "behavior")
                .length || 0,
            attendance: stats?.categoryBreakdown.filter((c) => c === "attendance")
                .length || 0,
            academic: stats?.categoryBreakdown.filter((c) => c === "academic")
                .length || 0,
            discipline: stats?.categoryBreakdown.filter((c) => c === "discipline")
                .length || 0,
            uniform: stats?.categoryBreakdown.filter((c) => c === "uniform")
                .length || 0,
            other: stats?.categoryBreakdown.filter((c) => c === "other").length ||
                0,
        },
        byGrade: [],
        recentTrends: [],
    };
};
disciplinaryActionSchema.statics.getOverdueActions = function (schoolId) {
    return this.find({
        schoolId,
        followUpRequired: true,
        followUpDate: { $lt: new Date() },
        status: { $ne: "resolved" },
    })
        .populate("teacherId", "userId teacherId")
        .populate("studentId", "userId rollNumber grade section")
        .sort({ followUpDate: 1 });
};
disciplinaryActionSchema.statics.generateDisciplinaryReport = async function (schoolId, filters) {
    const actions = await this.find({ schoolId, ...filters })
        .populate("teacherId", "userId teacherId designation")
        .populate("studentId", "userId rollNumber grade section")
        .sort({ issuedDate: -1 });
    return {
        summary: await this.getDisciplinaryStats(schoolId, filters),
        actions,
        generatedAt: new Date(),
        filters,
    };
};
disciplinaryActionSchema.index({ schoolId: 1, studentId: 1, issuedDate: -1 });
disciplinaryActionSchema.index({ schoolId: 1, teacherId: 1, issuedDate: -1 });
disciplinaryActionSchema.index({ schoolId: 1, status: 1 });
disciplinaryActionSchema.index({ schoolId: 1, isRedWarrant: 1 });
disciplinaryActionSchema.index({ schoolId: 1, severity: 1 });
disciplinaryActionSchema.index({ followUpDate: 1, status: 1 });
disciplinaryActionSchema.index({ issuedDate: -1 });
exports.DisciplinaryAction = (0, mongoose_1.model)("DisciplinaryAction", disciplinaryActionSchema);
exports.Punishment = (0, mongoose_1.model)("Punishment", punishmentSchema);
exports.RedWarrant = (0, mongoose_1.model)("RedWarrant", redWarrantSchema);
//# sourceMappingURL=disciplinary.model.js.map