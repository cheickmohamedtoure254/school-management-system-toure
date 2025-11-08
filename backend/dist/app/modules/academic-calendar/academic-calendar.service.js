"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.academicCalendarService = void 0;
const http_status_1 = __importDefault(require("http-status"));
const mongoose_1 = require("mongoose");
const AppError_1 = require("../../errors/AppError");
const academic_calendar_model_1 = require("./academic-calendar.model");
const school_model_1 = require("../school/school.model");
class AcademicCalendarService {
    async createCalendarEvent(eventData) {
        const session = await (0, mongoose_1.startSession)();
        session.startTransaction();
        try {
            const school = await school_model_1.School.findById(eventData.schoolId);
            if (!school) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "School not found");
            }
            if (school.status !== "active") {
                throw new AppError_1.AppError(http_status_1.default.BAD_REQUEST, "Cannot create calendar event for inactive school");
            }
            if (eventData.eventType === "exam") {
                const overlappingExam = await academic_calendar_model_1.AcademicCalendar.findOne({
                    schoolId: eventData.schoolId,
                    eventType: "exam",
                    isActive: true,
                    $or: [
                        {
                            startDate: { $lte: new Date(eventData.startDate) },
                            endDate: { $gte: new Date(eventData.startDate) },
                        },
                        {
                            startDate: { $lte: new Date(eventData.endDate) },
                            endDate: { $gte: new Date(eventData.endDate) },
                        },
                    ],
                });
                if (overlappingExam) {
                    throw new AppError_1.AppError(http_status_1.default.CONFLICT, "Another exam is already scheduled during this period");
                }
            }
            const mappedEventData = {
                schoolId: eventData.schoolId,
                eventTitle: eventData.title,
                eventDescription: eventData.description,
                eventType: eventData.eventType,
                startDate: new Date(eventData.startDate),
                endDate: new Date(eventData.endDate),
                isAllDay: eventData.isAllDay,
                startTime: eventData.startTime,
                endTime: eventData.endTime,
                venue: eventData.location,
                targetAudience: eventData.targetAudience.allSchool ? "all" : "specific",
                specificAudience: !eventData.targetAudience.allSchool
                    ? {
                        grades: eventData.targetAudience.grades?.map((g) => parseInt(g)) || [],
                        sections: eventData.targetAudience.classes || [],
                        teacherIds: eventData.targetAudience.teachers?.map((t) => new mongoose_1.Types.ObjectId(t)) || [],
                        studentIds: eventData.targetAudience.students?.map((s) => new mongoose_1.Types.ObjectId(s)) || [],
                    }
                    : undefined,
                priority: eventData.priority,
                isRecurring: eventData.isRecurring,
                recurrencePattern: eventData.isRecurring
                    ? {
                        frequency: eventData.recurrence?.frequency || "weekly",
                        interval: eventData.recurrence?.interval || 1,
                        daysOfWeek: (eventData.recurrence?.frequency || "weekly") === "weekly"
                            ? [new Date(eventData.startDate).getDay()]
                            : undefined,
                        dayOfMonth: (eventData.recurrence?.frequency || "weekly") === "monthly"
                            ? new Date(eventData.startDate).getDate()
                            : undefined,
                        endDate: eventData.recurrence?.endDate
                            ? new Date(eventData.recurrence.endDate)
                            : undefined,
                        occurrences: eventData.recurrence?.occurrences || 5,
                    }
                    : undefined,
                color: this.getDefaultColor(eventData.eventType),
                createdBy: eventData.organizerId,
                isActive: eventData.status === "published",
            };
            const newEvent = await academic_calendar_model_1.AcademicCalendar.create([mappedEventData], {
                session,
            });
            await session.commitTransaction();
            return this.formatCalendarEventResponse(newEvent[0]);
        }
        catch (error) {
            await session.abortTransaction();
            console.error("Detailed error in createCalendarEvent:", error);
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to create calendar event");
        }
        finally {
            session.endSession();
        }
    }
    async getCalendarEvents(queryParams) {
        try {
            const { page = 1, limit = 20, schoolId, eventType, startDate, endDate, targetAudience, isActive, search, sortBy = "startDate", sortOrder = "asc", } = queryParams;
            const query = { isActive: isActive !== "false" };
            if (schoolId) {
                query.schoolId = schoolId;
            }
            if (eventType && eventType !== "all") {
                query.eventType = eventType;
            }
            if (targetAudience && targetAudience !== "all") {
                query.targetAudience = targetAudience;
            }
            if (startDate || endDate) {
                query.$or = [];
                if (startDate && endDate) {
                    query.$or.push({
                        startDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
                    });
                    query.$or.push({
                        endDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
                    });
                }
                else if (startDate) {
                    query.startDate = { $gte: new Date(startDate) };
                }
                else if (endDate) {
                    query.endDate = { $lte: new Date(endDate) };
                }
            }
            if (search) {
                query.$or = [
                    { eventTitle: { $regex: search, $options: "i" } },
                    { eventDescription: { $regex: search, $options: "i" } },
                    { venue: { $regex: search, $options: "i" } },
                ];
            }
            const sortObj = {};
            sortObj[sortBy] = sortOrder === "desc" ? -1 : 1;
            const skip = (page - 1) * limit;
            const events = await academic_calendar_model_1.AcademicCalendar.find(query)
                .populate("schoolId", "name")
                .populate("createdBy", "firstName lastName username")
                .sort(sortObj)
                .skip(skip)
                .limit(limit)
                .lean();
            const totalCount = await academic_calendar_model_1.AcademicCalendar.countDocuments(query);
            const totalPages = Math.ceil(totalCount / limit);
            const formattedEvents = events.map((event) => this.formatCalendarEventResponse(event));
            return {
                events: formattedEvents,
                totalCount,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            };
        }
        catch (error) {
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to retrieve calendar events");
        }
    }
    async getCalendarEventById(id) {
        try {
            const event = await academic_calendar_model_1.AcademicCalendar.findOne({ _id: id, isActive: true })
                .populate("schoolId", "name")
                .populate("createdBy", "firstName lastName username")
                .lean();
            if (!event) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Calendar event not found");
            }
            return this.formatCalendarEventResponse(event);
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to retrieve calendar event");
        }
    }
    async updateCalendarEvent(id, updateData) {
        try {
            const updatedEvent = await academic_calendar_model_1.AcademicCalendar.findOneAndUpdate({ _id: id, isActive: true }, { ...updateData, updatedAt: new Date() }, { new: true, runValidators: true })
                .populate("schoolId", "name")
                .populate("createdBy", "firstName lastName username");
            if (!updatedEvent) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Calendar event not found");
            }
            return this.formatCalendarEventResponse(updatedEvent);
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to update calendar event");
        }
    }
    async deleteCalendarEvent(id) {
        try {
            const deletedEvent = await academic_calendar_model_1.AcademicCalendar.findOneAndUpdate({ _id: id, isActive: true }, { isActive: false, deletedAt: new Date() }, { new: true });
            if (!deletedEvent) {
                throw new AppError_1.AppError(http_status_1.default.NOT_FOUND, "Calendar event not found");
            }
        }
        catch (error) {
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to delete calendar event");
        }
    }
    async getCalendarStats(schoolId) {
        try {
            const currentYear = new Date().getFullYear();
            const startOfYear = new Date(currentYear, 0, 1);
            const endOfYear = new Date(currentYear, 11, 31);
            const stats = await academic_calendar_model_1.AcademicCalendar.aggregate([
                {
                    $match: {
                        schoolId: new mongoose_1.Types.ObjectId(schoolId),
                        isActive: true,
                        startDate: { $gte: startOfYear, $lte: endOfYear },
                    },
                },
                {
                    $group: {
                        _id: "$eventType",
                        count: { $sum: 1 },
                        upcoming: {
                            $sum: {
                                $cond: [{ $gte: ["$startDate", new Date()] }, 1, 0],
                            },
                        },
                    },
                },
            ]);
            const totalEvents = await academic_calendar_model_1.AcademicCalendar.countDocuments({
                schoolId,
                isActive: true,
                startDate: { $gte: startOfYear, $lte: endOfYear },
            });
            const upcomingEvents = await academic_calendar_model_1.AcademicCalendar.countDocuments({
                schoolId,
                isActive: true,
                startDate: { $gte: new Date() },
            });
            return {
                totalEvents,
                upcomingEvents,
                eventsByType: stats.reduce((acc, stat) => {
                    acc[stat._id] = {
                        total: stat.count,
                        upcoming: stat.upcoming,
                    };
                    return acc;
                }, {}),
            };
        }
        catch (error) {
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to retrieve calendar statistics");
        }
    }
    async createExamSchedule(examData) {
        const session = await (0, mongoose_1.startSession)();
        session.startTransaction();
        try {
            const examEvent = await academic_calendar_model_1.AcademicCalendar.create([
                {
                    schoolId: examData.schoolId,
                    eventTitle: examData.examName,
                    eventDescription: examData.description,
                    eventType: "exam",
                    startDate: new Date(examData.startDate),
                    endDate: new Date(examData.endDate),
                    isAllDay: false,
                    targetAudience: "students",
                    specificAudience: {
                        grades: examData.grades,
                    },
                    priority: "high",
                    color: "#DC2626",
                    createdBy: examData.createdBy,
                },
            ], { session });
            const examSchedules = [];
            for (const schedule of examData.examSchedules) {
                const examSchedule = await academic_calendar_model_1.AcademicCalendar.create([
                    {
                        schoolId: examData.schoolId,
                        eventTitle: `${examData.examName} - ${schedule.subjectName}`,
                        eventDescription: `${schedule.subjectName} exam for Grade ${schedule.grade}`,
                        eventType: "exam",
                        startDate: new Date(schedule.examDate),
                        endDate: new Date(schedule.examDate),
                        isAllDay: false,
                        startTime: schedule.startTime,
                        endTime: schedule.endTime,
                        targetAudience: "students",
                        specificAudience: {
                            grades: [schedule.grade],
                            sections: schedule.sections,
                        },
                        priority: "high",
                        color: "#DC2626",
                        createdBy: examData.createdBy,
                        examDetails: {
                            subjectId: schedule.subjectId,
                            totalMarks: schedule.totalMarks,
                            passingMarks: schedule.passingMarks,
                            duration: schedule.duration,
                            instructions: schedule.instructions,
                        },
                    },
                ], { session });
                examSchedules.push(examSchedule[0]);
            }
            await session.commitTransaction();
            return {
                examPeriod: this.formatCalendarEventResponse(examEvent[0]),
                examSchedules: examSchedules.map((schedule) => this.formatCalendarEventResponse(schedule)),
            };
        }
        catch (error) {
            await session.abortTransaction();
            if (error instanceof AppError_1.AppError) {
                throw error;
            }
            throw new AppError_1.AppError(http_status_1.default.INTERNAL_SERVER_ERROR, "Failed to create exam schedule");
        }
        finally {
            session.endSession();
        }
    }
    getDefaultColor(eventType) {
        const colors = {
            holiday: "#10B981",
            exam: "#DC2626",
            meeting: "#3B82F6",
            celebration: "#F59E0B",
            sports: "#8B5CF6",
            academic: "#06B6D4",
            other: "#6B7280",
        };
        return colors[eventType] || colors.other;
    }
    formatCalendarEventResponse(event) {
        const now = new Date();
        const startDate = new Date(event.startDate);
        const endDate = new Date(event.endDate);
        const duration = event.isAllDay
            ? Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) *
                24 *
                60
            : event.startTime && event.endTime
                ? this.calculateDurationInMinutes(event.startTime, event.endTime)
                : 0;
        const daysUntilEvent = Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        let status;
        if (now < startDate) {
            status = "upcoming";
        }
        else if (now > endDate) {
            status = "past";
        }
        else {
            status = "ongoing";
        }
        const formattedDateRange = this.formatDateRange(startDate, endDate, event.isAllDay);
        return {
            id: event._id.toString(),
            schoolId: typeof event.schoolId === "object"
                ? event.schoolId._id.toString()
                : event.schoolId.toString(),
            eventTitle: event.eventTitle,
            eventDescription: event.eventDescription,
            eventType: event.eventType,
            startDate: event.startDate,
            endDate: event.endDate,
            isAllDay: event.isAllDay,
            startTime: event.startTime,
            endTime: event.endTime,
            venue: event.venue,
            targetAudience: event.targetAudience,
            specificAudience: event.specificAudience,
            priority: event.priority,
            isRecurring: event.isRecurring,
            recurrencePattern: event.recurrencePattern,
            color: event.color,
            duration,
            daysUntilEvent,
            status,
            formattedDateRange,
            notificationSent: event.notificationSent,
            reminderDays: event.reminderDays,
            isActive: event.isActive,
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
            school: event.schoolId?.name
                ? {
                    id: event.schoolId._id.toString(),
                    name: event.schoolId.name,
                }
                : undefined,
            createdBy: event.createdBy
                ? {
                    id: event.createdBy._id?.toString() || event.createdBy.toString(),
                    fullName: event.createdBy.firstName
                        ? `${event.createdBy.firstName} ${event.createdBy.lastName}`
                        : "Unknown",
                }
                : undefined,
            examDetails: event.examDetails,
        };
    }
    calculateDurationInMinutes(startTime, endTime) {
        const start = new Date(`2000-01-01T${startTime}`);
        const end = new Date(`2000-01-01T${endTime}`);
        return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60));
    }
    formatDateRange(startDate, endDate, isAllDay) {
        const options = {
            year: "numeric",
            month: "short",
            day: "numeric",
        };
        const startStr = startDate.toLocaleDateString("en-US", options);
        const endStr = endDate.toLocaleDateString("en-US", options);
        if (startStr === endStr) {
            return startStr;
        }
        else {
            return `${startStr} - ${endStr}`;
        }
    }
}
exports.academicCalendarService = new AcademicCalendarService();
//# sourceMappingURL=academic-calendar.service.js.map