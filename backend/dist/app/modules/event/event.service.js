"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventService = void 0;
const event_model_1 = require("./event.model");
const AppError_1 = require("../../errors/AppError");
const createEvent = async (eventData, userId) => {
    const event = new event_model_1.Event({
        ...eventData,
        createdBy: userId,
    });
    await event.save();
    return event.populate([
        { path: "schoolId", select: "name" },
        { path: "createdBy", select: "firstName lastName" },
    ]);
};
const getEvents = async (schoolId, userRole, userGrade, userSection, filters) => {
    const { type, startDate, endDate, grade, section, page = 1, limit = 20, isActive = true, } = filters || {};
    const query = {
        isActive,
        "targetAudience.roles": { $in: [userRole] },
    };
    if (userRole !== "superadmin" &&
        schoolId &&
        schoolId.toString() !== "system") {
        query.schoolId = schoolId;
    }
    if (type) {
        query.type = type;
    }
    if (startDate || endDate) {
        query.date = {};
        if (startDate)
            query.date.$gte = new Date(startDate);
        if (endDate)
            query.date.$lte = new Date(endDate);
    }
    if (userRole === "student" || userRole === "parent") {
        const gradeConditions = [];
        const sectionConditions = [];
        if (userGrade) {
            gradeConditions.push({ "targetAudience.grades": { $size: 0 } }, { "targetAudience.grades": { $in: [userGrade] } });
        }
        if (userSection) {
            sectionConditions.push({ "targetAudience.sections": { $size: 0 } }, { "targetAudience.sections": { $in: [userSection] } });
        }
        const mongoQuery = query;
        if (gradeConditions.length > 0 && sectionConditions.length > 0) {
            mongoQuery.$and = mongoQuery.$and || [];
            mongoQuery.$and.push({ $or: gradeConditions }, { $or: sectionConditions });
        }
        else if (gradeConditions.length > 0) {
            mongoQuery.$or = gradeConditions;
        }
        else if (sectionConditions.length > 0) {
            mongoQuery.$or = sectionConditions;
        }
    }
    if (grade && (userRole === "admin" || userRole === "teacher")) {
        query["targetAudience.grades"] = { $in: [grade] };
    }
    if (section && (userRole === "admin" || userRole === "teacher")) {
        query["targetAudience.sections"] = { $in: [section] };
    }
    const skip = (page - 1) * limit;
    const [events, total] = await Promise.all([
        event_model_1.Event.find(query)
            .populate([
            { path: "schoolId", select: "name" },
            { path: "createdBy", select: "firstName lastName" },
        ])
            .sort({ date: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        event_model_1.Event.countDocuments(query),
    ]);
    return {
        events,
        total,
        page,
        limit,
    };
};
const getTodaysEvents = async (schoolId, userRole, userGrade, userSection) => {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    const query = {
        isActive: true,
        "targetAudience.roles": { $in: [userRole] },
        date: {
            $gte: startOfDay,
            $lte: endOfDay,
        },
    };
    if (userRole !== "superadmin" &&
        schoolId &&
        schoolId.toString() !== "system") {
        query.schoolId = schoolId;
    }
    if (userRole === "student" || userRole === "parent") {
        const gradeConditions = [];
        const sectionConditions = [];
        if (userGrade) {
            gradeConditions.push({ "targetAudience.grades": { $size: 0 } }, { "targetAudience.grades": { $in: [userGrade] } });
        }
        if (userSection) {
            sectionConditions.push({ "targetAudience.sections": { $size: 0 } }, { "targetAudience.sections": { $in: [userSection] } });
        }
        const mongoQuery = query;
        if (gradeConditions.length > 0 && sectionConditions.length > 0) {
            mongoQuery.$and = mongoQuery.$and || [];
            mongoQuery.$and.push({ $or: gradeConditions }, { $or: sectionConditions });
        }
        else if (gradeConditions.length > 0) {
            mongoQuery.$or = gradeConditions;
        }
        else if (sectionConditions.length > 0) {
            mongoQuery.$or = sectionConditions;
        }
    }
    return event_model_1.Event.find(query)
        .populate([
        { path: "schoolId", select: "name" },
        { path: "createdBy", select: "firstName lastName" },
    ])
        .sort({ time: 1, createdAt: -1 })
        .lean();
};
const getEventById = async (id, schoolId) => {
    const event = await event_model_1.Event.findOne({ _id: id, schoolId })
        .populate([
        { path: "schoolId", select: "name" },
        { path: "createdBy", select: "firstName lastName" },
    ])
        .lean();
    if (!event) {
        throw new AppError_1.AppError(404, "Event not found");
    }
    return event;
};
const updateEvent = async (id, updateData, schoolId, userId) => {
    const event = await event_model_1.Event.findOne({ _id: id, schoolId });
    if (!event) {
        throw new AppError_1.AppError(404, "Event not found");
    }
    const user = await event_model_1.Event.findById(userId);
    if (event.createdBy.toString() !== userId.toString() && user) {
    }
    Object.assign(event, updateData);
    await event.save();
    return event.populate([
        { path: "schoolId", select: "name" },
        { path: "createdBy", select: "firstName lastName" },
    ]);
};
const deleteEvent = async (id, schoolId, userId) => {
    const event = await event_model_1.Event.findOne({ _id: id, schoolId });
    if (!event) {
        throw new AppError_1.AppError(404, "Event not found");
    }
    if (event.createdBy.toString() !== userId.toString()) {
    }
    await event_model_1.Event.findByIdAndDelete(id);
};
const getUpcomingEvents = async (schoolId, userRole, userGrade, userSection, limit = 5) => {
    const now = new Date();
    const query = {
        isActive: true,
        "targetAudience.roles": { $in: [userRole] },
        date: { $gte: now },
    };
    if (userRole !== "superadmin" &&
        schoolId &&
        schoolId.toString() !== "system") {
        query.schoolId = schoolId;
    }
    if (userRole === "student" || userRole === "parent") {
        if (userGrade) {
            query["targetAudience.grades"] = { $in: [userGrade] };
        }
        if (userSection) {
            query["targetAudience.sections"] = { $in: [userSection] };
        }
    }
    return event_model_1.Event.find(query)
        .populate([
        { path: "schoolId", select: "name" },
        { path: "createdBy", select: "firstName lastName" },
    ])
        .sort({ date: 1, time: 1 })
        .limit(limit)
        .lean();
};
exports.eventService = {
    createEvent,
    getEvents,
    getTodaysEvents,
    getEventById,
    updateEvent,
    deleteEvent,
    getUpcomingEvents,
};
//# sourceMappingURL=event.service.js.map